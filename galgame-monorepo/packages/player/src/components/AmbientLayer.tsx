import type { AmbientEffect } from '@sylvie/types';
import { lazy, Suspense } from 'react';

// 粒子库（tsParticles ~100 KB）只在真有 particle 特效时下载，不进主 bundle。
const ParticleField = lazy(() =>
  import('./ParticleField').then((module) => ({ default: module.ParticleField })),
);

interface AmbientLayerProps {
  /** 引擎快照中的持续特效；空数组时整层不渲染。 */
  effects: AmbientEffect[];
  /** 定位 / 层级类名，由标题页或舞台决定。 */
  className?: string;
}

/**
 * 持续环境特效层：按 `effect.kind` 分派到具体渲染组件。
 *
 * 特效配置完全来自 YAML，标题页与任意场景共用同一套渲染。
 * 以后新增雨、雾、光斑等类型时，只需在这里增加分支并实现组件，
 * 不必改动标题页与舞台的接入代码。
 */
export function AmbientLayer({ effects, className = '' }: AmbientLayerProps) {
  if (effects.length === 0) return null;

  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      aria-hidden="true"
    >
      <Suspense fallback={null}>
        {effects.map((effect, index) => {
          if (effect.kind === 'particles') {
            // key 只区分同类特效的叠放顺序；配置变化由 effect 对象引用驱动重新加载。
            return <ParticleField key={`particles-${index}`} effect={effect} />;
          }
          return null;
        })}
      </Suspense>
    </div>
  );
}
