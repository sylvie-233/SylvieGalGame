import type { Transition, TransitionEase } from '@sylvie/types';
import { AnimatePresence, motion } from 'motion/react';

interface CrossfadeImageProps {
  /** 内容包内的图片相对路径；null 时只渲染空容器。 */
  src: string | null;
  /** 相对路径 → 可访问 URL。 */
  assetUrl: (path: string) => string;
  /** 无障碍替代文本。 */
  alt: string;
  /** 转场类型；`none` 表示直接切换，不播放动画。 */
  transition: Transition;
  /** 动画缓动，默认 easeInOut。 */
  ease?: TransitionEase;
  /** 转场时长（毫秒）。 */
  duration: number;
  /** 外层容器附加类名。 */
  className?: string;
  /** 图片本身的 object-fit 等类名。 */
  imageClassName?: string;
}

/** 单种转场的进入 / 离开关键帧。 */
interface TransitionVariants {
  initial: Record<string, string | number>;
  exit: Record<string, string | number>;
}

/** 各转场类型的关键帧；`none` 单独走无动画分支。 */
const VARIANTS: Record<Exclude<Transition, 'none'>, TransitionVariants> = {
  fade: {
    initial: { opacity: 0 },
    exit: { opacity: 0 },
  },
  dissolve: {
    initial: { opacity: 0, filter: 'blur(10px)' },
    exit: { opacity: 0, filter: 'blur(10px)' },
  },
  'slide-left': {
    initial: { x: '100%' },
    exit: { x: '-100%' },
  },
  'slide-right': {
    initial: { x: '-100%' },
    exit: { x: '100%' },
  },
  wipe: {
    initial: { clipPath: 'inset(0 100% 0 0)' },
    exit: { clipPath: 'inset(0 0 0 100%)' },
  },
};

/** 所有转场最终收敛到的稳定状态；未用到的属性对当前转场无副作用。 */
const SETTLED = {
  opacity: 1,
  x: '0%',
  filter: 'blur(0px)',
  clipPath: 'inset(0 0% 0 0)',
};

/**
 * 基于 Motion 的单图层图片转场：fade / dissolve / slide / wipe。
 * `src` 变化时以 src 为 key 触发 AnimatePresence，旧图按 variants.exit 离开、
 * 新图按 variants.initial 进入；`none` 时关闭动画直接替换。
 */
export function CrossfadeImage({
  src,
  assetUrl,
  alt,
  transition,
  ease = 'easeInOut',
  duration,
  className = '',
  imageClassName = 'object-contain',
}: CrossfadeImageProps) {
  const variants = transition === 'none' ? null : VARIANTS[transition];
  const seconds = variants ? Math.max(0, duration) / 1000 : 0;

  return (
    <div className={`relative h-full w-full overflow-hidden ${className}`}>
      <AnimatePresence initial={false}>
        {src && (
          <motion.img
            key={src}
            className={`absolute inset-0 h-full w-full ${imageClassName}`}
            src={assetUrl(src)}
            alt={alt}
            draggable={false}
            initial={variants ? variants.initial : false}
            animate={SETTLED}
            exit={variants ? variants.exit : undefined}
            transition={{ duration: seconds, ease }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
