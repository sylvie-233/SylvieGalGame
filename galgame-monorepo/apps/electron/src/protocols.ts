/**
 * 自定义协议与游戏资源定位。
 *
 * app://sylvie 承载渲染产物（响应带 CSP），game://assets 只读地暴露游戏内容目录；
 * 所有文件访问都经过 resolveInside 做目录穿越防护。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { app, protocol } from 'electron';

// 自定义协议：app://sylvie 承载渲染产物，game://assets 只读暴露游戏内容。
export const APP_SCHEME = 'app';
export const APP_HOST = 'sylvie';
export const APP_ENTRY_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;
const GAME_SCHEME = 'game';
const GAME_HOST = 'assets';

/**
 * 必须在 app ready 之前注册。
 * standard + secure 让协议拥有正常的 origin 语义（相对路径解析、fetch、存储隔离）；
 * supportFetchAPI / corsEnabled 允许渲染进程 fetch 资源；stream 允许协议返回流式 Response
 *（当前 handler 仍是整块读取文件后返回）。
 */
export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
    {
      scheme: GAME_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

// 自定义协议不像 HTTP 静态服务器那样有内置映射，需要显式给出扩展名 → Content-Type。
const MIME_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
};

/**
 * 渲染进程 CSP：只允许本地脚本；样式允许内联（Tailwind / 动效会写 style 属性）；
 * 图片、音频与 fetch 额外允许 game: 协议；禁止 object / frame 与外部来源。
 */
function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' game: data: blob:",
    "media-src 'self' game: data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' game:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-src 'none'",
  ].join('; ');
}

function mimeType(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * 游戏内容根目录。
 * 优先级：SYLVIE_GAME_ROOT 环境变量（冒烟 / 本地调试）> 打包后的 resources/game >
 * 开发期直接读取 packages/game-content/game。
 */
export function gameRoot(): string {
  if (process.env.SYLVIE_GAME_ROOT) {
    return path.resolve(process.env.SYLVIE_GAME_ROOT);
  }
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'game');
  }
  // 开发期直接读取内容包，内容可独立替换。
  return path.resolve(__dirname, '../../../../packages/game-content/game');
}

/**
 * 把相对路径解析到 root 内，并拒绝目录穿越。
 * 处理 `../`、绝对路径前缀、Windows 盘符与 NUL 字节；解析结果必须仍是 root 本身或 root 的子路径，
 * 否则返回 null，由调用方回 404。
 */
export function resolveInside(root: string, relativePath: string): string | null {
  if (typeof relativePath !== 'string' || relativePath.length === 0) return null;
  if (relativePath.includes('\0')) return null;
  const cleaned = relativePath.replace(/^[/\\]+/, '');
  const resolved = path.resolve(root, cleaned);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

/** 读取文件并构造 Response；文件缺失或不可读统一回 404，避免泄露具体错误。 */
async function fileResponse(filePath: string, extraHeaders: Record<string, string> = {}) {
  try {
    const data = await readFile(filePath);
    return new Response(data, {
      headers: {
        'content-type': mimeType(filePath),
        'x-content-type-options': 'nosniff',
        ...extraHeaders,
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

/**
 * 注册 app:// 协议。
 * `/` 映射到 index.html，其余路径按渲染产物内的相对路径解析；
 * 渲染产物由 Forge Vite 插件输出到 ../renderer/<MAIN_WINDOW_VITE_NAME>。
 * 所有响应都附带 CSP。
 */
export function registerAppProtocol(): void {
  const rendererRoot = path.resolve(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);

  protocol.handle(APP_SCHEME, async (request) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return new Response('Bad request', { status: 400 });
    }

    const relative =
      pathname === '/' || pathname === '' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = resolveInside(rendererRoot, relative);
    if (!filePath) return new Response('Not found', { status: 404 });

    return fileResponse(filePath, {
      'content-security-policy': contentSecurityPolicy(),
    });
  });
}

/**
 * 注册 game://assets 协议，只读地暴露游戏内容目录。
 * host 必须是 assets；路径同样经过 resolveInside；内容可独立替换，因此禁用缓存。
 */
export function registerGameProtocol(): void {
  const root = path.resolve(gameRoot());

  protocol.handle(GAME_SCHEME, async (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    if (url.host !== GAME_HOST) return new Response('Not found', { status: 404 });

    let relative: string;
    try {
      relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    } catch {
      return new Response('Bad request', { status: 400 });
    }

    const filePath = resolveInside(root, relative);
    if (!filePath) return new Response('Not found', { status: 404 });

    return fileResponse(filePath, { 'cache-control': 'no-store' });
  });
}
