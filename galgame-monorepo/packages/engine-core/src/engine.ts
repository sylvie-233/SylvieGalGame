import type {
  BacklogEntry,
  BgCommand,
  BgmCommand,
  CgCommand,
  ChoiceCommand,
  Command,
  CompiledScene,
  DialogueSnapshot,
  EndingCommand,
  EndingDefinition,
  EngineEffect,
  EngineHost,
  GameManifest,
  GameSnapshot,
  Pointer,
  SaveData,
  SetCommand,
  SpriteCommand,
  StageSnapshot,
  TextCommand,
  VariableTable,
} from '@sylvie/types';
import { READ_MARKS_KEY, SAVE_VERSION } from '@sylvie/types';

import { evaluateCondition, evaluateExpression } from './expression';
import { interpolateText } from './interpolate';
import { loadGame, type LoadedGame } from './script';

const MAX_BACKLOG = 400;
const RUN_STEP_LIMIT = 200_000;
const READ_MARK_PERSIST_DELAY = 300;
/** 回滚只覆盖当前会话，最多保留 50 个阻塞点。 */
const ROLLBACK_HISTORY_LIMIT = 50;

interface RollbackState {
  phase: GameSnapshot['phase'];
  pointer: Pointer;
  chapter: string;
  variables: VariableTable;
  stage: StageSnapshot;
  audio: { bgm: string | null };
  backlog: BacklogEntry[];
  dialogue: DialogueSnapshot | null;
  choice: GameSnapshot['choice'];
  choiceOptions: ChoiceCommand['options'];
  waitMs: number;
}

export interface GameEngineOptions {
  host: EngineHost;
}

export interface CreateSaveOptions {
  screenshot?: string | null;
  note?: string;
  /** 当前 BGM 播放位置（秒），由播放器提供；引擎不认识音频实例。 */
  bgmPosition?: number;
}

function createEmptyStage(): StageSnapshot {
  return {
    background: { image: null, transition: 'none', duration: 0, revision: 0 },
    sprites: {},
    cg: { image: null, visible: false, transition: 'none', duration: 0, revision: 0 },
  };
}

function cloneStage(stage: StageSnapshot): StageSnapshot {
  return {
    background: { ...stage.background },
    sprites: Object.fromEntries(
      Object.entries(stage.sprites).map(([id, sprite]) => [id, { ...sprite }]),
    ),
    cg: { ...stage.cg },
  };
}

export function createEmptySnapshot(): GameSnapshot {
  return {
    phase: 'idle',
    pointer: { scene: '', block: '', index: 0 },
    chapter: '',
    chapterName: '',
    ending: null,
    stage: createEmptyStage(),
    dialogue: null,
    choice: null,
    audio: { bgm: null },
    variables: {},
    backlog: [],
    waitMs: 0,
  };
}

export class GameEngine {
  private readonly host: EngineHost;
  private readonly warn: (message: string) => void;
  private loaded: LoadedGame | null = null;
  private manifest: GameManifest | null = null;

  private variables: VariableTable = {};
  private stage: StageSnapshot = createEmptyStage();
  private dialogue: DialogueSnapshot | null = null;
  private choice: GameSnapshot['choice'] = null;
  private choiceOptions: ChoiceCommand['options'] = [];
  private audio: { bgm: string | null } = { bgm: null };
  private backlog: BacklogEntry[] = [];
  private pointer: Pointer = { scene: '', block: '', index: 0 };
  private phase: GameSnapshot['phase'] = 'idle';
  private chapter = '';
  private ending: EndingDefinition | null = null;
  private waitMs = 0;
  private snapshot: GameSnapshot = createEmptySnapshot();

  private readonly readMarks = new Set<string>();
  private readMarksTimer: ReturnType<typeof setTimeout> | null = null;
  private stateListeners = new Set<(snapshot: GameSnapshot) => void>();
  private effectListeners = new Set<(effect: EngineEffect) => void>();
  private readonly rollbackHistory: RollbackState[] = [];
  private readonly warned = new Set<string>();
  private contentVersion = '';

  constructor(options: GameEngineOptions) {
    this.host = options.host;
    this.warn = options.host.onWarning ?? ((message: string) => console.warn(message));
  }

  async initialize(): Promise<GameManifest> {
    const loaded = await loadGame(this.host.assets, this.warn);
    this.loaded = loaded;
    this.manifest = loaded.manifest;
    this.variables = { ...loaded.manifest.variables };
    this.contentVersion = loaded.manifest.version;

    const storedReadMarks = await this.host.storage.get(READ_MARKS_KEY);
    if (storedReadMarks) {
      try {
        const parsed: unknown = JSON.parse(storedReadMarks);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (typeof item === 'string') this.readMarks.add(item);
          }
        }
      } catch {
        this.warn('[存档] 已读标记读取失败，将从空记录开始');
      }
    }

    await this.validateAssets(loaded);
    this.emit();
    return loaded.manifest;
  }

  getManifest(): GameManifest {
    if (!this.manifest) throw new Error('引擎尚未初始化');
    return this.manifest;
  }

  isReady(): boolean {
    return this.loaded !== null;
  }

  getSnapshot(): GameSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: GameSnapshot) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onEffect(listener: (effect: EngineEffect) => void): () => void {
    this.effectListeners.add(listener);
    return () => this.effectListeners.delete(listener);
  }

  start(sceneName?: string): void {
    const loaded = this.requireLoaded();
    const name = sceneName ?? loaded.manifest.start;
    const scene = loaded.scenes.get(name);
    if (!scene) {
      this.warn(`[引擎] 无法启动不存在的场景 "${name}"`);
      return;
    }

    this.variables = { ...loaded.manifest.variables };
    this.stage = createEmptyStage();
    this.audio = { bgm: null };
    this.backlog = [];
    this.dialogue = null;
    this.choice = null;
    this.choiceOptions = [];
    this.phase = 'idle';
    this.waitMs = 0;
    this.chapter = 'start';
    this.ending = null;
    this.rollbackHistory.length = 0;
    this.pointer = { scene: name, block: scene.entryBlock, index: 0 };

    this.emitEffect({ type: 'bgm', track: null, fade: 0, loop: true });
    this.emitEffect({ type: 'scene', scene: name, assets: [...scene.assets] });
    this.emit();
    this.run(false);
  }

  restoreSave(data: SaveData): boolean {
    const loaded = this.requireLoaded();
    const scene = loaded.scenes.get(data.scene);
    if (!scene) {
      this.warn(`[存档] 存档指向的场景 "${data.scene}" 不存在`);
      return false;
    }
    const block = scene.blocks[data.pointer.block];
    if (!block) {
      this.warn(`[存档] 存档指针 ${data.pointer.block}#${data.pointer.index} 无效`);
      return false;
    }

    this.variables = { ...loaded.manifest.variables, ...data.variables };
    this.stage = cloneStage(data.stage);
    this.audio = { bgm: data.audio?.bgm ?? null };
    this.backlog = data.backlog.slice(-MAX_BACKLOG);
    this.dialogue = null;
    this.choice = null;
    this.choiceOptions = [];
    this.phase = 'idle';
    this.waitMs = 0;
    this.chapter = data.chapter || 'start';
    this.ending = null;
    this.pointer = {
      scene: data.scene,
      block: data.pointer.block,
      index: Math.max(0, data.pointer.index),
    };
    this.rollbackHistory.length = 0;

    if (data.contentVersion && data.contentVersion !== this.contentVersion) {
      this.warn(
        `[存档] 存档来自游戏版本 ${data.contentVersion}，当前为 ${this.contentVersion}，剧情可能已变化`,
      );
    }

    let markAdded = false;
    for (const id of data.readMarks) {
      if (!this.readMarks.has(id)) {
        this.readMarks.add(id);
        markAdded = true;
      }
    }
    if (markAdded) this.schedulePersistReadMarks();

    this.emitEffect({ type: 'scene', scene: data.scene, assets: [...scene.assets] });
    this.emitEffect({
      type: 'bgm',
      track: this.audio.bgm,
      fade: 0,
      loop: true,
      position: Math.max(0, data.bgmPosition ?? 0),
    });
    this.emit();
    this.run(true);
    return true;
  }

  /** 对话推进：只在 text 阻塞态有效。 */
  advance(): void {
    if (!this.loaded || this.phase !== 'text' || !this.dialogue) return;
    this.markRead(this.dialogue.id);
    this.pointer.index += 1;
    this.phase = 'idle';
    this.run(false);
  }

  choose(optionIndex: number): void {
    if (!this.loaded || this.phase !== 'choice') return;
    const option = this.choiceOptions[optionIndex];
    if (!option) {
      this.warn(`[引擎] 无效的选项下标 ${optionIndex}`);
      return;
    }
    for (const action of option.actions) {
      this.applySet(action);
    }
    this.choice = null;
    this.choiceOptions = [];
    this.phase = 'idle';
    if (!this.resolveTarget(option.target)) {
      this.pointer.index += 1;
    }
    this.run(false);
  }

  resumeWait(): void {
    if (!this.loaded || this.phase !== 'wait') return;
    this.waitMs = 0;
    this.pointer.index += 1;
    this.phase = 'idle';
    this.run(false);
  }

  /** 当前会话中是否还有可回滚的阻塞点。 */
  canRollback(): boolean {
    return (
      this.loaded !== null &&
      this.phase !== 'idle' &&
      this.phase !== 'ended' &&
      this.rollbackHistory.length >= 2
    );
  }

  /** 回到上一个文本 / 选项 / 等待阻塞点，并恢复当时的完整状态。 */
  rollback(): boolean {
    if (!this.canRollback()) return false;

    this.rollbackHistory.pop();
    const state = this.rollbackHistory[this.rollbackHistory.length - 1];
    if (!state) return false;

    this.phase = state.phase;
    this.pointer = { ...state.pointer };
    this.chapter = state.chapter;
    this.ending = null;
    this.variables = { ...state.variables };
    this.stage = cloneStage(state.stage);
    this.audio = { ...state.audio };
    this.backlog = state.backlog.map((entry) => ({ ...entry }));
    this.dialogue = state.dialogue ? { ...state.dialogue } : null;
    this.choice = state.choice
      ? {
          prompt: state.choice.prompt,
          options: state.choice.options.map((option) => ({ ...option })),
        }
      : null;
    this.choiceOptions = state.choiceOptions.map((option) => ({ ...option }));
    this.waitMs = state.waitMs;

    const scene = this.requireLoaded().scenes.get(this.pointer.scene);
    if (scene) {
      this.emitEffect({ type: 'scene', scene: scene.name, assets: [...scene.assets] });
    }
    this.emitEffect({ type: 'bgm', track: this.audio.bgm, fade: 0, loop: true });
    if (this.dialogue?.voice) {
      this.emitEffect({ type: 'voice', sound: this.dialogue.voice });
    }
    this.emit();
    if (this.phase === 'text' || this.phase === 'choice') {
      this.emitEffect({ type: 'checkpoint', block: this.phase, chapter: this.chapter });
    }
    return true;
  }

  isCurrentTextRead(): boolean {
    if (!this.dialogue) return false;
    if (this.readMarks.has(this.dialogue.id)) return true;
    // 兼容一期存档：旧已读标记是 block#文本下标，升级后首次仍可命中。
    return this.readMarks.has(`${this.pointer.block}#${this.pointer.index}`);
  }

  getReadMarkCount(): number {
    return this.readMarks.size;
  }

  /**
   * 预加载提示：从当前指针向后扫描跳转 / 分支目标，返回接下来可能进入的
   * 其他场景的资源。只读，不改变引擎状态；玩家侧仍会再做数量预算。
   */
  getUpcomingSceneAssets(limit = 2): string[] {
    const loaded = this.loaded;
    if (!loaded) return [];
    const currentScene = loaded.scenes.get(this.pointer.scene);
    const block = currentScene?.blocks[this.pointer.block];
    if (!block) return [];

    const targetScenes = new Set<CompiledScene>();
    const collect = (target: string | null): void => {
      if (!target) return;
      const found = this.findTargetScene(target);
      if (!found || !found.valid || found.scene.name === this.pointer.scene) return;
      targetScenes.add(found.scene);
    };

    // 从当前指令开始扫描：choice 阻塞时目标就在当前指令里。
    for (let index = this.pointer.index; index < block.commands.length; index += 1) {
      if (targetScenes.size >= limit) break;
      const command = block.commands[index];
      if (!command) continue;
      if (command.kind === 'jump') {
        collect(command.target);
      } else if (command.kind === 'if') {
        collect(command.then);
        collect(command.else);
      } else if (command.kind === 'choice') {
        for (const option of command.options) collect(option.target);
      }
    }

    const assets = new Set<string>();
    for (const scene of targetScenes) {
      for (const asset of scene.assets) assets.add(asset);
    }
    return [...assets];
  }

  private findTargetScene(
    target: string,
  ): { scene: CompiledScene; valid: boolean } | null {
    const loaded = this.loaded;
    if (!loaded) return null;
    const hash = target.indexOf('#');
    if (hash >= 0) {
      const sceneName = target.slice(0, hash).trim();
      const labelName = target.slice(hash + 1).trim();
      const scene = loaded.scenes.get(sceneName);
      if (!scene) return null;
      return { scene, valid: Boolean(labelName && scene.labels[labelName]) };
    }
    const scene = loaded.scenes.get(this.pointer.scene);
    if (!scene) return null;
    return { scene, valid: Boolean(scene.labels[target]) };
  }

  createSave(options: CreateSaveOptions = {}): SaveData {
    this.requireLoaded();
    return {
      version: SAVE_VERSION,
      createdAt: Date.now(),
      scene: this.pointer.scene,
      pointer: { ...this.pointer },
      chapter: this.chapter,
      variables: { ...this.variables },
      stage: cloneStage(this.stage),
      audio: { ...this.audio },
      bgmPosition:
        typeof options.bgmPosition === 'number' && Number.isFinite(options.bgmPosition)
          ? Math.max(0, options.bgmPosition)
          : 0,
      readMarks: [...this.readMarks],
      backlog: this.backlog.slice(),
      note: options.note ?? '',
      contentVersion: this.contentVersion,
      screenshot: options.screenshot ?? null,
    };
  }

  dispose(): void {
    if (this.readMarksTimer) {
      clearTimeout(this.readMarksTimer);
      this.readMarksTimer = null;
      void this.persistReadMarks();
    }
    this.rollbackHistory.length = 0;
    this.stateListeners.clear();
    this.effectListeners.clear();
  }

  private requireLoaded(): LoadedGame {
    if (!this.loaded) {
      throw new Error('引擎尚未初始化，请先调用 initialize()');
    }
    return this.loaded;
  }

  private async validateAssets(loaded: LoadedGame): Promise<void> {
    const checked = new Map<string, boolean>();
    const missing: string[] = [];

    for (const scene of loaded.scenes.values()) {
      for (const asset of scene.assets) {
        const location = loaded.assetLocations.get(asset);
        const described = location ? `${asset}（${location}）` : asset;
        if (checked.has(asset)) {
          if (!checked.get(asset)) missing.push(described);
          continue;
        }
        const exists = await this.host.assets.exists(asset);
        checked.set(asset, exists);
        if (!exists) missing.push(described);
      }
    }

    if (missing.length > 0) {
      const unique = [...new Set(missing)];
      this.warn(
        `[资源缺失] 共 ${unique.length} 个资源未找到，播放时将显示空白或静音：\n  ${unique.join('\n  ')}`,
      );
    }
  }

  private run(restoring: boolean): void {
    const loaded = this.requireLoaded();
    let steps = 0;

    for (;;) {
      steps += 1;
      if (steps > RUN_STEP_LIMIT) {
        this.warn('[引擎] 单次指令执行超过上限，可能存在死循环，已停止在当前位置');
        this.phase = 'ended';
        this.emit();
        this.emitEffect({ type: 'ended' });
        return;
      }

      const scene = loaded.scenes.get(this.pointer.scene);
      if (!scene) {
        this.warn(`[引擎] 当前场景 "${this.pointer.scene}" 丢失`);
        this.finish();
        return;
      }
      const block = scene.blocks[this.pointer.block];
      if (!block) {
        this.warn(`[引擎] 指针块 "${this.pointer.block}" 丢失`);
        this.finish();
        return;
      }
      if (this.pointer.index >= block.commands.length) {
        this.finish();
        return;
      }

      const command = block.commands[this.pointer.index];
      if (!command) {
        this.finish();
        return;
      }

      switch (command.kind) {
        case 'label':
          this.chapter = command.name;
          this.pointer.index += 1;
          break;
        case 'jump':
          if (!this.resolveTarget(command.target)) {
            this.pointer.index += 1;
          }
          break;
        case 'set':
          this.applySet(command);
          this.pointer.index += 1;
          break;
        case 'shake':
          this.emitEffect({
            type: 'shake',
            intensity: command.intensity,
            duration: command.duration,
          });
          this.pointer.index += 1;
          break;
        case 'flash':
          this.emitEffect({
            type: 'flash',
            color: command.color,
            opacity: command.opacity,
            duration: command.duration,
          });
          this.pointer.index += 1;
          break;
        case 'ending':
          this.applyEnding(command);
          return;
        case 'if': {
          let passed = false;
          try {
            passed = evaluateCondition(command.condition, this.variables);
          } catch (error) {
            this.warn(`[引擎] 条件 "${command.condition}" 求值失败：${String(error)}`);
          }
          const target = passed ? command.then : command.else;
          if (target) {
            if (!this.resolveTarget(target)) this.pointer.index += 1;
          } else {
            this.pointer.index += 1;
          }
          break;
        }
        case 'bg':
          this.applyBg(command);
          this.pointer.index += 1;
          this.emit();
          break;
        case 'sprite':
          this.applySprite(command);
          this.pointer.index += 1;
          this.emit();
          break;
        case 'cg':
          this.applyCg(command);
          this.pointer.index += 1;
          this.emit();
          break;
        case 'bgm':
          this.applyBgm(command);
          this.pointer.index += 1;
          this.emit();
          break;
        case 'se':
          this.emitEffect({ type: 'se', sound: command.sound, volume: command.volume });
          this.pointer.index += 1;
          break;
        case 'voice':
          this.emitEffect({ type: 'voice', sound: command.sound });
          this.pointer.index += 1;
          break;
        case 'text':
          this.blockOnText(command, restoring);
          return;
        case 'choice':
          if (this.blockOnChoice(command, restoring)) {
            return;
          }
          break;
        case 'wait':
          this.phase = 'wait';
          this.waitMs = command.duration;
          this.recordRollback('wait', this.waitMs);
          this.emit();
          return;
        default: {
          const neverCommand: never = command;
          this.warn(`[引擎] 未处理的指令 ${JSON.stringify(neverCommand)}`);
          this.pointer.index += 1;
          break;
        }
      }
    }
  }

  private blockOnText(command: TextCommand, restoring: boolean): void {
    const text = interpolateText(command.text, this.variables, (message) =>
      this.warnOnce(`text:${command.id}:${message}`, message),
    );

    this.dialogue = {
      id: command.id,
      speaker: command.speaker,
      text,
      voice: command.voice,
    };
    this.phase = 'text';
    this.waitMs = 0;

    const last = this.backlog[this.backlog.length - 1];
    if (!last || last.id !== command.id) {
      this.backlog.push({
        id: command.id,
        speaker: command.speaker,
        text,
        voice: command.voice,
        at: Date.now(),
      });
      if (this.backlog.length > MAX_BACKLOG) {
        this.backlog.splice(0, this.backlog.length - MAX_BACKLOG);
      }
    }

    this.recordRollback('text', 0);
    this.emit();
    if (command.voice) {
      this.emitEffect({ type: 'voice', sound: command.voice });
    }
    if (!restoring) {
      this.emitEffect({ type: 'checkpoint', block: 'text', chapter: this.chapter });
    }
  }

  private blockOnChoice(command: ChoiceCommand, restoring: boolean): boolean {
    const views: NonNullable<GameSnapshot['choice']>['options'] = [];

    command.options.forEach((option, optionIndex) => {
      if (!option.condition) {
        views.push({ optionIndex, text: option.text });
        return;
      }
      try {
        if (evaluateCondition(option.condition, this.variables)) {
          views.push({ optionIndex, text: option.text });
        }
      } catch (error) {
        this.warn(`[引擎] 选项条件 "${option.condition}" 求值失败：${String(error)}`);
      }
    });

    if (views.length === 0) {
      this.warn(
        `[引擎] ${this.pointer.block}#${this.pointer.index} 的 choice 没有可见选项，已跳过`,
      );
      this.pointer.index += 1;
      return false;
    }

    this.choice = { prompt: command.prompt, options: views };
    this.choiceOptions = command.options;
    this.phase = 'choice';
    this.waitMs = 0;
    this.recordRollback('choice', 0);
    this.emit();
    if (!restoring) {
      this.emitEffect({ type: 'checkpoint', block: 'choice', chapter: this.chapter });
    }
    return true;
  }

  private recordRollback(phase: RollbackState['phase'], waitMs: number): void {
    if (this.rollbackHistory.length >= ROLLBACK_HISTORY_LIMIT) {
      this.rollbackHistory.shift();
    }
    this.rollbackHistory.push({
      phase,
      pointer: { ...this.pointer },
      chapter: this.chapter,
      variables: { ...this.variables },
      stage: cloneStage(this.stage),
      audio: { ...this.audio },
      backlog: this.backlog.map((entry) => ({ ...entry })),
      dialogue: this.dialogue ? { ...this.dialogue } : null,
      choice: this.choice
        ? {
            prompt: this.choice.prompt,
            options: this.choice.options.map((option) => ({ ...option })),
          }
        : null,
      choiceOptions: this.choiceOptions.map((option) => ({ ...option })),
      waitMs,
    });
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.warn(message);
  }

  private applyBg(command: BgCommand): void {
    this.stage.background = {
      image: command.image,
      transition: command.transition,
      ease: command.ease,
      duration: command.duration,
      revision: this.stage.background.revision + 1,
    };
  }

  private applySprite(command: SpriteCommand): void {
    const previous = this.stage.sprites[command.id];
    this.stage.sprites = {
      ...this.stage.sprites,
      [command.id]: {
        id: command.id,
        image: command.image ?? previous?.image ?? null,
        position: command.position,
        opacity: command.image ? command.opacity : 0,
        scale: command.scale,
        z: command.z,
        flip: command.flip,
        transition: command.transition,
        ease: command.ease,
        duration: command.duration,
        revision: (previous?.revision ?? 0) + 1,
      },
    };
  }

  private applyCg(command: CgCommand): void {
    const previous = this.stage.cg;
    this.stage.cg = {
      image: command.image ?? previous.image,
      visible: command.visible,
      transition: command.transition,
      ease: command.ease,
      duration: command.duration,
      revision: previous.revision + 1,
    };
  }

  private applyBgm(command: BgmCommand): void {
    this.audio = { bgm: command.track };
    this.emitEffect({
      type: 'bgm',
      track: command.track,
      fade: command.fade,
      loop: command.loop,
    });
  }

  private applySet(command: SetCommand): void {
    let next: SetCommand['value'];
    if (command.expr !== null) {
      try {
        next = evaluateExpression(command.expr, this.variables);
      } catch (error) {
        this.warn(
          `[引擎] 变量 "${command.variable}" 表达式 "${command.expr}" 求值失败：${String(error)}`,
        );
        return;
      }
    } else {
      next = command.value;
    }
    if (next === null) {
      this.warn(`[引擎] 变量 "${command.variable}" 的 set 缺少 value 或 expr`);
      return;
    }

    if (command.op === '=') {
      this.variables = { ...this.variables, [command.variable]: next };
      return;
    }

    const current = this.variables[command.variable];
    if (command.op === '+=') {
      if (typeof current === 'string' || typeof next === 'string') {
        this.variables = {
          ...this.variables,
          [command.variable]: `${String(current ?? '')}${String(next)}`,
        };
        return;
      }
      if (typeof current !== 'number' || typeof next !== 'number') {
        this.warn(`[引擎] 变量 "${command.variable}" 不是数字，无法执行 +=`);
        return;
      }
      this.variables = { ...this.variables, [command.variable]: current + next };
      return;
    }

    if (typeof current !== 'number' || typeof next !== 'number') {
      this.warn(`[引擎] 变量 "${command.variable}" 不是数字，无法执行 -=`);
      return;
    }
    this.variables = { ...this.variables, [command.variable]: current - next };
  }

  private resolveTarget(target: string): boolean {
    const loaded = this.requireLoaded();
    const hash = target.indexOf('#');

    if (hash >= 0) {
      const sceneName = target.slice(0, hash).trim();
      const labelName = target.slice(hash + 1).trim();
      const scene = loaded.scenes.get(sceneName);
      if (!scene) {
        this.warn(`[引擎] 跳转目标场景 "${sceneName}" 不存在（target=${target}）`);
        return false;
      }
      const location = labelName ? scene.labels[labelName] : { block: scene.entryBlock, index: 0 };
      if (!location) {
        this.warn(`[引擎] 场景 "${sceneName}" 找不到 label "${labelName}"（target=${target}）`);
        return false;
      }
      this.pointer = { scene: sceneName, block: location.block, index: location.index };
      this.chapter = labelName || 'start';
      this.emitEffect({ type: 'scene', scene: sceneName, assets: [...scene.assets] });
      return true;
    }

    const scene = loaded.scenes.get(this.pointer.scene);
    if (!scene) return false;
    const location = scene.labels[target];
    if (!location) {
      this.warn(`[引擎] 当前场景 "${this.pointer.scene}" 找不到 label "${target}"`);
      return false;
    }
    this.pointer = {
      scene: this.pointer.scene,
      block: location.block,
      index: location.index,
    };
    this.chapter = target;
    return true;
  }

  private applyEnding(command: EndingCommand): void {
    const ending = this.requireLoaded().manifest.endings.find((item) => item.id === command.id);
    if (!ending) {
      this.warn(`[引擎] 结局 "${command.id}" 未在 game.yaml endings 中登记`);
      this.ending = null;
    } else {
      this.ending = { ...ending };
    }
    this.pointer.index += 1;
    this.finish();
  }

  private finish(): void {
    this.phase = 'ended';
    this.choice = null;
    this.choiceOptions = [];
    this.waitMs = 0;
    this.emit();
    this.emitEffect({ type: 'ended' });
  }

  private markRead(id: string): void {
    if (this.readMarks.has(id)) return;
    this.readMarks.add(id);
    this.schedulePersistReadMarks();
  }

  private schedulePersistReadMarks(): void {
    if (this.readMarksTimer) {
      clearTimeout(this.readMarksTimer);
    }
    this.readMarksTimer = setTimeout(() => {
      this.readMarksTimer = null;
      void this.persistReadMarks();
    }, READ_MARK_PERSIST_DELAY);
  }

  private async persistReadMarks(): Promise<void> {
    try {
      await this.host.storage.set(READ_MARKS_KEY, JSON.stringify([...this.readMarks]));
    } catch (error) {
      this.warn(`[存档] 已读标记写入失败：${String(error)}`);
    }
  }

  private emitEffect(effect: EngineEffect): void {
    this.effectListeners.forEach((listener) => listener(effect));
  }

  private resolveChapterName(): string {
    if (!this.chapter) return '';
    return this.manifest?.chapters[this.chapter] ?? this.chapter;
  }

  private emit(): void {
    this.snapshot = {
      phase: this.phase,
      pointer: { ...this.pointer },
      chapter: this.chapter,
      chapterName: this.resolveChapterName(),
      ending: this.ending ? { ...this.ending } : null,
      stage: cloneStage(this.stage),
      dialogue: this.dialogue ? { ...this.dialogue } : null,
      choice: this.choice
        ? {
            prompt: this.choice.prompt,
            options: this.choice.options.map((option) => ({ ...option })),
          }
        : null,
      audio: { ...this.audio },
      variables: { ...this.variables },
      backlog: this.backlog.slice(),
      waitMs: this.waitMs,
    };

    this.stateListeners.forEach((listener) => listener(this.snapshot));
  }
}

/** 供播放器判断指令类型的小工具。 */
export function isBlocking(command: Command): boolean {
  return command.kind === 'text' || command.kind === 'choice' || command.kind === 'wait';
}

export type { CompiledScene };
