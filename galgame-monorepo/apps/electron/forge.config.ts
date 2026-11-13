import path from 'node:path';

import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';
import MakerNsis from 'electron-forge-maker-nsis';

const GAME_CONTENT_ROOT = path.resolve(__dirname, '../../packages/game-content/game');

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    executableName: 'SylvieGalGame',
    icon: path.resolve(__dirname, 'assets/icon'),
    // 内容与外壳分离：打包时把 game-content 挂到 resources/game。
    extraResource: [GAME_CONTENT_ROOT],
    win32metadata: {
      CompanyName: 'Sylvie',
      FileDescription: 'Sylvie Galgame 视觉小说播放器',
      ProductName: 'SylvieGalGame',
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerNsis({
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      perMachine: false,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: 'Sylvie Galgame',
      uninstallDisplayName: 'Sylvie Galgame',
      artifactName: 'SylvieGalGame-Setup-${version}.${ext}',
      installerIcon: path.resolve(__dirname, 'assets/icon.ico'),
      uninstallerIcon: path.resolve(__dirname, 'assets/icon.ico'),
      language: '2052',
    }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;
