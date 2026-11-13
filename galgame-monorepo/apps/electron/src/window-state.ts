/**
 * 窗口状态持久化（window-state.json）。
 *
 * 尺寸下限防止读到异常值后窗口缩成一条；位置必须与某个显示器工作区相交，
 * 避免拔出外接屏后窗口移到屏幕外。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { app, screen, type BrowserWindow } from 'electron';

const WINDOW_STATE_FILE = 'window-state.json';
export const MIN_WINDOW_WIDTH = 960;
export const MIN_WINDOW_HEIGHT = 540;

/** 持久化的窗口状态；x / y 为 null 表示没有可用的屏幕坐标（首次启动或显示器变化）。 */
export interface WindowState {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
  maximized: boolean;
}

function windowStatePath(): string {
  return path.join(app.getPath('userData'), WINDOW_STATE_FILE);
}

/**
 * 读取并校正窗口状态。
 * 文件缺失、JSON 损坏或尺寸低于最小值时返回 null，回退默认尺寸；
 * 宽高上限 7680×4320，防止异常值导致窗口不可用。
 */
export function readWindowState(): WindowState | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(windowStatePath(), 'utf8'));
    if (typeof raw !== 'object' || raw === null) return null;
    const record = raw as Record<string, unknown>;
    const width = typeof record.width === 'number' ? Math.round(record.width) : 0;
    const height = typeof record.height === 'number' ? Math.round(record.height) : 0;
    if (width < MIN_WINDOW_WIDTH || height < MIN_WINDOW_HEIGHT) return null;
    return {
      width: Math.min(7680, width),
      height: Math.min(4320, height),
      x: typeof record.x === 'number' ? Math.round(record.x) : null,
      y: typeof record.y === 'number' ? Math.round(record.y) : null,
      maximized: record.maximized === true,
    };
  } catch {
    return null;
  }
}

/** 窗口位置必须与某个显示器工作区相交，避免拔出外接屏后窗口移到屏幕外。 */
export function boundsVisibleOnAnyDisplay(state: WindowState): boolean {
  const { x, y } = state;
  if (x === null || y === null) return false;
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      x < area.x + area.width &&
      x + state.width > area.x &&
      y < area.y + area.height &&
      y + state.height > area.y
    );
  });
}

/** 把窗口当前尺寸 / 位置 / 最大化状态写盘；失败只记警告，不影响窗口使用。 */
export function persistWindowState(window: BrowserWindow): void {
  try {
    const bounds = window.getNormalBounds();
    const state: WindowState = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: window.isMaximized(),
    };
    mkdirSync(path.dirname(windowStatePath()), { recursive: true });
    writeFileSync(windowStatePath(), JSON.stringify(state), 'utf8');
  } catch (error) {
    console.warn('[窗口] 保存窗口状态失败', error);
  }
}
