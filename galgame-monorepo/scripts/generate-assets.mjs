#!/usr/bin/env node
/**
 * 生成占位美术、音频与图标资源。
 * 不依赖任何第三方包：SVG 直接编写，WAV 用 16-bit PCM，PNG/ICO 用 zlib 手写。
 *
 * 可重复执行，每次都会覆盖同名占位文件；替换为正式素材后不要再运行，
 * 否则新素材会被占位内容覆盖。
 */
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 输出位置：游戏内容包（美术 / 音频）与 Electron 外壳图标目录。
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const GAME = path.join(ROOT, 'packages/game-content/game');
const ASSETS = path.join(ROOT, 'apps/electron/assets');

/** 确保目录存在并返回拼接后的绝对路径。 */
const ensure = async (...segments) => {
  const target = path.join(...segments);
  await mkdir(target, { recursive: true });
  return target;
};

/** 写入文件（自动建目录）并打印相对仓库根的输出路径。 */
const write = async (file, data) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
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

// 标题画面：拱形长窗、书架剪影与窗边少女，与游戏主色调一致。
const titleArt = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1c1a2e"/>
      <stop offset="0.55" stop-color="#6a4356"/>
      <stop offset="1" stop-color="#e5a58c"/>
    </linearGradient>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#141522"/>
      <stop offset="1" stop-color="#070810"/>
    </linearGradient>
    <radialGradient id="glow" cx="1260" cy="420" r="760" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffd7b0" stop-opacity="0.8"/>
      <stop offset="0.5" stop-color="#f3a98f" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#f3a98f" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="beam" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffe6c8" stop-opacity="0.3"/>
      <stop offset="1" stop-color="#ffe6c8" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#wall)"/>
  <rect width="1920" height="1080" fill="url(#glow)"/>

  <!-- 拱形长窗 -->
  <g>
    <rect x="1010" y="86" width="760" height="820" rx="28" fill="#0b0d16"/>
    <path d="M1042 906 L1042 360 Q1042 130 1390 118 Q1738 130 1738 360 L1738 906 Z" fill="url(#sky)"/>
    <path d="M1042 906 L1042 360 Q1042 130 1390 118 Q1738 130 1738 360 L1738 906 Z" fill="none" stroke="#2a2433" stroke-width="14"/>
    <rect x="1382" y="118" width="16" height="788" fill="#1a1826" opacity="0.86"/>
    <rect x="1042" y="470" width="696" height="14" fill="#1a1826" opacity="0.86"/>
    <rect x="1042" y="700" width="696" height="12" fill="#1a1826" opacity="0.7"/>
    <circle cx="1280" cy="300" r="86" fill="#ffe0bd" opacity="0.2"/>
    <path d="M1080 720 Q1200 660 1340 700 T1700 668" fill="none" stroke="#fff3e2" stroke-width="4" opacity="0.14"/>
  </g>
  <polygon points="1120,140 1500,140 1330,1080 800,1080" fill="url(#beam)" opacity="0.8"/>

  <!-- 书架剪影 -->
  <g opacity="0.72">
    ${bookshelf(120, 250, 300, 610, 73)}
    ${bookshelf(500, 300, 260, 560, 91)}
    <rect x="840" y="620" width="120" height="240" fill="#12141f"/>
  </g>

  <!-- 桌与书 -->
  <polygon points="700,820 1560,820 1650,872 610,872" fill="#15131f"/>
  <rect x="640" y="872" width="1040" height="28" fill="#0e0d18"/>
  <g transform="translate(1150 800)">
    <rect x="-120" y="0" width="240" height="20" rx="4" fill="#6b4b58"/>
    <rect x="-96" y="-18" width="192" height="18" rx="3" fill="#8d5b6d"/>
    <rect x="-64" y="-34" width="128" height="16" rx="3" fill="#5b6d8d"/>
  </g>
  <ellipse cx="1200" cy="1010" rx="640" ry="70" fill="#05060a" opacity="0.34"/>

  <!-- 窗边立读的少女剪影 -->
  <g transform="translate(1500 400)" opacity="0.92">
    <ellipse cx="0" cy="10" rx="92" ry="108" fill="#1a1520"/>
    <path d="M-96 120 Q-150 220 -130 520 L130 520 Q150 220 96 120 Z" fill="#1a1520"/>
    <path d="M80 470 L210 430 L208 448 L86 492 Z" fill="#1a1520"/>
    <path d="M80 250 L230 140" stroke="#1a1520" stroke-width="38" stroke-linecap="round"/>
    <path d="M-60 120 Q-30 40 10 66 Q60 30 74 120 Q72 260 0 292 Q-70 260 -60 120 Z" fill="#1a1520"/>
    <path d="M-42 96 Q-8 62 34 96 Q8 150 -34 142 Z" fill="#2a2230" opacity="0.5"/>
  </g>

  ${dust(17, 64, 1920, 900)}
  <rect y="950" width="1920" height="130" fill="#05060a" opacity="0.55"/>
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

// 后发：画在头部之前，只露出轮廓与两侧长发，避免遮住脸。
const spriteHairBack = `
  <path d="M198 660 Q128 336 232 178 Q308 66 400 58 Q492 66 568 178 Q672 336 602 660 Q636 824 596 986 L520 912 Q540 780 514 660 L286 660 Q260 780 280 912 L204 986 Q164 824 198 660 Z" fill="#b78aa2"/>
  <path d="M238 640 Q196 380 280 236 Q250 440 262 660 Z" fill="#8f667d" opacity="0.45"/>
  <path d="M562 640 Q604 380 520 236 Q550 440 538 660 Z" fill="#8f667d" opacity="0.45"/>`;

// 刘海与侧发：画在脸部之后，只覆盖额头与脸颊边缘。
const spriteBangs = `
  <path d="M260 414 Q262 304 332 260 Q400 230 468 258 Q538 302 540 414 Q512 350 470 344 Q430 390 400 350 Q370 390 330 344 Q288 350 260 414 Z" fill="#c497ad"/>
  <path d="M300 240 Q400 160 500 240 Q450 210 400 232 Q352 208 300 240 Z" fill="#d8aec2" opacity="0.45"/>
  <path d="M272 402 Q244 512 268 632 Q286 664 314 646 Q284 556 294 424 Z" fill="#b78aa2"/>
  <path d="M528 402 Q556 512 532 632 Q514 664 486 646 Q516 556 506 424 Z" fill="#b78aa2"/>`;

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
      ? `<path d="M294 494 Q330 464 366 494" fill="none" stroke="#3b2a35" stroke-width="9" stroke-linecap="round"/>
         <path d="M434 494 Q470 464 506 494" fill="none" stroke="#3b2a35" stroke-width="9" stroke-linecap="round"/>`
      : `<ellipse cx="330" cy="486" rx="35" ry="27" fill="#fbf3ee"/>
         <path d="M295 470 Q330 448 365 472" fill="none" stroke="#4a3341" stroke-width="7" stroke-linecap="round"/>
         <circle cx="330" cy="489" r="17" fill="#8a5f74"/>
         <circle cx="330" cy="489" r="8" fill="#3b2a35"/>
         <circle cx="324" cy="481" r="6" fill="#ffffff" opacity="0.85"/>
         <ellipse cx="470" cy="486" rx="35" ry="27" fill="#fbf3ee"/>
         <path d="M435 472 Q470 448 505 470" fill="none" stroke="#4a3341" stroke-width="7" stroke-linecap="round"/>
         <circle cx="470" cy="489" r="17" fill="#8a5f74"/>
         <circle cx="470" cy="489" r="8" fill="#3b2a35"/>
         <circle cx="464" cy="481" r="6" fill="#ffffff" opacity="0.85"/>`;
  const mouth =
    variant === 'neutral'
      ? `<path d="M386 588 Q400 596 414 588" fill="none" stroke="#9d5f6b" stroke-width="5" stroke-linecap="round"/>`
      : `<path d="M378 584 Q400 606 422 584" fill="none" stroke="#9d5f6b" stroke-width="6" stroke-linecap="round"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1200" width="800" height="1200">
  <g>
    <!-- 身体与外套 -->
    <path d="M260 1200 L262 900 Q266 810 340 782 L460 782 Q534 810 538 900 L540 1200 Z" fill="#1b2338"/>
    <path d="M340 782 L400 900 L460 782 L430 742 L370 742 Z" fill="#f3eee8"/>
    <path d="M376 790 L400 860 L424 790 L400 774 Z" fill="#e69ab4"/>
    <path d="M370 742 L330 806 L378 810 Z" fill="#252f49"/>
    <path d="M430 742 L470 806 L422 810 Z" fill="#252f49"/>
    <path d="M262 900 L214 1000 L240 1200 L282 1200 L276 1000 Z" fill="#161d2f"/>
    <path d="M538 900 L586 1000 L560 1200 L518 1200 L524 1000 Z" fill="#161d2f"/>
    <path d="M300 1200 L302 940 L356 918 L356 1200 Z" fill="#161d2f" opacity="0.7"/>
    <path d="M500 1200 L498 940 L444 918 L444 1200 Z" fill="#161d2f" opacity="0.7"/>

    <!-- 脖颈 -->
    <path d="M356 702 Q400 742 444 702 L444 780 Q400 806 356 780 Z" fill="#efc7b8"/>

    <!-- 后发（位于头部之后） -->
    ${spriteHairBack}

    <!-- 头部与耳朵 -->
    <ellipse cx="400" cy="470" rx="158" ry="196" fill="#f6ddd2"/>
    <ellipse cx="400" cy="470" rx="158" ry="196" fill="none" stroke="#d9ad9e" stroke-width="3" opacity="0.5"/>
    <ellipse cx="246" cy="492" rx="22" ry="38" fill="#efc7b8"/>
    <ellipse cx="554" cy="492" rx="22" ry="38" fill="#efc7b8"/>

    <!-- 面部红润与刘海 -->
    <ellipse cx="304" cy="548" rx="42" ry="24" fill="#efb9b4" opacity="0.3"/>
    <ellipse cx="496" cy="548" rx="42" ry="24" fill="#efb9b4" opacity="0.3"/>
    ${spriteBangs}

    <!-- 眉毛 -->
    <path d="M292 438 Q330 418 368 432" fill="none" stroke="#7c566a" stroke-width="6" stroke-linecap="round"/>
    <path d="M432 432 Q470 418 508 438" fill="none" stroke="#7c566a" stroke-width="6" stroke-linecap="round"/>

    ${eyes}
    <path d="M398 512 Q388 550 400 558 Q414 550 404 512" fill="none" stroke="#d1a190" stroke-width="4" opacity="0.7"/>
    ${blush}
    ${mouth}
    <path d="M352 612 Q400 634 448 612" fill="none" stroke="#e8bfb2" stroke-width="3" opacity="0.35"/>

    <!-- 领口装饰 -->
    <path d="M370 780 Q340 806 350 846 Q378 824 400 842 Q422 824 450 846 Q460 806 430 780 Z" fill="#f3eee8"/>
    <path d="M400 790 L400 842" stroke="#d9cfc6" stroke-width="3" opacity="0.5"/>
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

/** 生成占位“语音”：把若干带颤音的音节事件拼成一段无意义的旋律。 */
function voiceSample(seed, baseFreq) {
  const rng = mulberry32(seed);
  const syllables = 5 + Math.floor(rng() * 3);
  const events = [];
  let cursor = 0.12;
  for (let i = 0; i < syllables; i += 1) {
    const length = 0.12 + rng() * 0.16;
    events.push({ start: cursor, length, pitch: baseFreq + (rng() - 0.5) * 40 });
    cursor += length + 0.06 + rng() * 0.08;
  }
  return (t) => {
    let value = 0;
    for (const event of events) {
      if (t < event.start || t > event.start + event.length) continue;
      const local = t - event.start;
      const envelope = Math.sin((Math.PI * local) / event.length) ** 1.4;
      const vibrato = Math.sin(TAU * 5.4 * local) * 0.06;
      value += Math.sin(TAU * event.pitch * local * (1 + vibrato)) * envelope * 0.16;
      value += Math.sin(TAU * event.pitch * 2.7 * local) * envelope * 0.05;
      value += Math.sin(TAU * 620 * local) * envelope * 0.03;
    }
    return value + Math.sin(TAU * 0.7 * t) * 0.002;
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
  const voiceDir = await ensure(GAME, 'audio/voice');

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

  for (const variant of ['neutral', 'smile', 'blush']) {
    await write(path.join(spriteDir, `sylvie_${variant}.svg`), sprite(variant));
  }

  await write(path.join(cgDir, 'tea_steam.svg'), teaCg);
  await write(path.join(cgDir, 'book_glow.svg'), bookCg);

  console.log('生成音频…');
  const afternoon = [261.63, 329.63, 392.0, 440.0, 329.63, 392.0, 523.25, 440.0];
  await write(
    path.join(bgmDir, 'afternoon.wav'),
    writeWav({ seconds: 16, sample: bgmSample(afternoon, 16, 101) }),
  );
  const sunset = [220.0, 261.63, 329.63, 349.3, 261.63, 329.63, 392.0, 349.3];
  await write(
    path.join(bgmDir, 'sunset.wav'),
    writeWav({ seconds: 16, sample: bgmSample(sunset, 16, 202) }),
  );

  await write(
    path.join(seDir, 'page_turn.wav'),
    writeWav({ seconds: 0.42, sample: seSample('page') }),
  );
  await write(
    path.join(seDir, 'tea_cup.wav'),
    writeWav({ seconds: 0.6, sample: seSample('cup') }),
  );

  const voices = [
    ['sylvie_01.wav', 11, 218],
    ['sylvie_02.wav', 22, 232],
    ['sylvie_03.wav', 33, 208],
    ['sylvie_04.wav', 44, 226],
    ['narrator_01.wav', 55, 164],
  ];
  for (const [file, seed, baseFreq] of voices) {
    await write(path.join(voiceDir, file), writeWav({ seconds: 2.4, sample: voiceSample(seed, baseFreq) }));
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
