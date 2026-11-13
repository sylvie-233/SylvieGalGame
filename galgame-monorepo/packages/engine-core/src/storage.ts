import type {
  GalleryUnlocks,
  GameSettings,
  KeyValueStorage,
  SaveData,
  SaveExportBundle,
} from '@sylvie/types';
import {
  AUTO_SAVE_COUNT,
  DEFAULT_SETTINGS,
  GALLERY_KEY,
  MANUAL_SAVE_COUNT,
  READ_MARKS_KEY,
  SAVE_EXPORT_FORMAT,
  SAVE_EXPORT_VERSION,
  SETTINGS_KEY,
  SAVE_KEYS,
  SAVE_VERSION,
  autoSaveKey,
  manualSaveKey,
  normalizeGalleryUnlocks,
  normalizeSettings,
} from '@sylvie/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const LEGACY_SAVE_VERSIONS = new Set([1, 2]);

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
    typeof value.bgmPosition === 'number' &&
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
  if (
    typeof value.version === 'number' &&
    LEGACY_SAVE_VERSIONS.has(value.version) &&
    hasSaveShape(value)
  ) {
    const legacy = value as unknown as Partial<SaveData>;
    return {
      ...legacy,
      version: SAVE_VERSION,
      contentVersion: typeof legacy.contentVersion === 'string' ? legacy.contentVersion : '',
      bgmPosition:
        typeof legacy.bgmPosition === 'number' && Number.isFinite(legacy.bgmPosition)
          ? legacy.bgmPosition
          : 0,
    } as SaveData;
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

export interface AutoSaveEntry {
  slot: number;
  key: string;
  data: SaveData | null;
}

/**
 * 自动存档轮换：新档写入 slot 1，旧档依次后移，最多保留 3 份。
 * 使用原始字符串搬运，避免在写入过程中重复迁移旧档。
 */
export async function writeAutoSave(
  storage: KeyValueStorage,
  data: SaveData,
): Promise<void> {
  // 先把旧槽位全部读出来，再统一后移，避免边读边写导致重复覆盖。
  const previous = await Promise.all(
    Array.from({ length: AUTO_SAVE_COUNT - 1 }, (_, index) => storage.get(autoSaveKey(index + 1))),
  );
  for (let slot = AUTO_SAVE_COUNT; slot >= 2; slot -= 1) {
    const raw = previous[slot - 2];
    if (raw !== null && raw !== undefined) {
      await storage.set(autoSaveKey(slot), raw);
    } else {
      await storage.delete(autoSaveKey(slot));
    }
  }
  await writeSave(storage, autoSaveKey(1), data);
}

export async function readAutoSaves(
  storage: KeyValueStorage,
  count = AUTO_SAVE_COUNT,
): Promise<AutoSaveEntry[]> {
  return Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const slot = index + 1;
      const key = autoSaveKey(slot);
      return { slot, key, data: await readSave(storage, key) };
    }),
  );
}

/** 读取自动 / 快速 / 手动存档中时间最新的一份，供「继续游戏」使用。 */
export async function readLatestSave(storage: KeyValueStorage): Promise<SaveData | null> {
  const candidates = await Promise.all([
    ...(await readAutoSaves(storage)).map((entry) => entry.data),
    readSave(storage, SAVE_KEYS.quick),
    ...(await readManualSaves(storage)).map((entry) => entry.data),
  ]);

  let latest: SaveData | null = null;
  for (const data of candidates) {
    if (!data) continue;
    if (!latest || data.createdAt > latest.createdAt) {
      latest = data;
    }
  }
  return latest;
}

const EXPORT_KEY_PATTERN =
  /^(?:save:(?:auto(?::[23])?|quick|slot:(?:[1-9]|1[0-9]|20))|meta:(?:read-marks|settings|gallery))$/;

export function exportableSaveKeys(): string[] {
  return [
    ...Array.from({ length: AUTO_SAVE_COUNT }, (_, index) => autoSaveKey(index + 1)),
    SAVE_KEYS.quick,
    ...Array.from({ length: MANUAL_SAVE_COUNT }, (_, index) => manualSaveKey(index + 1)),
    READ_MARKS_KEY,
    SETTINGS_KEY,
    GALLERY_KEY,
  ];
}

/** 打包指定键（默认全量）为可下载的 JSON 字符串。 */
export async function createSaveExport(
  storage: KeyValueStorage,
  keys: string[] = exportableSaveKeys(),
): Promise<string> {
  const saves: Record<string, string> = {};
  for (const key of keys) {
    const raw = await storage.get(key);
    if (raw !== null) saves[key] = raw;
  }
  return JSON.stringify({
    format: SAVE_EXPORT_FORMAT,
    version: SAVE_EXPORT_VERSION,
    exportedAt: Date.now(),
    saves,
  });
}

/** 校验导入文件结构，过滤未知键与非字符串值；格式不正确时返回 null。 */
export function parseSaveExport(raw: string): Record<string, string> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Partial<SaveExportBundle>;
    if (record.format !== SAVE_EXPORT_FORMAT || record.version !== SAVE_EXPORT_VERSION) {
      return null;
    }
    if (typeof record.saves !== 'object' || record.saves === null) return null;

    const saves: Record<string, string> = {};
    for (const [key, value] of Object.entries(record.saves)) {
      if (!EXPORT_KEY_PATTERN.test(key)) continue;
      if (typeof value !== 'string' || value.length > 5_000_000) continue;
      saves[key] = value;
    }
    return saves;
  } catch {
    return null;
  }
}

/** 导入存档；返回实际写入的键数量。格式不正确时抛错，调用方负责提示。 */
export async function importSaveExport(
  storage: KeyValueStorage,
  raw: string,
): Promise<number> {
  const saves = parseSaveExport(raw);
  if (!saves) {
    throw new Error('存档文件格式不正确');
  }
  const entries = Object.entries(saves);
  for (const [key, value] of entries) {
    await storage.set(key, value);
  }
  return entries.length;
}

export async function loadGalleryUnlocks(storage: KeyValueStorage): Promise<GalleryUnlocks> {
  try {
    const raw = await storage.get(GALLERY_KEY);
    if (!raw) return normalizeGalleryUnlocks(null);
    return normalizeGalleryUnlocks(JSON.parse(raw) as unknown);
  } catch {
    return normalizeGalleryUnlocks(null);
  }
}

export async function persistGalleryUnlocks(
  storage: KeyValueStorage,
  unlocks: GalleryUnlocks,
): Promise<void> {
  await storage.set(GALLERY_KEY, JSON.stringify(unlocks));
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
