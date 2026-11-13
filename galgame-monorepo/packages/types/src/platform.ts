/**
 * 宿主平台能力接口。
 *
 * engine-core 与 player 只依赖这些抽象，不直接访问文件系统、localStorage
 * 或 Electron API；Electron / Web 外壳在启动时注入具体实现。
 */
import type { MinigameLoaderRegistry } from './minigame';

/** 引擎读取剧本与资源文本的最小接口。 */
export interface AssetHost {
  /** 读取相对游戏资源根目录的文本文件。 */
  readText(path: string): Promise<string>;
  /** 判断资源是否存在，用于启动时校验。 */
  exists(path: string): Promise<boolean>;
}

/** 最小 KV 存储抽象；值统一为字符串，复杂结构由调用方序列化。 */
export interface KeyValueStorage {
  /** 读取键；不存在时返回 null。 */
  get(key: string): Promise<string | null>;
  /** 写入或覆盖键。 */
  set(key: string, value: string): Promise<void>;
  /** 删除键；不存在的键应视为成功。 */
  delete(key: string): Promise<void>;
}

/** engine-core 初始化所需的能力集合。 */
export interface EngineHost {
  assets: AssetHost;
  storage: KeyValueStorage;
  /** 脚本 / 资源警告回调；缺省时引擎退化为 console.warn。 */
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
  /**
   * 按 id 注册的剧情小游戏 loader。
   * 播放器只按 `minigame.id` 查找并挂载，未注册时显示「小游戏未接入」与跳过入口。
   * 具体实现放在独立包中，避免播放器或引擎依赖 Phaser。
   */
  minigames?: MinigameLoaderRegistry;
  quit?: () => void;
  appVersion?: string;
  /** 桌面端运行日志目录；Web 端为空。 */
  logPath?: string;
  /** 桌面端存档文件路径；Web 端为空。 */
  storagePath?: string;
}
