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

export function isSaveData(value: unknown): value is SaveData {
  if (!isRecord(value)) return false;
  if (value.version !== SAVE_VERSION) return false;
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

export async function readSave(
  storage: KeyValueStorage,
  key: string,
): Promise<SaveData | null> {
  try {
    const raw = await storage.get(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSaveData(parsed) ? parsed : null;
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
