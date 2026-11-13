/** 主进程通过 `game:get-config` 返回的桌面环境信息，供播放器展示与诊断。 */
export interface DesktopConfig {
  appVersion: string;
  platform: NodeJS.Platform;
  /** 是否为打包产物；开发模式下播放器可显示额外调试信息。 */
  isPackaged: boolean;
  /** 当前生效的游戏内容目录（环境变量 > resources/game > 仓库源码目录）。 */
  gameRoot: string;
  /** 存档文件绝对路径，设置页用于提示用户备份位置。 */
  storagePath: string;
  /** 运行日志目录，设置页用于提示排查路径。 */
  logDir: string;
}

/**
 * preload 暴露到 `window.sylvieGame` 的窄接口。
 * 所有方法都经由 IPC 转到主进程，因此参数与返回值必须是可结构化克隆的简单类型。
 */
export interface SylvieDesktopApi {
  getConfig(): Promise<DesktopConfig>;
  readText(relativePath: string): Promise<string | null>;
  exists(relativePath: string): Promise<boolean>;
  assetUrl(relativePath: string): string;
  storageGet(key: string): Promise<string | null>;
  storageSet(key: string, value: string): Promise<void>;
  storageDelete(key: string): Promise<void>;
  captureScreenshot(): Promise<string | null>;
  setFullscreen(value: boolean): Promise<boolean>;
  getFullscreen(): Promise<boolean>;
  saveTextFile(filename: string, content: string): Promise<boolean>;
  openTextFile(): Promise<string | null>;
  quit(): Promise<void>;
}

declare global {
  interface Window {
    /** 仅在 Electron 渲染进程中存在；Web 预览壳使用 window.sylvieWeb。 */
    sylvieGame?: SylvieDesktopApi;
  }
}
