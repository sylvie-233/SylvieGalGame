import type { BacklogEntry } from '@sylvie/types';
import { useEffect, useRef } from 'react';

import { Modal } from './Modal';

interface BacklogPanelProps {
  entries: BacklogEntry[];
  onClose: () => void;
  onReplay: (voice: string) => void;
}

export function BacklogPanel({ entries, onClose, onReplay }: BacklogPanelProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [entries.length]);

  return (
    <Modal title="对话历史" onClose={onClose} wide>
      {entries.length === 0 ? (
        <p className="m-0 text-[13px] leading-[1.7] tracking-[0.04em] text-sg-muted">
          还没有任何对话记录。
        </p>
      ) : (
        <div className="sg-scroll flex max-h-[58vh] flex-col gap-[18px] overflow-y-auto pr-2">
          {entries.map((entry, index) => (
            <div
              className="border-b border-sg-ink/[0.07] pb-3.5"
              key={`${entry.id}-${index}`}
            >
              <div className="mb-[7px] flex items-center gap-3">
                <span className="font-dialogue text-sm tracking-[0.12em] text-sg-accent">
                  {entry.speaker || '旁白'}
                </span>
                {entry.voice && (
                  <button
                    type="button"
                    className="rounded-sm border border-sg-accent/20 bg-transparent px-2 py-0.5 text-[11px] text-sg-muted transition-colors hover:border-sg-line hover:text-sg-accent-strong"
                    onClick={() => onReplay(entry.voice as string)}
                    title="回放语音"
                  >
                    ▶ 语音
                  </button>
                )}
              </div>
              <p className="m-0 whitespace-pre-wrap font-dialogue text-sm leading-[1.85] text-sg-ink/75">
                {entry.text}
              </p>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </Modal>
  );
}
