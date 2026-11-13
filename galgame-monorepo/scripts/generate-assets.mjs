#!/usr/bin/env node
/**
 * 生成占位美术、音频与图标资源。
 * 不依赖任何第三方包：SVG 直接编写，WAV 用 16-bit PCM，PNG/ICO 用 zlib 手写。
 *
 * 可重复执行，每次都会覆盖同名占位文件；替换为正式素材后不要再运行，
 * 否则新素材会被占位内容覆盖。
 */
import { deflateSync } from 'node:zlib';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 输出位置：游戏内容包（美术 / 音频）与 Electron 外壳图标目录。
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const GAME = path.join(ROOT, 'packages/game-content/game');
const ASSETS = path.join(ROOT, 'apps/electron/assets');

/** 音频占位写入：已有文件默认跳过，避免覆盖下载 / 正式素材。 */
const writeAudio = async (file, data) => {
  if (!FORCE_AUDIO) {
    try {
      await access(file);
      console.log(`  · 跳过已有音频 ${path.relative(ROOT, file)}`);
      return;
    } catch {
      // 文件不存在，继续写占位。
    }
  }
  await write(file, data);
};

/** 确保目录存在并返回拼接后的绝对路径。 */
const ensure = async (...segments) => {
  const target = path.join(...segments);
  await mkdir(target, { recursive: true });
  return target;
};

/** 默认不覆盖已经替换过的正式音频；需要重建占位音频时加 --force-audio。 */
const FORCE_AUDIO = process.argv.includes('--force-audio');
/** 仓库已改用 CC0 正式音频，默认不再生成 WAV 占位；需要旧占位时显式开启。 */
const PLACEHOLDER_AUDIO = process.argv.includes('--placeholder-audio');

/** 写入文件（自动建目录）并打印相对仓库根的输出路径。 */
const write = async (file, data) => {
  await mkdir(path.dirname(file), { recursive: true });
  // SVG / 文本去掉行尾空白，避免 git diff --check 反复报错。
  const normalized = typeof data === 'string' ? data.replace(/[ 	]+$/gm, '') : data;
  await writeFile(file, normalized);
  console.log(`  · ${path.relative(ROOT, file)}`);
};

/** 确定性伪随机数生成器：同一 seed 产出完全相同的素材，重复生成时 diff 稳定。 */
function mulberry32(seed) {
  let value = seed;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* SVG 美术                                                            */
/* ------------------------------------------------------------------ */

const BOOK_COLORS = ['#8d5b6d', '#5b6d8d', '#8d7a5b', '#6d8d74', '#7a5b8d', '#a76f7d', '#4f6480'];

/** 生成一面由随机宽高书本组成的书架，用 seed 保证每次布局一致。 */
function bookshelf(x, y, width, height, seed) {
  const rng = mulberry32(seed);
  const rows = 4;
  const rowHeight = height / rows;
  let content = `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#171a26" stroke="#2c3043" stroke-width="3"/>`;
  for (let row = 0; row < rows; row += 1) {
    const baseY = y + row * rowHeight;
    content += `<rect x="${x}" y="${baseY + rowHeight - 8}" width="${width}" height="8" fill="#2c3043"/>`;
    let cursor = x + 10;
    while (cursor < x + width - 18) {
      const bookWidth = 8 + Math.floor(rng() * 12);
      const bookHeight = rowHeight - 24 - Math.floor(rng() * 26);
      const color = BOOK_COLORS[Math.floor(rng() * BOOK_COLORS.length)];
      content += `<rect x="${cursor}" y="${baseY + rowHeight - 10 - bookHeight}" width="${bookWidth}" height="${bookHeight}" rx="2" fill="${color}" opacity="${0.42 + rng() * 0.3}"/>`;
      content += `<rect x="${cursor + 2}" y="${baseY + rowHeight - 10 - bookHeight + 8}" width="${bookWidth - 4}" height="3" fill="#f3eee8" opacity="0.16"/>`;
      cursor += bookWidth + 4 + Math.floor(rng() * 5);
    }
  }
  return content;
}

/** 在给定区域内散布半透明圆点，模拟光柱中的漂浮尘埃。 */
function dust(seed, count, width, height) {
  const rng = mulberry32(seed);
  let content = '';
  for (let i = 0; i < count; i += 1) {
    const x = rng() * width;
    const y = rng() * height;
    const r = 1 + rng() * 3.2;
    content += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="#ffe9d6" opacity="${(0.08 + rng() * 0.22).toFixed(2)}"/>`;
  }
  return content;
}

/**
 * 生成 1920×1080 的图书馆背景。
 * variant 决定桌面道具：afternoon 为书本、tea 为茶具、sunset 为长椅；
 * 其余颜色参数用于区分不同时段的天空与光柱。
 */
function libraryScene({ skyTop, skyBottom, wallTop, wallBottom, glow, beam, floor, accent, seed, variant }) {
  const width = 1920;
  const height = 1080;
  const sunX = 620;
  const sunY = 300;

  let props = '';
  if (variant === 'tea') {
    props = `
      <g transform="translate(1180 800)">
        <ellipse cx="0" cy="52" rx="128" ry="22" fill="#000" opacity="0.28"/>
        <ellipse cx="0" cy="10" rx="84" ry="18" fill="#efe4da" opacity="0.9"/>
        <path d="M-72 8 Q-72 92 0 92 Q72 92 72 8 Z" fill="#f3eee8" opacity="0.96"/>
        <ellipse cx="0" cy="8" rx="72" ry="16" fill="#b9855f" opacity="0.9"/>
        <path d="M-84 24 Q-122 44 -94 74" fill="none" stroke="#f3eee8" stroke-width="12" opacity="0.8"/>
        <path d="M-20 -10 Q-38 -56 2 -84" fill="none" stroke="#ffe9d6" stroke-width="9" opacity="0.24"/>
        <path d="M22 -6 Q46 -42 18 -76" fill="none" stroke="#ffe9d6" stroke-width="7" opacity="0.18"/>
      </g>
      <rect x="1010" y="760" width="640" height="42" rx="10" fill="#2b2130" opacity="0.92"/>
      <rect x="1046" y="802" width="24" height="230" fill="#241c29"/>
      <rect x="1584" y="802" width="24" height="230" fill="#241c29"/>`;
  } else if (variant === 'evening') {
    props = `
      <g transform="translate(1290 800)">
        <rect x="-110" y="0" width="220" height="22" rx="4" fill="#3a2f39"/>
        <rect x="-92" y="-18" width="184" height="18" rx="3" fill="#4d3a4a"/>
        <rect x="-70" y="-34" width="140" height="16" rx="3" fill="#3f5068"/>
        <ellipse cx="0" cy="6" rx="120" ry="14" fill="#ffcf9e" opacity="0.08"/>
      </g>
      <g transform="translate(1500 690)">
        <rect x="-8" y="0" width="16" height="120" fill="#2a2230"/>
        <path d="M-58 0 Q0 -46 58 0 L40 16 Q0 -12 -40 16 Z" fill="#e8c9a0" opacity="0.8"/>
        <ellipse cx="0" cy="22" rx="70" ry="26" fill="#ffcf9e" opacity="0.16"/>
      </g>`;
  } else if (variant === 'sunset') {
    props = `
      <g opacity="0.9">
        <rect x="760" y="912" width="250" height="28" rx="8" fill="#241d2a"/>
        <rect x="790" y="940" width="18" height="94" fill="#241d2a"/>
        <rect x="962" y="940" width="18" height="94" fill="#241d2a"/>
        <rect x="1090" y="936" width="200" height="24" rx="8" fill="#241d2a"/>
        <rect x="1112" y="960" width="16" height="78" fill="#241d2a"/>
        <rect x="1252" y="960" width="16" height="78" fill="#241d2a"/>
      </g>`;
  } else {
    props = `
      <g transform="translate(1290 812)">
        <rect x="-90" y="0" width="180" height="20" rx="4" fill="#6f4f55" opacity="0.8"/>
        <rect x="-72" y="-16" width="144" height="18" rx="3" fill="#8d5b6d" opacity="0.7"/>
        <rect x="-52" y="-32" width="104" height="16" rx="3" fill="#5b6d8d" opacity="0.7"/>
      </g>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${skyTop}"/>
      <stop offset="1" stop-color="${skyBottom}"/>
    </linearGradient>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${wallTop}"/>
      <stop offset="1" stop-color="${wallBottom}"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${floor}"/>
      <stop offset="1" stop-color="#0a0b12"/>
    </linearGradient>
    <radialGradient id="sun" cx="${sunX}" cy="${sunY}" r="720" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${glow}" stop-opacity="0.85"/>
      <stop offset="0.55" stop-color="${glow}" stop-opacity="0.2"/>
      <stop offset="1" stop-color="${glow}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="beam" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${beam}" stop-opacity="0.34"/>
      <stop offset="0.7" stop-color="${beam}" stop-opacity="0.06"/>
      <stop offset="1" stop-color="${beam}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="table" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4b3a41"/>
      <stop offset="1" stop-color="#241c26"/>
    </linearGradient>
  </defs>

  <rect width="${width}" height="${height}" fill="url(#wall)"/>
  <rect y="742" width="${width}" height="338" fill="url(#floor)"/>
  <rect x="0" y="700" width="${width}" height="60" fill="#0d0f18" opacity="0.55"/>
  <rect x="0" y="0" width="${width}" height="700" fill="url(#sun)"/>

  <!-- 长窗 -->
  <g>
    <rect x="248" y="118" width="700" height="622" rx="20" fill="#0c0e17" opacity="0.9"/>
    <rect x="264" y="134" width="668" height="590" rx="12" fill="url(#sky)"/>
    <rect x="562" y="134" width="12" height="590" fill="#141624" opacity="0.9"/>
    <rect x="264" y="384" width="668" height="12" fill="#141624" opacity="0.9"/>
    <rect x="264" y="134" width="668" height="590" rx="12" fill="${glow}" opacity="0.06"/>
    <path d="M264 500 Q400 470 562 522 T932 494" fill="none" stroke="#fff" stroke-width="3" opacity="0.08"/>
    <path d="M264 610 Q410 586 562 628 T932 604" fill="none" stroke="#fff" stroke-width="3" opacity="0.06"/>
  </g>

  <!-- 光柱与漂浮尘埃 -->
  <polygon points="600,160 900,160 1310,1080 820,1080" fill="url(#beam)" opacity="0.6"/>
  <polygon points="400,180 620,180 760,1080 470,1080" fill="url(#beam)" opacity="0.28"/>
  ${dust(seed, 46, width, 820)}

  <!-- 书架 -->
  ${bookshelf(56, 160, 286, 620, seed + 1)}
  ${bookshelf(1560, 120, 300, 680, seed + 2)}

  <!-- 长桌与椅子 -->
  <g>
    <polygon points="380,760 1540,760 1630,800 290,800" fill="url(#table)"/>
    <rect x="300" y="800" width="1310" height="26" fill="#1c161f"/>
    <rect x="420" y="826" width="22" height="212" fill="#1c161f"/>
    <rect x="1488" y="826" width="22" height="212" fill="#1c161f"/>
    <rect x="352" y="962" width="190" height="24" rx="8" fill="#2c2230" opacity="0.8"/>
    <rect x="1350" y="962" width="190" height="24" rx="8" fill="#2c2230" opacity="0.8"/>
    <rect x="372" y="984" width="16" height="92" fill="#241c26" opacity="0.8"/>
    <rect x="1512" y="984" width="16" height="92" fill="#241c26" opacity="0.8"/>
  </g>

  ${props}

  <!-- 前景边缘 -->
  <rect width="${width}" height="${height}" fill="none"/>
  <path d="M0 0 L260 0 L260 1080 L0 1080 Z" fill="#05060a" opacity="0.22"/>
  <path d="M1920 0 L1680 0 L1680 1080 L1920 1080 Z" fill="#05060a" opacity="0.2"/>
  <rect y="980" width="${width}" height="100" fill="#05060a" opacity="0.42"/>
  <rect x="0" y="0" width="${width}" height="24" fill="${accent}" opacity="0.05"/>
</svg>`;
}

/** 夜色城市剪影：按固定公式生成楼体与零星窗灯，避免随机布局造成 diff 波动。 */
function nightSkyline(baseY, seed) {
  const rng = mulberry32(seed);
  let content = '';
  let cursor = -40;
  while (cursor < 1960) {
    const width = 90 + Math.floor(rng() * 170);
    const height = 180 + Math.floor(rng() * 420);
    const top = baseY - height;
    content += `<rect x="${cursor}" y="${top}" width="${width}" height="${height}" fill="#0c101d"/>`;
    const columns = Math.floor(width / 28);
    const rows = Math.floor(height / 38);
    for (let column = 0; column < columns; column += 1) {
      for (let row = 0; row < rows; row += 1) {
        if (rng() < 0.72) continue;
        content += `<rect x="${cursor + 12 + column * 28}" y="${top + 16 + row * 38}" width="7" height="10" fill="#ffd9a0" opacity="${(0.12 + rng() * 0.25).toFixed(2)}"/>`;
      }
    }
    cursor += width + 12;
  }
  return content;
}

/** 夜间街道：便利店、自动售货机与末班车站牌，故事的主舞台。 */
const streetNightArt = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#080b16"/>
      <stop offset="0.6" stop-color="#151b2e"/>
      <stop offset="1" stop-color="#2a2334"/>
    </linearGradient>
    <linearGradient id="road" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1a1d28"/>
      <stop offset="1" stop-color="#07080d"/>
    </linearGradient>
    <radialGradient id="store" cx="1500" cy="700" r="520" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#e9f4ff" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#e9f4ff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vend" cx="1010" cy="720" r="260" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#bfe3ff" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#bfe3ff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#sky)"/>
  <g fill="#ffe9c8" opacity="0.5">
    <circle cx="240" cy="140" r="2"/><circle cx="520" cy="90" r="1.5"/><circle cx="860" cy="170" r="2"/>
    <circle cx="1180" cy="110" r="1.5"/><circle cx="1620" cy="150" r="2"/><circle cx="1800" cy="90" r="1.5"/>
  </g>
  <circle cx="1640" cy="170" r="46" fill="#f2ead7" opacity="0.25"/>
  ${nightSkyline(760, 121)}
  <rect y="760" width="1920" height="320" fill="url(#road)"/>
  <rect y="742" width="1920" height="18" fill="#2a2d3a"/>
  <g stroke="#4a4d5a" stroke-width="6" opacity="0.4">
    <path d="M120 900 H420"/><path d="M760 900 H1060"/><path d="M1400 900 H1700"/>
  </g>

  <!-- 便利店 -->
  <g>
    <rect x="1260" y="560" width="600" height="240" fill="#10151f"/>
    <rect x="1260" y="560" width="600" height="44" fill="#1d2635"/>
    <rect x="1290" y="620" width="540" height="120" fill="#e7f3e8" opacity="0.82"/>
    <rect x="1290" y="620" width="540" height="120" fill="none" stroke="#d5e7d8" stroke-width="4" opacity="0.6"/>
    <rect x="1290" y="560" width="540" height="44" fill="#eae3d4" opacity="0.9"/>
    <text x="1320" y="594" font-family="sans-serif" font-size="28" letter-spacing="8" fill="#3b4a58">24 H</text>
    <rect x="1288" y="760" width="544" height="20" fill="#202633"/>
    <rect x="1300" y="780" width="60" height="210" fill="#171c26"/>
    <rect x="1740" y="780" width="60" height="210" fill="#171c26"/>
  </g>
  <rect width="1920" height="1080" fill="url(#store)"/>

  <!-- 自动售货机 -->
  <g transform="translate(980 620)">
    <rect x="-90" y="0" width="180" height="300" rx="10" fill="#1a2233"/>
    <rect x="-72" y="18" width="144" height="170" rx="6" fill="#dff0ff" opacity="0.8"/>
    <g opacity="0.8">
      ${Array.from({ length: 12 }, (_, index) => {
        const column = index % 4;
        const row = Math.floor(index / 4);
        return `<rect x="${-58 + column * 32}" y="${30 + row * 38}" width="20" height="26" rx="4" fill="${['#d9a15e', '#8a6d62', '#c9c2b4', '#6d8fa8'][index % 4]}" opacity="0.85"/>`;
      }).join('')}
    </g>
    <rect x="-72" y="200" width="144" height="24" fill="#0d121b"/>
    <rect x="-58" y="236" width="70" height="16" rx="4" fill="#2a3446"/>
    <circle cx="52" cy="244" r="10" fill="#8fc3e8" opacity="0.8"/>
    <rect x="-90" y="300" width="180" height="16" fill="#0d111a"/>
  </g>
  <rect width="1920" height="1080" fill="url(#vend)"/>

  <!-- 站牌与路灯 -->
  <g>
    <rect x="420" y="560" width="8" height="360" fill="#2a2d38"/>
    <rect x="356" y="560" width="140" height="58" rx="6" fill="#1b2230" stroke="#3a4356" stroke-width="3"/>
    <text x="382" y="596" font-family="sans-serif" font-size="22" fill="#c9d4e3">BUS</text>
    <rect x="260" y="520" width="6" height="400" fill="#2b2e3a"/>
    <path d="M263 520 Q340 500 400 520" fill="none" stroke="#2b2e3a" stroke-width="8"/>
    <circle cx="263" cy="516" r="16" fill="#ffe0a8" opacity="0.9"/>
    <path d="M279 520 L520 700 L520 760 L240 560 Z" fill="#ffe0a8" opacity="0.055"/>
  </g>
  <ellipse cx="960" cy="1000" rx="820" ry="60" fill="#03040a" opacity="0.5"/>
</svg>`;

/** 末班车站：长椅、雨棚与远处便利店的光，用于夜晚收束与结局。 */
const busStopNightArt = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#070a14"/>
      <stop offset="0.7" stop-color="#141a2b"/>
      <stop offset="1" stop-color="#2b2432"/>
    </linearGradient>
    <linearGradient id="road" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#191c26"/>
      <stop offset="1" stop-color="#06070c"/>
    </linearGradient>
    <radialGradient id="light" cx="1360" cy="700" r="520" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#d9ecff" stop-opacity="0.4"/>
      <stop offset="1" stop-color="#d9ecff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#sky)"/>
  ${nightSkyline(780, 211)}
  <rect y="780" width="1920" height="300" fill="url(#road)"/>
  <rect y="762" width="1920" height="18" fill="#282b37"/>
  <g stroke="#434653" stroke-width="5" opacity="0.35">
    <path d="M180 930 H520"/><path d="M860 930 H1200"/><path d="M1540 930 H1880"/>
  </g>
  <rect width="1920" height="1080" fill="url(#light)"/>

  <!-- 候车亭 -->
  <g>
    <rect x="300" y="470" width="720" height="26" rx="8" fill="#232a38"/>
    <rect x="316" y="496" width="12" height="330" fill="#1d2430"/>
    <rect x="992" y="496" width="12" height="330" fill="#1d2430"/>
    <rect x="330" y="520" width="650" height="220" fill="#c9d8e8" opacity="0.06"/>
    <rect x="360" y="742" width="580" height="24" rx="6" fill="#2a3040"/>
    <rect x="378" y="766" width="18" height="90" fill="#202633"/>
    <rect x="900" y="766" width="18" height="90" fill="#202633"/>
    <rect x="300" y="440" width="8" height="80" fill="#2a3242"/>
    <circle cx="304" cy="438" r="22" fill="#ffe3ae" opacity="0.8"/>
  </g>

  <!-- 站牌 -->
  <g transform="translate(1120 470)">
    <rect x="-6" y="0" width="12" height="360" fill="#2a2e3a"/>
    <rect x="-90" y="-6" width="180" height="66" rx="8" fill="#e8e3d6"/>
    <text x="-58" y="28" font-family="sans-serif" font-size="20" fill="#3a424f">末班</text>
    <text x="-58" y="52" font-family="sans-serif" font-size="16" fill="#6a7280">23:30</text>
  </g>

  <!-- 远处售货机 -->
  <g transform="translate(1660 700)" opacity="0.9">
    <rect x="-70" y="0" width="140" height="230" rx="8" fill="#182030"/>
    <rect x="-54" y="16" width="108" height="120" fill="#d9ecff" opacity="0.72"/>
    <rect x="-54" y="150" width="108" height="16" fill="#0e141d"/>
    <ellipse cx="0" cy="236" rx="90" ry="18" fill="#cfe6ff" opacity="0.12"/>
  </g>
  <ellipse cx="700" cy="1000" rx="760" ry="54" fill="#03040a" opacity="0.5"/>
</svg>`;

// 标题画面：深夜的自动售货机与等人的少女，呼应 120 日元的故事。
const titleArt = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#070a14"/>
      <stop offset="0.65" stop-color="#141a2c"/>
      <stop offset="1" stop-color="#312638"/>
    </linearGradient>
    <radialGradient id="vend" cx="1380" cy="600" r="620" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#d9ecff" stop-opacity="0.55"/>
      <stop offset="0.5" stop-color="#a8c9ec" stop-opacity="0.14"/>
      <stop offset="1" stop-color="#a8c9ec" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="road" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1a1d28"/>
      <stop offset="1" stop-color="#05060b"/>
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#sky)"/>
  ${nightSkyline(720, 311)}
  <rect y="720" width="1920" height="360" fill="url(#road)"/>
  <rect y="706" width="1920" height="16" fill="#282b37"/>
  <rect width="1920" height="1080" fill="url(#vend)"/>

  <!-- 自动售货机 -->
  <g transform="translate(1390 520)">
    <rect x="-150" y="0" width="300" height="520" rx="14" fill="#1a2233"/>
    <rect x="-122" y="28" width="244" height="290" rx="8" fill="#e2f2ff" opacity="0.86"/>
    <g opacity="0.85">
      ${Array.from({ length: 20 }, (_, index) => {
        const column = index % 5;
        const row = Math.floor(index / 5);
        return `<rect x="${-104 + column * 45}" y="${48 + row * 58}" width="28" height="38" rx="5" fill="${['#d9a15e', '#8a6d62', '#c9c2b4', '#6d8fa8', '#a87b86'][index % 5]}" opacity="0.9"/>`;
      }).join('')}
    </g>
    <rect x="-122" y="340" width="244" height="34" fill="#0c111a"/>
    <rect x="-100" y="396" width="120" height="22" rx="5" fill="#2a3446"/>
    <circle cx="88" cy="408" r="14" fill="#8fc3e8" opacity="0.85"/>
    <rect x="-150" y="520" width="300" height="20" fill="#0c1018"/>
    <ellipse cx="0" cy="548" rx="210" ry="34" fill="#05060a" opacity="0.5"/>
  </g>

  <!-- 等人的少女剪影 -->
  <g transform="translate(880 640)" opacity="0.94">
    <ellipse cx="0" cy="0" rx="70" ry="86" fill="#0f1119"/>
    <path d="M-74 90 Q-118 180 -102 420 L102 420 Q118 180 74 90 Z" fill="#0f1119"/>
    <path d="M-52 96 Q-18 58 22 96 Q10 158 -32 150 Z" fill="#1b1d2a" opacity="0.65"/>
    <path d="M60 60 Q120 120 118 220" fill="none" stroke="#0f1119" stroke-width="26" stroke-linecap="round"/>
    <rect x="-110" y="420" width="220" height="12" rx="6" fill="#0b0d14"/>
  </g>
  <ellipse cx="960" cy="1030" rx="860" ry="60" fill="#03040a" opacity="0.5"/>
</svg>`;

// 热茶 CG：暖色茶杯与蒸汽，对应“热茶”分支的氛围。
const teaCg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080">
  <defs>
    <linearGradient id="room" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#241a24"/>
      <stop offset="0.6" stop-color="#3d2730"/>
      <stop offset="1" stop-color="#120e18"/>
    </linearGradient>
    <radialGradient id="warm" cx="900" cy="440" r="700" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffd9b8" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#ffd9b8" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="cup" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff7ef"/>
      <stop offset="1" stop-color="#cdb6a8"/>
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#room)"/>
  <rect width="1920" height="1080" fill="url(#warm)"/>
  <rect x="1400" y="80" width="420" height="560" rx="16" fill="#f8c69a" opacity="0.1"/>
  <rect x="1430" y="110" width="360" height="500" rx="10" fill="#f8c69a" opacity="0.14"/>
  <polygon points="1460,120 1760,120 1600,980 1040,980" fill="#ffe2c4" opacity="0.07"/>

  <rect x="0" y="760" width="1920" height="320" fill="#1a131b"/>
  <polygon points="0,840 1920,760 1920,860 0,940" fill="#2c2028"/>
  <ellipse cx="960" cy="872" rx="360" ry="56" fill="#05060a" opacity="0.42"/>

  <g transform="translate(900 700)">
    <ellipse cx="0" cy="190" rx="260" ry="42" fill="#05060a" opacity="0.38"/>
    <ellipse cx="0" cy="118" rx="170" ry="34" fill="#b69c90" opacity="0.55"/>
    <path d="M-148 112 Q-148 260 0 260 Q148 260 148 112 Z" fill="url(#cup)"/>
    <ellipse cx="0" cy="112" rx="148" ry="34" fill="#efe4da"/>
    <ellipse cx="0" cy="112" rx="122" ry="24" fill="#9a5f43"/>
    <path d="M-168 142 Q-256 180 -190 236" fill="none" stroke="#efe4da" stroke-width="26" opacity="0.9"/>
    <path d="M-44 54 Q-80 -30 0 -98 Q74 -160 10 -238" fill="none" stroke="#ffe9d6" stroke-width="16" opacity="0.2"/>
    <path d="M44 44 Q86 -24 24 -82 Q-30 -132 32 -204" fill="none" stroke="#ffe9d6" stroke-width="11" opacity="0.14"/>
  </g>

  <g opacity="0.8">
    <rect x="1300" y="720" width="220" height="26" rx="6" fill="#8d5b6d"/>
    <rect x="1330" y="700" width="180" height="20" rx="4" fill="#5b6d8d"/>
    <rect x="1360" y="682" width="130" height="18" rx="4" fill="#8d7a5b"/>
  </g>

  <circle cx="1710" cy="880" r="170" fill="#ffe2c4" opacity="0.04"/>
  <rect y="980" width="1920" height="100" fill="#05060a" opacity="0.45"/>
</svg>`;

// 书页 CG：摊开的书与漂浮音符，对应“书页”分支的旋律结局。
const bookCg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080">
  <defs>
    <radialGradient id="dark" cx="960" cy="560" r="820" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#3b2a34"/>
      <stop offset="0.55" stop-color="#160f1b"/>
      <stop offset="1" stop-color="#05060a"/>
    </radialGradient>
    <linearGradient id="page" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ffe6c8"/>
      <stop offset="0.5" stop-color="#fff8ec"/>
      <stop offset="1" stop-color="#ffe6c8"/>
    </linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffd9a8" stop-opacity="0.7"/>
      <stop offset="1" stop-color="#ffd9a8" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#dark)"/>
  <rect x="760" y="140" width="400" height="700" fill="url(#glow)" opacity="0.36"/>
  <ellipse cx="960" cy="720" rx="520" ry="260" fill="#ffd9a8" opacity="0.08"/>

  <polygon points="360,720 1560,720 1660,780 260,780" fill="#1b131a"/>
  <ellipse cx="960" cy="840" rx="520" ry="60" fill="#000" opacity="0.3"/>

  <!-- 摊开的书 -->
  <g transform="translate(960 620)">
    <path d="M-470 40 Q-240 -80 0 -24 Q240 -80 470 40 Q240 84 0 60 Q-240 84 -470 40 Z" fill="#2b1d25"/>
    <path d="M-442 26 Q-230 -58 0 -10 Q230 -58 442 26 Q230 62 0 42 Q-230 62 -442 26 Z" fill="url(#page)"/>
    <path d="M0 42 L0 -10" stroke="#b69a86" stroke-width="3" opacity="0.5"/>
    <path d="M-360 6 Q-230 -28 -60 -8" stroke="#8a6d62" stroke-width="4" opacity="0.35"/>
    <path d="M-340 26 Q-230 0 -90 16" stroke="#8a6d62" stroke-width="3" opacity="0.25"/>
    <path d="M70 6 Q230 -28 360 4" stroke="#8a6d62" stroke-width="4" opacity="0.35"/>
    <path d="M90 24 Q230 -2 340 22" stroke="#8a6d62" stroke-width="3" opacity="0.25"/>

    <g transform="translate(0 -30)" opacity="0.9">
      <path d="M-120 0 Q-40 -30 40 0 T200 0" fill="none" stroke="#c28a76" stroke-width="4" opacity="0.6"/>
      <path d="M-90 34 Q-20 4 50 34 T170 34" fill="none" stroke="#c28a76" stroke-width="3" opacity="0.4"/>
    </g>
  </g>

  <!-- 漂浮音符 -->
  <g fill="#ffe2b0" opacity="0.5">
    <g transform="translate(620 400)"><circle cx="0" cy="0" r="16"/><rect x="12" y="-10" width="5" height="90" rx="2"/><path d="M17 -10 Q58 8 46 42" fill="none" stroke="#ffe2b0" stroke-width="4"/></g>
    <g transform="translate(1260 340) scale(0.8)"><circle cx="0" cy="0" r="16"/><rect x="12" y="-10" width="5" height="90" rx="2"/><path d="M17 -10 Q58 8 46 42" fill="none" stroke="#ffe2b0" stroke-width="4"/></g>
    <g transform="translate(1380 520) scale(1.2)"><circle cx="0" cy="0" r="16"/><rect x="12" y="-10" width="5" height="90" rx="2"/><path d="M17 -10 Q58 8 46 42" fill="none" stroke="#ffe2b0" stroke-width="4"/></g>
  </g>
  ${dust(31, 40, 1920, 900)}
</svg>`;

/** 生成一段透视键盘：白键等宽，黑键按 2-3 分组排布。 */
function pianoKeys(x, y, width, height, whiteCount = 24) {
  const whiteWidth = width / whiteCount;
  let content = `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#f0e6d8"/>`;
  for (let index = 1; index < whiteCount; index += 1) {
    content += `<rect x="${x + index * whiteWidth}" y="${y}" width="2" height="${height}" fill="#b9a894"/>`;
  }
  const blackOffsets = [0, 1, 3, 4, 5];
  for (let index = 0; index < whiteCount - 1; index += 1) {
    if (!blackOffsets.includes(index % 7)) continue;
    content += `<rect x="${x + (index + 0.68) * whiteWidth}" y="${y}" width="${whiteWidth * 0.58}" height="${height * 0.62}" rx="2" fill="#1c1720"/>`;
  }
  return content;
}

// 旧音乐教室：黄昏、落灰的谱架与擦得很干净的钢琴，对应「书页」分支。
const musicRoomArt = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#241d2b"/>
      <stop offset="1" stop-color="#0c0a12"/>
    </linearGradient>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4a3550"/>
      <stop offset="0.65" stop-color="#c47a78"/>
      <stop offset="1" stop-color="#f0b98e"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#231a22"/>
      <stop offset="1" stop-color="#08070c"/>
    </linearGradient>
    <radialGradient id="lamp" cx="620" cy="520" r="620" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffd7a4" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#ffd7a4" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#wall)"/>
  <rect y="760" width="1920" height="320" fill="url(#floor)"/>
  <rect width="1920" height="1080" fill="url(#lamp)"/>

  <!-- 高窗与黄昏 -->
  <g>
    <rect x="150" y="90" width="760" height="700" rx="18" fill="#0b0a12"/>
    <rect x="172" y="112" width="716" height="656" rx="10" fill="url(#sky)"/>
    <rect x="522" y="112" width="14" height="656" fill="#14101b"/>
    <rect x="172" y="420" width="716" height="12" fill="#14101b"/>
    <path d="M172 560 Q330 520 522 574 T888 548" fill="none" stroke="#fff2e2" stroke-width="3" opacity="0.1"/>
    <path d="M172 650 Q340 612 522 664 T888 638" fill="none" stroke="#fff2e2" stroke-width="3" opacity="0.08"/>
  </g>
  <polygon points="420,150 760,150 1180,1080 620,1080" fill="#ffe4c2" opacity="0.06"/>
  ${dust(61, 60, 1920, 820)}

  <!-- 谱架与椅子 -->
  <g opacity="0.85">
    <rect x="330" y="700" width="8" height="220" fill="#241d27"/>
    <path d="M286 700 L402 700 L386 640 L302 640 Z" fill="#2c2431"/>
    <rect x="300" y="650" width="88" height="6" fill="#cfc0aa" opacity="0.5"/>
    <rect x="470" y="780" width="150" height="18" rx="6" fill="#2c2230"/>
    <rect x="486" y="798" width="14" height="120" fill="#241c28"/>
    <rect x="590" y="798" width="14" height="120" fill="#241c28"/>
    <rect x="860" y="740" width="8" height="180" fill="#241d27"/>
    <path d="M816 740 L932 740 L916 684 L832 684 Z" fill="#2c2431"/>
  </g>

  <!-- 擦得很干净的钢琴 -->
  <g transform="translate(1280 500)">
    <path d="M-360 160 L-360 300 Q0 380 360 300 L360 160 Z" fill="#17121c"/>
    <path d="M-340 172 L-340 -40 Q0 -120 340 -40 L340 172 Z" fill="#211a27"/>
    <path d="M-340 -40 Q0 -120 340 -40 L340 10 Q0 -70 -340 10 Z" fill="#2b2233"/>
    <path d="M-300 172 L-300 84 L300 84 L300 172 Q0 236 -300 172 Z" fill="#f0e6d8"/>
    ${pianoKeys(-290, 92, 580, 70, 24)}
    <rect x="-330" y="176" width="660" height="16" fill="#100d14"/>
    <rect x="-250" y="300" width="24" height="180" fill="#141019"/>
    <rect x="226" y="300" width="24" height="180" fill="#141019"/>
    <rect x="-210" y="330" width="420" height="18" rx="5" fill="#2a2030"/>
    <rect x="-180" y="348" width="16" height="130" fill="#241c2a"/>
    <rect x="164" y="348" width="16" height="130" fill="#241c2a"/>
  </g>
  <ellipse cx="1280" cy="840" rx="420" ry="50" fill="#000" opacity="0.28"/>
  <rect y="1010" width="1920" height="70" fill="#05060a" opacity="0.5"/>
</svg>`;

// 天台黄昏：栏杆、城市天际线与将暗未暗的天空，对应「热茶」分支。
const rooftopArt = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2f2b4a"/>
      <stop offset="0.45" stop-color="#7d5468"/>
      <stop offset="0.75" stop-color="#d98b78"/>
      <stop offset="1" stop-color="#f3c49a"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#332b36"/>
      <stop offset="1" stop-color="#121017"/>
    </linearGradient>
    <radialGradient id="sun" cx="620" cy="640" r="560" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffe3bd" stop-opacity="0.8"/>
      <stop offset="1" stop-color="#ffe3bd" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#sky)"/>
  <rect width="1920" height="1080" fill="url(#sun)"/>
  <path d="M0 430 Q280 360 560 420 T1120 400 T1680 430 T1920 410 L1920 0 L0 0 Z" fill="#3a3452" opacity="0.28"/>
  <g opacity="0.65">
    <path d="M180 700 L260 700 L260 620 Q220 586 180 620 Z" fill="#2a2538"/>
    <path d="M420 720 L520 720 L520 590 Q470 544 420 590 Z" fill="#2a2538"/>
    <path d="M640 730 L780 730 L780 560 Q710 500 640 560 Z" fill="#2a2538"/>
    <path d="M960 740 L1080 740 L1080 610 Q1020 566 960 610 Z" fill="#2a2538"/>
    <path d="M1240 750 L1400 750 L1400 580 Q1320 520 1240 580 Z" fill="#2a2538"/>
    <path d="M1540 760 L1720 760 L1720 600 Q1630 540 1540 600 Z" fill="#2a2538"/>
  </g>
  <rect y="760" width="1920" height="320" fill="url(#floor)"/>
  <g opacity="0.5" fill="#ffe6c2">
    <rect x="300" y="700" width="7" height="7"/>
    <rect x="620" y="660" width="6" height="6"/>
    <rect x="900" y="690" width="8" height="8"/>
    <rect x="1180" y="650" width="5" height="5"/>
    <rect x="1480" y="700" width="7" height="7"/>
    <rect x="1700" y="670" width="6" height="6"/>
  </g>
  <!-- 栏杆 -->
  <g>
    <rect x="0" y="780" width="1920" height="14" fill="#1b1721"/>
    <rect x="0" y="900" width="1920" height="8" fill="#1b1721" opacity="0.8"/>
    ${Array.from({ length: 17 }, (_, index) => `<rect x="${index * 120 + 40}" y="780" width="10" height="140" fill="#1b1721"/>`).join('')}
  </g>
  <path d="M80 300 Q360 250 640 300 T1180 280 T1660 310" fill="none" stroke="#fff" stroke-width="3" opacity="0.08"/>
  <ellipse cx="960" cy="1020" rx="760" ry="60" fill="#05060a" opacity="0.4"/>
</svg>`;

// 琴键 CG：暖灯下的键盘、谱纸与落灰，对应书页分支的旧音乐教室。
const pianoKeysCg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080">
  <defs>
    <radialGradient id="warm" cx="980" cy="420" r="900" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffdcb0" stop-opacity="0.5"/>
      <stop offset="0.6" stop-color="#5a3a3e" stop-opacity="0.12"/>
      <stop offset="1" stop-color="#05060a"/>
    </radialGradient>
    <linearGradient id="key" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff8ee"/>
      <stop offset="0.7" stop-color="#eadccb"/>
      <stop offset="1" stop-color="#c8b5a1"/>
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#warm)"/>
  <rect x="0" y="700" width="1920" height="380" fill="#1a131a" opacity="0.8"/>
  <!-- 谱纸 -->
  <g transform="translate(960 360) rotate(-4)">
    <rect x="-330" y="-220" width="660" height="440" rx="6" fill="#f4ead9" opacity="0.94"/>
    <g stroke="#9b7f70" stroke-width="3" opacity="0.5">
      <path d="M-280 -150 H280"/><path d="M-280 -120 H280"/><path d="M-280 -90 H280"/>
      <path d="M-280 -60 H280"/><path d="M-280 -30 H280"/>
      <path d="M-280 40 H280"/><path d="M-280 70 H280"/><path d="M-280 100 H280"/>
      <path d="M-280 130 H280"/><path d="M-280 160 H280"/>
    </g>
    <g fill="#5a3a44">
      <ellipse cx="-170" cy="-122" rx="14" ry="10"/><rect x="-158" y="-190" width="5" height="70"/>
      <ellipse cx="-80" cy="-92" rx="14" ry="10"/><rect x="-68" y="-160" width="5" height="70"/>
      <ellipse cx="40" cy="-62" rx="14" ry="10"/><rect x="52" y="-130" width="5" height="70"/>
      <ellipse cx="150" cy="-32" rx="14" ry="10"/><rect x="162" y="-100" width="5" height="70"/>
      <ellipse cx="90" cy="128" rx="14" ry="10"/><rect x="102" y="60" width="5" height="70"/>
    </g>
    <path d="M-270 180 Q-100 150 80 184 T280 170" fill="none" stroke="#8a6a60" stroke-width="4" opacity="0.35"/>
  </g>
  <!-- 键盘 -->
  <g transform="translate(960 880)">
    <rect x="-760" y="-110" width="1520" height="24" fill="#100d14"/>
    <rect x="-760" y="-86" width="1520" height="220" fill="#0f0c12"/>
    ${pianoKeys(-760, -86, 1520, 220, 36)}
    <rect x="-760" y="-86" width="1520" height="14" fill="#2a1e28" opacity="0.8"/>
    <ellipse cx="0" cy="170" rx="760" ry="50" fill="#000" opacity="0.35"/>
  </g>
  <g fill="#ffe4bc" opacity="0.4">
    <circle cx="300" cy="260" r="4"/><circle cx="1520" cy="340" r="3"/>
    <circle cx="420" cy="500" r="2.5"/><circle cx="1640" cy="180" r="3.5"/>
    <circle cx="1280" cy="220" r="2"/><circle cx="700" cy="180" r="3"/>
  </g>
</svg>`;

// 天台天空 CG：被风吹开的云、栏杆与城市灯光，对应「热茶」分支。
const rooftopSkyCg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#262445"/>
      <stop offset="0.4" stop-color="#6e4d68"/>
      <stop offset="0.72" stop-color="#d68a78"/>
      <stop offset="1" stop-color="#f4c79c"/>
    </linearGradient>
    <radialGradient id="glow" cx="1240" cy="520" r="640" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffe5c2" stop-opacity="0.6"/>
      <stop offset="1" stop-color="#ffe5c2" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#sky)"/>
  <rect width="1920" height="1080" fill="url(#glow)"/>
  <g fill="#2c2946" opacity="0.35">
    <path d="M0 320 Q260 250 520 310 T1040 290 T1540 320 T1920 300 L1920 0 L0 0 Z"/>
    <path d="M0 520 Q300 450 620 510 T1240 490 T1920 520 L1920 420 Q1600 470 1240 440 T620 470 T0 440 Z" opacity="0.6"/>
  </g>
  <g fill="#fff1de" opacity="0.1">
    <path d="M420 380 Q560 320 700 380 Q560 410 420 380 Z"/>
    <path d="M1100 300 Q1260 230 1420 300 Q1260 340 1100 300 Z"/>
    <path d="M760 500 Q900 450 1040 500 Q900 530 760 500 Z"/>
  </g>
  <!-- 远处城市 -->
  <g fill="#1d1a2b" opacity="0.85">
    <rect x="0" y="800" width="240" height="280"/>
    <rect x="280" y="740" width="180" height="340"/>
    <rect x="500" y="820" width="260" height="260"/>
    <rect x="800" y="700" width="220" height="380"/>
    <rect x="1060" y="800" width="180" height="280"/>
    <rect x="1280" y="730" width="260" height="350"/>
    <rect x="1580" y="790" width="340" height="290"/>
  </g>
  <g fill="#ffe0ae" opacity="0.55">
    ${Array.from({ length: 40 }, (_, index) => {
      const x = 40 + ((index * 233) % 1840);
      const y = 760 + ((index * 97) % 260);
      return `<rect x="${x}" y="${y}" width="6" height="6"/>`;
    }).join('')}
  </g>
  <!-- 栏杆与风 -->
  <rect x="0" y="900" width="1920" height="16" fill="#15121c"/>
  <rect x="0" y="1010" width="1920" height="10" fill="#15121c" opacity="0.7"/>
  ${Array.from({ length: 19 }, (_, index) => `<rect x="${index * 108 + 36}" y="900" width="9" height="120" fill="#15121c"/>`).join('')}
  <path d="M120 260 Q420 210 720 260 T1320 240 T1800 270" fill="none" stroke="#fff" stroke-width="3" opacity="0.1"/>
  <path d="M0 980 Q480 940 960 976 T1920 960" fill="none" stroke="#fff" stroke-width="2" opacity="0.06"/>
</svg>`;

// 春天回信 CG：明信片、蓝色书与压在纸上的叶子，对应真结局。
const letterSpringCg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080">
  <defs>
    <linearGradient id="room" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a2230"/>
      <stop offset="1" stop-color="#0b0910"/>
    </linearGradient>
    <radialGradient id="light" cx="1180" cy="420" r="760" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffe6bf" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#ffe6bf" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="card" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff7ea"/>
      <stop offset="1" stop-color="#e9d9c4"/>
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#room)"/>
  <rect width="1920" height="1080" fill="url(#light)"/>
  <polygon points="1180,0 1920,0 1920,1080 760,1080" fill="#ffe6bf" opacity="0.05"/>
  <!-- 桌面 -->
  <polygon points="0,780 1920,720 1920,1080 0,1080" fill="#221a21"/>
  <polygon points="0,780 1920,720 1920,760 0,828" fill="#362a32"/>
  <!-- 蓝色书 -->
  <g transform="translate(520 760) rotate(-6)">
    <rect x="-240" y="-120" width="480" height="220" rx="8" fill="#2c3c58"/>
    <rect x="-240" y="-120" width="480" height="220" rx="8" fill="none" stroke="#182438" stroke-width="6"/>
    <rect x="-224" y="-104" width="448" height="188" rx="4" fill="#3c5374" opacity="0.55"/>
    <path d="M-200 -40 H200" stroke="#c9b98f" stroke-width="3" opacity="0.65"/>
    <path d="M-200 -10 H120" stroke="#c9b98f" stroke-width="2" opacity="0.45"/>
    <path d="M-200 20 H160" stroke="#c9b98f" stroke-width="2" opacity="0.35"/>
    <text x="-210" y="64" font-family="serif" font-size="34" fill="#e9dcc1" opacity="0.8">回声</text>
  </g>
  <!-- 明信片 -->
  <g transform="translate(1230 560) rotate(4)">
    <rect x="-330" y="-230" width="660" height="460" rx="8" fill="url(#card)"/>
    <rect x="-300" y="-200" width="270" height="250" fill="#b9cfd8" opacity="0.55"/>
    <path d="M-300 -40 Q-180 -110 -60 -60 T-30 50 Q-170 40 -300 50 Z" fill="#8faec0" opacity="0.7"/>
    <circle cx="60" cy="-140" r="34" fill="#f3c48f" opacity="0.6"/>
    <g stroke="#9b7f70" stroke-width="2.5" opacity="0.55">
      <path d="M20 40 H290"/><path d="M20 74 H250"/><path d="M20 108 H290"/><path d="M20 142 H210"/>
    </g>
    <path d="M20 180 Q120 160 220 184" fill="none" stroke="#8a6a60" stroke-width="3" opacity="0.4"/>
    <!-- 压平的叶子 -->
    <path d="M250 -60 Q330 -130 390 -60 Q340 10 250 -60 Z" fill="#7d8f5e" opacity="0.8"/>
    <path d="M255 -58 Q320 -70 380 -62" fill="none" stroke="#55633f" stroke-width="2" opacity="0.7"/>
  </g>
  ${dust(83, 48, 1920, 780)}
  <rect y="1000" width="1920" height="80" fill="#05060a" opacity="0.45"/>
</svg>`;

// 后发：画在头部之前，只露出轮廓与两侧长发，避免遮住脸。
// 配色参考经典日式短篇里的银灰发少女，但服装与轮廓为原创设计。
const spriteHairBack = `
  <path d="M198 660 Q128 336 232 178 Q308 66 400 58 Q492 66 568 178 Q672 336 602 660 Q636 824 596 986 L520 912 Q540 780 514 660 L286 660 Q260 780 280 912 L204 986 Q164 824 198 660 Z" fill="#6e6c79"/>
  <path d="M238 640 Q196 380 280 236 Q250 440 262 660 Z" fill="#4d4b58" opacity="0.5"/>
  <path d="M562 640 Q604 380 520 236 Q550 440 538 660 Z" fill="#4d4b58" opacity="0.5"/>
  <path d="M236 330 Q400 250 564 330" fill="none" stroke="#a7a4b0" stroke-width="14" opacity="0.18"/>`;

// 刘海与侧发：画在脸部之后，只覆盖额头与脸颊边缘。
const spriteBangs = `
  <path d="M260 414 Q262 304 332 260 Q400 230 468 258 Q538 302 540 452 Q512 390 470 384 Q430 430 400 390 Q370 430 330 384 Q288 390 260 452 Z" fill="#7c7987"/>
  <path d="M300 240 Q400 160 500 240 Q450 210 400 232 Q352 208 300 240 Z" fill="#b1aeba" opacity="0.4"/>
  <path d="M272 432 Q244 530 268 646 Q286 664 314 646 Q284 556 294 424 Z" fill="#6e6c79"/>
  <path d="M528 432 Q556 530 532 646 Q514 664 486 646 Q516 556 506 424 Z" fill="#6e6c79"/>
  <!-- 两侧的暗红色发带，呼应售货机夜晚的暖光 -->
  <path d="M268 342 Q228 318 218 356 Q248 368 274 352 Z" fill="#a84452"/>
  <path d="M532 342 Q572 318 582 356 Q552 368 526 352 Z" fill="#a84452"/>
  <circle cx="268" cy="346" r="7" fill="#7d2f3c"/>
  <circle cx="532" cy="346" r="7" fill="#7d2f3c"/>`;

/**
 * 生成 800×1200 的立绘：neutral 为睁眼，smile / blush 为眯眼，
 * blush 额外加腮红；头发分前后两层，后发先画以免遮住脸部。
 */
function sprite(variant) {
  const blush =
    variant === 'blush'
      ? `<ellipse cx="308" cy="552" rx="46" ry="20" fill="#e88fa4" opacity="0.45"/>
         <ellipse cx="492" cy="552" rx="46" ry="20" fill="#e88fa4" opacity="0.45"/>`
      : '';
  const eyes =
    variant === 'smile' || variant === 'blush'
      ? `<path d="M294 494 Q330 464 366 494" fill="none" stroke="#2f313a" stroke-width="9" stroke-linecap="round"/>
         <path d="M434 494 Q470 464 506 494" fill="none" stroke="#2f313a" stroke-width="9" stroke-linecap="round"/>`
      : variant === 'sad'
        ? `<path d="M296 492 Q330 516 364 492" fill="none" stroke="#2f313a" stroke-width="8" stroke-linecap="round"/>
           <path d="M436 492 Q470 516 504 492" fill="none" stroke="#2f313a" stroke-width="8" stroke-linecap="round"/>
           <path d="M300 474 Q330 462 360 474" fill="none" stroke="#5e5b68" stroke-width="4" opacity="0.55"/>
           <path d="M440 474 Q470 462 500 474" fill="none" stroke="#5e5b68" stroke-width="4" opacity="0.55"/>`
        : `<ellipse cx="330" cy="486" rx="35" ry="27" fill="#f8f3ee"/>
         <path d="M295 470 Q330 448 365 472" fill="none" stroke="#46434f" stroke-width="7" stroke-linecap="round"/>
         <circle cx="330" cy="489" r="17" fill="#7b7d88"/>
         <circle cx="330" cy="489" r="8" fill="#2f313a"/>
         <circle cx="324" cy="481" r="6" fill="#ffffff" opacity="0.85"/>
         <ellipse cx="470" cy="486" rx="35" ry="27" fill="#f8f3ee"/>
         <path d="M435 472 Q470 448 505 470" fill="none" stroke="#46434f" stroke-width="7" stroke-linecap="round"/>
         <circle cx="470" cy="489" r="17" fill="#7b7d88"/>
         <circle cx="470" cy="489" r="8" fill="#2f313a"/>
         <circle cx="464" cy="481" r="6" fill="#ffffff" opacity="0.85"/>`;
  const mouth =
    variant === 'neutral'
      ? `<path d="M386 588 Q400 596 414 588" fill="none" stroke="#9d5f6b" stroke-width="5" stroke-linecap="round"/>`
      : variant === 'sad'
        ? `<path d="M382 600 Q400 588 418 600" fill="none" stroke="#9d5f6b" stroke-width="5" stroke-linecap="round"/>`
        : `<path d="M378 584 Q400 606 422 584" fill="none" stroke="#9d5f6b" stroke-width="6" stroke-linecap="round"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1200" width="800" height="1200">
  <g>
    <!-- 脖颈先画，随后由衣领覆盖根部，避免出现悬空的细长脖子 -->
    <path d="M352 620 Q400 690 448 620 L448 800 Q400 820 352 800 Z" fill="#f0d8cf"/>
    <path d="M360 664 Q400 702 440 664 Q400 692 360 664 Z" fill="#d9b3a8" opacity="0.35"/>

    <!-- 白色衬衫与泡泡袖，外搭深色背带裙；参考原图的「白衬衫 + 深色连衣裙」层次，但为原创剪裁 -->
    <path d="M292 700 Q250 760 240 850 L222 1200 L578 1200 L560 850 Q550 760 508 700 Q460 760 400 760 Q340 760 292 700 Z" fill="#f2ece4"/>
    <path d="M292 700 Q236 730 226 830 L210 980 L258 990 L280 860 Q292 800 330 764 Z" fill="#f7f2ea"/>
    <path d="M508 700 Q564 730 574 830 L590 980 L542 990 L520 860 Q508 800 470 764 Z" fill="#f7f2ea"/>
    <path d="M292 700 Q250 760 240 850 L222 1200 L272 1200 L284 860 Q292 796 326 760 Z" fill="#e9e2d8" opacity="0.65"/>
    <path d="M508 700 Q550 760 560 850 L578 1200 L528 1200 L516 860 Q508 796 474 760 Z" fill="#e9e2d8" opacity="0.65"/>

    <!-- 背带裙上身与裙摆 -->
    <path d="M304 760 Q350 736 400 736 Q450 736 496 760 L514 1000 L286 1000 Z" fill="#26262d"/>
    <path d="M318 760 L292 700 L312 690 L336 752 Z" fill="#1e1e25"/>
    <path d="M482 760 L508 700 L488 690 L464 752 Z" fill="#1e1e25"/>
    <path d="M270 980 L530 980 L574 1200 L226 1200 Z" fill="#1f1f26"/>
    <path d="M330 1000 L310 1200 M386 1000 L382 1200 M450 1000 L478 1200" stroke="#15151b" stroke-width="10" opacity="0.7"/>
    <path d="M286 980 L514 980 L522 1012 L278 1012 Z" fill="#17171d"/>
    <circle cx="400" cy="930" r="6" fill="#3a3a44"/>
    <circle cx="400" cy="960" r="6" fill="#3a3a44"/>

    <!-- 后发（位于头部之后） -->
    ${spriteHairBack}

    <!-- 头部与耳朵 -->
    <ellipse cx="400" cy="470" rx="158" ry="196" fill="#f6e1d9"/>
    <ellipse cx="400" cy="470" rx="158" ry="196" fill="none" stroke="#d8b9ae" stroke-width="3" opacity="0.5"/>
    <ellipse cx="246" cy="492" rx="22" ry="38" fill="#f0d8cf"/>
    <ellipse cx="554" cy="492" rx="22" ry="38" fill="#f0d8cf"/>

    <!-- 面部红润与刘海 -->
    <ellipse cx="304" cy="548" rx="42" ry="24" fill="#e8b3b6" opacity="0.3"/>
    <ellipse cx="496" cy="548" rx="42" ry="24" fill="#e8b3b6" opacity="0.3"/>
    ${spriteBangs}

    <!-- 眉毛 -->
    <path d="M292 438 Q330 418 368 432" fill="none" stroke="#5e5b68" stroke-width="6" stroke-linecap="round"/>
    <path d="M432 432 Q470 418 508 438" fill="none" stroke="#5e5b68" stroke-width="6" stroke-linecap="round"/>

    ${eyes}
    <path d="M398 512 Q388 550 400 558 Q414 550 404 512" fill="none" stroke="#d1a190" stroke-width="4" opacity="0.7"/>
    ${blush}
    ${mouth}
    <path d="M352 612 Q400 634 448 612" fill="none" stroke="#e8bfb2" stroke-width="3" opacity="0.35"/>

    <!-- 领口：白色荷叶边与黑色缎带蝴蝶结 -->
    <path d="M336 758 Q352 812 400 822 Q448 812 464 758 Q438 782 400 786 Q362 782 336 758 Z" fill="#fbf7f0"/>
    <path d="M336 758 Q326 786 342 806 Q360 792 366 770 Z" fill="#fbf7f0"/>
    <path d="M464 758 Q474 786 458 806 Q440 792 434 770 Z" fill="#fbf7f0"/>
    <path d="M400 806 L358 782 Q342 816 376 832 Z" fill="#1b1b22"/>
    <path d="M400 806 L442 782 Q458 816 424 832 Z" fill="#1b1b22"/>
    <path d="M386 816 Q400 832 414 816 L410 848 Q400 858 390 848 Z" fill="#121218"/>
    <circle cx="400" cy="812" r="8" fill="#0e0e13"/>
  </g>
</svg>`;
}

/* ------------------------------------------------------------------ */
/* 音频（16-bit PCM WAV）                                              */
/* ------------------------------------------------------------------ */

/**
 * 手写 WAV：44 字节文件头 + 16-bit 单声道 PCM。
 * sample 回调返回 [-1, 1] 的浮点采样，写入前 clamp 并缩放为 int16。
 */
function writeWav({ seconds, sampleRate = 22050, sample }) {
  const frames = Math.floor(seconds * sampleRate);
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + frames * 2, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i += 1) {
    const value = Math.max(-1, Math.min(1, sample(i / sampleRate, i, frames)));
    buffer.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }
  return buffer;
}

const TAU = Math.PI * 2;

/** 单个音符：带 0.12s 上升、0.4s 衰减包络的正弦波，超出时间窗返回 0。 */
function note(freq, t, start, duration, gain = 1) {
  if (t < start || t > start + duration) return 0;
  const local = t - start;
  const attack = Math.min(1, local / 0.12);
  const release = Math.min(1, (duration - local) / 0.4);
  const envelope = attack * release;
  return Math.sin(TAU * freq * local) * envelope * gain;
}

/** 生成柔和 BGM：持续和弦 + 两音一组的琶音 + 轻微的缓慢呼吸起伏。 */
function bgmSample(notes, duration, seed) {
  const rng = mulberry32(seed);
  const detune = notes.map(() => (rng() - 0.5) * 0.04);
  return (t) => {
    let value = 0;
    notes.forEach((freq, index) => {
      value += Math.sin(TAU * (freq + detune[index]) * t) * 0.06;
      value += Math.sin(TAU * (freq * 2.01) * t) * 0.018;
    });
    const cycle = t % 4;
    const arpIndex = Math.floor(cycle) % notes.length;
    value += note(notes[arpIndex] * 1.5, t, Math.floor(cycle), 0.9, 0.1);
    value += note(notes[(arpIndex + 2) % notes.length], t, Math.floor(cycle) + 0.55, 0.7, 0.08);
    const breath = Math.sin(TAU * 0.125 * t) * 0.02;
    return value * 0.9 + breath;
  };
}

/** 音效采样：page 为翻页噪点 + 扫频，cup 为两次衰减脉冲模拟瓷杯轻碰。 */
function seSample(kind) {
  const rng = mulberry32(kind === 'page' ? 7 : 11);
  const noise = (i) => rng() * 2 - 1;
  if (kind === 'page') {
    const seconds = 0.42;
    return (t, i, frames) => {
      const progress = i / frames;
      const envelope = Math.sin(Math.PI * Math.min(1, progress * 1.05)) ** 2;
      return noise(i) * envelope * 0.18 + Math.sin(TAU * (900 + progress * 2600) * t) * envelope * 0.05;
    };
  }
  return (t, i, frames) => {
    const progress = i / frames;
    const strike = Math.exp(-progress * 8) * Math.sin(TAU * 1850 * t) * 0.22;
    const second = Math.exp(-Math.max(0, progress - 0.32) * 12) * Math.sin(TAU * 2360 * t) * 0.14;
    return strike + second;
  };
}

/** 雨声：低通白噪声铺底，叠加缓慢的低音与偶尔的滴水声。 */
function rainSample(seed) {
  const rng = mulberry32(seed);
  let low = 0;
  let drip = 0;
  let nextDrip = 0;
  return (t) => {
    const white = rng() * 2 - 1;
    low = low * 0.985 + white * 0.015;
    if (t > nextDrip) {
      drip = 1;
      nextDrip = t + 0.4 + rng() * 1.8;
    }
    drip *= 0.996;
    const pad = Math.sin(TAU * 110 * t) * 0.016 + Math.sin(TAU * 164.81 * t) * 0.01;
    return low * 0.55 + pad + Math.sin(TAU * 1200 * t) * drip * 0.015;
  };
}

/** 闭馆铃：基频 + 两个泛音，指数衰减，尾音留一点拍频。 */
function bellSample() {
  return (t) => {
    const envelope = Math.exp(-t * 1.1);
    const value =
      Math.sin(TAU * 880 * t) + 0.45 * Math.sin(TAU * 1320 * t) + 0.22 * Math.sin(TAU * 1760 * t);
    return value * envelope * 0.16 + Math.sin(TAU * 0.5 * t) * 0.004;
  };
}

/** 硬币落掌：两个高频金属脉冲，第二个略低，模拟两枚硬币相碰。 */
function coinSample() {
  return (t) => {
    const first = Math.exp(-t * 18) * Math.sin(TAU * 3100 * t) * 0.18;
    const second = t < 0.08 ? 0 : Math.exp(-(t - 0.08) * 22) * Math.sin(TAU * 2550 * (t - 0.08)) * 0.13;
    return first + second;
  };
}

/** 易拉罐：拉环轻响 + 一点气泡噪声。 */
function canSample() {
  const rng = mulberry32(37);
  const noise = () => rng() * 2 - 1;
  return (t, i, frames) => {
    const progress = i / frames;
    const pull = Math.exp(-progress * 20) * Math.sin(TAU * 1800 * t) * 0.16;
    const fizz = Math.exp(-progress * 4) * noise() * 0.02;
    return pull + fizz;
  };
}

/** 椅子轻响：短促的噪声摩擦 + 一次低频闷响。 */
function chairSample() {
  const rng = mulberry32(29);
  const noise = () => rng() * 2 - 1;
  return (t, i, frames) => {
    const progress = i / frames;
    const scrape = noise() * Math.sin(Math.PI * Math.min(1, progress * 1.4)) * 0.08;
    const thump = Math.exp(-progress * 9) * Math.sin(TAU * 120 * t) * 0.16;
    return scrape + thump;
  };
}

/* ------------------------------------------------------------------ */
/* PNG / ICO                                                           */
/* ------------------------------------------------------------------ */

// PNG 使用 CRC32 校验每个 chunk；查表实现避免引入第三方依赖。
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 组装一个 PNG chunk：长度 + 类型 + 数据 + CRC。 */
function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/**
 * 手写最小 PNG：RGBA8、无交错，每行前置 filter 0，再用 zlib level 9 压缩像素数据。
 * pixels 为 width × height × 4 的原始 RGBA 缓冲。
 */
function encodePng(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 程序化绘制图标：径向光晕 + 菱形高光 + 十字星光，并用圆角公式裁切四角。 */
function iconPixels(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const s = size / 256;
  const cx = 128 * s;
  const cy = 128 * s;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const radius = Math.hypot(dx, dy);
      const glow = Math.max(0, 1 - radius / (118 * s));
      let r = 10 + glow * 34;
      let g = 12 + glow * 24;
      let b = 24 + glow * 40;

      const diamond = Math.abs(dx) + Math.abs(dy);
      if (diamond < 96 * s) {
        const edge = Math.max(0, 1 - diamond / (96 * s));
        r = r * (1 - edge * 0.65) + 230 * edge * 0.65;
        g = g * (1 - edge * 0.65) + 154 * edge * 0.65;
        b = b * (1 - edge * 0.65) + 180 * edge * 0.65;
      }

      const sparkle = Math.abs(dx) < 6 * s && Math.abs(dy) < 92 * s;
      const sparkleH = Math.abs(dy) < 6 * s && Math.abs(dx) < 92 * s;
      const inner = Math.hypot(dx, dy) < 18 * s;
      if (sparkle || sparkleH || inner) {
        r = 255;
        g = 232;
        b = 241;
      }

      const corner = Math.hypot(Math.max(0, Math.abs(dx) - 104 * s), Math.max(0, Math.abs(dy) - 104 * s));
      const rounded = Math.min(1, Math.max(0, (24 * s - corner) / (4 * s)));
      pixels[index] = Math.round(r);
      pixels[index + 1] = Math.round(g);
      pixels[index + 2] = Math.round(b);
      pixels[index + 3] = Math.round(255 * (corner > 24 * s ? 0 : rounded));
    }
  }
  return pixels;
}

/**
 * 组装 ICO：每个尺寸内嵌一张 PNG，目录项记录偏移与大小；
 * 宽 / 高为 256 时目录项写 0（ICO 规范的约定）。
 */
function encodeIco(sizes) {
  const pngs = sizes.map((size) => {
    const png = encodePng(size, size, iconPixels(size));
    return { size, png };
  });

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);

  let offset = 6 + pngs.length * 16;
  const entries = pngs.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...pngs.map(({ png }) => png)]);
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

/** 生成全部占位资源：背景 / 立绘 / CG、BGM / 音效 / 语音，以及 Electron 图标。 */
async function main() {
  console.log('生成 SVG 美术…');
  const bgDir = await ensure(GAME, 'images/bg');
  const spriteDir = await ensure(GAME, 'images/sprite');
  const cgDir = await ensure(GAME, 'images/cg');
  const bgmDir = await ensure(GAME, 'audio/bgm');
  const seDir = await ensure(GAME, 'audio/se');

  await write(path.join(bgDir, 'title.svg'), titleArt);
  await write(
    path.join(bgDir, 'library_afternoon.svg'),
    libraryScene({
      skyTop: '#b9c8dd',
      skyBottom: '#f3d9c1',
      wallTop: '#1a1c2c',
      wallBottom: '#0d0f18',
      glow: '#ffdcb8',
      beam: '#ffe7c9',
      floor: '#1a1620',
      accent: '#e69ab4',
      seed: 41,
      variant: 'afternoon',
    }),
  );
  await write(
    path.join(bgDir, 'library_tea.svg'),
    libraryScene({
      skyTop: '#d9b9b0',
      skyBottom: '#f6ddc4',
      wallTop: '#231a26',
      wallBottom: '#120e16',
      glow: '#ffd5c4',
      beam: '#ffe2d2',
      floor: '#1d151b',
      accent: '#e69ab4',
      seed: 57,
      variant: 'tea',
    }),
  );
  await write(
    path.join(bgDir, 'library_sunset.svg'),
    libraryScene({
      skyTop: '#5a3d55',
      skyBottom: '#eaa06f',
      wallTop: '#241a24',
      wallBottom: '#0c0b12',
      glow: '#ffb98a',
      beam: '#ffcf9e',
      floor: '#19121a',
      accent: '#d9bd88',
      seed: 73,
      variant: 'sunset',
    }),
  );
  await write(
    path.join(bgDir, 'library_evening.svg'),
    libraryScene({
      skyTop: '#34304d',
      skyBottom: '#8a6474',
      wallTop: '#1b1828',
      wallBottom: '#09080f',
      glow: '#d8b6a6',
      beam: '#e4cbb8',
      floor: '#15111a',
      accent: '#9c8aa8',
      seed: 91,
      variant: 'evening',
    }),
  );
  await write(path.join(bgDir, 'music_room.svg'), musicRoomArt);
  await write(path.join(bgDir, 'rooftop_sunset.svg'), rooftopArt);
  await write(path.join(bgDir, 'street_night.svg'), streetNightArt);
  await write(path.join(bgDir, 'bus_stop_night.svg'), busStopNightArt);

  for (const variant of ['neutral', 'smile', 'blush', 'sad']) {
    await write(path.join(spriteDir, `sylvie_${variant}.svg`), sprite(variant));
  }

  await write(path.join(cgDir, 'tea_steam.svg'), teaCg);
  await write(path.join(cgDir, 'book_glow.svg'), bookCg);
  await write(path.join(cgDir, 'piano_keys.svg'), pianoKeysCg);
  await write(path.join(cgDir, 'rooftop_sky.svg'), rooftopSkyCg);
  await write(path.join(cgDir, 'letter_spring.svg'), letterSpringCg);

  if (PLACEHOLDER_AUDIO) {
  console.log('生成占位音频…');
  const afternoon = [261.63, 329.63, 392.0, 440.0, 329.63, 392.0, 523.25, 440.0];
  await writeAudio(
    path.join(bgmDir, 'afternoon.wav'),
    writeWav({ seconds: 16, sample: bgmSample(afternoon, 16, 101) }),
  );
  const sunset = [220.0, 261.63, 329.63, 349.3, 261.63, 329.63, 392.0, 349.3];
  await writeAudio(
    path.join(bgmDir, 'sunset.wav'),
    writeWav({ seconds: 16, sample: bgmSample(sunset, 16, 202) }),
  );
  const musicBox = [523.25, 659.25, 783.99, 659.25, 587.33, 493.88, 523.25, 392.0];
  await writeAudio(
    path.join(bgmDir, 'music_box.wav'),
    writeWav({ seconds: 16, sample: bgmSample(musicBox, 16, 303) }),
  );
  const rooftop = [293.66, 369.99, 440.0, 369.99, 329.63, 415.3, 493.88, 415.3];
  await writeAudio(
    path.join(bgmDir, 'rooftop.wav'),
    writeWav({ seconds: 16, sample: bgmSample(rooftop, 16, 404) }),
  );
  await writeAudio(
    path.join(bgmDir, 'rain.wav'),
    writeWav({ seconds: 16, sample: rainSample(505) }),
  );
  const night = [196.0, 246.94, 293.66, 329.63, 246.94, 293.66, 369.99, 329.63];
  await writeAudio(
    path.join(bgmDir, 'night.wav'),
    writeWav({ seconds: 16, sample: bgmSample(night, 16, 606) }),
  );
  const river = [174.61, 220.0, 261.63, 329.63, 261.63, 220.0, 196.0, 174.61];
  await writeAudio(
    path.join(bgmDir, 'river.wav'),
    writeWav({ seconds: 16, sample: bgmSample(river, 16, 707) }),
  );

  await writeAudio(
    path.join(seDir, 'page_turn.wav'),
    writeWav({ seconds: 0.42, sample: seSample('page') }),
  );
  await writeAudio(
    path.join(seDir, 'tea_cup.wav'),
    writeWav({ seconds: 0.6, sample: seSample('cup') }),
  );
  await writeAudio(path.join(seDir, 'bell.wav'), writeWav({ seconds: 2.8, sample: bellSample() }));
  await writeAudio(path.join(seDir, 'chair.wav'), writeWav({ seconds: 0.52, sample: chairSample() }));
  await writeAudio(path.join(seDir, 'coin.wav'), writeWav({ seconds: 0.36, sample: coinSample() }));
  await writeAudio(path.join(seDir, 'can.wav'), writeWav({ seconds: 0.5, sample: canSample() }));

  } else {
    console.log('跳过音频：保留仓库内 CC0 / 正式素材（需要旧占位请加 --placeholder-audio）');
  }

  console.log('生成图标…');
  await ensure(ASSETS);
  await write(path.join(ASSETS, 'icon.png'), encodePng(256, 256, iconPixels(256)));
  await write(path.join(ASSETS, 'icon.ico'), encodeIco([16, 32, 48, 64, 128, 256]));

  console.log('完成。');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
