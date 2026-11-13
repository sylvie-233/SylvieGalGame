import { Howl } from 'howler';

/** 三类音频的相对音量，取值 0–1；由设置面板写入，播放前会再次裁剪。 */
export interface AudioVolumes {
  bgm: number;
  se: number;
  voice: number;
}

/** 把任意输入限制到合法音量区间，避免设置或脚本传入越界值。 */
const clamp = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * 播放器音频通道管理器，封装 Howler，按通道隔离 BGM / SE / 语音：
 * - BGM 单实例，切换曲目时旧实例淡出后卸载，新实例淡入；
 * - SE 允许多个短音重叠，播放结束自动卸载；
 * - 语音单实例，新语音打断上一条。
 *
 * 实例由 {@link GameApp} 持有，随组件卸载调用 {@link AudioManager.dispose}。
 * 所有路径先经构造时注入的 resolveUrl 映射为宿主可访问的 URL。
 */
export class AudioManager {
  private bgm: Howl | null = null;
  private bgmTrack: string | null = null;
  private voice: Howl | null = null;
  private volumes: AudioVolumes = { bgm: 0.7, se: 0.8, voice: 0.9 };
  private preloaded = new Map<string, HTMLAudioElement>();
  private disposed = false;
  /** 小游戏等需要专注听觉的场景会临时压低 BGM，不改动玩家设置。 */
  private bgmDucked = false;

  /**
   * @param resolveUrl 把内容包相对路径转换为可播放 URL
   *   （Electron 走 `game://`，Web 走 `/game` HTTP）。
   */
  constructor(private readonly resolveUrl: (path: string) => string) {}

  /** 更新三类音量并立即应用到当前 BGM / 语音；输入会被裁剪到 0–1。 */
  setVolumes(volumes: AudioVolumes): void {
    this.volumes = {
      bgm: clamp(volumes.bgm),
      se: clamp(volumes.se),
      voice: clamp(volumes.voice),
    };
    this.bgm?.volume(this.bgmTargetVolume());
    this.voice?.volume(this.volumes.voice);
  }

  /** BGM 的当前目标音量：设置音量在压低状态下乘以一个很小但非零的系数。 */
  private bgmTargetVolume(): number {
    return this.volumes.bgm * (this.bgmDucked ? 0.12 : 1);
  }

  /** 临时压低 / 恢复 BGM；小游戏覆盖层期间调用，不写入玩家设置。 */
  setBgmDucked(ducked: boolean, fade = 400): void {
    if (this.bgmDucked === ducked) return;
    this.bgmDucked = ducked;
    this.bgm?.fade(this.bgm.volume(), this.bgmTargetVolume(), Math.max(50, fade));
  }

  /**
   * 播放或切换 BGM。
   * - `track` 为 null 时按 `fade` 淡出当前曲目；
   * - 同一曲目重复调用不会重启，仅在传入 `position` 且与当前进度相差超过 1 秒时 seek；
   * - 切换曲目时旧实例先淡出、延迟卸载，新实例从 0 淡入。
   *
   * @param track 内容包内的音频相对路径
   * @param fade 淡入淡出时长（毫秒），内部最少按 50ms 处理
   * @param loop 是否循环
   * @param position 起始播放位置（秒），0 表示从头播放
   */
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
    howl.fade(0, this.bgmTargetVolume(), Math.max(50, fade));
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

  /** 淡出后停止并卸载当前 BGM；淡出时长同样最少按 50ms 处理。 */
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

  /**
   * 播放一次性音效；多个音效允许重叠。
   * 音量按设置中的 SE 音量乘以 `volumeScale` 后裁剪，播放结束自动释放实例。
   */
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

  /** 播放语音；若上一条仍在播放会被立即打断并卸载，保证同时只有一条语音。 */
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

  /**
   * 进入场景时预加载音频，减少切换卡顿。
   * 只处理常见音频扩展名，已预加载的路径会跳过；预加载表最多保留 maxEntries 条，
   * 按插入顺序淘汰最旧的条目并清空其 src，避免长会话持续占用内存。
   *
   * 预加载使用的是独立于 Howler 的 HTMLAudioElement，只负责把数据拉进浏览器缓存。
   */
  preloadAudio(paths: string[], maxEntries = 24): void {
    if (this.disposed) return;
    for (const path of paths) {
      if (!/\.(wav|mp3|ogg|m4a|flac)$/i.test(path)) continue;
      if (this.preloaded.has(path)) continue;
      while (this.preloaded.size >= maxEntries) {
        const oldest = this.preloaded.keys().next().value;
        if (oldest === undefined) break;
        const audio = this.preloaded.get(oldest);
        if (audio) audio.src = '';
        this.preloaded.delete(oldest);
      }
      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = this.resolveUrl(path);
      this.preloaded.set(path, audio);
      audio.load();
    }
  }

  /** 清场：停止 BGM 与语音（开始游戏 / 读档 / 返回标题时使用）；一次性音效不受影响。 */
  stopAll(): void {
    this.stopBgm(100);
    if (this.voice) {
      this.voice.stop();
      this.voice.unload();
      this.voice = null;
    }
  }

  /** 释放所有音频实例与预加载缓存；标记 disposed 后所有播放调用都会被忽略。 */
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
