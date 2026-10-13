/**
 * Single Web Audio context for narration and effects.
 * iOS only allows audio after a user gesture: call `unlock()` synchronously
 * inside the tap handler of the start button.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  private muted = false;
  private cache = new Map<string, Promise<AudioBuffer | null>>();

  get isMuted(): boolean {
    return this.muted;
  }

  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    // Play through the iOS ringer/silent switch where supported (Safari 16.4+).
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = 'playback';

    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    // A silent buffer started inside the gesture fully unlocks older iOS versions.
    const silent = ctx.createBufferSource();
    silent.buffer = ctx.createBuffer(1, 1, 22050);
    silent.connect(ctx.destination);
    silent.start(0);
    void ctx.resume();
  }

  /** Fetch + decode; resolves to null on any failure (subtitles still carry the story). */
  load(url: string): Promise<AudioBuffer | null> {
    let p = this.cache.get(url);
    if (!p) {
      p = (async () => {
        if (!this.ctx) return null;
        try {
          const res = await fetch(url);
          const type = res.headers.get('content-type') ?? '';
          if (!res.ok || type.includes('text/html')) return null;
          return await this.ctx.decodeAudioData(await res.arrayBuffer());
        } catch {
          return null;
        }
      })();
      this.cache.set(url, p);
    }
    return p;
  }

  play(buffer: AudioBuffer, gain = 1): AudioBufferSourceNode | null {
    if (!this.ctx || !this.master) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    src.start();
    return src;
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.05);
  }
}
