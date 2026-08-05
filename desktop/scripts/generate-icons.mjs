// Renders the desktop app's tray + app icons straight from the web app's real favicon
// (../../public/favicon.svg) via cairosvg, so the menu bar glyph and the app logo always match
// what ships in the browser tab instead of drifting into their own hand-rolled shape. Re-run with
// `node scripts/generate-icons.mjs` whenever the favicon changes; output is checked in, so a
// normal `npm run build:mac` doesn't need this script or cairosvg at build time.
//
// Requires `cairosvg` on PATH (macOS: `brew install cairosvg`) — it's the one tool in this
// environment that renders SVG (including this file's bezier "sketch" strokes) accurately; a
// hand-rolled pixel rasterizer can't reproduce that shape faithfully.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(__dirname, '..', 'assets');
// iconutil requires the source to be named "*.iconset" — built in a scratch temp dir since only
// the final icon.icns (not the intermediate per-size PNGs) is meant to ship in assets/.
const iconsetDir = path.join(mkdtempSync(path.join(tmpdir(), 'atomfolio-iconset-')), 'icon.iconset');
const faviconSvg = path.join(__dirname, '..', '..', 'public', 'favicon.svg');
mkdirSync(assetsDir, { recursive: true });
mkdirSync(iconsetDir, { recursive: true });

function render(outputPath, size, { background } = {}) {
  const args = [
    faviconSvg,
    '-o',
    outputPath,
    '--output-width',
    String(size),
    '--output-height',
    String(size),
  ];
  if (background) {
    args.push('-b', background);
  }
  execFileSync('cairosvg', args, { stdio: 'inherit' });
}

// Tray icon: transparent background, black ink — macOS treats a "...Template.png"-named Tray
// image as a template (it re-tints black-on-transparent to match the light/dark menu bar
// automatically), so this must stay transparent, never a filled square.
render(path.join(assetsDir, 'trayIconTemplate.png'), 22);
render(path.join(assetsDir, 'trayIconTemplate@2x.png'), 44);

// App logo: opaque white background with the black atom on top, per the actual app-icon
// requirement (Finder/Dock icons need a real background — a transparent one looks broken outside
// a light context).
render(path.join(assetsDir, 'icon.png'), 1024, { background: 'white' });

// Full iconset + .icns for the mac app bundle (package.json's build.mac.icon points here).
// iconutil's .iconset format wants exactly these base sizes plus their @2x pixel-doubled variants
// (e.g. icon_16x16@2x.png is a 32px image) — not an arbitrary size list.
const iconsetBaseSizes = [16, 32, 128, 256, 512];
for (const size of iconsetBaseSizes) {
  render(path.join(iconsetDir, `icon_${size}x${size}.png`), size, { background: 'white' });
  render(path.join(iconsetDir, `icon_${size}x${size}@2x.png`), size * 2, { background: 'white' });
}
execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', path.join(assetsDir, 'icon.icns')], {
  stdio: 'inherit',
});
rmSync(path.dirname(iconsetDir), { recursive: true, force: true });

console.log('Generated tray + app icons (and icon.icns) in desktop/assets/ from public/favicon.svg.');
