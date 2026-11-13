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
  quit?: () => void;
  appVersion?: string;
}
