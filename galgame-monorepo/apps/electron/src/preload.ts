import { contextBridge, ipcRenderer } from 'electron';

import type { DesktopConfig, SylvieDesktopApi } from './desktop-types';

const api: SylvieDesktopApi = {
  getConfig: () => ipcRenderer.invoke('game:get-config') as Promise<DesktopConfig>,
  readText: (relativePath) => ipcRenderer.invoke('game:read-text', relativePath) as Promise<string | null>,
  exists: (relativePath) => ipcRenderer.invoke('game:exists', relativePath) as Promise<boolean>,
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
  quit: () => ipcRenderer.invoke('app:quit') as Promise<void>,
};

contextBridge.exposeInMainWorld('sylvieGame', api);
