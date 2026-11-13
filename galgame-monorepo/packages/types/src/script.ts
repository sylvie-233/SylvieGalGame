import type { Command } from './commands';
import type { VariableValue } from './variables';

export interface GameManifest {
  title: string;
  version: string;
  /** 新游戏入口场景名。 */
  start: string;
  /** 可启动 / 可跳转的场景文件列表（对应 scripts/scenes/<name>.yaml）。 */
  scenes: string[];
  /** 新游戏初始变量。 */
  variables: Record<string, VariableValue>;
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
