import type { GameSettings, KeyValueStorage, SaveData } from '@sylvie/types';
import {
  DEFAULT_SETTINGS,
  MANUAL_SAVE_COUNT,
  SETTINGS_KEY,
  SAVE_VERSION,
  manualSaveKey,
  normalizeSettings,
} from '@sylvie/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const LEGACY_SAVE_VERSION = 1;

function hasSaveShape(value: Record<string, unknown>): boolean {
  if (typeof value.scene !== 'string' || typeof value.chapter !== 'string') return false;
  if (typeof value.createdAt !== 'number') return false;
  if (!isRecord(value.pointer)) return false;
  if (typeof value.pointer.block !== 'string' || typeof value.pointer.index !== 'number') {
    return false;
  }
  if (!isRecord(value.variables)) return false;
  if (!isRecord(value.stage)) return false;
  if (!isRecord(value.audio)) return false;
  if (!Array.isArray(value.readMarks) || !Array.isArray(value.backlog)) return false;
  return true;
}

export function isSaveData(value: unknown): value is SaveData {
  return (
    isRecord(value) &&
    value.version === SAVE_VERSION &&
    typeof value.contentVersion === 'string' &&
    hasSaveShape(value)
  );
}

/**
 * 把历史版本存档升级到当前结构；无法识别的版本返回 null。
 * 迁移只发生在读取时，原文件在下一次写入前保持不变。
 */
export function migrateSaveData(value: unknown): SaveData | null {
  if (!isRecord(value)) return null;
  if (value.version === SAVE_VERSION) {
    return isSaveData(value) ? value : null;
  }
  if (value.version === LEGACY_SAVE_VERSION && hasSaveShape(value)) {
    const legacy = value as unknown as Omit<SaveData, 'version' | 'contentVersion'>;
    return { ...legacy, version: SAVE_VERSION, contentVersion: '' };
  }
  return null;
}

export async function readSave(storage: KeyValueStorage, key: string): Promise<SaveData | null> {
  try {
    const raw = await storage.get(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return migrateSaveData(parsed);
  } catch {
    return null;
  }
}

export async function writeSave(
  storage: KeyValueStorage,
  key: string,
  data: SaveData,
): Promise<void> {
  await storage.set(key, JSON.stringify(data));
}

export async function deleteSave(storage: KeyValueStorage, key: string): Promise<void> {
  await storage.delete(key);
}

export interface ManualSaveEntry {
  slot: number;
  key: string;
  data: SaveData | null;
}

export async function readManualSaves(
  storage: KeyValueStorage,
  count = MANUAL_SAVE_COUNT,
): Promise<ManualSaveEntry[]> {
  const entries = await Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const slot = index + 1;
      const key = manualSaveKey(slot);
      return { slot, key, data: await readSave(storage, key) };
    }),
  );
  return entries;
}

export async function loadSettings(storage: KeyValueStorage): Promise<GameSettings> {
  try {
    const raw = await storage.get(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return normalizeSettings(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function persistSettings(
  storage: KeyValueStorage,
  settings: GameSettings,
): Promise<void> {
  await storage.set(SETTINGS_KEY, JSON.stringify(settings));
}
