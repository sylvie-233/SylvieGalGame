import { describe, expect, it } from 'vitest';

import { formatChapterName, saveExportFilename } from '../src/save-utils';

describe('save utils', () => {
  it('resolves readable chapter names with label fallback', () => {
    const manifest = { chapters: { book_start: '第一章 · 书页之间' } };
    expect(formatChapterName(manifest, 'book_start')).toBe('第一章 · 书页之间');
    expect(formatChapterName(manifest, 'unknown')).toBe('unknown');
    expect(formatChapterName(null, 'prologue_start')).toBe('prologue_start');
    expect(formatChapterName(manifest, '')).toBe('');
  });

  it('builds full and single-slot export file names', () => {
    const date = new Date('2026-11-13T08:00:00Z');
    expect(saveExportFilename(undefined, date)).toBe('sylvie-saves-2026-11-13.json');
    expect(saveExportFilename(['save:slot:1'], date)).toBe('sylvie-save-slot-1-2026-11-13.json');
    expect(saveExportFilename(['save:auto:2'], date)).toBe('sylvie-save-auto-2-2026-11-13.json');
    expect(saveExportFilename([], date)).toBe('sylvie-saves-2026-11-13.json');
  });
});
