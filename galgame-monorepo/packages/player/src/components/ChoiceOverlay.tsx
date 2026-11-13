import type { ChoiceSnapshot } from '@sylvie/types';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import { isEditableTarget } from '../dom';

interface ChoiceOverlayProps {
  /** 当前选项快照；null 时不渲染遮罩。 */
  choice: ChoiceSnapshot | null;
  /** 玩家确认选项，参数为选项在剧本中的原始下标（不是渲染序号）。 */
  onChoose: (optionIndex: number) => void;
  /** 上层覆盖层打开时暂停快捷键，避免在备注输入框里误选分支。 */
  paused?: boolean;
}

/**
 * 选项遮罩：支持鼠标点击，也接管方向键、Home / End、数字键与回车。
 * 焦点与高亮通过 active / activeRef 同步：ref 供事件处理器读取最新值，
 * state 驱动样式；选项出现时自动聚焦第一项。
 */
export function ChoiceOverlay({ choice, onChoose, paused = false }: ChoiceOverlayProps) {
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);

  /** 移动到指定选项：同步 ref / state 并把浏览器焦点交给对应按钮。 */
  const focusOption = (index: number) => {
    activeRef.current = index;
    setActive(index);
    buttonsRef.current[index]?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!choice || paused) return;
    activeRef.current = 0;
    setActive(0);
    const frame = requestAnimationFrame(() => {
      buttonsRef.current[0]?.focus({ preventScroll: true });
    });

    // 选项出现时接管方向键 / 数字键 / 回车；鼠标点击仍然有效。
    // 使用捕获阶段并挂在 window 上，确保优先于外层推进 / 回退快捷键。
    const onKeyDown = (event: KeyboardEvent) => {
      // 备注输入框等文本控件拥有自己的键行为，不能被选项快捷键截走。
      if (isEditableTarget(event.target)) return;
      const options = choice.options;
      if (options.length === 0) return;
      const key = event.key;
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault();
        const step = key === 'ArrowDown' ? 1 : -1;
        focusOption((activeRef.current + step + options.length) % options.length);
        return;
      }
      if (key === 'Home' || key === 'End') {
        event.preventDefault();
        focusOption(key === 'Home' ? 0 : options.length - 1);
        return;
      }
      if (/^[1-9]$/.test(key)) {
        const index = Number(key) - 1;
        const option = options[index];
        if (!option) return;
        event.preventDefault();
        onChoose(option.optionIndex);
        return;
      }
      if (key === 'Enter') {
        const option = options[activeRef.current];
        if (!option) return;
        event.preventDefault();
        event.stopPropagation();
        onChoose(option.optionIndex);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [choice, onChoose, paused]);

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
                ref={(node) => {
                  buttonsRef.current[index] = node;
                }}
                type="button"
                className={`flex items-center gap-3.5 rounded-[3px] border px-6 py-4 text-left text-[clamp(14px,1.3vw,17px)] tracking-[0.1em] text-sg-ink backdrop-blur-md transition-colors focus-visible:outline-none ${
                  active === index
                    ? 'border-sg-line-strong bg-[linear-gradient(120deg,rgba(44,29,40,0.92),rgba(20,21,34,0.94))]'
                    : 'border-sg-line bg-[linear-gradient(120deg,rgba(22,24,38,0.9),rgba(12,14,24,0.92))] hover:border-sg-line-strong'
                }`}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12 + index * 0.07, duration: 0.35, ease: 'easeOut' }}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.99 }}
                onFocus={() => {
                  activeRef.current = index;
                  setActive(index);
                }}
                onMouseEnter={() => {
                  activeRef.current = index;
                  setActive(index);
                }}
                onClick={() => onChoose(option.optionIndex)}
              >
                <span className="text-[11px] tabular-nums text-sg-accent opacity-70">
                  {index + 1}
                </span>
                {option.text}
              </motion.button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
