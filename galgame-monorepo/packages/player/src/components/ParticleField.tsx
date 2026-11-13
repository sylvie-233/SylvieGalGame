import type { ParticleRange, ParticlesEffect } from '@sylvie/types';
import { loadBasic } from '@tsparticles/basic';
import type { Container, ISourceOptions } from '@tsparticles/engine';
import { Particles, ParticlesProvider } from '@tsparticles/react';
import { useCallback, useId, useMemo } from 'react';

interface ParticleFieldProps {
  /** 引擎解析后的完整粒子配置；对象引用变化时由库重新加载。 */
  effect: ParticlesEffect;
}

/** tsParticles 的 `size` 是半径，YAML 里的 `size` 是直径。 */
const RADIUS_PER_DIAMETER = 1 / 2;

/**
 * tsParticles 的 `move.speed` 以「每 60 帧移动 speed / 2 像素」为基准，
 * 换算成像素 / 秒约为 30 倍，因此 YAML 里的 px/s 需要除以 30。
 */
const LIBRARY_SPEED_PER_PX = 1 / 30;

/** 透明度动画 `speed=100` 表示每帧走完整段 0-1；据此把闪烁周期换算成动画速度。 */
const OPACITY_SPEED_PER_SECOND = 200 / 60;

/**
 * 基础粒子只有实心圆，没有径向光晕。播放器用「放大半径 + CSS 模糊」模拟旧版光晕：
 * 倍率随 glow 增长，模糊半径与核心尺寸同一量级，避免粒子退化成尖锐小点。
 */
const GLOW_RADIUS_BASE = 0.75;
const GLOW_RADIUS_SCALE = 0.35;
const GLOW_BLUR = 0.9;

/**
 * 引擎初始化只执行一次；tsParticles 的 React 包装器要求回调保持稳定引用。
 * 这个函数必须定义在模块顶层，否则 Provider 会在重渲染时报错。
 */
export async function initParticlesEngine(engine: Parameters<typeof loadBasic>[0]): Promise<void> {
  await loadBasic(engine);
}

/**
 * 把 YAML 配置映射成 tsParticles 选项。
 * 只使用 `@tsparticles/basic` 内置的能力：圆形粒子、填充颜色、尺寸、透明度动画、
 * 移动与出界反弹；光晕与混合方式由播放器用 CSS 叠加。
 */
function buildOptions(effect: ParticlesEffect): ISourceOptions {
  // glow=0 时仍按原始直径渲染，不小于 1，避免粒子意外缩小。
  const glowScale = Math.max(1, GLOW_RADIUS_BASE + GLOW_RADIUS_SCALE * effect.glow);
  const [sizeMin, sizeMax] = effect.size;
  const radiusMin = sizeMin * RADIUS_PER_DIAMETER * glowScale;
  const radiusMax = sizeMax * RADIUS_PER_DIAMETER * glowScale;
  const [opacityMin, opacityMax] = effect.opacity;
  const twinkleSpeed = getTwinkleSpeed(effect.twinkle, opacityMax - opacityMin);
  const [speedMin, speedMax] = effect.speed;

  return {
    fullScreen: { enable: false },
    detectRetina: true,
    fpsLimit: 60,
    pauseOnBlur: true,
    particles: {
      // 固定数量，不按画布面积增减；区域由外层包裹层限定。
      number: { value: effect.count, density: { enable: false } },
      paint: {
        // 颜色列表让库为每颗粒子随机取一种颜色。
        color: { value: effect.colors },
        fill: { enable: true },
      },
      size: {
        value: { min: radiusMin, max: radiusMax },
      },
      opacity: {
        value: { min: opacityMin, max: opacityMax },
        animation: twinkleSpeed
          ? {
              enable: true,
              // 随机起点 + 相同速度：错落闪烁，又不会整层同步明灭。
              mode: 'auto',
              startValue: 'random',
              sync: true,
              count: 0,
              speed: twinkleSpeed,
            }
          : { enable: false },
      },
      move: {
        enable: true,
        direction: 'none',
        speed: {
          min: speedMin * LIBRARY_SPEED_PER_PX,
          max: speedMax * LIBRARY_SPEED_PER_PX,
        },
        // 粒子到达区域边缘后反弹，保证数量不会随时间减少。
        outModes: { default: 'bounce' },
      },
    },
  };
}

/**
 * 把闪烁周期范围换算成透明度动画速度范围。
 * 周期越短速度越快；`[0, 0]` 或透明度区间为 0 时不启用动画。
 */
function getTwinkleSpeed(
  [shortest, longest]: ParticleRange,
  opacityRange: number,
): { min: number; max: number } | undefined {
  if (longest <= 0 || opacityRange <= 0) return undefined;
  const fastPeriod = shortest > 0 ? shortest : longest;
  const factor = OPACITY_SPEED_PER_SECOND * opacityRange;
  return { min: factor / longest, max: factor / fastPeriod };
}

/**
 * 粒子特效层。
 *
 * 配置全部来自快照，渲染交给 tsParticles；组件只负责：
 * - 把 `area` 百分比换算成包裹层的定位与尺寸；
 * - 用 `blend` / `glow` 做 CSS 层叠与光晕；
 * - 系统开启「减少动态效果」时在加载后暂停容器，只保留首帧静态画面。
 *
 * 粒子库由 `AmbientLayer` 懒加载，没有粒子特效的页面不会下载该 chunk。
 */
export function ParticleField({ effect }: ParticleFieldProps) {
  // React 的 useId 含冒号，去掉后作为 DOM id 与 tsParticles 容器 id 更稳妥。
  const id = `sylvie-particles-${useId().replace(/:/g, '')}`;
  const options = useMemo(() => buildOptions(effect), [effect]);

  const particlesLoaded = useCallback((container?: Container) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      container?.pause();
    }
  }, []);

  // 区域宽或高为 0 时没有可绘制空间，直接跳过，避免库用 0 尺寸画布。
  if (effect.area[2] <= 0 || effect.area[3] <= 0) return null;

  const [x, y, width, height] = effect.area;
  const blur = Math.max(0, effect.glow - 1) * GLOW_BLUR;

  return (
    <ParticlesProvider init={initParticlesEngine}>
      <Particles
        id={id}
        options={options}
        particlesLoaded={particlesLoaded}
        style={{
          position: 'absolute',
          left: `${x}%`,
          top: `${y}%`,
          width: `${width}%`,
          height: `${height}%`,
          pointerEvents: 'none',
          mixBlendMode: effect.blend,
          filter: blur > 0 ? `blur(${blur}px)` : undefined,
        }}
      />
    </ParticlesProvider>
  );
}
