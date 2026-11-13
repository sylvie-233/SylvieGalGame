/**
 * 《回声》小游戏的纯数据部分。
 *
 * 剧情里希尔维只弹了八个音，玩家要做的是按原顺序把这八个音还回去。
 * 这里不依赖 Phaser / DOM，便于单元测试与后续调参。
 */

/** 四个琴键：按下 1-4 或点击对应琴键。 */
export interface EchoKey {
  /** 界面上的数字键位。 */
  readonly label: string;
  /** 简谱唱名，作为琴键下方的小字。 */
  readonly solfege: string;
  /** 合成音高（Hz）。 */
  readonly frequency: number;
}

/** 低到高排列；音色由 EchoScene 的 WebAudio 合成器负责。 */
export const ECHO_KEYS: readonly EchoKey[] = [
  { label: '1', solfege: 'do', frequency: 261.63 },
  { label: '2', solfege: 'mi', frequency: 329.63 },
  { label: '3', solfege: 'sol', frequency: 392.0 },
  { label: '4', solfege: '高 do', frequency: 523.25 },
];

/**
 * 希尔维弹奏的八个音。
 * 结尾落在第二键上，留下没有说完的余韵，正好对应剧情里「第九小节停住」。
 */
export const ECHO_PHRASE: readonly number[] = [0, 2, 1, 3, 1, 2, 0, 1];

/** 满分音符数。 */
export const ECHO_MAX_SCORE = ECHO_PHRASE.length;

/** 判断某个下标是否是有效琴键。 */
export function isEchoKey(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < ECHO_KEYS.length;
}

/**
 * 统计一次就按对的音符数。
 * `clean[index]` 表示第 index 个音在第一次尝试时就是正确的；中途按错过的音不计分。
 */
export function countCleanNotes(clean: readonly boolean[]): number {
  return clean.reduce((total, value) => (value ? total + 1 : total), 0);
}
