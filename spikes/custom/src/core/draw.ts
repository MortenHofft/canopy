// Canvas2D drawing of one frame's draw list. Everything here reads typed arrays and the draw list; nothing
// allocates per node. Strokes are batched into one path per colour class.

import { nodeXY, type Transform } from './geom.ts';
import { ensureTrig, type Layout } from './layout.ts';
import { DrawList, K_NODE, K_STUB, K_SUMMARY, K_TIP, isSlice, radialWindow, radialWindowState } from './lod.ts';
import { MARKER_PX } from './hit.ts';
import type { LabelDensity, TreeSnapshot, TreeTheme } from './types.ts';

export interface Scene {
  tree: TreeSnapshot;
  L: Layout;
  T: Transform;
  list: DrawList;
  theme: TreeTheme;
  colours: string[]; // colour by class; class 0 = default branch colour
  classOf: Uint8Array | null;
  highlight: Uint8Array | null; // by tip rank
  hlRanks: Int32Array; // sorted highlighted ranks
  hoverNode: number;
  activeNode: number;
  density: LabelDensity;
  italic: boolean;
  format: (id: string) => string;
  scale: number; // canvas backing pixels per CSS pixel (after the DPR cap)
  thin: boolean; // radial and dense: branches are one device pixel wide (Skia hairline path, 10x cheaper on CPU raster)
}

/** Labels laid out this frame, for hit-testing and for the DOM overlay (one entry per drawn label). */
export class LabelList {
  rank = new Int32Array(512);
  x = new Float32Array(512); // start of the text (CSS px)
  y = new Float32Array(512); // vertical centre
  w = new Float32Array(512);
  h = new Float32Array(512);
  ang = new Float32Array(512); // radial: rotation in rad (0 for rectangular)
  flip = new Uint8Array(512);
  count = 0;
  clear(): void { this.count = 0; }
  add(rank: number, x: number, y: number, w: number, h: number, ang: number, flip: number): void {
    if (this.count === this.rank.length) {
      const g = <A extends Float32Array | Int32Array | Uint8Array>(a: A): A => { const b = new (a.constructor as new (n: number) => A)(a.length * 2); b.set(a); return b; };
      this.rank = g(this.rank); this.x = g(this.x); this.y = g(this.y); this.w = g(this.w); this.h = g(this.h); this.ang = g(this.ang); this.flip = g(this.flip);
    }
    const c = this.count++;
    this.rank[c] = rank; this.x[c] = x; this.y[c] = y; this.w[c] = w; this.h[c] = h; this.ang[c] = ang; this.flip[c] = flip;
  }
}

export const LABEL_MIN_PX: Record<LabelDensity, number> = { sparse: 16, normal: 11, dense: 8 };
export const RADIAL_LABEL_CAP = 300;
const STROKE_CHUNK = 256; // segments per stroke() call: a path with thousands of subpaths rasterises superlinearly (measured, CPU)
const FILL_CHUNK = 32; // fans per fill() call, same reason
export const BRANCH_W = 1.3;
export const CLADE_W = 2;
const TIP_DOT_PX = 6; // tip dots are drawn when rows are at least this tall

const widthCache = new Map<string, number>();
let widthFont = '';
export function textWidth(ctx: CanvasRenderingContext2D, text: string, font: string): number {
  if (font !== widthFont) {
    // the cache key includes the size, so a family change is the only reason to clear
    const fam = font.slice(font.indexOf('px') + 2);
    if (widthFont.slice(widthFont.indexOf('px') + 2) !== fam || widthCache.size > 20000) widthCache.clear();
    widthFont = font;
  }
  const key = font + '|' + text;
  let w = widthCache.get(key);
  if (w === undefined) {
    ctx.font = font;
    w = ctx.measureText(text).width;
    widthCache.set(key, w);
  }
  return w;
}

const clampY = (y: number, H: number) => (y < -64 ? -64 : y > H + 64 ? H + 64 : y);

/** Branches and collapsed clades. */
export function drawBody(ctx: CanvasRenderingContext2D, S: Scene, lineW: number): void {
  if (S.T.kind === 'radial') return drawBodyRadial(ctx, S, lineW);
  const { tree, L, T, list, colours, theme } = S;
  const { X, ROW, XMAX, LAST } = L;
  const { parent, firstChild, leafStart, leafEnd } = tree;
  const nCls = colours.length;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  for (let cls = 0; cls < nCls; cls++) {
    const col = cls === 0 ? theme.branch : colours[cls];
    ctx.strokeStyle = col;
    ctx.lineWidth = cls === 0 ? lineW : Math.max(lineW, CLADE_W);
    ctx.beginPath();
    let any = false;
    for (let e = 0; e < list.count; e++) {
      if (nCls > 1 && list.cls[e] !== cls) continue;
      any = true;
      if (list.last[e] >= 0) continue; // a run has no branch of its own (its members' branches lie inside the slice)
      const i = list.node[e];
      const kind = list.kind[e];
      const sx = T.ox + X[i] * T.kx;
      const sy = T.oy + ROW[i] * T.ky;
      if (i > 0) { const sxp = T.ox + X[parent[i]] * T.kx; ctx.moveTo(sxp, sy); ctx.lineTo(sx, sy); }
      if (kind === K_NODE) {
        ctx.moveTo(sx, clampY(T.oy + ROW[firstChild[i]] * T.ky, T.H));
        ctx.lineTo(sx, clampY(T.oy + ROW[LAST[i]] * T.ky, T.H));
      }
    }
    if (any) ctx.stroke();
  }
  // collapsed clades: triangle from the node to the clade's extent
  ctx.globalAlpha = 0.6;
  for (let cls = 0; cls < nCls; cls++) {
    ctx.fillStyle = cls === 0 ? theme.summary : colours[cls];
    ctx.beginPath();
    let any = false;
    for (let e = 0; e < list.count; e++) {
      if (list.kind[e] !== K_SUMMARY || (nCls > 1 && list.cls[e] !== cls)) continue;
      any = true;
      const i = list.node[e];
      const lm = list.last[e]; // run: from the parent's depth to the deepest member, over the members' rows
      const sx = T.ox + X[lm >= 0 ? parent[i] : i] * T.kx, sy = T.oy + ROW[i] * T.ky;
      let y0 = T.oy + leafStart[i] * T.ky, y1 = T.oy + leafEnd[lm >= 0 ? lm : i] * T.ky;
      if (y1 - y0 < 1.5) { const m = (y0 + y1) / 2; y0 = m - 0.75; y1 = m + 0.75; }
      const xm = Math.max(sx + 2, T.ox + (lm >= 0 ? list.xmax[e] : XMAX[i]) * T.kx);
      if (lm >= 0 || isSlice(tree, i)) { ctx.rect(sx, y0, xm - sx, y1 - y0); continue; } // polytomy of tips: a band, not a triangle
      ctx.moveTo(sx, sy);
      ctx.lineTo(xm, y0);
      ctx.lineTo(xm, y1);
      ctx.closePath();
    }
    if (any) ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Radial branches: one stroke() per colour class and 256 segments, connector arcs only where the arc differs from its
 *  chord by more than about 0.3 px (sagitta s^2/8r), long arcs of far-off clades clipped to the visible angles, summaries
 *  as filled fans. No trigonometry per node (cached cos/sin of the node angles). */
function drawBodyRadial(ctx: CanvasRenderingContext2D, S: Scene, lineW: number): void {
  const { tree, L, T, list, colours, theme } = S;
  ensureTrig(L);
  const COS = L.COS!, SIN = L.SIN!;
  const { X, ROW, XMAX, LAST } = L;
  const { parent, firstChild, leafStart, leafEnd } = tree;
  const { cx, cy, k, da } = T;
  const nCls = colours.length;
  radialWindow(cx, cy, T.clipL - 8, T.clipT - 8, T.clipR + 8, T.clipB + 8);
  const W = radialWindowState;
  const inv = 1 / S.scale;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'bevel';
  for (let cls = 0; cls < nCls; cls++) {
    ctx.strokeStyle = cls === 0 ? theme.branch : colours[cls];
    ctx.lineWidth = S.thin ? inv : cls === 0 ? lineW : Math.max(lineW, CLADE_W);
    ctx.beginPath();
    let segs = 0;
    for (let e = 0; e < list.count; e++) {
      if (nCls > 1 && list.cls[e] !== cls) continue;
      if (list.last[e] >= 0) continue; // run: no branch of its own
      const i = list.node[e];
      const ca = COS[i], sa = SIN[i];
      const r = X[i] * k;
      if (i > 0) {
        const rp = X[parent[i]] * k;
        ctx.moveTo(cx + rp * ca, cy + rp * sa);
        ctx.lineTo(cx + r * ca, cy + r * sa);
        segs++;
      }
      if (list.kind[e] === K_NODE) {
        const fc = firstChild[i], lc = LAST[i];
        const span = (ROW[lc] - ROW[fc]) * da;
        const len = span * r;
        ctx.moveTo(cx + r * COS[fc], cy + r * SIN[fc]);
        if (len * len <= 2.4 * r) ctx.lineTo(cx + r * COS[lc], cy + r * SIN[lc]);
        else {
          let a0 = ROW[fc] * da, a1 = ROW[lc] * da;
          if (!W.all && r > 2e4) {
            // far-off clade: only the visible angles (padded), as one or two arcs; a wrapped window can show both ends
            if (W.wrap) {
              if (a1 >= W.lo) { ctx.moveTo(cx + r * Math.cos(Math.max(a0, W.lo)), cy + r * Math.sin(Math.max(a0, W.lo))); ctx.arc(cx, cy, r, Math.max(a0, W.lo), a1); segs++; }
              if (a0 <= W.hi) { ctx.moveTo(cx + r * Math.cos(a0), cy + r * Math.sin(a0)); ctx.arc(cx, cy, r, a0, Math.min(a1, W.hi)); segs++; }
            } else {
              a0 = Math.max(a0, W.lo); a1 = Math.min(a1, W.hi);
              if (a1 > a0) { ctx.moveTo(cx + r * Math.cos(a0), cy + r * Math.sin(a0)); ctx.arc(cx, cy, r, a0, a1); }
            }
          } else ctx.arc(cx, cy, r, a0, a1);
        }
        segs++;
      }
      if (segs >= STROKE_CHUNK) { ctx.stroke(); ctx.beginPath(); segs = 0; }
    }
    if (segs) ctx.stroke();
  }
  // collapsed clades: fans (apex at the node, outer edge at the clade's radius, arc only when it is visibly curved)
  ctx.globalAlpha = 0.6;
  for (let cls = 0; cls < nCls; cls++) {
    ctx.fillStyle = cls === 0 ? theme.summary : colours[cls];
    ctx.beginPath();
    let n = 0;
    for (let e = 0; e < list.count; e++) {
      if (list.kind[e] !== K_SUMMARY || (nCls > 1 && list.cls[e] !== cls)) continue;
      const i = list.node[e];
      const lm = list.last[e]; // run: from the parent's depth to the deepest member, over the members' angles
      let a0 = leafStart[i] * da, a1 = leafEnd[lm >= 0 ? lm : i] * da;
      const r0 = X[lm >= 0 ? parent[i] : i] * k;
      const r1 = Math.max(r0 + 2, (lm >= 0 ? list.xmax[e] : XMAX[i]) * k);
      if ((a1 - a0) * r1 < 1.5) { const m = (a0 + a1) / 2, h = 0.75 / r1; a0 = m - h; a1 = m + h; } // keep slivers visible
      if (lm >= 0 || isSlice(tree, i)) {
        // polytomy of tips: the ring segment between the node's depth and the longest tip, over the clade's angles
        const len0 = (a1 - a0) * r1;
        ctx.moveTo(cx + r0 * Math.cos(a0), cy + r0 * Math.sin(a0));
        ctx.lineTo(cx + r1 * Math.cos(a0), cy + r1 * Math.sin(a0));
        if (len0 * len0 > 2.4 * r1 && r1 < 2e4) ctx.arc(cx, cy, r1, a0, a1); else ctx.lineTo(cx + r1 * Math.cos(a1), cy + r1 * Math.sin(a1));
        ctx.lineTo(cx + r0 * Math.cos(a1), cy + r0 * Math.sin(a1));
        const len1 = (a1 - a0) * r0;
        if (len1 * len1 > 2.4 * r0 && r0 < 2e4) ctx.arc(cx, cy, r0, a1, a0, true);
        ctx.closePath();
        if (++n >= FILL_CHUNK) { ctx.fill(); ctx.beginPath(); n = 0; }
        continue;
      }
      ctx.moveTo(cx + r0 * COS[i], cy + r0 * SIN[i]);
      ctx.lineTo(cx + r1 * Math.cos(a0), cy + r1 * Math.sin(a0));
      const len = (a1 - a0) * r1;
      if (len * len > 2.4 * r1 && r1 < 2e4) ctx.arc(cx, cy, r1, a0, a1);
      else ctx.lineTo(cx + r1 * Math.cos(a1), cy + r1 * Math.sin(a1));
      ctx.closePath();
      if (++n >= FILL_CHUNK) { ctx.fill(); ctx.beginPath(); n = 0; }
    }
    if (n) ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Tip dots and internal node markers. Returns nothing; positions are recomputed by hit-testing. */
export function drawMarkers(ctx: CanvasRenderingContext2D, S: Scene): void {
  const { tree, L, T, list, theme, colours } = S;
  const rect = T.kind === 'rectangular';
  const p = { x: 0, y: 0 };
  const tipPx = rect ? T.ky : (2 * Math.PI * T.k) / Math.max(1, tree.tipCount);
  const dots = tipPx >= TIP_DOT_PX;
  const rTip = Math.min(3.2, Math.max(1.5, tipPx * 0.25));
  // internal markers: small filled squares (cheap), only for clades big enough to click
  ctx.globalAlpha = 0.85;
  for (let cls = 0; cls < colours.length; cls++) {
    ctx.fillStyle = cls === 0 ? theme.branch : colours[cls];
    ctx.beginPath();
    let any = false;
    for (let e = 0; e < list.count; e++) {
      if (list.cls[e] !== cls) continue;
      const kind = list.kind[e];
      const i = list.node[e];
      if (kind === K_TIP) {
        if (!dots) continue;
        nodeXY(T, L, i, p);
        ctx.moveTo(p.x + rTip, p.y);
        ctx.arc(p.x, p.y, rTip, 0, 6.2832);
        any = true;
      } else if (kind === K_NODE) {
        const size = rect ? (tree.leafEnd[i] - tree.leafStart[i]) * T.ky : (tree.leafEnd[i] - tree.leafStart[i]) * T.da * L.XMAX[i] * T.k;
        if (size < MARKER_PX) continue;
        nodeXY(T, L, i, p);
        ctx.rect(p.x - 2, p.y - 2, 4, 4);
        any = true;
      }
    }
    if (any) ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function drawHighlights(ctx: CanvasRenderingContext2D, S: Scene, rightEdge: number): void {
  const { tree, L, T, theme, hlRanks } = S;
  if (!hlRanks.length) return;
  const rect = T.kind === 'rectangular';
  const p = { x: 0, y: 0 };
  ctx.fillStyle = theme.highlight;
  ctx.strokeStyle = theme.highlight;
  ctx.lineWidth = 2;
  for (let k = 0; k < hlRanks.length; k++) {
    const r = hlRanks[k];
    const node = tree.tipNode[r];
    if (rect) {
      const y = T.oy + r * T.ky;
      if (y + T.ky < T.clipT || y > T.clipB) continue;
      ctx.globalAlpha = 0.16;
      ctx.fillRect(0, y + T.ky / 2 - Math.max(3, T.ky) / 2, rightEdge, Math.max(3, T.ky));
      ctx.globalAlpha = 1;
      nodeXY(T, L, node, p);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, 6.2832);
      ctx.stroke();
    } else {
      nodeXY(T, L, node, p);
      if (p.x < -20 || p.y < -20 || p.x > T.W + 20 || p.y > T.H + 20) continue;
      const a = L.ROW[node] * T.da;
      ctx.globalAlpha = 0.16;
      ctx.lineWidth = Math.max(3, T.da * L.X[node] * T.k);
      ctx.beginPath();
      ctx.moveTo(T.cx, T.cy);
      ctx.lineTo(T.cx + 1.15 * T.k * Math.cos(a), T.cy + 1.15 * T.k * Math.sin(a));
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, 6.2832);
      ctx.stroke();
    }
  }
}

export function drawRing(ctx: CanvasRenderingContext2D, S: Scene, node: number, radius: number, colour: string, width: number): void {
  if (node < 0) return;
  const p = { x: 0, y: 0 };
  nodeXY(S.T, S.L, node, p);
  if (p.x < -20 || p.y < -20 || p.x > S.T.W + 20 || p.y > S.T.H + 20) return;
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, 6.2832);
  ctx.stroke();
}

/** Tip labels for drawn tips when rows (or arcs) are tall enough. Fills `labels` for hit-testing and the overlay.
 *  Radial: only when the angular pitch per tip is at least the font size, at most RADIAL_LABEL_CAP labels, and one
 *  setTransform per label instead of save/translate/rotate/restore (cos/sin come from the layout cache). */
export function drawLabels(ctx: CanvasRenderingContext2D, S: Scene, labels: LabelList, effMinPx: number): void {
  const { tree, L, T, list, theme, classOf, colours, highlight } = S;
  labels.clear();
  const rect = T.kind === 'rectangular';
  const pitch = rect ? T.ky : (2 * Math.PI * T.k) / Math.max(1, tree.tipCount);
  const need = LABEL_MIN_PX[S.density];
  if (pitch < need) return;
  const size = Math.max(8, Math.min(13, Math.round(pitch * 0.78)));
  const fontN = `${S.italic ? 'italic ' : ''}${size}px ${theme.fontFamily}`;
  const fontH = `${S.italic ? 'italic ' : ''}600 ${size}px ${theme.fontFamily}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const p = { x: 0, y: 0 };
  const MAXL = rect ? 600 : RADIAL_LABEL_CAP;
  const sc = S.scale;
  if (!rect) ensureTrig(L);
  let lastFont = '';
  let lastFill = '';
  let lastAlign = 'left';
  for (let e = 0; e < list.count && labels.count < MAXL; e++) {
    if (list.kind[e] !== K_TIP) continue;
    const i = list.node[e];
    const r = tree.tipRank[i];
    nodeXY(T, L, i, p);
    if (rect) {
      if (p.y < T.clipT - 4 || p.y > T.clipB + 4 || p.x > T.clipR) continue;
    } else if (p.x < -50 || p.y < -50 || p.x > T.W + 50 || p.y > T.H + 50) continue;
    const hl = highlight ? highlight[r] === 1 : false;
    const f = hl ? fontH : fontN;
    if (f !== lastFont) { ctx.font = f; lastFont = f; }
    const text = S.format(tree.tipLabels[r] ?? '');
    const w = textWidth(ctx, text, f);
    if (f !== lastFont) { ctx.font = f; lastFont = f; } // textWidth may have set the font
    const cl = classOf ? classOf[i] : 0;
    const fill = hl ? theme.highlight : cl ? colours[cl] : theme.foreground;
    if (fill !== lastFill) { ctx.fillStyle = fill; lastFill = fill; }
    if (rect) {
      const x = p.x + 8;
      ctx.fillText(text, x, p.y + 0.5);
      labels.add(r, x, p.y, w, size + 2, 0, 0);
    } else {
      const left = L.COS![i] < 0;
      const c = left ? -L.COS![i] : L.COS![i], sn = left ? -L.SIN![i] : L.SIN![i];
      ctx.setTransform(sc * c, sc * sn, -sc * sn, sc * c, sc * p.x, sc * p.y);
      const al = left ? 'right' : 'left';
      if (al !== lastAlign) { ctx.textAlign = al; lastAlign = al; }
      ctx.fillText(text, left ? -8 : 8, 0.5);
      const a = L.ROW[i] * T.da;
      labels.add(r, p.x, p.y, w, size + 2, left ? a + Math.PI : a, left ? 1 : 0);
    }
  }
  if (!rect) ctx.setTransform(sc, 0, 0, sc, 0, 0);
  ctx.textAlign = 'left';
}

// ------------------------------------------------------------------------------------------ axis and scale bar

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
}
const fmtTick = (v: number, step: number) => {
  const d = Math.max(0, -Math.floor(Math.log10(step)));
  return (Math.abs(v) < step * 1e-6 ? 0 : v).toFixed(Math.min(d, 6));
};

/** Rectangular phylogram: distance axis (time-before-tips axis for an ultrametric tree) in the footer band. */
export function drawAxis(ctx: CanvasRenderingContext2D, S: Scene, x0v: number, x1v: number): void {
  const { L, T, theme } = S;
  if (T.kind !== 'rectangular' || !L.usedLengths) return;
  const { ax, aw, ay, ah } = T.area;
  const y = ay + ah + 2;
  const maxLen = L.maxLen;
  const dated = L.ultrametric;
  ctx.save();
  ctx.font = `10px ${theme.fontFamily}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  ctx.strokeStyle = theme.muted;
  ctx.fillStyle = theme.muted;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.max(T.clipL, T.ox), y + 0.5);
  ctx.lineTo(Math.min(T.clipR, T.ox + T.kx), y + 0.5);
  ctx.stroke();
  const pxPerUnit = (T.kx / 1) / maxLen; // px per tree unit
  const step = niceStep(110 / pxPerUnit);
  // values shown: distance from the root, or age (time before the tips) for an ultrametric tree
  const dLo = Math.max(0, x0v) * maxLen, dHi = Math.min(1, x1v) * maxLen;
  const toPx = (d: number) => T.ox + (d / maxLen) * T.kx;
  ctx.beginPath();
  const gridAlpha = dated ? 0.12 : 0;
  const ticks: { px: number; label: string }[] = [];
  if (dated) {
    for (let age = Math.ceil((maxLen - dHi) / step) * step; age <= maxLen - dLo + 1e-12; age += step) ticks.push({ px: toPx(maxLen - age), label: fmtTick(age, step) });
  } else {
    for (let d = Math.ceil(dLo / step) * step; d <= dHi + 1e-12; d += step) ticks.push({ px: toPx(d), label: fmtTick(d, step) });
  }
  for (const t of ticks) { ctx.moveTo(t.px + 0.5, y); ctx.lineTo(t.px + 0.5, y + 4); }
  ctx.stroke();
  for (const t of ticks) if (t.px > T.clipL + 8 && t.px < T.clipR - 8) ctx.fillText(t.label, t.px, y + 5);
  if (gridAlpha) {
    ctx.globalAlpha = gridAlpha;
    ctx.beginPath();
    for (const t of ticks) { ctx.moveTo(t.px + 0.5, ay); ctx.lineTo(t.px + 0.5, ay + ah); }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = 'left';
  ctx.fillText(dated ? 'time before tips (tree units)' : 'distance from root (tree units)', Math.max(ax, 4), y + 16);
  ctx.restore();
  void aw;
}

/** Radial: a scale bar of a round length at the bottom left. */
export function drawScaleBar(ctx: CanvasRenderingContext2D, S: Scene): void {
  const { L, T, theme } = S;
  if (T.kind !== 'radial' || !L.usedLengths) return;
  const pxPerUnit = T.k / L.maxLen;
  const step = niceStep(90 / pxPerUnit);
  const w = step * pxPerUnit;
  const x = Math.max(14, T.W - w - 18), y = T.H - 18;
  ctx.save();
  ctx.strokeStyle = theme.muted;
  ctx.fillStyle = theme.muted;
  ctx.lineWidth = 1.5;
  ctx.font = `10px ${theme.fontFamily}`;
  ctx.textBaseline = 'bottom';
  ctx.beginPath();
  ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 3); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.moveTo(x + w, y - 3); ctx.lineTo(x + w, y + 3);
  ctx.stroke();
  ctx.fillText(fmtTick(step, step), x, y - 5);
  ctx.restore();
}

export { K_STUB };
