// Screen transform and node positions. The view is a window in layout coordinates (see Viewport); the
// transform maps layout to CSS pixels. Rectangular: sx = ox + X*kx, sy = oy + ROW*ky. Radial: the root is at
// (cx, cy), angle = ROW*da, radius = X*k.

import type { Layout } from './layout.ts';
import type { LayoutKind, Viewport } from './types.ts';

export interface Area {
  ax: number; // left of the plotting area (CSS px)
  ay: number;
  aw: number; // width mapped to the x window
  ah: number;
  clipL: number;
  clipT: number;
  clipR: number;
  clipB: number;
}

export interface Transform {
  kind: LayoutKind;
  W: number;
  H: number;
  area: Area;
  ox: number;
  oy: number;
  kx: number;
  ky: number;
  cx: number;
  cy: number;
  k: number;
  da: number;
  clipL: number;
  clipT: number;
  clipR: number;
  clipB: number;
}

export function makeTransform(kind: LayoutKind, W: number, H: number, v: Viewport, a: Area, tips: number): Transform {
  const kx = a.aw / (v.x1 - v.x0);
  const ky = a.ah / (v.y1 - v.y0);
  return {
    kind,
    W,
    H,
    area: a,
    kx,
    ky,
    ox: a.ax - v.x0 * kx,
    oy: a.ay - v.y0 * ky,
    k: kx,
    cx: a.ax - v.x0 * kx,
    cy: a.ay - v.y0 * kx,
    da: (2 * Math.PI) / Math.max(1, tips),
    clipL: a.clipL,
    clipT: a.clipT,
    clipR: a.clipR,
    clipB: a.clipB,
  };
}

/** Screen position of node i (its marker position). */
export function nodeXY(T: Transform, L: Layout, i: number, out: { x: number; y: number }): void {
  if (T.kind === 'rectangular') {
    out.x = T.ox + L.X[i] * T.kx;
    out.y = T.oy + L.ROW[i] * T.ky;
  } else {
    const r = L.X[i] * T.k;
    if (L.COS) {
      out.x = T.cx + r * L.COS[i];
      out.y = T.cy + r * L.SIN![i];
    } else {
      const a = L.ROW[i] * T.da;
      out.x = T.cx + r * Math.cos(a);
      out.y = T.cy + r * Math.sin(a);
    }
  }
}

/** Screen bounding box of the annular sector r0..r1 (px), angles a0..a1 (rad), around (cx, cy). */
export function sectorBBox(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number, out: Float64Array): void {
  const c0 = Math.cos(a0),
    s0 = Math.sin(a0),
    c1 = Math.cos(a1),
    s1 = Math.sin(a1);
  let x0 = Math.min(r0 * c0, r1 * c0, r0 * c1, r1 * c1);
  let x1 = Math.max(r0 * c0, r1 * c0, r0 * c1, r1 * c1);
  let y0 = Math.min(r0 * s0, r1 * s0, r0 * s1, r1 * s1);
  let y1 = Math.max(r0 * s0, r1 * s0, r0 * s1, r1 * s1);
  const half = Math.PI / 2;
  for (let q = Math.ceil(a0 / half); q * half <= a1; q++) {
    switch (((q % 4) + 4) % 4) {
      case 0:
        if (r1 > x1) x1 = r1;
        break;
      case 1:
        if (r1 > y1) y1 = r1;
        break;
      case 2:
        if (-r1 < x0) x0 = -r1;
        break;
      default:
        if (-r1 < y0) y0 = -r1;
    }
  }
  out[0] = cx + x0;
  out[1] = cy + y0;
  out[2] = cx + x1;
  out[3] = cy + y1;
}

export function viewportEquals(a: Viewport, b: Viewport, eps = 1e-9): boolean {
  const e = (p: number, q: number) => Math.abs(p - q) <= eps * Math.max(1, Math.abs(p), Math.abs(q));
  return e(a.x0, b.x0) && e(a.x1, b.x1) && e(a.y0, b.y0) && e(a.y1, b.y1);
}
