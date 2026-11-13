#!/usr/bin/env node
/** 校验内容包：解析全部场景、检查资源存在性，并跑通两条分支到结局。 */
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GameEngine } from '../packages/engine-core/dist/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const GAME_ROOT = path.join(ROOT, 'packages/game-content/game');

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

  if (warnings.length > 0) {
    console.error(`\n发现 ${warnings.length} 条警告：`);
    for (const warning of warnings) console.error(`  - ${warning}`);
    process.exitCode = 1;
    return;
  }

  console.log('\n内容校验通过，无警告。');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
