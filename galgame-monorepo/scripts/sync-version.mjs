#!/usr/bin/env node
/**
 * 统一版本号：
 *   node scripts/sync-version.mjs            检查 package.json / manifest 是否一致
 *   node scripts/sync-version.mjs --set 0.2.0 写入全部位置
 *
 * 版本源以根 package.json 为准，同步到 Electron / Web / 内容包与 game.yaml。
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const MANIFEST = path.join(ROOT, 'packages/game-content/game/scripts/game.yaml');
const PACKAGE_FILES = [
  'package.json',
  'apps/electron/package.json',
  'apps/web/package.json',
  'packages/game-content/package.json',
];
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const MANIFEST_LINE = /^version:\s*(.+)$/m;

async function readVersionFromPackage(relativePath) {
  const data = JSON.parse(await readFile(path.join(ROOT, relativePath), 'utf8'));
  return { path: relativePath, version: data.version };
}

async function readManifestVersion() {
  const source = await readFile(MANIFEST, 'utf8');
  const match = MANIFEST_LINE.exec(source);
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : '';
}

async function check() {
  const versions = await Promise.all(PACKAGE_FILES.map(readVersionFromPackage));
  versions.push({ path: 'game.yaml', version: await readManifestVersion() });
  const reference = versions[0]?.version ?? '';
  const mismatched = versions.filter((entry) => entry.version !== reference);
  if (mismatched.length > 0) {
    console.error(`版本号不一致（基准：${reference}）：`);
    for (const entry of versions) console.error(`  - ${entry.path}: ${entry.version}`);
    console.error('\n执行 pnpm version:set <版本> 统一版本号。');
    process.exitCode = 1;
    return;
  }
  console.log(`版本号一致：${reference}`);
}

async function setVersion(version) {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`版本号格式不正确：${version}（示例：0.2.0 或 1.0.0-beta.1）`);
  }
  for (const relativePath of PACKAGE_FILES) {
    const file = path.join(ROOT, relativePath);
    const data = JSON.parse(await readFile(file, 'utf8'));
    data.version = version;
    await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  }
  const source = await readFile(MANIFEST, 'utf8');
  if (!MANIFEST_LINE.test(source)) {
    throw new Error('game.yaml 中未找到 version 字段');
  }
  await writeFile(MANIFEST, source.replace(MANIFEST_LINE, `version: ${version}`), 'utf8');
  console.log(`版本号已更新为 ${version}（package.json × ${PACKAGE_FILES.length} + game.yaml）`);
}

const args = process.argv.slice(2);
if (args[0] === '--set') {
  await setVersion(args[1] ?? '');
} else {
  await check();
}
