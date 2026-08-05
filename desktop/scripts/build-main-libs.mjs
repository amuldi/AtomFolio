// Bundles the two main-process lib files that reach across into the web app's shared src/ (the
// same cross-directory reuse pattern atom-view.jsx uses — see build-renderer.mjs) into
// self-contained files. This is required for a *packaged* app: dev mode runs main.js live off the
// real filesystem, where `../../../src/...` resolves fine, but electron-builder's asar only
// contains desktop/src/** and desktop/assets/** (see package.json's "files"), so those relative
// imports fail to resolve once shipped. Bundling inlines the shared code instead of duplicating it
// by hand, keeping "reuse via import, not copy" intact all the way through packaging.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.join(__dirname, '..', 'src', 'lib');

const entries = ['insights.mjs', 'portfolioTotals.mjs'];

for (const entry of entries) {
  const outfile = path.join(libDir, entry.replace(/\.mjs$/, '.bundle.mjs'));
  await build({
    entryPoints: [path.join(libDir, entry)],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    external: ['electron'],
    logLevel: 'info',
  });
  console.log('Built', path.relative(process.cwd(), outfile));
}
