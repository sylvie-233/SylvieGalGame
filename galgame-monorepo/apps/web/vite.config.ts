import { createReadStream } from 'node:fs';
import { access, cp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Connect, type Plugin } from 'vite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(HERE, '../..');
const GAME_ROOT = path.join(WORKSPACE_ROOT, 'packages/game-content/game');

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

function resolveInside(root: string, relativePath: string): string | null {
  if (!relativePath || relativePath.includes('\0')) return null;
  const cleaned = relativePath.replace(/^[/\\]+/, '');
  const resolved = path.resolve(root, cleaned);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

function parseRange(
  range: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!range) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  const start = rawStart ? Number(rawStart) : 0;
  const end = rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return null;
  }
  return { start, end };
}

/**
 * 开发期直接读取 packages/game-content/game，构建时复制到 dist/game。
 * Web 只是预览壳，内容仍只有一份来源，不需要额外同步步骤。
 */
function gameContentPlugin(): Plugin {
  const handle: Connect.NextHandleFunction = async (request, response, next) => {
    if (!request.url) {
      next();
      return;
    }

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

    if (request.method === 'HEAD') {
      response.setHeader('content-length', fileStat.size);
      response.statusCode = 200;
      response.end();
      return;
    }

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

  let outDir = '';

  return {
    name: 'sylvie-game-content',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use('/game', handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/game', handle);
    },
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
    // 预览壳直接跑共享包源码，改 UI 无需先构建 player / engine-core。
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
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
  },
  server: {
    port: 5175,
    strictPort: true,
    fs: { allow: [WORKSPACE_ROOT] },
  },
  preview: {
    port: 5175,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
  },
});
