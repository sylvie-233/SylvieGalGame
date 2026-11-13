import type { PlayerPlatform } from '@sylvie/types';

/**
 * 平台能力单例。
 * player 包不直接访问 `window.sylvieGame`、`localStorage` 或文件系统，
 * 所有宿主差异都由外壳通过 {@link configurePlayer} 注入。
 */
let platform: PlayerPlatform | null = null;

/**
 * 由 Electron / Web 外壳在渲染启动、挂载 `GameApp` 之前调用，
 * 注入资源读取、存储、截图、全屏等平台能力。重复调用会替换现有实例。
 */
export function configurePlayer(next: PlayerPlatform): void {
  platform = next;
}

/**
 * 取出已注入的平台能力。
 * 必须在渲染 `GameApp` 前调用过 {@link configurePlayer}，否则抛出错误，
 * 以便尽早暴露宿主接入遗漏，而不是在运行中静默失败。
 */
export function getPlayerPlatform(): PlayerPlatform {
  if (!platform) {
    throw new Error('播放器尚未配置平台能力，请先调用 configurePlayer()');
  }
  return platform;
}
