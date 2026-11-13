import {
  GameEngine,
  loadGalleryUnlocks,
  loadSettings,
  persistGalleryUnlocks,
  persistSettings,
  readLatestSave,
  readSave,
  writeAutoSave,
  writeSave,
} from '@sylvie/engine-core';
import {
  SAVE_KEYS,
  emptyGalleryUnlocks,
  type GalleryUnlocks,
  type GameSettings,
  type MinigameResult,
  type SaveData,
} from '@sylvie/types';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useAnimationControls } from 'motion/react';

import { AudioManager } from '../audio';
import { isButtonLikeTarget, isEditableTarget } from '../dom';
import { getPlayerPlatform } from '../player-config';
import { usePlayerStore } from '../store';
import { useConfirm } from './ConfirmDialog';
import type { DialogueHandle } from './DialogueBox';
import { GameStage } from './GameStage';
import { MenuOverlay } from './MenuOverlay';
import { QuickBar } from './QuickBar';
import { TitleScreen } from './TitleScreen';
import { Toast } from './Toast';
import { WarningsPanel } from './WarningsPanel';

// 面板首次打开时再加载，减小首屏包体。
const BacklogPanel = lazy(() =>
  import('./BacklogPanel').then((module) => ({ default: module.BacklogPanel })),
);
const GalleryPanel = lazy(() =>
  import('./GalleryPanel').then((module) => ({ default: module.GalleryPanel })),
);
const MinigameOverlay = lazy(() =>
  import('./MinigameOverlay').then((module) => ({ default: module.MinigameOverlay })),
);
const SaveLoadPanel = lazy(() =>
  import('./SaveLoadPanel').then((module) => ({ default: module.SaveLoadPanel })),
);
const SettingsPanel = lazy(() =>
  import('./SettingsPanel').then((module) => ({ default: module.SettingsPanel })),
);

/** 需要走 Image 预热的图片扩展名；音频交给 AudioManager 自行筛选。 */
const IMAGE_PATTERN = /\.(png|jpg|jpeg|webp|gif|svg|avif)$/i;
/** 单次场景预加载的图片 / 音频上限，超出部分在真正显示或播放时按需加载。 */
const PRELOAD_ASSET_BUDGET = 32;
/** 图片预热记录上限，避免长会话反复为同一资源创建 Image 对象。 */
const PRELOAD_IMAGE_CACHE_LIMIT = 64;

/**
 * 播放器根组件：持有引擎与音频实例，订阅快照 / 效果事件，并渲染标题页、舞台与各类覆盖层。
 *
 * 生命周期：
 * - 首次渲染时惰性创建 {@link GameEngine} 与 {@link AudioManager}，之后由 ref / state 稳定持有；
 * - 挂载后初始化引擎、读取设置与图鉴，并把引擎效果映射为音频播放、动画与自动存档等副作用；
 * - 卸载时取消订阅、清理定时器并 dispose 引擎与音频。
 *
 * 组件不直接访问宿主 API，全部经由 `getPlayerPlatform()` 注入的 {@link PlayerPlatform}。
 */
export function GameApp() {
  const platform = getPlayerPlatform();

  // 隐藏舞台 UI（对话、快捷栏），只保留画面；由 H 键 / 右键切换。
  const [uiHidden, setUiHidden] = useState(false);
  // 全屏闪光的一次性描述；用 key 保证连续触发时重新播放动画，动画结束清空。
  const [flash, setFlash] = useState<{
    key: number;
    color: 'white' | 'black';
    opacity: number;
    duration: number;
  } | null>(null);
  // 舞台震动动画控制器，由引擎的 shake 效果驱动。
  const shakeControls = useAnimationControls();
  // 图鉴解锁状态与 ref 并存：ref 供 effect 做增量比对，state 驱动面板渲染。
  const [gallery, setGallery] = useState<GalleryUnlocks>(() => emptyGalleryUnlocks());
  const galleryRef = useRef<GalleryUnlocks>(emptyGalleryUnlocks());
  // 图鉴落盘防抖计时器。
  const galleryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // snapshotRef 供事件回调 / 键盘处理读取最新快照，避免闭包拿到旧值。
  const snapshotRef = useRef(snapshot);
  // 对话打字机的命令式句柄：点击舞台时先补全当前句，再推进。
  const dialogueRef = useRef<DialogueHandle | null>(null);
  // 设置持久化的防抖计时器；音频音量本身即时生效，不等待落盘。
  const settingsTimer = useRef<number | null>(null);
  // 自动存档的立即落盘入口：由初始化 effect 注入，供返回标题 / 页面卸载时调用。
  const autoSaveFlushRef = useRef<() => void>(() => {});

  /** 把尚未落盘的设置立即写入；定时器已结束时为空操作。 */
  const flushSettings = useCallback(() => {
    if (!settingsTimer.current) return;
    window.clearTimeout(settingsTimer.current);
    settingsTimer.current = null;
    void persistSettings(platform.storage, usePlayerStore.getState().settings).catch(
      (error: unknown) => {
        console.warn('[设置] 保存失败', error);
      },
    );
  }, [platform.storage]);

  /** 把尚未落盘的图鉴解锁立即写入；galleryRef 始终保存最新集合。 */
  const flushGallery = useCallback(() => {
    if (!galleryTimer.current) return;
    clearTimeout(galleryTimer.current);
    galleryTimer.current = null;
    void persistGalleryUnlocks(platform.storage, galleryRef.current).catch((error: unknown) => {
      console.warn('[图鉴] 解锁记录保存失败', error);
    });
  }, [platform.storage]);
  // 区分“按住 Ctrl 跳过已读”和 Ctrl+S / Ctrl+L 组合键：
  // 组合键使用后置位 ctrlComboUsed，松开 Ctrl 时不再触发跳过。
  const ctrlDown = useRef(false);
  const ctrlComboUsed = useRef(false);

  // 引擎初始化与事件绑定：只在引擎 / 音频 / 平台实例变化时重建，
  // 内部的定时器、订阅与监听都在 cleanup 中统一释放。
  useEffect(() => {
    // active 用于阻止组件卸载后仍在进行的异步初始化继续写状态。
    let active = true;
    let autoSaveTimer: number | null = null;
    // 待写入自动存档的元信息；BGM 位置在 checkpoint 当时记录，
    // 避免返回标题 / 停止音频后才触发定时器，把位置写成 0。
    let pendingAutoSave: { block: 'text' | 'choice'; chapter: string; bgmPosition: number } | null =
      null;
    let lastScreenshotChapter: string | null = null;
    let lastScreenshot: string | null = null;
    const preloadedImages = new Set<string>();

    /** 为一批资源做预热；图片走 Image，音频交给 AudioManager 的预加载表。 */
    const preload = (assets: string[]) => {
      // 数量预算：当前场景资源按脚本顺序优先，超出的留到实际使用时再加载。
      // 图片用 Image 预热浏览器缓存；同一资源只创建一次，并以缓存上限封顶。
      const selected = assets.slice(0, PRELOAD_ASSET_BUDGET);
      for (const asset of selected) {
        if (!IMAGE_PATTERN.test(asset) || preloadedImages.has(asset)) continue;
        if (preloadedImages.size >= PRELOAD_IMAGE_CACHE_LIMIT) continue;
        preloadedImages.add(asset);
        const image = new Image();
        image.src = platform.assetUrl(asset);
      }
      audio.preloadAudio(selected);
    };

    /**
     * 自动存档：由 checkpoint 效果触发，900ms 防抖后写入 `save:auto`。
     * 截图策略：
     * - 选项节点必抓新图；
     * - 普通文本仅在章节变化时抓图，其余复用上一张，避免每条台词都 capturePage；
     * - 进入新场景时缓存会被清空，下一次 checkpoint 必然重新截图。
     * 截图失败不阻断存档，退化为无快照 / 复用旧快照。
     * 写入本身由 `writeAutoSave` 完成槽位轮换（1 → 2 → 3）。
     */
    const scheduleAutoSave = (block: 'text' | 'choice', chapter: string) => {
      pendingAutoSave = { block, chapter, bgmPosition: audio.getBgmPosition() };
      if (autoSaveTimer) window.clearTimeout(autoSaveTimer);
      autoSaveTimer = window.setTimeout(() => {
        autoSaveTimer = null;
        // 定时器触发时清空 pending，之后的写入使用触发前记录的 BGM 位置。
        const pending = pendingAutoSave;
        pendingAutoSave = null;
        if (!pending) return;
        void (async () => {
          try {
            let screenshot = lastScreenshot;
            const shouldCapture =
              platform.captureScreenshot &&
              (pending.block === 'choice' || pending.chapter !== lastScreenshotChapter);
            if (shouldCapture && platform.captureScreenshot) {
              const captured = await platform.captureScreenshot().catch(() => null);
              if (captured) {
                lastScreenshot = captured;
                screenshot = captured;
              }
              lastScreenshotChapter = pending.chapter;
            }
            const data = engine.createSave({
              screenshot,
              note: '自动存档',
              bgmPosition: pending.bgmPosition,
            });
            await writeAutoSave(platform.storage, data);
          } catch (error) {
            console.warn('[自动存档] 写入失败', error);
          }
        })();
      }, 900);
    };

    /**
     * 立即写入待处理的自动存档（不再抓新截图）。
     * 返回标题 / 页面卸载 / 组件销毁前调用，避免 900ms 内的最后一句进度丢失。
     */
    const flushAutoSave = () => {
      const pending = pendingAutoSave;
      pendingAutoSave = null;
      if (autoSaveTimer) {
        window.clearTimeout(autoSaveTimer);
        autoSaveTimer = null;
      }
      if (!pending) return;
      try {
        const data = engine.createSave({
          screenshot: lastScreenshot,
          note: '自动存档',
          bgmPosition: pending.bgmPosition,
        });
        void writeAutoSave(platform.storage, data).catch((error: unknown) => {
          console.warn('[自动存档] 写入失败', error);
        });
      } catch (error) {
        console.warn('[自动存档] 创建失败', error);
      }
    };
    autoSaveFlushRef.current = flushAutoSave;

    // 状态订阅：引擎每次推进都会推送不可变快照，这里同步到 Zustand。
    const unsubscribeState = engine.subscribe((next) => {
      snapshotRef.current = next;
      setSnapshot(next);
    });

    // 效果事件只承载副作用（播放音频、预加载、动画、自动存档），不直接改引擎状态。
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
          // 文本 / 选项阻塞时触发：节流自动存档，并预取接下来可能进入的场景资源。
          scheduleAutoSave(effect.block, effect.chapter);
          preload(engine.getUpcomingSceneAssets(2));
          break;
        case 'shake': {
          // 引擎只提供强度与时长，这里转换成对称衰减的关键帧。
          const strength = Math.max(1, effect.intensity);
          void shakeControls.start({
            x: [0, -strength, strength, -strength * 0.6, strength * 0.6, 0],
            y: [0, strength * 0.35, -strength * 0.35, strength * 0.2, -strength * 0.2, 0],
            transition: {
              duration: Math.max(0.1, effect.duration / 1000),
              ease: 'easeInOut',
            },
          });
          break;
        }
        case 'flash':
          setFlash({
            key: Date.now(),
            color: effect.color,
            opacity: effect.opacity,
            duration: effect.duration,
          });
          break;
        case 'ended':
          setAuto(false);
          setSkip(false);
          break;
        default:
          break;
      }
    });

    // 初始化顺序：先加载 manifest 并推送初始快照，再恢复设置、音量、图鉴与全屏。
    // 每一步异步返回后都检查 active，防止组件已卸载仍继续写状态。
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

        const storedGallery = await loadGalleryUnlocks(platform.storage);
        if (!active) return;
        galleryRef.current = storedGallery;
        setGallery(storedGallery);
        if (stored.fullscreen) {
          void platform.setFullscreen?.(true);
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error('[播放器] 初始化失败', error);
        setInitError(error instanceof Error ? error.message : String(error));
      });

    // 卸载：先把防抖中的数据落盘，再停止异步、清理定时器、移除订阅并释放资源。
    return () => {
      active = false;
      // flush 必须在 engine / audio 释放前执行，createSave 与 BGM 位置都依赖它们。
      flushAutoSave();
      flushSettings();
      flushGallery();
      if (autoSaveTimer) window.clearTimeout(autoSaveTimer);
      if (settingsTimer.current) window.clearTimeout(settingsTimer.current);
      autoSaveFlushRef.current = () => {};
      unsubscribeState();
      unsubscribeEffect();
      engine.dispose();
      audio.dispose();
    };
  }, [
    engine,
    audio,
    platform,
    flushGallery,
    flushSettings,
    setAuto,
    setInitError,
    setManifest,
    setReady,
    setSettings,
    setSkip,
    setSnapshot,
    shakeControls,
  ]);

  // 设置变化时同步到音频通道；音量不经防抖，拖动滑块即时生效。
  useEffect(() => {
    audio.setVolumes({
      bgm: settings.bgmVolume,
      se: settings.seVolume,
      voice: settings.voiceVolume,
    });
  }, [audio, settings.bgmVolume, settings.seVolume, settings.voiceVolume]);

  // 小游戏需要听清琴音，BGM 在覆盖层期间临时压低；离开该阶段后恢复玩家音量。
  useEffect(() => {
    audio.setBgmDucked(snapshot.phase === 'minigame');
    return () => {
      audio.setBgmDucked(false);
    };
  }, [audio, snapshot.phase]);

  // 窗口标题优先使用 manifest 的 windowTitle，缺省回退到游戏标题。
  useEffect(() => {
    if (!manifest) return;
    document.title = manifest.windowTitle || manifest.title;
  }, [manifest]);

  // 标题页 BGM：清单加载完成并回到标题视图时播放。
  useEffect(() => {
    if (!ready || view !== 'title') return;
    const track = manifest?.titleScreen.bgm ?? null;
    if (track) {
      // 浏览器可能在首次交互前拦截自动播放，失败不影响后续游戏内 BGM。
      audio.playBgm(track, 800, true);
    }
  }, [audio, manifest, ready, view]);

  // 图鉴解锁：CG 显示、BGM 播放、抵达结局时记录到 meta:gallery，与存档解耦。
  // 每次快照变化都基于 galleryRef 做增量比对，新增条目后先更新本地状态，
  // 再以 300ms 防抖落盘，避免快速连续推进时频繁写存储。
  useEffect(() => {
    if (!manifest) return;
    const current = galleryRef.current;
    const cgs = [...current.cgs];
    const bgms = [...current.bgms];
    const endings = [...current.endings];

    const cgImage = snapshot.stage.cg.visible ? snapshot.stage.cg.image : null;
    const cgEntry = cgImage
      ? manifest.gallery.cgs.find((entry) => entry.image === cgImage)
      : undefined;
    if (cgEntry && !cgs.includes(cgEntry.id)) cgs.push(cgEntry.id);

    const bgmEntry = snapshot.audio.bgm
      ? manifest.gallery.bgms.find((entry) => entry.track === snapshot.audio.bgm)
      : undefined;
    if (bgmEntry && !bgms.includes(bgmEntry.id)) bgms.push(bgmEntry.id);

    if (snapshot.ending && !endings.includes(snapshot.ending.id)) {
      endings.push(snapshot.ending.id);
    }

    if (
      cgs.length === current.cgs.length &&
      bgms.length === current.bgms.length &&
      endings.length === current.endings.length
    ) {
      return;
    }

    const next = { cgs, bgms, endings };
    galleryRef.current = next;
    setGallery(next);
    if (galleryTimer.current) clearTimeout(galleryTimer.current);
    galleryTimer.current = setTimeout(() => {
      galleryTimer.current = null;
      void persistGalleryUnlocks(platform.storage, next).catch((error: unknown) => {
        console.warn('[图鉴] 解锁记录保存失败', error);
      });
    }, 300);
  }, [manifest, platform.storage, snapshot]);

  // 卸载时把尚未落盘的图鉴写入立即刷掉，而不是只取消定时器。
  useEffect(() => flushGallery, [flushGallery]);

  // 选项 / 结局出现时退出自动播放；结局还会退出跳过并弹出结束页（仅游戏内）。
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

  // 引擎阻塞在 minigame 时打开对应覆盖层；恢复 / 回退到小游戏也会重新挂载。
  // 阶段离开 minigame 后关闭残留覆盖层，避免快速读档等路径把它留在画面上。
  useEffect(() => {
    if (snapshot.phase === 'minigame') {
      setAuto(false);
      setSkip(false);
      if (
        usePlayerStore.getState().view === 'game' &&
        usePlayerStore.getState().overlay?.kind !== 'minigame'
      ) {
        setOverlay({ kind: 'minigame' });
      }
    } else if (overlay?.kind === 'minigame') {
      setOverlay(null);
    }
  }, [overlay, snapshot.phase, setAuto, setOverlay, setSkip]);

  // wait 指令：没有覆盖层遮挡时，按快照中的毫秒数自动恢复推进。
  useEffect(() => {
    if (snapshot.phase !== 'wait' || overlay) return;
    const timer = window.setTimeout(() => engine.resumeWait(), snapshot.waitMs);
    return () => window.clearTimeout(timer);
  }, [snapshot.phase, snapshot.waitMs, overlay, engine]);

  // 跳过已读：每 60ms 检查一次当前阻塞点。
  // 文本已读才推进；遇到未读文本会立即关闭跳过并提示，选项 / 结局同样停止。
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

  // 设置先写入全局状态即时生效，落盘做 300ms 防抖，避免拖动滑块时频繁写存储。
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

  /** 点击舞台 / 空格 / 回车：打字中先补全当前句，否则推进引擎。 */
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

  /** 选择选项：先关闭自动与跳过，再让引擎应用选项的赋值并跳转。 */
  const handleChoose = useCallback(
    (optionIndex: number) => {
      setAuto(false);
      setSkip(false);
      engine.choose(optionIndex);
    },
    [engine, setAuto, setSkip],
  );

  const handleAutoAdvance = useCallback(() => {
    // 双保险：即使计时器已在覆盖层打开前启动，也不在面板背后推进。
    if (usePlayerStore.getState().overlay) return;
    engine.advance();
  }, [engine]);

  /** 小游戏正常结束：先关闭覆盖层，再让引擎按剧本映射写回结果并继续。 */
  const finishMinigame = useCallback(
    (result?: MinigameResult) => {
      setOverlay(null);
      engine.finishMinigame(result);
    },
    [engine, setOverlay],
  );

  /** 跳过小游戏：使用 minigame.skip 的预设结果，剧情不会卡住。 */
  const skipMinigame = useCallback(() => {
    setOverlay(null);
    engine.skipMinigame();
  }, [engine, setOverlay]);

  /** H 键 / 右键：仅在文本或等待阶段切换界面隐藏，选项与结束时保持可见。 */
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

  /** 回退到上一个阻塞点；没有历史时静默忽略（按钮本身会禁用）。 */
  const rollback = useCallback(() => {
    if (!ready || view !== 'game' || overlay) return;
    if (!engine.canRollback()) return;
    if (!engine.rollback()) return;
    setAuto(false);
    setSkip(false);
    showToast('已回到上一句');
  }, [engine, overlay, ready, setAuto, setSkip, showToast, view]);

  /**
   * 统一读档入口（存档面板、快速读档、继续游戏共用）：
   * 先清空音频，再让引擎恢复状态并切到游戏视图；返回恢复是否成功。
   * 恢复失败时把读档前的 BGM 重新播回来，避免坏档让整局静音。
   */
  const applyLoadedSave = useCallback(
    (data: SaveData): boolean => {
      const previousBgm = snapshotRef.current.audio.bgm;
      const previousPosition = audio.getBgmPosition();
      audio.stopAll();
      if (!engine.restoreSave(data)) {
        if (previousBgm) audio.playBgm(previousBgm, 300, true, previousPosition);
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

  /** 开始新游戏：清空音频与覆盖层，交由引擎从头运行脚本。 */
  const startNewGame = useCallback(() => {
    if (!ready) return;
    audio.stopAll();
    engine.start();
    setView('game');
    setOverlay(null);
    setAuto(false);
    setSkip(false);
  }, [audio, engine, ready, setAuto, setOverlay, setSkip, setView]);

  /** 继续游戏：从自动 / 快速 / 手动存档中取 createdAt 最新的一份。 */
  const continueGame = useCallback(async () => {
    if (!ready) return;
    const data = await readLatestSave(platform.storage);
    if (!data) {
      showToast('暂无可继续的存档');
      return;
    }
    applyLoadedSave(data);
  }, [applyLoadedSave, platform.storage, ready, showToast]);

  /** 快速存档（Ctrl+S / 快捷栏）：现场抓图并写入 `save:quick`。 */
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

  /** 快速读档（Ctrl+L）：读取 `save:quick` 并复用统一读档流程。 */
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

  /**
   * 全局键盘快捷键：
   * - 输入框 / 可编辑区域内完全不拦截，交还给浏览器；
   * - Ctrl+S / Ctrl+L 快速存档 / 读档；单独按下再松开 Ctrl 切换“跳过已读”；
   * - Esc 关闭最上层覆盖层（结束页除外），无覆盖层时打开菜单；
   * - PageUp 回退、空格 / 回车推进、A 自动播放、H 隐藏界面。
   *
   * 通过 ctrlComboUsed 区分组合键与“按住 Ctrl 跳过”，避免按 Ctrl+S 时误开跳过。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      // 小游戏覆盖层独占键盘：不推进对话、不打开菜单，也不响应 Ctrl+S / Ctrl+L。
      // Esc 同样交给小游戏自行处理，退出只能点击「跳过」或完成游戏。
      if (overlay?.kind === 'minigame') return;

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
        // 焦点在按钮 / 链接上时交给控件自身，否则键盘用户无法激活快捷栏按钮。
        if (isButtonLikeTarget(event.target)) return;
        event.preventDefault();
        handleInteract();
        return;
      }
      if (event.key === 'a' || event.key === 'A') {
        if (!hasModifier) toggleAuto();
      }
    };

    // 只有“按下并松开 Ctrl 且期间没用过组合键”才切换跳过。
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

  // 向上滚轮回退：450ms 节流，避免一次长滚动触发多次回退；passive 监听不阻塞页面滚动。
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

  /**
   * 返回标题：先刷掉待写入的自动存档，再停止音频与自动 / 跳过状态。
   * 顺序不能反：停止音频后再取 BGM 位置会得到 0，读档续播会从头开始。
   */
  const backToTitle = useCallback(() => {
    autoSaveFlushRef.current();
    flushSettings();
    flushGallery();
    audio.stopAll();
    setView('title');
    setOverlay(null);
    setAuto(false);
    setSkip(false);
  }, [audio, flushGallery, flushSettings, setAuto, setOverlay, setSkip, setView]);

  // 页面被关闭 / 切换到后台时，尽量把防抖中的数据刷入存储。
  // pagehide 在桌面端关闭窗口与浏览器刷新时都会触发；写入失败只影响本次会话。
  useEffect(() => {
    const onPageHide = () => {
      autoSaveFlushRef.current();
      flushSettings();
      flushGallery();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [flushGallery, flushSettings]);

  /**
   * 图鉴 BGM 试听：传入曲目时播放；传入 null 表示停止试听，
   * 此时恢复到当前上下文原本的 BGM（标题页曲目或游戏内当前曲目）。
   */
  const previewBgm = useCallback(
    (track: string | null) => {
      if (track) {
        audio.playBgm(track, 400, true);
        return;
      }
      const fallback =
        view === 'title' ? (manifest?.titleScreen.bgm ?? null) : snapshotRef.current.audio.bgm;
      if (fallback) {
        audio.playBgm(fallback, 500, true);
      } else {
        audio.stopBgm(500);
      }
    },
    [audio, manifest, view],
  );

  /** 返回标题前走应用内确认框；Promise 结果为 true 才真正返回。 */
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

  /** 启动失败页：把错误、存档 / 日志路径与脚本警告汇总复制到剪贴板。 */
  const copyDiagnostics = useCallback(() => {
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      showToast('当前环境不支持剪贴板');
      return;
    }
    const paths = [
      platform.storagePath ? `存档：${platform.storagePath}` : '',
      platform.logPath ? `日志：${platform.logPath}` : '',
    ].filter(Boolean);
    const text = [initError ?? '', paths.join('\n'), ...warnings]
      .filter(Boolean)
      .join('\n\n');
    void clipboard
      .writeText(text)
      .then(() => showToast('已复制诊断信息'))
      .catch(() => showToast('复制失败'));
  }, [initError, platform.logPath, platform.storagePath, showToast, warnings]);

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
        {(platform.storagePath || platform.logPath) && (
          <div className="max-w-[640px] space-y-1 text-left text-[11px] leading-[1.7] break-all text-sg-dim/80">
            {platform.storagePath && <p className="m-0">存档：{platform.storagePath}</p>}
            {platform.logPath && <p className="m-0">日志：{platform.logPath}</p>}
          </div>
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
          onGallery={() => setOverlay({ kind: 'gallery' })}
          onSettings={() => setOverlay({ kind: 'settings', origin: 'title' })}
          onQuit={platform.quit ? () => platform.quit?.() : undefined}
        />
      ) : (
        <motion.div
          className="absolute inset-0"
          animate={shakeControls}
          initial={{ x: 0, y: 0 }}
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
            paused={overlay !== null}
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
          {flash && (
            <motion.div
              key={flash.key}
              className="pointer-events-none absolute inset-0 z-[45]"
              style={{ backgroundColor: flash.color }}
              initial={{ opacity: flash.opacity }}
              animate={{ opacity: 0 }}
              transition={{ duration: Math.max(0.05, flash.duration / 1000), ease: 'easeOut' }}
              onAnimationComplete={() => setFlash(null)}
              aria-hidden="true"
            />
          )}
        </motion.div>
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
          onGallery={() => setOverlay({ kind: 'gallery' })}
          onSettings={() => setOverlay({ kind: 'settings', origin: 'game' })}
          onBackToTitle={() => void confirmBackToTitle()}
          onQuit={platform.quit ? () => platform.quit?.() : undefined}
        />
      )}

      <Suspense fallback={null}>
        {overlay?.kind === 'minigame' && snapshot.minigame && (
          <MinigameOverlay
            minigame={snapshot.minigame}
            platform={platform}
            onFinish={finishMinigame}
            onSkip={skipMinigame}
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

        {overlay?.kind === 'gallery' && manifest && (
          <GalleryPanel
            manifest={manifest}
            unlocks={gallery}
            assetUrl={(path) => platform.assetUrl(path)}
            onPreviewBgm={previewBgm}
            onClose={() => setOverlay(null)}
          />
        )}
      </Suspense>

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
