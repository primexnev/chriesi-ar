import { mkdirSync, writeFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

/**
 * mind-ar 1.2.5 imports `sRGBEncoding`, which three.js removed in r162.
 * We strip that import and define the old constant locally; the renderer's
 * colour space is set by our own tracker code (see src/tracking/mindar-tracker.ts).
 */
function patchMindAR(): Plugin {
  return {
    name: 'patch-mindar-srgb',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('mind-ar/dist/mindar-image-three')) return null;
      const match = /\bsRGBEncoding as (\w+),\s*/.exec(code);
      if (!match) return null;
      const patched = code.replace(match[0], '');
      return { code: `const ${match[1]} = 3001;\n${patched}`, map: null };
    },
  };
}

/**
 * Dev-only endpoint used by tools/compile-target.html to write the compiled
 * target (and a printable test spread) straight into public/assets/targets/.
 */
function saveTargetEndpoint(): Plugin {
  const allowed = new Set(['spread.mind', 'test-spread.png']);
  return {
    name: 'dev-save-target',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/save-target', (req, res) => {
        const name = new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? '';
        if (req.method !== 'POST' || !allowed.has(name)) {
          res.statusCode = 400;
          res.end('bad request');
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (c: Buffer) => {
          size += c.length;
          if (size > 20 * 1024 * 1024) req.destroy();
          else chunks.push(c);
        });
        req.on('end', () => {
          mkdirSync('public/assets/targets', { recursive: true });
          writeFileSync(`public/assets/targets/${name}`, Buffer.concat(chunks));
          res.end('ok');
        });
      });
    },
  };
}

// HTTPS is needed for camera access on phones over the LAN: `npm run dev:phone`.
const useHttps = process.env.HTTPS === '1' || process.argv.includes('--host');

export default defineConfig({
  // Relative base so the build runs from any static host / sub-folder.
  base: './',
  plugins: [patchMindAR(), saveTargetEndpoint(), ...(useHttps ? [basicSsl()] : [])],
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 3000,
  },
  optimizeDeps: {
    // Pre-bundling would bypass the transform above in dev.
    exclude: ['mind-ar'],
  },
});
