// What the top canvas draws (`TreeViewer.drawTop`): the ring of the selected node, the rings of the marked nodes, the hover and keyboard
// cursor rings (growing in and fading out), the box of the cursor's clade and the path from the hovered node to the root. They live on a
// canvas of their own so they never trigger a tree redraw. Every function takes what it draws and where (the frame's projection, the theme)
// as arguments; which node is hovered or selected and the ring animations are the viewer's state.

import { ARC_SAGITTA_K, RADIAL_FAR_ARC_R } from './constants.ts';
import { clampY, dashOf } from './draw.ts';
import type { LayoutProjection, Pt, RadialProjection } from './projection.ts';
import { easeOut, type RingAnim } from './ring-anim.ts';
import type { TreeTheme } from './types.ts';

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

/** The ring of the selected node (row `node`): `selectionColour` ('' = `foreground`) `selectionWidth` px wide at `selectionRadius`, over a
 *  halo of the background 2 px wider, so it reads over branches and is told apart from the hover and keyboard rings. */
export function drawSelectionRing(ctx: CanvasRenderingContext2D, proj: LayoutProjection, node: number, theme: TreeTheme): void {
  const w = theme.selectionWidth;
  if (!(w > 0)) return;
  drawRing(ctx, proj, node, theme.selectionRadius, theme.background, w + 2);
  drawRing(ctx, proj, node, theme.selectionRadius, theme.selectionColour || theme.foreground, w);
}

/** The rings of the marked nodes (`rows`, rows of the snapshot; -1 is skipped): `markColour` ('' = `highlight`) `markWidth` px wide at
 *  `markRadius`, dashed as `markDash`, over a solid halo of the background 2 px wider. One path per pass, whatever the number of marks. */
export function drawMarkRings(ctx: CanvasRenderingContext2D, proj: LayoutProjection, rows: Int32Array, theme: TreeTheme): void {
  const w = theme.markWidth;
  if (!(w > 0) || rows.length === 0) return;
  const r = theme.markRadius;
  const p: Pt = { x: 0, y: 0 };
  const W = proj.T.W,
    H = proj.T.H;
  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath();
    let n = 0;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i] < 0) continue;
      proj.nodeXY(rows[i], p);
      if (p.x < -r || p.y < -r || p.x > W + r || p.y > H + r) continue;
      ctx.moveTo(p.x + r, p.y);
      ctx.arc(p.x, p.y, r, 0, 6.2832);
      n++;
    }
    if (n === 0) return;
    ctx.setLineDash(pass === 0 ? [] : dashOf(theme.markDash));
    ctx.strokeStyle = pass === 0 ? theme.background : theme.markColour || theme.highlight;
    ctx.lineWidth = pass === 0 ? w + 2 : w;
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

/** The polyline of `drawRootPath`, drawn as it is walked: corners less than a pixel from the last one drawn are merged into the next, and
 *  a stretch with both ends beyond one side of the box (x0..x1 x y0..y1) is skipped, so the canvas calls are about one per pixel of path on
 *  screen whatever the depth (a 100k-level caterpillar at the fit view: about 1,100). `x` / `y` is where the path is now (drawn or not), `pend` that it has not been drawn yet, `pen` that the canvas's current point
 *  is the last corner drawn. */
class RootPathPen {
  x = 0;
  y = 0;
  private lx = 0;
  private ly = 0;
  private pen = false;
  private pend = false;
  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly x0: number,
    private readonly y0: number,
    private readonly x1: number,
    private readonly y1: number,
  ) {}
  start(x: number, y: number): void {
    this.x = this.lx = x;
    this.y = this.ly = y;
    this.pen = this.pend = false;
  }
  to(x: number, y: number): void {
    const { lx, ly } = this;
    this.x = x;
    this.y = y;
    if ((lx < this.x0 && x < this.x0) || (lx > this.x1 && x > this.x1) || (ly < this.y0 && y < this.y0) || (ly > this.y1 && y > this.y1)) {
      this.start(x, y); // out of view: the next stretch in view starts here
      return;
    }
    if (!this.pen) this.ctx.moveTo(lx, ly);
    this.pen = true;
    if (Math.abs(x - lx) < 1 && Math.abs(y - ly) < 1) {
      this.pend = true;
      return;
    }
    this.ctx.lineTo(x, y);
    this.lx = x;
    this.ly = y;
    this.pend = false;
  }
  /** Draw up to where the path is now (before an arc, and at the end). */
  flush(): void {
    if (this.pend) this.ctx.lineTo(this.x, this.y);
    this.lx = this.x;
    this.ly = this.y;
    this.pend = false;
  }
}

/** The path from row `node` up to the root (the hover path, #40): every ancestor's branch and its part of the parent's connector, as one
 *  stroke in `hoverPathColour` ('' = `highlight`), `hoverPathWidth` px wide (0 = none). Straight from `parent[]`, no allocation per node;
 *  the walk is O(depth), the canvas calls are bounded by what is on screen (see RootPathPen). Radial connectors are arcs where they are
 *  visibly curved and their circle crosses the view; far-off ones are clipped to the visible angles, as the branches are. */
export function drawRootPath(ctx: CanvasRenderingContext2D, proj: LayoutProjection, node: number, theme: TreeTheme): void {
  const w = theme.hoverPathWidth;
  if (!(w > 0) || node < 0) return;
  const { T } = proj;
  const parent = proj.tree.parent;
  const rect = proj.kind === 'rectangular';
  const pad = w + 2;
  // the tree's clip of the main canvas (rect: not over the axis or the columns)
  const cx0 = 0,
    cy0 = rect ? T.clipT - 6 : 0,
    cx1 = rect ? T.clipR : T.W,
    cy1 = rect ? T.clipB + 6 : T.H;
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx0, cy0, cx1 - cx0, cy1 - cy0);
  ctx.clip();
  ctx.strokeStyle = theme.hoverPathColour || theme.highlight;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  const pen = new RootPathPen(ctx, cx0 - pad, cy0 - pad, cx1 + pad, cy1 + pad);
  const p: Pt = { x: 0, y: 0 };
  proj.nodeXY(node, p);
  pen.start(p.x, rect ? clampY(p.y, T.H) : p.y);
  for (let i = node; i > 0; i = parent[i]) {
    proj.parentXY(i, p);
    if (rect) {
      pen.to(p.x, clampY(p.y, T.H)); // the branch
      pen.to(p.x, clampY(proj.tip(parent[i]), T.H)); // the connector, to the parent
    } else {
      pen.to(p.x, p.y);
      rootPathArc(ctx, proj, pen, i, parent[i], pad, p);
    }
  }
  pen.flush();
  ctx.stroke();
  ctx.restore();
}

/** Radial: the connector of `drawRootPath` from child `i` (the pen is at its branch's start) to its parent `pa`, at the parent's radius. A
 *  connector shorter than a pixel, or one differing from its chord by under 0.3 px, is a straight corner of the pen; one whose circle is
 *  out of view only moves the pen. */
function rootPathArc(ctx: CanvasRenderingContext2D, proj: RadialProjection, pen: RootPathPen, i: number, pa: number, pad: number, p: Pt): void {
  const r = proj.depth(pa);
  const a0 = proj.tip(i),
    a1 = proj.tip(pa);
  const len = Math.abs(a1 - a0) * r;
  proj.nodeXY(pa, p);
  if (len < 1 || len * len <= ARC_SAGITTA_K * r) return pen.to(p.x, p.y);
  if (r < proj.rMin - pad || r > proj.rMax + pad) return pen.start(p.x, p.y);
  pen.flush();
  const lo = Math.min(a0, a1),
    hi = Math.max(a0, a1);
  if (proj.all || r <= RADIAL_FAR_ARC_R) arcPiece(ctx, proj, r, lo, hi);
  else if (!proj.wrap) arcPiece(ctx, proj, r, Math.max(lo, proj.lo), Math.min(hi, proj.hi));
  else {
    // far off: only the visible angles; a wrapped window (lo..2pi and 0..hi) can show both ends
    arcPiece(ctx, proj, r, Math.max(lo, proj.lo), hi);
    arcPiece(ctx, proj, r, lo, Math.min(hi, proj.hi));
  }
  pen.start(p.x, p.y);
}

function arcPiece(ctx: CanvasRenderingContext2D, proj: RadialProjection, r: number, a0: number, a1: number): void {
  if (!(a1 > a0)) return;
  const { cx, cy } = proj.T;
  ctx.moveTo(cx + r * Math.cos(a0), cy + r * Math.sin(a0));
  ctx.arc(cx, cy, r, a0, a1);
}

/** A ring growing in: radius and opacity eased from 0. Returns whether it is still growing. */
export function growRing(
  c: CanvasRenderingContext2D,
  proj: LayoutProjection,
  theme: TreeTheme,
  ring: RingAnim,
  radius: number,
  width: number,
  ms: number,
  now: number,
): boolean {
  if (ring.node < 0) return false;
  const e = easeOut(ring.progress(now, ms));
  strokeRing(c, proj, theme, ring.node, radius * e, width, e);
  return e < 1;
}

/** The hover ring left behind (`out`), fading out at the size it had reached. Returns whether it is still fading. */
export function fadeRing(c: CanvasRenderingContext2D, proj: LayoutProjection, theme: TreeTheme, out: RingAnim, ms: number, now: number): boolean {
  if (out.node < 0) return false;
  const t = out.progress(now, ms);
  strokeRing(c, proj, theme, out.node, theme.hoverRingRadius * out.scale * out.peak, theme.hoverRingWidth, out.peak * (1 - easeOut(t)));
  if (t < 1) return true;
  out.clear();
  return false;
}

function strokeRing(
  c: CanvasRenderingContext2D,
  proj: LayoutProjection,
  theme: TreeTheme,
  node: number,
  radius: number,
  width: number,
  alpha: number,
): void {
  if (!(radius > 0) || !(alpha > 0)) return;
  if (alpha < 1) c.globalAlpha = alpha;
  drawRing(c, proj, node, radius, theme.highlight, width);
  if (alpha < 1) c.globalAlpha = 1;
}

/** Rectangular: the box of the keyboard cursor's clade (row `node`), from its node to the right edge. */
export function drawCursorBox(c: CanvasRenderingContext2D, proj: LayoutProjection, node: number, theme: TreeTheme): void {
  const { T, L, tree } = proj;
  if (T.kind !== 'rectangular') return;
  const p = { x: 0, y: 0 };
  proj.nodeXY(node, p);
  c.strokeStyle = theme.highlight;
  c.globalAlpha = 0.5;
  c.lineWidth = 1;
  const ky = T.ky;
  const y0 = T.oy + L.rowStart[node] * ky,
    y1 = T.oy + L.rowEnd[node] * ky;
  if (y1 - y0 > 3 && tree.childCount[node] > 0)
    c.strokeRect(p.x, Math.max(T.clipT, y0), Math.max(4, T.clipR - p.x - 4), Math.min(T.clipB, y1) - Math.max(T.clipT, y0));
  c.globalAlpha = 1;
}
