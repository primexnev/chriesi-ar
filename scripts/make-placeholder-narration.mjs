// Generates placeholder narration (one AAC .m4a per line) with macOS text-to-speech,
// so timing and subtitle sync can be tested before the real recording (SW10).
// Usage: npm run narration            (only missing files)
//        npm run narration -- --force (regenerate all)
//        VOICE=Flo npm run narration  (other German voice; `say -v '?' | grep de_`)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

if (process.platform !== 'darwin') {
  console.error('Needs macOS (`say` + `afconvert`). Subtitles-only mode works without audio files.');
  process.exit(1);
}

const root = new URL('..', import.meta.url).pathname;
const { lines } = JSON.parse(readFileSync(join(root, 'src/story/narration.de.json'), 'utf8'));
const outDir = join(root, 'public/assets/audio/narration');
const force = process.argv.includes('--force');
const voice = process.env.VOICE ?? 'Anna';
mkdirSync(outDir, { recursive: true });

for (const [id, text] of Object.entries(lines)) {
  const out = join(outDir, `${id}.m4a`);
  if (existsSync(out) && !force) continue;
  const aiff = join(tmpdir(), `${id}.aiff`);
  const spoken = text.replace(/\s*\|\s*/g, ' ');
  execFileSync('say', ['-v', voice, '-r', '160', '-o', aiff, spoken]);
  // Mono AAC 48 kbit/s: plays on iOS Safari and Android Chrome, ~6 KB per second.
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '48000', '-c', '1', aiff, out]);
  rmSync(aiff);
  console.log(`  ${id}.m4a`);
}
console.log('Placeholder narration ready in public/assets/audio/narration/');
