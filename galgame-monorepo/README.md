# 午后的回声 · SylvieGalGame

一期目标（见 [需求整理](../docs/SylvieGalGame需求整理-v1.md)）：**无编辑器、纯 YAML 脚本驱动、React + Electron、仅播放器**，跑通线性 + 分支视觉小说流程，并可打包为 Windows exe。

当前仓库已包含一个可玩的竖切版本：标题页 → 序章 → 两个分支 → 两次选择 → 两个结局，含立绘 / CG / BGM / SE / 语音、打字机、Auto、Skip（仅已读）、Backlog、20 个手动存档 + 自动/快速存档、设置面板与打包配置。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面外壳 | Electron 45 + Electron Forge 8 + Vite 8 |
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
│  └─ electron/                # 桌面外壳：主进程、preload、自定义协议、打包配置
│     ├─ src/main.ts           # 窗口、game:// 协议、IPC、存储、截图、全屏
│     ├─ src/preload.ts        # 通过 contextBridge 暴露受控 API
│     ├─ src/renderer.tsx      # 注入桌面能力并挂载播放器
│     ├─ forge.config.ts       # Forge + NSIS + extraResource
│     └─ assets/               # 应用图标（png / ico）
├─ packages/
│  ├─ types/                   # 跨包共享类型：指令、状态、存档、设置、平台能力
│  ├─ engine-core/             # 纯 TS 内核：解析、指针调度、变量、条件、已读、存档
│  │  └─ test/                 # Vitest 单元测试
│  ├─ player/                  # React 播放器：舞台、对话、选项、面板、音频、状态
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
└─ docs/剧本格式.md             # YAML 指令参考
```

业务逻辑与 UI 严格分离：

- `engine-core` 不依赖 React / DOM，只接收 `AssetHost` 与 `KeyValueStorage`，可在 Node 中直接跑（`validate-content.mjs` 就是这么做的）。
- `player` 只消费引擎快照与效果事件，UI 状态集中在 Zustand。
- `electron` 只负责桌面能力和资源加载，不包含剧情逻辑。
- `game-content` 不含代码；替换整个目录即可换一款游戏。

## 数据流

```text
game-content/game (YAML + 资源)
        │  AssetHost（Electron 自定义协议 game://）
        ▼
engine-core ──快照/效果──▶ player（Zustand + React + Motion）
        │                        │
        └──存档/设置──▶ KeyValueStorage（Electron IPC → userData/game-storage.json）
```

引擎采用指针 + 阻塞模型：`text` / `choice` / `wait` 会阻塞，`bg` / `sprite` / `cg` / `bgm` / `se` / `voice` / `set` / `if` / `jump` 即时执行。每次推进都产生不可变快照，Zustand 只保存快照引用，渲染层按阶段呈现。

## 开始开发

要求 Node ≥ 22（已在 Node 26 / pnpm 10 验证）与 pnpm 10。

```bash
pnpm install
pnpm dev          # 构建共享包并启动 Electron（Vite 开发服务器）
```

常用命令：

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 构建 `player` 依赖后启动桌面应用 |
| `pnpm build` | Turbo 构建全部包 |
| `pnpm lint` | 全仓 ESLint 检查（`--max-warnings 0`） |
| `pnpm typecheck` | 全仓 TypeScript 检查 |
| `pnpm test` | 引擎单元测试（Vitest） |
| `pnpm validate` | 加载真实剧本、跑通两条分支、检查资源与脚本警告 |
| `pnpm assets` | 重新生成占位美术与音频 |
| `pnpm package` | 输出免安装目录 `apps/electron/out/SylvieGalGame-win32-x64/` |
| `pnpm make` | 通过 NSIS 生成安装包 `apps/electron/out/make/` |
| `pnpm smoke` | 启动已打包产物，自动验证标题 / 分支 / 选项 / 菜单 / 存读档 / 设置并截图到 `scripts/.smoke/`（需先 `pnpm package`，或把 exe 路径作为参数传入） |

> 若终端导出了 `ELECTRON_RUN_AS_NODE=1`，Electron 会以纯 Node 模式启动并报 `bad option`。运行前先 `unset ELECTRON_RUN_AS_NODE`；`pnpm smoke` 已自动处理。

## 内容与代码分离

剧本和资源全部位于 [packages/game-content/game](packages/game-content/game)：

- 开发时：Electron 直接读取该目录（`SYLVIE_GAME_ROOT` 可覆盖）。
- 打包时：Forge 通过 `extraResource` 把整个 `game` 目录复制到 `resources/game`，与 `app.asar` 分离。替换 `resources/game` 即可在不重新编译代码的情况下更新剧情和素材。

替换内容后至少运行一次：

```bash
pnpm validate
```

它会解析所有场景、检查 `label` / 跳转 / 表达式 / 资源存在性，并实际走通两条分支；有任何警告都会以非零码退出。

## 快捷键

| 按键 | 行为 |
| --- | --- |
| 空格 / 回车 / 点击 | 打字中：立即显示全文；等待中：推进 |
| `A` | 切换 Auto |
| `Ctrl` | 切换 Skip（遇到未读文本自动停止） |
| `Esc` | 打开 / 关闭游戏内菜单 |
| `Ctrl+S` / `Ctrl+L` | 快速存档 / 快速读档 |

## 存档

- 手动槽位 20 个，另有自动存档与快速存档。
- 存档内容：场景与指针、全部变量、图层状态、BGM、已读标记、Backlog、章节备注、截图缩略图。
- 桌面端统一写入 `userData/game-storage.json`（Windows 下通常位于 `%APPDATA%\SylvieGalGame\`）。

## 一期边界

- 只有淡入淡出转场，没有擦除 / 滑动 / 粒子。
- 资源为松散文件，未做加密或压缩。
- 脚本错误只输出控制台警告，没有可视化报错面板。
- 占位美术 / 音频由 `scripts/generate-assets.mjs` 生成，用于验证流程；可直接替换为正式素材。
