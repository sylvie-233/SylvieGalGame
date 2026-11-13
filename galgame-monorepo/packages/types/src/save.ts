import type { BacklogEntry, Pointer, StageSnapshot } from './state';
import type { VariableTable } from './variables';

export const SAVE_VERSION = 1;

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
  readMarks: string[];
  backlog: BacklogEntry[];
  note: string;
  /** data:image/png;base64, ... 形式的缩略图。 */
  screenshot: string | null;
}

export const SAVE_KEYS = {
  auto: 'save:auto',
  quick: 'save:quick',
} as const;

export const MANUAL_SAVE_COUNT = 20;

export function manualSaveKey(slot: number): string {
  return `save:slot:${slot}`;
}

export const READ_MARKS_KEY = 'meta:read-marks';
export const SETTINGS_KEY = 'meta:settings';
