// Stub candidate: a deliberately naive SVG tree viewer that implements EVERY method of CONTRACT.md.
// It is both the self-test of the runner and the template for real adapters (see ../README.md).
//
// How it renders (naive on purpose, so it is slow on 10k+ tips):
//  * the whole tree is one SVG: one <path> per branch and one per node dot, inside a <g> whose transform is
//    changed on pan/zoom (no culling, no level of detail);
//  * tip labels, highlight bands and links are a small HTML layer for the visible rows only (needs rows >= 9 px);
//  * columns (bar / text / alignment) are drawn on ONE canvas for the visible rows;
//  * clade colour and tip highlight are applied imperatively to the existing DOM (no redraw, no re-layout).
// "source: library" in events means "reported by this renderer's own click handler"; there is no third-party
// library here, the descendant tips come from the shared TreeModel inside the renderer.

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CandidateAdapter, CapabilityReport, ColumnSpec, Point, Rect, ThemeSpec, ViewHandle, ViewProps } from '../../shared/types.ts';
import { gbifTheme, gbifDarkTheme } from '../../shared/gbif-theme.ts';
import { computeGeometry, buildSvg, SPAN } from './layout.ts';

const LABEL_W = 130; // px reserved for tip labels between the tree and the first column
const TOP = 28; // px above the first row (column headers)
const BOTTOM = 8;
const COL_GAP = 6;
/** Fault injection for the runner's selftest (runner/selftest.mjs): ?fault=colour|align|link|keyboard|tips|wheel. Never set in normal use. */
const FAULT = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('fault') : null;

const CSS = `
.sp-root{position:relative;width:100%;height:100%;overflow:hidden;user-select:none;touch-action:none;background:var(--sp-bg);color:var(--sp-fg);font-family:var(--sp-font)}
.sp-root.sp-dragging{cursor:grabbing}
.sp-svg{position:absolute;inset:0;width:100%;height:100%}
.sp-svg path{fill:none;vector-effect:non-scaling-stroke;stroke-linecap:round}
.sp-svg .vb{stroke:var(--sp-branch);stroke-width:1.2px}
.sp-svg .vi{stroke:var(--sp-branch);stroke-width:4px;opacity:.55}
.sp-svg .vt{stroke:var(--sp-branch);stroke-width:5px}
.sp-svg .cb{stroke-width:1.8px}
.sp-svg .cd{stroke-width:5px}
.sp-svg .b{stroke:transparent;stroke-width:7px;pointer-events:stroke}
.sp-svg .d{stroke:transparent;stroke-width:9px;pointer-events:stroke}
.sp-svg .d.hl{stroke:var(--sp-hl);stroke-width:13px}
.sp-noint .sp-svg .vi{display:none}
.sp-thick .sp-svg .vb{stroke-width:2.4px}
.sp-cols{position:absolute;left:0;top:0;pointer-events:none}
.sp-over{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.sp-over .band{position:absolute;left:0;right:0;background:var(--sp-hl);opacity:.18}
.sp-over .ring{position:absolute;width:20px;height:20px;margin:-10px 0 0 -10px;border:2px solid var(--sp-hl);border-radius:50%}
.sp-over .lab{font-style:italic;position:absolute;white-space:nowrap;pointer-events:auto;cursor:pointer;color:var(--sp-fg);text-decoration:none;outline-offset:1px}
.sp-over a.lab{text-decoration:underline}
.sp-over .lab.hl{color:var(--sp-hl);font-weight:600}
.sp-over .lab.rad{pointer-events:none}
.sp-over .lab:focus-visible{outline:2px solid #0779b5}
`;

const AA: Record<string, string> = {};
for (const c of 'AILMFWVC') AA[c] = '#80a0f0';
for (const c of 'KR') AA[c] = '#f01505';
for (const c of 'ED') AA[c] = '#c048c0';
for (const c of 'NQST') AA[c] = '#15c015';
AA.G = '#f09048';
AA.P = '#c0c000';
for (const c of 'HY') AA[c] = '#15a4a4';
AA.U = '#15c015';
const resColour = (ch: string) => AA[ch.toUpperCase()] ?? '#e2e2e2';

interface ViewState {
  kx: number;
  ky: number;
  tx: number;
  ty: number;
}

/**
 * Colours come from the GBIF tokens through gbifTheme() (shared/gbif-theme.ts): background bg1, labels fg1,
 * branches fg2, highlight and bars from the brand green and the categorical palette. The runner's `tokens`
 * (background, foreground, branch, highlight, fontFamily) override them. Dark uses gbifDarkTheme().
 */
function themeVars(t: ThemeSpec): React.CSSProperties {
  const g = t.dark ? gbifDarkTheme() : gbifTheme();
  const k = t.tokens ?? {};
  return {
    '--sp-bg': k.background ?? g.bg1,
    '--sp-fg': k.foreground ?? g.fg1,
    '--sp-branch': k.branch ?? (t.dark ? g.fg3 : g.fg2),
    '--sp-hl': k.highlight ?? g.primary,
    '--sp-bar': g.categorical[1],
    '--sp-font': k.fontFamily ?? g.fontBody,
  } as React.CSSProperties;
}

function barWidth(v: number, max: number, w: number): number {
  if (!(max > 0) || !(v > 0)) return 1;
  return Math.max(1, (Math.log10(1 + v) / Math.log10(1 + max)) * (w - 4));
}

function StubView(props: ViewProps) {
  const { tree, layout, branchLengths, size, columns, theme, tipLinks, emit } = props;
  const geom = useMemo(() => computeGeometry(tree, layout, branchLengths), [tree, layout, branchLengths]);
  const svg = useMemo(() => buildSvg(tree, geom), [tree, geom]);
  const rootRef = useRef<HTMLDivElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const brRef = useRef<SVGGElement>(null);
  const clRef = useRef<SVGGElement>(null);
  const dtRef = useRef<SVGGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<ViewState>({ kx: 1, ky: 1, tx: 0, ty: 0 });
  const fitRef = useRef<ViewState>({ kx: 1, ky: 1, tx: 0, ty: 0 });
  const rafRef = useRef(0);
  const latest = useRef(props);
  latest.current = props;
  const geomRef = useRef(geom);
  geomRef.current = geom;
  const colourRanges = useRef<{ a: number; b: number; colour: string }[]>([]);
  const prevHl = useRef<number[]>([]);
  const hover = useRef('');
  const dragged = useRef(false);
  const [, setTick] = useState(0);
  const [dragging, setDragging] = useState(false);

  const colsW = (cols: ColumnSpec[]) => cols.reduce((s, c) => s + c.width + COL_GAP, 0);

  const redraw = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      drawColumns();
      setTick((t) => t + 1);
    });
  };
  const applyView = () => {
    const v = viewRef.current;
    gRef.current?.setAttribute('transform', `translate(${v.tx} ${v.ty}) scale(${v.kx} ${v.ky})`);
    redraw();
  };

  const fit = (xOnly = false) => {
    const { width: W, height: H } = latest.current.size;
    const v = viewRef.current;
    if (latest.current.layout === 'rectangular') {
      const kx = Math.max(0.05, (W - 20 - LABEL_W - colsW(latest.current.columns)) / SPAN);
      if (xOnly) {
        v.kx = kx;
        v.tx = 10;
      } else {
        viewRef.current = { kx, ky: Math.max(1e-4, (H - TOP - BOTTOM) / Math.max(1, tree.tipCount)), tx: 10, ty: TOP };
      }
    } else {
      const k = (Math.min(W, H) / 2 / SPAN) * 0.82;
      viewRef.current = { kx: k, ky: k, tx: W / 2, ty: H / 2 };
    }
    fitRef.current = { ...viewRef.current };
    applyView();
  };

  // ---------------------------------------------------------------- geometry helpers (screen = root-relative px)
  const nodeScreen = (i: number): { x: number; y: number } => {
    const v = viewRef.current;
    const g = geomRef.current;
    return { x: v.tx + g.X[i] * v.kx, y: v.ty + g.Y[i] * v.ky };
  };
  const inside = (x: number, y: number, m = 1) => x >= m && y >= m && x <= latest.current.size.width - m && y <= latest.current.size.height - m;
  const rootRect = () => rootRef.current!.getBoundingClientRect();
  const colLeft = (colIndex: number): number => {
    const v = viewRef.current;
    let x = v.tx + SPAN * v.kx + LABEL_W;
    for (let k = 0; k < colIndex; k++) x += latest.current.columns[k].width + COL_GAP;
    return x;
  };

  // ---------------------------------------------------------------- canvas columns
  const drawColumns = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const { width: W, height: H } = latest.current.size;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cv.style.width = W + 'px';
      cv.style.height = H + 'px';
    }
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const cols = latest.current.columns;
    if (!cols.length || latest.current.layout !== 'rectangular') return;
    const cs = getComputedStyle(rootRef.current!);
    const fg = cs.getPropertyValue('--sp-fg') || '#000';
    const barC = cs.getPropertyValue('--sp-bar') || '#4c9b45';
    const v = viewRef.current;
    const r0 = Math.max(0, Math.floor(-v.ty / v.ky));
    const r1 = Math.min(tree.tipCount - 1, Math.ceil((H - v.ty) / v.ky));
    const fam = cs.getPropertyValue('--sp-font') || 'system-ui, sans-serif';
    ctx.font = `600 11px ${fam}`;
    ctx.fillStyle = fg;
    ctx.textBaseline = 'alphabetic';
    cols.forEach((c, k) => {
      const x0 = colLeft(k);
      ctx.fillStyle = fg;
      ctx.font = `600 11px ${fam}`;
      ctx.fillText(c.header, x0, TOP - 8, c.width);
      let max = 0;
      if (c.kind === 'bar') for (const key in c.values) max = Math.max(max, Number(c.values[key]));
      for (let r = r0; r <= r1; r++) {
        const val = c.values[tree.tipLabels[r]];
        if (val === undefined) continue; // unmatched tip: nothing drawn, locateCell returns null
        const y = v.ty + r * v.ky + (FAULT === 'align' ? 7 : 0);
        if (c.kind === 'bar') {
          ctx.fillStyle = barC;
          ctx.fillRect(x0 + 2, y + v.ky * 0.1, barWidth(Number(val), max, c.width), Math.max(1, v.ky * 0.8));
        } else if (c.kind === 'text') {
          if (v.ky >= 8) {
            ctx.fillStyle = fg;
            ctx.font = `${Math.min(13, v.ky * 0.7)}px ${fam}`;
            ctx.fillText(String(val), x0 + 2, y + v.ky / 2 + Math.min(13, v.ky * 0.7) / 3, c.width - 4);
          } else {
            ctx.fillStyle = barC;
            ctx.globalAlpha = 0.35;
            ctx.fillRect(x0 + 2, y, c.width - 4, Math.max(1, v.ky));
            ctx.globalAlpha = 1;
          }
        } else {
          const seq = String(val);
          const cw = c.width / Math.max(1, seq.length);
          let runStart = 0;
          for (let j = 1; j <= seq.length; j++) {
            if (j === seq.length || resColour(seq[j]) !== resColour(seq[runStart])) {
              ctx.fillStyle = resColour(seq[runStart]);
              ctx.fillRect(x0 + runStart * cw, y, (j - runStart) * cw + 0.3, Math.max(1, v.ky - (v.ky > 3 ? 1 : 0)));
              runStart = j;
            }
          }
        }
      }
    });
  };

  // ---------------------------------------------------------------- introspection
  const handle: ViewHandle = {
    locate(t) {
      const r = rootRect();
      const i = t.kind === 'tip' ? tree.tipIndex(t.id) : tree.isNodeId(t.id) ? tree.nodeIndex(t.id) : -1;
      if (i < 0) return null;
      const p = nodeScreen(i);
      return inside(p.x, p.y) ? { x: r.left + p.x, y: r.top + p.y } : null;
    },
    bounds(t) {
      const r = rootRect();
      const i = t.kind === 'tip' ? tree.tipIndex(t.id) : tree.isNodeId(t.id) ? tree.nodeIndex(t.id) : -1;
      if (i < 0) return null;
      const v = viewRef.current;
      const g = geomRef.current;
      let x0: number, x1: number, y0: number, y1: number;
      if (t.kind === 'tip') {
        const p = nodeScreen(i);
        x0 = p.x - 4;
        x1 = p.x + 4;
        y0 = p.y - 4;
        y1 = p.y + 4;
      } else if (g.layout === 'rectangular') {
        let mx = g.X[i];
        for (let k = i; k < tree.subtreeEnd[i]; k++) if (g.X[k] > mx) mx = g.X[k];
        x0 = v.tx + g.X[i] * v.kx;
        x1 = v.tx + mx * v.kx;
        y0 = v.ty + tree.leafStart[i] * v.ky;
        y1 = v.ty + tree.leafEnd[i] * v.ky;
      } else {
        let ax = Infinity, bx = -Infinity, ay = Infinity, by = -Infinity;
        for (let k = i; k < tree.subtreeEnd[i]; k++) {
          if (g.X[k] < ax) ax = g.X[k];
          if (g.X[k] > bx) bx = g.X[k];
          if (g.Y[k] < ay) ay = g.Y[k];
          if (g.Y[k] > by) by = g.Y[k];
        }
        x0 = v.tx + ax * v.kx;
        x1 = v.tx + bx * v.kx;
        y0 = v.ty + ay * v.ky;
        y1 = v.ty + by * v.ky;
      }
      const W = latest.current.size.width;
      const H = latest.current.size.height;
      x0 = Math.max(0, x0);
      y0 = Math.max(0, y0);
      x1 = Math.min(W, x1);
      y1 = Math.min(H, y1);
      if (x1 - x0 < 1 || y1 - y0 < 1) return null;
      return { x: r.left + x0, y: r.top + y0, width: x1 - x0, height: y1 - y0 };
    },
    locateCell(colId, tipId) {
      const cols = latest.current.columns;
      const k = cols.findIndex((c) => c.id === colId);
      const rank = tree.tipIndex(tipId) >= 0 ? tree.tipRank[tree.tipIndex(tipId)] : -1;
      if (k < 0 || rank < 0 || latest.current.layout !== 'rectangular') return null;
      const c = cols[k];
      const val = c.values[tipId];
      if (val === undefined) return null;
      const v = viewRef.current;
      const y = v.ty + rank * v.ky + (FAULT === 'align' ? 7 : 0);
      if (y + v.ky < 0 || y > latest.current.size.height || y < 0 || y + v.ky > latest.current.size.height + 0.5) {
        // partially visible rows still count if their centre is visible
        if (!(y + v.ky / 2 >= 0 && y + v.ky / 2 <= latest.current.size.height)) return null;
      }
      const r = rootRect();
      let max = 0;
      if (c.kind === 'bar') for (const key in c.values) max = Math.max(max, Number(c.values[key]));
      const w = c.kind === 'bar' ? barWidth(Number(val), max, c.width) : c.width - 4;
      const h = c.kind === 'bar' ? Math.max(1, v.ky * 0.8) : Math.max(1, v.ky);
      const yy = c.kind === 'bar' ? y + v.ky * 0.1 : y;
      return { x: r.left + colLeft(k) + 2, y: r.top + yy, width: w, height: h };
    },
    custom() {
      return { tips: tree.tipCount, nodes: tree.nodeCount, layoutMs: geomRef.current.layoutMs, kx: viewRef.current.kx, ky: viewRef.current.ky };
    },
  };
  useLayoutEffect(() => {
    props.handleRef.current = handle;
    return () => {
      props.handleRef.current = null;
    };
  });

  // ---------------------------------------------------------------- lifecycle
  useLayoutEffect(() => {
    fit();
  }, [geom.layout, size.width, size.height, tree]);
  useLayoutEffect(() => {
    fit(true);
  }, [columns.length]);
  useEffect(() => {
    props.onReady({
      parseMs: 0,
      tips: tree.tipCount,
      notes: `tree parsed by the shell (sharedParseMs=${props.sharedParseMs.toFixed(1)}); stub layout ${geom.layoutMs.toFixed(1)} ms; usedLengths=${geom.usedLengths}`,
    });
  }, []);
  useEffect(() => {
    redraw();
  }, [columns, theme, tipLinks]);
  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // wheel zoom (needs a non-passive listener) and drag pan
  useEffect(() => {
    const el = rootRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (FAULT === 'wheel') return;
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.03 : 0.0015));
      const v = viewRef.current;
      const fitv = fitRef.current;
      if (latest.current.layout === 'rectangular') {
        if (e.shiftKey || e.ctrlKey) {
          const kx = Math.min(400, Math.max(fitv.kx * 0.3, v.kx * f));
          v.tx = mx - ((mx - v.tx) * kx) / v.kx;
          v.kx = kx;
        } else {
          const ky = Math.min(80, Math.max(fitv.ky * 0.3, v.ky * f));
          v.ty = my - ((my - v.ty) * ky) / v.ky;
          v.ky = ky;
        }
      } else {
        const k = Math.min(fitv.kx * 3000, Math.max(fitv.kx * 0.3, v.kx * f));
        v.tx = mx - ((mx - v.tx) * k) / v.kx;
        v.ty = my - ((my - v.ty) * k) / v.ky;
        v.kx = v.ky = k;
      }
      applyView();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragged.current = false;
    const sx = e.clientX, sy = e.clientY;
    const v0 = { ...viewRef.current };
    const move = (m: PointerEvent) => {
      const dx = m.clientX - sx, dy = m.clientY - sy;
      if (!dragged.current && Math.hypot(dx, dy) > 3) {
        dragged.current = true;
        setDragging(true);
      }
      if (dragged.current) {
        viewRef.current.tx = v0.tx + dx;
        viewRef.current.ty = v0.ty + dy;
        applyView();
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setDragging(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // ---------------------------------------------------------------- events
  const target = (el: EventTarget | null): { i: number; kind: 'dot' | 'branch' | 'label' } | null => {
    if (!(el instanceof Element)) return null;
    const lab = el.closest('[data-tip-label]');
    if (lab) {
      const i = tree.tipIndex(lab.getAttribute('data-tip-label') as string);
      return i < 0 ? null : { i, kind: 'label' };
    }
    const n = el.getAttribute('data-n');
    if (n === null) return null;
    return { i: Number(n), kind: el.classList.contains('d') ? 'dot' : 'branch' };
  };
  const fire = (i: number, kind: 'dot' | 'branch' | 'label', how: 'click' | 'hover') => {
    const isTip = tree.childCount[i] === 0;
    const type = how === 'click' ? (isTip ? 'tipClick' : kind === 'branch' ? 'branchClick' : 'nodeClick') : isTip ? 'tipHover' : 'nodeHover';
    emit({ type, nodeId: tree.nodeId(i), isTip, tipIds: FAULT === 'tips' && !isTip ? tree.descendantTips(i).slice(1) : tree.descendantTips(i), source: 'library', libraryPayload: { n: i, via: kind } });
  };
  const onClick = (e: React.MouseEvent) => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    const t = target(e.target);
    if (t) fire(t.i, t.kind, 'click');
  };
  const onOver = (e: React.MouseEvent) => {
    const t = target(e.target);
    const key = t ? `${t.i}:${t.kind === 'branch' ? 'b' : 'n'}` : '';
    if (key === hover.current) return;
    hover.current = key;
    if (t) fire(t.i, t.kind, 'hover');
  };

  // ---------------------------------------------------------------- imperative colour / highlight / focus
  useEffect(() => {
    const cl = clRef.current;
    if (!cl) return;
    // coloured clades are overlay paths made from the subtree's own path data: nothing is redrawn or re-laid out
    cl.replaceChildren();
    const next: { a: number; b: number; colour: string }[] = [];
    for (const c of props.colouredClades) {
      const a = tree.nodeIndex(c.nodeId);
      const b = tree.subtreeEnd[a];
      next.push({ a, b, colour: c.colour });
      const mk = (cls: string, d: string) => {
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('class', cls);
        p.setAttribute('d', d);
        p.style.stroke = FAULT === 'colour' ? 'transparent' : c.colour;
        cl.appendChild(p);
      };
      mk('cb', svg.branchD.slice(Math.max(a, 1) - 1, b - 1).join(''));
      mk('cd', svg.dotD.slice(a, b).join(''));
    }
    colourRanges.current = next;
    redraw();
  }, [props.colouredClades, svg, tree]);

  useEffect(() => {
    const dt = dtRef.current;
    if (!dt) return;
    for (const i of prevHl.current) dt.children[i]?.classList.remove('hl');
    const now: number[] = [];
    for (const id of props.highlightedTips) {
      const i = tree.tipIndex(id);
      if (i >= 0) {
        now.push(i);
        dt.children[i]?.classList.add('hl');
      }
    }
    prevHl.current = now;
    redraw();
  }, [props.highlightedTips, svg, tree]);

  useEffect(() => {
    const fr = props.focusRequest;
    if (!fr) return;
    const i = tree.tipIndex(fr.tipId);
    if (i < 0) return;
    const { width: W, height: H } = latest.current.size;
    const v = viewRef.current;
    const fitv = fitRef.current;
    const g = geomRef.current;
    if (g.layout === 'rectangular') {
      v.ky = Math.max(v.ky, 24); // readable rows with sibling context (about H/24 rows visible)
      v.ty = H / 2 - g.Y[i] * v.ky;
      const sx = v.tx + g.X[i] * v.kx;
      if (sx < 20 || sx > W - LABEL_W) v.tx = fitv.tx;
    } else {
      const k = Math.max(v.kx, fitv.kx * 12);
      v.kx = v.ky = k;
      v.tx = W / 2 - g.X[i] * k;
      v.ty = H / 2 - g.Y[i] * k;
    }
    applyView();
  }, [props.focusRequest]);

  // ---------------------------------------------------------------- overlay (visible rows only)
  const v = viewRef.current;
  const over: React.ReactNode[] = [];
  const hlSet = new Set(props.highlightedTips);
  const colourOf = (node: number): string | undefined => {
    let c: string | undefined;
    for (const r of colourRanges.current) if (node >= r.a && node < r.b) c = r.colour;
    return c;
  };
  const label = (rank: number, left: number, top: number, h: number) => {
    const text = tree.tipLabels[rank];
    const hl = hlSet.has(text);
    const style: React.CSSProperties = { left, top, height: h, lineHeight: h + 'px', fontSize: Math.min(13, Math.max(8, h * 0.75)), color: colourOf(tree.tipNode[rank]) };
    const common = { 'data-tip-label': text, ...(FAULT === 'link' ? {} : { 'data-tip-id': text }), className: 'lab' + (hl ? ' hl' : '') + (layout === 'radial' ? ' rad' : ''), style, ...(FAULT === 'keyboard' ? {} : { tabIndex: 0 }) };
    const onKey = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') fire(tree.tipNode[rank], 'label', 'click');
    };
    if (tipLinks) {
      return (
        <a key={rank} {...common} href={tipLinks(text)} target="_blank" rel="noopener noreferrer" onKeyDown={onKey}>
          {text}
        </a>
      );
    }
    return (
      <span key={rank} {...common} role="treeitem" aria-label={text} onKeyDown={onKey}>
        {text}
      </span>
    );
  };
  const H = size.height;
  if (layout === 'rectangular') {
    for (const id of props.highlightedTips) {
      const i = tree.tipIndex(id);
      if (i < 0) continue;
      const y = v.ty + tree.tipRank[i] * v.ky;
      if (y + v.ky >= 0 && y <= H) over.push(<div key={'b' + i} className="band" style={{ top: y, height: Math.max(3, v.ky) }} />);
    }
    if (v.ky >= 9) {
      const r0 = Math.max(0, Math.floor(-v.ty / v.ky));
      const r1 = Math.min(tree.tipCount - 1, Math.ceil((H - v.ty) / v.ky));
      for (let r = r0; r <= r1; r++) over.push(label(r, v.tx + geom.X[tree.tipNode[r]] * v.kx + 10, v.ty + r * v.ky, v.ky));
    }
  } else {
    for (const id of props.highlightedTips) {
      const i = tree.tipIndex(id);
      if (i < 0) continue;
      const p = nodeScreen(i);
      if (inside(p.x, p.y, -20)) over.push(<div key={'g' + i} className="ring" style={{ left: p.x, top: p.y }} />);
    }
    const arc = (2 * Math.PI * SPAN * v.kx) / Math.max(1, tree.tipCount);
    if (arc >= 9) {
      let shown = 0;
      for (let r = 0; r < tree.tipCount && shown < 1500; r++) {
        const p = nodeScreen(tree.tipNode[r]);
        if (inside(p.x, p.y, 0)) {
          over.push(label(r, p.x + 8, p.y - 7, 14));
          shown++;
        }
      }
    }
  }

  return (
    <div
      ref={rootRef}
      className={'sp-root' + (dragging ? ' sp-dragging' : '') + (props.features.internalMarkers === false ? ' sp-noint' : '') + (props.features.branchWidth === 'thick' ? ' sp-thick' : '')}
      style={themeVars(theme)}
      role="tree"
      aria-label={`Phylogenetic tree, ${tree.tipCount} tips (stub renderer)`}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onMouseOver={onOver}
      onMouseLeave={() => (hover.current = '')}
    >
      <style>{CSS}</style>
      <svg className="sp-svg" aria-hidden="true" focusable="false">
        <g ref={gRef}>
          <g dangerouslySetInnerHTML={{ __html: svg.visible }} />
          <g ref={clRef} />
          <g ref={brRef} dangerouslySetInnerHTML={{ __html: svg.hitBranches }} />
          <g ref={dtRef} dangerouslySetInnerHTML={{ __html: svg.hitDots }} />
        </g>
      </svg>
      <canvas ref={canvasRef} className="sp-cols" aria-hidden="true" />
      <div className="sp-over">{over}</div>
    </div>
  );
}

const capabilities: CapabilityReport = {
  tipClick: { level: 'yes', how: 'delegated click on the tip dot or label' },
  internalNodeClick: { level: 'yes', how: 'click on a node dot' },
  branchClick: { level: 'yes', how: 'click on a branch path; reported as branchClick with the clade below it' },
  hover: { level: 'yes', how: 'mouseover on dots/branches/labels gives tipHover / nodeHover' },
  descendantTipsInPayload: { level: 'yes', how: 'every event carries the descendant tips (from the shared TreeModel inside the renderer; source is reported as library because the stub renderer is the library)' },
  cladeColouring: { level: 'yes', how: 'imperative stroke on the existing paths of the subtree range; no redraw, no layout change' },
  highlightTip: { level: 'yes', how: 'class on the tip dot plus a row band and a ring' },
  focusTip: { level: 'yes', how: 'sets row height to at least 24 px and centres the tip row; instant, no animation' },
  tipAsLink: { level: 'partial', how: 'real <a href data-tip-id target=_blank> but only for rows that are rendered (rows >= 9 px); other tips have no DOM node' },
  customColumns: { level: 'yes', how: 'bar, text and alignment columns drawn on one canvas for visible rows' },
  alignmentColumn: { level: 'yes', how: 'coloured residue runs on the columns canvas' },
  radialLayout: { level: 'yes', how: 'polar coordinates, arcs; columns are not drawn in radial layout' },
  branchLengthToggle: { level: 'yes', how: 'phylogram (cumulative length) versus cladogram (tips aligned); negative lengths clamped to 0' },
  scaleBar: { level: 'no', how: 'no scale bar or time axis' },
  darkTheme: { level: 'yes', how: 'gbifDarkTheme() values (derived from tokens; GBIF has no dark set) as CSS custom properties on the root element' },
  cssTokens: { level: 'yes', how: 'defaults come from gbifTheme() (GBIF tokens); background, foreground, branch, highlight, fontFamily override the --sp-* custom properties' },
  multipleInstances: { level: 'yes', how: 'no module state; two instances were tested via window.__spike2' },
  cleanUnmount: { level: 'yes', how: 'React unmount removes the DOM; rAF cancelled; no global listeners except window pointer listeners removed on pointerup' },
  controlledState: { level: 'yes', how: 'colour, highlight, focus, layout, lengths, columns, theme, links are props of the View' },
  zoomToFit: { level: 'partial', how: 'fits on mount and layout change; no API to refit; wheel zoom-out is limited to 0.3x of the fit' },
  overviewOrMinimap: { level: 'no', how: 'none; every node is drawn at all zoom levels (no level of detail)' },
};

export const adapter: CandidateAdapter = {
  candidate: { name: 'stub', version: '0.1.0', license: 'Apache-2.0', notes: 'Naive SVG reference renderer written for the harness; not a real candidate.' },
  capabilities,
  View: StubView,
  // demo "Library options" card: candidate-specific controls (the stub's own, to show how features work)
  features: [
    { id: 'internalMarkers', label: 'Show internal node markers', kind: 'toggle', default: true, description: 'Dots on internal nodes (the click targets for clades).' },
    { id: 'branchWidth', label: 'Branch width', kind: 'select', default: 'thin', options: [{ value: 'thin', label: 'Thin' }, { value: 'thick', label: 'Thick' }] },
    { id: 'ladderize', label: 'Ladderize (not implemented in the stub)', kind: 'toggle', default: false, level: 'no', how: 'The stub draws the tree in file order; an example of a feature a library may lack.' },
  ],
};
