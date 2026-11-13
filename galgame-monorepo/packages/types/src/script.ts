import type { Command } from './commands';
import type { AmbientEffect } from './effects';
import type { GalleryConfig } from './gallery';
import type { VariableValue } from './variables';

/** 结局定义；`ending` 指令按 id 引用，图鉴与结局页也用它展示。 */
export interface EndingDefinition {
  id: string;
  title: string;
  description: string;
}

/** 标题页展示配置。 */
export interface TitleConfig {
  /** 标题背景图路径；为空时使用播放器默认背景。 */
  background: string | null;
  /** 标题页 BGM；为空则不播放。 */
  bgm: string | null;
  subtitle: string;
  showVersion: boolean;
  /** 标题页持续显示的环境特效；为空数组表示没有。 */
  effects: AmbientEffect[];
}

/**
 * game.yaml 的解析结果，整局游戏的静态配置。
 * 运行期只读；variables 会在新游戏 / 读档时复制进引擎状态。
 */
export interface GameManifest {
  title: string;
  /** 窗口 / 浏览器标签标题；为空时使用 title。 */
  windowTitle: string;
  version: string;
  /** 新游戏入口场景名。 */
  start: string;
  /** 可启动 / 可跳转的场景文件列表（对应 scripts/scenes/<name>.yaml）。 */
  scenes: string[];
  /** 新游戏初始变量。 */
  variables: Record<string, VariableValue>;
  /** label → 存档面板与结局页展示的章节名。 */
  chapters: Record<string, string>;
  /** 结局注册表，由 `ending` 指令按 id 引用。 */
  endings: EndingDefinition[];
  /** 标题页展示配置。 */
  titleScreen: TitleConfig;
  /** 图鉴资源表；解锁状态单独存 meta:gallery。 */
  gallery: GalleryConfig;
}

/** label 在编译后场景中的位置。 */
export interface LabelLocation {
  block: string;
  index: number;
}

/** 编译后的单个块（一个场景 YAML 文件对应一个块）。 */
export interface CompiledBlock {
  id: string;
  commands: Command[];
}

/**
 * 编译后的可运行场景。
 * blocks 包含自身与 import 闭包中的所有块；labels 汇总闭包内的全部 label。
 */
export interface CompiledScene {
  name: string;
  entryBlock: string;
  blocks: Record<string, CompiledBlock>;
  labels: Record<string, LabelLocation>;
  /** 该场景（含 import 闭包）引用到的资源路径。 */
  assets: string[];
}
