import { toJpeg } from 'html-to-image';

import type { PlayerPlatform } from '@sylvie/types';

const STORAGE_PREFIX = 'sylvie:';
const GAME_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/game`;

export interface SylvieWebDebugApi {
  platform: 'web';
  gameBaseUrl: string;
  storageKeys: () => string[];
  storageDelete: (key: string) => void;
  resetStorage: () => void;
}

declare global {
  interface Window {
    sylvieWeb?: SylvieWebDebugApi;
  }
}

function encodeAssetPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function assetUrl(path: string): string {
  const encoded = encodeAssetPath(path);
  return encoded ? `${GAME_BASE}/${encoded}` : GAME_BASE;
}

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22 ||
      error.code === 1014)
  );
}

const storage = {
  async get(key: string): Promise<string | null> {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
  },
  async set(key: string, value: string): Promise<void> {
    try {
      window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, value);
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      throw new Error(
        '浏览器本地存储空间不足。请在控制台执行 window.sylvieWeb.resetStorage() 清理预览存档后重试。',
      );
    }
  },
  async delete(key: string): Promise<void> {
    window.localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
  },
};

function nextFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function captureScreenshot(): Promise<string | null> {
  const root = document.documentElement;
  root.dataset.capture = 'true';
  try {
    await nextFrames();
    // 与 Electron 存档缩略图（640px 宽）保持一致的清晰度。
    const pixelRatio = Math.min(1, 640 / window.innerWidth);
    // localStorage 有容量上限，存档缩略图用 JPEG 压缩，20+ 槽位仍能安全存放。
    return await toJpeg(root, {
      pixelRatio,
      quality: 0.6,
      cacheBust: false,
      backgroundColor: '#06070c',
    });
  } catch (error) {
    console.warn('[Web 截图] 生成失败', error);
    return null;
  } finally {
    delete root.dataset.capture;
  }
}

export const webPlatform: PlayerPlatform = {
  async readText(path) {
    const response = await fetch(assetUrl(path), { cache: 'no-store' });
    if (!response.ok) throw new Error(`无法读取游戏资源：${path}（HTTP ${response.status}）`);
    return response.text();
  },
  async exists(path) {
    try {
      const response = await fetch(assetUrl(path), { method: 'HEAD', cache: 'no-store' });
      return response.ok;
    } catch {
      return false;
    }
  },
  assetUrl,
  storage,
  captureScreenshot,
  async setFullscreen(value) {
    try {
      if (value) {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
        }
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.warn('[Web 全屏] 浏览器拒绝了全屏请求', error);
    }
    return Boolean(document.fullscreenElement);
  },
  async getFullscreen() {
    return Boolean(document.fullscreenElement);
  },
  appVersion: '0.1.0-web',
};

window.sylvieWeb = {
  platform: 'web',
  gameBaseUrl: GAME_BASE,
  storageKeys: () => {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    return keys;
  },
  storageDelete: (key) => void storage.delete(key),
  resetStorage: () => {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(STORAGE_PREFIX)) window.localStorage.removeItem(key);
    }
  },
};
