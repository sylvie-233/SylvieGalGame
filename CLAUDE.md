# CLAUDE.md

本文件为 Claude Code 在本仓库工作时提供指引。面向本项目的修改、排查与提交，请先按本文约定执行。

## 仓库结构

- Git 根目录是 `SylvieGalGame/`，实际代码位于 `galgame-monorepo/`（pnpm workspace + Turborepo）。
- `galgame-monorepo/apps/electron/`：Electron 45 + Forge 8 桌面外壳，负责窗口、`app://` / `game://` 协议、IPC 存储、截图、全屏与 NSIS 打包。
- `galgame-monorepo/apps/web/`：Vite 8 + React 19 Web 预览壳，浏览器内调试同一套播放器；也用于构建 Nginx 静态镜像。
- `galgame-monorepo/packages/`：
  - `types`：跨包共享类型与常量（指令、快照、存档、设置、`PlayerPlatform`）；
  - `engine-core`：纯 TypeScript 引擎，不依赖 React / DOM；
  - `player`：React 播放器 UI（舞台、对话、选项、存读档、设置、音频）；
  - `game-content`：唯一内容包，`game/` 下是 manifest、场景 YAML、图片与音频，无构建步骤；
  - `eslint-config`、`tsconfig`：共享工程配置。
- `docs/SylvieGalGame需求整理-v1.md`：一期需求权威文档；`docs/screenshots/`：根 README 使用的截图。
- `galgame-monorepo/docs/剧本格式.md`：YAML 清单、场景、全部指令与表达式的权威参考。
- `galgame-monorepo/docs/script.schema.json`：编辑器 YAML Schema；根目录与 monorepo 内的 `.vscode/settings.json` 已映射 `game.yaml` 与 `scenes/*.yaml`。新增指令时必须同步更新 Schema。
- 根目录 `manage.ps1` + `scripts/docker-compose.yml`：开发、校验、打包、冒烟测试与 Web 容器运维入口。
- `.github/workflows/ci.yml`：push / PR 执行 lint、typecheck、test、validate、Web 构建与 `pnpm smoke:web`，并上传冒烟截图。

## 常用命令

在 `galgame-monorepo/` 下执行：

```bash
pnpm install
pnpm dev          # 构建 player 依赖后启动 Electron（Vite dev server :5174）
pnpm dev:web      # Web 预览，:5175；player / engine-core 走源码别名，改 UI 即时热更新
pnpm build        # Turbo 构建全部包（含 apps/web）
pnpm lint         # 全仓 ESLint，每包 --max-warnings 0
pnpm typecheck    # 全仓 tsc --noEmit
pnpm test         # Vitest：engine-core 31 个 + player 7 个用例
pnpm validate     # 加载真实剧本、内容体检、跑通两条分支、检查资源与脚本警告
pnpm assets       # 重新生成占位图片 / 音频 / 图标
pnpm package      # 免安装目录 apps/electron/out/SylvieGalGame-win32-x64/
pnpm make         # NSIS 安装包 apps/electron/out/make/
pnpm smoke        # 启动已打包 exe，CDP 驱动 UI 并截图（需 Node 22+，先 package）
pnpm smoke:web    # 构建 Web + vite preview + 无头 Chrome，验证标题/推进/选项/存读档并截图
```

单包操作：

```bash
pnpm --filter @sylvie/engine-core test
pnpm --filter @sylvie/player build      # Electron 读取 dist；改 player 后需重新构建
pnpm --filter @sylvie/web build         # 构建前自动复制 game-content 到 dist/game
pnpm --filter @sylvie/web preview       # 预览构建产物，:5175
```

仓库根目录（PowerShell 7）：

```powershell
pwsh ./manage.ps1 status|doctor|verify
pwsh ./manage.ps1 dev|web|build|package|make|smoke
pwsh ./manage.ps1 docker:up|docker:down|docker:restart|docker:build|docker:logs|docker:status
```

`manage.ps1` 会在启动 Electron 前清除 `ELECTRON_RUN_AS_NODE`；`docker:*` 使用 `scripts/docker-compose.yml`，默认访问 `http://localhost:8080`。

## 架构与数据流

```text
game-content/game (YAML + 图片 + 音频)
        │  AssetHost（Electron: game:// / Web: /game HTTP）
        ▼
engine-core ──快照 + 效果事件──▶ player（Zustand + React + Motion）
        │                              │
        └──存档 / 设置──▶ KeyValueStorage（Electron: JSON 文件 / Web: IndexedDB + localStorage 回退）
```

- **engine-core**：解析 manifest 与递归 imports，按 `label` / `jump` / `choice` / `if` 等指令推进；采用指针 + 阻塞模型，`text` / `choice` / `wait` 阻塞，其余即时执行。`phase` 为 `idle | text | choice | wait | ended`，每次推进产生不可变 `GameSnapshot`，并通过 effect 事件通知 UI 播放 BGM / SE / 语音、预加载资源。每个阻塞点会记录最多 50 个完整状态快照供 `rollback()` 使用；`text` 的 `{变量}` 插值在阻塞时求值；到达文本 / 选项时发出 `checkpoint` 效果，供播放器节流自动存档。文本已读 id 默认按“块名 + 内容哈希”生成并兼容旧版 `block#下标`，显式 `id` 优先；`set` 支持 `expr`，`choice` 选项可带 `set` / `actions`，选中后先赋值再跳转。manifest 的 `chapters` / `endings` / `titleScreen` 由引擎解析，`ending` 指令结束本局并在快照中带出 `chapterName` 与 `ending`；`sprite` 支持 `scale` / `z` / `flip`。转场为 `fade | dissolve | slide-left | slide-right | wipe | none`，每条指令可带 `ease`；`shake` / `flash` 通过效果事件交给播放器一次性播放，不写入快照。`getUpcomingSceneAssets()` 会从当前指令向后扫描跳转 / 分支目标，供播放器按预算预取后续场景资源，不改变引擎状态。
- **player**：`GameApp` 只消费快照与事件；启动时必须先调用 `configurePlayer(PlayerPlatform)` 注入平台能力。UI 状态集中在 Zustand（`packages/player/src/store.ts`），音频由 `AudioManager` 管理。`player` 不直接访问 `window.sylvieGame`、`localStorage` 或任何文件系统 API。覆盖 / 删除 / 返回标题统一走 `useConfirm()` 应用内确认框，不要恢复原生 `window.confirm`；脚本警告汇总到 Zustand 的 `warnings` 并由 `WarningsPanel` 展示；宿主入口用 `ErrorBoundary` 包住 `GameApp`。图鉴解锁由 `GameApp` 监听快照（CG / BGM / 结局）后写入 `meta:gallery`，`GalleryPanel` 只读展示并提供 BGM 试听。
- **Electron**：`main.ts` 注册 `app://sylvie/index.html` 与 `game://assets/...`，资源访问经过 `resolveInside` 防目录穿越；`preload.ts` 通过 `contextBridge` 暴露受控 API；存档写入 `userData/game-storage.json`，窗口尺寸 / 位置 / 最大化状态写入 `userData/window-state.json`（启动时做显示器可见性校验）。已有单实例锁，第二次启动会聚焦现有窗口。渲染进程的 CSP 禁止外部脚本，截图通过 `capturePage` 生成 640px 宽缩略图。
- **Web**：`apps/web/src/platform.ts` 将同一套 `PlayerPlatform` 映射为 `fetch` + IndexedDB（localStorage 回退，启动时迁移旧 `sylvie:` 键并请求 `navigator.storage.persist()`）+ `html-to-image` + Fullscreen API。Vite 配置把共享包别名到源码，开发期中间件把 `game-content/game` 挂到 `/game`（支持 HEAD / Range）；构建时把内容复制到 `dist/game`。`quit` 刻意不实现，播放器会自动隐藏“退出游戏”。
- **Docker**：`scripts/docker-compose.yml` → `apps/web/Dockerfile` 多阶段构建（Node 22 构建、Nginx 运行），只安装 Web 所需 workspace 依赖，不把 Electron 装进镜像。容器无状态，存档在访问者浏览器中。`scripts/docker-compose.game.yml` 是可选覆盖文件，把本地 `game-content/game` 只读挂到 `/usr/share/nginx/html/game`；`manage.ps1 docker:* -GameContent` 用同一套覆盖。

## 代码约定

- 全仓 ESM；`packages/tsconfig/base.json` 开启 `strict`、`noUncheckedIndexedAccess`、`noUnusedLocals/Parameters`、`verbatimModuleSyntax`。共享包用 tsup 输出到 `dist/`，不要手改 `dist`。
- Electron 消费共享包的 `dist`：改 `packages/player` 或 `engine-core` 后，`pnpm dev` 会先构建依赖；开发中继续改源码需要重新构建（或重启 dev）。Web 壳例外：它直接跑源码。
- Tailwind CSS v4 使用 `@theme` 设计令牌；组件类名依赖 `@source` 扫描。新增扫描目录时同步更新 `apps/electron/src/index.css`（扫描 `packages/player/dist`）与 `apps/web/src/index.css`（扫描 `packages/player/src`）。
- 动画统一用 `motion/react`；全局状态用 Zustand；不要引入第二套同类库。
- ESLint 9 flat config：逻辑包用 `@sylvie/eslint-config/base`，React 端用 `@sylvie/eslint-config/react`；每包 `eslint . --max-warnings 0`，另有 Prettier。
- 注释、UI 文案、README 与提交信息使用中文；类型名、变量名、文件名使用英文。
- **分支策略**：用户要求直接在 `main` 上提交，不新建特性分支，也不主动开 PR；推送仍需用户明确要求。
- **平台能力**：新增宿主能力时先扩展 `packages/types/src/platform.ts`，再分别实现 Electron / Web 两侧；禁止在共享 UI 里判断运行环境或直接调用宿主 API。文件导入导出使用 `saveTextFile` / `openTextFile`：Electron 走 `dialog` + `fs`，Web 走 Blob 下载与文件选择。
- **内容单一来源**：剧情与素材只改 `packages/game-content/game/`，不要复制到 `apps/web/public` 或 Electron 资源目录。改完运行 `pnpm validate`。

## 存档与状态

- 键名：`save:auto`、`save:auto:2..3`（`AUTO_SAVE_COUNT = 3`）、`save:quick`、`save:slot:1..20`（`MANUAL_SAVE_COUNT = 20`）、`meta:read-marks`、`meta:settings`、`meta:gallery`。
- 存档包含场景 / 指针、变量、图层、BGM 及播放位置（`bgmPosition`）、已读标记、Backlog、章节备注、截图缩略图、`contentVersion`；`SAVE_VERSION = 3`，`migrateSaveData()` 负责把 `version: 1` / `2` 的旧档补成 v3，迁移失败不得覆盖原始数据。BGM 位置由播放器通过 `createSave({ bgmPosition })` 写入，引擎不认识音频实例。
- 自动存档由 `checkpoint` 效果触发（900ms 防抖），写入 `save:auto` 并把旧档轮换到 `save:auto:2` / `save:auto:3`；截图只在选项节点或章节变化时重新抓取，普通文本复用上一张，避免每条台词都 `capturePage`。「继续游戏」通过 `readLatestSave()` 读取自动 / 快速 / 手动存档中最新的一份。
- 存档导出格式为 `{ format: 'sylvie-save-export', version: 1, exportedAt, saves }`；导入时只接受白名单键（存档、已读、设置、图鉴），未知键与非字符串值直接跳过，格式错误不得写入任何数据。
- Electron 落盘在 `%APPDATA%\SylvieGalGame\game-storage.json`。
- Web 优先使用 IndexedDB（库 `sylvie-web`，store `kv`，键为原始键）；localStorage 仅作回退，键统一加 `sylvie:` 前缀。启动时把旧 `sylvie:` 键迁移进 IndexedDB 后删除旧副本。缩略图使用 JPEG（640px）控制体积。容量不足时提示执行 `await window.sylvieWeb.resetStorage()`；`storageKeys()` / `storageDelete(key)` / `resetStorage()` 均已改为异步。
- Web 存档按 origin 隔离；修改 `WEB_PORT` 会进入新的存档空间，`docker compose down` 不会丢档。

## 校验与提交

- 提交前至少运行 `pnpm lint`、`pnpm typecheck`；改动引擎或存档逻辑再加 `pnpm test`；改动剧本或资源必须 `pnpm validate`。根目录 `pwsh ./manage.ps1 verify` 会依次跑完这四项。
- 改动 UI 后优先用 `pnpm dev:web` 在浏览器验收；需要自动化 Web 回归时运行 `pnpm smoke:web`（会自行构建 + preview，需 Chrome / Edge；`CHROME_PATH` 可覆盖）。需要验证桌面交付时运行 `pwsh ./manage.ps1 smoke`（依赖已 packge 的 exe 与 Node 22+）。
- 桌面冒烟脚本在覆盖存档槽位 01 前会先执行 `window.sylvieGame.storageDelete('save:slot:1')`，避免覆盖确认框打断后续 CDP 步骤。新增自动化步骤时保留该处理；若需要测试确认框，应显式点击「取消 / 覆盖」按钮而不是依赖原生对话框。
- Docker 构建改动后至少执行一次 `pwsh ./manage.ps1 docker:build`；运行验收用 `docker:up`，再检查 `/health`、`/game/scripts/game.yaml` 与音频 Range 请求。

## 已知边界与常见坑

- 转场支持 `fade` / `dissolve` / `slide-left` / `slide-right` / `wipe` / `none` 与逐条 `ease`；`shake` / `flash` 为一次性效果，不进入存档或回滚快照。无剧本编辑器；资源为松散文件，未加密或压缩。
- 回滚历史只存在当前会话内存中（最多 50 个阻塞点），`start()` / `restoreSave()` 会清空；它不写入存档，读档后不能继续回退到读档前的进度。
- 脚本警告已汇总到播放器内面板，但暂未带 `scene.yaml` 行号，也没有错误 / 警告分级；渲染异常只做 ErrorBoundary 兜底，尚未把日志写入 `userData`。
- 新增存档字段时必须同时提升 `SAVE_VERSION`、更新 `isSaveData()` 并在 `migrateSaveData()` 中补迁移逻辑，否则旧档会被当成坏档丢弃。
- 嵌套弹窗必须使用 `Modal`：它维护全局弹窗栈，Esc 只关闭最上层；直接写 `<div role="dialog">` 会破坏该行为。
- 美术与音频是 `scripts/generate-assets.mjs` 生成的占位素材，可直接替换。
- `ELECTRON_RUN_AS_NODE=1` 会让 Electron 退化为 Node 并报 `bad option`；`manage.ps1` 与 `scripts/smoke-app.mjs` 已处理。
- 打包产物较大（Electron + 游戏资源）；NSIS 安装包未签名，Windows SmartScreen 可能提示。
- Web 的 BGM 受浏览器自动播放策略限制，首次点击“开始新游戏”后才解锁；全屏若由持久化设置自动恢复可能被浏览器拒绝，已捕获且不影响游戏。
- Web 构建会提示单 chunk 超过 500 kB，这是预览壳的已知警告，不影响运行。
- Nginx 默认 mime.types 不含 YAML，也不含 wav / flac；`apps/web/nginx.conf` 用正则 location 分别返回 `text/yaml`、`audio/wav`、`audio/mp4`、`audio/flac`、`audio/webm`，不要删除。
- 修改 Dockerfile 的 `COPY` 清单时，必须包含 Web 构建所需的全部 workspace `package.json`，否则 `pnpm install --frozen-lockfile` 或 `--filter @sylvie/web... build` 会失败。
