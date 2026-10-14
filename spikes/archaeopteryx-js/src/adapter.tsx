// Archaeopteryx.js 3.24.0 adapter.
//
// How a gbif.org developer would use it: a React component that launches the viewer imperatively into a ref'd
// <div> inside an effect, destroys it on unmount, and wires what little the library reports back into React
// state. Archaeopteryx is a full viewer APPLICATION (control panel, node menu, overview, tooltips) and not a
// component, so most of this file is about what can honestly be built on its three outbound signals:
//   * config.onViewChange(state, encoded)            -> React state (view hash)
//   * document 'selected_nodes_changed_event'        -> payload-less; read with viewer.getSelectedNodes()
//   * viewer.ready                                    -> onReady
// There is NO node click / hover callback. Everything below that looks like one is a WORKAROUND, labelled
// `source: 'adapter-derived'` and described in `capabilities`:
//   * click / hover      : a capture-phase DOM listener on the container, mapped to a library node through the
//                          d3 datum (`g.node.__data__`, the same lookup the library itself does) or, for nodes
//                          without a label element, by the node's layout coordinates (d.x, d.y: undocumented
//                          fields) and the SVG group's screen CTM (rectangular layout only).
//   * clade colouring    : set the phyloXML `color` field on the library's own node objects (the library draws
//                          from the live tree object) and force a redraw with applyViewState({}).
//   * highlight / focus  : search box A through applyViewState({searchA}); focus additionally sends the
//                          library's documented Ctrl+Shift+E (expand) and Ctrl+G (next hit: centres it) keys to
//                          document.
//   * columns            : forester.joinMetadataTable() (documented) for bar/text, `mol_seq` on tip nodes for
//                          alignments; the library's heat map and alignment tracks draw them. Changing columns
//                          needs a relaunch (view state is carried over).
//   * dark theme         : click the library's own theme button (the choice is stored by the library in
//                          localStorage 'aptx-panel-theme').
//   * tip links          : an HTML <a> overlay over the visible tip labels (the library draws SVG <text>).

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AdapterFeature, CandidateAdapter, CapabilityReport, ColumnSpec, EmitEvent, Point, Rect, ViewHandle, ViewProps } from '../../shared/types.ts';
import type { TreeModel } from '../../shared/tree.ts';
import { gbifTheme, gbifDarkTheme } from '../../shared/gbif-theme.ts';
import { archaeopteryx, forester } from './aptx.ts';

// ---------------------------------------------------------------------------------------------- library types
// The tree object is the phyloXML model the library draws from. x/y/collapsed/color are fields the library
// reads or writes on it (x, y, collapsed are undocumented; color is the phyloXML branch colour).
interface LNode {
  name?: string;
  children?: LNode[];
  parent?: LNode;
  x?: number;
  y?: number;
  collapsed?: boolean;
  color?: { red: number; green: number; blue: number };
  sequences?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}
interface ViewerHandle {
  getSelectedNodes(): LNode[];
  ready: Promise<void>;
  getViewState(): Record<string, unknown>;
  applyViewState(s: Record<string, unknown>): void;
  destroy(): void;
}

const LIB_VERSION = '3.24.0';
const LAYOUT_TO_LIB = { rectangular: 'rectangular', radial: 'circular' } as const;
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;
const MAX_LINKS = 400;

const CSS = `
.aptx-host{position:relative;width:100%;height:100%;overflow:hidden;background:var(--ax-bg);color:var(--ax-fg)}
.aptx-lib{position:absolute;inset:0}
/* --- tree: only default-coloured things are overridden, so clade colours and search colours survive --- */
.aptx-host svg rect.basebackground{fill:var(--ax-bg)!important}
.aptx-host svg g.aptx-branches path[stroke^="#"]{stroke:var(--ax-branch)!important}
.aptx-host svg text.extlabel{font-family:var(--ax-font)!important;font-style:italic}
.aptx-host svg text.extlabel[style*="fill: rgb(32, 32, 32)"],.aptx-host svg text.extlabel[style*="fill: rgb(231, 238, 245)"]{fill:var(--ax-fg)!important}
.aptx-host svg text.extlabel[style*="fill: rgb(0, 114, 178)"],.aptx-host svg text.extlabel[style*="fill: rgb(86, 180, 233)"]{fill:var(--ax-hl)!important;stroke:color-mix(in srgb,var(--ax-hl) 55%,black)!important}
.aptx-host svg g.aptx-halos circle,.aptx-host svg g.aptx-node-outlined circle{fill:var(--ax-hl)!important}
.aptx-host svg g.aptx-node-outlined circle{stroke:color-mix(in srgb,var(--ax-hl) 55%,black)!important}
/* --- control panel: it is built on CSS custom properties, so the palette can be re-pointed at GBIF tokens --- */
.aptx-host .aptx-panel:not(.aptx-dark){--p-accent:var(--color-primary)!important;--p-accent-ink:var(--color-primary-hover)!important;--p-ink:var(--fg1)!important;--p-muted:var(--fg3)!important;--p-bg:color-mix(in srgb,var(--bg1) 88%,transparent)!important;--p-line:var(--border-default)!important;--p-surface2:var(--bg2)!important;font-family:var(--font-body)!important}
.aptx-node-menu:not(.aptx-dark){--p-accent:var(--color-primary)!important;--p-accent-ink:var(--color-primary-hover)!important;--p-ink:var(--fg1)!important;font-family:var(--font-body)!important}
/* backdrop blur is cheap with a GPU but made frames 150-250 ms in software compositing while a node menu was open */
.aptx-host .aptx-panel,.aptx-node-menu,.aptx-suggest,.aptx-dialog,.aptx-msa-nav,.aptx-tip{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
/* --- tip links overlay --- */
.aptx-links{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.aptx-links a{position:absolute;pointer-events:auto;display:block;background:transparent;color:transparent;overflow:hidden;white-space:nowrap;outline-offset:1px;text-decoration:none}
.aptx-links a:hover{background:color-mix(in srgb,var(--ax-hl) 14%,transparent)}
.aptx-links a:focus-visible{outline:2px solid var(--ax-hl);background:color-mix(in srgb,var(--ax-hl) 14%,transparent)}
.aptx-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;

// ---------------------------------------------------------------------------------------------- helpers (iterative)

/** Preorder list of a library tree starting at `root` (the super-root), with parent indexes. Never recursive. */
function preorder(root: LNode): { nodes: LNode[]; parentIdx: Int32Array } {
  const nodes: LNode[] = [];
  const par: number[] = [];
  const stack: Array<[LNode, number]> = [[root, -1]];
  while (stack.length) {
    const [n, p] = stack.pop()!;
    const me = nodes.length;
    nodes.push(n);
    par.push(p);
    const ch = n.children;
    if (ch) for (let i = ch.length - 1; i >= 0; i--) stack.push([ch[i], me]);
  }
  return { nodes, parentIdx: Int32Array.from(par) };
}

interface Mapping {
  nodes: LNode[]; // preorder of the library tree incl. the super-root at 0
  libToShared: Map<LNode, number>;
  sharedToLib: Array<LNode | undefined>;
  tips: number;
  unmatchedTips: number;
  rankByName: Map<string, number>;
  byRange: Map<number, number>;
}

/**
 * Library node <-> shared node index. Tips are matched by label; internal nodes by the contiguous range of shared
 * tip ranks below them (robust to the library ladderizing or reordering children).
 */
function buildMapping(superRoot: LNode, model: TreeModel): Mapping {
  const { nodes, parentIdx } = preorder(superRoot);
  const T = model.tipCount;
  const rank = new Map<string, number>();
  for (let r = 0; r < T; r++) rank.set(model.tipLabels[r], r);
  const lo = new Int32Array(nodes.length).fill(0x7fffffff);
  const hi = new Int32Array(nodes.length).fill(-1);
  let tips = 0;
  let unmatched = 0;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (!n.children || n.children.length === 0) {
      tips++;
      const r = rank.get(n.name ?? '');
      if (r === undefined) unmatched++;
      else lo[i] = hi[i] = r;
    }
    const p = parentIdx[i];
    if (p >= 0) {
      if (lo[i] < lo[p]) lo[p] = lo[i];
      if (hi[i] > hi[p]) hi[p] = hi[i];
    }
  }
  const byRange = new Map<number, number>();
  for (let k = 0; k < model.nodeCount; k++) {
    const key = model.leafStart[k] * (T + 1) + model.leafEnd[k];
    if (!byRange.has(key)) byRange.set(key, k); // preorder: the shallowest node wins for unary chains
  }
  const libToShared = new Map<LNode, number>();
  const sharedToLib: Array<LNode | undefined> = new Array(model.nodeCount);
  for (let i = 1; i < nodes.length; i++) {
    if (hi[i] < 0) continue;
    const k = byRange.get(lo[i] * (T + 1) + (hi[i] + 1));
    if (k === undefined) continue;
    libToShared.set(nodes[i], k);
    if (!sharedToLib[k]) sharedToLib[k] = nodes[i];
  }
  return { nodes, libToShared, sharedToLib, tips, unmatchedTips: unmatched, rankByName: rank, byRange };
}

function hexToRgb(c: string): { red: number; green: number; blue: number } {
  const m = c.trim();
  if (m.startsWith('#')) {
    const h = m.length === 4 ? m.slice(1).replace(/./g, (x) => x + x) : m.slice(1, 7);
    return { red: parseInt(h.slice(0, 2), 16), green: parseInt(h.slice(2, 4), 16), blue: parseInt(h.slice(4, 6), 16) };
  }
  const r = m.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  return r ? { red: +r[1], green: +r[2], blue: +r[3] } : { red: 0, green: 0, blue: 0 };
}

function regexForTips(ids: string[]): string {
  return '^(?:' + ids.map((s) => s.replace(REGEX_SPECIALS, '\\$&')).join('|') + ')$';
}

const isDnaLike = (s: string) => /^[ACGTUNacgtun\-?.]*$/.test(s);

interface ColumnInfo {
  bars: string[]; // refs of numeric columns (heat-map columns), in joined (= document) order
  barIds: string[]; // ColumnSpec ids of the same columns
  texts: string[]; // refs of text columns
  hasAlignment: boolean;
  joinReport: string;
  mirrored?: boolean;
  refById: Record<string, string>;
}

/** Put the shared ColumnSpecs on the library tree: TSV through forester.joinMetadataTable, alignments as mol_seq. */
function attachColumns(ltree: LNode, cols: ColumnSpec[]): ColumnInfo {
  const info: ColumnInfo = { bars: [], barIds: [], texts: [], hasAlignment: false, joinReport: '', refById: {} };
  const tab = cols.filter((c) => c.kind !== 'alignment');
  // the library draws a heat map only from two or more numeric columns (HEATMAP_MIN_COLUMNS = 2: "one column is a
  // stripe, not a matrix"); a single bar column is therefore drawn next to a labelled mirror copy of itself
  const mirror = tab.filter((c) => c.kind === 'bar').length === 1 ? tab.find((c) => c.kind === 'bar')! : null;
  if (tab.length) {
    const tips = new Set<string>();
    for (const c of tab) for (const k in c.values) tips.add(k);
    const esc = (s: string) => String(s).replace(/[\t\r\n]+/g, ' ');
    const send = mirror ? [...tab, { ...mirror, id: mirror.id + '~copy', header: mirror.header + ' (copy)' }] : tab;
    const lines = ['tip\t' + send.map((c) => esc(c.header)).join('\t')];
    for (const t of tips) lines.push(esc(t) + '\t' + send.map((c) => (c.values[t] === undefined ? '' : esc(String(c.values[t])))).join('\t'));
    const rep = forester.joinMetadataTable(ltree, lines.join('\n'));
    info.joinReport = `${rep.matchedTips}/${rep.tips} tips matched, ${rep.unmatchedRows.length} rows without a tip, ${rep.unmatchedTips.length} tips without a row`;
    const refs = rep.columns;
    send.forEach((c, i) => {
      const r = refs[i];
      if (!r) return;
      info.refById[c.id] = r.ref;
      if (c.kind === 'bar') {
        info.bars.push(r.ref);
        if (!c.id.endsWith('~copy')) info.barIds.push(c.id);
      } else info.texts.push(r.ref);
    });
    info.mirrored = !!mirror;
  }
  const aln = cols.find((c) => c.kind === 'alignment');
  if (aln) {
    const { nodes } = preorder(ltree);
    const byName = new Map<string, LNode>();
    for (const n of nodes) if (!n.children?.length && n.name) byName.set(n.name, n);
    let any = false;
    for (const [tip, seq] of Object.entries(aln.values)) {
      const n = byName.get(tip);
      if (!n) continue;
      const s = String(seq);
      n.sequences = [{ type: isDnaLike(s) ? 'dna' : 'protein', mol_seq: { is_aligned: true, value: s } }];
      any = true;
    }
    info.hasAlignment = any;
  }
  return info;
}

// ---------------------------------------------------------------------------------------------- the View

interface Live {
  viewer: ViewerHandle | null;
  ltree: LNode | null;
  map: Mapping | null;
  colInfo: ColumnInfo;
  seq: number;
  firstDone: boolean;
}

function themeVars(t: ViewProps['theme']): React.CSSProperties {
  const g = t.dark ? gbifDarkTheme() : gbifTheme();
  const k = t.tokens ?? {};
  return {
    '--ax-bg': k.background ?? g.bg1,
    '--ax-fg': k.foreground ?? g.fg1,
    '--ax-branch': k.branch ?? (t.dark ? g.fg3 : g.fg2),
    '--ax-hl': k.highlight ?? g.primary,
    '--ax-font': k.fontFamily ?? g.fontBody,
  } as React.CSSProperties;
}

function AptxView(props: ViewProps) {
  const { tree, features: f } = props;
  const hostRef = useRef<HTMLDivElement>(null); // the library's own container (it owns everything inside)
  const linksRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const live = useRef<Live>({ viewer: null, ltree: null, map: null, colInfo: { bars: [], barIds: [], texts: [], hasAlignment: false, joinReport: '', refById: {} }, seq: 0, firstDone: false });
  const [viewHash, setViewHash] = useState('');
  const [launches, setLaunches] = useState(0);
  const lastHover = useRef<number>(-1);
  const lastClickAt = useRef(0);
  const prevSelection = useRef<Set<LNode>>(new Set());
  const colouredRef = useRef<LNode[]>([]);

  // ------------------------------------------------------------------------ geometry helpers
  const svgEl = (): SVGSVGElement | null => (hostRef.current?.querySelector('rect.basebackground')?.parentElement as SVGSVGElement | null) ?? null;
  const groupEl = (): SVGGElement | null => {
    const s = svgEl();
    if (!s) return null;
    for (const c of Array.from(s.children)) if (c.tagName === 'g' && !c.classList.contains('aptx-float') && !c.classList.contains('aptx-overview')) return c as SVGGElement;
    return null;
  };
  const layoutKind = (): string => String(live.current.viewer?.getViewState().layout ?? 'rectangular');
  const isRect = () => layoutKind() === 'rectangular';
  const toScreen = (gx: number, gy: number): Point | null => {
    const g = groupEl();
    const m = g?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(gx, gy).matrixTransform(m);
    return { x: p.x, y: p.y };
  };
  /** label elements by library node (g.node carries the d3 datum) */
  const labelEls = (): Map<LNode, SVGGElement> => {
    const m = new Map<LNode, SVGGElement>();
    const s = svgEl();
    if (!s) return m;
    s.querySelectorAll<SVGGElement>('g.node').forEach((el) => {
      const d = (el as unknown as { __data__?: LNode }).__data__;
      if (d) m.set(d, el);
    });
    return m;
  };
  const displayed = (n: LNode): boolean => {
    for (let p = n.parent; p; p = p.parent) if (p.collapsed === true) return false;
    return true;
  };
  /**
   * Node position in the SVG group's coordinates for the current layout, or null.
   *  rectangular: [d.y, d.x] (the library's own layoutPointXY).
   *  unrooted: [d.ux, d.uy].
   *  circular: the library keeps its polar parameters private, so they are re-derived from the labelled nodes
   *  (their g.node transform is their position): radius = c * d.y and angle = A * d.x + phi, fitted by least
   *  squares with the angles unwrapped in d.x order. Accurate to a fraction of a pixel on the tested trees.
   */
  const positioner = (): ((n: LNode) => [number, number] | null) | null => {
    const kind = layoutKind();
    if (kind === 'rectangular') return (n) => (typeof n.x === 'number' && typeof n.y === 'number' ? [n.y, n.x] : null);
    if (kind === 'unrooted') return (n) => (typeof n.ux === 'number' && typeof n.uy === 'number' ? [n.ux as number, n.uy as number] : null);
    const pts: Array<{ x: number; y: number; gx: number; gy: number }> = [];
    for (const [d, el] of labelEls()) {
      const m = /translate\(\s*([-\d.e+]+)[ ,]+([-\d.e+]+)\s*\)/.exec(el.getAttribute('transform') ?? '');
      if (!m || typeof d.x !== 'number' || typeof d.y !== 'number' || d.y <= 0) continue;
      pts.push({ x: d.x, y: d.y, gx: +m[1], gy: +m[2] });
    }
    if (pts.length < 2) return null;
    let sry = 0;
    let syy = 0;
    for (const q of pts) {
      sry += Math.hypot(q.gx, q.gy) * q.y;
      syy += q.y * q.y;
    }
    const c = sry / syy;
    pts.sort((u, v) => u.x - v.x);
    const th: number[] = [];
    for (const q of pts) {
      let t = Math.atan2(q.gy, q.gx) + Math.PI / 2;
      if (th.length) while (t < th[th.length - 1] - 1e-9) t += 2 * Math.PI;
      th.push(t);
    }
    const nn = pts.length;
    let sx = 0, st = 0, sxx = 0, sxt = 0;
    pts.forEach((q, i) => {
      sx += q.x;
      st += th[i];
      sxx += q.x * q.x;
      sxt += q.x * th[i];
    });
    const den = nn * sxx - sx * sx;
    if (Math.abs(den) < 1e-9) return null;
    const A = (nn * sxt - sx * st) / den;
    const phi = (st - A * sx) / nn;
    return (n) => {
      if (typeof n.x !== 'number' || typeof n.y !== 'number') return null;
      const a = A * n.x + phi - Math.PI / 2;
      return [c * n.y * Math.cos(a), c * n.y * Math.sin(a)];
    };
  };
  /** screen position of a library node, or null when it has none we can read */
  const nodePoint = (n: LNode, pos?: ReturnType<typeof positioner>): Point | null => {
    if (!displayed(n)) return null;
    const f = pos === undefined ? positioner() : pos;
    const g = f ? f(n) : null;
    return g ? toScreen(g[0], g[1]) : null;
  };
  const visibleAt = (p: Point): boolean => {
    const s = svgEl();
    if (!s) return false;
    const r = s.getBoundingClientRect();
    if (p.x < r.left + 1 || p.y < r.top + 1 || p.x > r.right - 1 || p.y > r.bottom - 1) return false;
    const hit = document.elementFromPoint(p.x, p.y);
    if (!hit || !hostRef.current?.contains(hit)) return false;
    return !hit.closest('.aptx-panel, .aptx-overview, .aptx-links a, dialog');
  };

  // ------------------------------------------------------------------------ node picking (click / hover workaround)
  const pick = (e: MouseEvent): LNode | null => {
    const t = e.target as Element | null;
    const g = t?.closest?.('g.node') as (SVGGElement & { __data__?: LNode }) | null;
    if (g?.__data__ && live.current.map?.libToShared.has(g.__data__)) return g.__data__;
    const grp = groupEl();
    const m = grp?.getScreenCTM();
    const map = live.current.map;
    const pos = positioner();
    if (!grp || !m || !map || !pos) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    let best: LNode | null = null;
    let bd = 25; // squared group units: the library's own hit radius is 5
    const root = live.current.ltree!;
    const stack: LNode[] = [root];
    while (stack.length) {
      const n = stack.pop()!;
      if (n !== root && map.libToShared.has(n)) {
        const q = pos(n);
        if (q) {
          const dx = q[0] - p.x;
          const dy = q[1] - p.y;
          const d = dx * dx + dy * dy;
          if (d < bd) {
            bd = d;
            best = n;
          }
        }
      }
      if (n.collapsed !== true && n.children) for (const c of n.children) stack.push(c);
    }
    return best;
  };
  /**
   * Shared node index for a library node, derived from the node's CURRENT descendant tips (so it stays right after
   * the library's node menu has swapped, ladderized or collapsed things); undefined when the tips under it are no
   * longer a clade of the shared tree (for example after the menu's Reroot): then no event is reported.
   */
  const resolve = (n: LNode): number | undefined => {
    const m = live.current.map;
    if (!m) return undefined;
    const T = tree.tipCount;
    let lo = Infinity;
    let hi = -1;
    let cnt = 0;
    const stack: LNode[] = [n];
    while (stack.length) {
      const x = stack.pop()!;
      if (x.children?.length) {
        for (const c of x.children) stack.push(c);
        continue;
      }
      const r = m.rankByName.get(x.name ?? '');
      if (r === undefined) return undefined;
      cnt++;
      if (r < lo) lo = r;
      if (r > hi) hi = r;
    }
    if (cnt === 0 || hi - lo + 1 !== cnt) return undefined;
    if (cnt === 1) return tree.tipNode[lo];
    return m.byRange.get(lo * (T + 1) + hi + 1);
  };
  const eventFor = (n: LNode, type: 'click' | 'hover', via: string): EmitEvent | null => {
    const k = resolve(n);
    if (k === undefined) return null;
    const isTip = tree.childCount[k] === 0;
    return {
      type: type === 'click' ? (isTip ? 'tipClick' : 'nodeClick') : isTip ? 'tipHover' : 'nodeHover',
      nodeId: tree.nodeId(k),
      isTip,
      tipIds: tree.descendantTips(k),
      source: 'adapter-derived',
      libraryPayload: { via, libraryNodeName: n.name ?? null, libraryNodeId: (n as { id?: number }).id ?? null },
    };
  };

  // ------------------------------------------------------------------------ launch / relaunch
  const buildView = (prev: Record<string, unknown> | null): Record<string, unknown> => {
    const p = latest.current;
    const fx = p.features;
    const show = new Set<string>(['name', 'external', 'visualStyles']);
    if (fx.shortNames === true) show.add('shortNames');
    if (fx.autoHide !== false) show.add('autoHide');
    if (fx.metadataLabels !== false && live.current.colInfo.texts.length) show.add('properties');
    const v: Record<string, unknown> = { ...(prev ?? {}) };
    delete v.msa;
    delete v.heatmap;
    v.layout = LAYOUT_TO_LIB[p.layout];
    v.display = p.branchLengths ? 'phylogram' : 'cladogram';
    v.colorBy = fx.colourBy === 'column' && live.current.colInfo.texts.length ? 'prop:' + live.current.colInfo.texts[0] : 'none';
    v.show = Array.from(show);
    const ci = live.current.colInfo;
    v.msa = fx.alignmentTrack !== false && ci.hasAlignment;
    v.msaLogo = fx.alignmentLogo === true;
    v.heatmap = fx.heatmapTrack !== false && ci.bars.length >= 2;
    v.heatmapOrder = 'document'; // keep our column order (the library's default clusters the columns)
    v.scaleAxis = fx.scaleAxis === true;
    if (fx.branchWidth === '2' || fx.branchWidth === '3') v.branch = Number(fx.branchWidth);
    else if (prev) v.branch = tree.tipCount > 50 ? 1 : 2; // back to the library's own default
    return v;
  };

  const doLaunch = () => {
    const L = live.current;
    const p = latest.current;
    const fx = p.features;
    const host = hostRef.current!;
    const seq = ++L.seq;
    let prev: Record<string, unknown> | null = null;
    if (L.viewer) {
      try {
        prev = L.viewer.getViewState();
      } catch {
        prev = null;
      }
      L.viewer.destroy();
      L.viewer = null;
    }
    host.replaceChildren();
    const t0 = performance.now();
    const ltree = archaeopteryx.parseTree('tree.nwk', p.newick) as LNode;
    const parseMs = performance.now() - t0;
    L.ltree = ltree;
    L.colInfo = attachColumns(ltree, p.columns);
    L.map = buildMapping(ltree, tree);
    colouredRef.current = [];
    prevSelection.current = new Set();
    try {
      localStorage.setItem('aptx-panel-theme', p.theme.dark ? 'dark' : 'light');
    } catch {
      /* private mode: the library then follows the OS preference */
    }
    const showPanel = fx.showPanel === true;
    const ci = L.colInfo;
    const config: Record<string, unknown> = {
      // --- hide features (official config) ---
      collapseControlPanel: !showPanel,
      panelDensity: showPanel ? 'comfortable' : 'compact',
      enableDownloads: showPanel,
      enableSubtreeDeletion: false,
      enableAccessToDatabases: false,
      enableManualNodeSelection: fx.selectionMode === true,
      enableVisualizations: true,
      rootOffset: showPanel ? 254 : 36,
      ladderizeTree: fx.ladderize === true,
      showSupportDots: false,
      heatmapColumnOrder: 'document',
      onViewChange: (_s: unknown, enc: string) => setViewHash(enc),
      view: buildView(prev),
    };
    if (ci.texts.length && fx.metadataLabels !== false) config.labelProperties = ci.texts;
    const viewer = archaeopteryx.launch(host, ltree as never, config) as unknown as ViewerHandle;
    L.viewer = viewer;
    (window as unknown as { __aptx?: unknown }).__aptx = { viewer, ltree }; // debug aid for probing from the console
    const done = () => {
      if (seq !== L.seq) return;
      // re-apply React state that lives in the library's tree objects
      setLaunches((n) => n + 1);
      if (!L.firstDone) {
        L.firstDone = true;
        const rep = ci.joinReport ? `; metadata join: ${ci.joinReport}` : '';
        p.onReady({
          parseMs,
          tips: L.map!.tips,
          notes: `parseTree ${parseMs.toFixed(1)} ms (Newick->phyloXML model, inside Archaeopteryx), launch() then draws on the next frame from 5,000 nodes (viewer.ready); unmatched library tips ${L.map!.unmatchedTips}${rep}`,
        });
      }
    };
    void viewer.ready.then(done, (err) => {
      throw err;
    });
  };

  const relaunchKey = [f.showPanel === true, f.selectionMode === true, f.ladderize === true].join('|');
  useEffect(() => {
    doLaunch();
    return () => {
      const L = live.current;
      L.seq++;
      try {
        L.viewer?.destroy();
      } catch {
        /* already destroyed */
      }
      L.viewer = null;
      L.map = null;
      hostRef.current?.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relaunchKey, props.columns]);

  // ------------------------------------------------------------------------ props -> library
  // applyViewState() resets collapsed clades, subtree and zoom unless they are in the state it is given (it ends in
  // zoomToFit()), so every change goes through the current state merged with the patch.
  const apply = (patch: Record<string, unknown>) => {
    const v = live.current.viewer;
    if (!v) return;
    v.applyViewState({ ...v.getViewState(), ...patch });
  };
  const key = (k: string, o: { shift?: boolean; ctrl?: boolean; code?: number } = {}) => {
    const e = new KeyboardEvent('keydown', { key: k, ctrlKey: o.ctrl !== false && o.code === undefined, shiftKey: o.shift === true, bubbles: true, cancelable: true });
    if (o.code !== undefined) Object.defineProperty(e, 'keyCode', { get: () => o.code });
    document.dispatchEvent(e);
  };
  // redraw without touching zoom/pan/collapse: the documented PageUp / PageDown font-size keys, one up and one
  // down, coalesce into a single redraw at the unchanged size (the library has no redraw() method)
  const redraw = () => {
    const v = live.current.viewer;
    if (!v) return;
    const before = v.getViewState().font;
    key('PageUp', { code: 33 });
    if (v.getViewState().font === before) {
      key('PageDown', { code: 34 });
      key('PageUp', { code: 33 });
    } else key('PageDown', { code: 34 });
  };

  useEffect(() => {
    if (!launches) return;
    const v = live.current.viewer;
    if (!v) return;
    const st = v.getViewState();
    const want = LAYOUT_TO_LIB[props.layout];
    if (st.layout !== want) apply({ layout: want });
  }, [props.layout, launches]);
  useEffect(() => {
    if (!launches) return;
    const st = live.current.viewer?.getViewState();
    const want = props.branchLengths ? 'phylogram' : 'cladogram';
    if (st && st.display !== want) apply({ display: want });
  }, [props.branchLengths, launches]);
  useEffect(() => {
    if (!launches) return;
    const show = new Set<string>(((live.current.viewer?.getViewState().show as string[]) ?? []));
    f.shortNames === true ? show.add('shortNames') : show.delete('shortNames');
    f.autoHide !== false ? show.add('autoHide') : show.delete('autoHide');
    apply({
      show: Array.from(show),
      msa: f.alignmentTrack !== false && live.current.colInfo.hasAlignment,
      msaLogo: f.alignmentLogo === true,
      heatmap: f.heatmapTrack !== false && live.current.colInfo.bars.length >= 2,
      scaleAxis: f.scaleAxis === true,
      colorBy: f.colourBy === 'column' && live.current.colInfo.texts.length ? 'prop:' + live.current.colInfo.texts[0] : 'none',
      branch: f.branchWidth === '2' || f.branchWidth === '3' ? Number(f.branchWidth) : tree.tipCount > 50 ? 1 : 2,
    });
  }, [f.shortNames, f.autoHide, f.alignmentTrack, f.alignmentLogo, f.heatmapTrack, f.scaleAxis, f.colourBy, f.branchWidth, launches]);

  // clade colours: the library draws from live node objects, so set `color` and force a redraw
  useEffect(() => {
    const L = live.current;
    if (!launches || !L.map || !L.viewer) return;
    for (const n of colouredRef.current) delete n.color;
    const touched: LNode[] = [];
    for (const c of props.colouredClades) {
      const k = tree.nodeIndex(c.nodeId);
      const root = L.map.sharedToLib[k];
      if (!root) continue;
      const rgb = hexToRgb(c.colour);
      const stack: LNode[] = [root];
      while (stack.length) {
        const n = stack.pop()!;
        n.color = { ...rgb };
        touched.push(n);
        if (n.children) for (const ch of n.children) stack.push(ch);
      }
    }
    colouredRef.current = touched;
    redraw();
  }, [props.colouredClades, launches]);

  // highlight: search box A (regex on the node name), up to the shell's 200 tips
  const searchFor = (ids: string[]): Record<string, unknown> | undefined => (ids.length ? { field: 'Node Name', mode: 'regex', value: regexForTips(ids) } : undefined);
  useEffect(() => {
    if (!launches) return;
    apply({ searchA: searchFor(props.highlightedTips) });
  }, [props.highlightedTips, launches]);

  // focus: search A = highlighted tips + this tip, then the library's own keys: "next search hit" (Ctrl+G, centres the
  // hit) until the wanted tip is the centred one, then vertical zoom-in steps (Ctrl+Shift+ArrowUp, x1.1 each; a burst
  // coalesces into ONE redraw and the library re-centres on the viewport centre). Every zoom step that makes rows
  // readable also draws a label element per tip (no culling), so above 12,000 tips the zoom stops at ~2 px rows.
  // As a side effect the focused tip stays highlighted: the library has no separate focus marker.
  const lastFocus = useRef(0);
  useEffect(() => {
    const fr = props.focusRequest;
    if (!fr || !launches || fr.seq === lastFocus.current) return;
    lastFocus.current = fr.seq;
    const L = live.current;
    const v = L.viewer;
    const k = tree.tipIndex(fr.tipId);
    const target = k >= 0 ? L.map?.sharedToLib[k] : undefined;
    if (!v || !target) return;
    const ids = Array.from(new Set([...latest.current.highlightedTips, fr.tipId]));
    apply({ searchA: searchFor(ids) });
    const rect = v.getViewState().layout === 'rectangular';
    const s = svgEl();
    const centred = () => {
      if (!s) return false;
      const p = nodePoint(target);
      if (!p) return false;
      const r = s.getBoundingClientRect();
      return Math.abs(p.y - (r.top + r.height / 2)) < 3 && (rect || Math.abs(p.x - (r.left + r.width / 2)) < 3);
    };
    const centre = () => {
      for (let i = 0; i < ids.length + 1; i++) {
        key('g');
        if (centred()) break;
      }
    };
    if (rect) {
      centre();
      // row pitch of the current layout, from the tips' own coordinates
      let mn = Infinity;
      let mx = -Infinity;
      let nt = 0;
      const stack: LNode[] = [L.ltree!];
      while (stack.length) {
        const n = stack.pop()!;
        if (n.children?.length) for (const c of n.children) stack.push(c);
        else if (typeof n.x === 'number') {
          nt++;
          if (n.x < mn) mn = n.x;
          if (n.x > mx) mx = n.x;
        }
      }
      const pitch = (mx - mn) / Math.max(1, nt - 1);
      const want = tree.tipCount <= 12000 ? 16 : 2;
      const steps = pitch > 0 && pitch < want ? Math.ceil(Math.log(want / pitch) / Math.log(1.1)) : 0;
      for (let i = 0; i < steps; i++) key('ArrowUp', { shift: true });
    } else {
      // circular: a zoom grows the layout around the circle's centre and does not follow the viewport, so zoom
      // first, let the library's rAF redraw run, then centre the hit
      for (let i = 0; i < 7; i++) key('=');
      requestAnimationFrame(() => requestAnimationFrame(centre));
    }
  }, [props.focusRequest, launches]);

  // theme: CSS custom properties for the overrides; the library's own light/dark switch for its colours
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !launches) return;
    const panel = host.querySelector('.aptx-panel');
    const dark = !!panel && (panel.classList.contains('aptx-dark') || (!panel.classList.contains('aptx-light') && window.matchMedia('(prefers-color-scheme: dark)').matches));
    if (dark !== props.theme.dark) (host.querySelector('.aptx-theme-btn') as HTMLElement | null)?.click();
  }, [props.theme.dark, launches]);

  // container size: the library only follows window resize events
  useEffect(() => {
    if (launches) window.dispatchEvent(new Event('resize'));
  }, [props.size.width, props.size.height]);

  // ------------------------------------------------------------------------ events: click / hover workaround, selection
  useEffect(() => {
    const host = hostRef.current!;
    const onClick = (e: MouseEvent) => {
      if (latest.current.features.selectionMode === true || latest.current.features.reportClicks === false) return;
      if ((e.target as Element).closest('.aptx-panel, .aptx-overview, .aptx-links a, .aptx-node-menu')) return;
      lastClickAt.current = performance.now();
      const n = pick(e);
      const ev = n && eventFor(n, 'click', 'DOM click on the container mapped to a node (d3 datum or layout coordinates)');
      if (ev) {
        lastHover.current = resolve(n!) ?? -1; // the click's own node is not "hovered" again
        latest.current.emit(ev);
      }
    };
    let moveTimer = 0;
    let lastMove: MouseEvent | null = null;
    const onMoveNow = () => {
      moveTimer = 0;
      const e = lastMove;
      if (!e || latest.current.features.reportClicks === false) return;
      const n = performance.now() - lastClickAt.current < 400 ? null : pick(e);
      if (performance.now() - lastClickAt.current < 400) return;
      const k = n ? resolve(n) ?? -1 : -1;
      if (k === lastHover.current) return;
      lastHover.current = k;
      const ev = n && eventFor(n, 'hover', 'DOM mousemove on the container mapped to a node');
      if (ev) latest.current.emit(ev);
    };
    const onMove = (e: MouseEvent) => {
      lastMove = e;
      if (!moveTimer) moveTimer = window.setTimeout(onMoveNow, 40); // hit test walks the whole tree: throttle
    };
    host.addEventListener('click', onClick, true);
    host.addEventListener('mousemove', onMove);
    return () => {
      if (moveTimer) clearTimeout(moveTimer);
      host.removeEventListener('click', onClick, true);
      host.removeEventListener('mousemove', onMove);
    };
  }, []);

  // the library's only generic outbound signal: payload-less selection event; read the selection afterwards
  useEffect(() => {
    if (f.selectionMode !== true) return;
    const handler = () => {
      const v = live.current.viewer;
      if (!v) return;
      const now = new Set(v.getSelectedNodes());
      const added = Array.from(now).filter((n) => !prevSelection.current.has(n));
      prevSelection.current = now;
      const via = "document 'selected_nodes_changed_event' + viewer.getSelectedNodes() (a selection, not a click)";
      const ks = added.map((n) => resolve(n)).filter((k): k is number => k !== undefined);
      if (ks.length > 1) {
        // the menu's "Select all external nodes" selects every tip of a clade at once: report the clade once when the
        // new selection is exactly its tips, otherwise one event per node
        const m = tree.mrcaOf(ks);
        const tips = new Set(tree.tipsOf(ks));
        if (tips.size === tree.tipCountOf(m)) {
          latest.current.emit({ type: tree.childCount[m] === 0 ? 'tipClick' : 'nodeClick', nodeId: tree.nodeId(m), isTip: tree.childCount[m] === 0, tipIds: tree.descendantTips(m), source: 'adapter-derived', libraryPayload: { via, selectedNodes: added.length, note: 'MRCA of the newly selected nodes; their tips are exactly its clade' } });
          return;
        }
      }
      for (const n of added) {
        const ev = eventFor(n, 'click', via);
        if (ev) latest.current.emit(ev);
      }
    };
        document.addEventListener('selected_nodes_changed_event', handler);
    return () => document.removeEventListener('selected_nodes_changed_event', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.selectionMode]);

  // ------------------------------------------------------------------------ tip links overlay
  useEffect(() => {
    const layer = linksRef.current;
    const host = hostRef.current;
    if (!layer || !host) return;
    layer.replaceChildren();
    if (!props.tipLinks || !launches) return;
    let raf = 0;
    const draw = () => {
      raf = 0;
      layer.replaceChildren();
      const hr = host.getBoundingClientRect();
      let n = 0;
      const els = svgEl()?.querySelectorAll<SVGGElement>('g.node text.extlabel') ?? [];
      for (const t of Array.from(els)) {
        const d = (t.parentNode as unknown as { __data__?: LNode }).__data__;
        if (!d || d.children?.length) continue;
        const r = t.getBoundingClientRect();
        if (r.bottom < hr.top || r.top > hr.bottom || r.right < hr.left || r.left > hr.right || r.width < 2) continue;
        const id = d.name ?? '';
        const a = document.createElement('a');
        a.href = props.tipLinks!(id);
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.setAttribute('data-tip-id', id);
        a.textContent = t.textContent;
        a.style.left = r.left - hr.left + 'px';
        a.style.top = r.top - hr.top + 'px';
        a.style.width = r.width + 'px';
        a.style.height = r.height + 'px';
        a.style.font = '11px sans-serif';
        layer.appendChild(a);
        if (++n >= MAX_LINKS) break;
      }
    };
    const sched = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const s = svgEl();
    const mo = new MutationObserver(sched);
    if (s) mo.observe(s, { subtree: true, childList: true, attributes: true, attributeFilter: ['transform'] });
    sched();
    return () => {
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
      layer.replaceChildren();
    };
  }, [props.tipLinks, launches]);

  // ------------------------------------------------------------------------ introspection handle
  const handle: ViewHandle = {
    locate(t) {
      const L = live.current;
      const k = t.kind === 'tip' ? tree.tipIndex(t.id) : tree.isNodeId(t.id) ? tree.nodeIndex(t.id) : -1;
      const n = k >= 0 ? L.map?.sharedToLib[k] : undefined;
      if (!n) return null;
      const p = nodePoint(n);
      return p && visibleAt(p) ? p : null;
    },
    bounds(t) {
      const L = live.current;
      const k = t.kind === 'tip' ? tree.tipIndex(t.id) : tree.isNodeId(t.id) ? tree.nodeIndex(t.id) : -1;
      const n = k >= 0 ? L.map?.sharedToLib[k] : undefined;
      const s = svgEl();
      if (!n || !s) return null;
      const sr = s.getBoundingClientRect();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const pos = positioner();
      const stack: LNode[] = [n];
      while (stack.length) {
        const c = stack.pop()!;
        const p = nodePoint(c, pos);
        if (p) {
          if (p.x < x0) x0 = p.x;
          if (p.x > x1) x1 = p.x;
          if (p.y < y0) y0 = p.y;
          if (p.y > y1) y1 = p.y;
        }
        if (c.collapsed !== true && c.children && t.kind === 'node') for (const ch of c.children) stack.push(ch);
      }
      if (!isFinite(x0)) return null;
      if (t.kind === 'tip') {
        x0 -= 4; x1 += 4; y0 -= 4; y1 += 4;
      }
      x0 = Math.max(sr.left, x0); y0 = Math.max(sr.top, y0); x1 = Math.min(sr.right, x1); y1 = Math.min(sr.bottom, y1);
      if (x1 - x0 < 1 || y1 - y0 < 1) return null;
      return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    },
    locateCell(colId, tipId) {
      return cellRect(hostRef.current, live.current, colId, tipId, props.columns, tree);
    },
    custom() {
      const s = svgEl();
      const L = live.current;
      return {
        libraryNodes: L.map ? L.map.nodes.length - 1 : 0,
        labelElements: s ? s.querySelectorAll('g.node').length : 0,
        branchPaths: s ? s.querySelectorAll('g.aptx-branches path').length : 0,
        launches,
      };
    },
  };
  useLayoutEffect(() => {
    props.handleRef.current = handle;
    return () => {
      props.handleRef.current = null;
    };
  });

  return (
    <div className="aptx-host" role="group" aria-label={`Phylogenetic tree, ${tree.tipCount} tips (Archaeopteryx.js)`} data-view={viewHash} style={themeVars(props.theme)}>
      <style>{CSS}</style>
      <div ref={hostRef} className="aptx-lib" />
      <div ref={linksRef} className="aptx-links" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- track cells
// The heat map and the alignment track are plain <rect>s in the tree's SVG group (g.aptx-heatmap, g.aptx-msa),
// in the same layout coordinates as the nodes (a tip's row is its `x`). Read from the DOM: undocumented structure.
function cellRect(host: HTMLElement | null, L: Live, colId: string, tipId: string, cols: ColumnSpec[], tree: TreeModel): Rect | null {
  const col = cols.find((c) => c.id === colId);
  const svg = host?.querySelector('rect.basebackground')?.parentElement;
  if (!col || !svg || !L.map) return null;
  // a tip without a value gets an outlined "not assessed" blank from the library: drawn, but not data, so no cell
  if (col.values[tipId] === undefined) return null;
  const k = tree.tipIndex(tipId);
  const n = k >= 0 ? L.map.sharedToLib[k] : undefined;
  if (!n || typeof n.x !== 'number') return null;
  const grp = Array.from(svg.children).find((c) => c.tagName === 'g' && !c.classList.contains('aptx-float') && !c.classList.contains('aptx-overview')) as SVGGElement | undefined;
  const m = grp?.getScreenCTM();
  if (!grp || !m) return null;
  const ny = n.x;
  const track = grp.querySelector(col.kind === 'alignment' ? ':scope > g.aptx-msa' : ':scope > g.aptx-heatmap');
  if (!track) return null;
  const rects = Array.from(track.children).filter((e) => e.tagName === 'rect' && e.getAttribute('fill') !== 'none') as SVGRectElement[];
  if (!rects.length) return null;
  // the row band of this tip: the rect row whose [y, y+h) holds it, else the nearest one within 1.5 layout px
  let by = NaN;
  let bh = 0;
  let bd = Infinity;
  for (const r of rects) {
    const y = +(r.getAttribute('y') ?? NaN);
    const h = +(r.getAttribute('height') ?? NaN);
    const d = ny >= y && ny < y + h ? 0 : Math.abs(y + h / 2 - ny);
    if (d < bd) {
      bd = d;
      by = y;
      bh = h;
      if (d === 0) break;
    }
  }
  if (!(bd <= 1.5)) return null;
  let x0: number;
  let x1: number;
  if (col.kind === 'alignment') {
    x0 = Infinity;
    x1 = -Infinity;
    for (const r of rects) {
      if (+(r.getAttribute('y') ?? NaN) !== by) continue;
      const x = +(r.getAttribute('x') ?? NaN);
      const w = +(r.getAttribute('width') ?? NaN);
      if (x < x0) x0 = x;
      if (x + w > x1) x1 = x + w;
    }
  } else {
    const idx = L.colInfo.barIds.indexOf(colId);
    const frame = track.querySelector(':scope > rect[fill="none"]');
    if (idx < 0 || !frame || !L.colInfo.bars.length) return null;
    const ox = +(frame.getAttribute('x') ?? NaN);
    const cw = +(frame.getAttribute('width') ?? NaN) / L.colInfo.bars.length;
    x0 = ox + idx * cw;
    x1 = x0 + cw;
  }
  if (!isFinite(x0) || !isFinite(x1)) return null;
  const a = new DOMPoint(x0, by).matrixTransform(m);
  const b = new DOMPoint(x1, by + bh).matrixTransform(m);
  const sr = svg.getBoundingClientRect();
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  if (cx < sr.left || cx > sr.right || cy < sr.top || cy > sr.bottom) return null;
  return { x: a.x, y: a.y, width: Math.max(1, b.x - a.x), height: Math.max(1, b.y - a.y) };
}

// ---------------------------------------------------------------------------------------------- capabilities
const capabilities: CapabilityReport = {
  tipClick: { level: 'partial', how: 'the library has no click callback: the adapter listens for DOM clicks on the container and maps them to a node (the d3 datum of a clicked label, else layout coordinates within 5 units); events are source adapter-derived and the library still opens its own node menu' },
  internalNodeClick: { level: 'partial', how: 'same workaround; internal nodes have no DOM element, so they are found from the library\'s (undocumented) node coordinates; in the circular layout the polar mapping is re-derived from the labelled nodes; after the node menu\'s Reroot a node may no longer be a clade of the shared tree, and then no event is reported' },
  branchClick: { level: 'no', how: 'no branch elements (branches are batched into one path per style); a click near a branch resolves to the nearest node, never to a branch' },
  hover: { level: 'partial', how: 'the library shows its own tooltip and has no callback; the adapter derives tipHover/nodeHover from a throttled mousemove hit test (adapter-derived)' },
  descendantTipsInPayload: { level: 'no', how: 'the library emits no payload at all (the selection event is payload-less); tip sets come from the shared TreeModel through the adapter\'s node mapping (source adapter-derived)' },
  cladeColouring: { level: 'partial', how: 'writes the phyloXML node.color on every node of the clade in the library\'s live tree object, then forces a redraw with the PageUp/PageDown font-size keys (applyViewState would reset zoom); no colour-a-clade API; an active search dims coloured clades too' },
  highlightTip: { level: 'partial', how: 'search box A through applyViewState({searchA: regex on Node Name}); hits get bold label, halo and dot, everything else fades; resets zoom and pan; no per-tip style API' },
  focusTip: { level: 'partial', how: 'search A (highlighted tips + this tip), then the documented Ctrl+G (centres the hit) and Ctrl+Shift+ArrowUp zoom keys dispatched on document; there is no focus/zoom-to API; the tip stays highlighted; rows are made readable up to 12,000 tips (every readable zoom draws a label element per tip)' },
  tipAsLink: { level: 'partial', how: 'tip labels are SVG <text>; the adapter overlays <a href data-tip-id> on the visible labels (up to 400), repositioned by a MutationObserver after each redraw' },
  customColumns: { level: 'partial', how: 'only built-ins: numeric columns become heat-map columns (2 or more needed: one bar column is drawn with a labelled mirror copy), text columns become label text and Color-by; no custom cell renderers' },
  alignmentColumn: { level: 'yes', how: 'mol_seq on the tip nodes; the built-in alignment track (windowed 7 px columns, conservation bar or sequence logo, navigation bar fixed to the viewport)' },
  radialLayout: { level: 'yes', how: "layout: 'circular' through applyViewState (heat map as rings; alignment track rectangular only; 'unrooted' also exists but is not offered by the shell)" },
  branchLengthToggle: { level: 'yes', how: "applyViewState({display: 'phylogram' | 'cladogram'}); the library draws to scale only when more than half of the branches carry a positive length" },
  scaleBar: { level: 'yes', how: 'a scale bar is drawn for phylograms; showScaleAxis adds a time or distance axis (checked on rich-corvoid-680)' },
  darkTheme: { level: 'partial', how: "the library's own light/dark switch (the adapter clicks its theme button; the choice is stored by the library in localStorage 'aptx-panel-theme'); dark palette is the library's, not GBIF's" },
  cssTokens: { level: 'partial', how: "no token contract: the adapter overrides default-coloured SVG attributes with CSS !important selectors (matching the library's fixed default colour values) and re-points the panel and menu --p-* custom properties" },
  multipleInstances: { level: 'no', how: 'module singleton: a second launch() empties the first container and it is not restored (verified: README says "One viewer per page")' },
  cleanUnmount: { level: 'yes', how: 'viewer.destroy() removes the DOM, the body tooltip, the resize and the document key/wheel listeners (5 mount/unmount cycles: DOM node count and heap flat); it leaves one <style id="aptx-panel-styles"> and localStorage keys behind' },
  controlledState: { level: 'partial', how: 'view state goes both ways (applyViewState / onViewChange: layout, display, tracks, collapsed clades, searches, colour-by); selection is read-only; no viewport, colour or highlight setters; every applyViewState resets zoom and pan' },
  zoomToFit: { level: 'yes', how: 'fits on launch and on window resize (not on container resize: the adapter dispatches a window resize event); Ctrl+0 or the panel button refits' },
  overviewOrMinimap: { level: 'yes', how: 'built-in overview miniature with a viewport rectangle (always shown: no config key switches it off)' },
};

const features: AdapterFeature[] = [
  { id: 'showPanel', label: 'Show Archaeopteryx control panel', kind: 'toggle', default: false, description: 'Off: collapseControlPanel (panel folded to its header bar), downloads off. On: the full panel with all its sections. Relaunches the viewer with the view state carried over.' },
  { id: 'reportClicks', label: 'Report clicks and hovers (adapter workaround)', kind: 'toggle', default: true, level: 'partial', how: 'The library has no click callback. Events come from a DOM hit test and are flagged adapter-derived. The library still opens its own node menu on click.' },
  { id: 'selectionMode', label: 'Selection mode (node menu: Select)', kind: 'toggle', default: false, level: 'partial', description: 'enableManualNodeSelection: the node menu gets Select; the payload-less selected_nodes_changed_event then makes the adapter read getSelectedNodes() and emit adapter-derived events.' },
  { id: 'heatmapTrack', label: 'Heat map track (numeric columns)', kind: 'toggle', default: true, description: 'Needs two or more numeric columns (synthetic trees: occurrences and trait).' },
  { id: 'alignmentTrack', label: 'Alignment track (FASTA columns)', kind: 'toggle', default: true, description: 'Needs an alignment column (rich-ens-protein-197, syn-yule-200, syn-yule-1000).' },
  { id: 'alignmentLogo', label: 'Alignment as sequence logo', kind: 'toggle', default: false },
  { id: 'metadataLabels', label: 'Text columns as label text', kind: 'toggle', default: true },
  { id: 'colourBy', label: 'Library Color-by (first text column)', kind: 'select', default: 'none', options: [{ value: 'none', label: 'None' }, { value: 'column', label: 'First text column (Country)' }], description: 'view.colorBy: Archaeopteryx colours the tip labels by a metadata field and draws its own legend. A Color-by overrides the clade colours on labels. Needs a text column (syn-yule-1000 with columns on).' },
  { id: 'scaleAxis', label: 'Scale axis (time axis for dated trees)', kind: 'toggle', default: false },
  { id: 'autoHide', label: 'Auto-hide labels (level of detail)', kind: 'toggle', default: true, description: 'The only level-of-detail: labels thinned by index and overlap; no clade summaries (auto-collapse was removed in 3.0).' },
  { id: 'shortNames', label: 'Shorten long names ("Genus..species")', kind: 'toggle', default: false, description: 'Library default is on for names over 18 characters; off here so labels stay the tip ids.' },
  { id: 'branchWidth', label: 'Branch width', kind: 'select', default: 'auto', options: [{ value: 'auto', label: 'Library default (1 px above 50 tips)' }, { value: '2', label: '2 px' }, { value: '3', label: '3 px' }], description: 'view.branch: the only branch-style control (global; no per-branch width from code).' },
  { id: 'ladderize', label: 'Ladderize on load', kind: 'toggle', default: false, description: 'Library default is on. Reorders children; the adapter maps nodes by tip sets so ids stay valid. Relaunches.' },
];

export const adapter: CandidateAdapter = {
  candidate: {
    name: 'archaeopteryx-js',
    version: LIB_VERSION,
    license: 'LGPL-3.0-or-later',
    notes: 'Full viewer application driven imperatively (launch/destroy); d3 7.9.0 and phyloxml 1.1.7 put on globalThis for the UMD file; panel collapsed by default.',
  },
  capabilities,
  View: AptxView,
  features,
};
