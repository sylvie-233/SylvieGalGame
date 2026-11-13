import {
  createSaveExport,
  deleteSave,
  importSaveExport,
  readAutoSaves,
  readManualSaves,
  readSave,
  writeSave,
  type AutoSaveEntry,
  type GameEngine,
  type ManualSaveEntry,
} from '@sylvie/engine-core';
import {
  MANUAL_SAVE_COUNT,
  SAVE_KEYS,
  manualSaveKey,
  type PlayerPlatform,
  type SaveData,
} from '@sylvie/types';

import { useCallback, useEffect, useState } from 'react';

import { formatChapterName, normalizeSaveNote, saveExportFilename } from '../save-utils';
import { useConfirm } from './ConfirmDialog';
import { Modal } from './Modal';

interface SaveLoadPanelProps {
  mode: 'save' | 'load';
  engine: GameEngine;
  platform: PlayerPlatform;
  onLoad: (data: SaveData) => void;
  onClose: () => void;
  notify: (message: string) => void;
  /** 当前 BGM 播放位置（秒），写入存档以便读档后继续播放。 */
  getAudioPosition: () => number;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

interface SlotCardProps {
  title: string;
  data: SaveData | null;
  mode: 'save' | 'load';
  disabled?: boolean;
  formatChapter: (chapter: string) => string;
  onActivate: () => void;
  onDelete?: () => void;
  onExport?: () => void;
}

function SlotCard({
  title,
  data,
  mode,
  disabled,
  formatChapter,
  onActivate,
  onDelete,
  onExport,
}: SlotCardProps) {
  return (
    <div
      className={`group flex flex-col gap-2 rounded-[3px] border p-2 outline-none transition-colors ${
        disabled
          ? 'cursor-default border-sg-ink/10 bg-white/[0.025] opacity-40'
          : 'cursor-pointer border-sg-ink/10 bg-white/[0.025] hover:border-sg-line hover:bg-sg-accent/5 focus-visible:border-sg-line focus-visible:bg-sg-accent/5'
      }`}
      role="button"
      data-slot={title}
      tabIndex={disabled ? -1 : 0}
      onClick={() => {
        if (!disabled) onActivate();
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate();
        }
      }}
    >
      <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-sm bg-[linear-gradient(140deg,#1a1c29,#0d0f17)]">
        {data?.screenshot ? (
          <img
            className="h-full w-full object-cover"
            src={data.screenshot}
            alt=""
            draggable={false}
          />
        ) : (
          <span className="text-[11px] tracking-[0.14em] text-sg-ink/25">
            {data ? '无快照' : '空'}
          </span>
        )}
        <span className="absolute top-1.5 left-1.5 rounded-sm bg-[#040509]/70 px-[7px] py-0.5 text-[10px] tracking-[0.08em] text-sg-ink/80">
          {title}
        </span>
        {data && (onDelete || onExport) && (
          <div className="absolute top-[5px] right-[5px] flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {onExport && (
              <button
                type="button"
                className="rounded-sm border border-sg-line bg-[#040509]/75 px-[7px] py-[3px] text-[10px] text-sg-ink/80"
                onClick={(event) => {
                  event.stopPropagation();
                  onExport();
                }}
                aria-label={`导出${title}`}
              >
                导出
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                className="rounded-sm border border-red-300/25 bg-red-950/70 px-[7px] py-[3px] text-[10px] text-red-200/85"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
                aria-label={`删除${title}`}
              >
                删除
              </button>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-0.5 px-0.5 pb-0.5 text-[11px] leading-[1.5] tabular-nums text-sg-dim">
        {data ? (
          <>
            <strong className="truncate text-xs font-normal text-sg-ink/85">
              {data.note || formatChapter(data.chapter) || '未命名进度'}
            </strong>
            <span className="truncate">{formatChapter(data.chapter) || '未知章节'}</span>
            <span>{formatTime(data.createdAt)}</span>
          </>
        ) : (
          <span className="text-sg-dim">{mode === 'save' ? '点击保存' : '空存档位'}</span>
        )}
      </div>
    </div>
  );
}

export function SaveLoadPanel({
  mode,
  engine,
  platform,
  onLoad,
  onClose,
  notify,
  getAudioPosition,
}: SaveLoadPanelProps) {
  const [manual, setManual] = useState<ManualSaveEntry[]>([]);
  const [auto, setAuto] = useState<AutoSaveEntry[]>([]);
  const [quick, setQuick] = useState<SaveData | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ key: string; existing: SaveData | null } | null>(
    null,
  );
  const [note, setNote] = useState('');
  const { confirm, dialog } = useConfirm();

  const formatChapter = (chapter: string): string =>
    formatChapterName(engine.isReady() ? engine.getManifest() : null, chapter);

  const refresh = useCallback(async () => {
    const entries = await readManualSaves(platform.storage, MANUAL_SAVE_COUNT);
    setManual(entries);
    setAuto(await readAutoSaves(platform.storage));
    setQuick(await readSave(platform.storage, SAVE_KEYS.quick));
  }, [platform.storage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const beginSave = (key: string, existing: SaveData | null) => {
    if (busy) return;
    setNote(existing?.note ?? '');
    setPending({ key, existing });
  };

  const saveTo = async (key: string, noteText: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const screenshot = platform.captureScreenshot
        ? await platform.captureScreenshot().catch(() => null)
        : null;
      const data = engine.createSave({
        screenshot,
        note: normalizeSaveNote(noteText),
        bgmPosition: getAudioPosition(),
      });
      await writeSave(platform.storage, key, data);
      await refresh();
      notify('存档已保存');
    } catch (error) {
      console.error(error);
      notify('存档保存失败');
    } finally {
      setBusy(false);
    }
  };

  const confirmSave = () => {
    if (!pending) return;
    const target = pending;
    setPending(null);
    void saveTo(target.key, note);
  };

  const remove = async (key: string) => {
    if (busy) return;
    const confirmed = await confirm('确定删除该存档吗？删除后无法恢复。', {
      title: '删除存档',
      confirmLabel: '删除',
      danger: true,
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await deleteSave(platform.storage, key);
      await refresh();
      notify('存档已删除');
    } catch (error) {
      console.error(error);
      notify('删除失败');
    } finally {
      setBusy(false);
    }
  };

  const exportKeys = async (keys?: string[]) => {
    if (busy) return;
    if (!platform.saveTextFile) {
      notify('当前环境不支持导出存档');
      return;
    }
    setBusy(true);
    try {
      const content = await createSaveExport(platform.storage, keys);
      const saved = await platform.saveTextFile(saveExportFilename(keys), content);
      notify(saved ? '存档已导出' : '已取消导出');
    } catch (error) {
      console.error(error);
      notify('导出失败');
    } finally {
      setBusy(false);
    }
  };

  const importSaves = async () => {
    if (busy) return;
    if (!platform.openTextFile) {
      notify('当前环境不支持导入存档');
      return;
    }
    setBusy(true);
    try {
      const raw = await platform.openTextFile();
      if (raw === null) return;
      const count = await importSaveExport(platform.storage, raw);
      await refresh();
      notify(count > 0 ? `已导入 ${count} 项存档数据` : '文件中没有可导入的存档');
    } catch (error) {
      console.error(error);
      notify('存档文件格式不正确');
    } finally {
      setBusy(false);
    }
  };

  const loadData = (data: SaveData) => {
    onLoad(data);
  };

  return (
    <>
      <Modal title={mode === 'save' ? '保存进度' : '读取进度'} onClose={onClose} wide>
        <p className="mb-2 text-[13px] leading-[1.7] tracking-[0.04em] text-sg-muted">
          {mode === 'save'
            ? '点击空槽位保存当前进度；点击已有存档可覆盖。'
            : '点击带快照的槽位读取进度。'}
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            className="rounded-sm border border-sg-line bg-sg-accent/10 px-3 py-1.5 text-[11px] tracking-[0.1em] text-sg-ink transition-colors hover:border-sg-line-strong disabled:opacity-40"
            onClick={() => void exportKeys()}
          >
            导出全部存档
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded-sm border border-sg-ink/15 px-3 py-1.5 text-[11px] tracking-[0.1em] text-sg-muted transition-colors hover:border-sg-line hover:text-sg-ink disabled:opacity-40"
            onClick={() => void importSaves()}
          >
            导入存档
          </button>
          <span className="text-[11px] leading-[1.6] tracking-[0.03em] text-sg-dim">
            导出包含存档、已读、设置与图鉴记录；导入会覆盖同键数据。
          </span>
        </div>

        <h3 className="mt-2.5 mb-0 text-xs font-medium tracking-[0.26em] text-sg-gold uppercase">
          特殊存档
        </h3>
        <div className="mb-2 mt-3 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {auto.map((entry) => (
            <SlotCard
              key={entry.key}
              title={entry.slot === 1 ? '自动存档' : `自动存档 ${entry.slot}`}
              data={entry.data}
              mode={mode}
              disabled={mode === 'save' || !entry.data}
              formatChapter={formatChapter}
              onActivate={() => entry.data && loadData(entry.data)}
              onExport={entry.data ? () => void exportKeys([entry.key]) : undefined}
            />
          ))}
          <SlotCard
            title="快速存档"
            data={quick}
            mode={mode}
            disabled={mode === 'save' || !quick}
            formatChapter={formatChapter}
            onActivate={() => quick && loadData(quick)}
            onDelete={() => void remove(SAVE_KEYS.quick)}
            onExport={quick ? () => void exportKeys([SAVE_KEYS.quick]) : undefined}
          />
        </div>

        <h3 className="mt-2.5 mb-0 text-xs font-medium tracking-[0.26em] text-sg-gold uppercase">
          手动存档
        </h3>
        <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
          {manual.map((entry) => (
            <SlotCard
              key={entry.slot}
              title={`${String(entry.slot).padStart(2, '0')}`}
              data={entry.data}
              mode={mode}
              disabled={busy}
              formatChapter={formatChapter}
              onActivate={() => {
                if (mode === 'save') {
                  beginSave(manualSaveKey(entry.slot), entry.data);
                } else if (entry.data) {
                  loadData(entry.data);
                }
              }}
              onDelete={() => void remove(manualSaveKey(entry.slot))}
              onExport={
                entry.data ? () => void exportKeys([manualSaveKey(entry.slot)]) : undefined
              }
            />
          ))}
        </div>
      </Modal>

      {pending && (
        <Modal
          title={pending.existing ? '覆盖存档' : '保存进度'}
          onClose={() => setPending(null)}
        >
          <p className="m-0 mb-3 text-[13px] leading-[1.7] tracking-[0.04em] text-sg-muted">
            {pending.existing
              ? '该槽位已有存档，保存后会覆盖原进度。'
              : `写入槽位 ${pending.key.split(':').pop()?.padStart(2, '0') ?? ''}。`}
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs tracking-[0.14em] text-sg-dim">备注（可选）</span>
            <input
              type="text"
              maxLength={40}
              value={note}
              autoFocus
              placeholder="例如：书页分支 · 黄昏之前"
              className="w-full rounded-sm border border-sg-ink/15 bg-black/30 px-3 py-2 text-[13px] tracking-[0.04em] text-sg-ink outline-none transition-colors placeholder:text-sg-ink/25 focus:border-sg-line-strong"
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  confirmSave();
                }
              }}
            />
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-sm border border-sg-ink/15 px-4 py-2 text-[12px] tracking-[0.12em] text-sg-muted transition-colors hover:border-sg-line hover:text-sg-ink"
              onClick={() => setPending(null)}
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-sm border border-sg-line bg-sg-accent/10 px-4 py-2 text-[12px] tracking-[0.12em] text-sg-ink transition-colors hover:border-sg-line-strong hover:bg-sg-accent/20 disabled:opacity-40"
              onClick={confirmSave}
            >
              保存
            </button>
          </div>
        </Modal>
      )}

      {dialog}
    </>
  );
}
