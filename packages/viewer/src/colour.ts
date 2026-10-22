// Reading CSS colours: a colour is drawn on a 1x1 canvas and read back, so every syntax the browser knows works (names, hsl(), oklch(),
// color-mix(), #rgba, ...). Without a 2D canvas (tests, workers) only #rgb, #rrggbb and rgb()/rgba() are understood.

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0..1 */
  a: number;
}

let probe: CanvasRenderingContext2D | null = null;
let probeDoc: unknown = undefined; // the document the probe was made for: a test may swap the global
let probeMade = false;
const cache = new Map<string, Rgba | null>();

function getProbe(): CanvasRenderingContext2D | null {
  const doc = typeof document === 'undefined' ? null : document;
  if (probeMade && doc === probeDoc) return probe;
  probeMade = true;
  probeDoc = doc;
  probe = null;
  cache.clear();
  if (doc) {
    try {
      const c = doc.createElement('canvas');
      c.width = c.height = 1;
      probe = c.getContext('2d', { willReadFrequently: true }) ?? null;
      if (probe && typeof probe.getImageData !== 'function') probe = null;
    } catch {
      probe = null;
    }
  }
  return probe;
}

function pixelOf(p: CanvasRenderingContext2D, sentinel: string, colour: string): number[] {
  p.clearRect(0, 0, 1, 1);
  p.fillStyle = sentinel;
  p.fillStyle = colour; // an unknown colour is ignored by the browser: the sentinel stays
  p.fillRect(0, 0, 1, 1);
  return Array.from(p.getImageData(0, 0, 1, 1).data);
}

/** The anchored #rgb, #rrggbb and rgb()/rgba() forms, for when there is no canvas. */
function parseSimple(colour: string): Rgba | null {
  const c = colour.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join('') : hex[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  const m = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)(?:\s*[\s,/]\s*(\d*\.?\d+)(%?))?\s*\)$/i.exec(c);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[5] ? Number(m[4]) / 100 : Number(m[4]);
  return {
    r: Math.min(255, Math.round(Number(m[1]))),
    g: Math.min(255, Math.round(Number(m[2]))),
    b: Math.min(255, Math.round(Number(m[3]))),
    a: Math.min(1, a),
  };
}

/** The colour a CSS colour string is drawn as, or null when it is not a colour (the browser ignores it) or, without a canvas, not one of
 *  the simple forms. Results are cached per string, so resolving the same theme again costs a lookup. */
export function resolveColour(colour: string): Rgba | null {
  const key = colour.trim();
  if (!key) return null;
  const p = getProbe(); // first: it drops the cache when the document changed
  if (cache.has(key)) return cache.get(key)!;
  let out: Rgba | null;
  if (!p) out = parseSimple(key);
  else {
    try {
      const a = pixelOf(p, '#000', key);
      const b = pixelOf(p, '#fff', key);
      out = a.every((v, i) => v === b[i]) ? { r: a[0], g: a[1], b: a[2], a: a[3] / 255 } : null; // the sentinels differ: nothing was drawn
    } catch {
      out = parseSimple(key);
    }
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, out);
  return out;
}

/** Whether a CSS colour is fully opaque (exact for rgba, #rgba, hsl(… / a), color-mix, 'transparent'). Without a 2D canvas (tests,
 *  workers) only 'transparent' and the simple forms with an alpha below 1 count as not opaque; anything else is taken as opaque. */
export function isOpaque(colour: string): boolean {
  if (colour.trim().toLowerCase() === 'transparent') return false;
  const p = getProbe();
  if (!p) {
    const s = parseSimple(colour);
    return !s || s.a === 1;
  }
  p.clearRect(0, 0, 1, 1);
  p.fillStyle = '#000';
  p.fillStyle = colour;
  p.fillRect(0, 0, 1, 1);
  return p.getImageData(0, 0, 1, 1).data[3] === 255;
}

/** Relative luminance (0..1) of a resolved colour. */
export function luminanceOf(c: Rgba): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** `#rrggbb` of a resolved colour (alpha dropped). */
export function toHex(c: Rgba): string {
  const h = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return '#' + h(c.r) + h(c.g) + h(c.b);
}
