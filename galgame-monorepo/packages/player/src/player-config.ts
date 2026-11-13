import type { PlayerPlatform } from '@sylvie/types';

let platform: PlayerPlatform | null = null;

/** 由 Electron / Web 外壳在渲染启动时注入平台能力。 */
export function configurePlayer(next: PlayerPlatform): void {
  platform = next;
}

export function getPlayerPlatform(): PlayerPlatform {
  if (!platform) {
    throw new Error('播放器尚未配置平台能力，请先调用 configurePlayer()');
  }
  return platform;
}
