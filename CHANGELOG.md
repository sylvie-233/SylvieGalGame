# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。
版本号以 `galgame-monorepo/package.json` 为准，发布前执行 `pnpm version:set <版本>`。

## [Unreleased]

### 计划中

- T3 跳过策略、T4 语音感知 Auto、U2 设置增强、U7 应用内键位帮助。

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
