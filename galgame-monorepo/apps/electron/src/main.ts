import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  screen,
  shell,
} from 'electron';

const APP_SCHEME = 'app';
const APP_HOST = 'sylvie';
const APP_ENTRY_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;
const GAME_SCHEME = 'game';
const GAME_HOST = 'assets';
const STORAGE_FILE = 'game-storage.json';

const MIME_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
};

let mainWindow: BrowserWindow | null = null;
let storageCache: Record<string, string> | null = null;
let storageWriteQueue: Promise<void> = Promise.resolve();

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
  {
    scheme: GAME_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' game: data: blob:",
    "media-src 'self' game: data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' game:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-src 'none'",
  ].join('; ');
}

function mimeType(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function gameRoot(): string {
  if (process.env.SYLVIE_GAME_ROOT) {
    return path.resolve(process.env.SYLVIE_GAME_ROOT);
  }
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'game');
  }
  // 开发期直接读取内容包，内容可独立替换。
  return path.resolve(__dirname, '../../../../packages/game-content/game');
}

function resolveInside(root: string, relativePath: string): string | null {
  if (typeof relativePath !== 'string' || relativePath.length === 0) return null;
  if (relativePath.includes('\0')) return null;
  const cleaned = relativePath.replace(/^[/\\]+/, '');
  const resolved = path.resolve(root, cleaned);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

async function fileResponse(filePath: string, extraHeaders: Record<string, string> = {}) {
  try {
    const data = await readFile(filePath);
    return new Response(data, {
      headers: {
        'content-type': mimeType(filePath),
        'x-content-type-options': 'nosniff',
        ...extraHeaders,
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

function registerAppProtocol(): void {
  const rendererRoot = path.resolve(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);

  protocol.handle(APP_SCHEME, async (request) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return new Response('Bad request', { status: 400 });
    }

    const relative =
      pathname === '/' || pathname === '' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = resolveInside(rendererRoot, relative);
    if (!filePath) return new Response('Not found', { status: 404 });

    return fileResponse(filePath, {
      'content-security-policy': contentSecurityPolicy(),
    });
  });
}

function registerGameProtocol(): void {
  const root = path.resolve(gameRoot());

  protocol.handle(GAME_SCHEME, async (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    if (url.host !== GAME_HOST) return new Response('Not found', { status: 404 });

    let relative: string;
    try {
      relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    } catch {
      return new Response('Bad request', { status: 400 });
    }

    const filePath = resolveInside(root, relative);
    if (!filePath) return new Response('Not found', { status: 404 });

    return fileResponse(filePath, { 'cache-control': 'no-store' });
  });
}

function storageFilePath(): string {
  return path.join(app.getPath('userData'), STORAGE_FILE);
}

async function loadStorage(): Promise<Record<string, string>> {
  if (storageCache) return storageCache;

  try {
    const text = await readFile(storageFilePath(), 'utf8');
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const map: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === 'string') map[key] = value;
      }
      storageCache = map;
      return map;
    }
  } catch {
    // 首次运行或文件损坏：从空存储开始。
  }

  storageCache = {};
  return storageCache;
}

function persistStorage(): Promise<void> {
  const snapshot = JSON.stringify(storageCache ?? {}, null, 2);
  storageWriteQueue = storageWriteQueue
    .then(async () => {
      const file = storageFilePath();
      await mkdir(path.dirname(file), { recursive: true });
      const temp = `${file}.tmp`;
      await writeFile(temp, snapshot, 'utf8');
      await rename(temp, file);
    })
    .catch((error: unknown) => {
      console.error('[存储] 写入失败', error);
    });
  return storageWriteQueue;
}

function isValidKey(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0 && key.length <= 200;
}

function registerIpc(): void {
  ipcMain.handle('game:get-config', () => ({
    appVersion: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
    gameRoot: gameRoot(),
  }));

  ipcMain.handle('game:read-text', async (_event, relativePath: unknown) => {
    if (typeof relativePath !== 'string') return null;
    const filePath = resolveInside(path.resolve(gameRoot()), relativePath);
    if (!filePath) return null;
    try {
      return await readFile(filePath, 'utf8');
    } catch {
      return null;
    }
  });

  ipcMain.handle('game:exists', async (_event, relativePath: unknown) => {
    if (typeof relativePath !== 'string') return false;
    const filePath = resolveInside(path.resolve(gameRoot()), relativePath);
    if (!filePath) return false;
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('storage:get', async (_event, key: unknown) => {
    if (!isValidKey(key)) return null;
    const store = await loadStorage();
    return store[key] ?? null;
  });

  ipcMain.handle('storage:set', async (_event, key: unknown, value: unknown) => {
    if (!isValidKey(key) || typeof value !== 'string') return;
    const store = await loadStorage();
    store[key] = value;
    await persistStorage();
  });

  ipcMain.handle('storage:delete', async (_event, key: unknown) => {
    if (!isValidKey(key)) return;
    const store = await loadStorage();
    delete store[key];
    await persistStorage();
  });

  ipcMain.handle('window:capture-screenshot', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;
    try {
      const image = await window.capturePage();
      const size = image.getSize();
      const resized = size.width > 640 ? image.resize({ width: 640 }) : image;
      return resized.toDataURL();
    } catch (error) {
      console.error('[截图] 失败', error);
      return null;
    }
  });

  ipcMain.handle('window:set-fullscreen', (event, value: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;
    window.setFullScreen(Boolean(value));
    return window.isFullScreen();
  });

  ipcMain.handle('window:get-fullscreen', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window?.isFullScreen() ?? false;
  });

  ipcMain.handle('file:save-text', async (event, filename: unknown, content: unknown) => {
    if (typeof content !== 'string' || content.length > 20_000_000) return false;
    const suggested = typeof filename === 'string' && filename ? filename : 'sylvie-saves.json';
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      defaultPath: suggested,
      filters: [{ name: '存档 JSON', extensions: ['json'] }],
    };
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return false;
    try {
      await writeFile(result.filePath, content, 'utf8');
      return true;
    } catch (error) {
      console.error('[导出] 写入失败', error);
      return false;
    }
  });

  ipcMain.handle('file:open-text', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      properties: ['openFile' as const],
      filters: [{ name: '存档 JSON', extensions: ['json'] }],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    const file = result.filePaths[0];
    if (result.canceled || !file) return null;
    try {
      return await readFile(file, 'utf8');
    } catch (error) {
      console.error('[导入] 读取失败', error);
      return null;
    }
  });

  ipcMain.handle('app:quit', () => {
    app.quit();
  });
}

function isExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const WINDOW_STATE_FILE = 'window-state.json';
const MIN_WINDOW_WIDTH = 960;
const MIN_WINDOW_HEIGHT = 540;

interface WindowState {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
  maximized: boolean;
}

function windowStatePath(): string {
  return path.join(app.getPath('userData'), WINDOW_STATE_FILE);
}

function readWindowState(): WindowState | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(windowStatePath(), 'utf8'));
    if (typeof raw !== 'object' || raw === null) return null;
    const record = raw as Record<string, unknown>;
    const width = typeof record.width === 'number' ? Math.round(record.width) : 0;
    const height = typeof record.height === 'number' ? Math.round(record.height) : 0;
    if (width < MIN_WINDOW_WIDTH || height < MIN_WINDOW_HEIGHT) return null;
    return {
      width: Math.min(7680, width),
      height: Math.min(4320, height),
      x: typeof record.x === 'number' ? Math.round(record.x) : null,
      y: typeof record.y === 'number' ? Math.round(record.y) : null,
      maximized: record.maximized === true,
    };
  } catch {
    return null;
  }
}

/** 窗口位置必须与某个显示器工作区相交，避免拔出外接屏后窗口移到屏幕外。 */
function boundsVisibleOnAnyDisplay(state: WindowState): boolean {
  const { x, y } = state;
  if (x === null || y === null) return false;
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      x < area.x + area.width &&
      x + state.width > area.x &&
      y < area.y + area.height &&
      y + state.height > area.y
    );
  });
}

function buildWindow(): BrowserWindow {
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

  let stateTimer: ReturnType<typeof setTimeout> | null = null;
  const persistWindowState = () => {
    try {
      const bounds = window.getNormalBounds();
      const state: WindowState = {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized: window.isMaximized(),
      };
      mkdirSync(path.dirname(windowStatePath()), { recursive: true });
      writeFileSync(windowStatePath(), JSON.stringify(state), 'utf8');
    } catch (error) {
      console.warn('[窗口] 保存窗口状态失败', error);
    }
  };
  const scheduleWindowState = () => {
    if (stateTimer) clearTimeout(stateTimer);
    stateTimer = setTimeout(() => {
      stateTimer = null;
      persistWindowState();
    }, 400);
  };
  window.on('resize', scheduleWindowState);
  window.on('move', scheduleWindowState);
  window.on('close', () => {
    if (stateTimer) clearTimeout(stateTimer);
    stateTimer = null;
    persistWindowState();
  });

  if (saved?.maximized) {
    window.maximize();
  }

  window.once('ready-to-show', () => {
    window.show();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

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

  if (!app.isPackaged) {
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        event.preventDefault();
        window.webContents.toggleDevTools();
      }
    });
  }

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void window.loadURL(APP_ENTRY_URL);
  }

  return window;
}

async function bootstrap(): Promise<void> {
  Menu.setApplicationMenu(null);
  app.setAppUserModelId('com.sylvie.galgame');

  registerAppProtocol();
  registerGameProtocol();
  registerIpc();

  mainWindow = buildWindow();
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(bootstrap).catch((error: unknown) => {
    console.error('[桌面端] 启动失败', error);
    app.quit();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = buildWindow();
    }
  });
}
