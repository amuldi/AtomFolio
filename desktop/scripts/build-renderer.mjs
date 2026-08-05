// Bundles the popover's atom visual — the one part of this renderer that needs React + JSX — from
// the real, shared src/components/atom code, via esbuild resolved from the repo root's
// node_modules (react/react-dom/three/esbuild are already installed there for the web app; this
// package.json intentionally does not duplicate them as its own dependencies, matching how
// src/lib/portfolioTotals.mjs already imports across the same repo boundary in the main process).
// Run automatically before `npm start`/`npm run dev`; output is gitignored, not checked in.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(__dirname, '..', 'src', 'renderer', 'atom-view.jsx');
const outfile = path.join(__dirname, '..', 'src', 'renderer', 'atom-view.bundle.js');

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  jsx: 'automatic',
  logLevel: 'info',
});

console.log('Built', path.relative(process.cwd(), outfile));
