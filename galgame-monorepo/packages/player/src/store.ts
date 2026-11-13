import { createEmptySnapshot } from '@sylvie/engine-core';
import {
  DEFAULT_SETTINGS,
  type GameManifest,
  type GameSettings,
  type GameSnapshot,
} from '@sylvie/types';
import { create } from 'zustand';

/** 外壳视图：标题页或游戏内。 */
export type View = 'title' | 'game';

/** 打开覆盖层时的来源，用于存档 / 设置面板关闭后回到正确视图。 */
export type Origin = 'title' | 'game';

/**
 * 当前覆盖层状态，同一时刻只允许存在一个（由 GameApp 按 kind 条件渲染）。
 * `end` 为章节 / 结局结束页，不响应 Esc 关闭；其余弹窗由 Modal 的栈管理关闭顺序。
 */
export type Overlay =
  | { kind: 'menu' }
  | { kind: 'saves'; mode: 'save' | 'load'; origin: Origin }
  | { kind: 'settings'; origin: Origin }
  | { kind: 'backlog' }
  | { kind: 'gallery' }
  | { kind: 'warnings' }
  | { kind: 'minigame' }
  | { kind: 'end' }
  | null;

/** 播放器全局 UI 状态；引擎、音频等有生命周期的实例不放在这里。 */
export interface PlayerState {
  /** 引擎当前快照，UI 只读消费。 */
  snapshot: GameSnapshot;
  /** 已加载的清单；初始化完成前为 null。 */
  manifest: GameManifest | null;
  /** 脚本与资源是否加载完成，标题页按钮据此禁用。 */
  ready: boolean;
  /** 初始化错误；非空时 GameApp 渲染启动失败页。 */
  initError: string | null;
  /** 持久化设置（音量、文本速度、字体、全屏）。 */
  settings: GameSettings;
  /** 当前外壳视图。 */
  view: View;
  /** 当前覆盖层；null 表示无弹窗。 */
  overlay: Overlay;
  /** 跳过已读开关。 */
  skip: boolean;
  /** 自动播放开关。 */
  auto: boolean;
  /** 短暂提示文案，由 showToast 定时清除。 */
  toast: string | null;
  /** 脚本诊断警告，去重后最多保留 200 条。 */
  warnings: string[];

  setSnapshot: (snapshot: GameSnapshot) => void;
  setManifest: (manifest: GameManifest) => void;
  setReady: (ready: boolean) => void;
  setInitError: (message: string | null) => void;
  setSettings: (settings: GameSettings) => void;
  setView: (view: View) => void;
  setOverlay: (overlay: Overlay) => void;
  setSkip: (skip: boolean) => void;
  toggleSkip: () => void;
  setAuto: (auto: boolean) => void;
  toggleAuto: () => void;
  showToast: (message: string) => void;
  clearToast: () => void;
  addWarning: (message: string) => void;
  clearWarnings: () => void;
}

/** Toast 的自动清除定时器；模块级保存，保证连续提示时只保留最后一个计时。 */
let toastTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 播放器全局 UI 状态（Zustand）。
 * 引擎与音频实例由 GameApp 生命周期持有，此处只放可序列化的 UI 状态与操作。
 */
export const usePlayerStore = create<PlayerState>((set) => ({
  snapshot: createEmptySnapshot(),
  manifest: null,
  ready: false,
  initError: null,
  settings: { ...DEFAULT_SETTINGS },
  view: 'title',
  overlay: null,
  skip: false,
  auto: false,
  toast: null,
  warnings: [],

  setSnapshot: (snapshot) => set({ snapshot }),
  setManifest: (manifest) => set({ manifest }),
  setReady: (ready) => set({ ready }),
  setInitError: (initError) => set({ initError }),
  setSettings: (settings) => set({ settings }),
  setView: (view) => set({ view }),
  setOverlay: (overlay) => set({ overlay }),
  setSkip: (skip) => set({ skip }),
  toggleSkip: () => set((state) => ({ skip: !state.skip })),
  setAuto: (auto) => set({ auto }),
  toggleAuto: () => set((state) => ({ auto: !state.auto })),
  // 连续提示会重置计时，确保新文案完整展示 2.6 秒。
  showToast: (message) => {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), 2600);
    set({ toast: message });
  },
  clearToast: () => {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = null;
    set({ toast: null });
  },
  // 相同警告只记录一次；超过 200 条时丢弃最旧的，防止长会话无限增长。
  addWarning: (message) =>
    set((state) =>
      state.warnings.includes(message)
        ? state
        : { warnings: [...state.warnings, message].slice(-200) },
    ),
  clearWarnings: () => set({ warnings: [] }),
}));
