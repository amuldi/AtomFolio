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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

// Tray status dots: today's P/L at a glance, without the full atom detail — see main.js's
// updateTrayIcon(). Colors match --profit-color/--loss-color from src/styles.css exactly. These
// must NOT be named "...Template.png" — macOS force-monochromes template images, which would
// throw away the color that's the entire point here.
const dotSvgDir = mkdtempSync(path.join(tmpdir(), 'atomfolio-traydots-'));
const DOT_COLORS = {
  profit: 'rgba(255, 92, 82, 0.94)',
  loss: 'rgba(91, 164, 255, 0.94)',
  neutral: 'rgba(180, 180, 188, 0.9)',
};
for (const [name, color] of Object.entries(DOT_COLORS)) {
  const svgPath = path.join(dotSvgDir, `${name}.svg`);
  writeFileSync(
    svgPath,
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5" fill="${color}"/></svg>`,
  );
  execFileSync('cairosvg', [svgPath, '-o', path.join(assetsDir, `trayDot-${name}.png`), '--output-width', '22', '--output-height', '22'], { stdio: 'inherit' });
  execFileSync('cairosvg', [svgPath, '-o', path.join(assetsDir, `trayDot-${name}@2x.png`), '--output-width', '44', '--output-height', '44'], { stdio: 'inherit' });
}
rmSync(dotSvgDir, { recursive: true, force: true });

console.log('Generated tray + app icons (and icon.icns) in desktop/assets/ from public/favicon.svg.');
