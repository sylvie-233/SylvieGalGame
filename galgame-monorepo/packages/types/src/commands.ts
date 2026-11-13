import type { VariableValue } from './variables';

export type Transition = 'fade' | 'dissolve' | 'slide-left' | 'slide-right' | 'wipe' | 'none';

export type TransitionEase = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

export type SpritePosition = 'left' | 'center' | 'right' | number;

export interface BgCommand {
  kind: 'bg';
  /** null 表示回到纯黑背景。 */
  image: string | null;
  transition: Transition;
  ease: TransitionEase;
  duration: number;
}

export interface SpriteCommand {
  kind: 'sprite';
  id: string;
  /** null 表示隐藏；保留上一次素材以便淡出。 */
  image: string | null;
  position: SpritePosition;
  opacity: number;
  /** 缩放倍率，1 为原始大小。 */
  scale: number;
  /** 层级，数值越大越靠前。 */
  z: number;
  /** 水平翻转。 */
  flip: boolean;
  transition: Transition;
  ease: TransitionEase;
  duration: number;
}

export interface CgCommand {
  kind: 'cg';
  image: string | null;
  visible: boolean;
  transition: Transition;
  ease: TransitionEase;
  duration: number;
}

export interface TextCommand {
  kind: 'text';
  /**
   * 已读标记 id。
   * 作者显式指定时原样使用，否则由 block + 文本内容哈希生成，插入/删除无关台词不会错位。
   */
  id: string;
  speaker: string | null;
  text: string;
  voice: string | null;
}

export interface BgmCommand {
  kind: 'bgm';
  /** null 表示停止 BGM。 */
  track: string | null;
  fade: number;
  loop: boolean;
}

export interface SeCommand {
  kind: 'se';
  sound: string;
  volume: number;
}

export interface VoiceCommand {
  kind: 'voice';
  sound: string;
}

export interface LabelCommand {
  kind: 'label';
  name: string;
}

export interface JumpCommand {
  kind: 'jump';
  /** 支持 "label" 或 "scene#label"。 */
  target: string;
}

export interface ChoiceOption {
  text: string;
  /** 支持 "label" 或 "scene#label"。 */
  target: string;
  condition: string | null;
  /** 选中后、跳转前依次执行的赋值动作。 */
  actions: SetCommand[];
}

export interface ChoiceCommand {
  kind: 'choice';
  prompt: string | null;
  options: ChoiceOption[];
}

export interface SetCommand {
  kind: 'set';
  variable: string;
  op: '=' | '+=' | '-=';
  /** 字面量赋值。与 expr 二选一。 */
  value: VariableValue | null;
  /** 表达式赋值，复用条件表达式解析器。 */
  expr: string | null;
}

export interface IfCommand {
  kind: 'if';
  condition: string;
  then: string;
  else: string | null;
}

export interface WaitCommand {
  kind: 'wait';
  /** 毫秒。 */
  duration: number;
}

export interface EndingCommand {
  kind: 'ending';
  /** manifest.endings 中登记的结局 id。 */
  id: string;
}

export interface ShakeCommand {
  kind: 'shake';
  /** 最大偏移像素。 */
  intensity: number;
  duration: number;
}

export interface FlashCommand {
  kind: 'flash';
  color: 'white' | 'black';
  opacity: number;
  duration: number;
}

export type Command =
  | BgCommand
  | SpriteCommand
  | CgCommand
  | TextCommand
  | BgmCommand
  | SeCommand
  | VoiceCommand
  | LabelCommand
  | JumpCommand
  | ChoiceCommand
  | SetCommand
  | IfCommand
  | WaitCommand
  | EndingCommand
  | ShakeCommand
  | FlashCommand;

export const COMMAND_KINDS = [
  'bg',
  'sprite',
  'cg',
  'text',
  'bgm',
  'se',
  'voice',
  'label',
  'jump',
  'choice',
  'set',
  'if',
  'wait',
  'ending',
  'shake',
  'flash',
] as const;

export type CommandKind = (typeof COMMAND_KINDS)[number];
