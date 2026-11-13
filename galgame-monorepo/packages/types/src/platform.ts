export interface AssetHost {
  /** 读取相对游戏资源根目录的文本文件。 */
  readText(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}

export interface KeyValueStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface EngineHost {
  assets: AssetHost;
  storage: KeyValueStorage;
  onWarning?: (message: string) => void;
}

/** 播放器（React 层）所需的平台能力，由 Electron / Web 外壳注入。 */
export interface PlayerPlatform {
  readText(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  /** 把资源相对路径转换成可被 <img>/<audio> 使用的 URL。 */
  assetUrl(path: string): string;
  storage: KeyValueStorage;
  captureScreenshot?: () => Promise<string | null>;
  setFullscreen?: (value: boolean) => Promise<boolean>;
  getFullscreen?: () => Promise<boolean>;
  /** 宿主文件对话框导出文本文件；返回是否实际写入。 */
  saveTextFile?: (filename: string, content: string) => Promise<boolean>;
  /** 宿主文件对话框选择文本文件；取消时返回 null。 */
  openTextFile?: () => Promise<string | null>;
  quit?: () => void;
  appVersion?: string;
  /** 桌面端运行日志目录；Web 端为空。 */
  logPath?: string;
  /** 桌面端存档文件路径；Web 端为空。 */
  storagePath?: string;
}
