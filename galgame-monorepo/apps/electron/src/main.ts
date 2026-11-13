/**
 * Electron 主进程入口。
 *
 * 负责三件事：
 * 1. 注册 `app://`（渲染页面）与 `game://`（游戏资源）自定义协议，所有文件访问统一经过
 *    `resolveInside` 做目录穿越防护；
 * 2. 通过 IPC 向渲染进程暴露受控能力（配置、脚本读取、键值存储、截图、全屏、存读档导入导出、退出），
 *    每个参数都在主进程侧重新校验；
 * 3. 维护窗口状态持久化、运行日志落盘与旧日志轮转。
 *
 * 渲染进程按不可信输入对待：开启 sandbox 与 contextIsolation，且不加载外部脚本。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  access,
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
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

// 自定义协议：app://sylvie 承载渲染产物（响应带 CSP），game://assets 只读地暴露游戏内容目录。
const APP_SCHEME = 'app';
const APP_HOST = 'sylvie';
const APP_ENTRY_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;
const GAME_SCHEME = 'game';
const GAME_HOST = 'assets';
// 键值存档文件名（落在 userData 下）；日志保留天数与单条消息上限用于控制日志体积。
const STORAGE_FILE = 'game-storage.json';
const LOG_RETENTION_DAYS = 7;
const MAX_LOG_MESSAGE_LENGTH = 4000;

/** 运行日志目录：Windows 下为 %APPDATA%/SylvieGalGame/logs。 */
function logDirectory(): string {
  return path.join(app.getPath('userData'), 'logs');
}

// 串行化日志写入，避免并发 appendFile / mkdir 交错；单次失败只打印到控制台，不影响游戏。
let logWriteQueue: Promise<void> = Promise.resolve();

/**
 * 追加一行运行日志。
 * 按 UTC 日期切分文件（runtime-YYYY-MM-DD.log）；单条消息截断到 MAX_LOG_MESSAGE_LENGTH，
 * 换行替换为字面量 `\n`，保证一条记录始终占一行。写入经由队列串行执行。
 */
function logLine(scope: string, level: string, message: string): void {
  const text = message.length > MAX_LOG_MESSAGE_LENGTH ? `${message.slice(0, MAX_LOG_MESSAGE_LENGTH)}…` : message;
  const timestamp = new Date();
  const day = timestamp.toISOString().slice(0, 10);
  const line = `${timestamp.toISOString()} [${level}] [${scope}] ${text.replace(/\r?\n/g, '\\n')}\n`;
  logWriteQueue = logWriteQueue
    .then(async () => {
      await mkdir(logDirectory(), { recursive: true });
      await appendFile(path.join(logDirectory(), `runtime-${day}.log`), line, 'utf8');
    })
    .catch((error: unknown) => {
      console.error('[日志] 写入失败', error);
    });
}

/** 按修改时间删除超过保留期（默认 7 天）的 runtime-*.log；目录不存在或不可读时静默跳过。 */
async function cleanupOldLogs(): Promise<void> {
  const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  try {
    const entries = await readdir(logDirectory(), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !/^runtime-\d{4}-\d{2}-\d{2}\.log$/.test(entry.name)) continue;
      const file = path.join(logDirectory(), entry.name);
      const info = await stat(file).catch(() => null);
      if (info && info.mtimeMs < cutoff) await unlink(file).catch(() => undefined);
    }
  } catch {
    // 日志目录尚未创建或不可读，忽略。
  }
}

// 主进程兜底日志：未捕获异常与未处理 Promise 都落盘，便于排查打包环境问题。
process.on('uncaughtException', (error) => {
  logLine('main', 'error', error.stack ?? `${error.name}: ${error.message}`);
});
process.on('unhandledRejection', (reason) => {
  logLine('main', 'error', `未处理 Promise：${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
});

// 自定义协议不像 HTTP 静态服务器那样有内置映射，需要显式给出扩展名 → Content-Type。
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

// mainWindow：单实例 / macOS activate 时复用；storageCache：game-storage.json 的内存副本；
// storageWriteQueue：保证多次写盘按调用顺序落盘。
let mainWindow: BrowserWindow | null = null;
let storageCache: Record<string, string> | null = null;
let storageWriteQueue: Promise<void> = Promise.resolve();

/**
 * 必须在 app ready 之前注册。
 * standard + secure 让协议拥有正常的 origin 语义（相对路径解析、fetch、存储隔离）；
 * supportFetchAPI / corsEnabled 允许渲染进程 fetch 资源；stream 允许协议返回流式 Response
 *（当前 handler 仍是整块读取文件后返回）。
 */
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

/**
 * 渲染进程 CSP：只允许本地脚本；样式允许内联（Tailwind / 动效会写 style 属性）；
 * 图片、音频与 fetch 额外允许 game: 协议；禁止 object / frame 与外部来源。
 */
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

/**
 * 游戏内容根目录。
 * 优先级：SYLVIE_GAME_ROOT 环境变量（冒烟 / 本地调试）> 打包后的 resources/game >
 * 开发期直接读取 packages/game-content/game。
 */
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

/**
 * 把相对路径解析到 root 内，并拒绝目录穿越。
 * 处理 `../`、绝对路径前缀、Windows 盘符与 NUL 字节；解析结果必须仍是 root 本身或 root 的子路径，
 * 否则返回 null，由调用方回 404。
 */
function resolveInside(root: string, relativePath: string): string | null {
  if (typeof relativePath !== 'string' || relativePath.length === 0) return null;
  if (relativePath.includes('\0')) return null;
  const cleaned = relativePath.replace(/^[/\\]+/, '');
  const resolved = path.resolve(root, cleaned);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

/** 读取文件并构造 Response；文件缺失或不可读统一回 404，避免泄露具体错误。 */
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

/**
 * 注册 app:// 协议。
 * `/` 映射到 index.html，其余路径按渲染产物内的相对路径解析；
 * 渲染产物由 Forge Vite 插件输出到 ../renderer/<MAIN_WINDOW_VITE_NAME>。
 * 所有响应都附带 CSP。
 */
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

/**
 * 注册 game://assets 协议，只读地暴露游戏内容目录。
 * host 必须是 assets；路径同样经过 resolveInside；内容可独立替换，因此禁用缓存。
 */
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

/** 存档文件路径：userData/game-storage.json。 */
function storageFilePath(): string {
  return path.join(app.getPath('userData'), STORAGE_FILE);
}

/**
 * 读取并缓存键值存储。
 * 文件不存在或 JSON 损坏时从空对象开始（不覆盖原始文件，直到下一次写入）；
 * 只接受字符串值，其余字段丢弃。缓存避免每次 IPC 都读盘。
 */
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

/**
 * 把内存副本原子落盘：先写 .tmp 再 rename，避免崩溃时留下半个 JSON。
 * 写入串行排队；返回的 Promise 在本次快照写完（或失败）后 resolve。
 */
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

/** 键名约束：非空字符串且不超过 200 字符，防止异常键名污染存档文件。 */
function isValidKey(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0 && key.length <= 200;
}

/**
 * 注册全部 IPC handler。
 * 渲染进程通过 contextBridge 暴露的 API 调用这些通道；参数来自渲染进程，必须逐项校验类型与范围，
 * 校验失败时返回 null / false / undefined，而不是抛异常。
 */
function registerIpc(): void {
  // 版本、平台与路径等诊断信息；播放器用 logDir / storagePath 提示日志与存档位置。
  ipcMain.handle('game:get-config', () => ({
    appVersion: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
    gameRoot: gameRoot(),
    storagePath: storageFilePath(),
    logDir: logDirectory(),
  }));

  // 读取 UTF-8 文本（YAML 脚本等），路径限制在 gameRoot 内。
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

  // 与 read-text 相同的路径约束，供播放器探测资源是否存在。
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

  // 存储 API 统一读写 game-storage.json 的内存副本；set / delete 后立即排队落盘。
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

  // 截取当前窗口并缩放到 640px 宽，返回 data URL 供存档缩略图使用；失败返回 null。
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

  // 全屏切换返回实际状态：窗口可能被系统策略拒绝或异步生效。
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

  // 导出存读档：弹出系统保存对话框；内容长度上限 20,000,000 字符，超限或写入失败返回 false。
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

  // 导入存读档：弹出系统打开对话框并返回文件文本；取消或读取失败返回 null。
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

/** 只把 http / https 视为外部链接；file:、javascript: 等协议既不打开也不放行。 */
function isExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// 窗口状态持久化：尺寸下限防止读到异常值后窗口缩成一条；上限避免超大坐标撑坏显示。
const WINDOW_STATE_FILE = 'window-state.json';
const MIN_WINDOW_WIDTH = 960;
const MIN_WINDOW_HEIGHT = 540;

/** 持久化的窗口状态；x / y 为 null 表示没有可用的屏幕坐标（首次启动或显示器变化）。 */
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

/**
 * 读取并校正窗口状态。
 * 文件缺失、JSON 损坏或尺寸低于最小值时返回 null，回退默认尺寸；
 * 宽高上限 7680×4320，防止异常值导致窗口不可用。
 */
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

/**
 * 创建主窗口。
 * - webPreferences 采用最小权限：sandbox + contextIsolation，关闭 nodeIntegration 与拼写检查；
 * - 尺寸取自持久化状态（经显示器校验），位置不可见时只恢复尺寸；
 * - resize / move 以 400ms 防抖写盘，关闭时立即写盘；
 * - 外部链接交给系统浏览器，will-navigate 只允许 app:// 或 Vite dev origin；
 * - 打包后禁用 DevTools，开发期可用 F12 切换。
 */
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

  // 拖动 / 缩放会高频触发，合并为 400ms 后写一次盘；close 时立即写盘。
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

/** 应用就绪后的初始化：注册协议 / IPC、清理旧日志、创建主窗口。 */
async function bootstrap(): Promise<void> {
  Menu.setApplicationMenu(null);
  app.setAppUserModelId('com.sylvie.galgame');

  registerAppProtocol();
  registerGameProtocol();
  registerIpc();
  void cleanupOldLogs();
  logLine('main', 'info', `应用启动 v${app.getVersion()}（packaged=${app.isPackaged}）`);

  mainWindow = buildWindow();
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 单实例：拿不到锁的进程直接退出；已运行实例收到 second-instance 时把窗口唤到前台。
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  // 启动失败记录后退出，避免留下没有窗口的后台进程。
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
