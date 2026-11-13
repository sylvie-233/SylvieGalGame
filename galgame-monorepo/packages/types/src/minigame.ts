/**
 * 剧情小游戏的共享契约。
 *
 * 引擎只负责在 `minigame` 指令处阻塞，并在小游戏结束时按剧本映射把结果写回变量；
 * 具体玩法的渲染与输入由宿主注入的 {@link MinigameLoader} 提供。
 * 这样 `engine-core` 与 React 播放器都不需要认识 Phaser，也不绑定任何具体小游戏。
 */
import type { VariableValue } from './variables';

/**
 * 小游戏返回的原始结果。
 * 键名由具体小游戏约定，剧本通过 `minigame.result` 把它映射到变量。
 */
export type MinigameResult = Record<string, VariableValue>;

/**
 * 阻塞式剧情小游戏指令。
 *
 * ```yaml
 * - minigame:
 *     id: echo
 *     title: 回声
 *     prompt: 把她刚才弹过的八个音，按原样还回去。
 *     params: { notes: 8 }
 *     result: { echoes: echo_echoes, cleared: echo_cleared }
 *     skip: { echoes: 0, cleared: false }
 * ```
 */
export interface MinigameCommand {
  kind: 'minigame';
  /** 宿主注册的小游戏 id；找不到对应 loader 时播放器会显示跳过入口。 */
  id: string;
  /** 覆盖层标题；省略时使用 id。 */
  title: string;
  /** 带在覆盖层顶部的提示，支持 `{变量}` 插值；省略时为 null。 */
  prompt: string | null;
  /** 原样传给具体小游戏的参数，结构由小游戏自定义。 */
  params: Record<string, unknown>;
  /** 小游戏结果键 → 剧本变量名。未列出的结果键会被忽略。 */
  result: Record<string, string>;
  /** 玩家跳过或 loader 不可用时使用的原始结果，按同一套 result 映射写回。 */
  skip: MinigameResult;
}

/** 播放器 / 小游戏实现消费的只读快照；不包含结果映射等剧本细节。 */
export interface MinigameState {
  id: string;
  title: string;
  prompt: string | null;
  params: Record<string, unknown>;
}

/** 小游戏实例；播放器卸载覆盖层时必须调用 destroy 释放 Phaser 等资源。 */
export interface MinigameInstance {
  destroy(): void;
}

/**
 * 小游戏启动上下文。
 *
 * `finish` 只应调用一次：播放器会先移除覆盖层再推进引擎，重复调用会被忽略。
 * 传入 `{}` 或省略结果表示正常结束但没有结果，剧本中的 skip 值不会生效。
 */
export interface MinigameContext {
  id: string;
  title: string;
  prompt: string | null;
  params: Record<string, unknown>;
  /** 把游戏内资源相对路径转换成宿主可访问 URL；本包默认的小游戏不加载外部资源。 */
  assetUrl(path: string): string;
  finish(result?: MinigameResult): void;
}

/**
 * 宿主注册的小游戏加载器。
 * 容器尺寸由播放器控制；实现应监听容器 / Phaser Scale 的 resize 自行重排。
 */
export type MinigameLoader = (
  container: HTMLElement,
  context: MinigameContext,
) => Promise<MinigameInstance>;

/** 宿主按 id 注册的 loader 集合。 */
export type MinigameLoaderRegistry = Record<string, MinigameLoader>;
