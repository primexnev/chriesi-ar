import { CONFIG } from '../config';
import type { AudioEngine } from './audio-engine';

/**
 * Background music for the Chriesisturm game. Made in REAPER (sources in `assets-source/music/`,
 * git-ignored): a 16-bar loop at 132 BPM and a short win jingle. Runs through the master gain,
 * so the sound button and pausing (context suspend) cover it too.
 */
const LOOP_SECONDS = (16 * 4 * 60) / 132;
/** AAC encoder delay; some browsers leave it in the decoded buffer. */
const AAC_PRIMING = 2112;

export class Music {
  private loop: AudioBufferSourceNode | null = null;
  private loopGain: GainNode | null = null;
  private wanted = false;

  constructor(
    private readonly audio: AudioEngine,
    private readonly volume = 0.32,
  ) {}

  /** Start fetching both files early (decoding needs the unlocked context). */
  preload(): void {
    void this.audio.load(url('game_loop'));
    void this.audio.load(url('game_win'));
  }

  /** Fade the loop in (no-op if it is already playing). */
  async start(fadeSeconds = 1.2): Promise<void> {
    this.wanted = true;
    if (this.loop) return;
    const buffer = await this.audio.load(url('game_loop'));
    const ctx = this.audio.ctx;
    const out = this.audio.master;
    if (!buffer || !ctx || !out || !this.wanted || this.loop) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    // Gapless: loop exactly the 16 bars, skipping the encoder delay if the decoder kept it.
    const excess = buffer.duration - LOOP_SECONDS;
    const offset = excess > 0.03 ? AAC_PRIMING / buffer.sampleRate : 0;
    src.loopStart = offset;
    src.loopEnd = offset + Math.min(LOOP_SECONDS, buffer.duration - offset);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(this.volume, ctx.currentTime + fadeSeconds);
    src.connect(g).connect(out);
    src.start(ctx.currentTime, offset);
    this.loop = src;
    this.loopGain = g;
  }

  /** Fade the loop out and drop it. */
  stop(fadeSeconds = 0.8): void {
    this.wanted = false;
    const ctx = this.audio.ctx;
    const src = this.loop;
    const g = this.loopGain;
    this.loop = this.loopGain = null;
    if (!ctx || !src || !g) return;
    g.gain.cancelScheduledValues(ctx.currentTime);
    g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
    g.gain.setTargetAtTime(0.0001, ctx.currentTime, fadeSeconds / 4);
    src.stop(ctx.currentTime + fadeSeconds + 0.1);
  }

  /** Short «ta-da» for the results screen. */
  async win(): Promise<void> {
    const buffer = await this.audio.load(url('game_win'));
    if (buffer) this.audio.play(buffer, this.volume * 1.6);
  }
}

function url(name: string): string {
  return `${CONFIG.musicUrl}${name}.m4a`;
}
