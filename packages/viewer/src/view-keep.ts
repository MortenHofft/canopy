// keptViewport: where the window of one tree goes when another tree replaces it (TreeViewer.setTree with view 'keep'). The tips in view
// before the change are sent through a tip map (old tip rank -> new tip rank, -1 for a tip that is gone) and the window is placed on
// where they landed, at the same scale where the new tree allows. Pure arithmetic over the two snapshots and layouts: no DOM, so
// test/view-keep.test.mjs covers it numerically. Runs once per tree swap, so it may loop over the tips; the frame code does not use it.

import type { Layout } from './layout.ts';
import type { LayoutKind, TreeSnapshot, Viewport } from './types.ts';

export interface KeepInput {
  layout: LayoutKind;
  /** The window before the change. */
  view: Viewport;
  before: TreeSnapshot;
  beforeL: Layout;
  after: TreeSnapshot;
  /** New tip rank of the old tip rank, -1 when it is gone. */
  mapTip(oldRank: number): number;
}

/**
 * The window that frames the surviving tips of the old window, or null when none survives (the caller fits).
 *  - Rectangular: the tips whose row is inside the old y window; the window keeps its height (the same px per tip) and keeps its place
 *    relative to them, so a flip inside the view or a prune above it leaves the picture where it was. When the survivors now spread over
 *    more rows than the window holds (a reroot scrambled them), the window grows to hold them. x stays.
 *  - Radial: the tips inside the old window; the window keeps its size and centre radius and turns by the mean angle the survivors moved
 *    (their angle is rank * 2pi / tips, so it changes when tips are removed or reordered).
 */
export function keptViewport(a: KeepInput): Viewport | null {
  const N = a.before.tipCount;
  const v = a.view;
  if (N === 0 || a.after.tipCount === 0) return null;
  if (a.layout === 'rectangular') {
    let lo = Math.max(0, Math.ceil(v.y0 - 0.5)),
      hi = Math.min(N - 1, Math.floor(v.y1 - 0.5));
    if (hi < lo) lo = hi = Math.max(0, Math.min(N - 1, Math.floor((v.y0 + v.y1) / 2)));
    let oMin = Infinity,
      oMax = -Infinity,
      nMin = Infinity,
      nMax = -Infinity;
    for (let r = lo; r <= hi; r++) {
      const q = a.mapTip(r);
      if (q < 0) continue;
      if (r < oMin) oMin = r;
      if (r > oMax) oMax = r;
      if (q < nMin) nMin = q;
      if (q > nMax) nMax = q;
    }
    if (oMax < 0) return null;
    const h = v.y1 - v.y0;
    const extent = nMax - nMin + 1;
    const nc = (nMin + nMax + 1) / 2;
    if (extent > h) {
      const pad = extent * 0.02;
      return { x0: v.x0, x1: v.x1, y0: nc - extent / 2 - pad, y1: nc + extent / 2 + pad };
    }
    const yc = nc + ((v.y0 + v.y1) / 2 - (oMin + oMax + 1) / 2);
    return { x0: v.x0, x1: v.x1, y0: yc - h / 2, y1: yc + h / 2 };
  }
  const da = (2 * Math.PI) / N;
  const dn = (2 * Math.PI) / a.after.tipCount;
  const X = a.beforeL.X;
  const tipNode = a.before.tipNode;
  let sx = 0,
    sy = 0,
    n = 0;
  for (let r = 0; r < N; r++) {
    const node = tipNode[r];
    if (node < 0) continue; // a tip row that is not loaded
    const ang = (r + 0.5) * da;
    const x = X[node] * Math.cos(ang),
      y = X[node] * Math.sin(ang);
    if (x < v.x0 || x > v.x1 || y < v.y0 || y > v.y1) continue;
    const q = a.mapTip(r);
    if (q < 0) continue;
    const d = (q + 0.5) * dn - ang;
    sx += Math.cos(d);
    sy += Math.sin(d);
    n++;
  }
  if (n === 0) return null;
  const d = Math.atan2(sy, sx);
  if (d === 0) return { ...v };
  const c = Math.cos(d),
    s = Math.sin(d);
  const cx = (v.x0 + v.x1) / 2,
    cy = (v.y0 + v.y1) / 2;
  const nx = cx * c - cy * s,
    ny = cx * s + cy * c;
  const hw = (v.x1 - v.x0) / 2,
    hh = (v.y1 - v.y0) / 2;
  return { x0: nx - hw, x1: nx + hw, y0: ny - hh, y1: ny + hh };
}
