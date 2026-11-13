export interface GalleryCgEntry {
  id: string;
  image: string;
  title: string;
}

export interface GalleryBgmEntry {
  id: string;
  track: string;
  title: string;
}

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

export const GALLERY_KEY = 'meta:gallery';

export function emptyGalleryUnlocks(): GalleryUnlocks {
  return { cgs: [], bgms: [], endings: [] };
}

/** 容错读取图鉴记录：未知字段忽略，数组去重。 */
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
