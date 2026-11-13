import { Howl } from 'howler';

export interface AudioVolumes {
  bgm: number;
  se: number;
  voice: number;
}

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * 三类音频独立管理：
 * - BGM 单实例，切换时交叉淡入淡出；
 * - SE 允许多个短音重叠；
 * - VO 单实例，新语音打断上一条。
 */
export class AudioManager {
  private bgm: Howl | null = null;
  private bgmTrack: string | null = null;
  private voice: Howl | null = null;
  private volumes: AudioVolumes = { bgm: 0.7, se: 0.8, voice: 0.9 };
  private preloaded = new Map<string, HTMLAudioElement>();
  private disposed = false;

  constructor(private readonly resolveUrl: (path: string) => string) {}

  setVolumes(volumes: AudioVolumes): void {
    this.volumes = {
      bgm: clamp(volumes.bgm),
      se: clamp(volumes.se),
      voice: clamp(volumes.voice),
    };
    this.bgm?.volume(this.volumes.bgm);
    this.voice?.volume(this.volumes.voice);
  }

  playBgm(track: string | null, fade = 500, loop = true, position = 0): void {
    if (this.disposed) return;
    if (!track) {
      this.stopBgm(fade);
      return;
    }
    if (this.bgmTrack === track && this.bgm) {
      if (position > 0) {
        const current = this.bgm.seek();
        if (typeof current === 'number' && Math.abs(current - position) > 1) {
          this.bgm.seek(position);
        }
      }
      return;
    }

    const previous = this.bgm;
    if (previous) {
      const previousFade = Math.max(50, fade);
      previous.fade(previous.volume(), 0, previousFade);
      window.setTimeout(() => {
        previous.stop();
        previous.unload();
      }, previousFade + 80);
    }

    const howl = new Howl({
      src: [this.resolveUrl(track)],
      loop,
      volume: 0,
      html5: false,
    });
    howl.play();
    howl.fade(0, this.volumes.bgm, Math.max(50, fade));
    if (position > 0) {
      howl.seek(position);
    }
    this.bgm = howl;
    this.bgmTrack = track;
  }

  /** 当前 BGM 播放位置（秒）；没有 BGM 时返回 0。 */
  getBgmPosition(): number {
    const position = this.bgm?.seek();
    return typeof position === 'number' && Number.isFinite(position) ? Math.max(0, position) : 0;
  }

  stopBgm(fade = 500): void {
    const current = this.bgm;
    this.bgm = null;
    this.bgmTrack = null;
    if (!current) return;
    const duration = Math.max(50, fade);
    current.fade(current.volume(), 0, duration);
    window.setTimeout(() => {
      current.stop();
      current.unload();
    }, duration + 80);
  }

  playSe(sound: string, volumeScale = 1): void {
    if (this.disposed || !sound) return;
    const howl = new Howl({
      src: [this.resolveUrl(sound)],
      volume: clamp(this.volumes.se * volumeScale),
      html5: false,
    });
    howl.once('end', () => howl.unload());
    howl.play();
  }

  playVoice(sound: string | null): void {
    if (this.disposed || !sound) return;
    if (this.voice) {
      this.voice.stop();
      this.voice.unload();
    }
    const howl = new Howl({
      src: [this.resolveUrl(sound)],
      volume: this.volumes.voice,
      html5: false,
    });
    howl.once('end', () => {
      if (this.voice === howl) {
        this.voice = null;
      }
      howl.unload();
    });
    howl.play();
    this.voice = howl;
  }

  /** 进入场景时预加载图片与音频，减少切换卡顿。 */
  preloadAudio(paths: string[]): void {
    if (this.disposed) return;
    for (const path of paths) {
      if (!/\.(wav|mp3|ogg|m4a|flac)$/i.test(path)) continue;
      if (this.preloaded.has(path)) continue;
      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = this.resolveUrl(path);
      this.preloaded.set(path, audio);
      audio.load();
    }
  }

  stopAll(): void {
    this.stopBgm(100);
    if (this.voice) {
      this.voice.stop();
      this.voice.unload();
      this.voice = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stopBgm(0);
    if (this.voice) {
      this.voice.stop();
      this.voice.unload();
      this.voice = null;
    }
    for (const audio of this.preloaded.values()) {
      audio.src = '';
    }
    this.preloaded.clear();
  }
}
