/**
 * 主窗口创建与窗口级事件。
 *
 * 尺寸取自持久化状态并做显示器校验；外部链接交给系统浏览器；
 * 渲染进程日志、崩溃与加载失败统一写入运行日志。
 */
import path from 'node:path';

import { app, BrowserWindow, shell } from 'electron';

import { logLine } from './logging';
import { APP_ENTRY_URL, APP_HOST, APP_SCHEME } from './protocols';
import {
  boundsVisibleOnAnyDisplay,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  persistWindowState,
  readWindowState,
} from './window-state';

/** 只把 http / https 视为外部链接；file:、javascript: 等协议既不打开也不放行。 */
function isExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 创建主窗口。
 * - webPreferences 采用最小权限：sandbox + contextIsolation，关闭 nodeIntegration 与拼写检查；
 * - 尺寸取自持久化状态（经显示器校验），位置不可见时只恢复尺寸；
 * - resize / move 以 400ms 防抖写盘，关闭时立即写盘；
 * - 外部链接交给系统浏览器，will-navigate 只允许 app:// 或 Vite dev origin；
 * - 打包后禁用 DevTools，开发期可用 F12 切换。
 */
export function buildWindow(): BrowserWindow {
  const saved = readWindowState();
  const usePosition = saved ? boundsVisibleOnAnyDisplay(saved) : false;
  const window = new BrowserWindow({
    width: saved?.width ?? 1280,
    height: saved?.height ?? 720,
    ...(usePosition && saved ? { x: saved.x ?? undefined, y: saved.y ?? undefined } : {}),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#06070c',
    title: 'Sylvie Galgame',
    icon: path.resolve(__dirname, '../../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });

  // 拖动 / 缩放会高频触发，合并为 400ms 后写一次盘；close 时立即写盘。
  let stateTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleWindowState = () => {
    if (stateTimer) clearTimeout(stateTimer);
    stateTimer = setTimeout(() => {
      stateTimer = null;
      persistWindowState(window);
    }, 400);
  };
  window.on('resize', scheduleWindowState);
  window.on('move', scheduleWindowState);
  window.on('close', () => {
    if (stateTimer) clearTimeout(stateTimer);
    stateTimer = null;
    persistWindowState(window);
  });

  if (saved?.maximized) {
    window.maximize();
  }

  window.webContents.on('console-message', (details) => {
    logLine(
      'renderer',
      details.level,
      `${details.message}（${details.sourceId || '未知来源'}:${details.lineNumber}）`,
    );
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    logLine('renderer', 'error', `渲染进程退出：${details.reason}（exitCode=${details.exitCode}）`);
  });
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    logLine('renderer', 'error', `页面加载失败：${code} ${description} ${url}`);
  });
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    logLine('renderer', 'error', `preload 失败：${preloadPath}\n${error.stack ?? error.message}`);
  });
  window.on('unresponsive', () => {
    logLine('window', 'warning', '窗口无响应');
  });

  // show: false 等首帧准备好再显示，避免启动白屏闪烁。
  window.once('ready-to-show', () => {
    window.show();
  });

  // 禁止在应用内开新窗口；外部 http(s) 链接改用系统浏览器打开。
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // 导航白名单：打包后只允许 app://sylvie/，开发期允许 Vite dev server 的 origin。
  window.webContents.on('will-navigate', (event, targetUrl) => {
    const devOrigin = MAIN_WINDOW_VITE_DEV_SERVER_URL
      ? new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin
      : null;
    let allowed = targetUrl.startsWith(`${APP_SCHEME}://${APP_HOST}/`);
    if (devOrigin) {
      try {
        allowed = new URL(targetUrl).origin === devOrigin;
      } catch {
        allowed = false;
      }
    }
    if (!allowed) {
      event.preventDefault();
      if (isExternalUrl(targetUrl)) {
        void shell.openExternal(targetUrl);
      }
    }
  });

  // 仅开发期允许 F12 打开 DevTools，打包产物不暴露调试入口。
  if (!app.isPackaged) {
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        event.preventDefault();
        window.webContents.toggleDevTools();
      }
    });
  }

  // 开发期连 Vite dev server 获得热更新，打包后走 app:// 协议加载静态产物。
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void window.loadURL(APP_ENTRY_URL);
  }

  return window;
}
