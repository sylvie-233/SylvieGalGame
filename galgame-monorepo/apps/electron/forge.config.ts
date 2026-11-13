/**
 * Electron Forge 配置：构建、打包（免安装目录）与生成 NSIS 安装包。
 * 主进程 / preload 由 Vite 插件编译；游戏内容以 extraResource 形式随包分发。
 */
import path from 'node:path';

import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';
import MakerNsis from 'electron-forge-maker-nsis';

// 内容包的唯一来源；开发期直接读取，打包时复制到 resources/game。
const GAME_CONTENT_ROOT = path.resolve(__dirname, '../../packages/game-content/game');

// 可选签名：设置 WINDOWS_CERTIFICATE_FILE / WINDOWS_CERTIFICATE_PASSWORD 后，
// electron-packager 与 NSIS maker 都会对 exe / 安装包签名；未设置时保持未签名产物。
// 密码不落盘，只从 CI / 本地环境变量读取；若证书文件存在但密码为空，签名通常会在打包阶段失败。
const certificateFile = process.env.WINDOWS_CERTIFICATE_FILE;
const certificatePassword = process.env.WINDOWS_CERTIFICATE_PASSWORD;
const windowsSign = certificateFile
  ? { certificateFile, certificatePassword, description: 'Sylvie Galgame' }
  : undefined;

const config: ForgeConfig = {
  packagerConfig: {
    // 源码打进 asar，增加随意翻改的门槛；游戏资源通过 extraResource 放在 asar 外。
    asar: true,
    executableName: 'SylvieGalGame',
    icon: path.resolve(__dirname, 'assets/icon'),
    // 内容与外壳分离：打包时把 game-content 挂到 resources/game，替换内容不必重打 exe。
    extraResource: [GAME_CONTENT_ROOT],
    win32metadata: {
      CompanyName: 'Sylvie',
      FileDescription: 'Sylvie Galgame 视觉小说播放器',
      ProductName: 'SylvieGalGame',
    },
    // 未配置证书时完全不传 windowsSign，避免 packager 认为要签名却缺少参数。
    ...(windowsSign ? { windowsSign } : {}),
  },
  rebuildConfig: {},
  makers: [
    // NSIS：交互式安装向导（非一键安装）、允许改安装目录、按当前用户安装，
    // language 2052 为简体中文；证书参数需单独传给 maker，才能同时签安装包与卸载器。
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
      ...(certificateFile ? { certificateFile, certificatePassword } : {}),
    }),
  ],
  plugins: [
    // main / preload 分别用各自的 Vite 配置构建；renderer 名称 main_window 决定
    // 注入 main.ts 的 MAIN_WINDOW_VITE_NAME 与产物目录。
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
