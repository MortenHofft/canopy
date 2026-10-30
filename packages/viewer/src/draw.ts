// Canvas2D drawing of one frame's draw list. Everything here reads typed arrays and the draw list; nothing
// allocates per node. Strokes are batched into one path per colour class.
//
// This file holds the `Scene` a frame is drawn from and the helpers every drawing module shares (`dimmed`, `holdsHighlight`, `clampY`,
// `dashOf`, `alignedX`, `alignedR`), the branches, summaries, markers, highlight bands and clade boxes. The rest of a frame is drawn by:
//   labels.ts      tip and collapsed-clade labels, the leaders of aligned labels, node labels
//   axis.ts        the distance axis, the radial scale rings and the scale bar
//   top-canvas.ts  what the top canvas draws: selection, mark, hover and cursor rings, the path to the root

import { ARC_SAGITTA_K, CLAMP_Y_PAD_PX, RADIAL_FAR_ARC_R } from './constants.ts';
import { DrawList, K_NODE, K_SUMMARY, K_TIP, isSlice, lineTip } from './lod.ts';
import { MARKER_PX } from './hit.ts';
import { TIP_DOT_PX } from './sizes.ts';
import type { LayoutProjection, Pt, RadialProjection, RectProjection } from './projection.ts';
import type { NodeLabelKind, NodeLabelsOption } from './node-label.ts';
import type { Layout } from './layout.ts';
import type { LabelDensity, TreeTheme } from './types.ts';

export interface Scene {
  proj: LayoutProjection; // the frame's tree, layout and transform (proj.tree, proj.L, proj.T) and where nodes and clades are on screen
  list: DrawList;
  theme: TreeTheme;
  colours: string[]; // colour by class; class 0 = default branch colour
  classOf: Uint8Array | null; // colour class of the branches by row; null = none coloured (no clades, or `cladeStyle: 'background'`)
  /** The boxes behind coloured clades (`cladeStyle` 'background' or 'both'), outer clades first; null = none. */
  cladeBoxes: CladeBoxes | null;
  labelReach: number; // the room (px) tip labels take past their tip or aligned column (ViewState.labelReach): where a clade's box ends
  highlight: Uint8Array | null; // by tip rank
  hlRanks: Int32Array; // sorted highlighted ranks
  hlPrefix: Int32Array | null; // highlighted tips before each rank (length tipCount + 1); non-null = dimming: what holds none is drawn at theme.dimOpacity
  density: LabelDensity;
  alignLabels: boolean; // the option; it acts only in a phylogram (see alignedX and alignedR)
  labelRoom: number; // radial, aligned labels: the room (px) the text keeps in view when the circle is pinned (see alignedR)
  format: (id: string) => string;
  /** The label of a collapsed clade (node = row of the snapshot): `formatCollapsedLabel` of its name and size. null: collapsed clades get no label. */
  cladeText: ((node: number) => string) | null;
  nodeLabels: NodeLabelsOption; // the option
  /** Option `namedNodeMarkers`: whether a snapshot row has a name (`namedNodeTest`); null = the option is off. */
  namedNode: ((row: number) => boolean) | null;
  formatNode: (value: number, kind: NodeLabelKind) => string; // formatNodeLabel
  scale: number; // canvas backing pixels per CSS pixel (after the DPR cap)
  thin: number; // radial and dense: 0 = branches at the theme width, 1 = one device pixel (Skia hairline path, 10x cheaper on CPU raster), between: faded
  measure: TextMeasurer; // label widths, owned by the renderer
  /** The threshold is at the floor (MIN_THRESHOLD_PX): every clade folded by size is under a pixel wide and is drawn as a branch from its
   *  node to its deepest tip (lineTip), not as a fan or triangle (#126). */
  summaryLines: boolean;
}

/** One box per coloured clade, in preorder of its node, so a clade comes before the clades inside it and the boxes are in order of their
 *  first row: `rows[k]` is the node (row of the snapshot), `cls[k]` its colour class in `Scene.colours`. `up[k]` is the nearest box
 *  before k whose rows hold k's first row (-1: none), for the layout `upFor`; drawCladeBoxes fills it in when the layout is another. */
export interface CladeBoxes {
  rows: Int32Array;
  cls: Uint8Array;
  up: Int32Array;
  upFor: Layout | null;
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
  /** The label under (x, y) in CSS px, or -1: its text box, which in the radial layout is turned along its ray (2 px slack along). */
  at(x: number, y: number, rect: boolean): number {
    for (let k = 0; k < this.count; k++) {
      let u = x - this.x[k],
        v = y - this.y[k];
      if (!rect) {
        // into the label's own frame: u along its ray from the gap on, v across it (a flipped label is turned round, its text still runs outward)
        const c = Math.cos(this.ang[k]),
          s = Math.sin(this.ang[k]);
        const t = u * c + v * s;
        v = v * c - u * s;
        u = (this.flip[k] ? -t : t) - this.gap[k];
      }
      if (u >= -2 && u <= this.w[k] + 2 && Math.abs(v) <= this.h[k] / 2) return k;
    }
    return -1;
  }
}

export const STROKE_CHUNK = 256; // segments per stroke() call: a path with thousands of subpaths rasterises superlinearly (measured, CPU)
const FILL_CHUNK = 32; // fans per fill() call, same reason
const MAX_RADIAL_STRIPES = 256; // rays per fan: a fan zoomed far past the screen draws every 2nd, 4th, ... ray of its grid, not more of them
const MAX_PITCH_GAPS = 8; // stripes further apart than this many gaps (a few hidden tips over a tall summary) are not drawn: the summary gets their mean tone
const STRIPE_PX = 1; // line width of the stripes: hairlines, thinner than any branch, so they read as a texture and not as branches

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
export function dimmed(S: Scene, e: number): number {
  const pre = S.hlPrefix;
  if (pre === null) return 0;
  const i = S.list.node[e];
  const lm = S.list.last[e];
  const t = S.proj.tree;
  const n = pre.length - 1;
  return pre[Math.min(t.leafEnd[lm >= 0 ? lm : i], n)] - pre[Math.min(t.leafStart[i], n)] === 0 ? 1 : 0;
}

export const clampY = (y: number, H: number) => (y < -CLAMP_Y_PAD_PX ? -CLAMP_Y_PAD_PX : y > H + CLAMP_Y_PAD_PX ? H + CLAMP_Y_PAD_PX : y);

// Summaries (placeholders: triangles, fans, bands). Every one has one look: a faint background fill of its shape (`summaryOpacity`) with
// hairline stripes over it (`summaryStripeOpacity`), in the direction the hidden branches would run. The stripes of a frame's summaries are
// collected as segments (x0, y0, x1, y1) in one scratch buffer, in groups (one per summary), then stroked per (dimming pass, colour class),
// like the branches. A summary without room for stripes gets their mean tone as a second fill instead (its entry goes to `toneBuf`). The
// buffers are module state used only inside one drawBody call, grown by doubling, never held across calls. Cost: the stripes are bounded by
// the summary's extent over the gap, rectangular ones by the visible rows only, radial ones by the visible angles and MAX_RADIAL_STRIPES per fan.
let stripeBuf = new Float32Array(4096);
let stripeN = 0; // floats used
let groupEnd = new Int32Array(256); // per summary: the end of its segments in stripeBuf
let groupN = 0;
let toneBuf = new Int32Array(256); // draw-list entries of the summaries filled with the stripes' mean tone
let tonePitch = new Float32Array(256); // and the distance their stripes would have (px)
let toneN = 0;

function pushTone(e: number, pitch: number): void {
  if (toneN === toneBuf.length) {
    const b = new Int32Array(toneN * 2),
      p = new Float32Array(toneN * 2);
    b.set(toneBuf);
    p.set(tonePitch);
    toneBuf = b;
    tonePitch = p;
  }
  tonePitch[toneN] = pitch;
  toneBuf[toneN++] = e;
}

function pushStripe(x0: number, y0: number, x1: number, y1: number): void {
  if (stripeN + 4 > stripeBuf.length) {
    const b = new Float32Array(stripeBuf.length * 2);
    b.set(stripeBuf);
    stripeBuf = b;
  }
  stripeBuf[stripeN++] = x0;
  stripeBuf[stripeN++] = y0;
  stripeBuf[stripeN++] = x1;
  stripeBuf[stripeN++] = y1;
}

/** Close the stripes pushed since the last group (one summary's). */
function endGroup(): void {
  if (groupN === groupEnd.length) {
    const e = new Int32Array(groupN * 2);
    e.set(groupEnd);
    groupEnd = e;
  }
  groupEnd[groupN++] = stripeN;
}

/** Stripes for the summary of node `i` (a run first=i..last when lm >= 0), geometry from `proj.d0..t1` set by summaryExtent. `gap` is at
 *  least 1. Rectangular stripes are at least a gap apart; radial rays are a gap apart at the outer edge and closer toward the apex (below
 *  1 px there, which only makes them merge). Returns 0 when the stripes are pushed (nothing pushed: it is off screen). Otherwise the summary
 *  gets the stripes' mean tone instead, and the return is the distance (px) its stripes would have, for that tone: when there is no room
 *  for two stripes `gap` px apart (one per hidden tip, at least `gap`, so a summary of one tip has the width of its shape), or when the stripes would be more than MAX_PITCH_GAPS gaps apart (a
 *  few hidden tips over a tall summary, or a radial fan zoomed so far in that its visible rays are thinned that much). */
function pushStripes(proj: LayoutProjection, i: number, lm: number, solidShape: boolean, gap: number): number {
  const { tree } = proj;
  const hidden = tree.leafEnd[lm >= 0 ? lm : i] - tree.leafStart[i];
  if (proj.kind === 'rectangular') {
    const { T } = proj;
    const y0 = proj.t0,
      y1 = proj.t1,
      h = y1 - y0;
    const n = Math.min(hidden, Math.floor(h / gap));
    if (n < 2) return Math.max(gap, h / hidden);
    const pitch = h / n;
    if (pitch > MAX_PITCH_GAPS * gap) return pitch;
    const sx = proj.d0,
      sy = proj.tip(i),
      xm = Math.max(sx + 2, proj.d1);
    // only the stripes in the visible rows (the clip window); the pitch comes from the whole extent
    let k0 = Math.floor((T.clipT - 6 - y0) / pitch),
      k1 = Math.ceil((T.clipB + 6 - y0) / pitch);
    if (k0 < 0) k0 = 0;
    if (k1 > n) k1 = n;
    const up = sy - y0 > 1e-6 ? (xm - sx) / (sy - y0) : 0,
      down = y1 - sy > 1e-6 ? (xm - sx) / (y1 - sy) : 0;
    for (let k = k0; k < k1; k++) {
      const y = y0 + (k + 0.5) * pitch;
      // a triangle's stripe starts on its edge (apex at (sx, sy)); a band's (slice, run) at the left side
      const xs = solidShape ? sx : Math.min(xm, sx + (y < sy ? (sy - y) * up : (y - sy) * down));
      pushStripe(xs, y, xm, y);
    }
    if (stripeN > (groupN ? groupEnd[groupN - 1] : 0)) endGroup();
    return 0;
  }
  const r0 = proj.d0,
    r1 = Math.max(r0 + 2, proj.d1);
  const a0 = proj.t0,
    a1 = proj.t1;
  // the visible angles of the clade: one interval, or two when the window wraps through angle 0 (u0..u1 and v0..v1)
  let u0 = a0,
    u1 = a1,
    v0 = 0,
    v1 = 0;
  if (!proj.all) {
    if (!proj.wrap) {
      u0 = Math.max(a0, proj.lo);
      u1 = Math.min(a1, proj.hi);
    } else {
      u1 = Math.min(a1, proj.hi);
      v0 = Math.max(a0, proj.lo);
      v1 = a1;
    }
  }
  if (!(u1 > u0) && !(v1 > v0)) return 0; // off screen
  // the ray grid belongs to the whole fan (rays at a0 + (k + 0.5) * da), not to what is visible, so a pan moves the rays and never
  // re-spaces them; only the rays inside the visible angles are drawn
  const nFull = Math.min(hidden, Math.floor(((a1 - a0) * r1) / gap));
  if (nFull < 2) return Math.max(gap, ((a1 - a0) * r1) / hidden);
  const da = (a1 - a0) / nFull;
  const k0 = u1 > u0 ? Math.max(0, Math.ceil((u0 - a0) / da - 0.5)) : 0,
    k1 = u1 > u0 ? Math.min(nFull - 1, Math.floor((u1 - a0) / da - 0.5)) : -1;
  const m0 = v1 > v0 ? Math.max(0, Math.ceil((v0 - a0) / da - 0.5)) : 0,
    m1 = v1 > v0 ? Math.min(nFull - 1, Math.floor((v1 - a0) / da - 0.5)) : -1;
  const visible = (k1 >= k0 ? k1 - k0 + 1 : 0) + (m1 >= m0 ? m1 - m0 + 1 : 0);
  if (visible === 0) return 0;
  // more than MAX_RADIAL_STRIPES visible: every 2nd, 4th, ... ray of the same grid (the stride is a power of two, so it changes only when
  // the visible part doubles or halves)
  let stride = 1;
  while ((visible + 2) / stride > MAX_RADIAL_STRIPES) stride *= 2;
  const pitchAngle = da * stride;
  if (pitchAngle * r1 > MAX_PITCH_GAPS * gap) return pitchAngle * r1; // zoomed so far in that the rays would be too far apart, or too few hidden tips
  const phi = solidShape ? 0 : proj.tip(i); // the node's own angle, where the fan's apex lies
  const { cx, cy } = proj.T;
  // a fan's ray starts where it meets the fan's side (the segment from the apex to the edge's end), a ring segment's at r0
  const ax = r0 * Math.cos(phi),
    ay = r0 * Math.sin(phi);
  const e0x = r1 * Math.cos(a0) - ax,
    e0y = r1 * Math.sin(a0) - ay,
    e1x = r1 * Math.cos(a1) - ax,
    e1y = r1 * Math.sin(a1) - ay;
  for (let iv = 0; iv < 2; iv++) {
    const first = iv === 0 ? k0 : m0,
      last = iv === 0 ? k1 : m1;
    for (let k = Math.ceil(first / stride) * stride; k <= last; k += stride) {
      const a = a0 + (k + 0.5) * da;
      const c = Math.cos(a),
        sn = Math.sin(a);
      let rs = r0;
      if (!solidShape) {
        const ex = a < phi ? e0x : e1x,
          ey = a < phi ? e0y : e1y;
        const den = c * ey - sn * ex;
        let t = den !== 0 ? (sn * ax - c * ay) / den : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        rs = c * (ax + t * ex) + sn * (ay + t * ey);
      }
      pushStripe(cx + rs * c, cy + rs * sn, cx + r1 * c, cy + r1 * sn);
    }
  }
  endGroup();
  return 0;
}

/** The alpha of the fill that stands in for the stripes of a summary that does not get them: their mean tone, stripes `STRIPE_PX` wide at
 *  alpha `a` (`summaryStripeOpacity`, dimming included) every `pitch` px (the distance they would have, see pushStripes), so a summary
 *  crossing a limit while zooming keeps its darkness. Drawn over the background fill, as the stripes are. */
export function stripeToneAlpha(a: number, pitch: number): number {
  return Math.min(1, (a * STRIPE_PX) / pitch);
}

/** Stroke the collected stripes in `colour` at alpha `a` (the dimming included), one stroke per summary, and empty the buffer. */
function strokeStripes(ctx: CanvasRenderingContext2D, colour: string, a: number): void {
  if (groupN === 0) return;
  ctx.strokeStyle = colour;
  ctx.lineCap = 'butt';
  ctx.lineWidth = STRIPE_PX;
  ctx.globalAlpha = a;
  for (let g = 0, j = 0; g < groupN; j = groupEnd[g++]) {
    ctx.beginPath();
    for (let c = 0; j < groupEnd[g]; j += 4) {
      ctx.moveTo(stripeBuf[j], stripeBuf[j + 1]);
      ctx.lineTo(stripeBuf[j + 2], stripeBuf[j + 3]);
      if (++c >= STROKE_CHUNK) {
        ctx.stroke();
        ctx.beginPath();
        c = 0;
      }
    }
    ctx.stroke();
  }
  stripeN = 0;
  groupN = 0;
}

/** Rectangular: add the shape of the summary whose extent `proj.summaryExtent` just set (node `i`) to the path: a band (`band`: a polytomy
 *  of tips or a run) or a triangle from the node, at least 2 px wide and 1.5 px tall. */
function rectSummaryShape(ctx: CanvasRenderingContext2D, proj: RectProjection, i: number, band: boolean): void {
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
  if (band) {
    ctx.rect(sx, y0, xm - sx, y1 - y0);
    return;
  }
  ctx.moveTo(sx, sy);
  ctx.lineTo(xm, y0);
  ctx.lineTo(xm, y1);
  ctx.closePath();
}

/** Radial: add the shape of the summary whose extent `proj.summaryExtent` just set (node `i`) to the path: a ring segment (`band`) or a fan
 *  from the node (apex) to the clade's radius, the outer arc only where it is visibly curved, at least 1.5 px wide at its outer edge. */
export function fanSummaryShape(ctx: CanvasRenderingContext2D, proj: RadialProjection, i: number, band: boolean): void {
  const { cx, cy } = proj.T;
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
  if (band) {
    // polytomy of tips: the ring segment between the node's depth and the longest tip, over the clade's angles
    ringSector(ctx, proj, r0, r1, a0, a1);
    return;
  }
  ctx.moveTo(cx + r0 * proj.L.COS![i], cy + r0 * proj.L.SIN![i]);
  ctx.lineTo(cx + r1 * Math.cos(a0), cy + r1 * Math.sin(a0));
  const len = (a1 - a0) * r1;
  const far = r1 >= RADIAL_FAR_ARC_R && !proj.all;
  if (!far && len * len > ARC_SAGITTA_K * r1) ctx.arc(cx, cy, r1, a0, a1);
  else {
    // far off, the outer edge is an arc over the visible angles only (as the bands do, #77), joined to the fan's own corners by chords
    // out of view, so the edges towards the apex stay where they are and the fill reaches the tips in view, not a chord across the whole
    // fan (#94). A wrapped window shows 0..hi and lo..2pi: the pieces go in increasing angle, so the path runs along the edge.
    if (far && !proj.wrap) fanArcPiece(ctx, proj, r1, Math.max(a0, proj.lo), Math.min(a1, proj.hi));
    else if (far) {
      fanArcPiece(ctx, proj, r1, a0, Math.min(a1, proj.hi));
      fanArcPiece(ctx, proj, r1, Math.max(a0, proj.lo), a1);
    }
    ctx.lineTo(cx + r1 * Math.cos(a1), cy + r1 * Math.sin(a1));
  }
  ctx.closePath();
}

/** The outer edge of a far fan (see fanSummaryShape) over the visible angles a0..a1, as an arc where it is visibly curved, else a straight
 *  line; nothing when a1 <= a0. */
function fanArcPiece(ctx: CanvasRenderingContext2D, proj: RadialProjection, r1: number, a0: number, a1: number): void {
  if (!(a1 > a0)) return;
  const { cx, cy } = proj.T;
  const len = (a1 - a0) * r1;
  if (len * len > ARC_SAGITTA_K * r1) ctx.arc(cx, cy, r1, a0, a1);
  else {
    ctx.lineTo(cx + r1 * Math.cos(a0), cy + r1 * Math.sin(a0));
    ctx.lineTo(cx + r1 * Math.cos(a1), cy + r1 * Math.sin(a1));
  }
}

/** Add the ring sector r0..r1 (px) over the angles a0..a1 to the path. Far off, only its visible angles (padded), with its edges as arcs,
 *  as the connectors do: a run reaches as far out of the window as its members (#77), and a chord over all of them would cut inside the
 *  tips in view. A wrapped window (lo..2pi and 0..hi) can show both ends. */
export function ringSector(ctx: CanvasRenderingContext2D, proj: RadialProjection, r0: number, r1: number, a0: number, a1: number): void {
  if (r1 < RADIAL_FAR_ARC_R || proj.all) bandPiece(ctx, proj, r0, r1, a0, a1, false);
  else if (!proj.wrap) bandPiece(ctx, proj, r0, r1, Math.max(a0, proj.lo), Math.min(a1, proj.hi), true);
  else {
    bandPiece(ctx, proj, r0, r1, Math.max(a0, proj.lo), a1, true);
    bandPiece(ctx, proj, r0, r1, a0, Math.min(a1, proj.hi), true);
  }
}

/** One ring segment of a band (see ringSector): radius r0..r1 over the angles a0..a1, nothing when a1 <= a0. An edge is an arc where
 *  it is visibly curved, if it is near (under RADIAL_FAR_ARC_R) or `far` (the angles are already cut to the window), else a straight line. */
function bandPiece(ctx: CanvasRenderingContext2D, proj: RadialProjection, r0: number, r1: number, a0: number, a1: number, far: boolean): void {
  if (!(a1 > a0)) return;
  const { cx, cy } = proj.T;
  const len0 = (a1 - a0) * r1;
  ctx.moveTo(cx + r0 * Math.cos(a0), cy + r0 * Math.sin(a0));
  ctx.lineTo(cx + r1 * Math.cos(a0), cy + r1 * Math.sin(a0));
  if (len0 * len0 > ARC_SAGITTA_K * r1 && (r1 < RADIAL_FAR_ARC_R || far)) ctx.arc(cx, cy, r1, a0, a1);
  else ctx.lineTo(cx + r1 * Math.cos(a1), cy + r1 * Math.sin(a1));
  ctx.lineTo(cx + r0 * Math.cos(a1), cy + r0 * Math.sin(a1));
  const len1 = (a1 - a0) * r0;
  if (len1 * len1 > ARC_SAGITTA_K * r0 && (r0 < RADIAL_FAR_ARC_R || far)) ctx.arc(cx, cy, r0, a1, a0, true);
  ctx.closePath();
}

/** Add the shape of summary entry `e` to the path (its extent is left in `proj.d0..t1`) and fill the path every `chunk` shapes. Returns the
 *  number of shapes now in the path. */
function addSummaryShape(ctx: CanvasRenderingContext2D, proj: LayoutProjection, list: DrawList, e: number, n: number, chunk: number): number {
  const i = list.node[e];
  const lm = list.last[e]; // run: from the parent's depth to the deepest member, over the members' rows (angles)
  const band = lm >= 0 || isSlice(proj.tree, i, proj.L.collapsed);
  proj.summaryExtent(i, lm, list.xmax[e]);
  if (proj.kind === 'rectangular') rectSummaryShape(ctx, proj, i, band);
  else fanSummaryShape(ctx, proj, i, band);
  if (++n < chunk) return n;
  ctx.fill();
  ctx.beginPath();
  return 0;
}

/** Fill the summaries listed in `toneBuf` with their stripes' mean tone (stripes at alpha `stripeA`), one fill per run of equal alphas
 *  (and per `chunk` shapes), and empty the list. */
function fillTones(ctx: CanvasRenderingContext2D, proj: LayoutProjection, list: DrawList, stripeA: number, chunk: number): void {
  let alpha = -1,
    n = 0;
  for (let k = 0; k < toneN; k++) {
    const a = stripeToneAlpha(stripeA, tonePitch[k]);
    if (a !== alpha) {
      if (n) ctx.fill();
      ctx.globalAlpha = alpha = a;
      ctx.beginPath();
      n = 0;
    }
    n = addSummaryShape(ctx, proj, list, toneBuf[k], n, chunk);
  }
  if (n) ctx.fill();
  toneN = 0;
}

/** The summaries of one (dimming pass, colour class), both layouts: the background fill of every summary in `colour` at `summaryOpacity`
 *  (fans in chunks of FILL_CHUNK shapes), then the stripe tone over the summaries that get no stripes, then the stripes. `dim` is 1, or
 *  `dimOpacity` on the dimmed pass. */
function drawSummaries(ctx: CanvasRenderingContext2D, S: Scene, pass: number, cls: number, colour: string, dim: number, lineW: number): void {
  const { list, theme, proj } = S;
  const passes = S.hlPrefix ? 2 : 1;
  const nCls = S.colours.length;
  const gap = theme.summaryStripeGap >= 1 ? theme.summaryStripeGap : 1; // at least 1 px: no stripe per tip
  const stripeA = theme.summaryStripeOpacity * dim;
  const chunk = proj.kind === 'rectangular' ? Infinity : FILL_CHUNK; // fans are filled in chunks (see FILL_CHUNK), triangles and bands at once
  ctx.fillStyle = colour;
  ctx.globalAlpha = theme.summaryOpacity * dim;
  ctx.beginPath();
  let n = 0;
  for (let e = 0; e < list.count; e++) {
    if (list.kind[e] !== K_SUMMARY || (nCls > 1 && list.cls[e] !== cls)) continue;
    if (passes > 1 && dimmed(S, e) !== pass) continue;
    if (S.summaryLines && lineTip(proj.tree, proj.L, list.node[e], list.last[e]) >= 0) continue; // a line, below
    n = addSummaryShape(ctx, proj, list, e, n, chunk);
    const lm = list.last[e];
    const pitch = pushStripes(proj, list.node[e], lm, lm >= 0 || isSlice(proj.tree, list.node[e], proj.L.collapsed), gap);
    if (pitch > 0) pushTone(e, pitch);
  }
  if (n) ctx.fill();
  if (toneN) fillTones(ctx, proj, list, stripeA, chunk);
  strokeStripes(ctx, colour, stripeA);
  if (S.summaryLines) strokeSummaryLines(ctx, S, pass, cls, colour, theme.summaryLineOpacity * dim, lineW);
}

/** The summaries of a frame of `summaryLines` as branches from their node to their deepest tip (#126), in the summary colour (or the
 *  clade's) at `summaryLineOpacity`: lighter than a branch, darker than a fan or triangle. */
function strokeSummaryLines(ctx: CanvasRenderingContext2D, S: Scene, pass: number, cls: number, colour: string, alpha: number, lineW: number): void {
  const { list, proj } = S;
  const passes = S.hlPrefix ? 2 : 1;
  const nCls = S.colours.length;
  const p: Pt = { x: 0, y: 0 },
    q: Pt = { x: 0, y: 0 };
  ctx.strokeStyle = colour;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = lineW;
  ctx.beginPath();
  let segs = 0;
  for (let e = 0; e < list.count; e++) {
    if (list.kind[e] !== K_SUMMARY || (nCls > 1 && list.cls[e] !== cls)) continue;
    if (passes > 1 && dimmed(S, e) !== pass) continue;
    const t = lineTip(proj.tree, proj.L, list.node[e], list.last[e]);
    if (t < 0) continue;
    proj.nodeXY(list.node[e], p);
    proj.nodeXY(t, q);
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    if (++segs >= STROKE_CHUNK) {
      ctx.stroke();
      ctx.beginPath();
      segs = 0;
    }
  }
  if (segs) ctx.stroke();
}

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
  // summaries: triangles (bands) from the node to the clade's extent
  for (let pass = 0; pass < passes; pass++)
    for (let cls = 0; cls < nCls; cls++)
      drawSummaries(
        ctx,
        S,
        pass,
        cls,
        cls === 0 ? theme.summary : colours[cls],
        pass ? theme.dimOpacity : 1,
        cls === 0 ? lineW : Math.max(lineW, theme.cladeBranchWidth),
      );
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
      const w = cls === 0 ? lineW : Math.max(lineW, theme.cladeBranchWidth);
      ctx.lineWidth = w + (inv - w) * S.thin;
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
  // summaries: fans (apex at the node, outer edge at the clade's radius) and ring segments
  for (let pass = 0; pass < passes; pass++)
    for (let cls = 0; cls < nCls; cls++) {
      const w = cls === 0 ? lineW : Math.max(lineW, theme.cladeBranchWidth);
      drawSummaries(ctx, S, pass, cls, cls === 0 ? theme.summary : colours[cls], pass ? theme.dimOpacity : 1, w + (inv - w) * S.thin);
    }
  ctx.globalAlpha = 1;
}

/** Tip dots and internal node markers. Returns nothing; positions are recomputed by hit-testing. */
export function drawMarkers(ctx: CanvasRenderingContext2D, S: Scene): void {
  const { proj, list, theme, colours } = S;
  const p: Pt = { x: 0, y: 0 };
  const tipPx = proj.tipPitch;
  const dotDepth = proj.minTipDepth(TIP_DOT_PX); // a tip gets a dot when its depth reaches this (radial: where the arc between tips is wide enough, #110)
  const rTip = Math.min(theme.tipRadius, Math.max(Math.min(1.5, theme.tipRadius), tipPx * 0.25));
  const named = S.namedNode ?? null;
  const m = named ? theme.unnamedNodeMarkerSize : theme.nodeMarkerSize;
  const rNamed = theme.namedNodeMarkerSize / 2;
  const namedFill = theme.namedNodeColour || theme.foreground; // a clade colour is not used for the named: they are to be found
  // internal markers: small filled squares (cheap), only for clades big enough to click; with namedNodeMarkers the named ones are bigger
  // circles in their own colour, drawn last so they sit over their neighbours
  const passes = S.hlPrefix ? 2 : 1; // second pass: the dimmed entries, at dimOpacity
  for (let pass = 0; pass < passes; pass++)
    for (let cls = 0; cls < colours.length; cls++) {
      ctx.globalAlpha = pass ? theme.markerOpacity * theme.dimOpacity : theme.markerOpacity;
      ctx.fillStyle = cls === 0 ? theme.branch : colours[cls];
      ctx.beginPath();
      let any = false;
      let anyNamed = false;
      for (let e = 0; e < list.count; e++) {
        if (list.cls[e] !== cls) continue;
        if (passes > 1 && dimmed(S, e) !== pass) continue;
        const kind = list.kind[e];
        const i = list.node[e];
        if (kind === K_TIP) {
          if (proj.depth(i) < dotDepth) continue;
          proj.nodeXY(i, p);
          ctx.moveTo(p.x + rTip, p.y);
          ctx.arc(p.x, p.y, rTip, 0, 6.2832);
          any = true;
        } else if (kind === K_NODE) {
          if (proj.cladeSize(i) < MARKER_PX) continue;
          proj.nodeXY(i, p);
          if (named !== null && named(i)) {
            anyNamed = true; // drawn below
            continue;
          }
          ctx.rect(p.x - m / 2, p.y - m / 2, m, m);
          any = true;
        }
      }
      if (any) ctx.fill();
      if (!anyNamed) continue;
      ctx.fillStyle = cls === 0 ? namedFill : colours[cls];
      ctx.beginPath();
      any = false;
      for (let e = 0; e < list.count; e++) {
        if (list.cls[e] !== cls || list.kind[e] !== K_NODE) continue;
        if (passes > 1 && dimmed(S, e) !== pass) continue;
        const i = list.node[e];
        if (proj.cladeSize(i) < MARKER_PX || !named!(i)) continue;
        proj.nodeXY(i, p);
        ctx.moveTo(p.x + rNamed, p.y);
        ctx.arc(p.x, p.y, rNamed, 0, 6.2832);
        any = true;
      }
      if (any) ctx.fill();
    }
  ctx.globalAlpha = 1;
}

/** The boxes behind the coloured clades (`S.cladeBoxes`), behind everything else of the tree: a fill of the clade's colour at
 *  `cladeBackgroundOpacity` (times `dimOpacity` for a clade holding no highlighted tip while dimming), outer clades first so an inner box
 *  is drawn over the box around it. Rectangular: a rectangle over the clade's rows, from `cladeBackgroundPadding` left of its node to
 *  `labelReach` past its deepest tip (or past the aligned label column), at most to the right edge of the tree. Radial: the ring sector over
 *  the clade's angles, from the padding inward of the node's radius to `labelReach` past its outermost tip (or the aligned label circle).
 *  The rows are the layout's, not the cut's, so a clade inside a summary keeps its box.
 *
 *  The work is bounded by the view, not by the number of clades (colourBy gives one per tip): only the boxes whose rows meet the rows in
 *  view are visited (a binary search for the first, the boxes around it through `up`, a stop after the last), and boxes under a pixel
 *  across the tips are merged: a run of them in one colour that continue each other's rows is one fill, and a box of another colour (or
 *  one inside it) that falls within the pixel a pending merged box starts makes that box grow over it in the pending box's colour. Every
 *  row stays covered, but where colours interleave below a pixel the colour of a pixel is approximate (the first box's of that pixel). So
 *  a frame fills at most about one box per pixel across the tips per nesting level, besides the boxes of a pixel or more. Nothing is allocated per box; the chain of boxes around the view is module scratch. */
export function drawCladeBoxes(ctx: CanvasRenderingContext2D, S: Scene): void {
  const B = S.cladeBoxes;
  if (B === null || B.rows.length === 0) return;
  const { proj } = S;
  if (B.upFor !== proj.L) boxParents(B, proj.L);
  BX.fill = '';
  BX.alpha = -1;
  BX.pending = false;
  BX.ax = alignedX(S);
  BX.ar = alignedR(S);
  if (proj.kind === 'rectangular') {
    const { T } = proj;
    boxRange(ctx, S, B, (T.clipT - T.oy) / T.ky, (T.clipB - T.oy) / T.ky, -Infinity);
  } else if (proj.all) boxRange(ctx, S, B, -Infinity, Infinity, -Infinity);
  else {
    const { da } = proj.T;
    const lo = (proj.lo - proj.a0) / da,
      hi = (proj.hi - proj.a0) / da;
    if (!proj.wrap) boxRange(ctx, S, B, lo, hi, -Infinity);
    else {
      // the window holds the rows up to hi and from lo on: the low rows first, then the high ones without the boxes already visited
      boxRange(ctx, S, B, -Infinity, hi, -Infinity);
      // a box pending from the low rows never merges with one of the high rows: their rows do not continue, and their angles are far apart
      boxRange(ctx, S, B, lo, Infinity, hi);
    }
  }
  flushBox(ctx, S);
  ctx.globalAlpha = 1;
}

/** State of one drawCladeBoxes call (module scratch, like the stripe buffers): the fill in force, the aligned label column or circle, and
 *  the pending merged box (`pending`: one exists; its colour class and alpha, its extent x0..x1 (radial: radii) over t0..t1 (radial:
 *  angles), and the row its last member ends at). */
const BX = { fill: '', alpha: -1, ax: NaN, ar: NaN, pending: false, cls: 0, a: 0, x0: 0, x1: 0, t0: 0, t1: 0, end: 0 };
let chain = new Int32Array(64); // the boxes around the top of the view, innermost first (boxRange)

/** `B.up` for layout `L`: one pass with a stack of the boxes whose rows hold the current one's first row. Clades' rows nest (a clade
 *  inside a collapsed clade has that clade's one row, as its siblings there do), so the stack is a chain. */
function boxParents(B: CladeBoxes, L: Layout): void {
  const { rows, up } = B;
  let top = -1; // the innermost box on the stack; the stack is the chain through `up`
  for (let k = 0; k < rows.length; k++) {
    const r = L.rowStart[rows[k]];
    while (top >= 0 && L.rowEnd[rows[top]] <= r) top = up[top];
    up[k] = top;
    top = k;
  }
  B.upFor = L;
}

/** The boxes whose rows meet the rows ya..yb (fractional rows of the layout), in drawing order: the boxes that start before ya and reach
 *  into it (outermost first), then those that start in it. Boxes starting before row `skip` are left out (drawn by an earlier range). */
function boxRange(ctx: CanvasRenderingContext2D, S: Scene, B: CladeBoxes, ya: number, yb: number, skip: number): void {
  const { rowStart, rowEnd } = S.proj.L;
  const rows = B.rows;
  let lo = 0,
    hi = rows.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (rowStart[rows[m]] < ya) lo = m + 1;
    else hi = m;
  }
  // a box that starts before ya and reaches into the range holds the first row of the last box that starts before it: it is on that
  // box's chain
  let n = 0;
  for (let j = lo - 1; j >= 0; j = B.up[j]) {
    if (rowEnd[rows[j]] <= ya || rowStart[rows[j]] < skip) continue;
    if (n === chain.length) {
      const c = new Int32Array(n * 2);
      c.set(chain);
      chain = c;
    }
    chain[n++] = j;
  }
  while (n > 0) boxAt(ctx, S, B, chain[--n]);
  for (let k = lo; k < rows.length && rowStart[rows[k]] < yb; k++) if (rowStart[rows[k]] >= skip) boxAt(ctx, S, B, k);
}

/** Box k: culled across the depth axis, then drawn, or merged into the pending box when it is under a pixel across the tips. */
function boxAt(ctx: CanvasRenderingContext2D, S: Scene, B: CladeBoxes, k: number): void {
  const { proj, theme } = S;
  const i = B.rows[k];
  proj.summaryExtent(i, -1, 0);
  const pad = theme.cladeBackgroundPadding;
  let x0: number, x1: number, px: number; // the depth extent (rectangular: x in px; radial: radii) and the size across the tips (px)
  if (proj.kind === 'rectangular') {
    const { T } = proj;
    x0 = Math.max(proj.d0 - pad, -CLAMP_Y_PAD_PX); // the pad clampY uses across the tips, here across the depth axis
    x1 = Math.min(T.clipR, (Number.isNaN(BX.ax) ? proj.d1 : BX.ax) + S.labelReach);
    if (!(x1 > x0) || x1 <= T.clipL || x0 >= T.clipR) return;
    px = proj.t1 - proj.t0;
  } else {
    x0 = Math.max(0, proj.d0 - pad);
    x1 = (Number.isNaN(BX.ar) ? proj.d1 : BX.ar) + S.labelReach;
    if (x1 <= proj.rMin || x0 >= proj.rMax) return;
    px = (proj.t1 - proj.t0) * x1;
  }
  const cls = B.cls[k];
  const a = S.hlPrefix !== null && !holdsHighlight(S, i) ? theme.cladeBackgroundOpacity * theme.dimOpacity : theme.cladeBackgroundOpacity;
  if (BX.pending && px < 1) {
    const t1 = Math.max(BX.t1, proj.t1);
    const span = proj.kind === 'rectangular' ? t1 - BX.t0 : (t1 - BX.t0) * Math.max(BX.x1, x1);
    // it continues the pending box in its colour, or it falls within the pixel the pending box starts (in another colour, or inside it):
    // the pending box grows over it, in its own colour, and is filled once it is a pixel across
    if (span < 1 || (cls === BX.cls && a === BX.a && proj.L.rowStart[i] === BX.end)) {
      if (x0 < BX.x0) BX.x0 = x0;
      if (x1 > BX.x1) BX.x1 = x1;
      BX.t1 = t1;
      if (proj.L.rowEnd[i] > BX.end) BX.end = proj.L.rowEnd[i];
      if (span >= 1) flushBox(ctx, S);
      return;
    }
  }
  flushBox(ctx, S);
  BX.pending = true;
  BX.cls = cls;
  BX.a = a;
  BX.x0 = x0;
  BX.x1 = x1;
  BX.t0 = proj.t0;
  BX.t1 = proj.t1;
  BX.end = proj.L.rowEnd[i];
  if (px >= 1) flushBox(ctx, S);
}

/** Fill the pending box, if any. */
function flushBox(ctx: CanvasRenderingContext2D, S: Scene): void {
  if (!BX.pending) return;
  BX.pending = false;
  const colour = S.colours[BX.cls];
  if (colour !== BX.fill) ctx.fillStyle = BX.fill = colour;
  if (BX.a !== BX.alpha) ctx.globalAlpha = BX.alpha = BX.a;
  const { proj } = S;
  if (proj.kind === 'rectangular') {
    const y0 = clampY(BX.t0, proj.T.H);
    ctx.fillRect(BX.x0, y0, BX.x1 - BX.x0, clampY(BX.t1, proj.T.H) - y0);
  } else {
    ctx.beginPath();
    ringSector(ctx, proj, BX.x0, BX.x1, BX.t0, BX.t1);
    ctx.fill();
  }
}

export function drawHighlights(ctx: CanvasRenderingContext2D, S: Scene, rightEdge: number): void {
  const { proj, theme, hlRanks } = S;
  const T = proj.T;
  if (!hlRanks.length) return;
  const rect = proj.kind === 'rectangular';
  const p: Pt = { x: 0, y: 0 };
  // The canvas calls are bounded by pixels, not by matches (#58): at the fit view of a large tree thousands of matched rows share a
  // pixel. First the bands, then the rings (one path, a ring skipped when it lands within a pixel of the one before).
  ctx.fillStyle = theme.highlight;
  ctx.strokeStyle = theme.highlight;
  ctx.globalAlpha = theme.highlightOpacity;
  // rectangular: the rows grow with k, so only the matches on the rows in view are visited
  const k0 = rect ? firstAtRow(S, Math.floor((T.clipT - T.oy) / T.ky) - 1) : 0;
  const k1 = rect ? firstAtRow(S, Math.ceil((T.clipB - T.oy) / T.ky) + 1) : hlRanks.length;
  if (rect) drawBandRuns(ctx, S, k0, k1, rightEdge);
  else drawRays(ctx, S, p);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  ctx.beginPath();
  let lastX = NaN,
    lastY = NaN;
  for (let k = k0; k < k1; k++) {
    const node = highlightNode(S, k);
    if (node < 0) continue;
    proj.nodeXY(node, p);
    if (!rect && (p.x < -20 || p.y < -20 || p.x > T.W + 20 || p.y > T.H + 20)) continue;
    if (Math.abs(p.x - lastX) < 1 && Math.abs(p.y - lastY) < 1) continue;
    lastX = p.x;
    lastY = p.y;
    ctx.moveTo(p.x + 7, p.y);
    ctx.arc(p.x, p.y, 7, 0, 6.2832);
  }
  ctx.stroke();
}

/** The rectangular bands of the matches k0..k1-1: bands that overlap (rows under 3 px apart) are merged into one fillRect per run. */
function drawBandRuns(ctx: CanvasRenderingContext2D, S: Scene, k0: number, k1: number, rightEdge: number): void {
  const T = S.proj.T;
  const h = Math.max(3, T.ky);
  let runTop = 0,
    runBot = -Infinity;
  for (let k = k0; k < k1; k++) {
    if (highlightNode(S, k) < 0) continue;
    const top = T.oy + tipRow(S, k) * T.ky + T.ky / 2 - h / 2;
    if (top >= runBot) {
      if (runBot > runTop) ctx.fillRect(0, runTop, rightEdge, runBot - runTop);
      runTop = top;
    }
    runBot = top + h;
  }
  if (runBot > runTop) ctx.fillRect(0, runTop, rightEdge, runBot - runTop);
}

/** The radial bands: a ray from the centre past each matched tip, skipped when it ends within a pixel of the one before and is no
 *  wider. `p` is scratch. */
function drawRays(ctx: CanvasRenderingContext2D, S: Scene, p: Pt): void {
  const { proj } = S;
  const { L, T } = proj;
  let lastX = NaN,
    lastY = NaN,
    lastW = 0;
  for (let k = 0; k < S.hlRanks.length; k++) {
    const node = highlightNode(S, k);
    if (node < 0) continue;
    proj.nodeXY(node, p);
    if (p.x < -20 || p.y < -20 || p.x > T.W + 20 || p.y > T.H + 20) continue;
    const a = proj.tip(node);
    const w = Math.max(3, T.da * L.X[node] * T.k);
    const ex = T.cx + 1.15 * T.k * Math.cos(a),
      ey = T.cy + 1.15 * T.k * Math.sin(a);
    if (Math.abs(ex - lastX) < 1 && Math.abs(ey - lastY) < 1 && w <= lastW) continue;
    lastX = ex;
    lastY = ey;
    lastW = w;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(T.cx, T.cy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }
}

/** The first k whose row is at least `row` (the highlighted ranks are sorted, and rows grow with ranks). */
function firstAtRow(S: Scene, row: number): number {
  let lo = 0,
    hi = S.hlRanks.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (tipRow(S, m) < row) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** The row of the k-th highlighted rank. */
function tipRow(S: Scene, k: number): number {
  const r = S.hlRanks[k];
  const rowOfRank = S.proj.L.rowOfRank;
  return rowOfRank ? rowOfRank[r] : r;
}

/** The node to mark for the k-th highlighted rank, or -1 to skip it: tips below a collapsed clade are marked once, on the clade's row
 *  and at its apex (the ranks are sorted, so a row's are adjacent), and in the rectangular layout a row outside the clip is skipped. */
function highlightNode(S: Scene, k: number): number {
  const { tree, L, T } = S.proj;
  const row = tipRow(S, k);
  if (L.rowOfRank && k > 0 && tipRow(S, k - 1) === row) return -1;
  if (S.proj.kind === 'rectangular') {
    const y = T.oy + row * T.ky;
    if (y + T.ky < T.clipT || y > T.clipB) return -1;
  }
  return L.rowNode ? L.rowNode[row] : tree.tipNode[S.hlRanks[k]];
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

/** Radial phylogram: the radius (px) of the circle aligned labels start on (before the gap): the outermost tip's (a collapsed clade's
 *  triangle ends at its tips, so it is never farther), so all labels share one circle. Zoomed in so far that the furthest visible radius
 *  (from the root to the farthest corner of the plot) is less than that plus `labelRoom`, the circle is pinned at the furthest visible
 *  radius less `labelRoom`: the labels of the tips in view stay readable, and the branches of the tips beyond it run on under the text.
 *  NaN when labels are not aligned: the option is off, or the layout is rectangular or has no tips that end at different radii
 *  (cladogram, tree without lengths). */
export function alignedR(S: Scene): number {
  const { proj } = S;
  if (!S.alignLabels || proj.kind !== 'radial' || !proj.L.usedLengths) return NaN;
  const { T } = proj;
  const far = Math.hypot(Math.max(Math.abs(T.cx - T.clipL), Math.abs(T.cx - T.clipR)), Math.max(Math.abs(T.cy - T.clipT), Math.abs(T.cy - T.clipB)));
  return Math.min(proj.L.XMAX[0] * T.k, Math.max(0, far - S.labelRoom));
}

/** Some tip of the clade at row `i` is highlighted (band mode: `hlRanks`; dim mode: the prefix sums). */
export function holdsHighlight(S: Scene, i: number): boolean {
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

/** The dash pattern of a `leaderDash` or `markDash` token: numbers separated by spaces or commas; nothing usable = solid. */
export function dashOf(v: string): number[] {
  const out: number[] = [];
  for (const s of v.split(/[\s,]+/)) {
    const n = parseFloat(s);
    if (Number.isFinite(n) && n >= 0) out.push(n);
  }
  return out.some((n) => n > 0) ? out : [];
}
