/**
 * 极简 WebAudio 合成器。
 *
 * 小游戏不加载任何音频资源：钢琴音由三角波 + 一个八度泛音现场合成，
 * 这样既能听见音高，也不会把游戏包体积再扩大。浏览器自动播放策略要求
 * 首次发声必须发生在用户手势里，因此 AudioContext 在玩家第一次点击 / 按键时创建。
 */
export class ToneSynth {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;

  /** 在用户手势中调用；重复调用只恢复上下文。失败时静默降级为无声。 */
  ensure(): void {
    if (!this.context) {
      try {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(this.context.destination);
      } catch (error) {
        console.warn('[小游戏] 无法创建音频上下文，将以静音继续', error);
        return;
      }
    }
    void this.context.resume().catch(() => {
      // 自动播放被拒绝时保持静音；画面仍能完成整段演出。
    });
  }

  /** 播放一个带有短促起音与长衰减的琴音。 */
  play(frequency: number): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;

    const now = context.currentTime;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(0.22, now + 0.025);
    envelope.gain.exponentialRampToValueAtTime(0.008, now + 0.85);

    const body = context.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(frequency, now);

    const overtone = context.createOscillator();
    overtone.type = 'sine';
    overtone.frequency.setValueAtTime(frequency * 2, now);
    const overtoneGain = context.createGain();
    overtoneGain.gain.value = 0.18;

    body.connect(envelope);
    overtone.connect(overtoneGain).connect(envelope);
    envelope.connect(master);

    body.start(now);
    overtone.start(now);
    body.stop(now + 1);
    overtone.stop(now + 1);
  }

  /** 关闭上下文，释放音频设备；播放器卸载覆盖层时调用。 */
  dispose(): void {
    const context = this.context;
    this.context = null;
    this.master = null;
    if (context) {
      void context.close().catch(() => {
        // 上下文可能已经被浏览器关闭，忽略即可。
      });
    }
  }
}
