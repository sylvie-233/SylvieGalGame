import { useCallback, useRef, useState, type ReactNode } from 'react';

import { Modal } from './Modal';

export interface ConfirmOptions {
  /** 弹窗标题，默认“请确认”。 */
  title?: string;
  /** 确认按钮文案，默认“确定”。 */
  confirmLabel?: string;
  /** 取消按钮文案，默认“取消”。 */
  cancelLabel?: string;
  /** 使用危险色（删除、覆盖、返回标题等不可逆操作）。 */
  danger?: boolean;
}

/** 当前待确认的请求；resolve 为对应的 Promise 收束函数。 */
interface ConfirmState extends ConfirmOptions {
  message: string;
  resolve: (confirmed: boolean) => void;
}

/**
 * 应用内确认框，替代原生 window.confirm。
 * 原生确认框会阻塞渲染与 CDP 自动化，且无法沿用播放器样式。
 *
 * 返回 `{ confirm, dialog }`：
 * - `confirm(message, options)` 返回 Promise<boolean>，确认 / 取消 / 关闭分别 resolve
 *   true / false；若上一次确认尚未回答就被新请求替换，旧 Promise 会先 resolve(false)，
 *   防止调用方永久等待；
 * - `dialog` 需由调用方渲染到组件树中。
 */
export function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null);
  const stateRef = useRef<ConfirmState | null>(null);

  const confirm = useCallback(
    (message: string, options: ConfirmOptions = {}): Promise<boolean> =>
      new Promise((resolve) => {
        // 连点触发第二次确认时，先把上一个未决 Promise 收束为取消。
        stateRef.current?.resolve(false);
        const next = { message, resolve, ...options };
        stateRef.current = next;
        setState(next);
      }),
    [],
  );

  /** 结束当前确认：先清空 ref 再 resolve，避免同一请求被重复结算。 */
  const settle = useCallback((confirmed: boolean) => {
    const current = stateRef.current;
    if (!current) return;
    stateRef.current = null;
    current.resolve(confirmed);
    setState(null);
  }, []);

  // 关闭（× / Esc / 遮罩）等同于取消；确认按钮默认聚焦，便于键盘操作。
  const dialog: ReactNode = state ? (
    <Modal title={state.title ?? '请确认'} onClose={() => settle(false)}>
      <p className="m-0 whitespace-pre-wrap text-sm leading-[1.9] tracking-[0.03em] text-sg-ink/80">
        {state.message}
      </p>
      <div className="mt-7 flex justify-end gap-2.5">
        <button
          type="button"
          className="rounded-sm border border-sg-ink/15 bg-transparent px-5 py-2 text-[13px] tracking-[0.12em] text-sg-muted transition-colors hover:border-sg-ink/30 hover:text-sg-ink"
          onClick={() => settle(false)}
        >
          {state.cancelLabel ?? '取消'}
        </button>
        <button
          type="button"
          autoFocus
          className={`rounded-sm border px-5 py-2 text-[13px] tracking-[0.12em] transition-colors ${
            state.danger
              ? 'border-red-300/30 bg-red-950/40 text-red-100 hover:border-red-300/60 hover:bg-red-900/50'
              : 'border-sg-line bg-sg-accent/10 text-sg-ink hover:border-sg-line-strong hover:bg-sg-accent/20'
          }`}
          onClick={() => settle(true)}
        >
          {state.confirmLabel ?? '确定'}
        </button>
      </div>
    </Modal>
  ) : null;

  return { confirm, dialog };
}
