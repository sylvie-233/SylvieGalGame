import {
  GameEngine,
  loadSettings,
  persistSettings,
  readLatestSave,
  readSave,
  writeAutoSave,
  writeSave,
} from '@sylvie/engine-core';
import { SAVE_KEYS, type GameSettings, type SaveData } from '@sylvie/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { AudioManager } from '../audio';
import { getPlayerPlatform } from '../player-config';
import { usePlayerStore } from '../store';
import { BacklogPanel } from './BacklogPanel';
import { useConfirm } from './ConfirmDialog';
import type { DialogueHandle } from './DialogueBox';
import { GameStage } from './GameStage';
import { MenuOverlay } from './MenuOverlay';
import { QuickBar } from './QuickBar';
import { SaveLoadPanel } from './SaveLoadPanel';
import { SettingsPanel } from './SettingsPanel';
import { TitleScreen } from './TitleScreen';
import { Toast } from './Toast';
import { WarningsPanel } from './WarningsPanel';

const IMAGE_PATTERN = /\.(png|jpg|jpeg|webp|gif|svg|avif)$/i;

export function GameApp() {
  const platform = getPlayerPlatform();

  const [uiHidden, setUiHidden] = useState(false);
  const snapshot = usePlayerStore((state) => state.snapshot);
  const manifest = usePlayerStore((state) => state.manifest);
  const ready = usePlayerStore((state) => state.ready);
  const initError = usePlayerStore((state) => state.initError);
  const settings = usePlayerStore((state) => state.settings);
  const view = usePlayerStore((state) => state.view);
  const overlay = usePlayerStore((state) => state.overlay);
  const skip = usePlayerStore((state) => state.skip);
  const auto = usePlayerStore((state) => state.auto);
  const toast = usePlayerStore((state) => state.toast);
  const warnings = usePlayerStore((state) => state.warnings);

  const setSnapshot = usePlayerStore((state) => state.setSnapshot);
  const setManifest = usePlayerStore((state) => state.setManifest);
  const setReady = usePlayerStore((state) => state.setReady);
  const setInitError = usePlayerStore((state) => state.setInitError);
  const setSettings = usePlayerStore((state) => state.setSettings);
  const setView = usePlayerStore((state) => state.setView);
  const setOverlay = usePlayerStore((state) => state.setOverlay);
  const setSkip = usePlayerStore((state) => state.setSkip);
  const setAuto = usePlayerStore((state) => state.setAuto);
  const toggleSkip = usePlayerStore((state) => state.toggleSkip);
  const toggleAuto = usePlayerStore((state) => state.toggleAuto);
  const showToast = usePlayerStore((state) => state.showToast);
  const { confirm, dialog } = useConfirm();

  const [engine] = useState(
    () =>
      new GameEngine({
        host: {
          assets: {
            readText: (path) => platform.readText(path),
            exists: (path) => platform.exists(path),
          },
          storage: platform.storage,
          onWarning: (message) => {
            console.warn(message);
            usePlayerStore.getState().addWarning(message);
          },
        },
      }),
  );
  const [audio] = useState(() => new AudioManager((path) => platform.assetUrl(path)));

  const snapshotRef = useRef(snapshot);
  const dialogueRef = useRef<DialogueHandle | null>(null);
  const settingsTimer = useRef<number | null>(null);
  const ctrlDown = useRef(false);
  const ctrlComboUsed = useRef(false);

  useEffect(() => {
    let active = true;
    let autoSaveTimer: number | null = null;
    let lastScreenshotChapter: string | null = null;
    let lastScreenshot: string | null = null;

    const preload = (assets: string[]) => {
      for (const asset of assets) {
        if (IMAGE_PATTERN.test(asset)) {
          const image = new Image();
          image.src = platform.assetUrl(asset);
        }
      }
      audio.preloadAudio(assets);
    };

    const scheduleAutoSave = (block: 'text' | 'choice', chapter: string) => {
      if (autoSaveTimer) window.clearTimeout(autoSaveTimer);
      autoSaveTimer = window.setTimeout(() => {
        void (async () => {
          try {
            let screenshot = lastScreenshot;
            const shouldCapture =
              platform.captureScreenshot &&
              (block === 'choice' || chapter !== lastScreenshotChapter);
            if (shouldCapture && platform.captureScreenshot) {
              const captured = await platform.captureScreenshot().catch(() => null);
              if (captured) {
                lastScreenshot = captured;
                screenshot = captured;
              }
              lastScreenshotChapter = chapter;
            }
            const data = engine.createSave({
              screenshot,
              note: '自动存档',
              bgmPosition: audio.getBgmPosition(),
            });
            await writeAutoSave(platform.storage, data);
          } catch (error) {
            console.warn('[自动存档] 写入失败', error);
          }
        })();
      }, 900);
    };

    const unsubscribeState = engine.subscribe((next) => {
      snapshotRef.current = next;
      setSnapshot(next);
    });

    const unsubscribeEffect = engine.onEffect((effect) => {
      switch (effect.type) {
        case 'scene':
          preload(effect.assets);
          // 新游戏、读档或跨场景后，旧截图已不再对应当前画面。
          lastScreenshotChapter = null;
          lastScreenshot = null;
          break;
        case 'bgm':
          audio.playBgm(effect.track, effect.fade, effect.loop, effect.position ?? 0);
          break;
        case 'se':
          audio.playSe(effect.sound, effect.volume);
          break;
        case 'voice':
          audio.playVoice(effect.sound);
          break;
        case 'checkpoint':
          scheduleAutoSave(effect.block, effect.chapter);
          break;
        case 'ended':
          setAuto(false);
          setSkip(false);
          break;
        default:
          break;
      }
    });

    void engine
      .initialize()
      .then(async (loadedManifest) => {
        if (!active) return;
        setManifest(loadedManifest);
        setReady(true);
        const initial = engine.getSnapshot();
        snapshotRef.current = initial;
        setSnapshot(initial);

        const stored = await loadSettings(platform.storage);
        if (!active) return;
        setSettings(stored);
        audio.setVolumes({
          bgm: stored.bgmVolume,
          se: stored.seVolume,
          voice: stored.voiceVolume,
        });
        if (stored.fullscreen) {
          void platform.setFullscreen?.(true);
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error('[播放器] 初始化失败', error);
        setInitError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      active = false;
      if (autoSaveTimer) window.clearTimeout(autoSaveTimer);
      if (settingsTimer.current) window.clearTimeout(settingsTimer.current);
      unsubscribeState();
      unsubscribeEffect();
      engine.dispose();
      audio.dispose();
    };
  }, [
    engine,
    audio,
    platform,
    setAuto,
    setInitError,
    setManifest,
    setReady,
    setSettings,
    setSkip,
    setSnapshot,
  ]);

  useEffect(() => {
    audio.setVolumes({
      bgm: settings.bgmVolume,
      se: settings.seVolume,
      voice: settings.voiceVolume,
    });
  }, [audio, settings.bgmVolume, settings.seVolume, settings.voiceVolume]);

  useEffect(() => {
    if (!manifest) return;
    document.title = manifest.windowTitle || manifest.title;
  }, [manifest]);

  useEffect(() => {
    if (!ready || view !== 'title') return;
    const track = manifest?.titleScreen.bgm ?? null;
    if (track) {
      // 浏览器可能在首次交互前拦截自动播放，失败不影响后续游戏内 BGM。
      audio.playBgm(track, 800, true);
    }
  }, [audio, manifest, ready, view]);

  useEffect(() => {
    if (snapshot.phase === 'choice' || snapshot.phase === 'ended') {
      setAuto(false);
    }
    if (snapshot.phase === 'ended') {
      setSkip(false);
      if (usePlayerStore.getState().view === 'game') {
        setOverlay({ kind: 'end' });
      }
    }
  }, [snapshot.phase, setAuto, setOverlay, setSkip]);

  useEffect(() => {
    if (snapshot.phase !== 'wait' || overlay) return;
    const timer = window.setTimeout(() => engine.resumeWait(), snapshot.waitMs);
    return () => window.clearTimeout(timer);
  }, [snapshot.phase, snapshot.waitMs, overlay, engine]);

  useEffect(() => {
    if (!skip || view !== 'game' || overlay) return;
    const timer = window.setInterval(() => {
      const current = snapshotRef.current;
      if (current.phase === 'text') {
        if (engine.isCurrentTextRead()) {
          engine.advance();
        } else {
          setSkip(false);
          showToast('已读到未读对话，跳过已停止');
        }
      } else if (current.phase === 'wait') {
        engine.resumeWait();
      } else if (current.phase === 'choice' || current.phase === 'ended') {
        setSkip(false);
      }
    }, 60);
    return () => window.clearInterval(timer);
  }, [skip, view, overlay, engine, setSkip, showToast]);

  const updateSettings = useCallback(
    (next: GameSettings) => {
      setSettings(next);
      if (settingsTimer.current) window.clearTimeout(settingsTimer.current);
      settingsTimer.current = window.setTimeout(() => {
        void persistSettings(platform.storage, next).catch((error: unknown) => {
          console.warn('[设置] 保存失败', error);
        });
      }, 300);
    },
    [platform.storage, setSettings],
  );

  const handleInteract = useCallback(() => {
    if (!ready || view !== 'game' || overlay) return;
    if (snapshotRef.current.phase !== 'text') return;
    const dialogue = dialogueRef.current;
    if (dialogue?.isTyping()) {
      dialogue.completeTyping();
    } else {
      engine.advance();
    }
  }, [ready, view, overlay, engine]);

  const handleChoose = useCallback(
    (optionIndex: number) => {
      setAuto(false);
      setSkip(false);
      engine.choose(optionIndex);
    },
    [engine, setAuto, setSkip],
  );

  const handleAutoAdvance = useCallback(() => {
    engine.advance();
  }, [engine]);

  const toggleUiHidden = useCallback(() => {
    if (!ready || view !== 'game' || overlay) return;
    const phase = snapshotRef.current.phase;
    if (phase !== 'text' && phase !== 'wait') return;
    setUiHidden((current) => !current);
  }, [overlay, ready, view]);

  useEffect(() => {
    if (view !== 'game') setUiHidden(false);
  }, [view]);

  useEffect(() => {
    if (snapshot.phase === 'choice' || snapshot.phase === 'ended') {
      setUiHidden(false);
    }
  }, [snapshot.phase]);

  const rollback = useCallback(() => {
    if (!ready || view !== 'game' || overlay) return;
    if (!engine.canRollback()) return;
    if (!engine.rollback()) return;
    setAuto(false);
    setSkip(false);
    showToast('已回到上一句');
  }, [engine, overlay, ready, setAuto, setSkip, showToast, view]);

  const applyLoadedSave = useCallback(
    (data: SaveData): boolean => {
      audio.stopAll();
      if (!engine.restoreSave(data)) {
        showToast('存档无法读取');
        return false;
      }
      setView('game');
      setOverlay(null);
      setAuto(false);
      setSkip(false);
      showToast('已读取存档');
      return true;
    },
    [audio, engine, setAuto, setOverlay, setSkip, setView, showToast],
  );

  const startNewGame = useCallback(() => {
    if (!ready) return;
    audio.stopAll();
    engine.start();
    setView('game');
    setOverlay(null);
    setAuto(false);
    setSkip(false);
  }, [audio, engine, ready, setAuto, setOverlay, setSkip, setView]);

  const continueGame = useCallback(async () => {
    if (!ready) return;
    const data = await readLatestSave(platform.storage);
    if (!data) {
      showToast('暂无可继续的存档');
      return;
    }
    applyLoadedSave(data);
  }, [applyLoadedSave, platform.storage, ready, showToast]);

  const quickSave = useCallback(async () => {
    if (!ready || view !== 'game') {
      showToast('请先进入游戏');
      return;
    }
    try {
      const screenshot = platform.captureScreenshot
        ? await platform.captureScreenshot().catch(() => null)
        : null;
      const data = engine.createSave({
        screenshot,
        note: '快速存档',
        bgmPosition: audio.getBgmPosition(),
      });
      await writeSave(platform.storage, SAVE_KEYS.quick, data);
      showToast('已快速存档');
    } catch (error) {
      console.error(error);
      showToast('快速存档失败');
    }
  }, [audio, engine, platform, ready, showToast, view]);

  const quickLoad = useCallback(async () => {
    if (!ready || view !== 'game') {
      showToast('请先进入游戏');
      return;
    }
    const data = await readSave(platform.storage, SAVE_KEYS.quick);
    if (!data) {
      showToast('暂无快速存档');
      return;
    }
    applyLoadedSave(data);
  }, [applyLoadedSave, platform.storage, ready, showToast, view]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      if (event.key === 'Control') {
        ctrlDown.current = true;
        ctrlComboUsed.current = false;
        return;
      }

      const hasModifier = event.ctrlKey || event.metaKey;

      if (hasModifier && (event.key === 's' || event.key === 'S')) {
        event.preventDefault();
        ctrlComboUsed.current = true;
        void quickSave();
        return;
      }
      if (hasModifier && (event.key === 'l' || event.key === 'L')) {
        event.preventDefault();
        ctrlComboUsed.current = true;
        void quickLoad();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        if (overlay) {
          if (overlay.kind !== 'end') setOverlay(null);
        } else if (view === 'game') {
          setOverlay({ kind: 'menu' });
        }
        return;
      }

      if (overlay) return;
      if (!ready || view !== 'game') return;

      if (event.key === 'PageUp') {
        event.preventDefault();
        rollback();
        return;
      }
      if (event.key === 'h' || event.key === 'H') {
        if (!hasModifier) toggleUiHidden();
        return;
      }
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        handleInteract();
        return;
      }
      if (event.key === 'a' || event.key === 'A') {
        if (!hasModifier) toggleAuto();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== 'Control') return;
      const shouldToggleSkip =
        ctrlDown.current && !ctrlComboUsed.current && ready && view === 'game' && overlay === null;
      ctrlDown.current = false;
      ctrlComboUsed.current = false;
      if (shouldToggleSkip) toggleSkip();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    overlay,
    view,
    ready,
    handleInteract,
    quickSave,
    quickLoad,
    rollback,
    setOverlay,
    toggleAuto,
    toggleSkip,
    toggleUiHidden,
  ]);

  useEffect(() => {
    if (!ready || view !== 'game' || overlay) return;
    let lastRollback = 0;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY >= 0 || !engine.canRollback()) return;
      const now = Date.now();
      if (now - lastRollback < 450) return;
      lastRollback = now;
      rollback();
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => window.removeEventListener('wheel', onWheel);
  }, [engine, overlay, ready, rollback, view]);

  const backToTitle = useCallback(() => {
    audio.stopAll();
    setView('title');
    setOverlay(null);
    setAuto(false);
    setSkip(false);
  }, [audio, setAuto, setOverlay, setSkip, setView]);

  const confirmBackToTitle = useCallback(async () => {
    const confirmed = await confirm('返回标题？未保存的进度会丢失。', {
      title: '返回标题',
      confirmLabel: '返回',
      danger: true,
    });
    if (confirmed) backToTitle();
  }, [backToTitle, confirm]);

  const title = manifest?.title ?? 'Sylvie Galgame';
  const version = manifest?.version ?? '0.1.0';
  const titleScreen = manifest?.titleScreen;
  const titleArt = platform.assetUrl(titleScreen?.background ?? 'images/bg/title.svg');

  const copyDiagnostics = useCallback(() => {
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      showToast('当前环境不支持剪贴板');
      return;
    }
    const text = [initError ?? '', ...warnings].filter(Boolean).join('\n\n');
    void clipboard
      .writeText(text)
      .then(() => showToast('已复制诊断信息'))
      .catch(() => showToast('复制失败'));
  }, [initError, showToast, warnings]);

  if (initError) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_center,#16101a,#05060a_70%)] p-[8vw] text-center text-sg-ink">
        <h1 className="m-0 font-dialogue text-[32px] tracking-[0.16em] text-sg-accent">
          游戏启动失败
        </h1>
        <p className="m-0 max-w-[640px] text-sm leading-[1.8] text-sg-muted">{initError}</p>
        <p className="m-0 max-w-[640px] text-sm leading-[1.8] text-sg-muted">
          请检查游戏资源目录下的脚本与资源是否完整。
        </p>
        {warnings.length > 0 && (
          <p className="m-0 max-w-[640px] text-sm leading-[1.8] text-sg-dim">
            另有 {warnings.length} 条脚本警告，可在诊断信息中查看。
          </p>
        )}
        <button
          type="button"
          className="mt-2 rounded-sm border border-sg-line bg-sg-accent/10 px-5 py-2 text-[13px] tracking-[0.12em] transition-colors hover:border-sg-line-strong hover:bg-sg-accent/20"
          onClick={copyDiagnostics}
        >
          复制诊断信息
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 select-none overflow-hidden bg-sg-bg font-ui text-sg-ink antialiased"
      data-font={settings.font}
      data-view={view}
    >
      {view === 'title' ? (
        <TitleScreen
          title={title}
          version={version}
          subtitle={titleScreen?.subtitle || '一段由 YAML 写成的午后相遇'}
          showVersion={titleScreen?.showVersion ?? true}
          ready={ready}
          backgroundUrl={titleArt}
          onNewGame={startNewGame}
          onContinue={() => void continueGame()}
          onLoad={() => setOverlay({ kind: 'saves', mode: 'load', origin: 'title' })}
          onSettings={() => setOverlay({ kind: 'settings', origin: 'title' })}
          onQuit={platform.quit ? () => platform.quit?.() : undefined}
        />
      ) : (
        <div
          className="absolute inset-0"
          onContextMenu={(event) => {
            event.preventDefault();
            toggleUiHidden();
          }}
        >
          <GameStage
            snapshot={snapshot}
            assetUrl={(path) => platform.assetUrl(path)}
            dialogueRef={dialogueRef}
            typingSpeed={settings.textSpeed}
            skip={skip}
            auto={auto}
            autoDelay={settings.autoDelay}
            onAutoAdvance={handleAutoAdvance}
            onInteract={handleInteract}
            onChoose={handleChoose}
            uiHidden={uiHidden}
          />
          {uiHidden ? (
            <div
              className="absolute inset-0 z-40 cursor-pointer"
              onClick={() => setUiHidden(false)}
              aria-label="显示界面"
            />
          ) : (
            <QuickBar
              auto={auto}
              skip={skip}
              canRollback={engine.canRollback()}
              onToggleAuto={toggleAuto}
              onToggleSkip={toggleSkip}
              onRollback={rollback}
              onBacklog={() => setOverlay({ kind: 'backlog' })}
              onSave={() => setOverlay({ kind: 'saves', mode: 'save', origin: 'game' })}
              onLoad={() => setOverlay({ kind: 'saves', mode: 'load', origin: 'game' })}
              onMenu={() => setOverlay({ kind: 'menu' })}
            />
          )}
        </div>
      )}

      {!ready && (
        <div className="fixed bottom-7 left-7 z-[80] rounded-sm border border-sg-accent/15 bg-[#080a12]/60 px-4 py-2 text-xs tracking-[0.1em] text-sg-muted">
          正在载入脚本与资源…
        </div>
      )}

      {warnings.length > 0 && (
        <button
          type="button"
          className="fixed top-[clamp(16px,2.4vh,30px)] left-[clamp(18px,2.6vw,38px)] z-[80] rounded-[3px] border border-sg-gold/30 bg-[#0a0c14]/70 px-3 py-1.5 text-[11px] tracking-[0.1em] text-sg-gold/90 backdrop-blur-md transition-colors hover:border-sg-gold/60 hover:text-sg-gold"
          onClick={() => setOverlay({ kind: 'warnings' })}
          data-ui-chrome
        >
          脚本警告 {warnings.length}
        </button>
      )}

      {overlay?.kind === 'menu' && (
        <MenuOverlay
          onResume={() => setOverlay(null)}
          onSave={() => setOverlay({ kind: 'saves', mode: 'save', origin: 'game' })}
          onLoad={() => setOverlay({ kind: 'saves', mode: 'load', origin: 'game' })}
          onSettings={() => setOverlay({ kind: 'settings', origin: 'game' })}
          onBackToTitle={() => void confirmBackToTitle()}
          onQuit={platform.quit ? () => platform.quit?.() : undefined}
        />
      )}

      {overlay?.kind === 'saves' && (
        <SaveLoadPanel
          mode={overlay.mode}
          engine={engine}
          platform={platform}
          onLoad={applyLoadedSave}
          onClose={() => setOverlay(null)}
          notify={showToast}
          getAudioPosition={() => audio.getBgmPosition()}
        />
      )}

      {overlay?.kind === 'settings' && (
        <SettingsPanel
          settings={settings}
          onChange={updateSettings}
          onClose={() => setOverlay(null)}
          platform={platform}
        />
      )}

      {overlay?.kind === 'backlog' && (
        <BacklogPanel
          entries={snapshot.backlog}
          onClose={() => setOverlay(null)}
          onReplay={(voice) => audio.playVoice(voice)}
        />
      )}

      {overlay?.kind === 'warnings' && (
        <WarningsPanel warnings={warnings} onClose={() => setOverlay(null)} />
      )}

      <AnimatePresence>
        {overlay?.kind === 'end' && (
          <motion.div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-[radial-gradient(circle_at_50%_40%,rgba(34,24,36,0.5),rgba(4,5,9,0.92)),rgba(4,5,9,0.84)] backdrop-blur-[10px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            data-ui-chrome
          >
            <motion.div
              className="flex flex-col items-center gap-3 rounded-[4px] border border-sg-accent/25 bg-[#0a0c14]/75 px-[clamp(32px,6vw,80px)] py-12 text-center shadow-[0_24px_70px_rgba(0,0,0,0.55)]"
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              role="dialog"
              aria-modal="true"
              aria-label="本章结束"
            >
              <div className="text-[22px] tracking-[0.3em] text-sg-gold">✦</div>
              <div className="text-[11px] tracking-[0.3em] text-sg-gold/80">
                {snapshot.ending ? 'ENDING' : 'CHAPTER END'}
              </div>
              <h2 className="m-0 font-dialogue text-[clamp(28px,3.2vw,40px)] font-medium tracking-[0.22em] text-sg-ink">
                {snapshot.ending?.title ?? '本章结束'}
              </h2>
              <p className="m-0 mb-4 mt-1 max-w-[420px] text-[13px] leading-[1.8] tracking-[0.08em] text-sg-muted">
                {snapshot.ending?.description || '感谢游玩。故事还会在下一个午后继续。'}
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="rounded-sm border border-sg-ink/15 bg-transparent px-[26px] py-[11px] text-[13px] tracking-[0.14em] text-sg-muted transition-colors hover:border-sg-ink/30 hover:text-sg-ink"
                  onClick={backToTitle}
                >
                  返回标题
                </button>
                <button
                  type="button"
                  className="rounded-sm border border-sg-line bg-sg-accent/10 px-[26px] py-[11px] text-[13px] tracking-[0.14em] transition-colors hover:border-sg-line-strong hover:bg-sg-accent/20"
                  onClick={() => {
                    startNewGame();
                    showToast('已重新开始');
                  }}
                >
                  重新开始
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {dialog}
      <Toast message={toast} />
    </div>
  );
}
