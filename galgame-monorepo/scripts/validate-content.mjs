#!/usr/bin/env node
/** 校验内容包：解析全部场景、检查资源存在性，并跑通两条分支到结局。 */
import { access, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv from 'ajv';
import { parse as parseYaml } from 'yaml';

import { GameEngine, loadGame } from '../packages/engine-core/dist/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const GAME_ROOT = path.join(ROOT, 'packages/game-content/game');

const errors = [];
const warnings = [];

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

const IMAGE_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif']);
const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.ogg', '.m4a', '.flac']);
const MAX_IMAGE_BYTES = 1_500_000;
const MAX_AUDIO_BYTES = 8_000_000;
const SAFE_ASSET_PATH = /^[a-z0-9_./-]+$/;

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
    const errors = validate.errors ?? [];
    const depthOf = (error) => error.instancePath.split('/').length;
    const maxDepth = Math.max(0, ...errors.map(depthOf));
    const deepest = errors.filter(
      (error) => depthOf(error) === maxDepth && error.keyword !== 'oneOf',
    );
    const details = (deepest.length > 0 ? deepest : errors)
      .slice(0, 4)
      .map((error) => `${error.instancePath || '/'} ${error.message}`);
    errors.push(`[Schema] ${file}：${details.join('；') || '不符合 script.schema.json'}`);
  }
}

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

function targetScene(target) {
  if (typeof target !== 'string') return null;
  const hash = target.indexOf('#');
  return hash > 0 ? target.slice(0, hash).trim() : null;
}

/** 内容体检：未引用资源、不可达场景、资源体积与命名。 */
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
  console.log(`标题：${manifest.title}  v${manifest.version}`);
  console.log(`起始场景：${manifest.start}`);
  console.log(`场景：${manifest.scenes.join('、')}`);

  await inspectContent(manifest);

  const bookLines = await play(engine, (snapshot) => snapshot.choice?.options[0]?.optionIndex ?? 0);
  if (!bookLines.some((line) => line.includes('休止符'))) {
    throw new Error('书页分支未到达旋律结局');
  }

  // 选择最后一个可见选项；choose() 接收的是原始选项下标（view.optionIndex）。
  const smileLines = await play(engine, (snapshot) => {
    const options = snapshot.choice?.options ?? [];
    return options[options.length - 1]?.optionIndex ?? 0;
  });
  if (!smileLines.some((line) => line.includes('普通的黄昏'))) {
    throw new Error('热茶分支未到达安静结局');
  }

  console.log(`书页分支：${bookLines.length} 句，到达旋律结局`);
  console.log(`热茶分支：${smileLines.length} 句，到达安静结局`);

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
