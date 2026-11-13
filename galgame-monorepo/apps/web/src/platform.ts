/**
 * Web 预览壳的平台实现：把 PlayerPlatform 映射为 fetch + IndexedDB/localStorage +
 * html-to-image + Fullscreen API。宿主能力与 Electron 端保持一致，但 quit 刻意不实现，
 * 播放器会自动隐藏退出入口。
 *
 * 存储策略：
 * - 首选 IndexedDB（配额大，适合存档与截图缩略图）；
 * - IndexedDB 不可用或单次读写失败时回退 localStorage，键统一加 `sylvie:` 前缀；
 * - 旧版本只写过 localStorage 的数据会在首次打开数据库时迁移进 IndexedDB。
 */
import { createMinigameLoaders } from '@sylvie/minigames';
import type { PlayerPlatform } from '@sylvie/types';

// localStorage 回退键前缀，避免与同源其它数据冲突；IndexedDB 内直接使用播放器原始键。
const STORAGE_PREFIX = 'sylvie:';
// 内容统一挂在 <base>/game 下：开发期由 Vite 中间件提供，构建时复制到 dist/game。
const GAME_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/game`;

/** 调试 API：仅 Web 预览壳注入 window.sylvieWeb，供控制台检查 / 清理本地存档。 */
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

/** 逐段编码资源路径，保留 / 分隔并过滤空段，避免空格、#、? 等字符破坏 URL。 */
function encodeAssetPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/** 把内容相对路径转成可请求的 /game/... URL；空路径返回内容根。 */
export function assetUrl(path: string): string {
  const encoded = encodeAssetPath(path);
  return encoded ? `${GAME_BASE}/${encoded}` : GAME_BASE;
}

/** 跨浏览器的配额错误识别：Chrome / Firefox / Safari 的 name 与 code 各不相同。 */
function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22 ||
      error.code === 1014)
  );
}

// IndexedDB 结构：单库单仓库，键为播放器存储键，值为字符串。
const DB_NAME = 'sylvie-web';
const DB_VERSION = 1;
const STORE_NAME = 'kv';

// 共享的连接 Promise；打开失败时会重置为 null，后续读写可重新尝试。
let databasePromise: Promise<IDBDatabase | null> | null = null;

// IndexedDB 最小封装：每个操作使用独立事务，事务完成（或失败）后 resolve / reject。
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

/**
 * 把旧版本写在 localStorage 的 `sylvie:` 键迁移进 IndexedDB。
 * 每个键迁移成功后删除旧副本；失败则保留 localStorage 数据，下次启动继续尝试。
 */
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

/**
 * 惰性打开数据库并缓存连接。
 * 首次升级（upgradeneeded）时创建 kv 仓库；打开成功后先完成旧数据迁移再放行，
 * 避免首次读写时旧数据正好被移走。被其它标签页阻塞（onblocked）或打开失败时返回 null，
 * 调用方回退 localStorage。
 */
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

/**
 * 申请持久化存储，降低浏览器清理站点数据时顺带删掉存档的概率；
 * 被拒绝或 API 不存在都只记一条提示，不影响继续使用。
 */
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

/**
 * PlayerPlatform.storage 实现：每次操作先尝试 IndexedDB，成功才认为写入生效；
 * 失败时回退 localStorage，保证隐私模式等 IndexedDB 不可用的场景仍能读写。
 */
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
    // IndexedDB 没有该键（或读取失败）时回退 localStorage。
    return window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
  },
  async set(key: string, value: string): Promise<void> {
    const db = await openDatabase();
    if (db) {
      try {
        await idbSet(db, key, value);
        // 写入 IndexedDB 后清掉同名 localStorage 旧副本，避免读到过期数据。
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
    // 两边都删，避免回退路径残留旧值。
    window.localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
  },
};

/** 合并 IndexedDB 与 localStorage 中的键（调试用），返回不含前缀的原始键。 */
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

/** 清空 IndexedDB 与所有 `sylvie:` 前缀的 localStorage 键（调试用）。 */
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

// 模块加载即申请持久化；不等待结果，不影响首帧。
void requestPersistentStorage();

/** 等待浏览器完成两次绘制，确保 data-capture 相关样式已生效。 */
function nextFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * 生成存档缩略图（JPEG data URL）。html-to-image 按需动态加载，避免拖慢首屏；
 * 失败时返回 null，存档仍可继续，只是没有预览图。
 */
async function captureScreenshot(): Promise<string | null> {
  const root = document.documentElement;
  root.dataset.capture = 'true';
  try {
    await nextFrames();
    // 与 Electron 存档缩略图（640px 宽）保持一致的清晰度。
    const pixelRatio = Math.min(1, 640 / window.innerWidth);
    // 截图库只在真正需要缩略图时加载，避免拖慢首屏。
    const { toJpeg } = await import('html-to-image');
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

/** Web 端的 PlayerPlatform 实现；文件导入导出使用浏览器下载 / 文件选择框。 */
export const webPlatform: PlayerPlatform = {
  async readText(path) {
    // 直接 fetch /game 下的文本资源；禁用缓存，改剧本后刷新即可看到变化。
    const response = await fetch(assetUrl(path), { cache: 'no-store' });
    if (!response.ok) throw new Error(`无法读取游戏资源：${path}（HTTP ${response.status}）`);
    return response.text();
  },
  async exists(path) {
    // 用 HEAD 探测；网络异常按不存在处理。
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
  // 剧情小游戏按 id 懒加载；没触发小游戏的玩家不会下载 Phaser。
  minigames: createMinigameLoaders(),
  // 浏览器可能因缺少用户手势拒绝全屏，捕获后返回实际状态，不影响游戏流程。
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
  // Blob + <a download> 触发浏览器下载；延迟 revoke 避免下载被提前取消。
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
  // 创建隐藏 file input；用户取消选择时浏览器不会触发 change，Promise 会保持 pending。
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
      // 取消选择不会触发 change；现代 Chromium 会派发 cancel，避免 Promise 永久挂起。
      input.addEventListener('cancel', () => resolve(null), { once: true });
      input.click();
    });
  },
  // Web 预览没有主进程版本号，用固定后缀与桌面端区分。
  appVersion: '0.1.0-web',
};

// 调试入口：播放器不使用它，仅供控制台或冒烟脚本枚举 / 清理存储。
window.sylvieWeb = {
  platform: 'web',
  gameBaseUrl: GAME_BASE,
  storageKeys: () => storageKeys(),
  storageDelete: (key) => storage.delete(key),
  resetStorage: () => resetStorage(),
};
