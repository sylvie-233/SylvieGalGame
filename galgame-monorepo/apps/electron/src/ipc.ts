/**
 * 主进程 IPC 注册。
 *
 * 渲染进程通过 contextBridge 暴露的 API 调用这些通道；参数来自渲染进程，必须逐项校验类型与范围，
 * 校验失败时返回 null / false / undefined，而不是抛异常。
 */
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { app, BrowserWindow, dialog, ipcMain } from 'electron';

import { isValidKey, loadStorage, persistStorage, storageFilePath } from './game-storage';
import { logDirectory } from './logging';
import { gameRoot, resolveInside } from './protocols';

export function registerIpc(): void {
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

  // 写盘失败时回滚内存副本并把错误抛回渲染进程，避免界面提示「已保存」但磁盘没有数据。
  ipcMain.handle('storage:set', async (_event, key: unknown, value: unknown) => {
    if (!isValidKey(key) || typeof value !== 'string') return;
    const store = await loadStorage();
    const previous = store[key];
    store[key] = value;
    try {
      await persistStorage();
    } catch (error) {
      // 仅当该键仍保持本次写入的值时回滚，避免覆盖期间其他请求写入的新值。
      if (store[key] === value) {
        if (previous === undefined) delete store[key];
        else store[key] = previous;
      }
      console.error('[存储] 保存失败', error);
      throw new Error('存档写入失败');
    }
  });

  ipcMain.handle('storage:delete', async (_event, key: unknown) => {
    if (!isValidKey(key)) return;
    const store = await loadStorage();
    const previous = store[key];
    delete store[key];
    try {
      await persistStorage();
    } catch (error) {
      // 删除期间若已有新写入，保留新值；否则恢复被删除的旧值。
      if (!Object.prototype.hasOwnProperty.call(store, key) && previous !== undefined) {
        store[key] = previous;
      }
      console.error('[存储] 删除失败', error);
      throw new Error('存档删除失败');
    }
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
