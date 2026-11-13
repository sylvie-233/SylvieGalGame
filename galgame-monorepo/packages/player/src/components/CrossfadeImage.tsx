import { AnimatePresence, motion } from 'motion/react';

interface CrossfadeImageProps {
  src: string | null;
  assetUrl: (path: string) => string;
  alt: string;
  fade: boolean;
  duration: number;
  className?: string;
  imageClassName?: string;
}

/** 基于 Motion 的单图层交叉淡入淡出，一期只做 fade。 */
export function CrossfadeImage({
  src,
  assetUrl,
  alt,
  fade,
  duration,
  className = '',
  imageClassName = 'object-contain',
}: CrossfadeImageProps) {
  return (
    <div className={`relative h-full w-full ${className}`}>
      <AnimatePresence initial={false}>
        {src && (
          <motion.img
            key={src}
            className={`absolute inset-0 h-full w-full ${imageClassName}`}
            src={assetUrl(src)}
            alt={alt}
            draggable={false}
            initial={fade ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{
              duration: fade ? Math.max(0, duration) / 1000 : 0,
              ease: 'easeInOut',
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
