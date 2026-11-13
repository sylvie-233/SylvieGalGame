import type { GameSnapshot, SpritePosition, TransitionEase } from '@sylvie/types';
import type { RefObject } from 'react';

import { AmbientLayer } from './AmbientLayer';
import { ChoiceOverlay } from './ChoiceOverlay';
import { CrossfadeImage } from './CrossfadeImage';
import { DialogueBox, type DialogueHandle } from './DialogueBox';

interface GameStageProps {
  /** 引擎当前快照，包含背景、立绘、CG、对话与选项。 */
  snapshot: GameSnapshot;
  /** 把内容包相对路径转换为宿主可访问的 URL。 */
  assetUrl: (path: string) => string;
  /** 打字机命令式句柄，供外层实现“先补全再推进”。 */
  dialogueRef: RefObject<DialogueHandle | null>;
  /** 打字速度（字 / 秒）。 */
  typingSpeed: number;
  /** 跳过已读：对话立即完整显示。 */
  skip: boolean;
  /** 自动播放：文本打完并等待 autoDelay 后推进。 */
  auto: boolean;
  /** 自动播放的句末等待时间（毫秒）。 */
  autoDelay: number;
  /** 自动播放计时结束时由对话组件回调。 */
  onAutoAdvance: () => void;
  /** 点击舞台空白区域。 */
  onInteract: () => void;
  /** 玩家确认选项，参数为选项在剧本中的原始下标。 */
  onChoose: (optionIndex: number) => void;
  /** 隐藏对话与舞台 UI，只保留画面；由外层提供恢复入口。 */
  uiHidden?: boolean;
  /** 有覆盖层打开时暂停自动播放与选项快捷键，避免在面板背后推进剧情。 */
  paused?: boolean;
}

/** 把数值或 left / center / right 语义位置转成 CSS left 百分比。 */
function spriteLeft(position: SpritePosition): string {
  if (typeof position === 'number') return `${position}%`;
  if (position === 'left') return '20%';
  if (position === 'right') return '80%';
  return '50%';
}

/** 剧本中的缓动名映射到 CSS timing-function。 */
const EASE_CSS: Record<TransitionEase, string> = {
  linear: 'linear',
  easeIn: 'cubic-bezier(0.42, 0, 1, 1)',
  easeOut: 'cubic-bezier(0, 0, 0.58, 1)',
  easeInOut: 'cubic-bezier(0.42, 0, 0.58, 1)',
};

/** 背景暗角与上下渐变，压暗边缘以突出立绘与对话框。 */
const VIGNETTE =
  'bg-[radial-gradient(ellipse_at_50%_46%,transparent_42%,rgba(3,4,8,0.5)_100%),linear-gradient(0deg,rgba(4,5,9,0.72)_0%,transparent_38%),linear-gradient(180deg,rgba(4,5,9,0.28)_0%,transparent_22%)]';

/**
 * 游戏舞台：按 z 轴分层渲染背景 → 立绘 → CG → 环境特效 → 暗角 → 点击层 → 对话框 → 选项。
 * 组件不持有引擎状态，只根据快照播放转场并把交互回调给外层。
 */
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
  paused = false,
}: GameStageProps) {
  const background = snapshot.stage.background;
  const cg = snapshot.stage.cg;
  // 立绘以 id 为 key 渲染；位置、透明度、缩放、翻转全部来自快照。
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

      {/* CG 层始终保留 DOM，仅用 opacity 控制显隐，避免切换时重新挂载。 */}
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

      {/* 环境特效位于 CG 之上、暗角之下，避免被压暗或盖住立绘。 */}
      <AmbientLayer effects={snapshot.stage.effects} className="z-[4]" />

      <div className={`pointer-events-none absolute inset-0 z-[5] ${VIGNETTE}`} aria-hidden="true" />

      {/* 透明点击层：点击舞台推进或补全对话；选项层 z-30 位于其上方。 */}
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
          paused={paused}
        />
      )}

      <ChoiceOverlay choice={snapshot.choice} onChoose={onChoose} paused={paused} />
    </div>
  );
}
