import type { ChoiceSnapshot } from '@sylvie/types';
import { AnimatePresence, motion } from 'motion/react';

interface ChoiceOverlayProps {
  choice: ChoiceSnapshot | null;
  onChoose: (optionIndex: number) => void;
}

export function ChoiceOverlay({ choice, onChoose }: ChoiceOverlayProps) {
  return (
    <AnimatePresence>
      {choice && (
        <motion.div
          key="choice"
          className="pointer-events-auto absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-[radial-gradient(circle_at_center,rgba(4,5,9,0.42),rgba(4,5,9,0.72))] px-[16vw]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          role="dialog"
          aria-label="选择"
        >
          {choice.prompt && (
            <motion.div
              className="mb-2 text-center font-dialogue text-[clamp(15px,1.4vw,18px)] tracking-[0.2em] text-sg-gold"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              {choice.prompt}
            </motion.div>
          )}

          <div className="flex w-[min(520px,100%)] flex-col gap-3.5">
            {choice.options.map((option, index) => (
              <motion.button
                key={option.optionIndex}
                type="button"
                className="flex items-center gap-3.5 rounded-[3px] border border-sg-line bg-[linear-gradient(120deg,rgba(22,24,38,0.9),rgba(12,14,24,0.92))] px-6 py-4 text-left text-[clamp(14px,1.3vw,17px)] tracking-[0.1em] text-sg-ink backdrop-blur-md transition-colors hover:border-sg-line-strong hover:bg-[linear-gradient(120deg,rgba(44,29,40,0.92),rgba(20,21,34,0.94))] focus-visible:outline-none"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12 + index * 0.07, duration: 0.35, ease: 'easeOut' }}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => onChoose(option.optionIndex)}
              >
                <span className="text-[11px] text-sg-accent opacity-70">◆</span>
                {option.text}
              </motion.button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
