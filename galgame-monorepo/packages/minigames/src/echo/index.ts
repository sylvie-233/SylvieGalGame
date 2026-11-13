/**
 * 将《回声》挂载到播放器提供的主机容器里。
 *
 * 返回的实例只实现 `destroy()`，由播放器覆盖层在卸载时调用。
 * Phaser 的 `Game` 负责创建 / 销毁 canvas，容器本身由 React 管理。
 */
import type { MinigameContext, MinigameInstance } from '@sylvie/types';
import Phaser from 'phaser';

import { EchoScene } from './EchoScene';

/** 初始化超时：正常情况下 boot 不到 1 秒；超时后让播放器走「加载失败 + 跳过」路径。 */
const BOOT_TIMEOUT_MS = 15000;

export function mountEchoMinigame(
  container: HTMLElement,
  context: MinigameContext,
): Promise<MinigameInstance> {
  return new Promise<MinigameInstance>((resolve, reject) => {
    let game: Phaser.Game;
    try {
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: container,
        transparent: true,
        banner: false,
        // 小游戏只用 WebAudio 合成音，不需要 Phaser 的音频管理器。
        audio: { noAudio: true },
        scale: {
          mode: Phaser.Scale.RESIZE,
          autoCenter: Phaser.Scale.CENTER_BOTH,
          width: container.clientWidth || 720,
          height: container.clientHeight || 480,
        },
        callbacks: {
          // Phaser 完成 boot 后场景系统才可用；在这里带着剧本上下文启动场景。
          postBoot: (booted) => {
            booted.scene.add('echo', EchoScene, true, context);
          },
        },
      });
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      game.events.off(Phaser.Core.Events.READY, onReady);
      try {
        game.destroy(true);
      } catch (error) {
        console.warn('[小游戏] 初始化超时后销毁 Phaser 实例失败', error);
      }
      reject(new Error('小游戏初始化超时'));
    }, BOOT_TIMEOUT_MS);

    const onReady = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve({
        destroy: (): void => {
          try {
            game.destroy(true);
          } catch (error) {
            console.warn('[小游戏] 销毁 Phaser 实例失败', error);
          }
        },
      });
    };

    if (game.isBooted) onReady();
    else game.events.once(Phaser.Core.Events.READY, onReady);
  });
}
