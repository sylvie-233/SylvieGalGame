interface QuickBarProps {
  auto: boolean;
  skip: boolean;
  onToggleAuto: () => void;
  onToggleSkip: () => void;
  onBacklog: () => void;
  onSave: () => void;
  onLoad: () => void;
  onMenu: () => void;
}

const BASE_BUTTON =
  'rounded-sm px-2.5 py-1.5 text-xs tracking-[0.14em] transition-colors hover:bg-sg-accent/10 hover:text-sg-accent-strong focus-visible:outline-none';

export function QuickBar({
  auto,
  skip,
  onToggleAuto,
  onToggleSkip,
  onBacklog,
  onSave,
  onLoad,
  onMenu,
}: QuickBarProps) {
  return (
    <nav
      className="absolute top-[clamp(16px,2.4vh,30px)] right-[clamp(18px,2.6vw,38px)] z-40 flex items-center gap-0.5 rounded-[3px] border border-sg-line/15 bg-[#080a12]/50 px-[7px] py-[5px] opacity-60 backdrop-blur-md transition-opacity hover:opacity-100 focus-within:opacity-100"
      aria-label="快捷操作"
      data-ui-chrome
    >
      <button
        type="button"
        className={`${BASE_BUTTON} ${auto ? 'bg-sg-accent/10 text-sg-accent-strong' : 'text-sg-ink/70'}`}
        onClick={onToggleAuto}
        title="自动播放（A）"
      >
        自动
      </button>
      <button
        type="button"
        className={`${BASE_BUTTON} ${skip ? 'bg-sg-accent/10 text-sg-accent-strong' : 'text-sg-ink/70'}`}
        onClick={onToggleSkip}
        title="跳过已读（Ctrl）"
      >
        跳过
      </button>
      <span className="mx-[3px] h-4 w-px bg-sg-ink/10" aria-hidden="true" />
      <button type="button" className={`${BASE_BUTTON} text-sg-ink/70`} onClick={onBacklog} title="对话历史">
        历史
      </button>
      <button type="button" className={`${BASE_BUTTON} text-sg-ink/70`} onClick={onSave} title="存档（Ctrl+S）">
        存档
      </button>
      <button type="button" className={`${BASE_BUTTON} text-sg-ink/70`} onClick={onLoad} title="读档（Ctrl+L）">
        读档
      </button>
      <button type="button" className={`${BASE_BUTTON} text-sg-ink/70`} onClick={onMenu} title="菜单（Esc）">
        菜单
      </button>
    </nav>
  );
}
