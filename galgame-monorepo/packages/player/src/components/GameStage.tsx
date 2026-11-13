import type { GameSnapshot, SpritePosition } from '@sylvie/types';
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
}

function spriteLeft(position: SpritePosition): string {
  if (typeof position === 'number') return `${position}%`;
  if (position === 'left') return '20%';
  if (position === 'right') return '80%';
  return '50%';
}

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
          fade={background.transition === 'fade'}
          duration={background.duration}
          imageClassName="object-cover brightness-[0.92] saturate-[0.96]"
        />
      </div>

      <div className="pointer-events-none absolute inset-0 z-[2]" aria-hidden="true">
        {sprites.map((sprite) => (
          <div
            key={sprite.id}
            className="absolute bottom-[-1%] h-[90%] w-[min(44vw,62vh)] -translate-x-1/2 drop-shadow-[0_18px_32px_rgba(0,0,0,0.4)] transition-[opacity,left] ease-[cubic-bezier(0.22,0.61,0.36,1)] will-change-[opacity,left]"
            style={{
              left: spriteLeft(sprite.position),
              opacity: sprite.opacity,
              transitionDuration: `${sprite.transition === 'fade' ? sprite.duration : 0}ms`,
            }}
          >
            {sprite.image && (
              <CrossfadeImage
                src={sprite.image}
                assetUrl={assetUrl}
                alt={sprite.id}
                fade={sprite.transition === 'fade'}
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
          transitionDuration: `${cg.transition === 'fade' ? cg.duration : 0}ms`,
        }}
        aria-hidden="true"
      >
        {cg.image && (
          <CrossfadeImage
            src={cg.image}
            assetUrl={assetUrl}
            alt="CG"
            fade={cg.transition === 'fade'}
            duration={cg.duration}
            imageClassName="object-cover"
          />
        )}
      </div>

      <div className={`pointer-events-none absolute inset-0 z-[5] ${VIGNETTE}`} aria-hidden="true" />

      <div className="absolute inset-0 z-10 cursor-pointer" onClick={onInteract} aria-hidden="true" />

      <DialogueBox
        ref={dialogueRef}
        dialogue={snapshot.dialogue}
        typingSpeed={typingSpeed}
        skip={skip}
        auto={auto}
        autoDelay={autoDelay}
        onAutoAdvance={onAutoAdvance}
      />

      <ChoiceOverlay choice={snapshot.choice} onChoose={onChoose} />
    </div>
  );
}
