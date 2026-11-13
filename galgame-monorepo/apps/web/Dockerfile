# syntax=docker/dockerfile:1

# ---------- 构建阶段：安装依赖并构建 Web 及其 workspace 依赖 ----------
FROM node:22-alpine AS build

WORKDIR /app

# 国内 npm 镜像；需要私有源时可用 --build-arg NPM_REGISTRY=... 覆盖
ARG NPM_REGISTRY=https://registry.npmmirror.com

RUN npm config set registry "$NPM_REGISTRY" \
 && npm install -g pnpm@10.32.1 --no-fund --no-audit \
 && pnpm config set registry "$NPM_REGISTRY"

# 只复制 Web 构建所需的 workspace 清单，避免把 Electron 依赖装进镜像。
# Docker 构建期的 workspace 只包含这些目录，pnpm 会按 lockfile 安装对应依赖。
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/engine-core/package.json packages/engine-core/package.json
COPY packages/player/package.json packages/player/package.json
COPY packages/minigames/package.json packages/minigames/package.json
COPY packages/game-content/package.json packages/game-content/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json

RUN pnpm install --frozen-lockfile

COPY . .

# 构建共享包与静态站；vite 的 closeBundle 会把 game-content 复制到 dist/game
RUN pnpm --filter @sylvie/web... build

# ---------- 运行阶段：Nginx 托管静态资源 ----------
FROM nginx:1.27-alpine AS runner

ENV TZ=Asia/Shanghai

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
