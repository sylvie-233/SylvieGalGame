/**
 * 桌面端键值存储（game-storage.json）。
 *
 * 内存副本 + 串行写盘：文件不存在时从空对象开始；JSON 损坏时先把原文件改名留档，
 * 避免下一次写入覆盖用户数据。写盘失败会向调用方抛出，由 IPC 层回滚并提示播放器。
 */
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { app } from 'electron';

// 键值存档文件名（落在 userData 下）。
const STORAGE_FILE = 'game-storage.json';

// storageCache：game-storage.json 的内存副本；storageWriteQueue：保证多次写盘按调用顺序落盘；
// storageBackedUp：本次进程是否已备份过旧存档。
let storageCache: Record<string, string> | null = null;
let storageWriteQueue: Promise<void> = Promise.resolve();
let storageBackedUp = false;

/** 存档文件路径：userData/game-storage.json。 */
export function storageFilePath(): string {
  return path.join(app.getPath('userData'), STORAGE_FILE);
}

/**
 * 把损坏的存档文件改名留档，避免下一次写入直接覆盖用户数据。
 * 改名失败只记录日志：此时仍然从空存储继续运行，不阻塞游戏启动。
 */
async function quarantineStorageFile(file: string, reason: unknown): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = `${file}.corrupt-${stamp}`;
  try {
    await rename(file, target);
    console.error(`[存储] 存档文件无法解析（${String(reason)}），已另存为 ${target}`);
  } catch (error) {
    console.error('[存储] 损坏存档文件留档失败', error);
  }
}

/**
 * 读取并缓存键值存储。
 * 文件不存在时从空对象开始；JSON 损坏或顶层结构不对时先把原文件改名留档，
 * 再以空存储继续，确保下一次写入不会覆盖用户数据。
 * 只接受字符串值，其余字段丢弃。缓存避免每次 IPC 都读盘。
 */
export async function loadStorage(): Promise<Record<string, string>> {
  if (storageCache) return storageCache;

  const file = storageFilePath();
  try {
    const text = await readFile(file, 'utf8');
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const map: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === 'string') map[key] = value;
      }
      storageCache = map;
      return map;
    }
    await quarantineStorageFile(file, '顶层不是对象');
  } catch (error) {
    // 首次运行（ENOENT）无需留档；其余情况（解析失败 / 读失败）都保留原文件。
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      await quarantineStorageFile(file, error);
    }
  }

  storageCache = {};
  return storageCache;
}

/**
 * 把内存副本原子落盘：先写 .tmp 再 rename，避免崩溃时留下半个 JSON。
 * 本次进程第一次写入前把现有文件备份为 `.bak`，给用户留一份上次会话的数据。
 * 写入串行排队；单次失败不会堵死后续写入，但会把错误交给本次调用方。
 */
export function persistStorage(): Promise<void> {
  const snapshot = JSON.stringify(storageCache ?? {}, null, 2);
  const write = storageWriteQueue.then(async () => {
    const file = storageFilePath();
    await mkdir(path.dirname(file), { recursive: true });
    if (!storageBackedUp) {
      try {
        await copyFile(file, `${file}.bak`);
      } catch (error) {
        // 首次运行没有旧文件（ENOENT）属于正常情况，其他错误只记日志，不阻止存档。
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error('[存储] 备份旧存档失败', error);
        }
      }
      storageBackedUp = true;
    }
    const temp = `${file}.tmp`;
    await writeFile(temp, snapshot, 'utf8');
    await rename(temp, file);
  });
  // 队列自身始终保持 resolved，避免一次磁盘错误阻断之后的所有写入。
  storageWriteQueue = write.then(
    () => undefined,
    () => undefined,
  );
  write.catch((error: unknown) => {
    console.error('[存储] 写入失败', error);
  });
  return write;
}

/** 等待当前排队的写盘全部结束；退出流程用，最多由调用方自行加超时。 */
export function whenStorageWritesSettled(): Promise<void> {
  return storageWriteQueue;
}

/** 键名约束：非空字符串且不超过 200 字符，防止异常键名污染存档文件。 */
export function isValidKey(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0 && key.length <= 200;
}
