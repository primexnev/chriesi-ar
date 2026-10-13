import type { AudioEngine } from './audio-engine';

/**
 * Procedural sound effects — zero download bytes. Replace with recorded sounds later
 * if the sound design asks for it; the call sites stay the same.
 */
export class Sfx {
  constructor(private readonly audio: AudioEngine) {}

  /** Church-bell-like strike: inharmonic partials with long decay. */
  bell(at = 0): void {
    const ctx = this.audio.ctx;
    const out = this.audio.master;
    if (!ctx || !out) return;
    const t0 = ctx.currentTime + at;
    const base = 392;
    const partials: Array<[number, number, number]> = [
      [0.5, 0.35, 3.5],
      [1, 0.5, 2.6],
      [1.19, 0.25, 2.0],
      [1.56, 0.2, 1.6],
      [2.0, 0.18, 1.3],
      [2.74, 0.1, 0.9],
      [3.76, 0.06, 0.6],
    ];
    for (const [ratio, amp, decay] of partials) {
      const osc = ctx.createOscillator();
      osc.frequency.value = base * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(amp * 0.5, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
      osc.connect(g).connect(out);
      osc.start(t0);
      osc.stop(t0 + decay + 0.05);
    }
  }

  /** Bright "pop" for a picked cherry; pitch rises with each pick. */
  pop(step = 0): void {
    const ctx = this.audio.ctx;
    const out = this.audio.master;
    if (!ctx || !out) return;
    const t0 = ctx.currentTime;
    const f = 520 * 2 ** (step / 12);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f * 1.6, t0);
    osc.frequency.exponentialRampToValueAtTime(f, t0 + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + 0.3);
  }

  /** Soft thud when a cherry lands in the basket. */
  plop(): void {
    const ctx = this.audio.ctx;
    const out = this.audio.master;
    if (!ctx || !out) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(220, t0);
    osc.frequency.exponentialRampToValueAtTime(90, t0 + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + 0.2);
  }

  /** Starling chirp: a few fast frequency sweeps. */
  chirp(): void {
    const ctx = this.audio.ctx;
    const out = this.audio.master;
    if (!ctx || !out) return;
    for (let i = 0; i < 3; i++) {
      const t0 = ctx.currentTime + i * 0.11;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(2600 + i * 200, t0);
      osc.frequency.exponentialRampToValueAtTime(4200, t0 + 0.04);
      osc.frequency.exponentialRampToValueAtTime(2200, t0 + 0.08);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
      osc.connect(g).connect(out);
      osc.start(t0);
      osc.stop(t0 + 0.1);
    }
  }

  /** Little major arpeggio for "well done" moments. */
  fanfare(): void {
    const ctx = this.audio.ctx;
    const out = this.audio.master;
    if (!ctx || !out) return;
    [0, 4, 7, 12].forEach((semi, i) => {
      const t0 = ctx.currentTime + i * 0.12;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 523.25 * 2 ** (semi / 12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      osc.connect(g).connect(out);
      osc.start(t0);
      osc.stop(t0 + 0.55);
    });
  }
}
