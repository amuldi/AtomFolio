// One-off generator for the tray "template" icon (and a plain app icon) — no image-editing
// tooling is available in this environment, so this hand-rolls a minimal PNG encoder (zlib is a
// Node built-in; PNG's compressed-scanline format needs nothing else). Re-run with
// `node scripts/generate-icons.mjs` if the glyph ever needs to change; the output is checked in
// so a normal `npm run build:mac` doesn't need this script.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(__dirname, '..', 'assets');
mkdirSync(assetsDir, { recursive: true });

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// `pixels(x, y)` returns alpha 0-255 for a black "ink" pixel (RGB always 0,0,0 — a macOS
// template image: the OS recolors it for light/dark menu bars and ignores RGB, only alpha).
function encodePng(size, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = chunk('IHDR', ihdrData);

  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const alpha = pixels(x, y);
      const offset = rowStart + 1 + x * 4;
      raw[offset] = 0;
      raw[offset + 1] = 0;
      raw[offset + 2] = 0;
      raw[offset + 3] = alpha;
    }
  }

  const idat = chunk('IDAT', deflateSync(raw));
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([signature, ihdr, idat, iend]);
}

// A small "atom" glyph: a solid nucleus dot plus two thin crossed orbit ellipses — echoes the
// web app's atom motif, simplified to read at 18-22px per the design system's "icon
// simplification" rule (one shape, one weight, no fine detail that'll just turn to mush at
// menu-bar scale).
function atomAlpha(nx, ny) {
  // nx, ny in [-1, 1], origin centered.
  const dot = Math.hypot(nx, ny) <= 0.16 ? 1 : 0;
  const ring = (a, b, angleRad) => {
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    const rx = nx * cos + ny * sin;
    const ry = -nx * sin + ny * cos;
    const v = (rx * rx) / (a * a) + (ry * ry) / (b * b);
    return v > 0.82 * 0.82 && v < 1 ? 1 : 0;
  };
  const ringA = ring(0.92, 0.42, Math.PI / 6);
  const ringB = ring(0.92, 0.42, -Math.PI / 6);
  return dot || ringA || ringB ? 255 : 0;
}

function renderAtom(size, supersample = 4) {
  return encodePng(size, (px, py) => {
    let hits = 0;
    for (let sy = 0; sy < supersample; sy += 1) {
      for (let sx = 0; sx < supersample; sx += 1) {
        const x = px + (sx + 0.5) / supersample;
        const y = py + (sy + 0.5) / supersample;
        const nx = (x / size) * 2 - 1;
        const ny = (y / size) * 2 - 1;
        if (atomAlpha(nx, ny)) {
          hits += 1;
        }
      }
    }
    return Math.round((hits / (supersample * supersample)) * 255);
  });
}

writeFileSync(path.join(assetsDir, 'trayIconTemplate.png'), renderAtom(22));
writeFileSync(path.join(assetsDir, 'trayIconTemplate@2x.png'), renderAtom(44));
writeFileSync(path.join(assetsDir, 'icon.png'), renderAtom(512));

console.log('Generated tray + app icons in desktop/assets/.');
