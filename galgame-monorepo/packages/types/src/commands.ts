import type { VariableValue } from './variables';

export type Transition = 'fade' | 'none';

export type SpritePosition = 'left' | 'center' | 'right' | number;

export interface BgCommand {
  kind: 'bg';
  /** null 表示回到纯黑背景。 */
  image: string | null;
  transition: Transition;
  duration: number;
}

export interface SpriteCommand {
  kind: 'sprite';
  id: string;
  /** null 表示隐藏；保留上一次素材以便淡出。 */
  image: string | null;
  position: SpritePosition;
  opacity: number;
  transition: Transition;
  duration: number;
}

export interface CgCommand {
  kind: 'cg';
  image: string | null;
  visible: boolean;
  transition: Transition;
  duration: number;
}

export interface TextCommand {
  kind: 'text';
  /** 全局稳定的文本 id（block#index），用于已读标记。 */
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
  value: VariableValue;
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
  | WaitCommand;

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
] as const;

export type CommandKind = (typeof COMMAND_KINDS)[number];
