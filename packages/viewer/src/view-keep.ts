// keptViewport: where the window of one tree goes when another tree replaces it (TreeViewer.setTree with view 'keep'). The tips in view
// before the change are sent through a tip map and the window is placed on where they landed, at the same scale where the new tree
// allows. Pure arithmetic over the two snapshots and layouts: no DOM, so test/set-tree.test.mjs covers it numerically. Runs once per tree
// swap, so it may loop over the tips; the frame code does not use it. The window is in rows (layout.ts): a tip is sent to its row in the
// old layout and its new place to a row in the new one, so a clade collapsed on either side is followed as the one row it is.

import type { Layout } from './layout.ts';
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
  const da = (2 * Math.PI) / a.beforeL.rows;
  const dn = (2 * Math.PI) / a.afterL.rows;
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
    const ang = ((rowOfBefore ? rowOfBefore[r] : r) + 0.5) * da;
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
      const ang = ((rowOfBefore ? rowOfBefore[r] : r) + 0.5) * da;
      const tLo = rowOfAfter ? rowOfAfter[t.lo] : t.lo,
        tHi = (rowOfAfter ? rowOfAfter[t.hi - 1] : t.hi - 1) + 1;
      const d = ((tLo + tHi) / 2) * dn - ang;
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
