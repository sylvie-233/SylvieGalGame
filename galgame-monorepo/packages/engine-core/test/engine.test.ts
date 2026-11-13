import type { AssetHost, EngineHost, KeyValueStorage } from '@sylvie/types';
import { manualSaveKey } from '@sylvie/types';
import { describe, expect, it } from 'vitest';

import { GameEngine } from '../src/engine';
import { evaluateCondition, evaluateExpression, validateExpression } from '../src/expression';
import { interpolateText, validateInterpolation } from '../src/interpolate';
import { loadGame, parseManifest } from '../src/script';
import {
  createSaveExport,
  importSaveExport,
  loadGalleryUnlocks,
  parseSaveExport,
  persistGalleryUnlocks,
  readAutoSaves,
  readLatestSave,
  readSave,
  writeAutoSave,
  writeSave,
} from '../src/storage';

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
  - sprite: { id: girl, image: images/sprite/girl.png, position: center, scale: 1.2, z: 3, flip: true, ease: easeOut }
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

async function createEngine(onWarning: (message: string) => void = () => {}): Promise<GameEngine> {
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
    expect(
      evaluateCondition('affection >= 2 && name == "Sylvie"', { affection: 2, name: 'Sylvie' }),
    ).toBe(true);
    expect(evaluateCondition('name != "Sylvie"', { name: 'Sylvie' })).toBe(false);
  });

  it('concatenates strings with +', () => {
    expect(evaluateExpression('"你好，" + name', { name: '旅人' })).toBe('你好，旅人');
    expect(evaluateExpression('prefix + 1', { prefix: '第' })).toBe('第1');
  });

  it('reports syntax errors during validation', () => {
    expect(validateExpression('affection >=')).not.toBeNull();
    expect(validateExpression('(affection >= 1')).not.toBeNull();
    expect(validateExpression('affection >= 1 && name == "x"')).toBeNull();
  });
});

describe('interpolation', () => {
  it('replaces variables and supports escaped braces', () => {
    expect(
      interpolateText('{player_name}，好感 {affection}。', { player_name: '旅人', affection: 3 }),
    ).toBe('旅人，好感 3。');
    expect(interpolateText('字面量 {{affection}}', {})).toBe('字面量 {affection}');
  });

  it('validates placeholder syntax and missing variables', () => {
    expect(validateInterpolation('{player_name}')).toBeNull();
    expect(validateInterpolation('{bad-name}')).not.toBeNull();
    expect(validateInterpolation('{unclosed')).not.toBeNull();

    const warnings: string[] = [];
    expect(interpolateText('{missing}', {}, (message) => warnings.push(message))).toBe('{missing}');
    expect(warnings).toHaveLength(1);
  });
});

describe('script loading', () => {
  it('parses manifest defaults', () => {
    const warnings: string[] = [];
    const manifest = parseManifest('start: foo\nvariables:\n  bad: [1, 2]\n', (message) =>
      warnings.push(message),
    );
    expect(manifest.start).toBe('foo');
    expect(manifest.title).toBe('Sylvie Galgame');
    expect(manifest.windowTitle).toBe('Sylvie Galgame');
    expect(manifest.titleScreen).toEqual({
      background: null,
      bgm: null,
      subtitle: '',
      showVersion: true,
    });
    expect(manifest.gallery).toEqual({ cgs: [], bgms: [] });
    expect(manifest.scenes).toEqual(['foo']);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('parses title config and window title', () => {
    const manifest = parseManifest(
      `start: foo
windowTitle: 自定义窗口
titleScreen:
  background: images/bg/title.svg
  bgm: audio/bgm/title.wav
  subtitle: 副标题
  showVersion: false
gallery:
  cgs:
    - { id: first, image: images/cg/first.svg, title: 第一张 }
    - images/cg/second.svg
  bgms:
    - { id: theme, track: audio/bgm/theme.wav, title: 主题曲 }
`,
      () => {},
    );
    expect(manifest.windowTitle).toBe('自定义窗口');
    expect(manifest.titleScreen).toEqual({
      background: 'images/bg/title.svg',
      bgm: 'audio/bgm/title.wav',
      subtitle: '副标题',
      showVersion: false,
    });
    expect(manifest.gallery).toEqual({
      cgs: [
        { id: 'first', image: 'images/cg/first.svg', title: '第一张' },
        { id: 'second', image: 'images/cg/second.svg', title: 'second' },
      ],
      bgms: [{ id: 'theme', track: 'audio/bgm/theme.wav', title: '主题曲' }],
    });
  });

  it('merges imports and registers labels', async () => {
    const host = createHost();
    const loaded = await loadGame(host.assets, () => {});
    expect(loaded.scenes.get('start')?.labels.good).toEqual({ block: 'start', index: 7 });
    expect(loaded.scenes.get('start')?.labels.end).toEqual({ block: 'shared', index: 3 });
    expect(loaded.scenes.get('start')?.assets).toContain('images/bg/room.png');
  });

  it('generates stable text ids and honours explicit ids', async () => {
    const textIds = async (files: Record<string, string>) => {
      const loaded = await loadGame(createAssets(files), () => {});
      const scene = loaded.scenes.get('start');
      const commands = scene?.blocks[scene.entryBlock]?.commands ?? [];
      return commands
        .filter((command) => command.kind === 'text')
        .map((command) => (command as { id: string }).id);
    };

    const files = createFiles();
    const original = await textIds(files);

    // 在两条文本之间插入无关台词后，原有两条文本的 id 不应改变。
    files['scripts/scenes/start.yaml'] = START_YAML.replace(
      '  - text: "第二句话。"',
      '  - text: "插入的新台词。"\n  - text: "第二句话。"',
    );
    const inserted = await textIds(files);
    expect(inserted[0]).toBe(original[0]);
    expect(inserted[2]).toBe(original[1]);

    // 显式 id 优先，允许作者固定关键台词。
    files['scripts/scenes/start.yaml'] = START_YAML.replace(
      '  - text: "第二句话。"',
      '  - text: { id: "key-line", text: "第二句话。" }',
    );
    const explicit = await textIds(files);
    expect(explicit[1]).toBe('key-line');
  });

  it('validates cross-scene jump targets against the target scene labels', async () => {
    const warnings: string[] = [];
    await loadGame(createHost().assets, (message) => warnings.push(message));
    expect(warnings).toHaveLength(0);

    const files = createFiles();
    files['scripts/scenes/start.yaml'] = 'imports: [shared]\ncommands:\n  - jump: shared#missing\n';
    const missingWarnings: string[] = [];
    await loadGame(createAssets(files), (message) => missingWarnings.push(message));
    expect(missingWarnings.some((message) => message.includes('找不到 label "missing"'))).toBe(
      true,
    );
    expect(missingWarnings.some((message) => /start\.yaml:\d+/.test(message))).toBe(true);
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
    expect(snapshot.stage.sprites.girl?.scale).toBe(1.2);
    expect(snapshot.stage.sprites.girl?.z).toBe(3);
    expect(snapshot.stage.sprites.girl?.flip).toBe(true);
    expect(snapshot.stage.sprites.girl?.ease).toBe('easeOut');

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

  it('keeps legacy read marks working after stable id upgrade', async () => {
    const storage = createStorage();
    // 一期 id：block#编译后指令下标；start 块第 6 条指令是第二句话。
    await storage.set('meta:read-marks', JSON.stringify(['start#5']));
    const engine = new GameEngine({
      host: { assets: createAssets(createFiles()), storage, onWarning: () => {} },
    });
    await engine.initialize();
    engine.start();
    engine.advance();
    expect(engine.getSnapshot().dialogue?.text).toBe('第二句话。');
    expect(engine.isCurrentTextRead()).toBe(true);
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

  it('emits bgm position when restoring a save', async () => {
    const engine = await createEngine();
    engine.start();
    const save = engine.createSave({ bgmPosition: 7.5 });

    const next = await createEngine();
    const positions: number[] = [];
    next.onEffect((effect) => {
      if (effect.type === 'bgm') positions.push(effect.position ?? 0);
    });
    expect(next.restoreSave(save)).toBe(true);
    expect(positions).toContain(7.5);
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

  it('evaluates set expressions and applies choice actions before jumping', async () => {
    const files = createFiles();
    files['scripts/scenes/start.yaml'] = `
commands:
  - set: { var: greeting, op: "=", expr: "'你好，' + player_name" }
  - set: { var: affection, op: "+=", value: 1 }
  - text: "{greeting}"
  - choice:
      prompt: "要怎么做？"
      options:
        - text: "微笑"
          jump: after
          set:
            - { var: affection, op: "+=", value: 2 }
            - { var: greeting, op: "+=", expr: "'！'" }
        - text: "沉默"
          jump: after
          set: { var: affection, op: "-=", value: 1 }
  - label: after
  - text: "好感 {affection}"
`;
    const engine = new GameEngine({
      host: { assets: createAssets(files), storage: createStorage() },
    });
    await engine.initialize();
    engine.start();
    expect(engine.getSnapshot().dialogue?.text).toBe('你好，旅人');
    engine.advance();

    engine.choose(0);
    const snapshot = engine.getSnapshot();
    expect(snapshot.phase).toBe('text');
    expect(snapshot.variables.affection).toBe(3);
    expect(snapshot.variables.greeting).toBe('你好，旅人！');
    expect(snapshot.dialogue?.text).toBe('好感 3');
    expect(snapshot.chapter).toBe('after');
  });

  it('supports new transitions and one-shot shake / flash effects', async () => {
    const files = createFiles();
    files['scripts/scenes/start.yaml'] = `
commands:
  - bg: { image: images/bg/room.png, transition: wipe, ease: linear, duration: 700 }
  - text: "第一句"
  - shake: { intensity: 12, duration: 300 }
  - flash: black
  - text: "第二句"
`;
    const engine = new GameEngine({
      host: {
        assets: createAssets(files),
        storage: createStorage(),
        onWarning: () => {},
      },
    });
    await engine.initialize();
    const effects: string[] = [];
    engine.onEffect((effect) => {
      if (effect.type === 'shake') effects.push(`shake:${effect.intensity}:${effect.duration}`);
      if (effect.type === 'flash') effects.push(`flash:${effect.color}:${effect.opacity}`);
    });
    engine.start();
    const snapshot = engine.getSnapshot();
    expect(snapshot.stage.background.transition).toBe('wipe');
    expect(snapshot.stage.background.ease).toBe('linear');
    expect(snapshot.stage.background.duration).toBe(700);

    engine.advance();
    expect(effects).toEqual(['shake:12:300', 'flash:black:0.85']);
    expect(engine.getSnapshot().dialogue?.text).toBe('第二句');
  });

  it('suggests assets of upcoming branch target scenes', async () => {
    const files = createFiles();
    files['scripts/scenes/shared.yaml'] = `
commands:
  - label: bad
  - bg: images/bg/shared.png
  - text: "另一条路。"
`;
    const engine = new GameEngine({
      host: { assets: createAssets(files), storage: createStorage(), onWarning: () => {} },
    });
    await engine.initialize();
    engine.start();
    expect(engine.getUpcomingSceneAssets()).toContain('images/bg/shared.png');
    expect(engine.getUpcomingSceneAssets()).not.toContain('images/bg/room.png');
  });

  it('includes file and line in missing asset warnings', async () => {
    const files = createFiles();
    const warnings: string[] = [];
    const engine = new GameEngine({
      host: {
        assets: {
          readText: (path) => createAssets(files).readText(path),
          exists: async () => false,
        },
        storage: createStorage(),
        onWarning: (message) => warnings.push(message),
      },
    });
    await engine.initialize();
    expect(
      warnings.some(
        (message) =>
          message.includes('images/bg/room.png') && /start\.yaml:\d+/.test(message),
      ),
    ).toBe(true);
  });

  it('warns about unknown command parameters', async () => {
    const files = createFiles();
    files['scripts/scenes/start.yaml'] =
      'commands:\n  - shake: { intensity: 5, strength: 9 }\n';
    const warnings: string[] = [];
    await loadGame(createAssets(files), (message) => warnings.push(message));
    expect(warnings.some((message) => message.includes('未知参数 strength'))).toBe(true);
    expect(
      warnings.some(
        (message) => message.includes('未知参数 strength') && /start\.yaml:2/.test(message),
      ),
    ).toBe(true);
  });

  it('interpolates variables when the text blocks', async () => {
    const files = createFiles();
    files['scripts/scenes/start.yaml'] = `
commands:
  - text: "{player_name}的好感是 {affection}。"
  - set: { var: affection, op: "+=", value: 2 }
  - text: "{player_name}的好感是 {affection}。"
`;
    const engine = new GameEngine({
      host: { assets: createAssets(files), storage: createStorage() },
    });
    await engine.initialize();
    engine.start();
    expect(engine.getSnapshot().dialogue?.text).toBe('旅人的好感是 0。');
    engine.advance();
    expect(engine.getSnapshot().dialogue?.text).toBe('旅人的好感是 2。');
  });

  it('registers chapters and endings and stops at the ending command', async () => {
    const files = createFiles();
    files['scripts/game.yaml'] =
      GAME_YAML +
      `
chapters:
  begin: "序章 · 测试"
endings:
  - id: good
    title: "好结局"
    description: "测试用结局。"
`;
    files['scripts/scenes/start.yaml'] = `
commands:
  - label: begin
  - text: "最后一句。"
  - ending: good
`;
    const warnings: string[] = [];
    const engine = new GameEngine({
      host: {
        assets: createAssets(files),
        storage: createStorage(),
        onWarning: (message) => warnings.push(message),
      },
    });
    await engine.initialize();
    engine.start();

    const first = engine.getSnapshot();
    expect(first.chapter).toBe('begin');
    expect(first.chapterName).toBe('序章 · 测试');
    expect(first.ending).toBeNull();

    engine.advance();
    const ended = engine.getSnapshot();
    expect(ended.phase).toBe('ended');
    expect(ended.ending).toEqual({ id: 'good', title: '好结局', description: '测试用结局。' });
    expect(warnings).toHaveLength(0);
  });

  it('warns about unknown ending ids', async () => {
    const files = createFiles();
    files['scripts/scenes/start.yaml'] = 'commands:\n  - ending: missing\n';
    const warnings: string[] = [];
    await loadGame(createAssets(files), (message) => warnings.push(message));
    expect(warnings.some((message) => message.includes('结局 "missing" 未在'))).toBe(true);
  });

  it('emits checkpoints with blocking kind and chapter', async () => {
    const engine = await createEngine();
    const checkpoints: Array<{ block: string; chapter: string }> = [];
    engine.onEffect((effect) => {
      if (effect.type === 'checkpoint') {
        checkpoints.push({ block: effect.block, chapter: effect.chapter });
      }
    });
    engine.start();
    engine.advance();
    engine.advance();
    expect(checkpoints).toEqual([
      { block: 'text', chapter: 'begin' },
      { block: 'text', chapter: 'begin' },
      { block: 'choice', chapter: 'begin' },
    ]);
  });

  it('rolls back text and choice states without duplicating backlog', async () => {
    const engine = await createEngine();
    engine.start();
    expect(engine.getSnapshot().dialogue?.text).toBe('第一句话。');
    expect(engine.canRollback()).toBe(false);

    engine.advance();
    expect(engine.getSnapshot().dialogue?.text).toBe('第二句话。');
    expect(engine.getSnapshot().variables.affection).toBe(2);
    expect(engine.canRollback()).toBe(true);

    engine.rollback();
    const first = engine.getSnapshot();
    expect(first.dialogue?.text).toBe('第一句话。');
    expect(first.variables.affection).toBe(0);
    expect(first.backlog).toHaveLength(1);
    expect(engine.canRollback()).toBe(false);

    engine.advance();
    engine.advance();
    expect(engine.getSnapshot().phase).toBe('choice');
    engine.rollback();
    expect(engine.getSnapshot().dialogue?.text).toBe('第二句话。');
    expect(engine.getSnapshot().phase).toBe('text');

    engine.advance();
    engine.choose(0);
    expect(engine.getSnapshot().dialogue?.text).toBe('你选择了微笑。');
    engine.rollback();
    const backToChoice = engine.getSnapshot();
    expect(backToChoice.phase).toBe('choice');
    expect(backToChoice.choice?.options).toHaveLength(2);
    expect(backToChoice.variables.affection).toBe(2);
    expect(backToChoice.backlog).toHaveLength(2);
  });

  it('rotates auto saves and picks the latest among all save kinds', async () => {
    const storage = createStorage();
    const engine = await createEngine();
    engine.start();
    const base = engine.createSave();

    await writeAutoSave(storage, { ...base, createdAt: 1 });
    await writeAutoSave(storage, { ...base, createdAt: 2 });
    await writeAutoSave(storage, { ...base, createdAt: 3 });
    const auto = await readAutoSaves(storage);
    expect(auto.map((entry) => entry.data?.createdAt)).toEqual([3, 2, 1]);

    await writeSave(storage, 'save:quick', { ...base, createdAt: 4 });
    expect((await readLatestSave(storage))?.createdAt).toBe(4);

    await writeSave(storage, manualSaveKey(1), { ...base, createdAt: 5 });
    expect((await readLatestSave(storage))?.createdAt).toBe(5);
  });

  it('exports and imports save bundles with key validation', async () => {
    const source = createStorage();
    const engine = await createEngine();
    engine.start();
    const save = engine.createSave({ note: '导出测试' });
    await writeSave(source, manualSaveKey(1), save);

    const raw = await createSaveExport(source, [manualSaveKey(1)]);
    const parsed = parseSaveExport(raw);
    expect(Object.keys(parsed ?? {})).toEqual([manualSaveKey(1)]);

    const target = createStorage();
    expect(await importSaveExport(target, raw)).toBe(1);
    expect((await readSave(target, manualSaveKey(1)))?.note).toBe('导出测试');

    expect(parseSaveExport('{"format":"wrong"}')).toBeNull();
    expect(
      parseSaveExport(
        JSON.stringify({
          format: 'sylvie-save-export',
          version: 1,
          exportedAt: 1,
          saves: { evil: 'x', 'save:slot:99': 'y' },
        }),
      ),
    ).toEqual({});
    await expect(importSaveExport(target, 'not json')).rejects.toThrow('格式不正确');
  });

  it('persists gallery unlocks independently from saves', async () => {
    const storage = createStorage();
    await persistGalleryUnlocks(storage, {
      cgs: ['book_glow', 'book_glow'],
      bgms: ['afternoon'],
      endings: ['melody'],
    });

    const loaded = await loadGalleryUnlocks(storage);
    expect(loaded).toEqual({
      cgs: ['book_glow'],
      bgms: ['afternoon'],
      endings: ['melody'],
    });
    expect(await loadGalleryUnlocks(createStorage())).toEqual({
      cgs: [],
      bgms: [],
      endings: [],
    });
  });

  it('saves content version and bgm position, and migrates v1/v2 saves', async () => {
    const engine = await createEngine();
    engine.start();
    const save = engine.createSave({ bgmPosition: 12.5 });
    expect(save.contentVersion).toBe('1.0.0');
    expect(save.bgmPosition).toBe(12.5);

    const storage = createStorage();
    const legacyV1 = { ...save, version: 1 } as Record<string, unknown>;
    delete legacyV1.contentVersion;
    delete legacyV1.bgmPosition;
    await storage.set('save:legacy-1', JSON.stringify(legacyV1));

    const legacyV2 = { ...save, version: 2 } as Record<string, unknown>;
    delete legacyV2.bgmPosition;
    await storage.set('save:legacy-2', JSON.stringify(legacyV2));

    const migratedV1 = await readSave(storage, 'save:legacy-1');
    expect(migratedV1?.version).toBe(3);
    expect(migratedV1?.contentVersion).toBe('');
    expect(migratedV1?.bgmPosition).toBe(0);
    expect(migratedV1?.variables.affection).toBe(0);

    const migratedV2 = await readSave(storage, 'save:legacy-2');
    expect(migratedV2?.version).toBe(3);
    expect(migratedV2?.contentVersion).toBe('1.0.0');
    expect(migratedV2?.bgmPosition).toBe(0);
  });
});
