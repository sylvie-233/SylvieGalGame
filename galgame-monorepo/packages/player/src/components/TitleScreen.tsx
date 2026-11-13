import type { AmbientEffect } from '@sylvie/types';
import { motion } from 'motion/react';

import { AmbientLayer } from './AmbientLayer';

interface TitleScreenProps {
  /** 游戏标题，来自 manifest。 */
  title: string;
  /** 版本号，来自 manifest。 */
  version: string;
  /** 副标题；缺省时由 GameApp 提供默认文案。 */
  subtitle: string;
  /** 是否显示版本号，来自 titleScreen 配置。 */
  showVersion: boolean;
  /** 脚本与资源是否加载完成；未完成时禁用依赖引擎的按钮。 */
  ready: boolean;
  /** 已解析的标题背景 URL。 */
  backgroundUrl: string;
  /** 标题页持续环境特效；来自 manifest.titleScreen.effects。 */
  effects: AmbientEffect[];
  onNewGame: () => void;
  /** 从自动 / 快速 / 手动存档中取最新一份继续。 */
  onContinue: () => void;
  onLoad: () => void;
  onGallery: () => void;
  onSettings: () => void;
  /** 可选：Web 壳不实现 quit，因此不渲染退出按钮。 */
  onQuit?: () => void;
}

/** 标题页菜单按钮样式；悬停时字距展开并出现左侧短横线。 */
const MENU_BUTTON =
  'relative px-1 py-[11px] text-left text-[clamp(14px,1.35vw,17px)] tracking-[0.24em] text-sg-ink/75 transition-all duration-300 enabled:hover:tracking-[0.3em] enabled:hover:text-sg-accent-strong enabled:hover:after:w-3 enabled:hover:after:opacity-100 focus-visible:text-sg-accent-strong focus-visible:outline-none disabled:cursor-default disabled:text-sg-ink/25 after:absolute after:top-1/2 after:-left-[18px] after:h-px after:w-2 after:-translate-y-1/2 after:bg-sg-accent after:opacity-0 after:transition-all after:duration-300';

/**
 * 标题页：缓慢推拉的背景、游戏标题 / 副标题与入口菜单。
 * 数据全部由 GameApp 从 manifest 派生；`ready` 为 false 时禁用新游戏、
 * 继续、读档与图鉴，设置保持可用。`onQuit` 缺失时隐藏退出按钮。
 */
export function TitleScreen({
  title,
  version,
  subtitle,
  showVersion,
  ready,
  backgroundUrl,
  effects,
  onNewGame,
  onContinue,
  onLoad,
  onGallery,
  onSettings,
  onQuit,
}: TitleScreenProps) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <motion.img
        className="absolute inset-0 h-full w-full object-cover brightness-[0.96] saturate-[0.98]"
        src={backgroundUrl}
        alt=""
        draggable={false}
        initial={{ scale: 1.02, x: '-1%' }}
        animate={{ scale: 1.07, x: '1%' }}
        transition={{ duration: 24, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 24% 42%, rgba(9,11,18,0.06), rgba(6,7,12,0.74) 66%), linear-gradient(100deg, rgba(6,7,12,0.86) 0%, rgba(6,7,12,0.36) 44%, rgba(6,7,12,0.1) 72%), linear-gradient(0deg, rgba(6,7,12,0.8), transparent 46%)',
        }}
      />

      {/* 环境特效在遮罩之上、菜单文字之下，模拟灯光 / 萤火虫。 */}
      <AmbientLayer effects={effects} className="z-[1]" />

      <motion.div
        className="relative z-[2] flex h-full max-w-[900px] flex-col items-start justify-center px-[clamp(32px,6vw,96px)] py-[clamp(32px,6vw,96px)] max-[900px]:px-7 max-[900px]:py-8"
        initial={{ opacity: 0, y: 26 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: 'easeOut' }}
      >
        <div className="mb-[18px] text-[11px] tracking-[0.42em] text-sg-gold/80 uppercase">
          SYLVIE GALGAME
        </div>
        <h1 className="m-0 font-dialogue text-[clamp(40px,5.4vw,72px)] leading-[1.08] font-medium tracking-[0.06em] [text-shadow:0_10px_40px_rgba(0,0,0,0.6)]">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-[18px] mb-0 text-[clamp(13px,1.4vw,16px)] tracking-[0.16em] text-sg-muted">
            {subtitle}
          </p>
        )}

        <div className="mt-[clamp(32px,5vh,56px)] flex flex-col items-start gap-0.5 max-[900px]:mt-6">
          <button type="button" className={MENU_BUTTON} onClick={onNewGame} disabled={!ready}>
            开始新游戏
          </button>
          <button type="button" className={MENU_BUTTON} onClick={onContinue} disabled={!ready}>
            继续游戏
          </button>
          <button type="button" className={MENU_BUTTON} onClick={onLoad} disabled={!ready}>
            读取存档
          </button>
          <button type="button" className={MENU_BUTTON} onClick={onGallery} disabled={!ready}>
            回忆图鉴
          </button>
          <button type="button" className={MENU_BUTTON} onClick={onSettings}>
            设置
          </button>
          {onQuit && (
            <button type="button" className={MENU_BUTTON} onClick={onQuit}>
              退出游戏
            </button>
          )}
        </div>

        <div className="absolute bottom-[clamp(22px,3.4vw,44px)] flex gap-[26px] text-[11px] tracking-[0.16em] text-sg-ink/35 max-[900px]:static max-[900px]:mt-10">
          {showVersion && <span>v{version}</span>}
          <span className="text-sg-ink/20">YAML · Electron · React</span>
        </div>
      </motion.div>
    </div>
  );
}
