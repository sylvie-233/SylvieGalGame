import type { DialogueSnapshot } from '@sylvie/types';
import { AnimatePresence, motion } from 'motion/react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

/** 打字机的命令式接口：外层点击时先补全当前句，再决定是否推进。 */
export interface DialogueHandle {
  /** 当前文本是否仍在逐字显示。 */
  isTyping(): boolean;
  /** 立即显示完整文本。 */
  completeTyping(): void;
}

interface DialogueBoxProps {
  /** 当前对话；null 时对话框淡出但保留布局。 */
  dialogue: DialogueSnapshot | null;
  /** 打字速度（字 / 秒），内部换算成每字延迟。 */
  typingSpeed: number;
  /** 跳过已读：直接显示完整文本，不播放打字动画。 */
  skip: boolean;
  /** 自动播放：文本显示完毕后等待 autoDelay 再推进。 */
  auto: boolean;
  /** 自动播放的句末等待时间（毫秒）。 */
  autoDelay: number;
  /** 自动播放计时结束时的推进回调。 */
  onAutoAdvance: () => void;
  /** 有覆盖层（历史 / 存读档 / 设置等）打开时暂停自动推进。 */
  paused?: boolean;
}

/**
 * 对话打字机与对话框。
 * 通过逐字增加 `typed` 模拟打字效果；`skip` 时立即补全，`auto` 时在
 * 文本显示完后启动一次定时器调用 `onAutoAdvance`。打字进度以对话 id 重置。
 */
export const DialogueBox = forwardRef<DialogueHandle, DialogueBoxProps>(function DialogueBox(
  { dialogue, typingSpeed, skip, auto, autoDelay, onAutoAdvance, paused = false },
  ref,
) {
  const text = dialogue?.text ?? '';
  const [typed, setTyped] = useState(0);
  // 用 ref 保存最新文本长度，避免命令式句柄因闭包拿到旧的 text。
  const textLengthRef = useRef(0);
  textLengthRef.current = text.length;

  // 换到新对话时重置打字进度。
  useEffect(() => {
    setTyped(0);
  }, [dialogue?.id]);

  // 打字循环：每次只增加一个字，再由 typed 变化触发下一次；speed 是字 / 秒。
  useEffect(() => {
    if (!dialogue) return;
    if (skip) {
      setTyped(text.length);
      return;
    }
    if (typed >= text.length) return;
    const delay = Math.max(8, Math.round(1000 / Math.max(1, typingSpeed)));
    const timer = window.setTimeout(() => {
      setTyped((value) => Math.min(text.length, value + 1));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [dialogue, text.length, typingSpeed, skip, typed]);

  // 自动播放：仅在文本完整显示后启动一次等待，任何依赖变化都会取消旧计时。
  // 覆盖层打开（paused）时不启动，避免玩家在面板背后被推进剧情。
  useEffect(() => {
    if (!dialogue || !auto || skip || paused) return;
    if (typed < text.length) return;
    const timer = window.setTimeout(onAutoAdvance, autoDelay);
    return () => window.clearTimeout(timer);
  }, [dialogue, auto, skip, paused, typed, text.length, autoDelay, onAutoAdvance]);

  // 句柄只暴露查询与补全；内部通过 ref 读取最新长度，避免依赖过期闭包。
  useImperativeHandle(
    ref,
    () => ({
      isTyping: () => typed < textLengthRef.current,
      completeTyping: () => setTyped(textLengthRef.current),
    }),
    [typed],
  );

  const typing = typed < text.length;

  return (
    <section
      className={`pointer-events-none absolute inset-x-[6%] bottom-[clamp(26px,4.6vh,54px)] z-20 transition-opacity duration-300 ${
        dialogue ? 'opacity-100' : 'opacity-0'
      }`}
      aria-live="polite"
    >
      {/* popLayout：换说话人时旧名牌立刻脱离文档流，避免新旧两个名牌并排导致名字先闪到右侧。 */}
      <AnimatePresence initial={false} mode="popLayout">
        {dialogue?.speaker && (
          <motion.div
            key={dialogue.speaker}
            data-speaker={dialogue.speaker}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="ml-[26px] mb-[-1px] inline-flex items-center rounded-t-[3px] border border-b-0 border-sg-line bg-gradient-to-r from-[#1c141e]/95 to-[#161826]/90 px-6 py-2 font-dialogue text-[clamp(15px,1.5vw,19px)] tracking-[0.18em] text-sg-accent-strong"
            style={{ textShadow: '0 2px 14px rgba(230, 154, 180, 0.25)' }}
          >
            {dialogue.speaker}
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={`relative min-h-[clamp(132px,20vh,196px)] rounded-[4px] border border-sg-line bg-[linear-gradient(180deg,rgba(13,16,27,0.94),rgba(8,10,18,0.9))] px-[clamp(28px,3.8vw,54px)] py-[clamp(24px,3.4vh,36px)] shadow-[0_24px_70px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-[14px] before:absolute before:inset-y-[12%] before:left-0 before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-sg-accent before:to-transparent before:opacity-60 ${
          dialogue?.speaker ? 'rounded-tl-none' : ''
        }`}
      >
        <div className="min-h-[3.8em] whitespace-pre-wrap font-dialogue text-[clamp(16px,1.55vw,21px)] leading-[1.9] tracking-[0.04em] text-[#f4efe9]/95 [text-shadow:0_1px_12px_rgba(0,0,0,0.35)]">
          {text.slice(0, typed)}
          {typing && (
            <motion.span
              className="ml-0.5 inline-block h-[1.05em] w-0.5 translate-y-[0.18em] bg-sg-accent align-baseline"
              animate={{ opacity: [1, 0, 1] }}
              transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
              aria-hidden="true"
            />
          )}
        </div>

        <AnimatePresence>
          {dialogue && !typing && (
            <motion.div
              className="absolute right-[clamp(20px,2.6vw,34px)] bottom-[clamp(14px,2vh,22px)]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              aria-hidden="true"
            >
              <motion.span
                className="block h-[7px] w-[7px] rounded-full bg-sg-accent shadow-[0_0_12px_rgba(230,154,180,0.8)]"
                animate={{ y: [0, 2, 0], opacity: [0.35, 1, 0.35] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
});
