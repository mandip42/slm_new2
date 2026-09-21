/**
 * Generate the PWA icon set.
 *
 * The icons are drawn procedurally and encoded as PNG with a small encoder built
 * on node's zlib, so the repository carries no binary assets and the build has no
 * image-processing dependency. Output is deterministic.
 *
 * Two variants are produced:
 *   - "any"      : artwork inset from the edges, for contexts that show the icon
 *                  as-is
 *   - "maskable" : full-bleed background with the artwork kept inside the central
 *                  80 % safe zone, so Android can crop it to any shape
 */

import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public/icons');

// ---------------------------------------------------------------------------
// Minimal PNG encoder (RGBA, 8 bit, non-interlaced)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // One filter byte (0 = none) per scanline.
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Artwork
// ---------------------------------------------------------------------------

const BACKGROUND = [8, 12, 18, 255];
const PANEL = [15, 23, 33, 255];
const BAR_COLORS = [
  [56, 189, 248], // sky
  [34, 211, 238], // cyan
  [45, 212, 191], // teal
  [163, 230, 53], // lime
  [250, 204, 21], // yellow
  [251, 146, 60], // orange
  [248, 113, 113], // red
];

/** Relative bar heights, shaped like a plausible 1/3-octave spectrum. */
const BAR_HEIGHTS = [0.34, 0.56, 0.76, 1.0, 0.86, 0.62, 0.44];

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Signed coverage of a rounded rectangle, anti-aliased.
 * Returns 0..1 coverage for the pixel centre at (px, py).
 */
function roundedRectCoverage(px, py, x0, y0, x1, y1, radius, feather) {
  const cx = Math.min(Math.max(px, x0 + radius), x1 - radius);
  const cy = Math.min(Math.max(py, y0 + radius), y1 - radius);
  const dx = px - cx;
  const dy = py - cy;
  const distance = Math.hypot(dx, dy);
  return 1 - smoothstep(radius - feather, radius + feather, distance);
}

function blend(dst, offset, color, alpha) {
  if (alpha <= 0) return;
  const a = Math.min(1, alpha);
  dst[offset] = Math.round(dst[offset] * (1 - a) + color[0] * a);
  dst[offset + 1] = Math.round(dst[offset + 1] * (1 - a) + color[1] * a);
  dst[offset + 2] = Math.round(dst[offset + 2] * (1 - a) + color[2] * a);
  dst[offset + 3] = 255;
}

/**
 * Draw the Sonoscope mark.
 *
 * @param {number} size    pixel size
 * @param {boolean} maskable  full-bleed background and a tighter safe zone
 */
function drawIcon(size, maskable) {
  const rgba = Buffer.alloc(size * size * 4);
  const feather = Math.max(0.6, size / 256);

  // Background plate
  const plateInset = maskable ? 0 : size * 0.06;
  const plateRadius = maskable ? 0 : size * 0.22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      if (maskable) {
        rgba[offset] = BACKGROUND[0];
        rgba[offset + 1] = BACKGROUND[1];
        rgba[offset + 2] = BACKGROUND[2];
        rgba[offset + 3] = 255;
      } else {
        const coverage = roundedRectCoverage(
          x + 0.5,
          y + 0.5,
          plateInset,
          plateInset,
          size - plateInset,
          size - plateInset,
          plateRadius,
          feather
        );
        rgba[offset] = 0;
        rgba[offset + 1] = 0;
        rgba[offset + 2] = 0;
        rgba[offset + 3] = 0;
        blend(rgba, offset, BACKGROUND, coverage);
        rgba[offset + 3] = Math.round(255 * coverage);
      }
    }
  }

  // Inner instrument panel
  const safe = maskable ? size * 0.1 : size * 0.06;
  const panel = {
    x0: safe + size * 0.06,
    y0: safe + size * 0.06,
    x1: size - safe - size * 0.06,
    y1: size - safe - size * 0.06,
  };
  const panelRadius = size * 0.08;
  for (let y = Math.floor(panel.y0) - 2; y < Math.ceil(panel.y1) + 2; y++) {
    if (y < 0 || y >= size) continue;
    for (let x = Math.floor(panel.x0) - 2; x < Math.ceil(panel.x1) + 2; x++) {
      if (x < 0 || x >= size) continue;
      const coverage = roundedRectCoverage(
        x + 0.5,
        y + 0.5,
        panel.x0,
        panel.y0,
        panel.x1,
        panel.y1,
        panelRadius,
        feather
      );
      blend(rgba, (y * size + x) * 4, PANEL, coverage * 0.95);
    }
  }

  // Spectrum bars, sitting on a baseline inside the panel
  const barAreaX0 = panel.x0 + (panel.x1 - panel.x0) * 0.12;
  const barAreaX1 = panel.x1 - (panel.x1 - panel.x0) * 0.12;
  const baseline = panel.y1 - (panel.y1 - panel.y0) * 0.16;
  const topLimit = panel.y0 + (panel.y1 - panel.y0) * 0.14;
  const count = BAR_HEIGHTS.length;
  const slot = (barAreaX1 - barAreaX0) / count;
  const barWidth = slot * 0.62;
  const barRadius = barWidth * 0.35;

  for (let i = 0; i < count; i++) {
    const cx = barAreaX0 + slot * (i + 0.5);
    const x0 = cx - barWidth / 2;
    const x1 = cx + barWidth / 2;
    const height = (baseline - topLimit) * BAR_HEIGHTS[i];
    const y0 = baseline - height;
    const color = BAR_COLORS[i];
    for (let y = Math.floor(y0) - 2; y < Math.ceil(baseline) + 2; y++) {
      if (y < 0 || y >= size) continue;
      for (let x = Math.floor(x0) - 2; x < Math.ceil(x1) + 2; x++) {
        if (x < 0 || x >= size) continue;
        const coverage = roundedRectCoverage(
          x + 0.5,
          y + 0.5,
          x0,
          y0,
          x1,
          baseline,
          Math.min(barRadius, height / 2),
          feather
        );
        blend(rgba, (y * size + x) * 4, color, coverage);
      }
    }
  }

  // Baseline rule
  const ruleThickness = Math.max(1, size * 0.012);
  for (let y = Math.floor(baseline); y < Math.ceil(baseline + ruleThickness) + 1; y++) {
    if (y < 0 || y >= size) continue;
    for (let x = Math.floor(barAreaX0) - 2; x < Math.ceil(barAreaX1) + 2; x++) {
      if (x < 0 || x >= size) continue;
      const coverage = roundedRectCoverage(
        x + 0.5,
        y + 0.5,
        barAreaX0 - slot * 0.2,
        baseline,
        barAreaX1 + slot * 0.2,
        baseline + ruleThickness,
        ruleThickness / 2,
        feather
      );
      blend(rgba, (y * size + x) * 4, [100, 116, 139], coverage * 0.9);
    }
  }

  return rgba;
}

// ---------------------------------------------------------------------------
// SVG favicon (crisp at any size, no rasterisation needed)
// ---------------------------------------------------------------------------

function buildSvg() {
  const bars = BAR_HEIGHTS.map((h, i) => {
    const slot = 76 / BAR_HEIGHTS.length;
    const width = slot * 0.62;
    const cx = 26 + slot * (i + 0.5);
    const height = 56 * h;
    const [r, g, b] = BAR_COLORS[i];
    return `    <rect x="${(cx - width / 2).toFixed(2)}" y="${(84 - height).toFixed(2)}" width="${width.toFixed(2)}" height="${height.toFixed(2)}" rx="${(width * 0.35).toFixed(2)}" fill="rgb(${r},${g},${b})"/>`;
  }).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="WWDE NVH Sonoscope">
  <rect width="128" height="128" rx="28" fill="#080c12"/>
  <rect x="14" y="14" width="100" height="100" rx="12" fill="#0f1721"/>
${bars}
  <rect x="20" y="84" width="88" height="3" rx="1.5" fill="#64748b" opacity="0.9"/>
</svg>
`;
}

// ---------------------------------------------------------------------------

const targets = [
  { name: 'icon-192.png', size: 192, maskable: false },
  { name: 'icon-512.png', size: 512, maskable: false },
  { name: 'icon-maskable-192.png', size: 192, maskable: true },
  { name: 'icon-maskable-512.png', size: 512, maskable: true },
  { name: 'apple-touch-icon.png', size: 180, maskable: true },
];

await mkdir(outDir, { recursive: true });

for (const target of targets) {
  const rgba = drawIcon(target.size, target.maskable);
  const png = encodePng(target.size, target.size, rgba);
  await writeFile(path.join(outDir, target.name), png);
}

await writeFile(path.join(root, 'src/app/icon.svg'), buildSvg(), 'utf8');
await writeFile(path.join(outDir, 'icon.svg'), buildSvg(), 'utf8');

console.log(
  `[generate-assets] wrote ${targets.length} PNG icons to public/icons and the SVG favicon`
);
