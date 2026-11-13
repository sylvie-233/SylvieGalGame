# SylvieGalGame · 午后的回声

> 一个由 YAML 剧本驱动的 Galgame 播放器：纯前端引擎内核 + React 分层舞台 + Electron 桌面外壳。
> 无编辑器、零服务器依赖，剧本与美术资源独立成包，可打包为 Windows 免安装版或 NSIS 安装包；
> 另带一个 Web 预览壳，方便在浏览器里用 HMR 和 DevTools 调试同一套界面与剧本。

![标题页](docs/screenshots/title.png)

## 简介

项目实现了一期完整的视觉小说游玩闭环：标题页 → 序章 → 分支选择 → 变量驱动的剧情收敛 → 结局。业务逻辑集中在纯 TypeScript 的 `engine-core`，UI 与桌面能力分别位于 `player` 和 `electron`，剧情与素材则完全剥离到 `game-content`，改剧情不需要改代码。

二期 M1 已补齐体验闭环：文本回滚、`{变量}` 插值、存档版本迁移、应用内确认框、自动存档减负、脚本警告面板与渲染错误边界。M2 继续完成稳定已读 id、`set` 表达式、选项内赋值动作、选项键盘操作、自动存档轮换与章节 / 结局元数据。

示例剧本《午后的回声》包含：

- 4 个场景、2 条分支、2 次选择、2 个结局；
- 背景 / 立绘 / CG 分层舞台与淡入淡出；
- BGM、音效、角色语音与对话历史回放；
- 打字机、Auto、仅跳过已读的 Skip、Backlog；
- 自动存档保留最近 3 份轮换，快速存档、20 个手动存档位与截图缩略图；
- 设置面板：三类音量、打字速度、自动等待、字体、全屏。

## 功能特性

- **纯 YAML 驱动**：`label` / `jump` / `choice` / `set` / `if` / `wait` 等指令，跨场景跳转与条件显隐，启动时校验结构、目标与资源。
- **业务逻辑抽离**：`engine-core` 不依赖 React / DOM，可脱离桌面端在 Node 中运行与测试；`player` 只消费快照和效果事件。
- **分层渲染**：背景 → 多立绘 → CG → 对话 UI → 选项 → 菜单遮罩，支持 fade / none 转场。
- **文本体验**：逐字打字、点击补全、Auto、Ctrl 跳过已读、未读自动停止、历史回看与语音回放。
- **回滚与插值**：`PageUp` / 滚轮上滑回到最近 50 个阻塞点，完整恢复指针、变量、舞台与 BGM；`text` 支持 `{变量名}` 插值与 `{{` / `}}` 转义。
- **稳定已读与分支动作**：文本 id 按内容哈希生成，插入无关台词不会打乱 Skip 记录；`set` 支持表达式与字符串拼接，选项可在跳转前执行一组赋值。
- **章节与结局**：manifest 登记章节展示名与结局表，`ending` 指令结束本局；结局页显示标题与描述，存档面板显示可读章节名。
- **音频管理**：BGM / SE / VO 独立音量与打断规则，进入场景预加载图片与音频。
- **存档系统**：指针、变量、图层、BGM、已读标记、Backlog 与截图完整落盘；手动 / 自动 / 快速三类存档，自动存档保留 3 份轮换，「继续游戏」取所有存档中最新的一份；带版本号与内容版本提示，旧版存档自动迁移。
- **诊断与兜底**：脚本警告汇总到播放器内面板，可复制诊断信息；覆盖 / 删除 / 返回标题使用应用内确认框；渲染异常由 ErrorBoundary 兜底，避免白屏。
- **内容与代码分离**：打包时内容包被复制到 `resources/game`，替换资源即可更新剧情，无需重新编译。
- **桌面交付**：Electron 自定义协议限制资源访问，关闭 Node 集成；Forge + NSIS 生成 Windows 安装包。
- **Web 预览**：同一套 `@sylvie/player` 通过 HTTP + localStorage 平台适配器在浏览器中运行，改 UI / 剧本即时热更新。

## 页面预览

| 对话与舞台 | 分支选择 |
| --- | --- |
| ![对话](docs/screenshots/dialogue.png) | ![选项](docs/screenshots/choice.png) |

| 存读档（截图缩略图） | 设置 |
| --- | --- |
| ![存读档](docs/screenshots/save-load.png) | ![设置](docs/screenshots/settings.png) |

| 游戏内菜单 | 对话历史 |
| --- | --- |
| ![菜单](docs/screenshots/menu.png) | ![历史](docs/screenshots/backlog.png) |

## 快速开始

要求 Windows 10/11、PowerShell 7（`pwsh`）、Node.js ≥ 20.11（`smoke` 需 22+）、pnpm ≥ 9；`docker:*` 操作另需 Docker Desktop（Compose v2）。首次使用先安装依赖：

```powershell
cd galgame-monorepo
pnpm install
```

之后统一通过根目录的 `manage.ps1` 运维：

```powershell
# 环境 / 产物 / 存档状态
pwsh ./manage.ps1 status

# 检查 Node、pnpm、依赖与内容包
pwsh ./manage.ps1 doctor

# 构建共享包并启动 Electron 开发模式
pwsh ./manage.ps1 dev

# 浏览器预览（http://127.0.0.1:5175），改 player 源码即时热更新
pwsh ./manage.ps1 web

# 构建 Web 镜像并启动容器（http://localhost:8080）
pwsh ./manage.ps1 docker:up

# 打包：免安装目录 + NSIS 安装包
pwsh ./manage.ps1 package
pwsh ./manage.ps1 make

# 自动验证：ESLint + typecheck + 单元测试 + 剧本校验
pwsh ./manage.ps1 verify

# 启动打包产物，自动验证回退、选项、存读档与设置并截图
pwsh ./manage.ps1 smoke
```

产物位置：

| 产物 | 路径 |
| --- | --- |
| 免安装版 | `galgame-monorepo/apps/electron/out/SylvieGalGame-win32-x64/SylvieGalGame.exe` |
| NSIS 安装包 | `galgame-monorepo/apps/electron/out/make/SylvieGalGame-Setup-0.1.0.exe` |
| Web 预览产物 | `galgame-monorepo/apps/web/dist/` |
| Web 镜像 | `sylvie-web:local`（容器 `sylvie-web`） |
| 冒烟截图 | `galgame-monorepo/scripts/.smoke/` |

## Web 容器化

`scripts/docker-compose.yml` 只包含一个 `web` 服务：多阶段构建 `apps/web`，再把静态产物交给 Nginx。容器本身无状态，存档仍在访问者浏览器的 `localStorage` 中。

```powershell
# 一键构建并启动
pwsh ./manage.ps1 docker:up

# 或直接使用 compose
docker compose -f scripts/docker-compose.yml up -d --build
```

| 配置 | 说明 |
| --- | --- |
| `scripts/docker-compose.yml` | Web 服务、端口映射与健康检查 |
| `scripts/.env.example` | 复制为 `scripts/.env` 后可改 `WEB_PORT` / `NPM_REGISTRY` |
| `galgame-monorepo/apps/web/Dockerfile` | Node 22 构建 + Nginx 运行 |
| `galgame-monorepo/apps/web/nginx.conf` | 静态托管、`/game/` 禁止长期缓存、CSP 与 gzip |
| `galgame-monorepo/.dockerignore` | 排除 node_modules、dist、Electron 产物等 |

默认访问地址为 <http://localhost:8080>，健康检查端点 `/health`。Web 存档按浏览器 origin 隔离，修改 `WEB_PORT` 后相当于进入一套新的存档空间。

## manage.ps1

| 操作 | 说明 |
| --- | --- |
| `status` | 环境版本、内容包数量、构建产物、本地存档大小 |
| `doctor` | 前置条件检查，缺失时直接报错 |
| `dev` | 构建依赖包并启动 Electron 开发模式 |
| `web` | 启动 Web 预览壳（Vite HMR，端口 5175） |
| `docker:up` | 构建 Web 镜像并启动容器（默认 8080） |
| `docker:down` / `docker:restart` | 停止移除 / 重启 Web 容器 |
| `docker:build` | 仅构建镜像（`-Force` 禁用缓存） |
| `docker:logs` | 查看容器日志（可加 `-Follow`、`-Tail`） |
| `docker:status` | 查看容器健康状态与实际访问地址 |
| `build` | Turbo 构建全部包（含 Web 预览） |
| `package` / `make` | 生成免安装目录 / NSIS 安装包 |
| `smoke` | 启动已打包应用，CDP 驱动 UI 并截图（可传 `-ExePath`） |
| `verify` | 依次执行 lint、typecheck、test、validate |
| `lint` / `test` / `typecheck` / `validate` | 单项校验 |
| `assets` | 重新生成占位图片、音频与图标 |
| `clean` | 清理构建产物（需确认，`-Force` 跳过） |
| `reset-saves` | 删除本地存档、已读标记与设置（需确认） |
| `output` | 打开打包产物目录 |

脚本会自动清除 `ELECTRON_RUN_AS_NODE`，避免 Electron 被当作 Node 运行时启动而报 `bad option`。

## 技术栈

- **引擎内核**：纯 TypeScript，YAML 解析、指针 + 阻塞调度、变量与条件表达式、已读标记、存档序列化
- **播放器**：React 19、Tailwind CSS v4、Motion 12、Zustand 5、Howler.js
- **桌面端**：Electron 45、Electron Forge 8、Vite 8、NSIS
- **Web 预览**：Vite 8 + React 19（源码别名热更新、`/game` 资源中间件、localStorage 存档）
- **Web 容器化**：Docker Compose + Node 22 多阶段构建 + Nginx 静态托管
- **工程**：pnpm workspace + Turborepo、ESLint 9 平面配置、Vitest、TypeScript strict

## 目录结构

```text
SylvieGalGame/
├── docs/
│   ├── SylvieGalGame需求整理-v1.md   # 一期需求
│   ├── SylvieGalGame需求整理-v2.md   # 二期需求与里程碑
│   └── screenshots/                  # README 截图
├── galgame-monorepo/
│   ├── apps/
│   │   ├── electron/                 # 主进程、preload、桌面能力与打包配置
│   │   └── web/                      # Web 预览壳：浏览器平台适配器与 Vite 配置
│   ├── packages/
│   │   ├── engine-core/              # 纯 TS 剧本引擎（含 Vitest）
│   │   ├── player/                   # React 播放器
│   │   ├── game-content/             # 内容包：剧本 + 图片 + 音频（无构建步骤）
│   │   ├── types/                    # 跨包共享类型
│   │   ├── eslint-config/            # 共享 ESLint 平面配置（base / react）
│   │   └── tsconfig/                 # 共享 TS 配置
│   ├── scripts/                      # 资源生成、内容校验、冒烟测试
│   └── docs/剧本格式.md               # YAML 指令参考
├── scripts/
│   ├── docker-compose.yml            # Web 静态站容器编排
│   └── .env.example                  # 端口与依赖源示例
├── manage.ps1                        # 开发 / 校验 / 打包 / 容器运维入口
└── README.md
```

## 内容替换

剧情和素材全部位于 `galgame-monorepo/packages/game-content/game/`：

```text
game/
├── scripts/game.yaml        # 标题、入口场景、场景列表、初始变量
├── scripts/scenes/*.yaml    # 场景剧本
├── images/                  # bg / sprite / cg
└── audio/                   # bgm / se / voice
```

替换后执行：

```powershell
pwsh ./manage.ps1 validate
```

该命令会解析全部场景、检查标签跳转、表达式与资源存在性，并实际走通所有分支；有警告即以非零码退出。

## 快捷键

| 按键 | 行为 |
| --- | --- |
| 空格 / 回车 / 点击 | 打字中补全全文；等待中推进 |
| 选项界面 `↑` / `↓` / `1`–`9` / `Enter` | 切换、直选或确认选项 |
| `A` | Auto 开关 |
| `Ctrl` | Skip 开关（遇到未读文本自动停止） |
| `PageUp` / 滚轮上滑 | 回到上一个文本、选项或等待 |
| `Esc` | 打开 / 关闭菜单 |
| `Ctrl+S` / `Ctrl+L` | 快速存档 / 快速读档 |

## 文档

- [一期需求](docs/SylvieGalGame需求整理-v1.md)：一期功能范围
- [二期需求](docs/SylvieGalGame需求整理-v2.md)：优化项、优先级与里程碑
- [剧本格式](galgame-monorepo/docs/剧本格式.md)：清单、场景、全部指令与表达式
- [工程说明](galgame-monorepo/README.md)：架构、数据流、开发与打包细节

## 一期边界

- 无剧本编辑器，剧情直接写 YAML。
- 转场仅支持 `fade` / `none`，未做擦除、滑动、粒子。
- 资源为松散文件，未加密或压缩。
- 美术与音频为程序生成的占位素材，可直接替换为正式资源。
- 安装包未签名，Windows SmartScreen 可能提示。
- 本地存档：桌面端写入 `%APPDATA%\SylvieGalGame\game-storage.json`；Web 预览写入 `localStorage`（`sylvie:` 前缀），缩略图存为 JPEG 以控制容量。
- Web 预览若提示存储空间不足，可在控制台执行 `window.sylvieWeb.resetStorage()` 清空预览存档。
- Docker 容器本身无状态；更换 `WEB_PORT` 会改变浏览器 origin，旧存档不会随之迁移。
- Web 预览壳只用于调试与静态预览，正式交付仍以 Electron 打包产物为准。
- `smoke` 依赖 Node.js 22+ 的内置 WebSocket；其余开发与打包操作 Node 20.11+ 即可。

## License

[MIT](LICENSE)
