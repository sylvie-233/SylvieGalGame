/**
 * 《回声》小游戏的 Phaser 场景。
 *
 * 演出逻辑完全取自剧情：希尔维弹了八个音，玩家把同一段旋律按回去。
 * 场景只负责“听—复现—返回结果”，不读取剧本变量，也不决定分支；
 * 结果通过 `context.finish({ echoes, cleared })` 交给引擎按 YAML 映射写回。
 */
import type { MinigameContext } from '@sylvie/types';
import Phaser from 'phaser';

import { countCleanNotes, ECHO_KEYS, ECHO_MAX_SCORE, ECHO_PHRASE, isEchoKey } from './notes';
import { ToneSynth } from './synth';

type EchoPhase = 'intro' | 'demo' | 'input' | 'done';

interface KeyView {
  background: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  solfege: Phaser.GameObjects.Text;
}

interface Dust {
  x: number;
  y: number;
  radius: number;
  alpha: number;
}

const KEY_COLOR = 0xece5dc;
const KEY_PRESSED = 0xffc4d8;
const KEY_WRONG = 0xc75a6b;
const SLOT_COLOR = 0x2a2738;
const SLOT_FILLED = 0xe69ab4;

/** 固定装饰点，避免每次 resize 重新随机导致画面跳动。 */
const DUST: readonly Dust[] = [
  { x: 0.08, y: 0.34, radius: 1.4, alpha: 0.24 },
  { x: 0.16, y: 0.68, radius: 2.1, alpha: 0.18 },
  { x: 0.24, y: 0.22, radius: 1.1, alpha: 0.3 },
  { x: 0.34, y: 0.52, radius: 1.7, alpha: 0.14 },
  { x: 0.45, y: 0.16, radius: 1.2, alpha: 0.26 },
  { x: 0.58, y: 0.61, radius: 2.4, alpha: 0.12 },
  { x: 0.67, y: 0.29, radius: 1.4, alpha: 0.22 },
  { x: 0.76, y: 0.74, radius: 1.8, alpha: 0.16 },
  { x: 0.88, y: 0.38, radius: 1.2, alpha: 0.28 },
  { x: 0.94, y: 0.6, radius: 2.0, alpha: 0.12 },
  { x: 0.12, y: 0.86, radius: 1.5, alpha: 0.16 },
  { x: 0.52, y: 0.84, radius: 1.3, alpha: 0.2 },
];

export class EchoScene extends Phaser.Scene {
  private context: MinigameContext | null = null;
  private readonly synth = new ToneSynth();
  private phase: EchoPhase = 'intro';
  private progress = 0;
  /** 每个音是否第一次就按对；按错后即使补对也不计分。 */
  private readonly clean: boolean[] = ECHO_PHRASE.map(() => true);
  private keys: KeyView[] = [];
  private slots: Phaser.GameObjects.Arc[] = [];
  private decorations!: Phaser.GameObjects.Graphics;
  private statusText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private finished = false;

  constructor() {
    super({ key: 'echo' });
  }

  create(data: MinigameContext): void {
    this.context = data;
    this.phase = 'intro';
    this.progress = 0;
    this.finished = false;

    this.decorations = this.add.graphics();

    for (const [index, key] of ECHO_KEYS.entries()) {
      const background = this.add
        .rectangle(0, 0, 100, 100, KEY_COLOR)
        .setOrigin(0.5, 1)
        .setStrokeStyle(1, 0x3a3340, 0.55)
        .setInteractive({ useHandCursor: true });
      background.on('pointerdown', () => this.pressKey(index));

      const label = this.add
        .text(0, 0, key.label, {
          color: '#2b2633',
          fontFamily: '"Noto Serif SC", Georgia, serif',
          fontSize: '24px',
        })
        .setOrigin(0.5, 0);
      const solfege = this.add
        .text(0, 0, key.solfege, {
          color: '#6e6370',
          fontFamily: '"Noto Sans SC", "Microsoft YaHei", sans-serif',
          fontSize: '12px',
        })
        .setOrigin(0.5, 0);

      this.keys.push({ background, label, solfege });
    }

    for (let index = 0; index < ECHO_MAX_SCORE; index += 1) {
      this.slots.push(
        this.add
          .circle(0, 0, 6, SLOT_COLOR, 0.85)
          .setStrokeStyle(1, 0xd9bd88, 0.35),
      );
    }

    this.statusText = this.add
      .text(0, 0, '她弹了八个音。', {
        color: '#f3eee8',
        fontFamily: '"Noto Serif SC", Georgia, serif',
        fontSize: '26px',
        align: 'center',
      })
      .setOrigin(0.5, 0.5);

    this.hintText = this.add
      .text(0, 0, '点击任意处，或按空格，先听她弹。', {
        color: '#aaa2a2',
        fontFamily: '"Noto Sans SC", "Microsoft YaHei", sans-serif',
        fontSize: '13px',
        align: 'center',
      })
      .setOrigin(0.5, 0.5);

    this.layout();
    this.scale.on('resize', this.layout);
    this.input.on('pointerdown', this.onPointerDown);
    this.input.keyboard?.on('keydown', this.onKeyDown);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);

    // 提示呼吸，提醒玩家这里需要一次点击 / 按键才能解锁声音。
    this.tweens.add({
      targets: this.hintText,
      alpha: { from: 1, to: 0.55 },
      duration: 1100,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /** 首次点击 / 按键：解锁音频并开始演示八个音。 */
  private startDemo(): void {
    if (!this.context || this.phase !== 'intro') return;
    this.phase = 'demo';
    this.synth.ensure();
    this.tweens.killTweensOf(this.hintText);
    this.hintText.setAlpha(1);
    this.statusText.setText('听。');
    this.hintText.setText('她弹得很慢，慢到每个音之间都能听见窗外的风。');

    ECHO_PHRASE.forEach((note, index) => {
      this.time.delayedCall(index * 620, () => {
        if (this.phase !== 'demo') return;
        this.emitKey(note);
        const key = ECHO_KEYS[note];
        if (key) this.synth.play(key.frequency);
      });
    });

    this.time.delayedCall(ECHO_PHRASE.length * 620 + 700, () => {
      if (this.phase !== 'demo') return;
      this.phase = 'input';
      this.statusText.setText('轮到你了');
      this.hintText.setText('按 1-4，或点击琴键，把刚才的八个音还回去。');
    });
  }

  /** 玩家按下某个琴键：比对当前应弹的音，正确则前进，错误则提示并停留在原位。 */
  private pressKey(index: number): void {
    if (!isEchoKey(index)) return;
    if (this.phase === 'intro') {
      this.startDemo();
      return;
    }
    if (this.phase !== 'input') return;

    this.synth.ensure();
    const pressed = ECHO_KEYS[index];
    if (pressed) this.synth.play(pressed.frequency);
    this.emitKey(index);

    const expected = ECHO_PHRASE[this.progress];
    if (expected === undefined) return;
    if (expected === index) {
      this.fillSlot(this.progress);
      this.progress += 1;
      if (this.progress >= ECHO_MAX_SCORE) {
        this.complete();
      } else {
        this.statusText.setText(`第 ${this.progress} / ${ECHO_MAX_SCORE} 个音回来了。`);
      }
      return;
    }

    // 按错不推进，也不重播整段：标红并再弹一次正确的音，让玩家继续尝试。
    this.clean[this.progress] = false;
    const wrong = this.keys[index]?.background;
    if (wrong) {
      wrong.setFillStyle(KEY_WRONG, 1);
      this.time.delayedCall(260, () => wrong.setFillStyle(KEY_COLOR, 1));
    }
    this.statusText.setText('这个音不对。再听一次。');
    this.time.delayedCall(320, () => {
      if (this.phase !== 'input') return;
      this.emitKey(expected);
      const key = ECHO_KEYS[expected];
      if (key) this.synth.play(key.frequency);
    });
  }

  /** 八个音全部按对：给出简短的舞台反馈，再把结果交回剧本。 */
  private complete(): void {
    if (this.finished) return;
    this.phase = 'done';
    const score = countCleanNotes(this.clean);
    if (score >= ECHO_MAX_SCORE - 1) {
      this.statusText.setText('八个音，一个都没丢。');
    } else if (score >= 4) {
      this.statusText.setText('大部分音都接住了。');
    } else {
      this.statusText.setText('有几个音跑了，但旋律还在。');
    }
    this.hintText.setText(
      score >= ECHO_MAX_SCORE - 1 ? '……她抬起头，看你。' : '……她没有纠正你，只是听着。',
    );

    this.time.delayedCall(1700, () => {
      if (this.finished || !this.context) return;
      this.finished = true;
      this.context.finish({ echoes: score, cleared: true });
    });
  }

  /** 点亮一个琴键并弹回原位；演示与玩家输入共用。 */
  private emitKey(index: number): void {
    const view = this.keys[index];
    if (!view) return;
    view.background.setFillStyle(KEY_PRESSED, 1);
    this.tweens.add({
      targets: view.background,
      scaleX: 1.045,
      scaleY: 0.955,
      duration: 110,
      yoyo: true,
      ease: 'Sine.easeOut',
    });
    this.time.delayedCall(210, () => {
      // 按错时的红色反馈由 pressKey 自己重置，这里只还原正常的粉色高亮。
      if (view.background.fillColor === KEY_PRESSED) {
        view.background.setFillStyle(KEY_COLOR, 1);
      }
    });
  }

  /** 一个音符落进进度圆点。 */
  private fillSlot(index: number): void {
    const slot = this.slots[index];
    if (!slot) return;
    slot.setFillStyle(SLOT_FILLED, 1);
    this.tweens.add({
      targets: slot,
      scale: 1.4,
      duration: 120,
      yoyo: true,
      ease: 'Sine.easeOut',
    });
  }

  /** 响应窗口尺寸变化：琴键、圆点与文字全部按当前画布重排。 */
  private readonly layout = (): void => {
    const width = this.scale.width;
    const height = this.scale.height;
    if (width <= 0 || height <= 0) return;

    const keyAreaWidth = Math.min(width * 0.86, 760);
    const keyHeight = Math.min(Math.max(150, height * 0.3), 260);
    const keyBottom = height - Math.max(44, height * 0.06);
    const keyTop = keyBottom - keyHeight;
    const left = (width - keyAreaWidth) / 2;
    const keyWidth = keyAreaWidth / ECHO_KEYS.length;
    const labelSize = Math.max(18, Math.min(30, keyWidth * 0.2));

    this.keys.forEach((view, index) => {
      const x = left + keyWidth * (index + 0.5);
      view.background.setPosition(x, keyBottom).setSize(keyWidth - 6, keyHeight);
      view.label.setFontSize(labelSize).setPosition(x, keyTop + keyHeight * 0.46);
      view.solfege
        .setFontSize(Math.max(10, labelSize * 0.5))
        .setPosition(x, keyTop + keyHeight * 0.46 + labelSize * 1.25);
    });

    const slotArea = Math.min(keyAreaWidth * 0.86, 500);
    const slotY = keyTop - Math.min(72, height * 0.1);
    this.slots.forEach((slot, index) => {
      const slotX =
        (width - slotArea) / 2 + (ECHO_MAX_SCORE > 1 ? (slotArea / (ECHO_MAX_SCORE - 1)) * index : 0);
      slot.setPosition(slotX, slotY);
    });

    const statusY = Math.max(128, slotY - 76);
    this.statusText
      .setFontSize(Math.max(20, Math.min(30, width * 0.024)))
      .setPosition(width / 2, statusY);
    this.hintText
      .setFontSize(Math.max(11, Math.min(14, width * 0.012)))
      .setPosition(width / 2, height - Math.max(18, height * 0.025));

    this.decorations.clear();
    this.decorations.fillStyle(0x6b5a8a, 0.09);
    this.decorations.fillCircle(width / 2, height * 0.43, Math.min(width, height) * 0.36);
    this.decorations.fillStyle(0xe69ab4, 0.045);
    this.decorations.fillCircle(width * 0.72, height * 0.3, Math.min(width, height) * 0.2);
    for (const dust of DUST) {
      this.decorations.fillStyle(0xd9bd88, dust.alpha);
      this.decorations.fillCircle(width * dust.x, height * dust.y, dust.radius);
    }
    this.decorations.lineStyle(1, 0xe69ab4, 0.16);
    this.decorations.lineBetween(left, keyTop - 3, left + keyAreaWidth, keyTop - 3);
  };

  private readonly onPointerDown = (): void => {
    if (this.phase === 'intro') this.startDemo();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    const index = ['1', '2', '3', '4'].indexOf(event.key);
    if (index >= 0) {
      event.preventDefault();
      this.pressKey(index);
      return;
    }
    if (this.phase === 'intro' && (event.key === ' ' || event.key === 'Enter')) {
      event.preventDefault();
      this.startDemo();
    }
  };

  /** 场景销毁：解绑全局输入与窗口监听，关闭音频上下文。 */
  private shutdown(): void {
    this.input.off('pointerdown', this.onPointerDown);
    this.input.keyboard?.off('keydown', this.onKeyDown);
    this.scale.off('resize', this.layout);
    this.synth.dispose();
  }
}
