import { configurePlayer, ErrorBoundary, GameApp } from '@sylvie/player';
import { createRoot } from 'react-dom/client';

import './index.css';
import { webPlatform } from './platform';

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

function boot(): void {
  const container = document.getElementById('root');
  if (!container) {
    renderFatal('页面缺少 #root 容器。');
    return;
  }

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
