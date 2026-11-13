import type { BacklogEntry, Pointer, StageSnapshot } from './state';
import type { VariableTable } from './variables';

/**
 * 存档版本历史：
 * - 2：新增 contentVersion，用于提示存档与当前内容是否匹配。
 * - 3：新增 bgmPosition，读档后恢复 BGM 播放位置。
 * - 4：舞台状态新增 effects，保存环境粒子等持续特效。
 */
export const SAVE_VERSION = 4;

/**
 * 一份完整存档。
 *
 * 引擎只负责组装结构；截图、备注与 BGM 播放位置由播放器通过 createSave 传入。
 * 字段变更必须同步提升 SAVE_VERSION，并在 migrateSaveData 中补齐迁移逻辑，
 * 否则旧档会被 isSaveData 判定为坏档。
 */
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
  /** 缩略图 data URL（Electron 为 PNG，Web 为 JPEG）；不支持时为空。 */
  screenshot: string | null;
}

/** 固定键名的特殊存档槽。 */
export const SAVE_KEYS = {
  /** 自动存档轮换的第 1 槽，也是旧版本的唯一自动存档键。 */
  auto: 'save:auto',
  quick: 'save:quick',
} as const;

/** 自动存档轮换槽数量：save:auto、save:auto:2、save:auto:3。 */
export const AUTO_SAVE_COUNT = 3;

/** 手动存档槽数量：save:slot:1..20。 */
export const MANUAL_SAVE_COUNT = 20;

/** 自动存档键：slot 1 沿用旧版唯一键名，2 起追加 :slot 后缀。 */
export function autoSaveKey(slot: number): string {
  return slot <= 1 ? SAVE_KEYS.auto : `save:auto:${slot}`;
}

/** 手动存档键；slot 从 1 开始。 */
export function manualSaveKey(slot: number): string {
  return `save:slot:${slot}`;
}

/** 已读文本 id 集合，独立于存档持久化。 */
export const READ_MARKS_KEY = 'meta:read-marks';
/** 全局设置；与存档分离，切换档位不会改变设置。 */
export const SETTINGS_KEY = 'meta:settings';

/** 导出文件标识，导入时用于拒绝非本游戏生成的文件。 */
export const SAVE_EXPORT_FORMAT = 'sylvie-save-export';
/** 导出结构版本；结构发生不兼容变更时提升。 */
export const SAVE_EXPORT_VERSION = 1;

/** 全量 / 单档导出的 JSON 结构；saves 的键是不带 Web 前缀的原始键。 */
export interface SaveExportBundle {
  format: typeof SAVE_EXPORT_FORMAT;
  version: typeof SAVE_EXPORT_VERSION;
  exportedAt: number;
  saves: Record<string, string>;
}
