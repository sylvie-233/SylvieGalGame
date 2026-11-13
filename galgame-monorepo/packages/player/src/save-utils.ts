import type { GameManifest } from '@sylvie/types';

/** 把存档里的 label 解析成 manifest 登记的展示名。 */
export function formatChapterName(
  manifest: Pick<GameManifest, 'chapters'> | null,
  chapter: string,
): string {
  if (!chapter) return '';
  return manifest?.chapters[chapter] ?? chapter;
}

/** 生成存档导出文件名；单档导出时带上原始键名。 */
export function saveExportFilename(keys?: string[], now = new Date()): string {
  const stamp = now.toISOString().slice(0, 10);
  const single = keys?.[0]?.replace(/[^a-z0-9]+/gi, '-');
  return single ? `sylvie-${single}-${stamp}.json` : `sylvie-saves-${stamp}.json`;
}
