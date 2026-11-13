import type { AssetHost, EngineHost, KeyValueStorage } from '@sylvie/types';
import { describe, expect, it } from 'vitest';

import { GameEngine } from '../src/engine';
import { evaluateCondition, evaluateExpression, validateExpression } from '../src/expression';
import { loadGame, parseManifest } from '../src/script';

const GAME_YAML = `
title: 测试游戏
version: 1.0.0
start: start
scenes:
  - start
variables:
  affection: 0
  player_name: "旅人"
`;

const START_YAML = `
imports:
  - shared
commands:
  - label: begin
  - bg: images/bg/room.png
  - sprite: { id: girl, image: images/sprite/girl.png, position: center }
  - text: { speaker: 少女, text: "第一句话。" }
  - set: { var: affection, op: "+=", value: 2 }
  - text: "第二句话。"
  - choice:
      prompt: "要怎么做？"
      options:
        - text: "微笑"
          jump: good
        - text: "沉默"
          jump: shared#bad
        - text: "只有好感度高才出现"
          jump: good
          if: affection >= 3
  - label: good
  - text: "你选择了微笑。"
  - jump: end
`;

const SHARED_YAML = `
commands:
  - label: bad
  - text: "沉默的结局。"
  - jump: end
  - label: end
  - text: "故事结束。"
  - bgm: stop
`;

function createAssets(files: Record<string, string>): AssetHost {
  return {
    async readText(path) {
      const content = files[path];
      if (content === undefined) throw new Error(`missing file: ${path}`);
      return content;
    },
    async exists(path) {
      return files[path] !== undefined;
    },
  };
}

function createStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, value) {
      map.set(key, value);
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

function createFiles(): Record<string, string> {
  return {
    'scripts/game.yaml': GAME_YAML,
    'scripts/scenes/start.yaml': START_YAML,
    'scripts/scenes/shared.yaml': SHARED_YAML,
  };
}

function createHost(onWarning?: (message: string) => void): EngineHost {
  return {
    assets: createAssets(createFiles()),
    storage: createStorage(),
    onWarning,
  };
}

async function createEngine(
  onWarning: (message: string) => void = () => {},
): Promise<GameEngine> {
  const engine = new GameEngine({ host: createHost(onWarning) });
  await engine.initialize();
  return engine;
}

describe('expression', () => {
  it('respects precedence and parentheses', () => {
    expect(evaluateExpression('1 + 2 * 3', {})).toBe(7);
    expect(evaluateExpression('(1 + 2) * 3', {})).toBe(9);
    expect(evaluateExpression('!false && 10 > 5', {})).toBe(true);
  });

  it('supports variables, strings and comparisons', () => {
    expect(evaluateExpression('affection + 1', { affection: 2 })).toBe(3);
    expect(evaluateCondition('affection >= 2 && name == "Sylvie"', { affection: 2, name: 'Sylvie' })).toBe(true);
    expect(evaluateCondition('name != "Sylvie"', { name: 'Sylvie' })).toBe(false);
  });

  it('reports syntax errors during validation', () => {
    expect(validateExpression('affection >=', )).not.toBeNull();
    expect(validateExpression('(affection >= 1')).not.toBeNull();
    expect(validateExpression('affection >= 1 && name == "x"')).toBeNull();
  });
});

describe('script loading', () => {
  it('parses manifest defaults', () => {
    const warnings: string[] = [];
    const manifest = parseManifest(
      'start: foo\nvariables:\n  bad: [1, 2]\n',
      (message) => warnings.push(message),
    );
    expect(manifest.start).toBe('foo');
    expect(manifest.title).toBe('Sylvie Galgame');
    expect(manifest.scenes).toEqual(['foo']);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('merges imports and registers labels', async () => {
    const host = createHost();
    const loaded = await loadGame(host.assets, () => {});
    expect(loaded.scenes.get('start')?.labels.good).toEqual({ block: 'start', index: 7 });
    expect(loaded.scenes.get('start')?.labels.end).toEqual({ block: 'shared', index: 3 });
    expect(loaded.scenes.get('start')?.assets).toContain('images/bg/room.png');
  });

  it('validates cross-scene jump targets against the target scene labels', async () => {
    const warnings: string[] = [];
    await loadGame(createHost().assets, (message) => warnings.push(message));
    expect(warnings).toHaveLength(0);

    const files = createFiles();
    files['scripts/scenes/start.yaml'] =
      'imports: [shared]\ncommands:\n  - jump: shared#missing\n';
    const missingWarnings: string[] = [];
    await loadGame(createAssets(files), (message) => missingWarnings.push(message));
    expect(missingWarnings.some((message) => message.includes('找不到 label "missing"'))).toBe(
      true,
    );
  });
});

describe('game engine', () => {
  it('runs text, set, choice and conditional jumps', async () => {
    const engine = await createEngine();
    engine.start();

    let snapshot = engine.getSnapshot();
    expect(snapshot.phase).toBe('text');
    expect(snapshot.dialogue?.text).toBe('第一句话。');
    expect(snapshot.variables.affection).toBe(0);

    engine.advance();
    snapshot = engine.getSnapshot();
    expect(snapshot.phase).toBe('text');
    expect(snapshot.variables.affection).toBe(2);
    expect(snapshot.backlog).toHaveLength(2);

    engine.advance();
    snapshot = engine.getSnapshot();
    expect(snapshot.phase).toBe('choice');
    expect(snapshot.choice?.options).toHaveLength(2);

    engine.choose(0);
    snapshot = engine.getSnapshot();
    expect(snapshot.phase).toBe('text');
    expect(snapshot.dialogue?.text).toBe('你选择了微笑。');
    expect(snapshot.chapter).toBe('good');

    engine.advance();
    snapshot = engine.getSnapshot();
    expect(snapshot.dialogue?.text).toBe('故事结束。');

    engine.advance();
    snapshot = engine.getSnapshot();
    expect(snapshot.phase).toBe('ended');
  });

  it('follows the other branch and records read marks', async () => {
    const engine = await createEngine();
    engine.start();
    engine.advance();
    expect(engine.isCurrentTextRead()).toBe(false);
    engine.advance();

    engine.choose(1);
    const snapshot = engine.getSnapshot();
    expect(snapshot.dialogue?.text).toBe('沉默的结局。');
    expect(engine.getReadMarkCount()).toBe(2);
  });

  it('saves and restores pointer, variables, backlog and read marks', async () => {
    const engine = await createEngine();
    engine.start();
    engine.advance();
    engine.advance();

    const save = engine.createSave({ note: '测试存档' });
    expect(save.pointer.block).toBe('start');
    expect(save.variables.affection).toBe(2);
    expect(save.backlog).toHaveLength(2);

    const next = await createEngine();
    expect(next.restoreSave(save)).toBe(true);
    const snapshot = next.getSnapshot();
    expect(snapshot.phase).toBe('choice');
    expect(snapshot.variables.affection).toBe(2);
    expect(snapshot.backlog).toHaveLength(2);
    expect(snapshot.choice?.options).toHaveLength(2);
  });

  it('restores a text line without duplicating backlog', async () => {
    const engine = await createEngine();
    engine.start();
    const save = engine.createSave();

    const next = await createEngine();
    next.restoreSave(save);
    const snapshot = next.getSnapshot();
    expect(snapshot.dialogue?.text).toBe('第一句话。');
    expect(snapshot.backlog).toHaveLength(1);
    expect(next.getReadMarkCount()).toBe(0);
  });

  it('waits and resumes', async () => {
    const files = createFiles();
    files['scripts/scenes/start.yaml'] = `
commands:
  - text: "等待之前"
  - wait: 500
  - text: "等待之后"
`;
    const engine = new GameEngine({
      host: {
        assets: createAssets(files),
        storage: createStorage(),
      },
    });
    await engine.initialize();
    engine.start();
    engine.advance();
    const waiting = engine.getSnapshot();
    expect(waiting.phase).toBe('wait');
    expect(waiting.waitMs).toBe(500);
    engine.resumeWait();
    expect(engine.getSnapshot().dialogue?.text).toBe('等待之后');
  });
});
