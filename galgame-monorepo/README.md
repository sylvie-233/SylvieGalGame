# 午后的回声 · SylvieGalGame

一期目标（见 [需求整理](../docs/SylvieGalGame需求整理-v1.md)）：**无编辑器、纯 YAML 脚本驱动、React + Electron、仅播放器**，跑通线性 + 分支视觉小说流程，并可打包为 Windows exe。

当前仓库已包含一个可玩的竖切版本：标题页 → 序章 → 两个分支 → 两次选择 → 两个结局，含立绘 / CG / BGM / SE / 语音、打字机、Auto、Skip（仅已读）、Backlog、20 个手动存档 + 自动/快速存档、设置面板与打包配置。二期 M1 另已加入回滚、文本插值、存档迁移、应用内确认框、警告面板与错误边界；M2 已加入稳定已读 id、`set` 表达式、选项赋值动作、选项键盘操作、自动存档轮换与章节 / 结局元数据。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面外壳 | Electron 45 + Electron Forge 8 + Vite 8 |
| Web 预览壳 | Vite 8 + React 19（浏览器内调试，复用同一播放器） |
| 界面 | React 19 + TypeScript（strict） |
| 样式 | Tailwind CSS v4（`@theme` 设计令牌） |
| 动画 | Motion 12（`motion/react`） |
| 全局状态 | Zustand 5 |
| 音频 | Howler.js |
| 脚本 | YAML（`yaml`） |
| 工程 | pnpm workspace + Turborepo + ESLint 9 |

## 目录结构

```text
galgame-monorepo/
├─ apps/
│  ├─ electron/                # 桌面外壳：主进程、preload、自定义协议、打包配置
│  │  ├─ src/main.ts           # 窗口、game:// 协议、IPC、存储、截图、全屏
│  │  ├─ src/preload.ts        # 通过 contextBridge 暴露受控 API
│  │  ├─ src/renderer.tsx      # 注入桌面能力并挂载播放器
│  │  ├─ forge.config.ts       # Forge + NSIS + extraResource
│  │  └─ assets/               # 应用图标（png / ico）
│  └─ web/                     # Web 预览壳：Vite + /game 资源中间件，用于浏览器调试
│     ├─ src/platform.ts       # fetch / IndexedDB（localStorage 回退）/ 截图 / Fullscreen 适配
│     ├─ src/renderer.tsx      # 注入 Web 能力并挂载播放器
│     ├─ vite.config.ts        # 源码别名 + 内容目录服务与构建复制
│     ├─ Dockerfile            # Node 22 构建 + Nginx 运行的多阶段镜像
│     └─ nginx.conf            # 静态托管、CSP、/game/ 缓存策略与健康检查
├─ packages/
│  ├─ types/                   # 跨包共享类型：指令、状态、存档、设置、平台能力
│  ├─ engine-core/             # 纯 TS 内核：解析、指针调度、变量、条件、插值、回滚、存档迁移
│  │  └─ test/                 # Vitest 单元测试
│  ├─ player/                  # React 播放器：舞台、对话、选项、面板、音频、状态
│  │  └─ test/                 # Vitest：Zustand 状态 / 存档工具
│  ├─ eslint-config/           # 共享 ESLint 平面配置（base / react）
│  └─ game-content/            # 纯内容包（无构建步骤）：剧本 + 图片 + 音频
│     └─ game/
│        ├─ scripts/           # game.yaml 清单 + scenes/*.yaml
│        ├─ images/            # bg / sprite / cg
│        └─ audio/             # bgm / se / voice
├─ scripts/
│  ├─ generate-assets.mjs      # 生成占位 SVG / WAV / PNG / ICO
│  ├─ validate-content.mjs     # 跑通全部分支并检查警告
│  └─ smoke-app.mjs            # 启动打包产物、CDP 驱动界面并截图
├─ .dockerignore               # Docker 构建上下文排除规则
└─ docs/
   ├─ 剧本格式.md                # YAML 指令参考
   └─ script.schema.json        # 编辑器 Schema（VSCode YAML 插件）
```

业务逻辑与 UI 严格分离：

- `engine-core` 不依赖 React / DOM，只接收 `AssetHost` 与 `KeyValueStorage`，可在 Node 中直接跑（`validate-content.mjs` 就是这么做的）。
- `player` 只消费引擎快照与效果事件，UI 状态集中在 Zustand。
- `electron` 只负责桌面能力和资源加载，不包含剧情逻辑。
- `web` 只是预览壳：把同一套 `PlayerPlatform` 用 HTTP + IndexedDB（localStorage 回退）实现，便于浏览器 HMR 与 DevTools 调试，不作为交付形态。
- `game-content` 不含代码；替换整个目录即可换一款游戏。

## 数据流

```text
game-content/game (YAML + 资源)
        │  AssetHost（Electron: game:// 协议 / Web: /game HTTP）
        ▼
engine-core ──快照/效果──▶ player（Zustand + React + Motion）
        │                        │
        └──存档/设置──▶ KeyValueStorage（Electron: IPC → userData/game-storage.json
                                          Web: IndexedDB / localStorage 回退）
```

引擎采用指针 + 阻塞模型：`text` / `choice` / `wait` 会阻塞，`bg` / `sprite` / `cg` / `bgm` / `se` / `voice` / `set` / `if` / `jump` / `shake` / `flash` 即时执行。每次推进都产生不可变快照，Zustand 只保存快照引用，渲染层按阶段呈现。到达文本 / 选项时引擎会发出 `checkpoint` 效果，播放器据此节流自动存档，并通过 `getUpcomingSceneAssets()` 预取后续分支场景；阻塞前的完整状态进入回滚历史（最多 50 个），`rollback()` 直接恢复而不重跑脚本。预加载有数量预算（单场景 32 个、音频 LRU 24 条），超出按需加载。

## 开始开发

要求 Node ≥ 22（已在 Node 26 / pnpm 10 验证）与 pnpm 10。

```bash
pnpm install
pnpm dev          # 构建共享包并启动 Electron（Vite 开发服务器）
pnpm dev:web      # 启动 Web 预览（http://127.0.0.1:5175，直接跑共享包源码）
```

常用命令：

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 构建 `player` 依赖后启动桌面应用 |
| `pnpm dev:web` | 启动 Web 预览壳（端口 5175，`player` / `engine-core` 源码热更新） |
| `pnpm build:web` | 构建 Web 预览静态产物到 `apps/web/dist`（同时复制内容包） |
| `pnpm preview:web` | 构建并预览 Web 产物 |
| `pnpm build` | Turbo 构建全部包（含 Web 预览） |
| `pnpm lint` | 全仓 ESLint 检查（`--max-warnings 0`） |
| `pnpm typecheck` | 全仓 TypeScript 检查 |
| `pnpm test` | 单元测试（Vitest）：引擎 31 个 + 播放器状态 / 存档工具 8 个 |
| `pnpm validate` | 加载真实剧本、跑通两条分支、检查资源与脚本警告 |
| `pnpm assets` | 重新生成占位美术与音频 |
| `pnpm package` | 输出免安装目录 `apps/electron/out/SylvieGalGame-win32-x64/` |
| `pnpm make` | 通过 NSIS 生成安装包 `apps/electron/out/make/` |
| `pnpm smoke` | 启动已打包产物，自动验证标题 / 回退 / 分支 / 选项 / 菜单 / 存读档 / 设置并截图到 `scripts/.smoke/`（需先 `pnpm package`，或把 exe 路径作为参数传入） |
| `pnpm smoke:web` | 构建 Web 产物、启动 `vite preview`，用无头 Chrome 跑标题 → 推进 → 选项 → 存读档并截图；可用 `CHROME_PATH` 指定浏览器 |

> 若终端导出了 `ELECTRON_RUN_AS_NODE=1`，Electron 会以纯 Node 模式启动并报 `bad option`。运行前先 `unset ELECTRON_RUN_AS_NODE`；`pnpm smoke` 已自动处理。

## Web 容器化

仓库根目录的 `scripts/docker-compose.yml` 调用 `apps/web/Dockerfile` 构建静态镜像：

```bash
# 在仓库根目录执行，默认 http://localhost:8080
docker compose -f scripts/docker-compose.yml up -d --build

# 内容热替换：额外加载覆盖文件，把本地内容包只读挂入容器
docker compose -f scripts/docker-compose.yml -f scripts/docker-compose.game.yml up -d --build

# 查看状态 / 日志 / 停止
docker compose -f scripts/docker-compose.yml ps
docker compose -f scripts/docker-compose.yml logs -f web
docker compose -f scripts/docker-compose.yml down
```

- 构建阶段使用 Node 22 + pnpm，只复制 Web 所需的 workspace 清单，避免安装 Electron 依赖；
- 运行阶段使用 Nginx，托管 `dist/`（其中包含 Vite 构建时复制的 `game/`）；
- `/assets/` 采用内容哈希长期缓存，`/game/` 设置 `no-store`，替换剧本后无需清缓存；
- 容器无状态，Web 存档保存在浏览器 IndexedDB（不支持时回退 `localStorage`），`docker compose down` 不会丢档；
- 存档按 origin 隔离，修改 `WEB_PORT` 后会进入一套新的存档空间；
- 默认使用镜像内置内容；加 `-f scripts/docker-compose.game.yml`（或 `pwsh ./manage.ps1 docker:up -GameContent`）会把本地内容包只读挂载到 `/usr/share/nginx/html/game`，改剧本后刷新即可生效。
- 端口与依赖源可在 `scripts/.env` 中覆盖（参考 `scripts/.env.example`）。

日常操作可直接使用根目录脚本：`pwsh ./manage.ps1 docker:up`。

## 内容与代码分离

剧本和资源全部位于 [packages/game-content/game](packages/game-content/game)：

- 开发时：Electron 直接读取该目录（`SYLVIE_GAME_ROOT` 可覆盖）；Web 预览通过 Vite 中间件挂载在 `/game`。
- 打包时：Forge 通过 `extraResource` 把整个 `game` 目录复制到 `resources/game`，与 `app.asar` 分离。替换 `resources/game` 即可在不重新编译代码的情况下更新剧情和素材。
- Web 构建时：`apps/web/vite.config.ts` 会把内容包复制到 `dist/game`，`vite preview` 与实际部署都从同一路径读取。

替换内容后至少运行一次：

```bash
pnpm validate
```

它会解析所有场景、检查 `label` / 跳转 / 表达式 / 资源存在性，做内容体检（未引用资源、不可达场景、超大资源、命名规范），并实际走通两条分支；有任何警告都会以非零码退出。

编辑器补全由 `docs/script.schema.json` 提供，`.vscode/settings.json` 已映射 `game.yaml` 与 `scenes/*.yaml`；安装 YAML 插件即可使用。

## 快捷键

| 按键 | 行为 |
| --- | --- |
| 空格 / 回车 / 点击 | 打字中：立即显示全文；等待中：推进 |
| 选项界面 `↑` / `↓` / `1`–`9` / `Enter` | 切换、直选或确认选项 |
| `H` / 右键 | 隐藏 / 恢复对话与快捷栏 |
| `A` | 切换 Auto |
| `Ctrl` | 切换 Skip（遇到未读文本自动停止） |
| `PageUp` / 滚轮上滑 | 回退到上一个文本、选项或等待 |
| `Esc` | 打开 / 关闭游戏内菜单（弹窗打开时只关闭最上层弹窗） |
| `Ctrl+S` / `Ctrl+L` | 快速存档 / 快速读档 |

## 存档

- 手动槽位 20 个，另有快速存档与 3 份轮换的自动存档（`save:auto`、`save:auto:2`、`save:auto:3`）。「继续游戏」读取自动 / 快速 / 手动存档中时间最新的一份。保存到手动槽位时可填写备注（最长 40 字），覆盖时自动预填原备注。
- 图鉴解锁单独写入 `meta:gallery`（CG / BGM / 结局 id），与存档互不影响；标题页与游戏内菜单均可打开「回忆图鉴」。
- 存档面板支持「导出全部存档」与单档导出为 JSON，也可导入同格式文件；导出包含存档、已读、设置与图鉴记录，导入会覆盖同键数据并跳过未知键。桌面端走系统文件对话框，Web 端走浏览器下载 / 上传。
- 存档内容：场景与指针、全部变量、图层状态、BGM、已读标记、Backlog、章节备注、截图缩略图、内容版本号。
- 存档版本为 `3`；`version: 1` / `2` 自动迁移并补齐 `contentVersion`、`bgmPosition`，迁移失败不会覆盖原数据。读取到不同内容版本的存档时会提示剧情可能已变化。读档后 BGM 会从存档记录的位置继续播放。
- 自动存档在到达文本 / 选项时触发，900ms 防抖；截图只在选项或章节变化时重新抓取，普通文本复用上一张缩略图。
- 桌面端统一写入 `userData/game-storage.json`（Windows 下通常位于 `%APPDATA%\SylvieGalGame\`）。
- Web 预览优先写入 IndexedDB，并请求 `navigator.storage.persist()`；不支持或打开失败时回退 `localStorage`（`sylvie:` 前缀），旧版 `sylvie:` 数据首次启动会自动迁移进 IndexedDB。存档缩略图使用 JPEG 压缩。控制台可用 `await window.sylvieWeb.resetStorage()` 清空预览存档，`await window.sylvieWeb.storageKeys()` 列出键名，`storageDelete(key)` 按原始键删除单条。

## 当前边界

- 转场覆盖淡入淡出、溶解、左右滑动与擦除，并提供震屏 / 闪屏；没有粒子或 3D 转场。
- 资源为松散文件，未做加密或压缩。
- 脚本警告已汇总到播放器内面板，但暂未带 `scene.yaml` 行号；错误与警告仍未分级。
- 渲染异常由 ErrorBoundary 兜底，暂未把运行日志落盘到 `userData`。
- 占位美术 / 音频由 `scripts/generate-assets.mjs` 生成，用于验证流程；可直接替换为正式素材。
