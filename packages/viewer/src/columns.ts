// Aligned per-tip columns drawn on the canvas, in the same row coordinates as the tree (rectangular layout).
//  bar        log-scaled bars; below one pixel per row, rows are binned per pixel row (mean) so the cost is
//             bounded by the screen height and the column doubles as a summary of collapsed clades
//  text       text when rows are >= 9 px tall, tinted bands below that
//  alignment  residues as coloured cells: the whole alignment is rasterised once into an offscreen bitmap (one
//             pixel per residue) and only the visible rows are blitted; very large alignments fall back to
//             drawing runs for visible rows only
//  custom     the app's ColumnRenderer: prepare() when the values change, draw() once per frame with the visible rows
// Values are looked up by tip label once, when the columns change, into arrays by tip rank.

import type { Transform } from './geom.ts';
import { detectAlphabet, residueTable, type ResolvedAlphabet } from './residues.ts';
import { FALLBACK_THEME, type Column, type ColumnFrame, type TreeSnapshot, type TreeTheme } from './types.ts';

export const COL_GAP = 6;

export interface CompiledColumn {
  spec: Column;
  num: Float64Array | null; // bar: value by rank (NaN = no value)
  txt: (string | undefined)[] | null; // text and alignment: string by rank
  has: Uint8Array;
  max: number;
  seqLen: number;
  bitmap: HTMLCanvasElement | null;
  alphabet: ResolvedAlphabet | null; // alignment: the scheme in use ('auto' resolved)
  table: Uint32Array | null; // alignment: ABGR colour by character code, from the theme it was compiled with (see recolourColumns)
  runs: (Int32Array | undefined)[]; // alignment: start,end pairs of the gap-free stretches by rank, filled on first use
  data: unknown; // custom: what the renderer's prepare() returned
  x: number; // left edge in container px, set by layoutColumns
}

/** Compile one column spec: the values are looked up by tip label once, into arrays by tip rank (and, for an alignment, one bitmap
 *  coloured from the theme's residue tokens). */
export function compileColumn(tree: TreeSnapshot, spec: Column, theme: TreeTheme = FALLBACK_THEME): CompiledColumn {
  const N = tree.tipCount;
  const has = new Uint8Array(N);
  let num: Float64Array | null = null;
  let txt: (string | undefined)[] | null = null;
  let max = 0;
  let seqLen = 0;
  let bitmap: HTMLCanvasElement | null = null;
  let alphabet: ResolvedAlphabet | null = null;
  let table: Uint32Array | null = null;
  if (spec.kind === 'custom') {
    const data = spec.renderer.prepare({ values: spec.values, tipLabels: tree.tipLabels, tipCount: N });
    for (let r = 0; r < N; r++) {
      const l = tree.tipLabels[r];
      if (spec.renderer.hasCell ? spec.renderer.hasCell(data, r) : l !== undefined && spec.values[l] !== undefined) has[r] = 1;
    }
    return { spec, num, txt, has, max, seqLen, bitmap, alphabet, table, runs: [], data, x: 0 };
  }
  if (spec.kind === 'bar') {
    num = new Float64Array(N).fill(NaN);
    for (let r = 0; r < N; r++) {
      const v = spec.values[tree.tipLabels[r]];
      if (v === undefined) continue;
      const x = Number(v);
      if (!Number.isNaN(x)) {
        num[r] = x;
        has[r] = 1;
        if (x > max) max = x;
      }
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
    if (spec.kind === 'alignment') {
      alphabet = !spec.alphabet || spec.alphabet === 'auto' ? detectAlphabet(txt) : spec.alphabet;
      table = residueTable(theme, alphabet);
    }
    if (spec.kind === 'alignment' && table && seqLen > 0 && N * seqLen <= 8_000_000 && typeof document !== 'undefined') {
      bitmap = document.createElement('canvas');
      bitmap.width = seqLen;
      bitmap.height = N;
      const ctx = bitmap.getContext('2d');
      if (ctx) {
        const img = ctx.createImageData(seqLen, N);
        const px = new Uint32Array(img.data.buffer);
        const tab = table;
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
  return { spec, num, txt, has, max, seqLen, bitmap, alphabet, table, runs: [], data: null, x: 0 };
}

/** Same column for everything the renderer reads from the spec. `values` is compared by reference: it is a dictionary keyed by tip label,
 *  possibly millions of entries, and a deep compare would cost as much as recompiling. Replace the object to change the data. The same
 *  Column object (`a === b`) is taken as unchanged without looking at it, so Column objects must be replaced, never mutated in place. */
export function columnSpecEquals(a: Column, b: Column): boolean {
  return a === b || (a.id === b.id && a.kind === b.kind && a.header === b.header && a.width === b.width && sameData(a, b));
}

/** Same data: same values object, for a custom column the same renderer (its prepare() made the data), for an alignment the same alphabet
 *  (the bitmap's colours). */
function sameData(a: Column, b: Column): boolean {
  if (a.values !== b.values) return false;
  if (a.kind === 'custom') return b.kind === 'custom' && a.renderer === b.renderer;
  if (a.kind === 'alignment') return b.kind === 'alignment' && (a.alphabet ?? 'auto') === (b.alphabet ?? 'auto');
  return true;
}

/** The new compiled list for `cols`, reusing what `old` already holds: a column with an identical spec (by `columnSpecEquals`) is kept as is,
 *  one whose data is the same (same kind and `values` reference) but whose header or width changed keeps its arrays and bitmap under the
 *  new spec, and only the rest is compiled. Ids must be unique: a second column with an id already used in the list is compiled afresh on
 *  every call (a compiled column carries its own screen position, so it cannot be shared) and `same` is then never true. `same` is true when the result equals `old` entry for entry, so the caller can stop there. */
export function updateColumns(
  tree: TreeSnapshot,
  old: CompiledColumn[],
  cols: Column[],
  theme: TreeTheme = FALLBACK_THEME,
): { columns: CompiledColumn[]; same: boolean } {
  const byId = new Map<string, CompiledColumn>(); // a duplicate id is a caller error; the second one is compiled afresh, never shares a compiled object
  for (const c of old) byId.set(c.spec.id, c);
  let same = cols.length === old.length;
  const columns = cols.map((spec, i) => {
    const prev = byId.get(spec.id);
    byId.delete(spec.id);
    if (prev && columnSpecEquals(prev.spec, spec)) {
      if (old[i] !== prev) same = false;
      return prev;
    }
    same = false;
    if (prev && prev.spec.kind === spec.kind && sameData(prev.spec, spec)) return { ...prev, spec };
    return compileColumn(tree, spec, theme);
  });
  return { columns, same };
}

/** The alignment columns of `cols` painted again for `theme`: an alignment whose residue table changed is compiled again (the bitmap holds
 *  the colours), the others are kept. Returns the new list, or `cols` itself when no colour changed. */
export function recolourColumns(tree: TreeSnapshot, cols: CompiledColumn[], theme: TreeTheme): CompiledColumn[] {
  let out: CompiledColumn[] | null = null;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (!c.alphabet || !c.table) continue;
    const tab = residueTable(theme, c.alphabet);
    let same = true;
    for (let j = 0; j < 256 && same; j++) if (tab[j] !== c.table[j]) same = false;
    if (same) continue;
    out ??= cols.slice();
    out[i] = { ...compileColumn(tree, c.spec, theme), x: c.x };
  }
  return out ?? cols;
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
const GAP_ROW_PX = 4; // rows thinner than this get no gap between them
const BLOCK_ROW_PX = 1.5; // blocks need rows at least this tall, below it the residue bitmap is used

export interface ColumnDrawOptions {
  alignStyle: 'residues' | 'blocks';
}

/** Start/end pairs (alignment columns) of the stretches without gaps in the sequence of rank r, cached on the column. */
function runsOf(c: CompiledColumn, r: number): Int32Array {
  let v = c.runs[r];
  if (v) return v;
  const s = c.txt![r] ?? '';
  const out: number[] = [];
  let start = -1;
  for (let j = 0; j <= s.length; j++) {
    const ch = j < s.length ? s.charCodeAt(j) : 45;
    const gap = ch === 45 || ch === 46;
    if (!gap && start < 0) start = j;
    else if (gap && start >= 0) {
      out.push(start, j);
      start = -1;
    }
  }
  v = Int32Array.from(out);
  c.runs[r] = v;
  return v;
}

/** The frame handed to custom renderers, reused (one per draw, never kept by the renderer). */
const FRAME: { -readonly [K in keyof ColumnFrame]: ColumnFrame[K] } = {
  x: 0,
  width: 0,
  top: 0,
  bottom: 0,
  r0: 0,
  r1: -1,
  oy: 0,
  rowHeight: 1,
  theme: null as unknown as TreeTheme,
};

const reported = new Set<string>();
function reportOnce(id: string, err: unknown): void {
  if (reported.has(id)) return;
  reported.add(id);
  console.error(`column ${JSON.stringify(id)}: renderer failed`, err);
}

export function drawColumns(
  ctx: CanvasRenderingContext2D,
  cols: CompiledColumn[],
  tree: TreeSnapshot,
  T: Transform,
  theme: TreeTheme,
  headY: number,
  barColour: string,
  opts: ColumnDrawOptions = { alignStyle: 'residues' },
): void {
  if (!cols.length || T.kind !== 'rectangular') return;
  const N = tree.tipCount;
  const { oy, ky, area } = T;
  const top = area.ay,
    bottom = area.ay + area.ah;
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
    if (c.spec.kind === 'custom') {
      const f = FRAME;
      f.x = c.x;
      f.width = w;
      f.top = top;
      f.bottom = bottom;
      f.r0 = r0;
      f.r1 = r1;
      f.oy = oy;
      f.rowHeight = ky;
      f.theme = theme;
      try {
        c.spec.renderer.draw(ctx, f, c.data);
      } catch (err) {
        reportOnce(c.spec.id, err); // a broken renderer must not stop the frame
      }
    } else if (c.spec.kind === 'alignment' && c.txt && opts.alignStyle === 'blocks' && ky >= BLOCK_ROW_PX) {
      // ETE style: a thin line over the whole width, grey blocks over the stretches without gaps
      const cw = w / Math.max(1, c.seqLen);
      const inset = ky >= GAP_ROW_PX ? Math.max(theme.alignRowGap, ky * 0.25) : 0;
      const bh = Math.max(1, ky - inset);
      const rr = Math.min(3, bh / 2);
      const canRound = typeof ctx.roundRect === 'function' && bh >= 4;
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let r = r0; r <= r1; r++) {
        if (!c.has[r] || ky < GAP_ROW_PX) continue;
        const ym = Math.round(oy + (r + 0.5) * ky) + 0.5;
        ctx.moveTo(c.x, ym);
        ctx.lineTo(c.x + w, ym);
      }
      ctx.stroke();
      ctx.fillStyle = theme.summary;
      ctx.beginPath();
      for (let r = r0; r <= r1; r++) {
        if (!c.has[r]) continue;
        const runs = runsOf(c, r);
        const y = oy + r * ky + inset / 2;
        for (let k = 0; k < runs.length; k += 2) {
          const x0 = c.x + runs[k] * cw,
            bw = Math.max(1, (runs[k + 1] - runs[k]) * cw);
          if (canRound) ctx.roundRect(x0, y, bw, bh, Math.min(rr, bw / 2));
          else ctx.rect(x0, y, bw, bh);
        }
      }
      ctx.fill();
    } else if (c.spec.kind === 'alignment' && c.bitmap && theme.alignRowGap > 0 && ky >= GAP_ROW_PX) {
      // residues with a gap between sequences: one blit per visible row, a little shorter than the row
      ctx.imageSmoothingEnabled = false;
      const g = Math.min(theme.alignRowGap, ky - 1);
      for (let r = r0; r <= r1; r++) ctx.drawImage(c.bitmap, 0, r, c.seqLen, 1, c.x, oy + r * ky + g / 2, w, ky - g);
    } else if (c.spec.kind === 'alignment' && c.bitmap) {
      ctx.imageSmoothingEnabled = ky < 1;
      ctx.drawImage(c.bitmap, 0, r0, c.seqLen, r1 - r0 + 1, c.x, oy + r0 * ky, w, (r1 - r0 + 1) * ky);
    } else if (ky < 1.5) {
      // bin rows per pixel row; mean value for bars, presence for the others
      const H = Math.ceil(bottom - top) + 2;
      const sum = new Float64Array(H),
        cnt = new Float64Array(H),
        any = new Uint8Array(H);
      for (let r = r0; r <= r1; r++) {
        const p = Math.floor(oy + r * ky - top);
        if (p < 0 || p >= H || !c.has[r]) continue;
        any[p] = 1;
        if (c.num) {
          sum[p] += c.num[r];
          cnt[p]++;
        }
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
      const tab = c.table!;
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
