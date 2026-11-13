/**
 * 预加载脚本：通过 contextBridge 把受控的桌面能力暴露为 `window.sylvieGame`。
 *
 * 渲染进程开启了 sandbox + contextIsolation，拿不到 Node 与 ipcRenderer 本体，
 * 只能调用这里列出的通道；真正的路径校验、存储约束等仍由主进程的 ipcMain.handle 执行。
 */
import { contextBridge, ipcRenderer } from 'electron';

import type { DesktopConfig, SylvieDesktopApi } from './desktop-types';

// 方法名与 PlayerPlatform 所需能力一一对应，渲染进程只依赖这个窄接口。
const api: SylvieDesktopApi = {
  getConfig: () => ipcRenderer.invoke('game:get-config') as Promise<DesktopConfig>,
  readText: (relativePath) => ipcRenderer.invoke('game:read-text', relativePath) as Promise<string | null>,
  exists: (relativePath) => ipcRenderer.invoke('game:exists', relativePath) as Promise<boolean>,
  // 逐段 encodeURIComponent 后拼成 game://assets/ URL：保留 / 分隔，并避免 #、?、空格破坏 URL。
  assetUrl: (relativePath) => {
    const segments = relativePath
      .replace(/\\/g, '/')
      .split('/')
      .map((segment) => encodeURIComponent(segment));
    return `game://assets/${segments.join('/')}`;
  },
  storageGet: (key) => ipcRenderer.invoke('storage:get', key) as Promise<string | null>,
  storageSet: (key, value) => ipcRenderer.invoke('storage:set', key, value) as Promise<void>,
  storageDelete: (key) => ipcRenderer.invoke('storage:delete', key) as Promise<void>,
  captureScreenshot: () =>
    ipcRenderer.invoke('window:capture-screenshot') as Promise<string | null>,
  setFullscreen: (value) => ipcRenderer.invoke('window:set-fullscreen', value) as Promise<boolean>,
  getFullscreen: () => ipcRenderer.invoke('window:get-fullscreen') as Promise<boolean>,
  saveTextFile: (filename, content) =>
    ipcRenderer.invoke('file:save-text', filename, content) as Promise<boolean>,
  openTextFile: () => ipcRenderer.invoke('file:open-text') as Promise<string | null>,
  quit: () => ipcRenderer.invoke('app:quit') as Promise<void>,
};

// 只在 window 上挂一个命名空间，不暴露 ipcRenderer 或任何 Node 对象。
contextBridge.exposeInMainWorld('sylvieGame', api);
