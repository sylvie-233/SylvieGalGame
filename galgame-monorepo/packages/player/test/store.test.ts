import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePlayerStore } from '../src/store';

function resetStore(): void {
  usePlayerStore.getState().clearToast();
  usePlayerStore.setState({
    view: 'title',
    overlay: null,
    settings: { ...usePlayerStore.getState().settings },
    skip: false,
    auto: false,
    toast: null,
    warnings: [],
    initError: null,
    ready: false,
  });
}

describe('player store', () => {
  beforeEach(() => {
    resetStore();
  });

  it('starts on the title screen with no overlay', () => {
    const state = usePlayerStore.getState();
    expect(state.view).toBe('title');
    expect(state.overlay).toBeNull();
    expect(state.warnings).toHaveLength(0);
    expect(state.settings.bgmVolume).toBeGreaterThan(0);
  });

  it('switches view and overlays', () => {
    const { setView, setOverlay } = usePlayerStore.getState();
    setView('game');
    setOverlay({ kind: 'saves', mode: 'load', origin: 'game' });
    expect(usePlayerStore.getState().view).toBe('game');
    expect(usePlayerStore.getState().overlay).toEqual({
      kind: 'saves',
      mode: 'load',
      origin: 'game',
    });

    setOverlay({ kind: 'gallery' });
    expect(usePlayerStore.getState().overlay).toEqual({ kind: 'gallery' });
    setOverlay(null);
    expect(usePlayerStore.getState().overlay).toBeNull();
  });

  it('toggles auto / skip and updates settings', () => {
    const store = usePlayerStore.getState();
    store.toggleAuto();
    store.toggleSkip();
    expect(usePlayerStore.getState().auto).toBe(true);
    expect(usePlayerStore.getState().skip).toBe(true);

    store.setAuto(false);
    store.setSkip(false);
    const settings = { ...store.settings, textSpeed: 60, fullscreen: true };
    store.setSettings(settings);
    expect(usePlayerStore.getState().settings).toMatchObject({ textSpeed: 60, fullscreen: true });
  });

  it('deduplicates warnings and caps the panel at 200 entries', () => {
    const { addWarning } = usePlayerStore.getState();
    addWarning('重复');
    addWarning('重复');
    expect(usePlayerStore.getState().warnings).toEqual(['重复']);

    for (let index = 0; index < 205; index += 1) {
      addWarning(`警告 ${index}`);
    }
    const warnings = usePlayerStore.getState().warnings;
    expect(warnings).toHaveLength(200);
    expect(warnings[0]).toBe('警告 5');
    expect(warnings[warnings.length - 1]).toBe('警告 204');

    usePlayerStore.getState().clearWarnings();
    expect(usePlayerStore.getState().warnings).toHaveLength(0);
  });

  it('auto-clears toast after 2.6 seconds', () => {
    vi.useFakeTimers();
    try {
      usePlayerStore.getState().showToast('已保存');
      expect(usePlayerStore.getState().toast).toBe('已保存');
      vi.advanceTimersByTime(2600);
      expect(usePlayerStore.getState().toast).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
