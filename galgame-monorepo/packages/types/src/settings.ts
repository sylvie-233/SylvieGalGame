/** 字体族预设，由播放器映射到实际 CSS font-family。 */
export type FontChoice = 'serif' | 'sans' | 'kai';

/** 用户可调设置；读取时统一走 normalizeSettings 做容错与区间夹取。 */
export interface GameSettings {
  bgmVolume: number;
  seVolume: number;
  voiceVolume: number;
  /** 每秒输出的字符数。 */
  textSpeed: number;
  /** Auto 模式下文字显示完后的等待毫秒数。 */
  autoDelay: number;
  font: FontChoice;
  fullscreen: boolean;
}

/** 新用户或读取失败时使用的默认设置。 */
export const DEFAULT_SETTINGS: GameSettings = {
  bgmVolume: 0.7,
  seVolume: 0.8,
  voiceVolume: 0.9,
  textSpeed: 40,
  autoDelay: 900,
  font: 'serif',
  fullscreen: false,
};

/**
 * 容错归一化设置：非对象、缺字段、非法类型一律回退默认值，
 * 数值限制在对应区间，防止手改存档导致音量越界或文字速度异常。
 */
export function normalizeSettings(value: unknown): GameSettings {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  // 数值字段统一做有限性检查与区间夹取；整数型再四舍五入。
  const numberInRange = (key: keyof GameSettings, min: number, max: number): number => {
    const raw = source[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return DEFAULT_SETTINGS[key] as number;
    }
    return Math.min(max, Math.max(min, raw));
  };
  const font = source.font;
  return {
    bgmVolume: numberInRange('bgmVolume', 0, 1),
    seVolume: numberInRange('seVolume', 0, 1),
    voiceVolume: numberInRange('voiceVolume', 0, 1),
    textSpeed: Math.round(numberInRange('textSpeed', 5, 120)),
    autoDelay: Math.round(numberInRange('autoDelay', 200, 5000)),
    font: font === 'sans' || font === 'kai' || font === 'serif' ? font : DEFAULT_SETTINGS.font,
    fullscreen: typeof source.fullscreen === 'boolean' ? source.fullscreen : false,
  };
}
