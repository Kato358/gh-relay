// Build: bundle to dist/worker.js (paste into the dashboard) and copy the font
// assets next to it. wrangler gets the same module graph straight from source.

import { build } from 'esbuild';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const OUT = 'dist';

await mkdir(`${OUT}/assets`, { recursive: true });

const result = await build({
  entryPoints: ['worker.js'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  loader: { '.woff2': 'base64' },
  outfile: `${OUT}/worker.js`,
  metafile: true,
  write: true,
});

await copyFile('assets/display.woff2', `${OUT}/assets/display.woff2`);
await copyFile('assets/mono.woff2', `${OUT}/assets/mono.woff2`);

const bytes = (await stat(`${OUT}/worker.js`)).size;
const gz = gzipSync(await readFile(`${OUT}/worker.js`)).length;
const inputs = Object.keys(result.metafile.inputs).sort();
console.log(`dist/worker.js  ${(bytes / 1024).toFixed(1)} KB raw  ${(gz / 1024).toFixed(1)} KB gzip`);
console.log(`${inputs.length} modules: ${inputs.join(', ')}`);
