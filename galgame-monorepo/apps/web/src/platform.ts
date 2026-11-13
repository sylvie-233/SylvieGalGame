import { toJpeg } from 'html-to-image';

import type { PlayerPlatform } from '@sylvie/types';

const STORAGE_PREFIX = 'sylvie:';
const GAME_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/game`;

export interface SylvieWebDebugApi {
  platform: 'web';
  gameBaseUrl: string;
  storageKeys: () => Promise<string[]>;
  storageDelete: (key: string) => Promise<void>;
  resetStorage: () => Promise<void>;
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

const DB_NAME = 'sylvie-web';
const DB_VERSION = 1;
const STORE_NAME = 'kv';

let databasePromise: Promise<IDBDatabase | null> | null = null;

function idbGet(db: IDBDatabase, key: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null);
    request.onerror = () => reject(request.error);
  });
}

function idbSet(db: IDBDatabase, key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function idbDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function idbKeys(db: IDBDatabase): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAllKeys();
    request.onsuccess = () =>
      resolve(request.result.filter((key): key is string => typeof key === 'string'));
    request.onerror = () => reject(request.error);
  });
}

function idbClear(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

/** 把旧版本写在 localStorage 的 sylvie: 键迁移进 IndexedDB，成功后删除旧副本。 */
async function migrateLegacyStorage(db: IDBDatabase): Promise<void> {
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
  }
  for (const storageKey of keys) {
    const value = window.localStorage.getItem(storageKey);
    if (value === null) continue;
    try {
      await idbSet(db, storageKey.slice(STORAGE_PREFIX.length), value);
      window.localStorage.removeItem(storageKey);
    } catch {
      // 迁移失败时保留 localStorage 副本，下次启动继续尝试。
    }
  }
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let settled = false;
    const finish = (db: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      // 打开失败时清空缓存，下一次读写可以重新尝试。
      if (!db) databasePromise = null;
      resolve(db);
    };
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      // 迁移完成后再放行，避免首次读写时旧数据正好被移走。
      void migrateLegacyStorage(db).finally(() => finish(db));
    };
    request.onerror = () => finish(null);
    request.onblocked = () => finish(null);
  });
  return databasePromise;
}

async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage?.persist) {
      const granted = await navigator.storage.persist();
      if (!granted) console.info('[Web 存储] 浏览器未授予持久化存储，清理站点数据时可能丢失存档');
    }
  } catch {
    // 持久化申请失败不影响继续使用 IndexedDB / localStorage。
  }
}

const storage = {
  async get(key: string): Promise<string | null> {
    const db = await openDatabase();
    if (db) {
      try {
        const value = await idbGet(db, key);
        if (value !== null) return value;
      } catch (error) {
        console.warn('[Web 存储] IndexedDB 读取失败，回退 localStorage', error);
      }
    }
    return window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
  },
  async set(key: string, value: string): Promise<void> {
    const db = await openDatabase();
    if (db) {
      try {
        await idbSet(db, key, value);
        window.localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
        return;
      } catch (error) {
        console.warn('[Web 存储] IndexedDB 写入失败，回退 localStorage', error);
      }
    }
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
    const db = await openDatabase();
    if (db) {
      try {
        await idbDelete(db, key);
      } catch (error) {
        console.warn('[Web 存储] IndexedDB 删除失败', error);
      }
    }
    window.localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
  },
};

async function storageKeys(): Promise<string[]> {
  const keys = new Set<string>();
  const db = await openDatabase();
  if (db) {
    try {
      for (const key of await idbKeys(db)) keys.add(key);
    } catch (error) {
      console.warn('[Web 存储] IndexedDB 枚举失败', error);
    }
  }
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(STORAGE_PREFIX)) keys.add(key.slice(STORAGE_PREFIX.length));
  }
  return [...keys];
}

async function resetStorage(): Promise<void> {
  const db = await openDatabase();
  if (db) {
    try {
      await idbClear(db);
    } catch (error) {
      console.warn('[Web 存储] IndexedDB 清空失败', error);
    }
  }
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(STORAGE_PREFIX)) window.localStorage.removeItem(key);
  }
}

void requestPersistentStorage();

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
    // 存档缩略图用 JPEG 压缩：IndexedDB 空间更宽裕，回退 localStorage 时也更安全。
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
  async saveTextFile(filename, content) {
    try {
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    } catch (error) {
      console.warn('[Web 导出] 下载失败', error);
      return false;
    }
  },
  openTextFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.addEventListener(
        'change',
        () => {
          const file = input.files?.[0];
          if (!file) {
            resolve(null);
            return;
          }
          void file.text().then(resolve, () => resolve(null));
        },
        { once: true },
      );
      input.click();
    });
  },
  appVersion: '0.1.0-web',
};

window.sylvieWeb = {
  platform: 'web',
  gameBaseUrl: GAME_BASE,
  storageKeys: () => storageKeys(),
  storageDelete: (key) => storage.delete(key),
  resetStorage: () => resetStorage(),
};
