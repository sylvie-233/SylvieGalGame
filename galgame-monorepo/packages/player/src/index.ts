/**
 * player 包公开入口。
 * 外壳（Electron / Web）只从这里引入 GameApp、ErrorBoundary 与平台注入函数，
 * 其余组件与工具均为内部实现。
 */
export { AudioManager, type AudioVolumes } from './audio';
export { ErrorBoundary } from './components/ErrorBoundary';
export { GameApp } from './components/GameApp';
export { configurePlayer, getPlayerPlatform } from './player-config';

export type { DialogueHandle } from './components/DialogueBox';
