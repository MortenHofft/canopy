// Canvas2D drawing of one frame's draw list. Everything here reads typed arrays and the draw list; nothing
// allocates per node. Strokes are batched into one path per colour class.

import { ARC_SAGITTA_K, CLAMP_Y_PAD_PX, RADIAL_FAR_ARC_R } from './constants.ts';
import { DrawList, K_NODE, K_STUB, K_SUMMARY, K_TIP, isSlice } from './lod.ts';
import { MARKER_PX } from './hit.ts';
import { labelMinPx } from './sizes.ts';
import type { LayoutProjection, Pt, RadialProjection } from './projection.ts';
import { internalSupport, type NodeLabelKind, type NodeLabelsOption } from './node-label.ts';
import type { LabelDensity, TreeTheme } from './types.ts';

export interface Scene {
  proj: LayoutProjection; // the frame's tree, layout and transform (proj.tree, proj.L, proj.T) and where nodes and clades are on screen
  list: DrawList;
  theme: TreeTheme;
  colours: string[]; // colour by class; class 0 = default branch colour
  classOf: Uint8Array | null;
  highlight: Uint8Array | null; // by tip rank
  hlRanks: Int32Array; // sorted highlighted ranks
  hlPrefix: Int32Array | null; // highlighted tips before each rank (length tipCount + 1); non-null = dimming: what holds none is drawn at theme.dimOpacity
  density: LabelDensity;
  alignLabels: boolean; // the option; it acts only in a rectangular phylogram (see alignedX)
  format: (id: string) => string;
  /** The label of a collapsed clade (node = row of the snapshot): its name, else its size. null: collapsed clades get no label. */
  cladeText: ((node: number) => string) | null;
  nodeLabels: NodeLabelsOption; // the option
  formatNode: (value: number, kind: NodeLabelKind) => string; // formatNodeLabel
  scale: number; // canvas backing pixels per CSS pixel (after the DPR cap)
  thin: boolean; // radial and dense: branches are one device pixel wide (Skia hairline path, 10x cheaper on CPU raster)
  measure: TextMeasurer; // label widths, owned by the renderer
}

/** Labels laid out this frame, for hit-testing and for the DOM overlay (one entry per drawn label). */
export class LabelList {
  rank = new Int32Array(512); // the tip's rank; a collapsed clade's label has -(node + 1)
  x = new Float32Array(512); // start of the text (CSS px)
  y = new Float32Array(512); // vertical centre
  w = new Float32Array(512);
  h = new Float32Array(512);
  ang = new Float32Array(512); // radial: rotation in rad (0 for rectangular)
  flip = new Uint8Array(512);
  gap = new Float32Array(512); // distance from the tip (or the far edge of a collapsed clade's triangle) to the text
  count = 0;
  clear(): void {
    this.count = 0;
  }
  add(rank: number, x: number, y: number, w: number, h: number, ang: number, flip: number, gap = 8): void {
    if (this.count === this.rank.length) {
      const g = <A extends Float32Array | Int32Array | Uint8Array>(a: A): A => {
        const b = new (a.constructor as new (n: number) => A)(a.length * 2);
        b.set(a);
        return b;
      };
      this.rank = g(this.rank);
      this.x = g(this.x);
      this.y = g(this.y);
      this.w = g(this.w);
      this.h = g(this.h);
      this.ang = g(this.ang);
      this.flip = g(this.flip);
      this.gap = g(this.gap);
    }
    const c = this.count++;
    this.rank[c] = rank;
    this.x[c] = x;
    this.y[c] = y;
    this.w[c] = w;
    this.h[c] = h;
    this.ang[c] = ang;
    this.flip[c] = flip;
    this.gap[c] = gap;
  }
}

export const RADIAL_LABEL_CAP = 300;
const MAX_RECT_LABELS = 600;
const STROKE_CHUNK = 256; // segments per stroke() call: a path with thousands of subpaths rasterises superlinearly (measured, CPU)
const FILL_CHUNK = 32; // fans per fill() call, same reason
const TIP_DOT_PX = 6; // tip dots are drawn when rows are at least this tall
const LABEL_GAP_PX = 8; // tip (or aligned column) to the start of the text
const LEADER_END_GAP_PX = 3; // a leader stops this far before its label

/** Text widths by font and text. One per renderer, so renderers with different fonts do not clear each other's entries; bounded by
 *  clearing when the font family changes or the table passes MAX entries (checked when the font changes). */
export class TextMeasurer {
  private static readonly MAX = 20000;
  private cache = new Map<string, number>();
  private font = '';
  width(ctx: CanvasRenderingContext2D, text: string, font: string): number {
    if (font !== this.font) {
      // the cache key includes the size, so a family change is the only reason to clear
      const fam = font.slice(font.indexOf('px') + 2);
      if (this.font.slice(this.font.indexOf('px') + 2) !== fam || this.cache.size > TextMeasurer.MAX) this.cache.clear();
      this.font = font;
    }
    const key = font + '|' + text;
    let w = this.cache.get(key);
    if (w === undefined) {
      ctx.font = font;
      w = ctx.measureText(text).width;
      this.cache.set(key, w);
    }
    return w;
  }
}

/** 1 when draw-list entry `e` is outside the highlighted set (drawn dimmed), else 0. A clade is dimmed only when none of its tips is
 *  highlighted, so a mixed clade, a triangle holding a match and the path to a match keep full strength. A run (siblings drawn as one
 *  slice) spans its members' tips, `leafStart` of the first to `leafEnd` of the last. */
function dimmed(S: Scene, e: number): number {
  const pre = S.hlPrefix;
  if (pre === null) return 0;
  const i = S.list.node[e];
  const lm = S.list.last[e];
  const t = S.proj.tree;
  const n = pre.length - 1;
  return pre[Math.min(t.leafEnd[lm >= 0 ? lm : i], n)] - pre[Math.min(t.leafStart[i], n)] === 0 ? 1 : 0;
}

const clampY = (y: number, H: number) => (y < -CLAMP_Y_PAD_PX ? -CLAMP_Y_PAD_PX : y > H + CLAMP_Y_PAD_PX ? H + CLAMP_Y_PAD_PX : y);

/** Branches and collapsed clades. Positions and clade extents come from the layout projection; what is drawn differs by layout
 *  (axis-aligned strokes and triangles vs arcs and fans), so each has its own loop. */
export function drawBody(ctx: CanvasRenderingContext2D, S: Scene, lineW: number): void {
  const proj = S.proj;
  if (proj.kind === 'radial') return drawBodyRadial(ctx, S, proj, lineW);
  const { list, colours, theme } = S;
  const { tree, L, T } = proj;
  const { firstChild } = tree;
  const { LAST } = L;
  const nCls = colours.length;
  const p: Pt = { x: 0, y: 0 },
    q: Pt = { x: 0, y: 0 };
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  const passes = S.hlPrefix ? 2 : 1; // second pass: the dimmed entries, at dimOpacity
  for (let pass = 0; pass < passes; pass++)
    for (let cls = 0; cls < nCls; cls++) {
      const col = cls === 0 ? theme.branch : colours[cls];
      ctx.strokeStyle = col;
      ctx.globalAlpha = pass ? theme.dimOpacity : 1;
      ctx.lineWidth = cls === 0 ? lineW : Math.max(lineW, theme.cladeBranchWidth);
      ctx.beginPath();
      let any = false;
      for (let e = 0; e < list.count; e++) {
        if (nCls > 1 && list.cls[e] !== cls) continue;
        if (passes > 1 && dimmed(S, e) !== pass) continue;
        any = true;
        if (list.last[e] >= 0) continue; // a run has no branch of its own (its members' branches lie inside the slice)
        const i = list.node[e];
        const kind = list.kind[e];
        proj.nodeXY(i, p);
        if (i > 0) {
          proj.parentXY(i, q);
          ctx.moveTo(q.x, p.y);
          ctx.lineTo(p.x, p.y);
        }
        if (kind === K_NODE) {
          ctx.moveTo(p.x, clampY(proj.tip(firstChild[i]), T.H));
          ctx.lineTo(p.x, clampY(proj.tip(LAST[i]), T.H));
        }
      }
      if (any) ctx.stroke();
    }
  // collapsed clades: triangle from the node to the clade's extent
  for (let pass = 0; pass < passes; pass++)
    for (let cls = 0; cls < nCls; cls++) {
      ctx.globalAlpha = pass ? theme.summaryOpacity * theme.dimOpacity : theme.summaryOpacity;
      ctx.fillStyle = cls === 0 ? theme.summary : colours[cls];
      ctx.beginPath();
      let any = false;
      for (let e = 0; e < list.count; e++) {
        if (list.kind[e] !== K_SUMMARY || (nCls > 1 && list.cls[e] !== cls)) continue;
        if (passes > 1 && dimmed(S, e) !== pass) continue;
        any = true;
        const i = list.node[e];
        const lm = list.last[e]; // run: from the parent's depth to the deepest member, over the members' rows
        proj.summaryExtent(i, lm, list.xmax[e]);
        const sx = proj.d0,
          sy = proj.tip(i);
        let y0 = proj.t0,
          y1 = proj.t1;
        if (y1 - y0 < 1.5) {
          const m = (y0 + y1) / 2;
          y0 = m - 0.75;
          y1 = m + 0.75;
        }
        const xm = Math.max(sx + 2, proj.d1);
        if (lm >= 0 || isSlice(tree, i, L.collapsed)) {
          ctx.rect(sx, y0, xm - sx, y1 - y0);
          continue;
        } // polytomy of tips: a band, not a triangle
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
 *  chord by more than about 0.3 px (sagitta s^2/8r), long arcs of far-off clades clipped to the visible angles (the
 *  projection's window), summaries as filled fans. No trigonometry per node (cached cos/sin of the node angles). */
function drawBodyRadial(ctx: CanvasRenderingContext2D, S: Scene, proj: RadialProjection, lineW: number): void {
  const { list, colours, theme } = S;
  const { tree, L, T } = proj;
  const COS = L.COS!,
    SIN = L.SIN!;
  const { firstChild } = tree;
  const { LAST } = L;
  const { cx, cy } = T;
  const nCls = colours.length;
  const inv = 1 / S.scale;
  const p: Pt = { x: 0, y: 0 },
    q: Pt = { x: 0, y: 0 };
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'bevel';
  const passes = S.hlPrefix ? 2 : 1; // second pass: the dimmed entries, at dimOpacity
  for (let pass = 0; pass < passes; pass++)
    for (let cls = 0; cls < nCls; cls++) {
      ctx.strokeStyle = cls === 0 ? theme.branch : colours[cls];
      ctx.globalAlpha = pass ? theme.dimOpacity : 1;
      ctx.lineWidth = S.thin ? inv : cls === 0 ? lineW : Math.max(lineW, theme.cladeBranchWidth);
      ctx.beginPath();
      let segs = 0;
      for (let e = 0; e < list.count; e++) {
        if (nCls > 1 && list.cls[e] !== cls) continue;
        if (passes > 1 && dimmed(S, e) !== pass) continue;
        if (list.last[e] >= 0) continue; // run: no branch of its own
        const i = list.node[e];
        if (i > 0) {
          proj.parentXY(i, q);
          proj.nodeXY(i, p);
          ctx.moveTo(q.x, q.y);
          ctx.lineTo(p.x, p.y);
          segs++;
        }
        if (list.kind[e] === K_NODE) {
          const fc = firstChild[i],
            lc = LAST[i];
          const r = proj.depth(i);
          const len = proj.tipSpan(fc, lc) * r;
          ctx.moveTo(cx + r * COS[fc], cy + r * SIN[fc]);
          if (len * len <= ARC_SAGITTA_K * r) ctx.lineTo(cx + r * COS[lc], cy + r * SIN[lc]);
          else {
            let a0 = proj.tip(fc),
              a1 = proj.tip(lc);
            if (!proj.all && r > RADIAL_FAR_ARC_R) {
              // far-off clade: only the visible angles (padded), as one or two arcs; a wrapped window can show both ends
              if (proj.wrap) {
                if (a1 >= proj.lo) {
                  ctx.moveTo(cx + r * Math.cos(Math.max(a0, proj.lo)), cy + r * Math.sin(Math.max(a0, proj.lo)));
                  ctx.arc(cx, cy, r, Math.max(a0, proj.lo), a1);
                  segs++;
                }
                if (a0 <= proj.hi) {
                  ctx.moveTo(cx + r * Math.cos(a0), cy + r * Math.sin(a0));
                  ctx.arc(cx, cy, r, a0, Math.min(a1, proj.hi));
                  segs++;
                }
              } else {
                a0 = Math.max(a0, proj.lo);
                a1 = Math.min(a1, proj.hi);
                if (a1 > a0) {
                  ctx.moveTo(cx + r * Math.cos(a0), cy + r * Math.sin(a0));
                  ctx.arc(cx, cy, r, a0, a1);
                }
              }
            } else ctx.arc(cx, cy, r, a0, a1);
          }
          segs++;
        }
        if (segs >= STROKE_CHUNK) {
          ctx.stroke();
          ctx.beginPath();
          segs = 0;
        }
      }
      if (segs) ctx.stroke();
    }
  // collapsed clades: fans (apex at the node, outer edge at the clade's radius, arc only when it is visibly curved)
  for (let pass = 0; pass < passes; pass++)
    for (let cls = 0; cls < nCls; cls++) {
      ctx.globalAlpha = pass ? theme.summaryOpacity * theme.dimOpacity : theme.summaryOpacity;
      ctx.fillStyle = cls === 0 ? theme.summary : colours[cls];
      ctx.beginPath();
      let n = 0;
      for (let e = 0; e < list.count; e++) {
        if (list.kind[e] !== K_SUMMARY || (nCls > 1 && list.cls[e] !== cls)) continue;
        if (passes > 1 && dimmed(S, e) !== pass) continue;
        const i = list.node[e];
        const lm = list.last[e]; // run: from the parent's depth to the deepest member, over the members' angles
        proj.summaryExtent(i, lm, list.xmax[e]);
        let a0 = proj.t0,
          a1 = proj.t1;
        const r0 = proj.d0;
        const r1 = Math.max(r0 + 2, proj.d1);
        if ((a1 - a0) * r1 < 1.5) {
          const m = (a0 + a1) / 2,
            h = 0.75 / r1;
          a0 = m - h;
          a1 = m + h;
        } // keep slivers visible
        if (lm >= 0 || isSlice(tree, i, L.collapsed)) {
          // polytomy of tips: the ring segment between the node's depth and the longest tip, over the clade's angles
          const len0 = (a1 - a0) * r1;
          ctx.moveTo(cx + r0 * Math.cos(a0), cy + r0 * Math.sin(a0));
          ctx.lineTo(cx + r1 * Math.cos(a0), cy + r1 * Math.sin(a0));
          if (len0 * len0 > ARC_SAGITTA_K * r1 && r1 < RADIAL_FAR_ARC_R) ctx.arc(cx, cy, r1, a0, a1);
          else ctx.lineTo(cx + r1 * Math.cos(a1), cy + r1 * Math.sin(a1));
          ctx.lineTo(cx + r0 * Math.cos(a1), cy + r0 * Math.sin(a1));
          const len1 = (a1 - a0) * r0;
          if (len1 * len1 > ARC_SAGITTA_K * r0 && r0 < RADIAL_FAR_ARC_R) ctx.arc(cx, cy, r0, a1, a0, true);
          ctx.closePath();
          if (++n >= FILL_CHUNK) {
            ctx.fill();
            ctx.beginPath();
            n = 0;
          }
          continue;
        }
        ctx.moveTo(cx + r0 * COS[i], cy + r0 * SIN[i]);
        ctx.lineTo(cx + r1 * Math.cos(a0), cy + r1 * Math.sin(a0));
        const len = (a1 - a0) * r1;
        if (len * len > ARC_SAGITTA_K * r1 && r1 < RADIAL_FAR_ARC_R) ctx.arc(cx, cy, r1, a0, a1);
        else ctx.lineTo(cx + r1 * Math.cos(a1), cy + r1 * Math.sin(a1));
        ctx.closePath();
        if (++n >= FILL_CHUNK) {
          ctx.fill();
          ctx.beginPath();
          n = 0;
        }
      }
      if (n) ctx.fill();
    }
  ctx.globalAlpha = 1;
}

/** Tip dots and internal node markers. Returns nothing; positions are recomputed by hit-testing. */
export function drawMarkers(ctx: CanvasRenderingContext2D, S: Scene): void {
  const { proj, list, theme, colours } = S;
  const p: Pt = { x: 0, y: 0 };
  const tipPx = proj.tipPitch;
  const dots = tipPx >= TIP_DOT_PX;
  const rTip = Math.min(theme.tipRadius, Math.max(Math.min(1.5, theme.tipRadius), tipPx * 0.25));
  const m = theme.nodeMarkerSize;
  // internal markers: small filled squares (cheap), only for clades big enough to click
  const passes = S.hlPrefix ? 2 : 1; // second pass: the dimmed entries, at dimOpacity
  for (let pass = 0; pass < passes; pass++)
    for (let cls = 0; cls < colours.length; cls++) {
      ctx.globalAlpha = pass ? theme.markerOpacity * theme.dimOpacity : theme.markerOpacity;
      ctx.fillStyle = cls === 0 ? theme.branch : colours[cls];
      ctx.beginPath();
      let any = false;
      for (let e = 0; e < list.count; e++) {
        if (list.cls[e] !== cls) continue;
        if (passes > 1 && dimmed(S, e) !== pass) continue;
        const kind = list.kind[e];
        const i = list.node[e];
        if (kind === K_TIP) {
          if (!dots) continue;
          proj.nodeXY(i, p);
          ctx.moveTo(p.x + rTip, p.y);
          ctx.arc(p.x, p.y, rTip, 0, 6.2832);
          any = true;
        } else if (kind === K_NODE) {
          if (proj.cladeSize(i) < MARKER_PX) continue;
          proj.nodeXY(i, p);
          ctx.rect(p.x - m / 2, p.y - m / 2, m, m);
          any = true;
        }
      }
      if (any) ctx.fill();
    }
  ctx.globalAlpha = 1;
}

export function drawHighlights(ctx: CanvasRenderingContext2D, S: Scene, rightEdge: number): void {
  const { proj, theme, hlRanks } = S;
  const { tree, L, T } = proj;
  if (!hlRanks.length) return;
  const rect = proj.kind === 'rectangular';
  const p: Pt = { x: 0, y: 0 };
  ctx.fillStyle = theme.highlight;
  ctx.strokeStyle = theme.highlight;
  ctx.lineWidth = 2;
  for (let k = 0; k < hlRanks.length; k++) {
    const r = hlRanks[k];
    // tips below a collapsed clade are marked once, on the clade's row and at its apex (the ranks are sorted, so a row's are adjacent)
    const row = L.rowOfRank ? L.rowOfRank[r] : r;
    if (L.rowOfRank && k > 0 && L.rowOfRank[hlRanks[k - 1]] === row) continue;
    const node = L.rowNode ? L.rowNode[row] : tree.tipNode[r];
    if (rect) {
      const y = T.oy + row * T.ky;
      if (y + T.ky < T.clipT || y > T.clipB) continue;
      ctx.globalAlpha = theme.highlightOpacity;
      ctx.fillRect(0, y + T.ky / 2 - Math.max(3, T.ky) / 2, rightEdge, Math.max(3, T.ky));
      ctx.globalAlpha = 1;
      proj.nodeXY(node, p);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, 6.2832);
      ctx.stroke();
    } else {
      proj.nodeXY(node, p);
      if (p.x < -20 || p.y < -20 || p.x > T.W + 20 || p.y > T.H + 20) continue;
      const a = proj.tip(node);
      ctx.globalAlpha = theme.highlightOpacity;
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

export function drawRing(ctx: CanvasRenderingContext2D, proj: LayoutProjection, node: number, radius: number, colour: string, width: number): void {
  if (node < 0) return;
  const p: Pt = { x: 0, y: 0 };
  proj.nodeXY(node, p);
  if (p.x < -20 || p.y < -20 || p.x > proj.T.W + 20 || p.y > proj.T.H + 20) return;
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, 6.2832);
  ctx.stroke();
}

/** Where aligned labels start (CSS px, before the gap): right of the farthest tip (a collapsed clade's triangle ends at its tips, so it
 *  is never farther), so all labels share one x. Zoomed in on x so far that the farthest tip is right of the plot area, the column is pinned
 *  at the area's right edge (where the farthest tip is at the fit view): the labels stay readable, and the branches of the tips beyond it
 *  run on under the text. NaN when labels are not aligned: the option is off, or the layout has no tips that end at
 *  different x (radial, cladogram, tree without lengths). */
export function alignedX(S: Scene): number {
  const { proj } = S;
  if (!S.alignLabels || proj.kind !== 'rectangular' || !proj.L.usedLengths) return NaN;
  const { T, L } = proj;
  return Math.min(T.ox + L.XMAX[0] * T.kx, T.area.ax + T.area.aw);
}

/** Draw-list entry `e` is a clade the app collapsed (a summary of its own, not a run and not a clade the level of detail summarised). */
function isCollapsedEntry(S: Scene, e: number): boolean {
  const c = S.proj.L.collapsed;
  return c !== null && S.list.kind[e] === K_SUMMARY && S.list.last[e] < 0 && c[S.list.node[e]] === 1;
}

/** Some tip of the clade at row `i` is highlighted (band mode: `hlRanks`; dim mode: the prefix sums). */
function holdsHighlight(S: Scene, i: number): boolean {
  const t = S.proj.tree;
  if (S.hlPrefix !== null) {
    const n = S.hlPrefix.length - 1;
    return S.hlPrefix[Math.min(t.leafEnd[i], n)] - S.hlPrefix[Math.min(t.leafStart[i], n)] > 0;
  }
  const hr = S.hlRanks;
  let lo = 0,
    hi = hr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (hr[m] < t.leafStart[i]) lo = m + 1;
    else hi = m;
  }
  return lo < hr.length && hr[lo] < t.leafEnd[i];
}

/** Where draw-list entry `e` is labelled from, into `p`: a tip's dot, or the outer edge of a collapsed clade's triangle on its row. */
function labelAnchor(S: Scene, e: number, collapsed: boolean, p: Pt): void {
  const { proj } = S;
  const i = S.list.node[e];
  if (!collapsed) return proj.nodeXY(i, p);
  proj.summaryExtent(i, -1, 0);
  const d = Math.max(proj.d0 + 2, proj.d1);
  if (proj.kind === 'rectangular') {
    p.x = d;
    p.y = proj.tip(i);
  } else {
    p.x = proj.T.cx + d * proj.L.COS![i];
    p.y = proj.T.cy + d * proj.L.SIN![i];
  }
}

/** The rectangular label of the tip at (x, y) is not drawn: its row is out of view, or (aligned) the column is. */
function labelCulled(T: Scene['proj']['T'], x: number, y: number, ax: number): boolean {
  return y < T.clipT - 4 || y > T.clipB + 4 || (Number.isNaN(ax) ? x > T.clipR : ax + LABEL_GAP_PX > T.clipR);
}

/** Leader lines of aligned labels: a dotted line from each tip (from the end of the triangle of a collapsed clade) to just before its label.
 *  Drawn for the tips that get a label (same density rule, cap and culling as drawLabels), below the dots. Dimmed tips' leaders are drawn
 *  at dimOpacity. Batched into one path per chunk, as the branches are. */
export function drawLeaders(ctx: CanvasRenderingContext2D, S: Scene): void {
  const ax = alignedX(S);
  if (Number.isNaN(ax)) return;
  const { proj, list, theme } = S;
  const { T } = proj;
  if (proj.tipPitch < labelMinPx(S.density, S.theme.labelSize)) return;
  const hasCollapsed = S.cladeText !== null && proj.L.collapsed !== null; // collapsed clades are labelled
  const endX = ax + LABEL_GAP_PX - LEADER_END_GAP_PX;
  const p: Pt = { x: 0, y: 0 };
  ctx.strokeStyle = theme.leaderColour || theme.muted;
  ctx.lineWidth = theme.leaderWidth;
  ctx.setLineDash(dashOf(theme.leaderDash));
  const passes = S.hlPrefix ? 2 : 1; // second pass: the dimmed entries
  for (let pass = 0; pass < passes; pass++) {
    ctx.globalAlpha = pass ? theme.leaderOpacity * theme.dimOpacity : theme.leaderOpacity;
    ctx.beginPath();
    let n = 0,
      labelled = 0;
    for (let e = 0; e < list.count && labelled < MAX_RECT_LABELS; e++) {
      const col = list.kind[e] !== K_TIP;
      if (col && !(hasCollapsed && isCollapsedEntry(S, e))) continue;
      labelAnchor(S, e, col, p);
      if (labelCulled(T, p.x, p.y, ax)) continue;
      labelled++;
      if (passes > 1 && dimmed(S, e) !== pass) continue;
      const x0 = p.x;
      if (x0 >= endX) continue; // at or past the column (pinned): nothing to lead over
      ctx.moveTo(endX, p.y); // from the column leftward, so the dash pattern lines up at the labels
      ctx.lineTo(x0, p.y);
      if (++n >= STROKE_CHUNK) {
        ctx.stroke();
        ctx.beginPath();
        n = 0;
      }
    }
    if (n) ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

/** The dash pattern of a `leaderDash` token: numbers separated by spaces or commas; nothing usable = solid. */
function dashOf(v: string): number[] {
  const out: number[] = [];
  for (const s of v.split(/[\s,]+/)) {
    const n = parseFloat(s);
    if (Number.isFinite(n) && n >= 0) out.push(n);
  }
  return out.some((n) => n > 0) ? out : [];
}

/** Tip labels for drawn tips when rows (or arcs) are tall enough. Fills `labels` for hit-testing and the overlay.
 *  Radial: only when the angular pitch per tip is at least the font size, at most RADIAL_LABEL_CAP labels, and one
 *  setTransform per label instead of save/translate/rotate/restore (cos/sin come from the layout cache). */
export function drawLabels(ctx: CanvasRenderingContext2D, S: Scene, labels: LabelList): void {
  const { proj, list, theme, classOf, colours, highlight } = S;
  const { tree, L, T } = proj;
  labels.clear();
  const rect = proj.kind === 'rectangular';
  const pitch = proj.tipPitch;
  const need = labelMinPx(S.density, S.theme.labelSize);
  if (pitch < need) return;
  const hasCollapsed = S.cladeText !== null && L.collapsed !== null; // collapsed clades are labelled
  const size = Math.max(8, Math.min(theme.labelSize, Math.round(pitch * 0.78)));
  const style = theme.labelFontStyle === 'italic' ? 'italic ' : '';
  const fontN = `${style}${size}px ${theme.fontFamily}`;
  const fontH = `${style}600 ${size}px ${theme.fontFamily}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const p: Pt = { x: 0, y: 0 };
  const MAXL = rect ? MAX_RECT_LABELS : RADIAL_LABEL_CAP;
  const ax = rect ? alignedX(S) : NaN; // NaN: labels follow their tips
  const sc = S.scale;
  let lastFont = '';
  let lastFill = '';
  let lastAlign = 'left';
  let lastAlpha = 1;
  for (let e = 0; e < list.count && labels.count < MAXL; e++) {
    const col = list.kind[e] !== K_TIP; // a collapsed clade is labelled like a tip, at the end of its triangle
    if (col && !(hasCollapsed && isCollapsedEntry(S, e))) continue;
    const i = list.node[e];
    const r = col ? -1 : tree.tipRank[i];
    labelAnchor(S, e, col, p);
    if (rect) {
      if (labelCulled(T, p.x, p.y, ax)) continue;
    } else if (p.x < -50 || p.y < -50 || p.x > T.W + 50 || p.y > T.H + 50) continue;
    const hl = col ? highlight !== null && holdsHighlight(S, i) : highlight ? highlight[r] === 1 : false;
    const f = hl ? fontH : fontN;
    if (f !== lastFont) {
      ctx.font = f;
      lastFont = f;
    }
    const text = col ? S.cladeText!(i) : S.format(tree.tipLabels[r] ?? '');
    const w = S.measure.width(ctx, text, f);
    if (f !== lastFont) {
      ctx.font = f;
      lastFont = f;
    } // measure.width may have set the font
    const cl = classOf ? classOf[i] : 0;
    const fill = hl ? theme.highlight : cl ? colours[cl] : theme.foreground;
    if (fill !== lastFill) {
      ctx.fillStyle = fill;
      lastFill = fill;
    }
    const alpha = S.hlPrefix && (col ? dimmed(S, e) === 1 : S.hlPrefix[r + 1] === S.hlPrefix[r]) ? theme.dimOpacity : 1;
    if (alpha !== lastAlpha) {
      ctx.globalAlpha = alpha;
      lastAlpha = alpha;
    }
    // aligned: the text starts at the column, which is right of every tip and every triangle
    const gap = LABEL_GAP_PX;
    const key = col ? -(i + 1) : r;
    if (rect) {
      const x = Number.isNaN(ax) ? p.x + gap : ax + gap;
      ctx.fillText(text, x, p.y + 0.5);
      labels.add(key, x, p.y, w, size + 2, 0, 0, gap);
    } else {
      const left = L.COS![i] < 0;
      const c = left ? -L.COS![i] : L.COS![i],
        sn = left ? -L.SIN![i] : L.SIN![i];
      ctx.setTransform(sc * c, sc * sn, -sc * sn, sc * c, sc * p.x, sc * p.y);
      const al = left ? 'right' : 'left';
      if (al !== lastAlign) {
        ctx.textAlign = al;
        lastAlign = al;
      }
      ctx.fillText(text, left ? -gap : gap, 0.5);
      const a = proj.tip(i);
      labels.add(key, p.x, p.y, w, size + 2, left ? a + Math.PI : a, left ? 1 : 0, gap);
    }
  }
  if (!rect) ctx.setTransform(sc, 0, 0, sc, 0, 0);
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------------------------------------ node labels

const NODE_LABEL_GAP_PX = 3; // a support value ends this far left of its node
const NODE_LABEL_PAD_PX = 3; // free space the text keeps on each side within its branch (at least the node marker's radius + 1, see `pad`)
const NODE_LABEL_LIFT_PX = 2; // from the branch line up to the text's baseline
const NODE_LABEL_MIN_SEG_PX = 10; // a branch shorter than this is not looked at (no digit fits)

/** The text of the internal node at snapshot row `row`, or null for none. 'support' reads the snapshot's `support` array when it has one
 *  (else the numeric prefix of the label), 'length' its `length`; a function gets the node's full-tree id. A value that is not finite
 *  gives none. */
function nodeText(S: Scene, row: number): string | null {
  const t = S.proj.tree;
  const mode = S.nodeLabels;
  if (mode === 'support' || mode === 'length') {
    const v = mode === 'length' ? t.length[row] : t.support ? t.support[row] : internalSupport(t.labels[row] ?? '');
    return Number.isFinite(v) ? S.formatNode(v, mode) : null;
  }
  if (mode === 'none') return null;
  const r = mode(t.globalId === null ? row : t.globalId[row], t);
  if (typeof r === 'number') return Number.isFinite(r) ? S.formatNode(r, 'support') : null;
  return r ? r : null;
}

/** Node labels (`nodeLabels`) for the internal nodes of the draw list, which are expanded nodes and collapsed clades (on their own stem), so
 *  never a node inside a summary, a run or a collapsed clade. Shown only with room, by the label-density rule of tip labels: rectangular, tip rows at least `labelMinPx` (scaled with the theme's `labelSize`) apart
 *  and the text fits the visible part of the node's horizontal segment; radial, the node's arc at least that long and the text fits the
 *  branch. Support sits left of the node above its branch; a length is centred on the branch (radial: rotated along it, upright on the
 *  left half like tip labels). A length is placed by one rule at every zoom: centred on the visible part of its branch (rectangular; the
 *  whole branch, radial) if the text plus `pad` on both sides fits there, else not drawn (there is no placement at the node). Tips get no
 *  label: a label on a tip branch would meet the tip marker and the tip label. The root has no branch and no label. At most MAX_RECT_LABELS (RADIAL_LABEL_CAP) labels, found by one pass over
 *  the draw list, with the text made only after the cheap geometry tests. */
export function drawNodeLabels(ctx: CanvasRenderingContext2D, S: Scene): void {
  const mode = S.nodeLabels;
  if (mode === 'none') return;
  const { proj, list, theme } = S;
  const { tree, L, T } = proj;
  const rect = proj.kind === 'rectangular';
  const need = labelMinPx(S.density, theme.labelSize);
  if (rect && proj.tipPitch < need) return;
  const size = Math.max(8, Math.min(theme.nodeLabelSize, rect ? Math.round(proj.tipPitch * 0.78) : Infinity));
  const font = `${size}px ${theme.fontFamily}`;
  ctx.font = font;
  ctx.textBaseline = 'bottom';
  const maxN = rect ? MAX_RECT_LABELS : RADIAL_LABEL_CAP;
  const sc = S.scale;
  const centred = mode === 'length'; // a function's text is placed and coloured like support
  const gap = Math.max(NODE_LABEL_GAP_PX, theme.nodeMarkerSize / 2 + 1); // a support value clears the node's marker
  const pad = Math.max(NODE_LABEL_PAD_PX, theme.nodeMarkerSize / 2 + 1); // a length keeps clear of the node marker at one end and the connector at the other
  const colSupport = theme.supportColour || theme.muted,
    colLength = theme.lengthColour || theme.muted;
  const p: Pt = { x: 0, y: 0 },
    q: Pt = { x: 0, y: 0 };
  const { firstChild, parent } = tree;
  const hasCollapsed = L.collapsed !== null;
  let n = 0;
  let lastFill = '';
  let lastAlpha = 1;
  let lastAlign = '';
  for (let e = 0; e < list.count && n < maxN; e++) {
    const kind = list.kind[e];
    const col = kind !== K_NODE; // a collapsed clade shows its own support or length on its stem, like an expanded node
    // a stub is drawn as its branch only: when its node is right of the plot (rectangular, checked below) the visible part of a long stem
    // still holds a length, the same as it did while the node was a pixel nearer
    if (col ? !((hasCollapsed && isCollapsedEntry(S, e)) || (kind === K_STUB && centred && rect)) : list.last[e] >= 0) continue;
    const i = list.node[e];
    if (i === 0) continue;
    let x0 = 0, // rectangular: the visible part of the segment; radial: the label's origin
      y0 = 0,
      room = 0,
      c = 1,
      sn = 0;
    proj.nodeXY(i, p);
    if (rect) {
      if (kind === K_STUB && p.x <= T.clipR) continue; // a clade cut by size, not one pushed out of view
      proj.parentXY(i, q);
      if (p.y < T.clipT - 4 || p.y > T.clipB + 4 || p.x < T.clipL || q.x > T.clipR) continue;
      x0 = Math.max(q.x, T.clipL);
      room = (centred ? Math.min(p.x, T.clipR) : p.x) - x0;
      if (!centred && p.x > T.clipR) continue; // the node is out of view: its support would float in the air
      y0 = p.y - NODE_LABEL_LIFT_PX;
    } else {
      const lc = L.LAST[i];
      const r1 = proj.depth(i);
      room = r1 - proj.depth(parent[i]);
      if (room < NODE_LABEL_MIN_SEG_PX || (!col && proj.tipSpan(firstChild[i], lc) * r1 < need)) continue; // no room along the branch or across
      c = L.COS![i];
      sn = L.SIN![i];
      x0 = centred ? p.x - (c * room) / 2 : p.x;
      y0 = centred ? p.y - (sn * room) / 2 : p.y;
      if (x0 < -20 || y0 < -20 || x0 > T.W + 20 || y0 > T.H + 20) continue;
    }
    if (room < NODE_LABEL_MIN_SEG_PX) continue;
    const text = nodeText(S, i);
    if (text === null) continue;
    const w = S.measure.width(ctx, text, font);
    if (w + (centred ? 2 * pad : gap + NODE_LABEL_PAD_PX) > room) continue; // no room: not drawn, never moved to the node
    const fill = centred ? colLength : colSupport;
    if (fill !== lastFill) {
      ctx.fillStyle = fill;
      lastFill = fill;
    }
    const alpha = S.hlPrefix !== null && dimmed(S, e) ? theme.dimOpacity : 1;
    if (alpha !== lastAlpha) {
      ctx.globalAlpha = alpha;
      lastAlpha = alpha;
    }
    if (rect) {
      const al = centred ? 'center' : 'right';
      if (al !== lastAlign) {
        ctx.textAlign = al;
        lastAlign = al;
      }
      ctx.fillText(text, centred ? (x0 + Math.min(p.x, T.clipR)) / 2 : p.x - gap, y0);
    } else {
      const left = c < 0; // the left half is read upside down otherwise: turn the text round
      const cf = left ? -c : c,
        sf = left ? -sn : sn;
      ctx.setTransform(sc * cf, sc * sf, -sc * sf, sc * cf, sc * x0, sc * y0);
      // support: its end at the node, which is the end of the branch away from the root (the start of the text when turned round)
      const al = centred ? 'center' : left ? 'left' : 'right';
      if (al !== lastAlign) {
        ctx.textAlign = al;
        lastAlign = al;
      }
      ctx.fillText(text, centred ? 0 : left ? gap : -gap, -NODE_LABEL_LIFT_PX);
    }
    n++;
  }
  if (!rect) ctx.setTransform(sc, 0, 0, sc, 0, 0);
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
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
  const { theme } = S;
  const { L, T } = S.proj;
  if (T.kind !== 'rectangular' || !L.usedLengths) return;
  const { ax, ay, ah } = T.area;
  const y = ay + ah + 2;
  const maxLen = L.maxLen;
  const dated = L.ultrametric;
  ctx.save();
  ctx.font = `${theme.axisFontSize}px ${theme.fontFamily}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  ctx.strokeStyle = theme.muted;
  ctx.fillStyle = theme.muted;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.max(T.clipL, T.ox), y + 0.5);
  ctx.lineTo(Math.min(T.clipR, T.ox + T.kx), y + 0.5);
  ctx.stroke();
  const pxPerUnit = T.kx / 1 / maxLen; // px per tree unit
  const step = niceStep(110 / pxPerUnit);
  // values shown: distance from the root, or age (time before the tips) for an ultrametric tree
  const dLo = Math.max(0, x0v) * maxLen,
    dHi = Math.min(1, x1v) * maxLen;
  const toPx = (d: number) => T.ox + (d / maxLen) * T.kx;
  ctx.beginPath();
  const gridAlpha = dated ? 0.12 : 0;
  const ticks: { px: number; label: string }[] = [];
  if (dated) {
    for (let age = Math.ceil((maxLen - dHi) / step) * step; age <= maxLen - dLo + 1e-12; age += step)
      ticks.push({ px: toPx(maxLen - age), label: fmtTick(age, step) });
  } else {
    for (let d = Math.ceil(dLo / step) * step; d <= dHi + 1e-12; d += step) ticks.push({ px: toPx(d), label: fmtTick(d, step) });
  }
  for (const t of ticks) {
    ctx.moveTo(t.px + 0.5, y);
    ctx.lineTo(t.px + 0.5, y + 4);
  }
  ctx.stroke();
  for (const t of ticks) if (t.px > T.clipL + 8 && t.px < T.clipR - 8) ctx.fillText(t.label, t.px, y + 5);
  if (gridAlpha) {
    ctx.globalAlpha = gridAlpha;
    ctx.beginPath();
    for (const t of ticks) {
      ctx.moveTo(t.px + 0.5, ay);
      ctx.lineTo(t.px + 0.5, ay + ah);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = 'left';
  ctx.fillText(dated ? 'time before tips (tree units)' : 'distance from root (tree units)', Math.max(ax, 4), y + 16);
  ctx.restore();
}

/** Radial: a scale bar of a round length at the bottom left. */
export function drawScaleBar(ctx: CanvasRenderingContext2D, S: Scene): void {
  const { theme } = S;
  const { L, T } = S.proj;
  if (T.kind !== 'radial' || !L.usedLengths) return;
  const pxPerUnit = T.k / L.maxLen;
  const step = niceStep(90 / pxPerUnit);
  const w = step * pxPerUnit;
  const x = Math.max(14, T.W - w - 18),
    y = T.H - 18;
  ctx.save();
  ctx.strokeStyle = theme.muted;
  ctx.fillStyle = theme.muted;
  ctx.lineWidth = 1.5;
  ctx.font = `${theme.axisFontSize}px ${theme.fontFamily}`;
  ctx.textBaseline = 'bottom';
  ctx.beginPath();
  ctx.moveTo(x, y - 3);
  ctx.lineTo(x, y + 3);
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.moveTo(x + w, y - 3);
  ctx.lineTo(x + w, y + 3);
  ctx.stroke();
  ctx.fillText(fmtTick(step, step), x, y - 5);
  ctx.restore();
}
