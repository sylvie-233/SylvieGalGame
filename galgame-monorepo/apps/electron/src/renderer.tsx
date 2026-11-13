/**
 * Electron 渲染进程入口：
 * 读取桌面配置，把 `window.sylvieGame` 适配成 PlayerPlatform 后挂载播放器。
 * 播放器本身不接触 Electron API，宿主差异全部收敛在 configurePlayer 注入的平台对象里。
 */
import { createMinigameLoaders } from '@sylvie/minigames';
import { configurePlayer, ErrorBoundary, GameApp } from '@sylvie/player';
import { createRoot } from 'react-dom/client';

import './index.css';
import type { DesktopConfig } from './desktop-types';

/** React 挂载前失败时的纯 DOM 兜底错误页，避免依赖 React 自身能否正常启动。 */
function renderFatal(message: string): void {
  const container = document.getElementById('root');
  if (!container) return;
  container.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.style.cssText =
    'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:8vw;text-align:center;background:radial-gradient(circle at center,#16101a,#05060a 70%);color:#f3eee8;font-family:sans-serif;';
  const title = document.createElement('h1');
  title.textContent = '桌面端启动失败';
  title.style.cssText = 'margin:0;font-size:28px;letter-spacing:0.16em;color:#e69ab4;';
  const detail = document.createElement('p');
  detail.textContent = message;
  detail.style.cssText = 'margin:0;max-width:640px;font-size:14px;line-height:1.8;color:#aaa2a2;';
  wrapper.append(title, detail);
  container.append(wrapper);
}

/** 校验 preload 桥接、注入平台能力并挂载 GameApp。 */
async function boot(): Promise<void> {
  const desktop = window.sylvieGame;
  if (!desktop) {
    renderFatal('未检测到 Electron 预加载桥接，请在桌面端中运行。');
    return;
  }

  const config: DesktopConfig = await desktop.getConfig();
  console.info(`[桌面端] 渲染进程启动 v${config.appVersion}`);

  // 把 IPC 方法适配成播放器约定的平台接口；读取失败统一抛错，由播放器显示脚本警告。
  configurePlayer({
    readText: async (path) => {
      const text = await desktop.readText(path);
      if (text === null) throw new Error(`无法读取游戏脚本：${path}`);
      return text;
    },
    exists: (path) => desktop.exists(path),
    assetUrl: (path) => desktop.assetUrl(path),
    storage: {
      get: (key) => desktop.storageGet(key),
      set: (key, value) => desktop.storageSet(key, value),
      delete: (key) => desktop.storageDelete(key),
    },
    // 截图前临时标记 data-capture 并等两帧，让播放器隐藏 UI 控件后再调 capturePage。
    captureScreenshot: async () => {
      const root = document.documentElement;
      root.dataset.capture = 'true';
      try {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        return await desktop.captureScreenshot();
      } finally {
        delete root.dataset.capture;
      }
    },
    setFullscreen: (value) => desktop.setFullscreen(value),
    getFullscreen: () => desktop.getFullscreen(),
    minigames: createMinigameLoaders(),
    saveTextFile: (filename, content) => desktop.saveTextFile(filename, content),
    openTextFile: () => desktop.openTextFile(),
    quit: () => {
      void desktop.quit();
    },
    appVersion: config.appVersion,
    logPath: config.logDir,
    storagePath: config.storagePath,
  });

  const container = document.getElementById('root');
  if (!container) {
    renderFatal('页面缺少 #root 容器。');
    return;
  }

  // ErrorBoundary 兜住渲染异常，避免整页白屏；只剩纯文本错误提示可读。
  createRoot(container).render(
    <ErrorBoundary>
      <GameApp />
    </ErrorBoundary>,
  );
}

void boot().catch((error: unknown) => {
  console.error('[渲染进程] 启动失败', error);
  renderFatal(error instanceof Error ? error.message : String(error));
});
