import { motion } from 'motion/react';
import type { ReactNode } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

export function Modal({ title, onClose, children, footer, wide = false }: ModalProps) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-[3vw] py-[4vh]"
      data-ui-chrome
    >
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
