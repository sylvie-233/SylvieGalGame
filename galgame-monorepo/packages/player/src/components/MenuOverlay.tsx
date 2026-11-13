import { motion } from 'motion/react';

import { Modal } from './Modal';

interface MenuOverlayProps {
  onResume: () => void;
  onSave: () => void;
  onLoad: () => void;
  onSettings: () => void;
  onBackToTitle: () => void;
  onQuit?: () => void;
}

export function MenuOverlay({
  onResume,
  onSave,
  onLoad,
  onSettings,
  onBackToTitle,
  onQuit,
}: MenuOverlayProps) {
  const items = [
    { label: '继续游戏', action: onResume, danger: false },
    { label: '保存进度', action: onSave, danger: false },
    { label: '读取进度', action: onLoad, danger: false },
    { label: '设置', action: onSettings, danger: false },
    { label: '返回标题', action: onBackToTitle, danger: true },
    ...(onQuit ? [{ label: '退出游戏', action: onQuit, danger: true }] : []),
  ];

  return (
    <Modal title="菜单" onClose={onResume}>
      <nav className="flex flex-col gap-1">
        {items.map((item, index) => (
          <motion.button
            key={item.label}
            type="button"
            className={`border-b border-sg-ink/[0.06] bg-transparent px-2.5 py-[13px] text-left text-[15px] tracking-[0.18em] transition-colors focus-visible:outline-none ${
              item.danger
                ? 'text-[#f0aaaa]/70 hover:bg-sg-accent/5 hover:pl-[18px] hover:text-sg-accent-strong'
                : 'text-sg-ink/80 hover:bg-sg-accent/5 hover:pl-[18px] hover:text-sg-accent-strong'
            }`}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05, duration: 0.25, ease: 'easeOut' }}
            onClick={item.action}
          >
            {item.label}
          </motion.button>
        ))}
      </nav>
    </Modal>
  );
}
