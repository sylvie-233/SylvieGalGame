import type {
  AssetHost,
  BgCommand,
  BgmCommand,
  CgCommand,
  ChoiceCommand,
  Command,
  CompiledBlock,
  CompiledScene,
  GameManifest,
  IfCommand,
  JumpCommand,
  LabelCommand,
  SeCommand,
  SetCommand,
  SpriteCommand,
  SpritePosition,
  TextCommand,
  Transition,
  VariableValue,
  VoiceCommand,
  WaitCommand,
} from '@sylvie/types';
import { parse as parseYaml } from 'yaml';

import { validateExpression } from './expression';
import { validateInterpolation } from './interpolate';

export type Warn = (message: string) => void;

export class ScriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScriptError';
  }
}

export interface LoadedGame {
  manifest: GameManifest;
  /** 所有场景（包含仅被 import 的场景），键为场景名。 */
  scenes: Map<string, CompiledScene>;
}

interface RawSceneDocument {
  name: string;
  imports: string[];
  commands: unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asVariableValue(value: unknown): VariableValue | null {
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function parseTransition(value: unknown, fallback: Transition): Transition {
  return value === 'fade' || value === 'none' ? value : fallback;
}

function parseSpritePosition(
  value: unknown,
  block: string,
  index: number,
  warn: Warn,
): SpritePosition {
  if (value === undefined) return 'center';
  if (value === 'left' || value === 'center' || value === 'right') return value;
  const numeric = asFiniteNumber(value);
  if (numeric !== null) {
    return Math.min(100, Math.max(0, numeric));
  }
  warn(
    `[脚本] ${block} 第 ${index + 1} 条 sprite：position 应为 left/center/right 或 0-100 的数字`,
  );
  return 'center';
}

function yamlParse(source: string, label: string, warn: Warn): unknown {
  try {
    return parseYaml(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(`[脚本] ${label} YAML 解析失败：${message}`);
    throw new ScriptError(`${label} YAML 解析失败：${message}`);
  }
}

export function parseManifest(source: string, warn: Warn): GameManifest {
  const raw = yamlParse(source, 'scripts/game.yaml', warn);
  if (!isRecord(raw)) {
    throw new ScriptError('scripts/game.yaml 顶层必须是映射');
  }

  const title = asString(raw.title) ?? 'Sylvie Galgame';
  const version = asString(raw.version) ?? '0.1.0';
  const start = asString(raw.start);
  if (!start) {
    throw new ScriptError('scripts/game.yaml 缺少必填字段 start');
  }

  let scenes: string[] = [];
  if (Array.isArray(raw.scenes)) {
    for (const item of raw.scenes) {
      const name = asString(item);
      if (!name) {
        warn('[脚本] game.yaml scenes 中存在非字符串项，已忽略');
        continue;
      }
      if (!scenes.includes(name)) scenes.push(name);
    }
  }
  if (scenes.length === 0) {
    scenes = [start];
  }
  if (!scenes.includes(start)) {
    warn(`[脚本] start 场景 "${start}" 不在 scenes 列表中，已自动加入`);
    scenes.unshift(start);
  }

  const variables: Record<string, VariableValue> = {};
  if (raw.variables !== undefined) {
    if (!isRecord(raw.variables)) {
      warn('[脚本] game.yaml variables 必须是映射，已忽略');
    } else {
      for (const [name, value] of Object.entries(raw.variables)) {
        const parsed = asVariableValue(value);
        if (parsed === null) {
          warn(`[脚本] 变量 "${name}" 初始值必须是数字/布尔/字符串，已忽略`);
          continue;
        }
        variables[name] = parsed;
      }
    }
  }

  return { title, version, start, scenes, variables };
}

function parseSceneDocument(name: string, source: string, warn: Warn): RawSceneDocument {
  const raw = yamlParse(source, `场景 ${name}`, warn);
  if (!isRecord(raw)) {
    throw new ScriptError(`场景 ${name} 顶层必须是映射`);
  }

  const rawImports = raw.imports ?? raw.import;
  const imports: string[] = [];
  if (typeof rawImports === 'string') {
    imports.push(rawImports);
  } else if (Array.isArray(rawImports)) {
    for (const item of rawImports) {
      const parsed = asString(item);
      if (parsed) {
        imports.push(parsed);
      } else {
        warn(`[脚本] 场景 ${name} 的 imports 中存在非字符串项，已忽略`);
      }
    }
  } else if (rawImports !== undefined) {
    warn(`[脚本] 场景 ${name}：imports 应为字符串或字符串数组`);
  }

  if (!Array.isArray(raw.commands)) {
    throw new ScriptError(`场景 ${name} 缺少 commands 数组`);
  }

  return { name, imports, commands: raw.commands };
}

function parseBg(payload: unknown, block: string, index: number, warn: Warn): BgCommand {
  let image: string | null = null;
  let transition: Transition = 'fade';
  let duration = 600;

  if (typeof payload === 'string') {
    image = payload;
  } else if (payload === null || payload === undefined) {
    transition = 'none';
    duration = 0;
  } else if (isRecord(payload)) {
    if (asBoolean(payload.hide) === true) {
      image = null;
    } else if (payload.image === null) {
      image = null;
    } else {
      const parsed = asString(payload.image);
      if (parsed) {
        image = parsed;
      } else {
        warn(`[脚本] ${block} 第 ${index + 1} 条 bg：缺少 image`);
      }
    }
    transition = parseTransition(payload.transition, image === null ? 'none' : 'fade');
    const parsedDuration = asFiniteNumber(payload.duration);
    if (parsedDuration !== null && parsedDuration >= 0) {
      duration = parsedDuration;
    }
    if (image === null) duration = 0;
  } else {
    warn(`[脚本] ${block} 第 ${index + 1} 条 bg：参数应为路径或映射`);
  }

  return { kind: 'bg', image, transition, duration };
}

function parseSprite(
  payload: unknown,
  block: string,
  index: number,
  warn: Warn,
): SpriteCommand | null {
  if (!isRecord(payload)) {
    warn(`[脚本] ${block} 第 ${index + 1} 条 sprite：参数必须是映射，例如 { id, image }`);
    return null;
  }
  const id = asString(payload.id);
  if (!id) {
    warn(`[脚本] ${block} 第 ${index + 1} 条 sprite：缺少 id`);
    return null;
  }

  let image: string | null = null;
  if (asBoolean(payload.hide) !== true) {
    image = asString(payload.image);
    if (!image && payload.image !== null) {
      warn(`[脚本] ${block} 第 ${index + 1} 条 sprite "${id}"：缺少 image，按隐藏处理`);
    }
  }

  const opacityRaw = asFiniteNumber(payload.opacity);
  const opacity = opacityRaw === null ? (image ? 1 : 0) : Math.min(1, Math.max(0, opacityRaw));

  return {
    kind: 'sprite',
    id,
    image,
    position: parseSpritePosition(payload.position, block, index, warn),
    opacity,
    transition: parseTransition(payload.transition, 'fade'),
    duration: Math.max(0, asFiniteNumber(payload.duration) ?? 600),
  };
}

function parseCg(payload: unknown, block: string, index: number, warn: Warn): CgCommand {
  if (typeof payload === 'string') {
    if (payload === 'hide' || payload === 'none') {
      return { kind: 'cg', image: null, visible: false, transition: 'fade', duration: 600 };
    }
    return { kind: 'cg', image: payload, visible: true, transition: 'fade', duration: 600 };
  }

  if (isRecord(payload)) {
    const image = asString(payload.image);
    const explicitVisibility = asBoolean(payload.visible);
    const visible = explicitVisibility ?? image !== null;
    return {
      kind: 'cg',
      image,
      visible,
      transition: parseTransition(payload.transition, 'fade'),
      duration: Math.max(0, asFiniteNumber(payload.duration) ?? 600),
    };
  }

  warn(`[脚本] ${block} 第 ${index + 1} 条 cg：参数应为路径、hide 或映射`);
  return { kind: 'cg', image: null, visible: false, transition: 'fade', duration: 600 };
}

function parseText(payload: unknown, block: string, index: number, warn: Warn): TextCommand | null {
  let text: string | null = null;
  let speaker: string | null = null;
  let voice: string | null = null;
  let explicitId: string | null = null;

  if (typeof payload === 'string') {
    text = payload;
  } else if (isRecord(payload)) {
    text = asString(payload.text);
    if (text === null) {
      warn(`[脚本] ${block} 第 ${index + 1} 条 text：缺少 text 字段`);
      return null;
    }
    speaker = asString(payload.speaker) ?? asString(payload.name);
    voice = asString(payload.voice);
    explicitId = asString(payload.id);
  } else {
    warn(`[脚本] ${block} 第 ${index + 1} 条 text：参数应为字符串或 { speaker, text } 映射`);
    return null;
  }

  const interpolationError = validateInterpolation(text);
  if (interpolationError) {
    warn(`[脚本] ${block} 第 ${index + 1} 条 text：${interpolationError}`);
  }

  return { kind: 'text', id: explicitId ?? '', speaker, text, voice };
}

function parseBgm(payload: unknown, block: string, index: number, warn: Warn): BgmCommand {
  if (typeof payload === 'string') {
    const isStop = payload === 'stop' || payload === 'none' || payload === '';
    return {
      kind: 'bgm',
      track: isStop ? null : payload,
      fade: 500,
      loop: true,
    };
  }
  if (isRecord(payload)) {
    const trackRaw = asString(payload.track) ?? asString(payload.name);
    const track = trackRaw === 'stop' || trackRaw === 'none' || trackRaw === '' ? null : trackRaw;
    return {
      kind: 'bgm',
      track,
      fade: Math.max(0, asFiniteNumber(payload.fade) ?? 500),
      loop: asBoolean(payload.loop) ?? true,
    };
  }
  warn(`[脚本] ${block} 第 ${index + 1} 条 bgm：参数应为路径、stop 或映射`);
  return { kind: 'bgm', track: null, fade: 500, loop: true };
}

function parseSe(payload: unknown, block: string, index: number, warn: Warn): SeCommand | null {
  if (typeof payload === 'string') {
    return { kind: 'se', sound: payload, volume: 1 };
  }
  if (isRecord(payload)) {
    const sound = asString(payload.sound) ?? asString(payload.name);
    if (!sound) {
      warn(`[脚本] ${block} 第 ${index + 1} 条 se：缺少 sound`);
      return null;
    }
    return {
      kind: 'se',
      sound,
      volume: Math.min(1, Math.max(0, asFiniteNumber(payload.volume) ?? 1)),
    };
  }
  warn(`[脚本] ${block} 第 ${index + 1} 条 se：参数应为路径或 { sound } 映射`);
  return null;
}

function parseVoice(
  payload: unknown,
  block: string,
  index: number,
  warn: Warn,
): VoiceCommand | null {
  if (typeof payload === 'string') {
    return { kind: 'voice', sound: payload };
  }
  if (isRecord(payload)) {
    const sound = asString(payload.sound) ?? asString(payload.name);
    if (sound) {
      return { kind: 'voice', sound };
    }
  }
  warn(`[脚本] ${block} 第 ${index + 1} 条 voice：缺少 sound`);
  return null;
}

function parseChoice(
  payload: unknown,
  block: string,
  index: number,
  warn: Warn,
): ChoiceCommand | null {
  if (!isRecord(payload) || !Array.isArray(payload.options)) {
    warn(`[脚本] ${block} 第 ${index + 1} 条 choice：缺少 options 数组`);
    return null;
  }

  const options: ChoiceCommand['options'] = [];
  payload.options.forEach((option, optionIndex) => {
    if (!isRecord(option)) {
      warn(`[脚本] ${block} 第 ${index + 1} 条 choice 选项 ${optionIndex + 1}：必须是映射`);
      return;
    }
    const text = asString(option.text);
    const target = asString(option.jump) ?? asString(option.target);
    if (!text || !target) {
      warn(
        `[脚本] ${block} 第 ${index + 1} 条 choice 选项 ${optionIndex + 1}：text 与 jump 均必填`,
      );
      return;
    }
    const condition = asString(option.if) ?? asString(option.condition);
    if (condition) {
      const error = validateExpression(condition);
      if (error) {
        warn(
          `[脚本] ${block} 第 ${index + 1} 条 choice 选项 ${optionIndex + 1} 条件无效：${error}`,
        );
      }
    }

    const actions: SetCommand[] = [];
    const rawActions = option.set ?? option.actions;
    const context = `${block} 第 ${index + 1} 条 choice 选项 ${optionIndex + 1}`;
    if (rawActions !== undefined) {
      const entries = Array.isArray(rawActions) ? rawActions : [rawActions];
      for (const entry of entries) {
        const action = parseSetPayload(entry, context, warn);
        if (action) actions.push(action);
      }
    }

    options.push({ text, target, condition, actions });
  });

  if (options.length === 0) {
    warn(`[脚本] ${block} 第 ${index + 1} 条 choice：没有任何有效选项`);
  }

  return {
    kind: 'choice',
    prompt: asString(payload.prompt) ?? asString(payload.title),
    options,
  };
}

function parseSetPayload(payload: unknown, context: string, warn: Warn): SetCommand | null {
  if (!isRecord(payload)) {
    warn(`[脚本] ${context}：参数必须是 { var, op, value } 或 { var, op, expr } 映射`);
    return null;
  }
  const variable = asString(payload.var);
  if (!variable) {
    warn(`[脚本] ${context}：缺少 var`);
    return null;
  }

  const opRaw = payload.op;
  const op = opRaw === '+=' || opRaw === '-=' || opRaw === '=' ? opRaw : '=';
  if (opRaw !== undefined && op !== opRaw) {
    warn(`[脚本] ${context}：op 只能是 = / += / -=，已按 = 处理`);
  }

  const expr = asString(payload.expr);
  if (expr !== null) {
    if (payload.value !== undefined) {
      warn(`[脚本] ${context}：expr 与 value 同时存在，已忽略 value`);
    }
    const error = validateExpression(expr);
    if (error) {
      warn(`[脚本] ${context} 表达式无效：${error}`);
    }
    return { kind: 'set', variable, op, value: null, expr };
  }

  const value = asVariableValue(payload.value);
  if (value === null) {
    warn(`[脚本] ${context}：value 必须是数字/布尔/字符串`);
    return null;
  }
  if (op !== '=' && typeof value !== 'number') {
    warn(`[脚本] ${context}："${variable}" 使用 ${op} 时 value 必须为数字`);
    return null;
  }
  return { kind: 'set', variable, op, value, expr: null };
}

function parseSet(payload: unknown, block: string, index: number, warn: Warn): SetCommand | null {
  return parseSetPayload(payload, `${block} 第 ${index + 1} 条 set`, warn);
}

function parseIf(payload: unknown, block: string, index: number, warn: Warn): IfCommand | null {
  if (!isRecord(payload)) {
    warn(`[脚本] ${block} 第 ${index + 1} 条 if：参数必须是 { condition, then, else } 映射`);
    return null;
  }
  const condition = asString(payload.condition);
  const then = asString(payload.then) ?? asString(payload.jump);
  if (!condition || !then) {
    warn(`[脚本] ${block} 第 ${index + 1} 条 if：condition 与 then 均必填`);
    return null;
  }
  const error = validateExpression(condition);
  if (error) {
    warn(`[脚本] ${block} 第 ${index + 1} 条 if 条件无效：${error}`);
  }
  return {
    kind: 'if',
    condition,
    then,
    else: asString(payload.else) ?? null,
  };
}

function parseWait(payload: unknown, block: string, index: number, warn: Warn): WaitCommand {
  if (typeof payload === 'number' && Number.isFinite(payload)) {
    return { kind: 'wait', duration: Math.max(0, payload) };
  }
  if (isRecord(payload)) {
    const duration = asFiniteNumber(payload.duration);
    if (duration !== null) {
      return { kind: 'wait', duration: Math.max(0, duration) };
    }
  }
  warn(`[脚本] ${block} 第 ${index + 1} 条 wait：参数应为毫秒数字`);
  return { kind: 'wait', duration: 0 };
}

function parseCommand(raw: unknown, block: string, index: number, warn: Warn): Command | null {
  if (!isRecord(raw)) {
    warn(`[脚本] ${block} 第 ${index + 1} 条指令必须是映射`);
    return null;
  }
  const keys = Object.keys(raw);
  if (keys.length !== 1) {
    warn(`[脚本] ${block} 第 ${index + 1} 条指令应只包含一个指令名，实际：${keys.join(', ')}`);
    return null;
  }
  const kind = keys[0] ?? '';
  const payload = raw[kind];

  switch (kind) {
    case 'bg':
      return parseBg(payload, block, index, warn);
    case 'sprite':
      return parseSprite(payload, block, index, warn);
    case 'cg':
      return parseCg(payload, block, index, warn);
    case 'text':
      return parseText(payload, block, index, warn);
    case 'bgm':
      return parseBgm(payload, block, index, warn);
    case 'se':
      return parseSe(payload, block, index, warn);
    case 'voice':
      return parseVoice(payload, block, index, warn);
    case 'label': {
      const name = typeof payload === 'string' ? payload : null;
      if (!name) {
        warn(`[脚本] ${block} 第 ${index + 1} 条 label：缺少名称`);
        return null;
      }
      const command: LabelCommand = { kind: 'label', name };
      return command;
    }
    case 'jump': {
      const target = typeof payload === 'string' ? payload : null;
      if (!target) {
        warn(`[脚本] ${block} 第 ${index + 1} 条 jump：缺少目标`);
        return null;
      }
      const command: JumpCommand = { kind: 'jump', target };
      return command;
    }
    case 'choice':
      return parseChoice(payload, block, index, warn);
    case 'set':
      return parseSet(payload, block, index, warn);
    case 'if':
      return parseIf(payload, block, index, warn);
    case 'wait':
      return parseWait(payload, block, index, warn);
    case 'import':
      warn(`[脚本] ${block} 第 ${index + 1} 条 import：请写在场景文件顶部的 imports 字段`);
      return null;
    default:
      warn(`[脚本] ${block} 第 ${index + 1} 条未知指令 "${kind}"`);
      return null;
  }
}

/** FNV-1a 32 位哈希，用于生成与行号无关的稳定文本 id。 */
function hashTextId(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function compileBlock(blockId: string, rawCommands: unknown[], warn: Warn): CompiledBlock {
  const commands: Command[] = [];
  const seenIds = new Map<string, number>();
  rawCommands.forEach((raw, index) => {
    const command = parseCommand(raw, blockId, index, warn);
    if (!command) return;
    if (command.kind === 'text' && !command.id) {
      const base = `${blockId}@${hashTextId(
        `${command.speaker ?? ''}\u0000${command.text}\u0000${command.voice ?? ''}`,
      )}`;
      const count = (seenIds.get(base) ?? 0) + 1;
      seenIds.set(base, count);
      command.id = count === 1 ? base : `${base}~${count}`;
    }
    commands.push(command);
  });
  return { id: blockId, commands };
}

function collectAssets(block: CompiledBlock, target: Set<string>): void {
  for (const command of block.commands) {
    switch (command.kind) {
      case 'bg':
      case 'cg':
        if (command.image) target.add(command.image);
        break;
      case 'sprite':
        if (command.image) target.add(command.image);
        break;
      case 'bgm':
        if (command.track) target.add(command.track);
        break;
      case 'se':
        target.add(command.sound);
        break;
      case 'voice':
        target.add(command.sound);
        break;
      case 'text':
        if (command.voice) target.add(command.voice);
        break;
      default:
        break;
    }
  }
}

function validateTarget(
  target: string,
  currentScene: CompiledScene,
  scenes: ReadonlyMap<string, CompiledScene>,
  warn: Warn,
  context: string,
): void {
  const hash = target.indexOf('#');
  if (hash >= 0) {
    const sceneName = target.slice(0, hash).trim();
    const labelName = target.slice(hash + 1).trim();
    if (!sceneName || !labelName) {
      warn(`[脚本] ${context}：「${target}」格式应为 scene#label`);
      return;
    }
    const targetScene = scenes.get(sceneName);
    if (!targetScene) {
      warn(`[脚本] ${context}：目标场景 "${sceneName}" 不存在`);
      return;
    }
    if (!targetScene.labels[labelName]) {
      warn(`[脚本] ${context}：场景 "${sceneName}" 找不到 label "${labelName}"`);
    }
    return;
  }

  if (!currentScene.labels[target]) {
    warn(`[脚本] ${context}：找不到 label "${target}"`);
  }
}

export async function loadGame(assets: AssetHost, warn: Warn): Promise<LoadedGame> {
  const manifestText = await assets.readText('scripts/game.yaml');
  const manifest = parseManifest(manifestText, warn);

  const documents = new Map<string, RawSceneDocument>();
  const pending = new Set<string>();

  const ensureScene = async (name: string): Promise<void> => {
    if (documents.has(name)) return;
    if (pending.has(name)) {
      warn(`[脚本] 检测到 import 循环：${name}`);
      return;
    }
    pending.add(name);
    try {
      const source = await assets.readText(`scripts/scenes/${name}.yaml`);
      const document = parseSceneDocument(name, source, warn);
      documents.set(name, document);
      for (const imported of document.imports) {
        await ensureScene(imported);
      }
    } finally {
      pending.delete(name);
    }
  };

  for (const scene of manifest.scenes) {
    await ensureScene(scene);
  }
  await ensureScene(manifest.start);

  const compiledBlocks = new Map<string, CompiledBlock>();
  for (const [name, document] of documents) {
    compiledBlocks.set(name, compileBlock(name, document.commands, warn));
  }

  const closureOf = (name: string): string[] => {
    const result: string[] = [];
    const visited = new Set<string>();
    const visit = (current: string): void => {
      if (visited.has(current)) return;
      visited.add(current);
      result.push(current);
      const document = documents.get(current);
      for (const imported of document?.imports ?? []) {
        visit(imported);
      }
    };
    visit(name);
    return result;
  };

  const scenes = new Map<string, CompiledScene>();

  // 第一遍：为每个场景建立块闭包、label 表与资源清单。
  for (const [name] of documents) {
    const blocks: Record<string, CompiledBlock> = {};
    const labels: Record<string, { block: string; index: number }> = {};
    const assets = new Set<string>();

    for (const blockName of closureOf(name)) {
      const block = compiledBlocks.get(blockName);
      if (!block) continue;
      blocks[blockName] = block;
      collectAssets(block, assets);

      block.commands.forEach((command, index) => {
        if (command.kind !== 'label') return;
        const existing = labels[command.name];
        if (existing) {
          warn(
            `[脚本] 场景 ${name}：label "${command.name}" 重复（${existing.block}#${existing.index} 与 ${blockName}#${index}），保留首次定义`,
          );
          return;
        }
        labels[command.name] = { block: blockName, index };
      });
    }

    scenes.set(name, {
      name,
      entryBlock: name,
      blocks,
      labels,
      assets: [...assets],
    });
  }

  // 第二遍：所有场景的 label 表就绪后，再校验跳转目标（支持跨场景）。
  for (const [name, scene] of scenes) {
    for (const blockName of Object.keys(scene.blocks)) {
      const block = scene.blocks[blockName];
      if (!block) continue;
      block.commands.forEach((command, index) => {
        const context = `场景 ${name} / ${blockName} 第 ${index + 1} 条 ${command.kind}`;
        if (command.kind === 'jump') {
          validateTarget(command.target, scene, scenes, warn, context);
        } else if (command.kind === 'if') {
          validateTarget(command.then, scene, scenes, warn, context);
          if (command.else) {
            validateTarget(command.else, scene, scenes, warn, context);
          }
        } else if (command.kind === 'choice') {
          for (const option of command.options) {
            validateTarget(option.target, scene, scenes, warn, context);
          }
        }
      });
    }
  }

  if (!scenes.has(manifest.start)) {
    throw new ScriptError(`start 场景 "${manifest.start}" 未能加载`);
  }

  return { manifest, scenes };
}
