// keptViewport: where the window of one tree goes when another tree replaces it (TreeViewer.setTree with view 'keep'). The tips in view
// before the change are sent through a tip map and the window is placed on where they landed, at the same scale where the new tree
// allows. Pure arithmetic over the two snapshots and layouts: no DOM, so test/set-tree.test.mjs covers it numerically. Runs once per tree
// swap, so it may loop over the tips; the frame code does not use it. The window is in rows (layout.ts): a tip is sent to its row in the
// old layout and its new place to a row in the new one, so a clade collapsed on either side is followed as the one row it is.

import { sectorBBox, type Area } from './geom.ts';
import { fanAngle, type Layout } from './layout.ts';
import type { LayoutKind, TreeSnapshot, Viewport } from './types.ts';

/** Where an old tip is now. */
export interface TipTarget {
  /** The new tip ranks [lo, hi) it stands for: one tip, or the tips of the clade it became (an expanded or collapsed clade). */
  lo: number;
  hi: number;
  /** The node of the new tree that stands for it (read for its X). */
  node: number;
}

export interface KeepInput {
  layout: LayoutKind;
  /** The window before the change. */
  view: Viewport;
  before: TreeSnapshot;
  beforeL: Layout;
  after: TreeSnapshot;
  afterL: Layout;
  /** Fixed row height mode (rectangular): the window keeps its height whatever happens to the rows. */
  fixedRows: boolean;
  /** Where old tip `rank` is now, written into `out`; false when it has no counterpart. With `deep`, a tip that is gone may stand for
   *  the nearest ancestor that survived (a collapsed clade). */
  target(rank: number, deep: boolean, out: TipTarget): boolean;
}

const PROPORTIONAL = 0.05; // X before and after is a rescaling when the survivors' nearest X is scaled like their spread (within this share of the farthest)
const MIN_SPAN = 0.02; // a span of X smaller than this share of the window is too short to give a scale

/** The x window that follows the survivors: their X (distance from the root, normalised by the deepest tip) before and after. A span
 *  long enough gives scale and shift, a short one only the shift. */
function carryX(x0: number, x1: number, a0: number, a1: number, b0: number, b1: number, shiftOnly: number): [number, number] {
  if (a0 === b0 && a1 === b1) return [x0, x1];
  const w = x1 - x0;
  // both spans long enough to give a scale, and a rescaling (the deepest tip changed: every X is multiplied), not a different shape (a reroot
  // turning a dated tree into one with spread-out tips, or back)
  if (a1 - a0 > MIN_SPAN * w && b1 - b0 > MIN_SPAN * w) {
    const s = (b1 - b0) / (a1 - a0);
    if (Math.abs(b0 - s * a0) <= PROPORTIONAL * b1) return [b0 + (x0 - a0) * s, b0 + (x1 - a0) * s];
  }
  return [x0 + shiftOnly, x1 + shiftOnly];
}

/**
 * The window that frames the surviving tips of the old window, or null when none survives (the caller fits).
 *  - Rectangular: the tips whose row is inside the old y window; the window keeps its height (the same px per tip) and its place
 *    relative to them, so a flip inside the view or a prune above it leaves the picture where it was. When the survivors now spread over
 *    more rows than the window holds (a reroot scrambled them), the window grows to hold them, unless the rows have a fixed height.
 *    x follows the survivors' X (scale and shift).
 *  - Radial: the tips inside the old window; the window turns by the mean angle the survivors moved (their angle is rank * 2pi / tips)
 *    and follows their radius. A window with no tip in it is kept as it is.
 * Tips with no counterpart count only when none has one directly; then a tip that is gone stands for the nearest ancestor that
 * survived (a clade it was collapsed into). When that is the whole tree there is nothing to follow and the result is null.
 */
export function keptViewport(a: KeepInput): Viewport | null {
  const N = a.before.tipCount;
  const v = a.view;
  if (N === 0 || a.after.tipCount === 0) return null;
  const t: TipTarget = { lo: 0, hi: 0, node: 0 };
  const tipNode = a.before.tipNode;
  const rowOfBefore = a.beforeL.rowOfRank,
    rankOfRowBefore = a.beforeL.rankOfRow,
    rowOfAfter = a.afterL.rowOfRank;
  /** The node of the old tree that stands for tip `r` on the screen: the tip, or the collapsed clade it is inside. */
  const nodeBefore = (r: number): number => (a.beforeL.rowNode && rowOfBefore ? a.beforeL.rowNode[rowOfBefore[r]] : tipNode[r]);
  if (a.layout === 'rectangular') {
    const R = a.beforeL.rows;
    let lo = Math.max(0, Math.ceil(v.y0 - 0.5)),
      hi = Math.min(R - 1, Math.floor(v.y1 - 0.5));
    if (hi < lo) lo = hi = Math.max(0, Math.min(R - 1, Math.floor((v.y0 + v.y1) / 2)));
    for (const deep of [false, true]) {
      let oMin = Infinity,
        oMax = -Infinity,
        nLo = Infinity,
        nHi = -Infinity,
        kLo = Infinity,
        kHi = -Infinity;
      let ax0 = Infinity,
        ax1 = -Infinity,
        bx0 = Infinity,
        bx1 = -Infinity,
        sa = 0,
        sb = 0,
        n = 0;
      for (let row = lo; row <= hi; row++) {
        const r = rankOfRowBefore ? rankOfRowBefore[row] : row; // the first tip of the row (a collapsed clade stands for its first)
        if (!a.target(r, deep, t)) continue;
        if (row < oMin) oMin = row;
        if (row > oMax) oMax = row;
        const tLo = rowOfAfter ? rowOfAfter[t.lo] : t.lo,
          tHi = (rowOfAfter ? rowOfAfter[t.hi - 1] : t.hi - 1) + 1;
        if (tLo < nLo) nLo = tLo;
        if (tHi > nHi) nHi = tHi;
        if (t.lo < kLo) kLo = t.lo;
        if (t.hi > kHi) kHi = t.hi;
        const xa = nodeBefore(r) >= 0 ? a.beforeL.X[nodeBefore(r)] : 0,
          xb = a.afterL.X[t.node];
        if (xa < ax0) ax0 = xa;
        if (xa > ax1) ax1 = xa;
        if (xb < bx0) bx0 = xb;
        if (xb > bx1) bx1 = xb;
        sa += xa;
        sb += xb;
        n++;
      }
      if (!n) continue;
      if (deep && kLo === 0 && kHi === a.after.tipCount) return null; // they only stand for the whole tree: nothing to follow
      const [x0, x1] = carryX(v.x0, v.x1, ax0, ax1, bx0, bx1, (sb - sa) / n);
      const h = v.y1 - v.y0;
      const extent = nHi - nLo;
      const nc = (nLo + nHi) / 2;
      // a window that cuts a row at its edge holds that row's tips whole: compare with the rows it touches, not only its height
      if (extent > Math.max(h, oMax - oMin + 1) && !a.fixedRows) {
        const pad = extent * 0.02;
        return { x0, x1, y0: nc - extent / 2 - pad, y1: nc + extent / 2 + pad };
      }
      if (nLo === oMin && nHi === oMax + 1) return { x0, x1, y0: v.y0, y1: v.y1 };
      const yc = nc + ((v.y0 + v.y1) / 2 - (oMin + oMax + 1) / 2);
      return { x0, x1, y0: yc - h / 2, y1: yc + h / 2 };
    }
    return null;
  }
  const X = a.beforeL.X;
  const inView = new Uint8Array(N);
  let seen = 0;
  for (let r = 0; r < N; r++) {
    // a collapsed clade counts once, at its own depth (its first tip stands for it); its other tips are not at their own
    if (
      rankOfRowBefore &&
      rowOfBefore &&
      rankOfRowBefore[rowOfBefore[r] + 1] - rankOfRowBefore[rowOfBefore[r]] !== 1 &&
      rankOfRowBefore[rowOfBefore[r]] !== r
    )
      continue;
    const node = nodeBefore(r);
    if (node < 0) continue; // a tip row that is not loaded
    const ang = fanAngle(a.beforeL.fan, a.beforeL.rows, (rowOfBefore ? rowOfBefore[r] : r) + 0.5);
    const x = X[node] * Math.cos(ang),
      y = X[node] * Math.sin(ang);
    if (x < v.x0 || x > v.x1 || y < v.y0 || y > v.y1) continue;
    inView[r] = 1;
    seen++;
  }
  if (seen === 0) return { ...v }; // nothing to follow: the window stays where it is
  for (const deep of [false, true]) {
    let sx = 0,
      sy = 0,
      ra = 0,
      rb = 0,
      all = false,
      n = 0;
    for (let r = 0; r < N; r++) {
      if (!inView[r] || !a.target(r, deep, t)) continue;
      const ang = fanAngle(a.beforeL.fan, a.beforeL.rows, (rowOfBefore ? rowOfBefore[r] : r) + 0.5);
      const tLo = rowOfAfter ? rowOfAfter[t.lo] : t.lo,
        tHi = (rowOfAfter ? rowOfAfter[t.hi - 1] : t.hi - 1) + 1;
      const d = fanAngle(a.afterL.fan, a.afterL.rows, (tLo + tHi) / 2) - ang;
      sx += Math.cos(d);
      sy += Math.sin(d);
      if (deep && t.hi - t.lo === a.after.tipCount) all = true;
      ra += X[nodeBefore(r)];
      rb += a.afterL.X[t.node];
      n++;
    }
    if (!n) continue;
    if (all) return null;
    const d = Math.atan2(sy, sx);
    const f = ra > 1e-9 && rb > 0 ? rb / ra : 1; // the radius of the survivors, before and after: positions and window follow
    if (d === 0 && f === 1) return { ...v };
    const c = Math.cos(d),
      s = Math.sin(d);
    const cx = (v.x0 + v.x1) / 2,
      cy = (v.y0 + v.y1) / 2;
    const nx = (cx * c - cy * s) * f,
      ny = (cx * s + cy * c) * f;
    const hw = ((v.x1 - v.x0) / 2) * f,
      hh = ((v.y1 - v.y0) / 2) * f;
    return { x0: nx - hw, x1: nx + hw, y0: ny - hh, y1: ny + hh };
  }
  return null;
}

// ---------------------------------------------------------------- switching layouts (#56)
//
// The same tree in another projection: a switch of `layout` (rectangular <-> radial) or of `branchLengths` (phylogram <-> cladogram).
// The two layouts have the same rows (a collapsed clade is one row in both), so "what is in view" is a set of rows: the rows whose tip (a
// collapsed clade's outer end) is in the window. `viewContent` takes them from the window before the switch, with the tip pitch they had
// (px between neighbouring tips: the readability, the same measure as the zoom cap of #38); `placeContent` finds the window of the new
// layout that holds them at that pitch. Two steps, because the viewer changes the layouts between them (a new fan is set in place).
// Neither walks the tree: rectangular reads the row interval of the window, radial the rows of the angles the window covers, each
// tested once, at most SAMPLE_ROWS of them (a stride beyond).

const SAMPLE_ROWS = 1 << 16; // at most this many rows are looked at (evenly spread over the ones in view)
const TAU = 2 * Math.PI;

/** What was in view before a layout switch (see `viewContent`). */
export interface ViewContent {
  kind: LayoutKind;
  view: Viewport;
  /** The layout it was in (its X and rows are read again by `placeContent`; the fan may have changed since, the angles are taken here). */
  L: Layout;
  /** Rows whose tip was in view, in the order along the window (radial: by angle, clockwise), `count` of them; evenly sampled when many.
   *  Radial: the tips in the ellipse inscribed in the window (all in the window when that holds none). */
  rows: Int32Array;
  count: number;
  /** Radial: rows[0, seam) are before the end of the rows and rows[seam, count) after it (the window holds both ends of the fan, where
   *  they meet); `count` when it does not. Rectangular: always `count`. */
  seam: number;
  /** Px between neighbouring tips in view (rectangular: the row height; radial: at the median radius of the tips in view). */
  pitch: number;
  /** Px per unit of X (distance from the root, 0..1): rectangular kx, radial k. */
  kx: number;
  /** The depths (X) the window covered: rectangular x0..x1; radial the nearest and farthest point of the window from the root. */
  near: number;
  far: number;
}

/** The node that stands for row `row` (the tip, or the collapsed clade), -1 when not loaded. */
function rowNodeOf(L: Layout, tree: TreeSnapshot, row: number): number {
  return L.rowNode ? L.rowNode[row] : tree.tipNode[row];
}
/** How far from the root row `row` reaches: its tip, a collapsed clade's deepest tip. */
function rowDepth(L: Layout, node: number): number {
  return L.collapsed?.[node] ? L.XMAX[node] : L.X[node];
}
/** The median of a[0, n) (a is not changed). */
function median(a: Float64Array, n: number): number {
  const s = a.slice(0, n).sort();
  return n % 2 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** The rows in view in window `view` (in `area`) of layout `L`, or null when no tip is in view (a window that shows only branches: the
 *  caller fits). */
export function viewContent(kind: LayoutKind, view: Viewport, area: Area, L: Layout, tree: TreeSnapshot): ViewContent | null {
  const R = L.rows;
  if (R === 0 || !(view.x1 > view.x0 && view.y1 > view.y0)) return null;
  const kx = area.aw / (view.x1 - view.x0);
  if (kind === 'rectangular') {
    let lo = Math.max(0, Math.ceil(view.y0 - 0.5)),
      hi = Math.min(R - 1, Math.floor(view.y1 - 0.5));
    if (hi < lo) lo = hi = Math.max(0, Math.min(R - 1, Math.floor((view.y0 + view.y1) / 2)));
    const stride = Math.max(1, Math.ceil((hi - lo + 1) / SAMPLE_ROWS));
    const rows = new Int32Array(Math.ceil((hi - lo + 1) / stride));
    let n = 0;
    for (let r = lo; r <= hi; r += stride) if (rowNodeOf(L, tree, r) >= 0) rows[n++] = r;
    if (!n) return null;
    return { kind, view: { ...view }, L, rows, count: n, seam: n, pitch: area.ah / (view.y1 - view.y0), kx, near: view.x0, far: view.x1 };
  }
  // radial: the angles the window covers, as row positions p (a row's tip is at p = row + 0.5); the circle is C row positions round
  const da = L.fan.span / Math.max(1, R);
  const C = TAU / da;
  const nx = Math.max(view.x0, Math.min(0, view.x1)),
    ny = Math.max(view.y0, Math.min(0, view.y1));
  const near = Math.hypot(nx, ny),
    far = Math.max(Math.hypot(view.x0, view.y0), Math.hypot(view.x1, view.y0), Math.hypot(view.x0, view.y1), Math.hypot(view.x1, view.y1));
  let p0 = 0,
    p1 = C;
  if (near > 0) {
    // the root is outside the window: it sees it under less than half a turn, about the direction of its centre
    const tc = Math.atan2((view.y0 + view.y1) / 2, (view.x0 + view.x1) / 2);
    let dmin = Infinity,
      dmax = -Infinity;
    for (const [x, y] of [
      [view.x0, view.y0],
      [view.x1, view.y0],
      [view.x0, view.y1],
      [view.x1, view.y1],
    ]) {
      let d = Math.atan2(y, x) - tc;
      d -= TAU * Math.round(d / TAU);
      if (d < dmin) dmin = d;
      if (d > dmax) dmax = d;
    }
    p0 = (tc + dmin - L.fan.start) / da;
    p0 -= C * Math.floor(p0 / C);
    p1 = p0 + (dmax - dmin) / da;
  }
  // the rows of [p0, p1] (the end of the rows) and of the same angles one turn back (the start of the rows, when the window holds both)
  const lo0 = Math.max(0, Math.ceil(p0 - 0.5)),
    hi0 = Math.min(R - 1, Math.floor(p1 - 0.5));
  const lo1 = Math.max(0, Math.ceil(p0 - C - 0.5)),
    hi1 = Math.min(R - 1, lo0 - 1, Math.floor(p1 - C - 0.5));
  const total = Math.max(0, hi0 - lo0 + 1) + Math.max(0, hi1 - lo1 + 1);
  if (!total) return null;
  const stride = Math.max(1, Math.ceil(total / SAMPLE_ROWS));
  const rows = new Int32Array(Math.ceil(total / stride) + 2);
  const radii = new Float64Array(rows.length);
  // the tips in the ellipse inscribed in the window: the ones in its corners are only neighbours of what is looked at, and taking them
  // would zoom out a little more at every switch to the band of the rectangular layout and back (a box across an arc holds more of it
  // than a band of its height); the whole window when the ellipse holds none
  const ccx = (view.x0 + view.x1) / 2,
    ccy = (view.y0 + view.y1) / 2;
  const ex = 2 / (view.x1 - view.x0),
    ey = 2 / (view.y1 - view.y0);
  const seg = [lo0, hi0, lo1, hi1];
  let n = 0,
    seam = -1;
  for (let pass = 0; pass < 2 && n === 0; pass++) {
    for (let q = 0; q < 4; q += 2) {
      if (q === 2) seam = n;
      for (let r = seg[q]; r <= seg[q + 1]; r += stride) {
        const node = rowNodeOf(L, tree, r);
        if (node < 0) continue;
        const rad = rowDepth(L, node),
          a = L.fan.start + (r + 0.5) * da;
        const x = rad * Math.cos(a),
          y = rad * Math.sin(a);
        if (pass === 0 ? Math.hypot((x - ccx) * ex, (y - ccy) * ey) > 1 : x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
        radii[n] = rad;
        rows[n++] = r;
      }
    }
  }
  if (!n) return null;
  if (seam <= 0 || seam >= n) seam = n;
  return { kind, view: { ...view }, L, rows, count: n, seam, pitch: kx * da * median(radii, n), kx, near, far };
}

/** Where the content goes: the new layout kind and arrays, its plotting area and its fit window. */
export interface PlaceTarget {
  kind: LayoutKind;
  L: Layout;
  tree: TreeSnapshot;
  area: Area;
  fit: Viewport;
  /** The least tip pitch (px) at which tips get labels (`labelMinPx`): to hold the tips that were in view, the view may zoom out down to it,
   *  never below it (nor below the pitch it had). */
  readable: number;
  /** Px a tip label takes beyond its tip, kept in view with the tips where there is room (radial: the labels run outward). */
  labelPx?: number;
}

const ROOM = 1.06; // radial: the tips that must be in view take at most 1 / ROOM of the window
const RELAX = 0.75; // to hold the tips that were in view the pitch may drop to this share of what it was

/** The pitch to show the tips at: the one they had (`pitch`), less where that is needed to hold them (`fits`), but not below RELAX of it
 *  nor below `readable` (unless they had less). */
function relaxed(pitch: number, fits: number, readable: number): number {
  return Math.max(Math.min(pitch, fits), Math.min(pitch, Math.max(readable, RELAX * pitch)));
}

/** `p` mapped from the depths of layout `a` to those of `b` along the path from the root to `node` (a branch-length switch: the same
 *  nodes, other X): a depth on a branch keeps its share of that branch; beyond the node it keeps its distance. */
function mapDepth(x: number, node: number, a: Layout, b: Layout, tree: TreeSnapshot): number {
  if (x >= a.X[node]) return b.X[node] + (x - a.X[node]);
  let v = node;
  while (tree.parent[v] >= 0 && a.X[tree.parent[v]] > x) v = tree.parent[v];
  const p = tree.parent[v];
  if (p < 0) return x; // before the root (an overscroll): as it was
  const f = a.X[v] > a.X[p] ? (x - a.X[p]) / (a.X[v] - a.X[p]) : 1;
  return b.X[p] + f * (b.X[v] - b.X[p]);
}

/** A window centre on one axis: the middle of the wanted extent [e0, e1], moved as little as needed so [b0, b1] (what must stay in view)
 *  is inside a window `w` wide; the median `m` when that does not fit either. */
function centreOn(e0: number, e1: number, b0: number, b1: number, w: number, m: number): number {
  if (b1 - b0 > w * (1 + 1e-9)) return m;
  return Math.min(b0 + w / 2, Math.max(b1 - w / 2, (e0 + e1) / 2));
}

/**
 * The window of the new layout that shows `c` (what `viewContent` found before the switch), or null to fit (nothing to follow, or the fit
 * view already shows it at least as large). The tip pitch stays (the same readability); it is never zoomed out past the fit.
 *  - Rectangular to rectangular (a branch-length switch): the rows are the same, so the y window is kept exactly; its x edges are carried
 *    through the node depths along the path to the deepest tip in view (`mapDepth`), the right edge keeping its share of the window
 *    beyond the deepest tip.
 *  - To radial: the tips at their new place on the circle; the scale puts them `pitch` px apart at their median radius. Centred on the
 *    sector of the old window's rows between the depths it covered, moved to keep the tips in view. Where their depths need more room than
 *    that (a phylogram), the pitch may drop to RELAX (3/4) of what it was, never below the pitch labels need (`readable`); past that the
 *    window is centred on their middle tip. Radial to radial keeps the window's direction and its offset in px from the tips' median radius.
 *  - Radial to rectangular: the rows are a band at that pitch, as near the row the window was centred on as holds them, x at the same px
 *    per unit of depth (wider if the tips' depths need it), the deepest tip in view near the right edge. A radial window over the place
 *    where the two ends of the fan meet holds tips of both ends of the rectangular layout, far apart: the end with more of them is kept
 *    (the other end is only its neighbour on the circle).
 */
export function placeContent(c: ViewContent, t: PlaceTarget): Viewport | null {
  const { L, tree, area: a } = t;
  const B = c.L;
  if (c.count === 0 || L.rows !== B.rows) return null;
  const rows = c.rows;
  if (t.kind === 'rectangular') {
    // the end of the fan with more of the tips, where the window held both
    const from = c.seam < c.count && c.count - c.seam > c.seam ? c.seam : 0,
      to = from === 0 ? c.seam : c.count;
    let lo = Infinity,
      hi = -Infinity,
      t0 = Infinity,
      t1 = -Infinity,
      deep = -1, // the deepest tip in view before (of equals, the deepest after): the path the x window is carried along
      db = -Infinity;
    for (let i = from; i < to; i++) {
      const r = rows[i];
      if (r < lo) lo = r;
      if (r > hi) hi = r;
      const node = rowNodeOf(L, tree, r);
      const x = rowDepth(L, node),
        xb = rowDepth(B, node);
      if (L.X[node] < t0) t0 = L.X[node];
      if (x > t1) t1 = x;
      if (xb > db || (xb === db && x > rowDepth(L, deep))) {
        db = xb;
        deep = node;
      }
    }
    if (deep < 0) return null;
    if (c.kind === 'rectangular') {
      // the same rows: y as it was, x through the depths; the deepest tip in view keeps its place across the window
      const v = c.view;
      const g = (v.x1 - db) / (v.x1 - v.x0); // the share of the window right of the deepest tip
      let x0 = mapDepth(v.x0, deep, B, L, tree);
      let x1 = g < 1 ? (t1 - g * x0) / (1 - g) : NaN;
      if (!(x1 > x0)) {
        x0 = t1 + (v.x0 - db);
        x1 = x0 + (v.x1 - v.x0);
      }
      return { x0, x1, y0: v.y0, y1: v.y1 };
    }
    // at the pitch they had: a band as high as the window holds fewer of them than an arc across it, and zooming out to hold them all
    // would zoom out a little more at every switch to and fro
    const h = a.ah / c.pitch;
    if (h >= Math.max(t.fit.y1 - t.fit.y0, L.rows)) return null; // the fit shows them at least as large
    // the band as near the row the window was centred on as it can be while it holds them (while full of them, where they do not fit)
    const v = c.view;
    const da0 = B.fan.span / Math.max(1, B.rows),
      C = TAU / da0;
    let pc = (Math.atan2((v.y0 + v.y1) / 2, (v.x0 + v.x1) / 2) - B.fan.start) / da0;
    pc -= C * Math.floor(pc / C);
    if (pc > (B.rows + C) / 2) pc -= C; // in the opening, nearer the first row
    const yc = hi + 1 - lo <= h ? Math.min(lo + h / 2, Math.max(hi + 1 - h / 2, pc)) : Math.min(hi + 1 - h / 2, Math.max(lo + h / 2, pc));
    let w = a.aw / c.kx;
    w = Math.max(w, (t1 - t0) * 1.05);
    const pad = 0.02 * w;
    const xc = centreOn(Math.max(0, c.near), Math.min(c.far, t1) + pad, t0, t1 + pad, w, (t0 + t1) / 2);
    return { x0: xc - w / 2, x1: xc + w / 2, y0: yc - h / 2, y1: yc + h / 2 };
  }
  // to radial: the tips on the circle
  const da = L.fan.span / Math.max(1, L.rows);
  const radii = new Float64Array(c.count);
  let bx0 = Infinity,
    by0 = Infinity,
    bx1 = -Infinity,
    by1 = -Infinity,
    rmax = 0;
  for (let i = 0; i < c.count; i++) {
    const r = rows[i];
    const rad = rowDepth(L, rowNodeOf(L, tree, r)),
      ang = L.fan.start + (r + 0.5) * da;
    radii[i] = rad;
    if (rad > rmax) rmax = rad;
    if (c.kind === 'rectangular' && rad > c.far) continue; // a tip right of the old window was not in view
    const x = rad * Math.cos(ang),
      y = rad * Math.sin(ang);
    if (x < bx0) bx0 = x;
    if (x > bx1) bx1 = x;
    if (y < by0) by0 = y;
    if (y > by1) by1 = y;
  }
  const rRef = median(radii, c.count);
  if (!(rRef > 0)) return null;
  if (!(bx1 >= bx0)) {
    // no tip was in view horizontally (a rectangular window left of them): their sector between the depths it covered
    const bb = new Float64Array(4);
    sectorBBox(0, 0, Math.max(0, c.near), Math.max(0, c.far), L.fan.start + rows[0] * da, L.fan.start + (rows[c.count - 1] + 1) * da, bb);
    [bx0, by0, bx1, by1] = bb;
  }
  // px per unit radius: the tips at the pitch they had at their median radius, less to hold them (down to the readable pitch)
  const perPitch = 1 / (da * rRef);
  const fits = Math.min(a.aw / Math.max(1e-12, (bx1 - bx0) * ROOM), a.ah / Math.max(1e-12, (by1 - by0) * ROOM)) / perPitch;
  const k = relaxed(c.pitch, fits, t.readable) * perPitch;
  const kfit = a.aw / (t.fit.x1 - t.fit.x0);
  if (!(k > kfit)) return null;
  const hw = a.aw / 2 / k,
    hh = a.ah / 2 / k;
  // the tips with their labels (to their outer end, `labelPx` at this scale)
  const lr = (t.labelPx ?? 0) / k;
  let lx0 = bx0,
    ly0 = by0,
    lx1 = bx1,
    ly1 = by1;
  for (let i = 0; i < c.count && lr > 0; i++) {
    const r = rows[i];
    if (c.kind === 'rectangular' && radii[i] > c.far) continue;
    const ang = L.fan.start + (r + 0.5) * da,
      x = (radii[i] + lr) * Math.cos(ang),
      y = (radii[i] + lr) * Math.sin(ang);
    if (x < lx0) lx0 = x;
    if (x > lx1) lx1 = x;
    if (y < ly0) ly0 = y;
    if (y > ly1) ly1 = y;
  }
  // where the centre would be: from radial, the same direction, as far from the tips (in px) as it was; from rectangular, the middle of the
  // sector of the window's rows between the depths it covered
  let ex0: number, ex1: number, ey0: number, ey1: number;
  if (c.kind === 'radial') {
    const v = c.view;
    const cx = (v.x0 + v.x1) / 2,
      cy = (v.y0 + v.y1) / 2;
    const rho = Math.hypot(cx, cy),
      th = Math.atan2(cy, cx);
    const rb = c.pitch / (c.kx * (B.fan.span / Math.max(1, B.rows))); // the median radius before
    const r2 = Math.max(0, rRef + ((rho - rb) * c.kx) / k);
    ex0 = ex1 = r2 * Math.cos(th);
    ey0 = ey1 = r2 * Math.sin(th);
  } else {
    // the rectangular layout shows the labels beside the window: here they run outward, so their room is part of the sector
    const bb = new Float64Array(4);
    const dLo = Math.max(0, Math.min(c.near, rmax)),
      dHi = Math.max(dLo, Math.min(c.far, rmax)) + lr;
    sectorBBox(0, 0, dLo, dHi, L.fan.start + c.view.y0 * da, L.fan.start + c.view.y1 * da, bb);
    [ex0, ey0, ex1, ey1] = bb;
  }
  // moved as little as needed to hold the tips with their labels, or the tips alone; on the middle tip where they do not fit
  const w = (2 * hw) / ROOM,
    h = (2 * hh) / ROOM;
  if (lx1 - lx0 <= w && ly1 - ly0 <= h) {
    bx0 = lx0;
    bx1 = lx1;
    by0 = ly0;
    by1 = ly1;
  }
  const mi = c.count >> 1,
    ma = L.fan.start + (rows[mi] + 0.5) * da;
  const cx = centreOn(ex0, ex1, bx0, bx1, w, radii[mi] * Math.cos(ma)),
    cy = centreOn(ey0, ey1, by0, by1, h, radii[mi] * Math.sin(ma));
  return { x0: cx - hw, x1: cx + hw, y0: cy - hh, y1: cy + hh };
}
