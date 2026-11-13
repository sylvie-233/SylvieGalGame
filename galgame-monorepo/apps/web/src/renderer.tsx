/**
 * Web 预览壳入口：注入 webPlatform 并挂载播放器。
 * 共享包在开发 / 构建时都直接走源码别名，因此与桌面端运行的是同一套 UI。
 */
import { configurePlayer, ErrorBoundary, GameApp } from '@sylvie/player';
import { createRoot } from 'react-dom/client';

import './index.css';
import { webPlatform } from './platform';

/** React 挂载前失败时的纯 DOM 兜底错误页。 */
function renderFatal(message: string): void {
  const container = document.getElementById('root');
  if (!container) return;
  container.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.style.cssText =
    'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:8vw;text-align:center;background:radial-gradient(circle at center,#16101a,#05060a 70%);color:#f3eee8;font-family:sans-serif;';
  const title = document.createElement('h1');
  title.textContent = 'Web 预览启动失败';
  title.style.cssText = 'margin:0;font-size:28px;letter-spacing:0.16em;color:#e69ab4;';
  const detail = document.createElement('p');
  detail.textContent = message;
  detail.style.cssText = 'margin:0;max-width:640px;font-size:14px;line-height:1.8;color:#aaa2a2;';
  wrapper.append(title, detail);
  container.append(wrapper);
}

/** 配置平台能力后挂载 GameApp；ErrorBoundary 兜住渲染异常。 */
function boot(): void {
  const container = document.getElementById('root');
  if (!container) {
    renderFatal('页面缺少 #root 容器。');
    return;
  }

  // 必须先注入平台能力再渲染 GameApp，播放器挂载时会立即读取存储与资源。
  configurePlayer(webPlatform);
  createRoot(container).render(
    <ErrorBoundary>
      <GameApp />
    </ErrorBoundary>,
  );
}

try {
  boot();
} catch (error: unknown) {
  console.error('[Web 预览] 启动失败', error);
  renderFatal(error instanceof Error ? error.message : String(error));
}
