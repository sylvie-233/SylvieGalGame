import type { Transition, TransitionEase } from '@sylvie/types';
import { AnimatePresence, motion } from 'motion/react';

interface CrossfadeImageProps {
  src: string | null;
  assetUrl: (path: string) => string;
  alt: string;
  transition: Transition;
  ease?: TransitionEase;
  duration: number;
  className?: string;
  imageClassName?: string;
}

interface TransitionVariants {
  initial: Record<string, string | number>;
  exit: Record<string, string | number>;
}

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

const SETTLED = {
  opacity: 1,
  x: '0%',
  filter: 'blur(0px)',
  clipPath: 'inset(0 0% 0 0)',
};

/** 基于 Motion 的单图层转场：fade / dissolve / slide / wipe。 */
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
