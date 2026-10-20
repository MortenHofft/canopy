// Aligned per-tip columns drawn on the canvas, in the same row coordinates as the tree (rectangular layout).
//  bar        log-scaled bars; below one pixel per row, rows are binned per pixel row (mean) so the cost is
//             bounded by the screen height and the column doubles as a summary of collapsed clades
//  text       text when rows are >= 9 px tall, tinted bands below that
//  alignment  residues as coloured cells: the whole alignment is rasterised once into an offscreen bitmap (one
//             pixel per residue) and only the visible rows are blitted; very large alignments fall back to
//             drawing runs for visible rows only
// Values are looked up by tip label once, when the columns change, into arrays by tip rank.

import type { Transform } from './geom.ts';
import type { Column, TreeSnapshot, TreeTheme } from './types.ts';

export const COL_GAP = 6;

export interface CompiledColumn {
  spec: Column;
  num: Float64Array | null; // bar: value by rank (NaN = no value)
  txt: (string | undefined)[] | null; // text and alignment: string by rank
  has: Uint8Array;
  max: number;
  seqLen: number;
  bitmap: HTMLCanvasElement | null;
  x: number; // left edge in container px, set by layoutColumns
}

const RESIDUE: Record<string, string> = {};
for (const c of 'AILMFWVC') RESIDUE[c] = '#80a0f0';
for (const c of 'KR') RESIDUE[c] = '#f01505';
for (const c of 'ED') RESIDUE[c] = '#c048c0';
for (const c of 'NQST') RESIDUE[c] = '#15c015';
RESIDUE.G = '#f09048';
RESIDUE.P = '#c0c000';
for (const c of 'HY') RESIDUE[c] = '#15a4a4';
RESIDUE.U = '#15c015';

function residueTable(): Uint32Array {
  const t = new Uint32Array(256);
  const parse = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return (255 << 24) | (b << 16) | (g << 8) | r; // ABGR for a little-endian Uint32 view of ImageData
  };
  for (let c = 0; c < 256; c++) {
    const ch = String.fromCharCode(c).toUpperCase();
    t[c] = ch === '-' || ch === '.' ? 0 : parse(RESIDUE[ch] ?? '#e2e2e2');
  }
  return t;
}

export function compileColumns(tree: TreeSnapshot, cols: Column[]): CompiledColumn[] {
  const N = tree.tipCount;
  return cols.map((spec) => {
    const has = new Uint8Array(N);
    let num: Float64Array | null = null;
    let txt: (string | undefined)[] | null = null;
    let max = 0;
    let seqLen = 0;
    let bitmap: HTMLCanvasElement | null = null;
    if (spec.kind === 'bar') {
      num = new Float64Array(N).fill(NaN);
      for (let r = 0; r < N; r++) {
        const v = spec.values[tree.tipLabels[r]];
        if (v === undefined) continue;
        const x = Number(v);
        if (x === x) { num[r] = x; has[r] = 1; if (x > max) max = x; }
      }
    } else {
      txt = new Array(N);
      for (let r = 0; r < N; r++) {
        const v = spec.values[tree.tipLabels[r]];
        if (v === undefined) continue;
        const s = String(v);
        txt[r] = s;
        has[r] = 1;
        if (s.length > seqLen) seqLen = s.length;
      }
      if (spec.kind === 'alignment' && seqLen > 0 && N * seqLen <= 8_000_000 && typeof document !== 'undefined') {
        bitmap = document.createElement('canvas');
        bitmap.width = seqLen;
        bitmap.height = N;
        const ctx = bitmap.getContext('2d');
        if (ctx) {
          const img = ctx.createImageData(seqLen, N);
          const px = new Uint32Array(img.data.buffer);
          const tab = residueTable();
          for (let r = 0; r < N; r++) {
            const s = txt[r];
            if (s === undefined) continue;
            const o = r * seqLen;
            for (let j = 0; j < s.length; j++) px[o + j] = tab[s.charCodeAt(j) & 255];
          }
          ctx.putImageData(img, 0, 0);
        } else bitmap = null;
      }
    }
    return { spec, num, txt, has, max, seqLen, bitmap, x: 0 };
  });
}

export function columnsWidth(cols: { spec: { width: number } }[]): number {
  let w = 0;
  for (const c of cols) w += c.spec.width + COL_GAP;
  return w;
}

export function layoutColumns(cols: CompiledColumn[], left: number): void {
  let x = left;
  for (const c of cols) {
    c.x = x;
    x += c.spec.width + COL_GAP;
  }
}

export function barWidth(v: number, max: number, w: number): number {
  if (!(max > 0) || !(v > 0)) return 1;
  return Math.max(1, (Math.log10(1 + v) / Math.log10(1 + max)) * (w - 4));
}

const TEXT_ROW_PX = 9;

export function drawColumns(ctx: CanvasRenderingContext2D, cols: CompiledColumn[], tree: TreeSnapshot, T: Transform, theme: TreeTheme, headY: number, barColour: string): void {
  if (!cols.length || T.kind !== 'rectangular') return;
  const N = tree.tipCount;
  const { oy, ky, area } = T;
  const top = area.ay, bottom = area.ay + area.ah;
  const r0 = Math.max(0, Math.floor((top - oy) / ky));
  const r1 = Math.min(N - 1, Math.ceil((bottom - oy) / ky));
  ctx.save();
  for (const c of cols) {
    const w = c.spec.width;
    ctx.fillStyle = theme.muted;
    ctx.font = `600 11px ${theme.fontFamily}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(c.spec.header, c.x, headY, w);
    if (r1 < r0) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(c.x, top, w, bottom - top);
    ctx.clip();
    if (c.spec.kind === 'alignment' && c.bitmap) {
      ctx.imageSmoothingEnabled = ky < 1;
      ctx.drawImage(c.bitmap, 0, r0, c.seqLen, r1 - r0 + 1, c.x, oy + r0 * ky, w, (r1 - r0 + 1) * ky);
    } else if (ky < 1.5) {
      // bin rows per pixel row; mean value for bars, presence for the others
      const H = Math.ceil(bottom - top) + 2;
      const sum = new Float64Array(H), cnt = new Float64Array(H), any = new Uint8Array(H);
      for (let r = r0; r <= r1; r++) {
        const p = Math.floor(oy + r * ky - top);
        if (p < 0 || p >= H || !c.has[r]) continue;
        any[p] = 1;
        if (c.num) { sum[p] += c.num[r]; cnt[p]++; }
      }
      ctx.fillStyle = barColour;
      if (c.spec.kind !== 'bar') ctx.globalAlpha = 0.45;
      for (let p = 0; p < H; p++) {
        if (!any[p]) continue;
        const bw = c.num ? barWidth(sum[p] / cnt[p], c.max, w) : w - 4;
        ctx.fillRect(c.x + 2, top + p, bw, 1);
      }
      ctx.globalAlpha = 1;
    } else if (c.spec.kind === 'bar' && c.num) {
      ctx.fillStyle = barColour;
      for (let r = r0; r <= r1; r++) if (c.has[r]) ctx.fillRect(c.x + 2, oy + r * ky + ky * 0.1, barWidth(c.num[r], c.max, w), Math.max(1, ky * 0.8));
    } else if (c.spec.kind === 'text' && c.txt) {
      const fs = Math.min(12, ky * 0.7);
      if (ky >= TEXT_ROW_PX) {
        ctx.fillStyle = theme.foreground;
        ctx.font = `${fs}px ${theme.fontFamily}`;
        ctx.textBaseline = 'middle';
        for (let r = r0; r <= r1; r++) if (c.has[r]) ctx.fillText(c.txt[r]!, c.x + 2, oy + (r + 0.5) * ky, w - 4);
      } else {
        ctx.fillStyle = barColour;
        ctx.globalAlpha = 0.35;
        for (let r = r0; r <= r1; r++) if (c.has[r]) ctx.fillRect(c.x + 2, oy + r * ky, w - 4, Math.max(1, ky));
        ctx.globalAlpha = 1;
      }
    } else if (c.spec.kind === 'alignment' && c.txt) {
      // large alignment fallback: runs of equal colour for visible rows only
      const tab = residueTable();
      const cw = w / Math.max(1, c.seqLen);
      for (let r = r0; r <= r1; r++) {
        const s = c.txt[r];
        if (s === undefined) continue;
        const y = oy + r * ky;
        let run = 0;
        for (let j = 1; j <= s.length; j++) {
          if (j === s.length || tab[s.charCodeAt(j) & 255] !== tab[s.charCodeAt(run) & 255]) {
            const v = tab[s.charCodeAt(run) & 255];
            if (v) {
              ctx.fillStyle = `rgb(${v & 255},${(v >> 8) & 255},${(v >> 16) & 255})`;
              ctx.fillRect(c.x + run * cw, y, (j - run) * cw + 0.3, Math.max(1, ky - (ky > 3 ? 1 : 0)));
            }
            run = j;
          }
        }
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

/** Drawn extent of the cell for tip rank r, in container px (same geometry as drawColumns). */
export function cellRect(c: CompiledColumn, r: number, T: Transform): { x: number; y: number; width: number; height: number } | null {
  if (T.kind !== 'rectangular' || r < 0 || !c.has[r]) return null;
  const y = T.oy + r * T.ky;
  if (y + T.ky < T.area.ay || y > T.area.ay + T.area.ah) return null;
  const w = c.spec.width;
  if (c.spec.kind === 'bar' && c.num) {
    if (T.ky >= 1.5) return { x: c.x + 2, y: y + T.ky * 0.1, width: barWidth(c.num[r], c.max, w), height: Math.max(1, T.ky * 0.8) };
    return { x: c.x + 2, y, width: barWidth(c.num[r], c.max, w), height: Math.max(1, T.ky) };
  }
  return { x: c.x, y, width: w, height: Math.max(1, T.ky) };
}
