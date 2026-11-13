import type { Command } from './commands';
import type { VariableValue } from './variables';

export interface EndingDefinition {
  id: string;
  title: string;
  description: string;
}

export interface TitleConfig {
  /** 标题背景图路径；为空时使用播放器默认背景。 */
  background: string | null;
  /** 标题页 BGM；为空则不播放。 */
  bgm: string | null;
  subtitle: string;
  showVersion: boolean;
}

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
}

export interface LabelLocation {
  block: string;
  index: number;
}

export interface CompiledBlock {
  id: string;
  commands: Command[];
}

export interface CompiledScene {
  name: string;
  entryBlock: string;
  blocks: Record<string, CompiledBlock>;
  labels: Record<string, LabelLocation>;
  /** 该场景（含 import 闭包）引用到的资源路径。 */
  assets: string[];
}
