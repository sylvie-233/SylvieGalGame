/**
 * Electron 主进程入口：应用生命周期、单实例与主窗口持有。
 *
 * 具体职责拆分在独立模块：
 * - protocols.ts：app:// / game:// 协议与游戏资源路径解析；
 * - ipc.ts：渲染进程可调用的受控 IPC；
 * - game-storage.ts：game-storage.json 的内存副本与原子写盘；
 * - logging.ts：运行日志与进程级兜底日志；
 * - window.ts / window-state.ts：主窗口创建、导航策略与窗口状态持久化。
 *
 * 渲染进程按不可信输入对待：开启 sandbox 与 contextIsolation，且不加载外部脚本。
 */
import { app, BrowserWindow, Menu } from 'electron';

import { whenStorageWritesSettled } from './game-storage';
import { registerIpc } from './ipc';
import { cleanupOldLogs, logLine } from './logging';
import { registerAppProtocol, registerGameProtocol, registerSchemePrivileges } from './protocols';
import { buildWindow } from './window';

// mainWindow：单实例 / macOS activate 时复用。
let mainWindow: BrowserWindow | null = null;

// 自定义协议必须在 app ready 之前注册。
registerSchemePrivileges();

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

  // 退出前等待写盘队列落定，确保最后一次自动 / 手动存档不会因直接 quit 而丢失。
  // 只拦截一次：队列结束后再次 app.quit()，第二次 before-quit 直接放行。
  // 最多等 3 秒，避免磁盘异常时应用无法退出。
  let quittingAfterStorageFlush = false;
  app.on('before-quit', (event) => {
    if (quittingAfterStorageFlush) return;
    quittingAfterStorageFlush = true;
    event.preventDefault();
    const timeout = new Promise<void>((resolve) => {
      setTimeout(resolve, 3000);
    });
    void Promise.race([whenStorageWritesSettled(), timeout]).finally(() => {
      app.quit();
    });
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
