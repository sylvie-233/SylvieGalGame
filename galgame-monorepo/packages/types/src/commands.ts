/**
 * 剧本指令的规范化类型定义。
 *
 * 场景 YAML 由 engine-core 解析后，每条指令都会变成这里的一种带 `kind`
 * 判别字段的普通对象；播放器只消费这些结构，不感知原始 YAML 写法。
 */
import type { VariableValue } from './variables';

/**
 * 画面切换效果。
 * `none` 表示立即切换；其余值对应播放器 CrossfadeImage 中的不同进入动画。
 */
export type Transition = 'fade' | 'dissolve' | 'slide-left' | 'slide-right' | 'wipe' | 'none';

/** 转场缓动曲线，语义与 motion 的 ease 一致。 */
export type TransitionEase = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

/** 立绘水平位置：预设关键字，或 0-100 的百分比坐标。 */
export type SpritePosition = 'left' | 'center' | 'right' | number;

/** 切换背景；`image: null` 表示回到纯黑背景。 */
export interface BgCommand {
  kind: 'bg';
  /** null 表示回到纯黑背景。 */
  image: string | null;
  transition: Transition;
  ease: TransitionEase;
  duration: number;
}

/**
 * 显示 / 更新 / 隐藏一张立绘。
 * 以 `id` 区分槽位，同一 id 的后续指令会替换旧状态；隐藏时保留旧素材以便淡出。
 */
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

/** 全屏 CG 图层；隐藏时保留 image，供播放器做淡出。 */
export interface CgCommand {
  kind: 'cg';
  image: string | null;
  visible: boolean;
  transition: Transition;
  ease: TransitionEase;
  duration: number;
}

/** 阻塞式对话行：引擎在此暂停，直到播放器调用 `advance()`。 */
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

/** BGM 控制；`track: null` 表示淡出并停止。 */
export interface BgmCommand {
  kind: 'bgm';
  /** null 表示停止 BGM。 */
  track: string | null;
  fade: number;
  loop: boolean;
}

/** 一次性音效，不阻塞剧情。 */
export interface SeCommand {
  kind: 'se';
  sound: string;
  volume: number;
}

/** 独立播放一句角色语音；text 指令的 voice 字段也会产生同类 effect。 */
export interface VoiceCommand {
  kind: 'voice';
  sound: string;
}

/** 场景内跳转锚点；推进时只记录为当前章节名，不阻塞。 */
export interface LabelCommand {
  kind: 'label';
  name: string;
}

/** 立即跳转；目标解析失败时调用方会跳过该指令继续向下执行。 */
export interface JumpCommand {
  kind: 'jump';
  /** 支持 "label" 或 "scene#label"。 */
  target: string;
}

/** 单个分支选项。 */
export interface ChoiceOption {
  text: string;
  /** 支持 "label" 或 "scene#label"。 */
  target: string;
  /** 条件表达式；为 null 时始终可见。 */
  condition: string | null;
  /** 选中后、跳转前依次执行的赋值动作。 */
  actions: SetCommand[];
}

/** 阻塞式选项；没有任何可见选项时引擎会跳过该指令。 */
export interface ChoiceCommand {
  kind: 'choice';
  prompt: string | null;
  options: ChoiceOption[];
}

/** 变量赋值；`value` 与 `expr` 恰好提供一个，`expr` 优先。 */
export interface SetCommand {
  kind: 'set';
  variable: string;
  op: '=' | '+=' | '-=';
  /** 字面量赋值。与 expr 二选一。 */
  value: VariableValue | null;
  /** 表达式赋值，复用条件表达式解析器。 */
  expr: string | null;
}

/** 条件分支：condition 为真跳到 then，否则跳到 else。 */
export interface IfCommand {
  kind: 'if';
  condition: string;
  then: string;
  /** 为 null 时条件不成立就继续执行下一条指令。 */
  else: string | null;
}

/** 阻塞式等待；计时结束后由播放器调用 `resumeWait()`。 */
export interface WaitCommand {
  kind: 'wait';
  /** 毫秒。 */
  duration: number;
}

/** 触发结局：按 id 在 manifest.endings 中查找，随后进入 ended 阶段。 */
export interface EndingCommand {
  kind: 'ending';
  /** manifest.endings 中登记的结局 id。 */
  id: string;
}

/** 屏幕震动效果，不阻塞剧情。 */
export interface ShakeCommand {
  kind: 'shake';
  /** 最大偏移像素。 */
  intensity: number;
  duration: number;
}

/** 全屏闪白 / 闪黑，不阻塞剧情。 */
export interface FlashCommand {
  kind: 'flash';
  color: 'white' | 'black';
  opacity: number;
  duration: number;
}

/** 所有剧本指令的联合类型，通过 `kind` 字段判别具体成员。 */
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

/** 全部指令名的有序清单，可用于校验或派生字面量类型。 */
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

/** 指令名的字面量联合类型。 */
export type CommandKind = (typeof COMMAND_KINDS)[number];
