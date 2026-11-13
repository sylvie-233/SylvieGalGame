export interface DesktopConfig {
  appVersion: string;
  platform: NodeJS.Platform;
  isPackaged: boolean;
  gameRoot: string;
  storagePath: string;
  logDir: string;
}

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
    sylvieGame?: SylvieDesktopApi;
  }
}
