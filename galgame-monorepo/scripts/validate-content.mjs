#!/usr/bin/env node
/**
 * 内容包校验：
 * 1. 用 docs/script.schema.json 校验清单与每个场景；
 * 2. 用真实内容目录初始化引擎，检查版本一致性；
 * 3. 内容体检：未引用资源、不可达场景、资源体积 / 扩展名 / 命名；
 * 4. 用两条策略各跑一条分支到结局，确认关键台词出现。
 * 诊断输出按错误 / 警告分组；只要存在任意一条，就以非零退出码结束。
 */
import { access, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv from 'ajv';
import { parse as parseYaml } from 'yaml';

import { GameEngine, loadGame } from '../packages/engine-core/dist/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const GAME_ROOT = path.join(ROOT, 'packages/game-content/game');

// 诊断桶：错误阻断退出，警告只打印；引擎的脚本警告也汇入 warnings。
const errors = [];
const warnings = [];

// 最小 AssetHost 实现：直接读真实内容目录，不需要打包或协议层。
const assets = {
  readText: (relativePath) => readFile(path.join(GAME_ROOT, relativePath), 'utf8'),
  exists: async (relativePath) => {
    try {
      await access(path.join(GAME_ROOT, relativePath));
      return true;
    } catch {
      return false;
    }
  },
};

/** 内存存储：校验过程会触发自动存档，但不应写入真实存档文件。 */
function createMemoryStorage() {
  const map = new Map();
  return {
    get: async (key) => map.get(key) ?? null,
    set: async (key, value) => {
      map.set(key, value);
    },
    delete: async (key) => {
      map.delete(key);
    },
  };
}

// 支持的资源类型与建议体积上限；超出体积只告警，因为体积是否合理取决于发布目标。
const IMAGE_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif']);
const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.ogg', '.m4a', '.flac']);
const MAX_IMAGE_BYTES = 1_500_000;
const MAX_AUDIO_BYTES = 8_000_000;
// 路径只允许小写字母、数字、下划线、点、斜杠与连字符，避免 URL 编码 / 大小写差异带来的问题。
const SAFE_ASSET_PATH = /^[a-z0-9_./-]+$/;

/**
 * 对清单与全部场景执行 JSON Schema 校验。
 * 失败时只保留最深层的错误（跳过 oneOf 产生的泛化信息），最多展示 4 条，便于定位。
 */
async function validateSchemaFiles() {
  const schema = JSON.parse(await readFile(path.join(ROOT, 'docs/script.schema.json'), 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const root = { $schema: schema.$schema, definitions: schema.definitions };
  const validateManifest = ajv.compile({ ...root, $ref: '#/definitions/manifest' });
  const validateScene = ajv.compile({ ...root, $ref: '#/definitions/scene' });
  const scenes = (await readdir(path.join(GAME_ROOT, 'scripts/scenes')))
    .filter((file) => file.endsWith('.yaml'))
    .sort()
    .map((file) => `scripts/scenes/${file}`);
  const files = ['scripts/game.yaml', ...scenes];

  for (const file of files) {
    const data = parseYaml(await readFile(path.join(GAME_ROOT, file), 'utf8'));
    const validate = file === 'scripts/game.yaml' ? validateManifest : validateScene;
    if (validate(data)) continue;
    const schemaErrors = validate.errors ?? [];
    const depthOf = (error) => error.instancePath.split('/').length;
    const maxDepth = Math.max(0, ...schemaErrors.map(depthOf));
    const deepest = schemaErrors.filter(
      (error) => depthOf(error) === maxDepth && error.keyword !== 'oneOf',
    );
    const details = (deepest.length > 0 ? deepest : schemaErrors)
      .slice(0, 4)
      .map((error) => `${error.instancePath || '/'} ${error.message}`);
    // 注意：这里必须写入模块级 errors，Schema 失败才会让 pnpm validate 以非零码退出。
    errors.push(`[Schema] ${file}：${details.join('；') || '不符合 script.schema.json'}`);
  }
}

/** 递归列出目录下的文件（相对 GAME_ROOT、使用 / 分隔）；目录不存在返回空数组。 */
async function walk(relativeDir) {
  const absolute = path.join(GAME_ROOT, relativeDir);
  let entries;
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const relative = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await walk(relative)));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
}

/** 从 `scene#label` 形式的跳转目标中取出场景名；没有 # 返回 null。 */
function targetScene(target) {
  if (typeof target !== 'string') return null;
  const hash = target.indexOf('#');
  return hash > 0 ? target.slice(0, hash).trim() : null;
}

/**
 * 内容体检：
 * - 汇总场景引用、标题画面与画廊资源，找出磁盘上未被引用的文件；
 * - 从 manifest.start 出发沿 jump / if / choice 收集可达场景；
 * - 检查资源扩展名、路径命名与体积，输出引用率与语音覆盖率。
 * 直接复用 loadGame 的解析结果，避免自己再解析一遍 YAML。
 */
async function inspectContent(manifest) {
  const loaded = await loadGame(assets, () => {});
  const referenced = new Set();
  const uniqueBlocks = new Set();
  const incomingScenes = new Set([manifest.start]);
  let textCount = 0;
  let voiceCount = 0;

  for (const scene of loaded.scenes.values()) {
    for (const asset of scene.assets) referenced.add(asset);
    for (const block of Object.values(scene.blocks)) {
      if (uniqueBlocks.has(block)) continue;
      uniqueBlocks.add(block);
      for (const command of block.commands) {
        if (command.kind === 'text') {
          textCount += 1;
          if (command.voice) voiceCount += 1;
        }
        if (command.kind === 'jump') {
          const target = targetScene(command.target);
          if (target) incomingScenes.add(target);
        } else if (command.kind === 'if') {
          for (const value of [command.then, command.else]) {
            const target = targetScene(value);
            if (target) incomingScenes.add(target);
          }
        } else if (command.kind === 'choice') {
          for (const option of command.options) {
            const target = targetScene(option.target);
            if (target) incomingScenes.add(target);
          }
        }
      }
    }
  }

  for (const asset of [
    manifest.titleScreen.background,
    manifest.titleScreen.bgm,
    ...manifest.gallery.cgs.map((entry) => entry.image),
    ...manifest.gallery.bgms.map((entry) => entry.track),
  ]) {
    if (asset) referenced.add(asset);
  }

  const files = [...(await walk('images')), ...(await walk('audio'))];
  const unreferenced = files.filter((file) => !referenced.has(file));
  const unreachable = manifest.scenes.filter((scene) => !incomingScenes.has(scene));

  const sizeWarnings = [];
  for (const file of files) {
    const info = await stat(path.join(GAME_ROOT, file));
    const extension = path.extname(file).toLowerCase();
    if (extension && !IMAGE_EXTENSIONS.has(extension) && !AUDIO_EXTENSIONS.has(extension)) {
      warnings.push(`[内容体检] ${file}：不支持的资源扩展名 ${extension}`);
    }
    if (!SAFE_ASSET_PATH.test(file)) {
      warnings.push(`[内容体检] ${file}：资源路径建议只用小写字母、数字、下划线与连字符`);
    }
    const limit = IMAGE_EXTENSIONS.has(extension) ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
    if (info.size > limit) {
      sizeWarnings.push(`${file}（${(info.size / 1024 / 1024).toFixed(1)} MB）`);
    }
  }

  if (unreferenced.length > 0) {
    warnings.push(`[内容体检] 未被引用的资源：\n  ${unreferenced.join('\n  ')}`);
  }
  if (unreachable.length > 0) {
    warnings.push(`[内容体检] 无法从 start 场景抵达的场景：${unreachable.join('、')}`);
  }
  if (sizeWarnings.length > 0) {
    warnings.push(`[内容体检] 体积超过建议上限的资源：\n  ${sizeWarnings.join('\n  ')}`);
  }

  console.log('\n内容体检：');
  console.log(`- 资源文件 ${files.length} 个，被引用 ${files.length - unreferenced.length} 个`);
  console.log(`- 场景 ${manifest.scenes.length} 个，可达 ${manifest.scenes.length - unreachable.length} 个`);
  console.log(`- 语音覆盖 ${voiceCount}/${textCount} 条文本`);
}

/**
 * 用给定策略把剧本跑到结局，返回全部台词。
 * strategy 接收当前快照并返回要选择的选项；guard 上限用于识别死循环。
 */
async function play(engine, strategy) {
  const lines = [];
  engine.start();
  let guard = 0;

  while (guard < 10_000) {
    guard += 1;
    const snapshot = engine.getSnapshot();
    if (snapshot.phase === 'end' || snapshot.phase === 'ended') break;
    if (snapshot.phase === 'text') {
      if (snapshot.dialogue) lines.push(snapshot.dialogue.text);
      engine.advance();
      continue;
    }
    if (snapshot.phase === 'choice') {
      const choice = snapshot.choice;
      if (!choice || choice.options.length === 0) {
        throw new Error('遇到没有可见选项的 choice');
      }
      const option = strategy(snapshot);
      engine.choose(option);
      continue;
    }
    if (snapshot.phase === 'wait') {
      engine.resumeWait();
      continue;
    }
    throw new Error(`未预期的阻塞状态：${snapshot.phase}`);
  }

  if (guard >= 10_000) throw new Error('剧本可能存在死循环');
  return lines;
}

/** 从可见选项中按文本关键词依次匹配，找不到时回退到第一项。 */
function pickChoice(snapshot, ...keywords) {
  const options = snapshot.choice?.options ?? [];
  for (const keyword of keywords) {
    const found = options.find((option) => option.text.includes(keyword));
    if (found) return found.optionIndex;
  }
  return options[0]?.optionIndex ?? 0;
}

/** 校验入口：Schema → 引擎初始化 → 版本一致性 → 内容体检 → 全部结局分支 → 汇总诊断。 */
async function main() {
  await validateSchemaFiles();

  const engine = new GameEngine({
    host: {
      assets,
      storage: createMemoryStorage(),
      onWarning: (message) => warnings.push(message),
    },
  });

  const manifest = await engine.initialize();
  const appVersion = JSON.parse(
    await readFile(path.join(ROOT, 'package.json'), 'utf8'),
  ).version;
  if (manifest.version !== appVersion) {
    errors.push(
      `game.yaml version "${manifest.version}" 与 package.json "${appVersion}" 不一致；执行 pnpm version:set <版本> 统一版本号`,
    );
  }
  console.log(`标题：${manifest.title}  v${manifest.version}`);
  console.log(`起始场景：${manifest.start}`);
  console.log(`场景：${manifest.scenes.join('、')}`);

  await inspectContent(manifest);

  const bookLines = await play(engine, (snapshot) => pickChoice(snapshot, '十元', '哼'));
  if (!bookLines.some((line) => line.includes('抽屉最里面'))) {
    throw new Error('硬币分支未到达「找零」结局');
  }

  const smileLines = await play(engine, (snapshot) => pickChoice(snapshot, '热咖啡', '两罐'));
  if (!smileLines.some((line) => line.includes('沿着河边'))) {
    throw new Error('咖啡分支未到达「末班车」结局');
  }

  const silenceLines = await play(engine, (snapshot) => pickChoice(snapshot, '说没有', '两罐'));
  if (!silenceLines.some((line) => line.includes('我故意放在那里的'))) {
    throw new Error('沉默分支未经过还本子的剧情');
  }

  const echoLines = await play(engine, (snapshot) => pickChoice(snapshot, '十元', '明年'));
  if (!echoLines.some((line) => line.includes('终于有人听见'))) {
    throw new Error('硬币分支未到达「回声之外」结局');
  }

  console.log(`硬币分支：${bookLines.length} 句，到达「找零」结局`);
  console.log(`咖啡分支：${smileLines.length} 句，到达「末班车」结局`);
  console.log(`沉默分支：${silenceLines.length} 句，到达「末班车」结局`);
  console.log(`约定分支：${echoLines.length} 句，到达「回声之外」结局`);

  if (printDiagnostics() > 0) {
    process.exitCode = 1;
    return;
  }

  console.log('\n内容校验通过，无错误或警告。');
}

/** 按错误 / 警告分组输出诊断，返回条数。 */
function printDiagnostics() {
  if (errors.length > 0) {
    console.error(`\n发现 ${errors.length} 条错误（阻断）：`);
    for (const error of errors) console.error(`  - [错误] ${error}`);
  }
  if (warnings.length > 0) {
    console.error(`\n发现 ${warnings.length} 条警告（可继续）：`);
    for (const warning of warnings) console.error(`  - [警告] ${warning}`);
  }
  return errors.length + warnings.length;
}

main().catch((error) => {
  printDiagnostics();
  console.error(`\n[错误] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
