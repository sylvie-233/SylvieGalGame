import { defineConfig } from 'tsup';

/**
 * 小游戏包的构建配置。
 *
 * `index` 提供 loader 注册表，`echo/index` 是一个独立 chunk；`index` 通过动态
 * `import('./echo/index.js')` 按需加载它，因此 Phaser 不会进入播放器首屏包。
 * `splitting` 必须开启，否则 esbuild 会把 echo 场景内联回 index，失去懒加载意义。
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'echo/index': 'src/echo/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  splitting: true,
  sourcemap: true,
  // 依赖由宿主打包器解析，不作为本包运行时依赖打进每个 chunk。
  external: ['phaser', '@sylvie/types'],
});
