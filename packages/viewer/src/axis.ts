// The scale of a frame: the distance (or time before the tips) axis under a rectangular phylogram, the radial scale rings behind the tree
// (option `radialRings`) and the radial scale bar. One call each per frame, nothing per node. `radialStep` is the one scale step of the bar
// and the rings.

import type { Scene } from './draw.ts';
import type { RadialRings } from './types.ts';

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

/** The radial scale step in tree units at `pxPerUnit`: a round length (1, 2 or 5 x 10^n) of about 90 px, the scale bar's length and
 *  the spacing of the rings. */
export const radialStep = (pxPerUnit: number): number => niceStep(90 / pxPerUnit);

/** Radius (px) of ring j at `w` px per step: counted back from the tips (radius k) on a dated tree, out from the root otherwise. */
const ringRadius = (dated: boolean, k: number, w: number, j: number): number => (dated ? k - j * w : j * w);

/** Radial, option `radialRings`: circles about the root at the scale bar's step, behind the tree. On a dated tree they count back from
 *  the tips (ring j at radius k - j * step px, age j * step), otherwise out from the root (radius j * step px); only radii 0..k, where the
 *  tree is. Only the rings between the viewport's nearest and farthest radius are drawn, over the angles it covers (proj.rMin, rMax,
 *  lo, hi): O(rings in view), nothing per node. 'lines' strokes them; 'stripes' shades the odd bands (band j between ring j and j + 1),
 *  so the band at the tips (dated) or the root stays clear. With an opening, ring labels go along its middle where the gap fits them. */
export function drawRings(ctx: CanvasRenderingContext2D, S: Scene, mode: RadialRings): void {
  const proj = S.proj;
  const { L, T } = proj;
  if (mode === 'none' || proj.kind !== 'radial' || !L.usedLengths) return;
  const { theme } = S;
  const k = T.k;
  const pxPerUnit = k / L.maxLen;
  const step = radialStep(pxPerUnit);
  const w = step * pxPerUnit;
  const dated = L.ultrametric;
  const lo = Math.max(0, proj.rMin),
    hi = Math.min(k, proj.rMax);
  if (lo > hi) return;
  // the rings with a radius in lo..hi (ringRadius)
  const eps = 1e-9;
  const jLo = Math.ceil((dated ? k - hi : lo) / w - eps),
    jHi = Math.floor((dated ? k - lo : hi) / w + eps);
  const a0 = proj.all ? 0 : proj.lo,
    a1 = proj.all ? 2 * Math.PI : proj.wrap ? proj.hi + 2 * Math.PI : proj.hi;
  const { cx, cy } = T;
  ctx.save();
  ctx.fillStyle = theme.muted;
  ctx.strokeStyle = theme.muted;
  ctx.beginPath();
  if (mode === 'stripes') {
    // the bands touching lo..hi: one below jLo (it reaches up to ring jLo) through jHi
    for (let j = Math.max(0, jLo - 1); j <= jHi; j++) {
      if ((j & 1) === 0) continue;
      const r0 = Math.max(0, Math.min(k, ringRadius(dated, k, w, j))),
        r1 = Math.max(0, Math.min(k, ringRadius(dated, k, w, j + 1)));
      ctx.moveTo(cx + r0 * Math.cos(a0), cy + r0 * Math.sin(a0));
      ctx.arc(cx, cy, r0, a0, a1);
      ctx.arc(cx, cy, r1, a1, a0, true);
      ctx.closePath();
    }
    ctx.globalAlpha = theme.ringStripeOpacity;
    ctx.fill();
  } else {
    for (let j = jLo; j <= jHi; j++) {
      const r = ringRadius(dated, k, w, j);
      if (r <= 0) continue;
      ctx.moveTo(cx + r * Math.cos(a0), cy + r * Math.sin(a0));
      ctx.arc(cx, cy, r, a0, a1);
    }
    ctx.globalAlpha = theme.ringOpacity;
    ctx.lineWidth = theme.ringWidth;
    ctx.stroke();
  }
  ringLabels(ctx, S, jLo, jHi, w, step);
  ctx.restore();
}

/** The labels of rings jLo..jHi along the middle of the radial opening (none without one): the distance or age of each, where the
 *  opening is wider than the text at its radius, just outside its ring so the ring's line does not run through the text. */
function ringLabels(ctx: CanvasRenderingContext2D, S: Scene, jLo: number, jHi: number, w: number, step: number): void {
  const { theme } = S;
  const { L, T } = S.proj;
  const gap = 2 * Math.PI - L.fan.span; // the opening's angle
  if (gap < 1e-6) return;
  const mid = L.fan.start + L.fan.span / 2 + Math.PI;
  const c = Math.cos(mid),
    s = Math.sin(mid);
  ctx.globalAlpha = 1;
  ctx.font = `${theme.axisFontSize}px ${theme.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let j = Math.max(0, jLo); j <= jHi; j++) {
    const r = ringRadius(L.ultrametric, T.k, w, j);
    if (r <= 0) continue;
    const text = fmtTick(j * step, step);
    const tw = ctx.measureText(text).width;
    if (r * gap < tw + 6) continue;
    // out along the ray by half the text box's extent in that direction, plus 2 px
    const out = r + (Math.abs(c) * tw + Math.abs(s) * theme.axisFontSize) / 2 + 2;
    ctx.fillText(text, T.cx + out * c, T.cy + out * s);
  }
}

/** Radial: a scale bar of a round length at the bottom right. */
export function drawScaleBar(ctx: CanvasRenderingContext2D, S: Scene): void {
  const { theme } = S;
  const { L, T } = S.proj;
  if (T.kind !== 'radial' || !L.usedLengths) return;
  const pxPerUnit = T.k / L.maxLen;
  const step = radialStep(pxPerUnit);
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
