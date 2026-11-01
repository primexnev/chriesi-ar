// Download-size report for the built app (dist/). Fails if the AR path exceeds the budget.
// "transfer" = gzip size for text files (what the server sends), raw size for binaries.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_MB = 6;
const dist = new URL('../dist/', import.meta.url).pathname;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const TEXT = /\.(js|css|html|json|svg|mjs)$/;
const groups = {
  'core (always)': (f) => /^index\.html$|assets\/index-.*\.(js|css)$/.test(f),
  'AR engine (lazy)': (f) => /mindar/.test(f),
  'AR engine 8th Wall (?tracker=8thwall)': (f) => /vendor\/8thwall\/.*\.js$|targets\/8thwall\//.test(f),
  '2D fallback (lazy)': (f) => /fallback2d/.test(f),
  'decoders (only if models need them)': (f) => /draco|basis/.test(f),
  'AR target': (f) => /\.mind$/.test(f),
  'UI artwork': (f) => /assets\/ui\//.test(f),
  models: (f) => /\.(glb|gltf|bin|ktx2)$/.test(f),
  narration: (f) => /\.(m4a|mp3|ogg|opus|wav)$/.test(f),
};

let files;
try {
  files = walk(dist);
} catch {
  console.error('dist/ not found — run `npm run build` first');
  process.exit(1);
}

const rows = files.map((p) => {
  const file = relative(dist, p);
  const buf = readFileSync(p);
  const transfer = TEXT.test(file) ? gzipSync(buf, { level: 9 }).length : buf.length;
  const group = Object.keys(groups).find((g) => groups[g](file)) ?? 'other';
  return { file, raw: buf.length, transfer, group };
});

const kb = (n) => `${(n / 1024).toFixed(1).padStart(8)} KB`;
const totals = {};
for (const r of rows) {
  totals[r.group] ??= { raw: 0, transfer: 0, n: 0 };
  totals[r.group].raw += r.raw;
  totals[r.group].transfer += r.transfer;
  totals[r.group].n++;
}

console.log('\nLargest files (transfer):');
rows
  .sort((a, b) => b.transfer - a.transfer)
  .slice(0, 8)
  .forEach((r) => console.log(`  ${kb(r.transfer)}  ${r.file}`));

console.log('\nBy group:                                  transfer        raw');
for (const [g, t] of Object.entries(totals)) {
  console.log(`  ${g.padEnd(38)} ${kb(t.transfer)} ${kb(t.raw)}  (${t.n} files)`);
}

// Decoders are fetched only for the compression the models use: Draco → wrapper + wasm
// (the asm.js fallback is for browsers without WebAssembly), KTX2 → basis transcoder.
const glbExtensions = new Set(
  rows
    .filter((r) => r.file.endsWith('.glb'))
    .flatMap((r) => {
      const buf = readFileSync(join(dist, r.file));
      const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString());
      return json.extensionsUsed ?? [];
    }),
);
const largest = (re) => rows.filter((r) => re.test(r.file)).reduce((n, r) => Math.max(n, r.transfer), 0);
const decoderBytes =
  (glbExtensions.has('KHR_draco_mesh_compression') ? largest(/draco_wasm_wrapper/) + largest(/draco_decoder.*\.wasm$/) : 0) +
  (glbExtensions.has('KHR_texture_basisu') ? largest(/basis_transcoder.*\.js$/) + largest(/basis_transcoder.*\.wasm$/) : 0);
if (glbExtensions.size) console.log(`\nModel extensions: ${[...glbExtensions].join(', ')} → decoders ${kb(decoderBytes).trim()}`);

// Worst realistic case: AR path with everything the story loads.
const arPath =
  ['core (always)', 'AR engine (lazy)', 'AR target', 'models', 'narration', 'UI artwork'].reduce((n, g) => n + (totals[g]?.transfer ?? 0), 0) +
  decoderBytes;
const mb = arPath / 1024 / 1024;
console.log(`\nAR path download ≈ ${mb.toFixed(2)} MB  (budget ${BUDGET_MB} MB)`);
const xr8 = arPath - (totals['AR engine (lazy)']?.transfer ?? 0) - (totals['AR target']?.transfer ?? 0) + (totals['AR engine 8th Wall (?tracker=8thwall)']?.transfer ?? 0);
if (xr8 !== arPath) console.log(`8th Wall path download ≈ ${(xr8 / 1024 / 1024).toFixed(2)} MB  (instead of MindAR)`);
if (mb > BUDGET_MB) {
  console.error(`✗ Over budget by ${(mb - BUDGET_MB).toFixed(2)} MB`);
  process.exit(1);
}
console.log('✓ Within budget\n');
