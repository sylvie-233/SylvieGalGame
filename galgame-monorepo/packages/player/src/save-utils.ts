import type { GameManifest } from '@sylvie/types';

/**
 * 把存档里的章节 / label 解析成 manifest 登记的展示名。
 * manifest 尚未加载或未登记该章节时原样返回 label，便于排查剧本问题。
 */
export function formatChapterName(
  manifest: Pick<GameManifest, 'chapters'> | null,
  chapter: string,
): string {
  if (!chapter) return '';
  return manifest?.chapters[chapter] ?? chapter;
}

/** 统一存档备注：去掉首尾空白并截断到 maxLength（默认 40），与输入框上限一致。 */
export function normalizeSaveNote(value: string, maxLength = 40): string {
  return value.trim().slice(0, maxLength);
}

/**
 * 生成存档导出文件名：`sylvie-<内容>-YYYY-MM-DD.json`。
 * 单档导出时把原始键名（如 `save:slot:3`）中的非字母数字字符替换为 `-`；
 * 多档或全量导出使用 `sylvie-saves-` 前缀。
 */
export function saveExportFilename(keys?: string[], now = new Date()): string {
  const stamp = now.toISOString().slice(0, 10);
  const single = keys?.[0]?.replace(/[^a-z0-9]+/gi, '-');
  return single ? `sylvie-${single}-${stamp}.json` : `sylvie-saves-${stamp}.json`;
}
