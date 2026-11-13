import { Component, type ErrorInfo, type ReactNode } from 'react';

import { getPlayerPlatform } from '../player-config';

function platformPaths(): { logPath: string | null; storagePath: string | null } {
  try {
    const platform = getPlayerPlatform();
    return { logPath: platform.logPath ?? null, storagePath: platform.storagePath ?? null };
  } catch {
    return { logPath: null, storagePath: null };
  }
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** 渲染层兜底，避免单个组件异常导致整页白屏。 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[播放器] 渲染异常', error, info.componentStack);
  }

  private readonly reload = (): void => {
    window.location.reload();
  };

  private readonly copyError = (): void => {
    const error = this.state.error;
    if (!error) return;
    const { logPath, storagePath } = platformPaths();
    const text = [
      `${error.name}: ${error.message}`,
      error.stack ?? '',
      logPath ? `日志：${logPath}` : '',
      storagePath ? `存档：${storagePath}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    void navigator.clipboard
      ?.writeText(text)
      .catch(() => console.warn('[播放器] 无法复制错误信息'));
  };

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const { logPath, storagePath } = platformPaths();

    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_center,#16101a,#05060a_70%)] px-[8vw] text-center text-sg-ink">
        <h1 className="m-0 font-dialogue text-[clamp(26px,4vw,36px)] tracking-[0.16em] text-sg-accent">
          播放器遇到异常
        </h1>
        <p className="m-0 max-w-[680px] whitespace-pre-wrap text-sm leading-[1.8] text-sg-muted">
          {this.state.error.message || '发生了未知渲染错误。'}
        </p>
        <div className="mt-3 flex gap-2.5">
          <button
            type="button"
            className="rounded-sm border border-sg-ink/15 bg-transparent px-5 py-2 text-[13px] tracking-[0.12em] text-sg-muted transition-colors hover:border-sg-ink/30 hover:text-sg-ink"
            onClick={this.copyError}
          >
            复制错误
          </button>
          <button
            type="button"
            className="rounded-sm border border-sg-line bg-sg-accent/10 px-5 py-2 text-[13px] tracking-[0.12em] transition-colors hover:border-sg-line-strong hover:bg-sg-accent/20"
            onClick={this.reload}
          >
            重新加载
          </button>
        </div>
        <p className="m-0 mt-2 text-xs text-sg-dim">存档仍在本地，重新加载后可继续游戏。</p>
        {(logPath || storagePath) && (
          <div className="mt-2 max-w-[680px] space-y-1 text-left text-[11px] leading-[1.7] break-all text-sg-dim/80">
            {storagePath && <p className="m-0">存档：{storagePath}</p>}
            {logPath && <p className="m-0">日志：{logPath}</p>}
          </div>
        )}
      </div>
    );
  }
}
