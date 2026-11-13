/**
 * `@sylvie/minigames` 的公开入口。
 *
 * 宿主只拿到一个 `id -> loader` 注册表，播放器按剧本里的 `minigame.id` 查找。
 * 具体游戏在 loader 被调用时才动态 import，因此没触发小游戏的玩家不会下载 Phaser。
 *
 * 新增小游戏：在 `src/<id>/` 实现 `mountXxxMinigame()`，再在下面的注册表中登记。
 */
import type { MinigameLoader, MinigameLoaderRegistry } from '@sylvie/types';

const echo: MinigameLoader = async (container, context) => {
  const { mountEchoMinigame } = await import('./echo/index.js');
  return mountEchoMinigame(container, context);
};

/**
 * 创建默认注册表。
 * `overrides` 可覆盖或追加 loader，便于宿主接入自行实现的小游戏，也便于测试替身。
 */
export function createMinigameLoaders(
  overrides: Partial<MinigameLoaderRegistry> = {},
): MinigameLoaderRegistry {
  return { echo, ...overrides };
}
