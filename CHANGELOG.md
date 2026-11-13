# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。
版本号以 `galgame-monorepo/package.json` 为准，发布前执行 `pnpm version:set <版本>`。

## [Unreleased]

### 计划中

- T3 跳过策略、T4 语音感知 Auto、U2 设置增强、U7 应用内键位帮助。

### Changed

- 重写示例剧本为《一百二十日元的回声》：受日式短篇 Galgame「120 円」系列启发，围绕一枚 120 元硬币展开，5 个场景、3 条分支、3 个结局，共 142 句文本。
- 新增夜间街道、末班车站、旧音乐教室、天台等背景与 5 张 CG、4 版立绘；新增 3 首 BGM、硬币 / 易拉罐等音效，并同步更新图鉴、章节与结局元数据。

### Fixed

- `pnpm validate` 的 Schema 错误此前被局部变量遮蔽，实际不会导致失败；现在会正确阻断。
- Web 内容中间件支持 `Range: bytes=-N` 的后缀语义，不再退化为全量响应。
- Web 导入存档取消文件选择时，Promise 会正常以 `null` 结束。
- `version:set` 在 `game.yaml` 缺少 `version` 时先做前置检查，避免留下半套版本号。

## [0.1.0] - 2026-11-13

首个可玩版本：YAML 驱动的视觉小说播放器，包含 Electron 桌面壳、Web 预览壳与 Docker 静态站。

### Added

- **引擎**：YAML 清单 / 场景解析、递归 imports、指针 + 阻塞调度、变量与条件表达式、文本插值、回滚历史、缺失资源与跳转校验。
- **播放器**：分层舞台、淡入淡出 / 溶解 / 滑动 / 擦除转场、震屏 / 闪屏、立绘缩放 / 层级 / 翻转、打字机、Auto、仅跳过已读、Backlog、选项键盘操作。
- **存档**：20 个手动槽位、快速存档、3 份自动存档轮换、截图缩略图、备注编辑、BGM 位置续播、v1/v2 → v3 自动迁移、全量 / 单档 JSON 导入导出。
- **内容能力**：`set` 表达式与选项赋值、稳定已读 id、章节展示名、结局元数据与 `ending` 指令、回忆图鉴（CG / BGM / 结局）。
- **桌面端**：Electron 自定义协议、CSP、单实例锁、窗口尺寸 / 位置记忆、系统文件对话框、运行日志落盘与诊断路径提示。
- **Web 端**：IndexedDB（localStorage 回退）存档、持久化存储申请、响应式预览壳、按需加载面板与截图库。
- **工程**：pnpm workspace + Turborepo、ESLint 9、Prettier、Vitest（engine-core + player）、YAML Schema、内容体检、桌面 CDP 冒烟、Web 无头 Chrome 冒烟、GitHub Actions CI、Docker Compose 与内容热替换。

### Changed

- 未签名桌面产物默认跳过代码签名；设置 `WINDOWS_CERTIFICATE_FILE` / `WINDOWS_CERTIFICATE_PASSWORD` 后自动签名 exe 与 NSIS 安装包。

### Known issues

- NSIS 安装包未签名时 Windows SmartScreen 可能提示。
- 回滚历史仅存在当前会话内存中，不写入存档。
