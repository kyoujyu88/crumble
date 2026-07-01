/**
 * WebAudio による合成効果音 + バイブレーション。
 * 音声アセット不要（すべてオシレータ＋ノイズで生成）。
 */
export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this._noiseBuf = null;
  }

  /** ユーザー操作のタイミングで呼ぶ（autoplay 制限対策） */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      // 2秒のホワイトノイズバッファを共有
      const len = this.ctx.sampleRate * 2;
      this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this._noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(v) { this.enabled = v; }

  _now() { return this.ctx.currentTime; }

  _noise({ dur = 0.2, filter = 'lowpass', freq = 800, q = 1, gain = 0.5, delay = 0 }) {
    const t = this._now() + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  _tone({ freq = 440, dur = 0.15, type = 'sine', gain = 0.25, slideTo = 0, delay = 0 }) {
    const t = this._now() + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _ok() { return this.enabled && this.ctx; }

  /** 破壊音（素材別） */
  crash(material) {
    if (!this._ok()) return;
    switch (material) {
      case 'wood':
        this._noise({ dur: 0.22, filter: 'lowpass', freq: 900, gain: 0.7 });
        this._noise({ dur: 0.12, filter: 'bandpass', freq: 2400, q: 2, gain: 0.3 });
        this._tone({ freq: 110, dur: 0.15, type: 'triangle', gain: 0.4, slideTo: 55 });
        break;
      case 'glass':
        this._noise({ dur: 0.3, filter: 'highpass', freq: 3500, gain: 0.5 });
        for (let i = 0; i < 5; i++) {
          this._tone({
            freq: 2200 + Math.random() * 3800, dur: 0.18 + Math.random() * 0.2,
            type: 'sine', gain: 0.12, delay: Math.random() * 0.08,
          });
        }
        break;
      case 'ceramic':
        this._noise({ dur: 0.2, filter: 'bandpass', freq: 2000, q: 1.5, gain: 0.6 });
        for (let i = 0; i < 3; i++) {
          this._tone({
            freq: 1200 + Math.random() * 1800, dur: 0.15,
            type: 'triangle', gain: 0.15, delay: Math.random() * 0.05,
          });
        }
        break;
      case 'stone':
      default:
        this._noise({ dur: 0.35, filter: 'lowpass', freq: 420, gain: 0.9 });
        this._tone({ freq: 70, dur: 0.3, type: 'sine', gain: 0.6, slideTo: 40 });
        this._noise({ dur: 0.15, filter: 'bandpass', freq: 1200, q: 1, gain: 0.25 });
        break;
    }
  }

  /** コンボ音（レベルが上がるほど高い音） */
  combo(level) {
    if (!this._ok()) return;
    const penta = [523, 587, 659, 784, 880, 1047, 1175, 1319];
    const f = penta[Math.min(level - 1, penta.length - 1)];
    this._tone({ freq: f, dur: 0.12, type: 'square', gain: 0.12 });
    this._tone({ freq: f * 2, dur: 0.1, type: 'sine', gain: 0.08, delay: 0.03 });
  }

  coin() {
    if (!this._ok()) return;
    this._tone({ freq: 1319, dur: 0.08, type: 'square', gain: 0.12 });
    this._tone({ freq: 1760, dur: 0.25, type: 'square', gain: 0.12, delay: 0.08 });
  }

  golden() {
    if (!this._ok()) return;
    [880, 1109, 1319, 1760].forEach((f, i) =>
      this._tone({ freq: f, dur: 0.3, type: 'triangle', gain: 0.15, delay: i * 0.06 }));
  }

  feverStart() {
    if (!this._ok()) return;
    this._tone({ freq: 220, dur: 0.6, type: 'sawtooth', gain: 0.15, slideTo: 880 });
    [659, 784, 988, 1319].forEach((f, i) =>
      this._tone({ freq: f, dur: 0.2, type: 'square', gain: 0.1, delay: 0.3 + i * 0.08 }));
  }

  countdown(final = false) {
    if (!this._ok()) return;
    this._tone({ freq: final ? 880 : 440, dur: final ? 0.4 : 0.12, type: 'sine', gain: 0.25 });
  }

  timeWarning() {
    if (!this._ok()) return;
    this._tone({ freq: 660, dur: 0.08, type: 'square', gain: 0.15 });
  }

  fanfare() {
    if (!this._ok()) return;
    const seq = [523, 523, 523, 659, 784, 1047];
    seq.forEach((f, i) =>
      this._tone({ freq: f, dur: i === seq.length - 1 ? 0.6 : 0.15, type: 'triangle', gain: 0.2, delay: i * 0.13 }));
  }

  buy() {
    if (!this._ok()) return;
    [784, 988, 1175, 1568].forEach((f, i) =>
      this._tone({ freq: f, dur: 0.15, type: 'sine', gain: 0.15, delay: i * 0.07 }));
  }

  uiTap() {
    if (!this._ok()) return;
    this._tone({ freq: 700, dur: 0.05, type: 'sine', gain: 0.1 });
  }

  deny() {
    if (!this._ok()) return;
    this._tone({ freq: 220, dur: 0.15, type: 'square', gain: 0.12 });
    this._tone({ freq: 185, dur: 0.2, type: 'square', gain: 0.12, delay: 0.12 });
  }

  /** バイブレーション（対応端末のみ） */
  haptic(pattern) {
    if (this.enabled && navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch { /* noop */ }
    }
  }
}
