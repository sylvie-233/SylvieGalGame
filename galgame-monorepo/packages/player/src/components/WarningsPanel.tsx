import { useState } from 'react';

import { Modal } from './Modal';

interface WarningsPanelProps {
  /** 脚本诊断警告，来自 Zustand 的 warnings。 */
  warnings: string[];
  onClose: () => void;
}

/**
 * 脚本警告面板：列出引擎加载 / 运行时收集的诊断信息。
 * 警告不阻断游戏；支持一键复制全部内容，复制成功后按钮短暂显示“已复制”。
 */
export function WarningsPanel({ warnings, onClose }: WarningsPanelProps) {
  // 复制反馈只是按钮文案的临时状态，2 秒后自动复位。
  const [copied, setCopied] = useState(false);

  /** 按序号拼接全部警告并写入剪贴板。 */
  const copyAll = (): void => {
    const text = warnings.map((warning, index) => `${index + 1}. ${warning}`).join('\n');
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => console.warn('[播放器] 无法复制诊断信息'));
  };

  return (
    <Modal title={`脚本警告（${warnings.length}）`} onClose={onClose} wide>
      <p className="mb-4 mt-0 text-[13px] leading-[1.7] tracking-[0.04em] text-sg-muted">
        游戏仍可继续，以下问题通常来自剧本、资源缺失或表达式错误。
      </p>
      <div className="sg-scroll flex max-h-[56vh] flex-col gap-2.5 overflow-y-auto pr-2">
        {warnings.map((warning, index) => (
          <div
            className="rounded-[3px] border border-sg-ink/10 bg-white/[0.025] px-3.5 py-3 text-xs leading-[1.75] text-sg-ink/75"
            key={`${index}-${warning}`}
          >
            <span className="mr-2 tabular-nums text-sg-dim">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="whitespace-pre-wrap">{warning}</span>
          </div>
        ))}
      </div>
      <div className="mt-5 flex justify-end">
        <button
          type="button"
          className="rounded-sm border border-sg-line bg-sg-accent/10 px-5 py-2 text-[13px] tracking-[0.12em] transition-colors hover:border-sg-line-strong hover:bg-sg-accent/20"
          onClick={copyAll}
        >
          {copied ? '已复制' : '复制全部'}
        </button>
      </div>
    </Modal>
  );
}
