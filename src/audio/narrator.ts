import { CONFIG } from '../config';
import narration from '../story/narration.de.json';
import type { StoryClock } from '../core/clock';
import type { Subtitles } from '../ui/subtitles';
import type { AudioEngine } from './audio-engine';

export type LineId = keyof typeof narration.lines;

const lines: Record<string, string> = narration.lines;

/** Reading-speed estimate when no audio is available (subtitles-only mode). */
function estimateSeconds(text: string): number {
  const words = text.split(/\s+/).length;
  return Math.max(2.2, words * 0.42 + 0.8);
}

/**
 * Plays one narration clip per line (`<narrationUrl>/<id>.m4a`) and shows its subtitle.
 * Lines may contain `|` to split them into subtitle chunks, timed by text length.
 * Timing runs on the story clock, so pausing the story pauses narration and subtitles together.
 */
export class Narrator {
  constructor(
    private readonly audio: AudioEngine,
    private readonly clock: StoryClock,
    private readonly subtitles: Subtitles,
  ) {}

  text(id: LineId): string {
    return lines[id].replace(/\s*\|\s*/g, ' ');
  }

  preload(ids: LineId[]): Promise<unknown> {
    return Promise.all(ids.map((id) => this.audio.load(this.url(id))));
  }

  async say(id: LineId): Promise<void> {
    const raw = lines[id];
    if (!raw) {
      console.warn(`[narrator] missing line ${id}`);
      return;
    }
    const chunks = raw.split('|').map((c) => c.trim()).filter(Boolean);
    const buffer = await this.audio.load(this.url(id));
    if (buffer) this.audio.play(buffer);
    const total = buffer ? buffer.duration : estimateSeconds(raw);
    const totalChars = chunks.reduce((n, c) => n + c.length, 0);

    for (const chunk of chunks) {
      this.subtitles.show(chunk);
      await this.clock.wait((total * (chunk.length / totalChars)) * 1000);
    }
    // Small breath between lines; keeps the last subtitle readable a moment longer.
    await this.clock.wait(350);
    this.subtitles.hide();
  }

  private url(id: LineId): string {
    return `${CONFIG.narrationUrl}${id}.m4a`;
  }
}
