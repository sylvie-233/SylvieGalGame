import type { FontChoice, GameSettings, PlayerPlatform } from '@sylvie/types';

import { Modal } from './Modal';

interface SettingsPanelProps {
  /** 当前设置；面板不持有副本，每次修改都通过 onChange 回写。 */
  settings: GameSettings;
  /** 修改后的完整设置；GameApp 负责即时应用与防抖持久化。 */
  onChange: (settings: GameSettings) => void;
  onClose: () => void;
  /** 用于切换全屏的宿主能力。 */
  platform: PlayerPlatform;
}

interface RangeRowProps {
  /** 左侧标签。 */
  label: string;
  /** 当前值。 */
  value: number;
  min: number;
  max: number;
  /** 步进，默认 1。 */
  step?: number;
  /** 右侧展示文案（已格式化，如百分比 / 秒）。 */
  display: string;
  /** 拖动时的回调，参数已转为数字。 */
  onChange: (value: number) => void;
}

/** 设置面板中的一行滑块：标签、range 输入与格式化后的当前值。 */
function RangeRow({ label, value, min, max, step = 1, display, onChange }: RangeRowProps) {
  return (
    <label className="grid grid-cols-[86px_1fr_86px] items-center gap-4 py-1 max-[900px]:grid-cols-[70px_1fr_70px] max-[900px]:gap-2.5">
      <span className="text-[13px] tracking-[0.08em] text-sg-muted">{label}</span>
      <input
        type="range"
        className="w-full accent-sg-accent"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="text-right text-xs tabular-nums text-sg-ink">{display}</span>
    </label>
  );
}

/** 可选字体，实际字形由根节点 `data-font` 对应的 CSS 决定。 */
const FONT_OPTIONS: Array<{ value: FontChoice; label: string }> = [
  { value: 'serif', label: '宋体衬线' },
  { value: 'sans', label: '黑体无衬线' },
  { value: 'kai', label: '楷体' },
];

/** 分组标题的共享样式。 */
const GROUP_TITLE = 'mt-2.5 mb-0 text-xs font-medium tracking-[0.26em] text-sg-gold uppercase';

/**
 * 设置面板：音量、打字速度 / 自动等待、字体与全屏。
 * 所有修改都向上合并成完整 GameSettings，由 GameApp 即时应用并防抖落盘；
 * 全屏还会额外调用平台能力，持久化的 fullscreen 仅用于下次启动恢复。
 */
export function SettingsPanel({ settings, onChange, onClose, platform }: SettingsPanelProps) {
  /** 以当前设置为基准合并单个字段。 */
  const update = (patch: Partial<GameSettings>) => onChange({ ...settings, ...patch });

  /** 切换全屏：先写设置，再请求宿主；平台不支持时仅保留偏好。 */
  const toggleFullscreen = () => {
    const next = !settings.fullscreen;
    update({ fullscreen: next });
    void platform.setFullscreen?.(next);
  };

  return (
    <Modal title="设置" onClose={onClose}>
      <div className="flex flex-col gap-3.5">
        <h3 className={GROUP_TITLE}>音量</h3>
        <RangeRow
          label="BGM"
          value={settings.bgmVolume}
          min={0}
          max={1}
          step={0.01}
          display={`${Math.round(settings.bgmVolume * 100)}%`}
          onChange={(value) => update({ bgmVolume: value })}
        />
        <RangeRow
          label="音效"
          value={settings.seVolume}
          min={0}
          max={1}
          step={0.01}
          display={`${Math.round(settings.seVolume * 100)}%`}
          onChange={(value) => update({ seVolume: value })}
        />
        <RangeRow
          label="语音"
          value={settings.voiceVolume}
          min={0}
          max={1}
          step={0.01}
          display={`${Math.round(settings.voiceVolume * 100)}%`}
          onChange={(value) => update({ voiceVolume: value })}
        />

        <h3 className={GROUP_TITLE}>文本</h3>
        <RangeRow
          label="打字速度"
          value={settings.textSpeed}
          min={5}
          max={120}
          display={`${settings.textSpeed} 字/秒`}
          onChange={(value) => update({ textSpeed: value })}
        />
        <RangeRow
          label="自动等待"
          value={settings.autoDelay}
          min={200}
          max={5000}
          step={100}
          display={`${(settings.autoDelay / 1000).toFixed(1)} 秒`}
          onChange={(value) => update({ autoDelay: value })}
        />

        <h3 className={GROUP_TITLE}>显示</h3>
        <div className="grid grid-cols-[86px_1fr] items-center gap-4 max-[900px]:grid-cols-[70px_1fr] max-[900px]:gap-2.5">
          <span className="text-[13px] tracking-[0.08em] text-sg-muted">字体</span>
          <div className="flex gap-1.5">
            {FONT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`flex-1 rounded-sm border px-2.5 py-[9px] text-xs tracking-[0.08em] transition-colors ${
                  settings.font === option.value
                    ? 'border-sg-line-strong bg-sg-accent/10 text-sg-accent-strong'
                    : 'border-sg-ink/10 bg-white/[0.03] text-sg-muted hover:border-sg-line hover:text-sg-ink'
                }`}
                onClick={() => update({ font: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="mt-1 self-start rounded-sm border border-sg-line bg-sg-accent/10 px-[22px] py-2.5 text-[13px] tracking-[0.12em] transition-colors hover:border-sg-line-strong hover:bg-sg-accent/20"
          onClick={toggleFullscreen}
        >
          {settings.fullscreen ? '退出全屏' : '进入全屏'}
        </button>

        <p className="mt-3 border-t border-sg-ink/10 pt-3.5 text-xs leading-[1.8] tracking-[0.03em] text-sg-dim">
          快捷键：空格 / 回车推进 · 按住 Ctrl 跳过已读 · A 自动播放 · H / 右键隐藏界面 · Esc 菜单 ·
          Ctrl+S 快速存档 · Ctrl+L 快速读档
        </p>
      </div>
    </Modal>
  );
}
