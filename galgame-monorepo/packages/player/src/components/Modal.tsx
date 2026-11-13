import { motion } from 'motion/react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

interface ModalProps {
  /** 标题栏文案，同时作为 dialog 的 aria-label。 */
  title: string;
  /** 关闭回调；Esc、右上角 × 与点击遮罩都会触发。 */
  onClose: () => void;
  /** 弹窗主体内容。 */
  children: ReactNode;
  /** 可选固定底栏。 */
  footer?: ReactNode;
  /** 使用更宽的最大宽度（存档、图鉴等面板）。 */
  wide?: boolean;
}

/** 弹窗栈中的一项；close 始终调用最新的 onClose，避免闭包过期。 */
interface ModalEntry {
  id: string;
  close: () => void;
}

/**
 * 当前打开的 Modal 栈。
 * 每个 Modal 挂载时入栈、卸载时出栈；Esc 事件只由栈顶处理，
 * 因此嵌套确认框 / 存档面板时只会关闭最上层，不会一次退掉整串弹窗。
 */
const modalStack: ModalEntry[] = [];

/**
 * 播放器统一弹窗外壳：遮罩、标题栏、滚动主体与可选底栏。
 * 所有需要弹出层的面板都应使用它，以共享弹窗栈与 Esc 行为，
 * 不要自行写 `<div role="dialog">`。
 */
export function Modal({ title, onClose, children, footer, wide = false }: ModalProps) {
  const id = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // 挂载时入栈并监听捕获阶段的 Esc；只有栈顶能关闭，并阻止事件继续传播，
  // 避免同时触发游戏内“Esc 打开菜单”等快捷键。
  useEffect(() => {
    const entry: ModalEntry = { id, close: () => closeRef.current() };
    modalStack.push(entry);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (modalStack[modalStack.length - 1]?.id !== id) return;
      event.stopImmediatePropagation();
      entry.close();
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      const index = modalStack.indexOf(entry);
      if (index >= 0) modalStack.splice(index, 1);
    };
  }, [id]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-[3vw] py-[4vh]"
      data-ui-chrome
    >
      {/* 点击遮罩空白处关闭；只在直接命中遮罩时触发，避免冒泡误关。 */}
      <motion.div
        className="absolute inset-0 bg-[#030408]/70 backdrop-blur-md"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      />

      <motion.section
        className={`relative flex max-h-[88vh] flex-col rounded-[4px] border border-sg-line bg-[linear-gradient(180deg,rgba(17,20,32,0.97),rgba(9,11,19,0.98))] shadow-[0_24px_70px_rgba(0,0,0,0.55)] ${
          wide ? 'w-[min(1080px,94vw)]' : 'w-[min(640px,94vw)]'
        }`}
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="flex items-center justify-between border-b border-sg-line/15 px-7 pt-[22px] pb-4">
          <h2 className="m-0 font-dialogue text-[22px] font-medium tracking-[0.18em] text-sg-accent-strong">
            {title}
          </h2>
          <button
            type="button"
            className="rounded-sm px-2 py-1 text-[22px] leading-none text-sg-muted transition-colors hover:bg-sg-accent/10 hover:text-sg-accent-strong"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </header>
        <div className="sg-scroll overflow-y-auto px-7 pt-[22px] pb-7">{children}</div>
        {footer && <footer className="px-7 pt-3.5 pb-[22px]">{footer}</footer>}
      </motion.section>
    </div>
  );
}
