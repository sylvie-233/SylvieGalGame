import type { SpritePosition, Transition } from './commands';
import type { VariableTable } from './variables';

export type Phase = 'idle' | 'text' | 'choice' | 'wait' | 'ended';

export interface BackgroundState {
  image: string | null;
  transition: Transition;
  duration: number;
  /** UI 用：同一张图重复切换时也能触发动画。 */
  revision: number;
}

export interface SpriteState {
  id: string;
  image: string | null;
  position: SpritePosition;
  opacity: number;
  transition: Transition;
  duration: number;
  revision: number;
}

export interface CgState {
  image: string | null;
  visible: boolean;
  transition: Transition;
  duration: number;
  revision: number;
}

export interface StageSnapshot {
  background: BackgroundState;
  sprites: Record<string, SpriteState>;
  cg: CgState;
}

export interface DialogueSnapshot {
  id: string;
  speaker: string | null;
  text: string;
  voice: string | null;
}

export interface ChoiceOptionView {
  /** 原始选项下标，用于回传给引擎。 */
  optionIndex: number;
  text: string;
}

export interface ChoiceSnapshot {
  prompt: string | null;
  options: ChoiceOptionView[];
}

export interface AudioSnapshot {
  bgm: string | null;
}

export interface BacklogEntry {
  id: string;
  speaker: string | null;
  text: string;
  voice: string | null;
  at: number;
}

export interface Pointer {
  /** 当前场景（入口 yaml 名）。 */
  scene: string;
  block: string;
  index: number;
}

export interface GameSnapshot {
  phase: Phase;
  pointer: Pointer;
  /** 最近一次 label 名，用于存档备注。 */
  chapter: string;
  stage: StageSnapshot;
  dialogue: DialogueSnapshot | null;
  choice: ChoiceSnapshot | null;
  audio: AudioSnapshot;
  variables: VariableTable;
  backlog: BacklogEntry[];
  /** phase === 'wait' 时的等待毫秒数。 */
  waitMs: number;
}

export type EngineEffect =
  | { type: 'scene'; scene: string; assets: string[] }
  | { type: 'bgm'; track: string | null; fade: number; loop: boolean }
  | { type: 'se'; sound: string; volume: number }
  | { type: 'voice'; sound: string }
  /** 到达新的对话 / 选项，播放器可据此自动存档。 */
  | { type: 'checkpoint' }
  | { type: 'ended' };
