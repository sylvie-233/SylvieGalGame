import { defineConfig } from 'tsup';

/**
 * 播放器构建配置。
 *
 * 粒子库（tsParticles）必须打进本包：Electron 主窗口使用 Vite 7 + Rollup，
 * 解析不到 pnpm 嵌套依赖目录里的 `@tsparticles/plugin-*`；同时 `splitting` 保证
 * 它仍落在动态导入的 ParticleField chunk 中，不进入首屏 bundle。
 * React 等 peer 依赖保持 external，由宿主提供同一份实例。
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  splitting: true,
  noExternal: [/^@tsparticles\//],
});
