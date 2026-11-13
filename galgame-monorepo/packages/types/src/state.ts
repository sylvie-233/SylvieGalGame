import type { SpritePosition, Transition, TransitionEase } from './commands';
import type { EndingDefinition } from './script';
import type { VariableTable } from './variables';

/**
 * 引擎对外暴露的运行阶段。
 * `idle` 只出现在启动前或推进指令的瞬间；阻塞态为 text / choice / wait，结局为 ended。
 */
export type Phase = 'idle' | 'text' | 'choice' | 'wait' | 'ended';

/** 背景图层当前状态。 */
export interface BackgroundState {
  image: string | null;
  transition: Transition;
  ease?: TransitionEase;
  duration: number;
  /** UI 用：同一张图重复切换时也能触发动画。 */
  revision: number;
}

/** 单个立绘槽位的状态；以 id 为键存放在 StageSnapshot.sprites 中。 */
export interface SpriteState {
  id: string;
  image: string | null;
  position: SpritePosition;
  opacity: number;
  /** 旧存档可能没有该字段，渲染时按 1 处理。 */
  scale?: number;
  /** 旧存档可能没有该字段，渲染时按 0 处理。 */
  z?: number;
  flip?: boolean;
  transition: Transition;
  ease?: TransitionEase;
  duration: number;
  revision: number;
}

/** 全屏 CG 图层状态。 */
export interface CgState {
  image: string | null;
  visible: boolean;
  transition: Transition;
  ease?: TransitionEase;
  duration: number;
  revision: number;
}

/** 舞台所有图层的一次性快照。 */
export interface StageSnapshot {
  background: BackgroundState;
  sprites: Record<string, SpriteState>;
  cg: CgState;
}

/** 当前阻塞中的对话行（text 已完成变量插值）。 */
export interface DialogueSnapshot {
  id: string;
  speaker: string | null;
  text: string;
  voice: string | null;
}

/** 传给 UI 的选项视图；optionIndex 对应原始指令中的下标。 */
export interface ChoiceOptionView {
  /** 原始选项下标，用于回传给引擎。 */
  optionIndex: number;
  text: string;
}

/** 当前阻塞中的选项面板。 */
export interface ChoiceSnapshot {
  prompt: string | null;
  options: ChoiceOptionView[];
}

/** 引擎侧记录的音频状态；播放位置等细节由播放器自行管理。 */
export interface AudioSnapshot {
  bgm: string | null;
}

/** Backlog 中的一行历史对话。 */
export interface BacklogEntry {
  id: string;
  speaker: string | null;
  text: string;
  voice: string | null;
  at: number;
}

/** 指令指针：场景名 + 块名 + 指令下标。 */
export interface Pointer {
  /** 当前场景（入口 yaml 名）。 */
  scene: string;
  block: string;
  index: number;
}

/**
 * 一次不可变的状态快照，player 只读消费。
 * 引擎每次 emit() 都会整体重建对象，监听方可按引用判断是否变化。
 */
export interface GameSnapshot {
  phase: Phase;
  pointer: Pointer;
  /** 最近一次 label 名，用于存档备注。 */
  chapter: string;
  /** chapter 在 manifest.chapters 中登记的展示名；未登记时回退到 label 名。 */
  chapterName: string;
  /** 已登记结局时，phase === 'ended' 后为对应结局；否则为 null。 */
  ending: EndingDefinition | null;
  stage: StageSnapshot;
  dialogue: DialogueSnapshot | null;
  choice: ChoiceSnapshot | null;
  audio: AudioSnapshot;
  variables: VariableTable;
  backlog: BacklogEntry[];
  /** phase === 'wait' 时的等待毫秒数。 */
  waitMs: number;
}

/**
 * 瞬时副作用事件。
 * 与快照不同，事件不保存历史，只广播一次，用于触发音频、动画与预加载。
 */
export type EngineEffect =
  /** 切换场景，附带该场景（含 import 闭包）的资源清单供预加载。 */
  | { type: 'scene'; scene: string; assets: string[] }
  /** 播放 / 停止 BGM；position 仅在读档恢复时提供（秒）。 */
  | { type: 'bgm'; track: string | null; fade: number; loop: boolean; position?: number }
  /** 播放一次性音效。 */
  | { type: 'se'; sound: string; volume: number }
  /** 播放角色语音。 */
  | { type: 'voice'; sound: string }
  /** 到达新的对话 / 选项，播放器可据此自动存档。 */
  | { type: 'checkpoint'; block: 'text' | 'choice'; chapter: string }
  /** 屏幕震动。 */
  | { type: 'shake'; intensity: number; duration: number }
  /** 全屏闪白 / 闪黑。 */
  | { type: 'flash'; color: 'white' | 'black'; opacity: number; duration: number }
  /** 剧情结束（正常结局或异常终止）。 */
  | { type: 'ended' };
