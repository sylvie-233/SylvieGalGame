import type { GalleryUnlocks, GameManifest } from '@sylvie/types';
import { useState } from 'react';

import { Modal } from './Modal';

interface GalleryPanelProps {
  /** 清单提供图鉴条目与结局定义。 */
  manifest: GameManifest;
  /** 已解锁的 CG / BGM / 结局 id，来自 `meta:gallery`。 */
  unlocks: GalleryUnlocks;
  /** 内容包相对路径 → 可访问 URL。 */
  assetUrl: (path: string) => string;
  /** 试听 BGM；传 null 表示停止并恢复原 BGM。 */
  onPreviewBgm: (track: string | null) => void;
  onClose: () => void;
}

/** 图鉴的三个分页。 */
type GalleryTab = 'cg' | 'bgm' | 'endings';

const TABS: Array<{ key: GalleryTab; label: string }> = [
  { key: 'cg', label: 'CG 鉴赏' },
  { key: 'bgm', label: '音乐鉴赏' },
  { key: 'endings', label: '结局' },
];

/** 分页按钮的共享样式。 */
const TAB_BUTTON =
  'rounded-sm border px-4 py-2 text-[13px] tracking-[0.12em] transition-colors focus-visible:outline-none';

/**
 * 回忆图鉴面板。
 *
 * 条目来自 manifest（CG / BGM / 结局定义），可见性来自 `unlocks`（meta:gallery）：
 * - CG 分页可点开已解锁大图，未解锁仅显示暗色占位；
 * - BGM 分页可试听 / 停止，关闭面板会停止试听并恢复原曲；
 * - 结局分页对未达成项隐藏标题与描述。
 */
export function GalleryPanel({
  manifest,
  unlocks,
  assetUrl,
  onPreviewBgm,
  onClose,
}: GalleryPanelProps) {
  const [tab, setTab] = useState<GalleryTab>('cg');
  const [selectedCg, setSelectedCg] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  const unlockedCgs = new Set(unlocks.cgs);
  const unlockedBgms = new Set(unlocks.bgms);
  const unlockedEndings = new Set(unlocks.endings);

  const selected = manifest.gallery.cgs.find((entry) => entry.id === selectedCg) ?? null;

  /** 试听开关：再次点击同一曲目即停止，并让外层恢复原本的 BGM。 */
  const toggleBgm = (id: string, track: string) => {
    if (playing === id) {
      setPlaying(null);
      onPreviewBgm(null);
      return;
    }
    setPlaying(id);
    onPreviewBgm(track);
  };

  /** 关闭前若仍在试听，先停止并恢复原曲，避免图鉴 BGM 残留到游戏内。 */
  const close = () => {
    if (playing) onPreviewBgm(null);
    onClose();
  };

  return (
    <Modal title="回忆图鉴" onClose={close} wide>
      <div className="mb-4 flex gap-2">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={`${TAB_BUTTON} ${
              tab === entry.key
                ? 'border-sg-line-strong bg-sg-accent/12 text-sg-accent-strong'
                : 'border-sg-ink/10 bg-white/[0.03] text-sg-muted hover:border-sg-line hover:text-sg-ink'
            }`}
            onClick={() => setTab(entry.key)}
          >
            {entry.label}
          </button>
        ))}
        <span className="ml-auto self-center text-[11px] tracking-[0.1em] text-sg-dim">
          {manifest.gallery.cgs.length} 张 CG · {manifest.gallery.bgms.length} 首 BGM ·{' '}
          {manifest.endings.length} 个结局
        </span>
      </div>

      {tab === 'cg' && (
        <div className="flex flex-col gap-3">
          {selected && unlockedCgs.has(selected.id) ? (
            <div className="overflow-hidden rounded-sm border border-sg-line/60 bg-black/40">
              <img
                className="max-h-[42vh] w-full object-contain"
                src={assetUrl(selected.image)}
                alt={selected.title}
                draggable={false}
              />
            </div>
          ) : (
            <p className="m-0 text-[12px] leading-[1.7] tracking-[0.06em] text-sg-dim">
              点击已解锁的 CG 查看大图；尚未经历的片段会保持暗色。
            </p>
          )}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {manifest.gallery.cgs.map((entry) => {
              const unlocked = unlockedCgs.has(entry.id);
              return (
                <button
                  key={entry.id}
                  type="button"
                  disabled={!unlocked}
                  className={`group flex aspect-video items-center justify-center overflow-hidden rounded-sm border transition-colors focus-visible:outline-none ${
                    unlocked
                      ? 'cursor-pointer border-sg-ink/10 bg-black/30 hover:border-sg-line-strong'
                      : 'cursor-default border-sg-ink/10 bg-white/[0.02] opacity-45'
                  } ${selectedCg === entry.id && unlocked ? 'border-sg-line-strong' : ''}`}
                  onClick={() => setSelectedCg(entry.id)}
                >
                  {unlocked ? (
                    <img
                      className="h-full w-full object-cover"
                      src={assetUrl(entry.image)}
                      alt={entry.title}
                      draggable={false}
                    />
                  ) : (
                    <span className="text-[11px] tracking-[0.18em] text-sg-ink/25">未解锁</span>
                  )}
                </button>
              );
            })}
          </div>
          {manifest.gallery.cgs.length === 0 && (
            <p className="m-0 text-[12px] text-sg-dim">内容包尚未登记 CG。</p>
          )}
        </div>
      )}

      {tab === 'bgm' && (
        <div className="flex flex-col gap-1.5">
          {manifest.gallery.bgms.map((entry) => {
            const unlocked = unlockedBgms.has(entry.id);
            const isPlaying = playing === entry.id;
            return (
              <div
                key={entry.id}
                className={`flex items-center gap-3 rounded-sm border px-3.5 py-3 transition-colors ${
                  unlocked
                    ? 'border-sg-ink/10 bg-white/[0.03]'
                    : 'border-sg-ink/10 bg-white/[0.015] opacity-45'
                }`}
              >
                <span className="w-8 text-center text-[11px] tabular-nums text-sg-accent/70">
                  {String(manifest.gallery.bgms.indexOf(entry) + 1).padStart(2, '0')}
                </span>
                <span className="flex-1 truncate text-[13px] tracking-[0.08em] text-sg-ink/85">
                  {unlocked ? entry.title : '未解锁'}
                </span>
                <button
                  type="button"
                  disabled={!unlocked}
                  className={`rounded-sm border px-3 py-1 text-[11px] tracking-[0.1em] transition-colors focus-visible:outline-none ${
                    unlocked
                      ? 'border-sg-line bg-sg-accent/10 text-sg-ink hover:border-sg-line-strong'
                      : 'cursor-default border-sg-ink/10 text-sg-ink/25'
                  }`}
                  onClick={() => toggleBgm(entry.id, entry.track)}
                >
                  {isPlaying ? '停止' : '试听'}
                </button>
              </div>
            );
          })}
          {manifest.gallery.bgms.length === 0 && (
            <p className="m-0 text-[12px] text-sg-dim">内容包尚未登记 BGM。</p>
          )}
        </div>
      )}

      {tab === 'endings' && (
        <div className="flex flex-col gap-2">
          {manifest.endings.map((ending) => {
            const unlocked = unlockedEndings.has(ending.id);
            return (
              <div
                key={ending.id}
                className={`rounded-sm border px-4 py-3 ${
                  unlocked
                    ? 'border-sg-line/60 bg-sg-accent/5'
                    : 'border-sg-ink/10 bg-white/[0.015]'
                }`}
              >
                <strong className="block text-[13px] font-normal tracking-[0.12em] text-sg-ink/90">
                  {unlocked ? ending.title : '？？？'}
                </strong>
                <span className="mt-1 block text-[12px] leading-[1.7] tracking-[0.04em] text-sg-dim">
                  {unlocked ? ending.description || '已达成。' : '尚未抵达这个结局。'}
                </span>
              </div>
            );
          })}
          {manifest.endings.length === 0 && (
            <p className="m-0 text-[12px] text-sg-dim">内容包尚未登记结局。</p>
          )}
        </div>
      )}
    </Modal>
  );
}
