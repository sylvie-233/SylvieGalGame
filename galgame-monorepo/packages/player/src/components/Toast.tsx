import { AnimatePresence, motion } from 'motion/react';

/**
 * 底部轻提示。
 * 文案非空时淡入展示，由 store 的 showToast 在 2.6 秒后清空；
 * key 使用文案本身，连续不同提示会重新播放进入动画。
 */
export function Toast({ message }: { message: string | null }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[34px] z-[220] flex justify-center px-4"
      data-ui-chrome
    >
      <AnimatePresence>
        {message && (
          <motion.div
            key={message}
            className="rounded-[3px] border border-sg-line bg-[#0a0c14]/90 px-6 py-2.5 text-[13px] tracking-[0.1em] text-sg-accent-strong shadow-[0_10px_30px_rgba(0,0,0,0.45)]"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
            role="status"
          >
            {message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
