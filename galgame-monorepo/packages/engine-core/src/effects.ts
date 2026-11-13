/**
 * 环境特效解析。
 *
 * 作者在 YAML 里只写想覆盖的字段，预设负责其余默认值；引擎输出完整配置，
 * 播放器不需要知道预设名。目前只实现 particles，但解析入口按 `kind` 分派，
 * 新增特效类型时在这里增加分支即可。
 */
import type {
  AmbientEffect,
  ParticleArea,
  ParticleBlend,
  ParticlePreset,
  ParticleRange,
  ParticlesEffect,
} from '@sylvie/types';
import { PARTICLE_BLENDS, PARTICLE_PRESETS } from '@sylvie/types';

import type { Warn } from './script';

/** 数量上限；超出会导致低端设备掉帧，解析时夹取。 */
const MAX_PARTICLES = 200;

/** 只接受 #RGB / #RGBA / #RRGGBB / #RRGGBBAA，避免把非法值交给粒子库。 */
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** 清空特效的简写。 */
const CLEAR_WORDS = new Set(['clear', 'none', 'off', 'hide', 'empty']);

type ParticleDefaults = Omit<ParticlesEffect, 'kind' | 'preset'>;

/** 各预设的完整默认值；字段含义见 ParticlesEffect。 */
const PARTICLE_DEFAULTS: Record<ParticlePreset, ParticleDefaults> = {
  fireflies: {
    count: 44,
    colors: ['#ffd98a', '#ffe9b0', '#b6f2c8'],
    size: [2, 4.5],
    speed: [5, 16],
    opacity: [0.18, 0.9],
    twinkle: [1.4, 3.2],
    area: [0, 0, 100, 100],
    glow: 2.6,
    blend: 'screen',
  },
  lights: {
    count: 26,
    colors: ['#ffd08a', '#fff3c4', '#ffb27a'],
    size: [8, 22],
    speed: [1, 4],
    opacity: [0.06, 0.3],
    twinkle: [3, 7],
    area: [0, 0, 100, 100],
    glow: 2.2,
    blend: 'screen',
  },
  dust: {
    count: 48,
    colors: ['#ffffff', '#d9e6ff', '#ffe8c8'],
    size: [1, 2.4],
    speed: [2, 7],
    opacity: [0.08, 0.4],
    twinkle: [2, 4.5],
    area: [0, 0, 100, 100],
    glow: 1.4,
    blend: 'normal',
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 只提示未知键，不阻断解析，方便发现 YAML 里的拼写错误。 */
function warnUnknownKeys(
  payload: Record<string, unknown>,
  allowed: string[],
  context: string,
  warn: Warn,
): void {
  const unknown = Object.keys(payload).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    warn(`[脚本] ${context}：未知参数 ${unknown.join(', ')}`);
  }
}

function isClearWord(value: string): boolean {
  return CLEAR_WORDS.has(value.trim().toLowerCase());
}

/** 按预设生成一份完整配置；数组全部复制，避免不同特效共享可变默认值。 */
function createParticles(preset: ParticlePreset): ParticlesEffect {
  const defaults = PARTICLE_DEFAULTS[preset];
  return {
    kind: 'particles',
    preset,
    count: defaults.count,
    colors: [...defaults.colors],
    size: [...defaults.size] as ParticleRange,
    speed: [...defaults.speed] as ParticleRange,
    opacity: [...defaults.opacity] as ParticleRange,
    twinkle: [...defaults.twinkle] as ParticleRange,
    area: [...defaults.area] as ParticleArea,
    glow: defaults.glow,
    blend: defaults.blend,
  };
}

/**
 * 解析一个环境特效列表。
 *
 * 支持：`fireflies`（粒子预设简写）、`clear` / `none`（清空）、
 * `{ particles: fireflies }`、`{ particles: { ... } }` 与它们的数组。
 * 数组内任意一项非法时只跳过该项，不影响其余特效。
 */
export function parseAmbientEffects(value: unknown, context: string, warn: Warn): AmbientEffect[] {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') {
    if (isClearWord(value)) return [];
    const effect = parseAmbientEffect(value, context, warn);
    return effect ? [effect] : [];
  }
  if (!Array.isArray(value)) {
    const effect = parseAmbientEffect(value, context, warn);
    return effect ? [effect] : [];
  }

  const effects: AmbientEffect[] = [];
  value.forEach((item, index) => {
    const effect = parseAmbientEffect(item, `${context} 第 ${index + 1} 项`, warn);
    if (effect) effects.push(effect);
  });
  return effects;
}

/** 单个特效；字符串视为粒子预设名，映射按唯一的键分派到具体类型。 */
function parseAmbientEffect(value: unknown, context: string, warn: Warn): AmbientEffect | null {
  if (typeof value === 'string') {
    if (isClearWord(value)) return null;
    return parseParticles(value, context, warn);
  }
  if (!isRecord(value)) {
    warn(`[脚本] ${context}：特效必须是 { particles: ... } 映射或预设名字符串`);
    return null;
  }
  const keys = Object.keys(value);
  if (keys.length !== 1) {
    warn(`[脚本] ${context}：每条特效应只包含一个特效类型，实际：${keys.join(', ')}`);
    return null;
  }
  const kind = keys[0] ?? '';
  if (kind === 'particles') {
    return parseParticles(value.particles, context, warn);
  }
  warn(`[脚本] ${context}：未知特效 "${kind}"（目前支持：particles）`);
  return null;
}

/** 解析粒子参数；预设名简写与完整映射共用同一套默认值。 */
function parseParticles(value: unknown, context: string, warn: Warn): ParticlesEffect | null {
  if (typeof value === 'string') {
    return createParticles(parsePreset(value, context, warn));
  }
  if (value === undefined || value === null) {
    return createParticles('fireflies');
  }
  if (!isRecord(value)) {
    warn(`[脚本] ${context}：particles 参数应为预设名或映射，已按 fireflies 处理`);
    return createParticles('fireflies');
  }

  warnUnknownKeys(
    value,
    ['preset', 'count', 'colors', 'size', 'speed', 'opacity', 'twinkle', 'area', 'glow', 'blend'],
    context,
    warn,
  );

  const preset = parsePreset(value.preset, context, warn);
  const defaults = PARTICLE_DEFAULTS[preset];

  return {
    kind: 'particles',
    preset,
    count: parseCount(value.count, defaults.count, context, warn),
    colors: parseColors(value.colors, defaults.colors, context, warn),
    size: parseRange(value.size, defaults.size, 0.5, 64, `${context} 的 size`, warn),
    speed: parseRange(value.speed, defaults.speed, 0, 300, `${context} 的 speed`, warn),
    opacity: parseRange(value.opacity, defaults.opacity, 0, 1, `${context} 的 opacity`, warn),
    twinkle: parseRange(value.twinkle, defaults.twinkle, 0, 60, `${context} 的 twinkle`, warn),
    area: parseArea(value.area, defaults.area, `${context} 的 area`, warn),
    glow: parseGlow(value.glow, defaults.glow, context, warn),
    blend: parseBlend(value.blend, defaults.blend, context, warn),
  };
}

function parsePreset(value: unknown, context: string, warn: Warn): ParticlePreset {
  if (value === undefined) return 'fireflies';
  if (typeof value === 'string' && (PARTICLE_PRESETS as readonly string[]).includes(value)) {
    return value as ParticlePreset;
  }
  warn(
    `[脚本] ${context}：preset 只能是 ${PARTICLE_PRESETS.join(' / ')}，已按 fireflies 处理`,
  );
  return 'fireflies';
}

function parseCount(value: unknown, fallback: number, context: string, warn: Warn): number {
  if (value === undefined) return fallback;
  const numeric = asFiniteNumber(value);
  if (numeric === null) {
    warn(`[脚本] ${context}：count 应为数字，已使用默认值 ${fallback}`);
    return fallback;
  }
  const count = Math.round(numeric);
  if (count < 1 || count > MAX_PARTICLES) {
    warn(`[脚本] ${context}：count 应在 1-${MAX_PARTICLES} 之间，已夹取`);
  }
  return Math.min(MAX_PARTICLES, Math.max(1, count));
}

function parseColors(
  value: unknown,
  fallback: string[],
  context: string,
  warn: Warn,
): string[] {
  if (value === undefined) return [...fallback];
  const raw = typeof value === 'string' ? [value] : Array.isArray(value) ? value : null;
  if (raw === null) {
    warn(`[脚本] ${context}：colors 应为颜色字符串或列表，已使用默认配色`);
    return [...fallback];
  }

  const colors: string[] = [];
  for (const item of raw) {
    const color = typeof item === 'string' ? item.trim() : '';
    if (HEX_COLOR.test(color)) {
      colors.push(color);
    } else {
      warn(`[脚本] ${context}：颜色 ${JSON.stringify(item)} 不是 #RGB / #RRGGBB 格式，已忽略`);
    }
  }
  if (colors.length === 0) {
    warn(`[脚本] ${context}：没有可用的颜色，已使用默认配色`);
    return [...fallback];
  }
  return colors;
}

/** 区间既接受固定数字，也接受 `[min, max]`；顺序写反时自动交换。 */
function parseRange(
  value: unknown,
  fallback: ParticleRange,
  min: number,
  max: number,
  context: string,
  warn: Warn,
): ParticleRange {
  const clamp = (numeric: number): number => Math.min(max, Math.max(min, numeric));
  if (value === undefined) return [fallback[0], fallback[1]];
  if (typeof value === 'number' && Number.isFinite(value)) {
    const fixed = clamp(value);
    return [fixed, fixed];
  }
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((item) => asFiniteNumber(item) !== null)
  ) {
    const first = clamp(value[0] as number);
    const second = clamp(value[1] as number);
    return first <= second ? [first, second] : [second, first];
  }
  warn(`[脚本] ${context}：应为数字或 [min, max]，已使用默认值`);
  return [fallback[0], fallback[1]];
}

/** 区域使用舞台宽高百分比；允许 0-100，避免作者把粒子写到画面外。 */
function parseArea(
  value: unknown,
  fallback: ParticleArea,
  context: string,
  warn: Warn,
): ParticleArea {
  if (value === undefined) return [fallback[0], fallback[1], fallback[2], fallback[3]];
  if (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((item) => asFiniteNumber(item) !== null)
  ) {
    const [x, y, width, height] = value as [number, number, number, number];
    const clamp = (numeric: number): number => Math.min(100, Math.max(0, numeric));
    return [clamp(x), clamp(y), clamp(width), clamp(height)];
  }
  warn(`[脚本] ${context}：应为 [x, y, width, height] 百分比，已使用全屏`);
  return [fallback[0], fallback[1], fallback[2], fallback[3]];
}

/** 光晕强度 0-10；其余数值字段都走 parseRange，这里单独处理。 */
function parseGlow(value: unknown, fallback: number, context: string, warn: Warn): number {
  if (value === undefined) return fallback;
  const numeric = asFiniteNumber(value);
  if (numeric === null) {
    warn(`[脚本] ${context}：glow 应为数字，已使用默认值 ${fallback}`);
    return fallback;
  }
  if (numeric < 0 || numeric > 10) {
    warn(`[脚本] ${context}：glow 应在 0-10 之间，已夹取`);
  }
  return Math.min(10, Math.max(0, numeric));
}

function parseBlend(value: unknown, fallback: ParticleBlend, context: string, warn: Warn): ParticleBlend {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && (PARTICLE_BLENDS as readonly string[]).includes(value)) {
    return value as ParticleBlend;
  }
  warn(`[脚本] ${context}：blend 只能是 ${PARTICLE_BLENDS.join(' / ')}，已按 ${fallback} 处理`);
  return fallback;
}
