/**
 * Web 预览壳的 Vite 配置。
 * 关键点：
 * - 共享包别名到源码，开发期改 player / engine-core 立即热更新；
 * - 开发与 preview 都把内容包挂到 /game，构建时复制到 dist/game；
 * - 内容中间件支持 HEAD 与单段 Range，音频可流式播放；
 * - 用 Rolldown 的 codeSplitting.groups 拆分 React / Motion / Howler / Zustand。
 */
import { createReadStream } from 'node:fs';
import { access, cp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Connect, type Plugin } from 'vite';

// apps/web/ 的上一级是 galgame-monorepo；内容包与共享包都相对它定位。
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(HERE, '../..');
const GAME_ROOT = path.join(WORKSPACE_ROOT, 'packages/game-content/game');

// 与 Electron 的 MIME 表保持一致，避免浏览器把 YAML / 音频按错误类型处理。
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

/** 解析到 root 内并拒绝目录穿越；NUL 字节与越界路径返回 null。 */
function resolveInside(root: string, relativePath: string): string | null {
  if (!relativePath || relativePath.includes('\0')) return null;
  const cleaned = relativePath.replace(/^[/\\]+/, '');
  const resolved = path.resolve(root, cleaned);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

/**
 * 解析单段 Range（`bytes=start-end`，允许省略 end）。
 * 不合法或越界时返回 null，由调用方回 200 全量；只实现单段，足够音频拖动播放。
 */
function parseRange(
  range: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!range) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;

  // `bytes=-N` 表示最后 N 个字节，与 `bytes=0-N` 语义不同。
  if (!rawStart && rawEnd) {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = rawStart ? Number(rawStart) : 0;
  const end = rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return null;
  }
  return { start, end };
}

/**
 * 游戏内容中间件 + 构建复制。
 * 开发 / preview 直接读取 packages/game-content/game，构建后复制到 dist/game；
 * Web 只是预览壳，内容仍只有一份来源，不需要额外同步步骤。
 * 请求路径先解码再做目录穿越校验，随后按扩展名补 Content-Type 并处理 HEAD / Range。
 */
function gameContentPlugin(): Plugin {
  const handle: Connect.NextHandleFunction = async (request, response, next) => {
    if (!request.url) {
      next();
      return;
    }

    // 去掉查询串并解码；非法编码直接回 400，避免把异常字符带进文件系统。
    let relative: string;
    try {
      relative = decodeURIComponent(request.url.split('?')[0] ?? '');
    } catch {
      response.statusCode = 400;
      response.end('Bad request');
      return;
    }

    const filePath = resolveInside(GAME_ROOT, relative);
    if (!filePath) {
      response.statusCode = 404;
      response.end('Not found');
      return;
    }

    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat || !fileStat.isFile()) {
      response.statusCode = 404;
      response.end('Not found');
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    response.setHeader('content-type', MIME_TYPES[extension] ?? 'application/octet-stream');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('accept-ranges', 'bytes');
    response.setHeader('cache-control', 'no-store');

    // HEAD 只返回元信息，供播放器 exists() 探测资源。
    if (request.method === 'HEAD') {
      response.setHeader('content-length', fileStat.size);
      response.statusCode = 200;
      response.end();
      return;
    }

    // 单段 Range 返回 206，浏览器音频元素可据此跳到未缓冲位置。
    const range = parseRange(request.headers.range, fileStat.size);
    if (range) {
      response.statusCode = 206;
      response.setHeader('content-range', `bytes ${range.start}-${range.end}/${fileStat.size}`);
      response.setHeader('content-length', range.end - range.start + 1);
      createReadStream(filePath, range).pipe(response);
      return;
    }

    response.setHeader('content-length', fileStat.size);
    response.statusCode = 200;
    createReadStream(filePath).pipe(response);
  };

  // 构建输出目录在配置解析后才确定，closeBundle 用它定位复制目标。
  let outDir = '';

  return {
    name: 'sylvie-game-content',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    // dev 与 preview 挂同一个中间件，url 前缀固定为 /game。
    configureServer(server) {
      server.middlewares.use('/game', handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/game', handle);
    },
    // 构建完成后把内容复制到 dist/game；先清空目标，避免下架资源残留。
    async closeBundle() {
      if (!outDir) return;
      const target = path.join(outDir, 'game');
      await rm(target, { recursive: true, force: true });
      await access(GAME_ROOT).then(
        () => cp(GAME_ROOT, target, { recursive: true }),
        () => undefined,
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), gameContentPlugin()],
  resolve: {
    // 预览壳直接跑共享包源码，改 UI 无需先构建 player / engine-core；
    // exact 形式的正则避免把 `@sylvie/player/xxx` 子路径误匹配成入口。
    alias: [
      {
        find: '@sylvie/player/styles.css',
        replacement: path.join(WORKSPACE_ROOT, 'packages/player/src/styles.css'),
      },
      {
        find: /^@sylvie\/player$/,
        replacement: path.join(WORKSPACE_ROOT, 'packages/player/src/index.ts'),
      },
      {
        find: /^@sylvie\/engine-core$/,
        replacement: path.join(WORKSPACE_ROOT, 'packages/engine-core/src/index.ts'),
      },
      {
        find: /^@sylvie\/types$/,
        replacement: path.join(WORKSPACE_ROOT, 'packages/types/src/index.ts'),
      },
    ],
    // 源码别名会从 workspace 根解析 React，去重避免出现两份 React 导致 hooks 报错。
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
  },
  server: {
    // 与 Electron dev server（5174）错开；strictPort 让端口占用时直接报错而不是静默换端口。
    port: 5175,
    strictPort: true,
    // 别名指向 workspace 根，需要放开 Vite 默认只允许项目根访问的限制。
    fs: { allow: [WORKSPACE_ROOT] },
  },
  preview: {
    port: 5175,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Rolldown 分包：把体积大、更新频率低的依赖拆成独立 chunk，利于浏览器长期缓存。
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            },
            {
              name: 'motion',
              test: /node_modules[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/,
            },
            {
              name: 'audio',
              test: /node_modules[\\/]howler[\\/]/,
            },
            {
              name: 'zustand',
              test: /node_modules[\\/]zustand[\\/]/,
            },
          ],
        },
      },
    },
  },
});
