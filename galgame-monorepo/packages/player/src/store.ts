import { createEmptySnapshot } from '@sylvie/engine-core';
import {
  DEFAULT_SETTINGS,
  type GameManifest,
  type GameSettings,
  type GameSnapshot,
} from '@sylvie/types';
import { create } from 'zustand';

export type View = 'title' | 'game';
export type Origin = 'title' | 'game';

export type Overlay =
  | { kind: 'menu' }
  | { kind: 'saves'; mode: 'save' | 'load'; origin: Origin }
  | { kind: 'settings'; origin: Origin }
  | { kind: 'backlog' }
  | { kind: 'warnings' }
  | { kind: 'end' }
  | null;

export interface PlayerState {
  snapshot: GameSnapshot;
  manifest: GameManifest | null;
  ready: boolean;
  initError: string | null;
  settings: GameSettings;
  view: View;
  overlay: Overlay;
  skip: boolean;
  auto: boolean;
  toast: string | null;
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

let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** 播放器全局 UI 状态（Zustand）。引擎与音频实例由 GameApp 生命周期持有。 */
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
  addWarning: (message) =>
    set((state) =>
      state.warnings.includes(message)
        ? state
        : { warnings: [...state.warnings, message].slice(-200) },
    ),
  clearWarnings: () => set({ warnings: [] }),
}));
