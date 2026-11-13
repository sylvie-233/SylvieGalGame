import type {
  MinigameContext,
  MinigameInstance,
  MinigameResult,
  MinigameState,
  PlayerPlatform,
} from '@sylvie/types';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import { useConfirm } from './ConfirmDialog';

interface MinigameOverlayProps {
  /** 引擎快照中的只读描述；不会包含结果映射等剧本细节。 */
  minigame: MinigameState;
  platform: PlayerPlatform;
  /** 正常结束；结果由引擎按剧本映射写回变量。 */
  onFinish: (result?: MinigameResult) => void;
  /** 使用 minigame.skip 的默认结果继续剧情。 */
  onSkip: () => void;
}

type Status = 'loading' | 'ready' | 'error' | 'missing';

/**
 * 通用剧情小游戏覆盖层。
 *
 * 播放器本身不认识 Phaser 或任何具体玩法，只按 `minigame.id` 从
 * `platform.minigames` 找到宿主注册的 loader，把容器交给它挂载。
 * 未注册或挂载失败时保留「跳过」入口，保证剧情不会卡死。
 *
 * Esc 键由 GameApp 拦截，不会关闭本覆盖层；退出必须走右上角跳过按钮或完成小游戏。
 */
export function MinigameOverlay({ minigame, platform, onFinish, onSkip }: MinigameOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  // 加载失败后的重试计数；作为 effect 依赖强制重新挂载。
  const [attempt, setAttempt] = useState(0);
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const loader = platform.minigames?.[minigame.id];
    if (!loader) {
      setStatus('missing');
      setError(null);
      return;
    }

    let active = true;
    let instance: MinigameInstance | null = null;
    let finished = false;

    setStatus('loading');
    setError(null);
    // 重试时清掉上一次可能残留的 canvas，避免叠加。
    container.replaceChildren();

    const finish = (result?: MinigameResult) => {
      if (!active || finished) return;
      finished = true;
      onFinish(result);
    };

    const context: MinigameContext = {
      id: minigame.id,
      title: minigame.title,
      prompt: minigame.prompt,
      params: minigame.params,
      assetUrl: (path) => platform.assetUrl(path),
      finish,
    };

    loader(container, context)
      .then((mounted) => {
        instance = mounted;
        // 如果 loader 返回时覆盖层已经被跳过 / 卸载，立即释放实例。
        if (!active) {
          mounted.destroy();
          return;
        }
        setStatus('ready');
      })
      .catch((reason: unknown) => {
        if (!active) return;
        console.error('[小游戏] 挂载失败', reason);
        setError(reason instanceof Error ? reason.message : String(reason));
        setStatus('error');
      });

    return () => {
      active = false;
      instance?.destroy();
      instance = null;
      container.replaceChildren();
    };
  }, [attempt, minigame, onFinish, platform]);

  /** 跳过前走应用内确认框，避免误触丢失这段演出。 */
  const confirmSkip = async () => {
    const confirmed = await confirm('跳过这段小游戏？会使用剧本预设的结果继续剧情。', {
      title: '跳过小游戏',
      confirmLabel: '跳过',
      cancelLabel: '继续游玩',
    });
    if (confirmed) onSkip();
  };

  /** 加载失败时「继续剧情」同样走 skip，确保不卡在空覆盖层。 */
  const continueStory = async () => {
    const confirmed = await confirm('小游戏无法继续，直接回到剧情？', {
      title: '继续剧情',
      confirmLabel: '继续',
      cancelLabel: '取消',
    });
    if (confirmed) onSkip();
  };

  return (
    <motion.div
      className="fixed inset-0 z-[90] overflow-hidden bg-[radial-gradient(circle_at_50%_38%,#101425,#05060a_72%)]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      data-ui-chrome
      aria-label={`小游戏：${minigame.title}`}
    >
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-6 px-[clamp(18px,3vw,42px)] pt-[clamp(16px,2.6vh,30px)]">
        <div className="max-w-[min(620px,68vw)]">
          <p className="m-0 text-[10px] tracking-[0.34em] text-sg-gold/75">MINIGAME</p>
          <h2 className="m-0 mt-1 font-dialogue text-[clamp(20px,2.6vw,28px)] tracking-[0.2em] text-sg-ink">
            {minigame.title}
          </h2>
          {minigame.prompt && (
            <p className="m-0 mt-2 text-[12px] leading-[1.8] tracking-[0.06em] text-sg-muted">
              {minigame.prompt}
            </p>
          )}
        </div>
        <button
          type="button"
          className="pointer-events-auto shrink-0 rounded-sm border border-sg-ink/15 bg-[#0a0c14]/60 px-4 py-2 text-[12px] tracking-[0.14em] text-sg-muted backdrop-blur-md transition-colors hover:border-sg-ink/30 hover:text-sg-ink"
          onClick={() => void confirmSkip()}
        >
          跳过
        </button>
      </header>

      {/* Phaser 容器：尺寸由 CSS 控制，小游戏内部用 RESIZE 模式自适应。 */}
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {status !== 'ready' && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-[8vw]">
          <div className="pointer-events-auto max-w-[560px] rounded-[4px] border border-sg-line/40 bg-[#0a0c14]/88 px-8 py-7 text-center shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur-md">
            {status === 'loading' && (
              <>
                <div className="mx-auto mb-4 h-[2px] w-28 overflow-hidden rounded-full bg-sg-line/30">
                  <motion.div
                    className="h-full w-1/2 bg-sg-accent"
                    animate={{ x: ['-100%', '200%'] }}
                    transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut' }}
                  />
                </div>
                <p className="m-0 text-sm tracking-[0.12em] text-sg-muted">正在摆好琴键…</p>
              </>
            )}

            {status === 'missing' && (
              <>
                <p className="m-0 text-sm leading-[1.8] text-sg-ink/85">
                  当前平台没有接入这段小游戏，可以直接跳过，剧情会使用预设结果继续。
                </p>
                <button
                  type="button"
                  className="mt-5 rounded-sm border border-sg-line bg-sg-accent/10 px-5 py-2 text-[13px] tracking-[0.12em] transition-colors hover:border-sg-line-strong hover:bg-sg-accent/20"
                  onClick={() => void continueStory()}
                >
                  继续剧情
                </button>
              </>
            )}

            {status === 'error' && (
              <>
                <p className="m-0 text-sm leading-[1.8] text-sg-ink/85">小游戏加载失败。</p>
                {error && (
                  <p className="m-0 mt-2 break-all text-[11px] leading-[1.7] text-sg-dim">{error}</p>
                )}
                <div className="mt-5 flex justify-center gap-3">
                  <button
                    type="button"
                    className="rounded-sm border border-sg-ink/15 px-5 py-2 text-[13px] tracking-[0.12em] text-sg-muted transition-colors hover:border-sg-ink/30 hover:text-sg-ink"
                    onClick={() => setAttempt((value) => value + 1)}
                  >
                    重试
                  </button>
                  <button
                    type="button"
                    className="rounded-sm border border-sg-line bg-sg-accent/10 px-5 py-2 text-[13px] tracking-[0.12em] transition-colors hover:border-sg-line-strong hover:bg-sg-accent/20"
                    onClick={() => void continueStory()}
                  >
                    继续剧情
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {dialog}
    </motion.div>
  );
}
