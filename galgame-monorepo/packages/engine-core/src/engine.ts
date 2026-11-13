/**
 * 剧情引擎：在编译后的剧本上维护指针、阻塞态与运行时状态。
 *
 * 调度模型是「指针 + 阻塞」：即时指令（set / bg / jump / if 等）在 `run()`
 * 中循环执行；遇到 text / choice / wait 时保存快照并返回，等播放器交互后
 * 再调用 advance / choose / resumeWait 继续。对外只暴露不可变快照与 effect 事件。
 */
import type {
  BacklogEntry,
  BgCommand,
  BgmCommand,
  CgCommand,
  ChoiceCommand,
  Command,
  CompiledScene,
  DialogueSnapshot,
  EffectCommand,
  EndingCommand,
  EndingDefinition,
  EngineEffect,
  EngineHost,
  GameManifest,
  GameSnapshot,
  MinigameCommand,
  MinigameResult,
  MinigameState,
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
import { isSaveData } from './storage';

/** Backlog 只保留最近 400 行，避免长时间游玩后快照无限膨胀。 */
const MAX_BACKLOG = 400;
/** 单次推进的指令上限，用于兜底检测 `jump` 自环等死循环。 */
const RUN_STEP_LIMIT = 200_000;
/** 已读标记合并写入的防抖间隔（毫秒），避免每句台词都落盘。 */
const READ_MARK_PERSIST_DELAY = 300;
/** 回滚只覆盖当前会话，最多保留 50 个阻塞点。 */
const ROLLBACK_HISTORY_LIMIT = 50;

/**
 * 一个阻塞点的完整可恢复状态。
 * 只保存在内存中，不写入存档；记录时必须深拷贝可变字段，防止后续推进污染历史。
 */
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
  minigame: MinigameState | null;
  minigameCommand: MinigameCommand | null;
  waitMs: number;
}

/** 创建引擎所需的最小宿主能力。 */
export interface GameEngineOptions {
  host: EngineHost;
}

/** createSave 的可选附加信息；引擎不感知截图与音频实例，由播放器补齐。 */
export interface CreateSaveOptions {
  screenshot?: string | null;
  note?: string;
  /** 当前 BGM 播放位置（秒），由播放器提供；引擎不认识音频实例。 */
  bgmPosition?: number;
}

/** 构造空舞台；每次返回新对象，避免不同引擎实例共享引用。 */
function createEmptyStage(): StageSnapshot {
  return {
    background: { image: null, transition: 'none', duration: 0, revision: 0 },
    sprites: {},
    cg: { image: null, visible: false, transition: 'none', duration: 0, revision: 0 },
    effects: [],
  };
}

/**
 * 深拷贝小游戏参数。
 * 参数来自 YAML，理论上只含普通对象 / 数组 / 原始值；structuredClone 失败时退化为浅拷贝，
 * 至少不会因为一个异常值阻断整个剧本。
 */
function cloneParams(params: Record<string, unknown>): Record<string, unknown> {
  try {
    return structuredClone(params);
  } catch {
    return { ...params };
  }
}

/**
 * 深拷贝舞台，保证快照 / 回滚历史与引擎内部状态互不影响。
 * 特效配置本身不可变（每次 effect 指令整体替换），因此直接复用引用；
 * 这样播放器可以按配置对象引用判断是否需要重新初始化粒子。
 * 旧存档可能缺少 effects 字段，这里兜底为空数组。
 */
function cloneStage(stage: StageSnapshot): StageSnapshot {
  return {
    background: { ...stage.background },
    sprites: Object.fromEntries(
      Object.entries(stage.sprites).map(([id, sprite]) => [id, { ...sprite }]),
    ),
    cg: { ...stage.cg },
    // 只复制数组外壳，配置对象保持引用稳定；播放器据此避免每帧重建粒子。
    effects: Array.isArray(stage.effects) ? stage.effects.slice() : [],
  };
}

/** 未初始化时对外暴露的空快照。 */
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
    minigame: null,
    audio: { bgm: null },
    variables: {},
    backlog: [],
    waitMs: 0,
  };
}

/**
 * 剧情引擎。
 *
 * 所有可变状态只在类内部修改，对外通过不可变快照与 effect 事件输出；
 * 播放器不需要（也不应该）直接操作指针或变量。
 */
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
  private minigame: MinigameState | null = null;
  /** 当前阻塞中的 minigame 指令；结果映射与 skip 默认值都由它提供。 */
  private minigameCommand: MinigameCommand | null = null;
  private audio: { bgm: string | null } = { bgm: null };
  private backlog: BacklogEntry[] = [];
  private pointer: Pointer = { scene: '', block: '', index: 0 };
  private phase: GameSnapshot['phase'] = 'idle';
  private chapter = '';
  private ending: EndingDefinition | null = null;
  private waitMs = 0;
  private snapshot: GameSnapshot = createEmptySnapshot();

  /** 已读 id 常驻内存，避免每次判断都读存储。 */
  private readonly readMarks = new Set<string>();
  /** 已读标记防抖写入句柄；dispose 时立即落盘。 */
  private readMarksTimer: ReturnType<typeof setTimeout> | null = null;
  private stateListeners = new Set<(snapshot: GameSnapshot) => void>();
  private effectListeners = new Set<(effect: EngineEffect) => void>();
  /** 当前会话的回滚历史，按阻塞点先后排列。 */
  private readonly rollbackHistory: RollbackState[] = [];
  /** warnOnce 去重表，键通常是「指令 id + 消息」。 */
  private readonly warned = new Set<string>();
  /** 当前 manifest.version，用于读档时提示内容不一致。 */
  private contentVersion = '';

  constructor(options: GameEngineOptions) {
    this.host = options.host;
    this.warn = options.host.onWarning ?? ((message: string) => console.warn(message));
  }

  /**
   * 读取 manifest、递归加载场景并做资源校验。
   * 已读标记读取失败只降级为空集合，不阻断启动。
   * 通常只在启动时调用一次；重复调用会重新加载并覆盖变量初值。
   */
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

  /** 返回已加载的 manifest；未初始化时抛错。 */
  getManifest(): GameManifest {
    if (!this.manifest) throw new Error('引擎尚未初始化');
    return this.manifest;
  }

  /** 是否已完成 `initialize()`。 */
  isReady(): boolean {
    return this.loaded !== null;
  }

  /** 最近一次 emit 产生的快照；对象不可变，可直接比较引用。 */
  getSnapshot(): GameSnapshot {
    return this.snapshot;
  }

  /** 订阅状态快照，返回取消订阅函数。 */
  subscribe(listener: (snapshot: GameSnapshot) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** 订阅瞬时副作用事件，返回取消订阅函数。 */
  onEffect(listener: (effect: EngineEffect) => void): () => void {
    this.effectListeners.add(listener);
    return () => this.effectListeners.delete(listener);
  }

  /**
   * 从指定场景（默认 manifest.start）重新开始。
   * 会清空变量、舞台、Backlog 与回滚历史，并立即推进到第一个阻塞点。
   */
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
    this.minigame = null;
    this.minigameCommand = null;
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

  /**
   * 从存档恢复。
   *
   * 指针无效时返回 false 并保持当前状态不变；恢复后以 restoring=true 重新执行
   * 当前指令，因此不会补发 checkpoint。存档中的已读标记会合并进当前集合，
   * contentVersion 不一致只提示，不阻止读档。
   */
  restoreSave(data: SaveData): boolean {
    const loaded = this.requireLoaded();
    // 导入的存档只经过键名白名单，不能假定嵌套字段完整；先做结构校验，
    // 否则 cloneStage 遇到缺失的 sprites 会抛异常并留下半恢复状态。
    if (!isSaveData(data)) {
      this.warn('[存档] 存档结构不完整，无法恢复');
      return false;
    }
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

    let stage: StageSnapshot;
    try {
      stage = cloneStage(data.stage);
    } catch (error) {
      this.warn(`[存档] 舞台状态无法恢复：${String(error)}`);
      return false;
    }

    this.variables = { ...loaded.manifest.variables, ...data.variables };
    this.stage = stage;
    this.audio = { bgm: data.audio?.bgm ?? null };
    this.backlog = data.backlog.slice(-MAX_BACKLOG);
    this.dialogue = null;
    this.choice = null;
    this.choiceOptions = [];
    this.minigame = null;
    this.minigameCommand = null;
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

  /** 对话推进：只在 text 阻塞态有效，会把当前行记为已读并前进一条指令。 */
  advance(): void {
    if (!this.loaded || this.phase !== 'text' || !this.dialogue) return;
    this.markRead(this.dialogue.id);
    this.pointer.index += 1;
    this.phase = 'idle';
    this.run(false);
  }

  /** 选择选项：先执行选项上的赋值动作，再跳转；目标无效时顺延到下一条指令。 */
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

  /** wait 计时结束后的继续信号。 */
  resumeWait(): void {
    if (!this.loaded || this.phase !== 'wait') return;
    this.waitMs = 0;
    this.pointer.index += 1;
    this.phase = 'idle';
    this.run(false);
  }

  /**
   * 结束当前小游戏并按剧本映射写回变量。
   *
   * 结果键只有出现在 `minigame.result` 中才会写入同名变量，未声明的键静默忽略，
   * 因此小游戏实现可以自由扩展返回值而不污染剧本。类型不是数字/布尔/字符串的值
   * 会被丢弃并警告；变量未在 game.yaml 中登记时也允许写入，但会提示作者。
   * 重复调用或当前不在 minigame 阶段时为空操作。
   */
  finishMinigame(result: MinigameResult = {}): void {
    if (!this.loaded || this.phase !== 'minigame' || !this.minigameCommand) return;
    const command = this.minigameCommand;
    const nextVariables: VariableTable = { ...this.variables };

    for (const [key, variable] of Object.entries(command.result)) {
      if (!Object.prototype.hasOwnProperty.call(result, key)) continue;
      const value = result[key];
      if (
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean'
      ) {
        this.warn(`[小游戏] "${command.id}" 的结果 "${key}" 不是可写入变量的类型，已忽略`);
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(this.variables, variable)) {
        this.warn(`[小游戏] "${command.id}" 写入了未在 game.yaml 中声明的变量 "${variable}"`);
      }
      nextVariables[variable] = value;
    }

    this.variables = nextVariables;
    this.minigame = null;
    this.minigameCommand = null;
    this.dialogue = null;
    this.phase = 'idle';
    this.waitMs = 0;
    this.pointer.index += 1;
    this.run(false);
  }

  /** 跳过当前小游戏：使用剧本 minigame.skip 中声明的默认结果，继续推进。 */
  skipMinigame(): void {
    if (!this.loaded || this.phase !== 'minigame' || !this.minigameCommand) return;
    this.finishMinigame(this.minigameCommand.skip);
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

  /**
   * 回到上一个文本 / 选项 / 等待阻塞点，并恢复当时的完整状态。
   * 当前阻塞点会被弹出历史；历史中至少要有两个点（当前 + 上一处）才允许回退。
   */
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
    this.minigame = state.minigame ? { ...state.minigame, params: cloneParams(state.minigame.params) } : null;
    this.minigameCommand = state.minigameCommand;
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

  /** 当前对话是否已读；兼容旧版 `block#下标` 形式的已读标记。 */
  isCurrentTextRead(): boolean {
    if (!this.dialogue) return false;
    if (this.readMarks.has(this.dialogue.id)) return true;
    // 兼容一期存档：旧已读标记是 block#文本下标，升级后首次仍可命中。
    return this.readMarks.has(`${this.pointer.block}#${this.pointer.index}`);
  }

  /** 已读文本 id 总数。 */
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

  /**
   * 解析 `label` 或 `scene#label` 并判断目标 label 是否存在。
   * 仅用于预加载扫描，不修改指针；无效目标由调用方忽略。
   */
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

  /** 组装当前状态的存档数据；不会写入存储，由播放器决定槽位。 */
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

  /** 释放监听器与定时器；待写入的已读标记会立即落盘。 */
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

  /** 断言已初始化并返回加载结果；未初始化属于调用方错误，直接抛错。 */
  private requireLoaded(): LoadedGame {
    if (!this.loaded) {
      throw new Error('引擎尚未初始化，请先调用 initialize()');
    }
    return this.loaded;
  }

  /** 启动时逐个检查资源是否存在；相同路径只查一次，并按首次引用位置汇总警告。 */
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

  /**
   * 指令推进主循环。
   *
   * 即时指令执行后指针前进并继续；遇到阻塞指令（text / choice / wait）则记录
   * 回滚点、emit 快照并返回。restoring 表示刚读档恢复，用于抑制重复的
   * checkpoint 事件，避免自动存档在恢复瞬间被触发。
   */
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

      // 每个分支要么自行推进指针，要么跳到新位置；阻塞分支直接 return。
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
        case 'effect':
          this.applyEffect(command);
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
        case 'minigame':
          this.blockOnMinigame(command, restoring);
          return;
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

  /**
   * 进入 text 阻塞态：求值插值、写入 Backlog、记录回滚点并通知 UI。
   * 同一 id 连续出现时不重复写 Backlog（读档 / 回滚会重放同一条指令）。
   */
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

  /**
   * 尝试进入 choice 阻塞态。
   * 无 condition 的选项始终可见；条件求值失败的选项视为不可见并警告。
   * 返回 false 表示没有任何可见选项，调用方应跳过该指令继续推进。
   */
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

  /**
   * 进入 minigame 阻塞态。
   *
   * 只在快照中提供展示信息与参数，具体渲染由宿主 loader 负责。
   * 这里不发出 checkpoint：小游戏本身没有进度，重开一次不会丢失剧情状态；
   * 结束后的下一条文本会照常触发自动存档。
   */
  private blockOnMinigame(command: MinigameCommand, _restoring: boolean): void {
    const prompt = command.prompt
      ? interpolateText(command.prompt, this.variables, (message) =>
          this.warnOnce(`minigame:${command.id}:${message}`, message),
        )
      : null;

    this.minigame = {
      id: command.id,
      title: command.title,
      prompt,
      params: cloneParams(command.params),
    };
    this.minigameCommand = command;
    this.dialogue = null;
    this.choice = null;
    this.choiceOptions = [];
    this.phase = 'minigame';
    this.waitMs = 0;
    this.recordRollback('minigame', 0);
    this.emit();
  }

  /**
   * 保存当前阻塞点到回滚历史。
   * 历史满 50 条时丢弃最旧的一条；所有可变字段都做拷贝，避免后续推进污染历史。
   */
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
      minigame: this.minigame
        ? { ...this.minigame, params: cloneParams(this.minigame.params) }
        : null,
      minigameCommand: this.minigameCommand,
      waitMs,
    });
  }

  /** 同一 key 的警告只发一次，避免循环或重复推进时刷屏。 */
  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.warn(message);
  }

  /** 更新背景状态；revision 自增让相同图片重复切换也能触发动画。 */
  private applyBg(command: BgCommand): void {
    this.stage.background = {
      image: command.image,
      transition: command.transition,
      ease: command.ease,
      duration: command.duration,
      revision: this.stage.background.revision + 1,
    };
  }

  /**
   * 更新立绘槽位。
   * 隐藏（image 为 null）时保留上一次素材并把透明度设为 0，便于淡出；
   * revision 自增供 UI 重新触发过渡。
   */
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

  /** 更新 CG 图层；隐藏时保留旧图以便淡出。 */
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

  /** 整体替换舞台环境特效；空数组即清除。 */
  private applyEffect(command: EffectCommand): void {
    this.stage.effects = command.effects;
  }

  /** 记录 BGM 并通知播放器执行切换。 */
  private applyBgm(command: BgmCommand): void {
    this.audio = { bgm: command.track };
    this.emitEffect({
      type: 'bgm',
      track: command.track,
      fade: command.fade,
      loop: command.loop,
    });
  }

  /**
   * 执行变量赋值。
   * expr 优先于 value；求值失败或类型不匹配时只警告并保持变量不变。
   * `+=` 在任一侧为字符串时做拼接，其余算术运算要求两侧都是数字。
   */
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

  /**
   * 把跳转目标解析成指针并切换当前章节。
   * 支持 `scene#label` 与当前场景内的 `label`；失败时返回 false，
   * 由调用方决定是顺延到下一条还是跳过整条指令。
   */
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

  /** 查找并记录结局；未登记的 id 会警告，但仍会结束剧情。 */
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

  /** 进入 ended 阶段并广播结束事件。 */
  private finish(): void {
    this.phase = 'ended';
    this.choice = null;
    this.choiceOptions = [];
    this.minigame = null;
    this.minigameCommand = null;
    this.waitMs = 0;
    this.emit();
    this.emitEffect({ type: 'ended' });
  }

  /** 标记已读并安排防抖落盘。 */
  private markRead(id: string): void {
    if (this.readMarks.has(id)) return;
    this.readMarks.add(id);
    this.schedulePersistReadMarks();
  }

  /** 重置防抖计时器；连续阅读时只在停顿后写一次。 */
  private schedulePersistReadMarks(): void {
    if (this.readMarksTimer) {
      clearTimeout(this.readMarksTimer);
    }
    this.readMarksTimer = setTimeout(() => {
      this.readMarksTimer = null;
      void this.persistReadMarks();
    }, READ_MARK_PERSIST_DELAY);
  }

  /** 把已读集合整体写回存储；失败仅警告，不影响游戏继续。 */
  private async persistReadMarks(): Promise<void> {
    try {
      await this.host.storage.set(READ_MARKS_KEY, JSON.stringify([...this.readMarks]));
    } catch (error) {
      this.warn(`[存档] 已读标记写入失败：${String(error)}`);
    }
  }

  /** 同步广播 effect；监听器应自行避免抛错，否则会中断当前推进。 */
  private emitEffect(effect: EngineEffect): void {
    this.effectListeners.forEach((listener) => listener(effect));
  }

  /** 把内部 label 名映射为 manifest.chapters 中的展示名；未登记时回退原值。 */
  private resolveChapterName(): string {
    if (!this.chapter) return '';
    return this.manifest?.chapters[this.chapter] ?? this.chapter;
  }

  /** 重建不可变快照并通知所有状态监听者。 */
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
      minigame: this.minigame
        ? { ...this.minigame, params: cloneParams(this.minigame.params) }
        : null,
      audio: { ...this.audio },
      variables: { ...this.variables },
      backlog: this.backlog.slice(),
      waitMs: this.waitMs,
    };

    this.stateListeners.forEach((listener) => listener(this.snapshot));
  }
}

/** 判断指令是否会让引擎暂停，等待播放器 / 玩家输入。 */
export function isBlocking(command: Command): boolean {
  return (
    command.kind === 'text' ||
    command.kind === 'choice' ||
    command.kind === 'minigame' ||
    command.kind === 'wait'
  );
}

export type { CompiledScene };
