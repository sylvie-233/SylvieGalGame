/**
 * 可配置环境特效的共享类型。
 *
 * 特效不是写死的页面效果：标题页与任意场景都能通过 YAML 配置，
 * 引擎把解析后的完整配置放进舞台快照，播放器按 `kind` 分派绘制。
 * 粒子渲染交给 tsParticles（`@tsparticles/react` + `@tsparticles/basic`），
 * 这些类型只描述 YAML 配置，播放器负责把它映射成库的 options。
 * 新增特效类型时，在这里扩展 `AmbientEffect` 联合类型，并同步更新
 * 引擎解析、Schema 与文档；播放器只需增加对应渲染组件。
 */

/** 内置粒子预设。新预设需同时更新引擎默认值、Schema 与文档。 */
export const PARTICLE_PRESETS = ['fireflies', 'lights', 'dust'] as const;
export type ParticlePreset = (typeof PARTICLE_PRESETS)[number];

/** 粒子的混合方式；screen 适合发光体，normal 适合尘埃。 */
export const PARTICLE_BLENDS = ['normal', 'screen'] as const;
export type ParticleBlend = (typeof PARTICLE_BLENDS)[number];

/** 目前已支持的环境特效类型。 */
export const AMBIENT_EFFECT_KINDS = ['particles'] as const;

/** 数值区间；YAML 可写 `[min, max]`，也可只写一个数字表示固定值。 */
export type ParticleRange = [min: number, max: number];

/** 生成区域，按舞台宽高的百分比表示 `[x, y, width, height]`。 */
export type ParticleArea = [x: number, y: number, width: number, height: number];

/**
 * 粒子特效的一份已解析配置。
 * 预设只提供默认值，作者在 YAML 中写的字段会覆盖对应项；
 * 引擎输出时所有字段都已补齐，播放器不需要再理解预设。
 */
export interface ParticlesEffect {
  kind: 'particles';
  preset: ParticlePreset;
  /** 粒子数量，1-200。 */
  count: number;
  /** 颜色列表，每颗粒子创建时随机取一种。 */
  colors: string[];
  /** 粒子核心直径范围（像素）。 */
  size: ParticleRange;
  /** 漂移速度范围（像素 / 秒）。 */
  speed: ParticleRange;
  /** 基础透明度范围，0-1。 */
  opacity: ParticleRange;
  /** 闪烁周期范围（秒）；`[0, 0]` 表示不闪。 */
  twinkle: ParticleRange;
  /** 生成区域，百分比 `[x, y, width, height]`；粒子会被限制在该区域内运动。 */
  area: ParticleArea;
  /** 光晕强度；播放器据此给粒子层叠加模糊，`0` 表示关闭。 */
  glow: number;
  blend: ParticleBlend;
}

/**
 * 舞台 / 标题页上的持续环境特效。
 * 目前只有粒子；未来可加入雨、雾、光斑等，`kind` 用于播放器分派。
 */
export type AmbientEffect = ParticlesEffect;

/** 环境特效类型字面量联合。 */
export type AmbientEffectKind = AmbientEffect['kind'];
