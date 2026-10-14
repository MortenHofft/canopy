// Pixel checks on PNG screenshots (pngjs).
import { PNG } from 'pngjs';

export const decode = (buf) => PNG.sync.read(buf);

export function hexToRgb(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(h);
  if (!m) throw new Error(`bad colour ${h}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Pixels within Euclidean RGB distance `tol` of `rgb`. */
export function countNear(png, rgb, tol = 100) {
  const d = png.data;
  const t2 = tol * tol;
  let c = 0;
  for (let i = 0; i < d.length; i += 4) {
    const dr = d[i] - rgb[0], dg = d[i + 1] - rgb[1], db = d[i + 2] - rgb[2];
    if (dr * dr + dg * dg + db * db <= t2) c++;
  }
  return { count: c, total: d.length / 4, frac: c / (d.length / 4) };
}

export function meanLuminance(png) {
  const d = png.data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  return s / (d.length / 4);
}

/** The most common colour (quantised to 4 bits per channel) and its fraction: the background of a tree screenshot. */
export function dominant(png) {
  const d = png.data;
  const m = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    m.set(k, (m.get(k) || 0) + 1);
  }
  let best = 0, bk = 0;
  for (const [k, v] of m) if (v > best) { best = v; bk = k; }
  return { rgb: [((bk >> 8) & 15) * 17, ((bk >> 4) & 15) * 17, (bk & 15) * 17], frac: best / (d.length / 4) };
}

/** Fraction of pixels that differ from the dominant colour by more than `tol`: "something was drawn". */
export function inkFraction(png, tol = 40) {
  const dom = dominant(png).rgb;
  return 1 - countNear(png, dom, tol).frac;
}

/** Number of distinct colour buckets (4 bits/channel) holding at least `minFrac` of the pixels. */
export function colourBuckets(png, minFrac = 0.004) {
  const d = png.data;
  const m = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const k = ((d[i] >> 5) << 6) | ((d[i + 1] >> 5) << 3) | (d[i + 2] >> 5);
    m.set(k, (m.get(k) || 0) + 1);
  }
  const n = d.length / 4;
  let c = 0;
  for (const v of m.values()) if (v / n >= minFrac) c++;
  return c;
}

/** Number of pixels that differ between two same-size images by more than `tol` in any channel. */
export function diffCount(a, b, tol = 24) {
  if (a.width !== b.width || a.height !== b.height) return Infinity;
  let c = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) > tol || Math.abs(a.data[i + 1] - b.data[i + 1]) > tol || Math.abs(a.data[i + 2] - b.data[i + 2]) > tol) c++;
  }
  return c;
}

function halve(png) {
  const w = Math.max(1, png.width >> 1), h = Math.max(1, png.height >> 1);
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++) {
        const s = (png.data[((2 * y) * png.width + 2 * x) * 4 + c] + png.data[((2 * y) * png.width + 2 * x + 1) * 4 + c] + png.data[((2 * y + 1) * png.width + 2 * x) * 4 + c] + png.data[((2 * y + 1) * png.width + 2 * x + 1) * 4 + c]) / 4;
        out.data[(y * w + x) * 4 + c] = s;
      }
  return out;
}

/** Re-encode a PNG, halving the resolution until it is at most maxBytes. */
export function shrinkPng(buf, maxBytes = 140 * 1024) {
  let png = decode(buf);
  let out = PNG.sync.write(png, { deflateLevel: 9 });
  while (out.length > maxBytes && png.width > 80) {
    png = halve(png);
    out = PNG.sync.write(png, { deflateLevel: 9 });
  }
  return out;
}

/**
 * Pixels that moved towards `rgb`: closer to it than the same pixel in `before` by more than `margin` (RGB distance).
 * Relative to the pre-existing pixels, so thin anti-aliased branches (a 0.4 px line gives pale pink, never pure red) count.
 */
export function tintCount(after, before, rgb, margin = 40) {
  if (after.width !== before.width || after.height !== before.height) return { count: 0, total: after.width * after.height, frac: NaN };
  const a = after.data, b = before.data;
  let c = 0;
  for (let i = 0; i < a.length; i += 4) {
    const da = Math.hypot(a[i] - rgb[0], a[i + 1] - rgb[1], a[i + 2] - rgb[2]);
    const db = Math.hypot(b[i] - rgb[0], b[i + 1] - rgb[1], b[i + 2] - rgb[2]);
    if (da + margin < db) c++;
  }
  const total = a.length / 4;
  return { count: c, total, frac: c / total };
}
