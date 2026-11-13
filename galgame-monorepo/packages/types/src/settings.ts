export type FontChoice = 'serif' | 'sans' | 'kai';

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

export const DEFAULT_SETTINGS: GameSettings = {
  bgmVolume: 0.7,
  seVolume: 0.8,
  voiceVolume: 0.9,
  textSpeed: 40,
  autoDelay: 900,
  font: 'serif',
  fullscreen: false,
};

export function normalizeSettings(value: unknown): GameSettings {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
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
