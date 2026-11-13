import type { GameSnapshot, SpritePosition, TransitionEase } from '@sylvie/types';
import type { RefObject } from 'react';

import { ChoiceOverlay } from './ChoiceOverlay';
import { CrossfadeImage } from './CrossfadeImage';
import { DialogueBox, type DialogueHandle } from './DialogueBox';

interface GameStageProps {
  snapshot: GameSnapshot;
  assetUrl: (path: string) => string;
  dialogueRef: RefObject<DialogueHandle | null>;
  typingSpeed: number;
  skip: boolean;
  auto: boolean;
  autoDelay: number;
  onAutoAdvance: () => void;
  onInteract: () => void;
  onChoose: (optionIndex: number) => void;
  /** 隐藏对话与舞台 UI，只保留画面；由外层提供恢复入口。 */
  uiHidden?: boolean;
}

function spriteLeft(position: SpritePosition): string {
  if (typeof position === 'number') return `${position}%`;
  if (position === 'left') return '20%';
  if (position === 'right') return '80%';
  return '50%';
}

const EASE_CSS: Record<TransitionEase, string> = {
  linear: 'linear',
  easeIn: 'cubic-bezier(0.42, 0, 1, 1)',
  easeOut: 'cubic-bezier(0, 0, 0.58, 1)',
  easeInOut: 'cubic-bezier(0.42, 0, 0.58, 1)',
};

const VIGNETTE =
  'bg-[radial-gradient(ellipse_at_50%_46%,transparent_42%,rgba(3,4,8,0.5)_100%),linear-gradient(0deg,rgba(4,5,9,0.72)_0%,transparent_38%),linear-gradient(180deg,rgba(4,5,9,0.28)_0%,transparent_22%)]';

export function GameStage({
  snapshot,
  assetUrl,
  dialogueRef,
  typingSpeed,
  skip,
  auto,
  autoDelay,
  onAutoAdvance,
  onInteract,
  onChoose,
  uiHidden = false,
}: GameStageProps) {
  const background = snapshot.stage.background;
  const cg = snapshot.stage.cg;
  const sprites = Object.values(snapshot.stage.sprites);

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#05060a]">
      <div className="absolute inset-0 z-[1]">
        <CrossfadeImage
          src={background.image}
          assetUrl={assetUrl}
          alt="背景"
          transition={background.transition}
          ease={background.ease}
          duration={background.duration}
          imageClassName="object-cover brightness-[0.92] saturate-[0.96]"
        />
      </div>

      <div className="pointer-events-none absolute inset-0 z-[2]" aria-hidden="true">
        {sprites.map((sprite) => (
          <div
            key={sprite.id}
            className="absolute bottom-[-1%] h-[90%] w-[min(44vw,62vh)] drop-shadow-[0_18px_32px_rgba(0,0,0,0.4)] transition-[opacity,left,transform] ease-[cubic-bezier(0.22,0.61,0.36,1)] will-change-[opacity,left,transform]"
            style={{
              left: spriteLeft(sprite.position),
              opacity: sprite.opacity,
              zIndex: sprite.z ?? 0,
              transform: `translateX(-50%) scale(${sprite.scale ?? 1}) scaleX(${
                sprite.flip ? -1 : 1
              })`,
              transformOrigin: 'bottom center',
              transitionDuration: `${sprite.transition === 'none' ? 0 : sprite.duration}ms`,
              transitionTimingFunction: EASE_CSS[sprite.ease ?? 'easeInOut'],
            }}
          >
            {sprite.image && (
              <CrossfadeImage
                src={sprite.image}
                assetUrl={assetUrl}
                alt={sprite.id}
                transition={sprite.transition}
                ease={sprite.ease}
                duration={sprite.duration}
                imageClassName="object-contain object-bottom"
              />
            )}
          </div>
        ))}
      </div>

      <div
        className="pointer-events-none absolute inset-0 z-[3] transition-opacity ease-in-out"
        style={{
          opacity: cg.visible ? 1 : 0,
          transitionDuration: `${cg.transition === 'none' ? 0 : cg.duration}ms`,
          transitionTimingFunction: EASE_CSS[cg.ease ?? 'easeInOut'],
        }}
        aria-hidden="true"
      >
        {cg.image && (
          <CrossfadeImage
            src={cg.image}
            assetUrl={assetUrl}
            alt="CG"
            transition={cg.transition}
            ease={cg.ease}
            duration={cg.duration}
            imageClassName="object-cover"
          />
        )}
      </div>

      <div className={`pointer-events-none absolute inset-0 z-[5] ${VIGNETTE}`} aria-hidden="true" />

      <div className="absolute inset-0 z-10 cursor-pointer" onClick={onInteract} aria-hidden="true" />

      {!uiHidden && (
        <DialogueBox
          ref={dialogueRef}
          dialogue={snapshot.dialogue}
          typingSpeed={typingSpeed}
          skip={skip}
          auto={auto}
          autoDelay={autoDelay}
          onAutoAdvance={onAutoAdvance}
        />
      )}

      <ChoiceOverlay choice={snapshot.choice} onChoose={onChoose} />
    </div>
  );
}
