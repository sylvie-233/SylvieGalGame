#!/usr/bin/env node
/**
 * 统一版本号：
 *   node scripts/sync-version.mjs             检查 package.json / manifest 是否一致
 *   node scripts/sync-version.mjs --set 0.2.0 写入全部位置
 *   node scripts/sync-version.mjs --expect v0.1.0  校验是否等于期望版本（发布流水线用）
 *
 * 版本源以根 package.json 为准，同步到全部 workspace 包与 game.yaml。
 * 检查模式不一致时以非零退出码结束；--set 只改文件，不创建 tag。
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 需要保持一致的版本位置：根 / 桌面 / Web / 全部共享包，以及内容清单 game.yaml。
// 私有 workspace 包也纳入检查，避免发布时残留旧版本号。
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const MANIFEST = path.join(ROOT, 'packages/game-content/game/scripts/game.yaml');
const PACKAGE_FILES = [
  'package.json',
  'apps/electron/package.json',
  'apps/web/package.json',
  'packages/game-content/package.json',
  'packages/engine-core/package.json',
  'packages/minigames/package.json',
  'packages/player/package.json',
  'packages/types/package.json',
  'packages/eslint-config/package.json',
  'packages/tsconfig/package.json',
];
// 语义化版本，允许预发布后缀（如 1.0.0-beta.1）。
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
// game.yaml 顶层的 version 行；替换时只动这一行，保留其它内容与格式。
const MANIFEST_LINE = /^version:\s*(.+)$/m;

/** 读取某个 package.json 的 version，返回文件相对路径便于报错。 */
async function readVersionFromPackage(relativePath) {
  const data = JSON.parse(await readFile(path.join(ROOT, relativePath), 'utf8'));
  return { path: relativePath, version: data.version };
}

/** 从 game.yaml 的 version 行取值；缺失时返回空字符串。 */
async function readManifestVersion() {
  const source = await readFile(MANIFEST, 'utf8');
  const match = MANIFEST_LINE.exec(source);
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : '';
}

/**
 * 检查全部位置是否一致。
 * 无 expected 时以根 package.json 为基准；传 expected（--expect）时直接与 tag 版本比较。
 * 不一致会列出每个文件的实际版本并以非零退出码结束。
 */
async function check(expected) {
  const versions = await Promise.all(PACKAGE_FILES.map(readVersionFromPackage));
  versions.push({ path: 'game.yaml', version: await readManifestVersion() });
  const reference = expected ?? versions[0]?.version ?? '';
  const mismatched = versions.filter((entry) => entry.version !== reference);
  if (mismatched.length > 0) {
    console.error(`版本号不一致（${expected ? 'tag 期望' : '基准'}：${reference}）：`);
    for (const entry of versions) console.error(`  - ${entry.path}: ${entry.version}`);
    console.error('\n执行 pnpm version:set <版本> 统一版本号。');
    process.exitCode = 1;
    return;
  }
  console.log(`版本号一致：${reference}`);
}

/**
 * 写入全部版本位置。
 * package.json 统一用两空格缩进并在末尾补换行；game.yaml 只替换 version 行。
 * 版本格式不合法或清单缺少 version 字段时，会在任何写入前抛错。
 */
async function setVersion(version) {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`版本号格式不正确：${version}（示例：0.2.0 或 1.0.0-beta.1）`);
  }
  // 先确认清单可写，再改 package.json，避免中途失败留下半套版本号。
  const source = await readFile(MANIFEST, 'utf8');
  if (!MANIFEST_LINE.test(source)) {
    throw new Error('game.yaml 中未找到 version 字段');
  }
  for (const relativePath of PACKAGE_FILES) {
    const file = path.join(ROOT, relativePath);
    const data = JSON.parse(await readFile(file, 'utf8'));
    data.version = version;
    await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  }
  await writeFile(MANIFEST, source.replace(MANIFEST_LINE, `version: ${version}`), 'utf8');
  console.log(`版本号已更新为 ${version}（package.json × ${PACKAGE_FILES.length} + game.yaml）`);
}

// 简单 CLI 分发：--set 写入，--expect 与发布 tag 对齐，其余情况只做一致性检查。
const args = process.argv.slice(2);
if (args[0] === '--set') {
  await setVersion(args[1] ?? '');
} else if (args[0] === '--expect') {
  const expected = (args[1] ?? '').replace(/^v/, '');
  if (!expected) throw new Error('用法：node scripts/sync-version.mjs --expect v0.1.0');
  await check(expected);
} else {
  await check();
}
