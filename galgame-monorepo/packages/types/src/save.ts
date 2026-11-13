import type { BacklogEntry, Pointer, StageSnapshot } from './state';
import type { VariableTable } from './variables';

/**
 * 存档版本历史：
 * - 2：新增 contentVersion，用于提示存档与当前内容是否匹配。
 * - 3：新增 bgmPosition，读档后恢复 BGM 播放位置。
 */
export const SAVE_VERSION = 3;

export interface SaveData {
  version: typeof SAVE_VERSION;
  createdAt: number;
  /** 存档时所在的场景 + 指针。 */
  scene: string;
  pointer: Pointer;
  chapter: string;
  variables: VariableTable;
  stage: StageSnapshot;
  audio: { bgm: string | null };
  /** 存档时 BGM 的播放位置（秒）；没有 BGM 时为 0。 */
  bgmPosition: number;
  readMarks: string[];
  backlog: BacklogEntry[];
  note: string;
  /** 存档时 manifest 的 version；旧存档迁移后为空字符串。 */
  contentVersion: string;
  /** data:image/png;base64, ... 形式的缩略图。 */
  screenshot: string | null;
}

export const SAVE_KEYS = {
  /** 自动存档轮换的第 1 槽，也是旧版本的唯一自动存档键。 */
  auto: 'save:auto',
  quick: 'save:quick',
} as const;

/** 自动存档轮换槽数量：save:auto、save:auto:2、save:auto:3。 */
export const AUTO_SAVE_COUNT = 3;

export const MANUAL_SAVE_COUNT = 20;

export function autoSaveKey(slot: number): string {
  return slot <= 1 ? SAVE_KEYS.auto : `save:auto:${slot}`;
}

export function manualSaveKey(slot: number): string {
  return `save:slot:${slot}`;
}

export const READ_MARKS_KEY = 'meta:read-marks';
export const SETTINGS_KEY = 'meta:settings';

export const SAVE_EXPORT_FORMAT = 'sylvie-save-export';
export const SAVE_EXPORT_VERSION = 1;

/** 全量 / 单档导出的 JSON 结构；saves 的键是不带 Web 前缀的原始键。 */
export interface SaveExportBundle {
  format: typeof SAVE_EXPORT_FORMAT;
  version: typeof SAVE_EXPORT_VERSION;
  exportedAt: number;
  saves: Record<string, string>;
}
