/** 图鉴中的一张 CG；id 用于和 GalleryUnlocks.cgs 对应。 */
export interface GalleryCgEntry {
  id: string;
  image: string;
  title: string;
}

/** 图鉴中的一首 BGM；id 用于和 GalleryUnlocks.bgms 对应。 */
export interface GalleryBgmEntry {
  id: string;
  track: string;
  title: string;
}

/** game.yaml 中 gallery 段的解析结果，只描述可展示内容，不包含解锁状态。 */
export interface GalleryConfig {
  cgs: GalleryCgEntry[];
  bgms: GalleryBgmEntry[];
}

/** 图鉴解锁记录，与存档解耦，单独写入 meta:gallery。 */
export interface GalleryUnlocks {
  cgs: string[];
  bgms: string[];
  endings: string[];
}

/** 图鉴解锁记录的存储键；与存档分离，重开新游戏不会清空。 */
export const GALLERY_KEY = 'meta:gallery';

/** 创建空的解锁记录；每次返回新数组，避免共享可变状态。 */
export function emptyGalleryUnlocks(): GalleryUnlocks {
  return { cgs: [], bgms: [], endings: [] };
}

/**
 * 容错读取图鉴记录：未知字段忽略，数组去重，非字符串项丢弃。
 * 用于兼容旧数据或手改文件，单条脏数据不会导致整份图鉴丢失。
 */
export function normalizeGalleryUnlocks(value: unknown): GalleryUnlocks {
  if (typeof value !== 'object' || value === null) return emptyGalleryUnlocks();
  const record = value as Record<string, unknown>;
  const read = (key: string): string[] => {
    const list = record[key];
    if (!Array.isArray(list)) return [];
    return [...new Set(list.filter((item): item is string => typeof item === 'string'))];
  };
  return { cgs: read('cgs'), bgms: read('bgms'), endings: read('endings') };
}
