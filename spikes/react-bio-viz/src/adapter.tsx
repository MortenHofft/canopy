// react-bio-viz 0.3.0 adapter: PhyloTree (with the library's own toolbar) or SimplePhyloTree, used the way a
// gbif.org developer would: inside a React component, with `selection` and `viewport` as React state and the
// library's callbacks (onNodeClick, onBranchClick, onLeafOrderChange) wired to the harness.
//
// What the library does itself:   layout (rectangular phylogram, cladogram, radial), node and branch click with
//   leafNames / descendantIds in the payload, per-node and per-branch colours (nodeStyles / branchStyles keyed by id),
//   collapse, reroot, midpoint root, ladderize, search dimming, scale bar, controlled viewport and selection.
// What it does NOT do and how this adapter works around it (each one is reported as `partial` or `no`):
//   * hover events: none -> delegated DOM mouseover on the wrapper, tip sets derived from the shared TreeModel
//     (source: 'adapter-derived').
//   * per-tip columns / alignment: none -> an own canvas to the right of the tree, aligned to the rows we read back
//     from the library's rendered markers (circle[data-node-id]) and the controlled viewport (svg.getScreenCTM()).
//   * focus a tip: none -> row spacing (leafSpacing prop) plus a computed controlled viewport.
//   * tip links: the leafTextComponent slot renders an SVG <a href data-tip-id>.
//   * radial cladogram / trees without lengths: radial always uses lengths -> synthetic lengths (adapter-derived).
// Tree walks are iterative (the library's own parseNewick/layout are recursive: that is measured, not hidden).

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PhyloTree, SimplePhyloTree, parseNewick, ladderizeOrder, midpointRoot, collapseBySupport, REROOT_ID } from 'react-bio-viz';
import type { Tree, TreeNodeInfo, TreeSelection, TreeNodeStyle, TreeBranchStyle, Viewport } from 'react-bio-viz';
import type { CandidateAdapter, CapabilityReport, ColumnSpec, EmitEvent, Rect, ViewHandle, ViewProps, ThemeSpec } from '../../shared/types.ts';
import type { TreeModel } from '../../shared/tree.ts';
import { gbifTheme, gbifDarkTheme } from '../../shared/gbif-theme.ts';
import type { GbifTheme } from '../../shared/gbif-theme.ts';

const LIB_VERSION = '0.3.0';
const COL_GAP = 6;
const MAX_HL = 400;

// ------------------------------------------------------------------------------------------------ input

interface Prepared {
  root: Tree;
  /** library node objects in shared preorder (index k is the shared node n<k>) */
  byIndex: Tree[];
  /** library node id (what callbacks report) -> shared node index */
  idToIdx: Map<string, number>;
  /** shared node index -> library id */
  ids: string[];
  parseMs: number;
  mapping: 'preorder' | 'tip-set';
  mismatches: number;
}

/** Library parseNewick, then iterative id assignment: the library keeps `id` when present, so every node gets its shared id. */
function prepare(newick: string, tree: TreeModel): Prepared {
  const t0 = performance.now();
  const root = parseNewick(newick); // recursive in the library: RangeError on very deep trees (propagates, the shell shows it)
  const parseMs = performance.now() - t0;
  const byIndex: Tree[] = [];
  const stack: Tree[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    byIndex.push(n);
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
  }
  const n = tree.nodeCount;
  let mismatches = 0;
  if (byIndex.length !== n) mismatches = Math.abs(byIndex.length - n) + 1;
  else {
    for (let k = 0; k < n; k++) {
      const isTip = tree.childCount[k] === 0;
      if (isTip !== (byIndex[k].children.length === 0)) mismatches++;
      else if (isTip && byIndex[k].name !== tree.tipLabels[tree.tipRank[k]]) mismatches++;
    }
  }
  const ids: string[] = new Array(n);
  const idToIdx = new Map<string, number>();
  let mapping: Prepared['mapping'] = 'preorder';
  if (mismatches === 0) {
    for (let k = 0; k < n; k++) {
      ids[k] = tree.nodeId(k);
      byIndex[k].id = ids[k];
      idToIdx.set(ids[k], k);
    }
  } else {
    // fallback: identify library nodes by (leftmost tip rank, tip count) of their clade; outermost node wins on unary chains
    mapping = 'tip-set';
    const m = byIndex.length;
    const parentIdx = new Int32Array(m).fill(-1);
    const objIdx = new Map<Tree, number>();
    byIndex.forEach((o, k) => objIdx.set(o, k));
    for (let k = 0; k < m; k++) for (const c of byIndex[k].children) parentIdx[objIdx.get(c)!] = k;
    const minRank = new Int32Array(m).fill(2147483647);
    const cnt = new Int32Array(m);
    for (let k = m - 1; k >= 0; k--) {
      const node = byIndex[k];
      if (node.children.length === 0) {
        const r = tree.tipIndex(node.name);
        minRank[k] = r < 0 ? 2147483647 : r;
        cnt[k] = 1;
      }
      const par = parentIdx[k];
      if (par >= 0) {
        if (minRank[k] < minRank[par]) minRank[par] = minRank[k];
        cnt[par] += cnt[k];
      }
    }
    const sharedKey = new Map<string, number>();
    for (let k = tree.nodeCount - 1; k >= 0; k--) sharedKey.set(`${tree.leafStart[k]}:${tree.leafEnd[k] - tree.leafStart[k]}`, k);
    for (let k = 0; k < m; k++) {
      const si = sharedKey.get(`${minRank[k]}:${cnt[k]}`);
      if (si === undefined) {
        ids[k] = `lib:${k}`;
      } else {
        ids[k] = tree.nodeId(si);
        if (idToIdx.has(ids[k])) ids[k] = `lib:${k}`; // an inner unary duplicate: keep a distinct id
        else idToIdx.set(ids[k], si);
      }
      byIndex[k].id = ids[k];
    }
  }
  return { root, byIndex, idToIdx, ids, parseMs, mapping, mismatches };
}

type Mode = 'rect' | 'clad' | 'radial-lengths' | 'radial-height';

/** A library Tree for the requested mode. Shallow clones share ids; lengths are replaced where the library cannot do the mode itself. */
function variantTree(p: Prepared, tree: TreeModel, mode: Mode, minLen: number): { root: Tree; derived: boolean } {
  const needClamp = (mode === 'rect' || mode === 'radial-lengths') && minLen < 0;
  if (mode === 'clad' || (!needClamp && mode !== 'radial-height')) return { root: p.root, derived: false };
  const n = p.byIndex.length;
  const len = new Float64Array(n);
  if (mode === 'radial-height') {
    const h = new Int32Array(n);
    for (let k = n - 1; k >= 1; k--) {
      const par = tree.parent[k];
      if (h[par] < h[k] + 1) h[par] = h[k] + 1;
    }
    for (let k = 1; k < n; k++) len[k] = h[tree.parent[k]] - h[k];
  } else {
    for (let k = 0; k < n; k++) len[k] = Math.max(0, p.byIndex[k].length || 0);
  }
  const clones: Tree[] = new Array(n);
  for (let k = 0; k < n; k++) clones[k] = { id: p.byIndex[k].id, name: p.byIndex[k].name, length: len[k], children: [] };
  for (let k = 1; k < n; k++) clones[tree.parent[k]].children.push(clones[k]);
  return { root: clones[0], derived: true };
}

// ------------------------------------------------------------------------------------------------ theme

function themeVars(t: ThemeSpec, g: GbifTheme): React.CSSProperties {
  const k = t.tokens ?? {};
  const bg = k.background ?? g.bg1;
  const hl = k.highlight ?? g.primary;
  return {
    '--background': bg,
    '--foreground': k.branch ?? (t.dark ? g.fg3 : g.fg2), // the library draws branches in currentColor = color of .text-foreground
    '--gv-label': k.foreground ?? g.fg1,
    '--gv-hl-halo': g.primaryLight,
    '--gv-muted': g.fg3,
    '--gv-font': k.fontFamily ?? g.fontBody,
    '--rbv-accent': hl,
    // shadcn tokens the library's toolbar buttons read
    '--primary': g.primary,
    '--primary-foreground': t.dark ? g.bg1 : '#fff',
    '--secondary': g.bg2,
    '--secondary-foreground': g.fg1,
    '--accent': g.bg2,
    '--accent-foreground': g.fg1,
    '--muted': g.bg2,
    '--muted-foreground': g.fg3,
    '--card': bg,
    '--card-foreground': g.fg1,
    '--popover': bg,
    '--popover-foreground': g.fg1,
    '--border': g.border,
    '--input': g.border,
    '--ring': g.primary,
    '--radius': '6px',
    color: g.fg1,
    background: bg,
  } as React.CSSProperties;
}

const CSS = `
.gv{position:relative;width:100%;height:100%;overflow:hidden;font-family:var(--gv-font);display:flex}
.gv .gv-left{flex:none;overflow:hidden}
.gv .gv-right{flex:none;position:relative}
.gv .gv-hdr{position:relative;overflow:hidden;font-size:11px;font-weight:600;color:var(--gv-label);border-bottom:1px solid var(--border)}
.gv .gv-hdr span{position:absolute;top:0;line-height:var(--gv-hdr-h);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gv canvas{display:block}
/* library presentation attributes overridden by CSS (DOM-level styling, not a library option) */
.gv .rbv svg path{opacity:1}
.gv .rbv svg .scale-bar,.gv .rbv svg .collapsed-clade text,.gv .rbv svg text{font-family:var(--gv-font) !important}
.gv .gv-tip text{font-family:var(--gv-font);font-style:italic}
.gv .gv-tip.hl text{font-weight:600;paint-order:stroke;stroke:var(--gv-hl-halo);stroke-width:4px;stroke-linejoin:round}
.gv.gv-dense .gv-tip text{display:none}
.gv .gv-tip a{cursor:pointer}
.gv .gv-tip a:hover text{text-decoration:underline}
.gv .gv-tip a:focus-visible text{outline:1px solid var(--rbv-accent)}
.gv .gv-tip a:focus{outline:none}
`;

// ------------------------------------------------------------------------------------------------ columns

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

const palInt = new Map<string, number>();
function resInt(ch: string): number {
  let v = palInt.get(ch);
  if (v === undefined) {
    const h = resColour(ch);
    v = (0xff << 24) | (parseInt(h.slice(5, 7), 16) << 16) | (parseInt(h.slice(3, 5), 16) << 8) | parseInt(h.slice(1, 3), 16); // ABGR for a little-endian Uint32Array over RGBA
    palInt.set(ch, v >>> 0);
    v = v >>> 0;
  }
  return v;
}
/** One pixel per row and per horizontal pixel: an offscreen image of the whole alignment column, drawn scaled (O(1) per frame instead of O(rows x residues)). */
const alnCache = new WeakMap<ColumnSpec, { version: number; cv: HTMLCanvasElement }>();
const MAX_IMG_ROWS = 30000;
function alignmentImage(c: ColumnSpec, rows: Rows, tree: TreeModel): HTMLCanvasElement | null {
  if (rows.count > MAX_IMG_ROWS) return null;
  const hit = alnCache.get(c);
  if (hit && hit.version === rows.version) return hit.cv;
  const w = Math.max(1, Math.ceil(c.width)), h = rows.count;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const px = new Uint32Array(img.data.buffer);
  for (let r = 0; r < h; r++) {
    const i = rows.idx[r];
    if (tree.childCount[i] !== 0) continue;
    const val = c.values[tree.tipLabels[tree.tipRank[i]]];
    if (val === undefined) continue;
    const seq = String(val);
    const L = seq.length;
    if (!L) continue;
    for (let x = 0; x < w; x++) px[r * w + x] = resInt(seq[Math.min(L - 1, Math.floor((x * L) / w))]);
  }
  ctx.putImageData(img, 0, 0);
  alnCache.set(c, { version: rows.version, cv });
  return cv;
}

const maxCache = new WeakMap<ColumnSpec, number>();
function maxOf(c: ColumnSpec): number {
  let m = maxCache.get(c);
  if (m === undefined) {
    m = 0;
    for (const key in c.values) m = Math.max(m, Number(c.values[key]));
    maxCache.set(c, m);
  }
  return m;
}

function barWidth(v: number, max: number, w: number): number {
  if (!(max > 0) || !(v > 0)) return 1;
  return Math.max(1, (Math.log10(1 + v) / Math.log10(1 + max)) * (w - 4));
}

let rowsVersion = 0;
interface Rows {
  version: number;
  y: Float64Array; // user-space y of the row centre (library svg coordinates, margin included)
  x: Float64Array; // user-space x of the marker
  idx: Int32Array; // shared node index of the row (tip, or collapsed clade)
  rowOfTipRank: Int32Array;
  gap: number; // user units between neighbouring rows
  count: number;
}
const NO_ROWS: Rows = { version: 0, y: new Float64Array(0), x: new Float64Array(0), idx: new Int32Array(0), rowOfTipRank: new Int32Array(0), gap: 1, count: 0 };

function scanRows(svg: SVGSVGElement, p: Prepared, tree: TreeModel, collapsed: Set<string>): Rows {
  const circles = svg.querySelectorAll('circle[data-node-id]');
  if (!circles.length) return NO_ROWS;
  let ox = 0, oy = 0;
  const g = circles[0].parentNode as SVGGElement | null;
  if (g && g.transform && g.transform.baseVal.numberOfItems > 0) {
    const m = g.transform.baseVal.consolidate()?.matrix;
    if (m) { ox = m.e; oy = m.f; }
  }
  const ys: number[] = [], xs: number[] = [], is: number[] = [];
  for (let k = 0; k < circles.length; k++) {
    const c = circles[k] as SVGCircleElement;
    const id = c.getAttribute('data-node-id')!;
    const i = p.idToIdx.get(id);
    if (i === undefined) continue;
    if (tree.childCount[i] !== 0 && !collapsed.has(id)) continue;
    ys.push(c.cy.baseVal.value + oy);
    xs.push(c.cx.baseVal.value + ox);
    is.push(i);
  }
  const n = ys.length;
  const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => ys[a] - ys[b]);
  const rows: Rows = { version: ++rowsVersion, y: new Float64Array(n), x: new Float64Array(n), idx: new Int32Array(n), rowOfTipRank: new Int32Array(tree.tipCount).fill(-1), gap: 1, count: n };
  for (let r = 0; r < n; r++) {
    const o = order[r];
    rows.y[r] = ys[o];
    rows.x[r] = xs[o];
    rows.idx[r] = is[o];
    if (tree.childCount[is[o]] === 0) rows.rowOfTipRank[tree.tipRank[is[o]]] = r;
  }
  rows.gap = n > 1 ? (rows.y[n - 1] - rows.y[0]) / (n - 1) : 1;
  return rows;
}

// ------------------------------------------------------------------------------------------------ view

type RowHeight = 'fit' | '12' | '18' | '28';

function RbvView(props: ViewProps) {
  const { tree, layout, branchLengths, size, columns, theme, tipLinks, emit, features, colouredClades, highlightedTips } = props;
  const renderStart = performance.now();
  const lastCommitMs = useRef(0);

  const prep = useMemo(() => prepare(props.newick, tree), [props.newick, tree]);
  const minLen = useMemo(() => {
    let m = 0;
    for (let k = 1; k < tree.nodeCount; k++) if (tree.length[k] < m) m = tree.length[k];
    return m;
  }, [tree]);

  // ---- feature values
  const toolbar = features.toolbar !== false;
  const rowHeight = (features.rowHeight as RowHeight) ?? 'fit';
  const showSupport = features.showSupport === true;
  const shadeSupport = features.shadeSupport === true;
  const showBranchLen = features.showBranchLengths === true;
  const showScale = features.scaleBar !== false;
  const alignTips = features.alignTips !== false;
  const nodeRadiusSel = String(features.nodeRadius ?? 'auto');
  const clickAction = (features.clickAction as string) ?? 'colour';
  const ladder = (features.ladderize as string) ?? 'none';
  const midpoint = features.midpoint === true;
  const dissolve = Number(features.dissolveSupport ?? 0);
  const dim = features.dimOthers === true;
  const dragOn = features.drag === true;
  const wheelZoom = features.wheelZoom === true;
  const branchClicks = features.branchClicks !== false;
  const hideDense = features.hideDense !== false;

  // token values are read from computed CSS once per theme change (reading them on every render forces a style recalculation per pan frame)
  const gt = useMemo(() => (theme.dark ? gbifDarkTheme() : gbifTheme()), [theme.dark]);
  const styleVars = useMemo(() => themeVars(theme, gt), [theme, gt]);
  const colours = useMemo(() => ({ fg: theme.tokens?.foreground ?? gt.fg1, bar: gt.categorical[1], fam: theme.tokens?.fontFamily ?? gt.fontBody, marker: gt.fg3, primary: gt.primary }), [theme, gt]);

  const useLengths = branchLengths && tree.hasLengths;
  const isRadial = layout === 'radial';
  const mode: Mode = isRadial ? (useLengths ? 'radial-lengths' : 'radial-height') : useLengths ? 'rect' : 'clad';
  const variant = useMemo(() => variantTree(prep, tree, mode, minLen), [prep, tree, mode, minLen]);
  const libRoot = useMemo(() => (dissolve > 0 ? collapseBySupport(variant.root, dissolve) : variant.root), [variant, dissolve]);
  const libLayout = mode === 'clad' ? 'cladogram' : isRadial ? 'radial' : 'rectangular';

  // ---- React state owned by the adapter and handed to the library as controlled props
  const [selection, setSelection] = useState<TreeSelection>({ collapsed: [] });
  const [viewport, setViewport] = useState<Viewport | undefined>(undefined); // undefined only until the first fit below
  const [autoSpacing, setAutoSpacing] = useState<number | null>(null);
  const [tbH, setTbH] = useState(0);
  const leafNamesRef = useRef<string[]>([]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rowsRef = useRef<Rows>(NO_ROWS);
  const pending = useRef<{ tipId: string; seq: number } | null>(null);
  const lastSeq = useRef(0);

  // the arrangement features rebuild the selection from scratch (collapsed clades are kept)
  useEffect(() => {
    setSelection((prev) => {
      const base: TreeSelection = { collapsed: prev.collapsed };
      const root = midpoint ? midpointRoot(libRoot) : {};
      const withRoot: TreeSelection = { ...base, ...root };
      if (ladder === 'asc' || ladder === 'desc') withRoot.order = ladderizeOrder(libRoot, withRoot, ladder);
      return withRoot;
    });
  }, [ladder, midpoint, libRoot]);
  // a new tree or layout starts with nothing collapsed and the natural row height
  useEffect(() => {
    setAutoSpacing(null);
    setSelection((prev) => (prev.collapsed.length ? { ...prev, collapsed: [] } : prev));
  }, [tree, mode, rowHeight]);

  const spacing = isRadial ? undefined : rowHeight === 'fit' ? autoSpacing ?? undefined : Number(rowHeight);
  const collapsedSet = useMemo(() => new Set(selection.collapsed), [selection.collapsed]);

  const hasCols = columns.length > 0 && !isRadial;
  const colsW = hasCols ? columns.reduce((s, c) => s + c.width + COL_GAP, 0) + 8 : 0;
  const svgW = Math.max(120, size.width - colsW);
  const svgH = Math.max(80, size.height - (toolbar ? tbH : 0));
  // Radial has no leafSpacing: the circle is as big as min(width, height). Workaround: lay it out on a virtual square
  // canvas big enough for ~14 user units per tip, and show it through the real container with CSS (the viewBox does the rest).
  const RADIAL_UNITS_PER_TIP = 14;
  const virtualV = isRadial ? Math.min(16000, Math.round((RADIAL_UNITS_PER_TIP * tree.tipCount) / Math.PI + 300)) : 0;
  const virtual = isRadial && virtualV > Math.max(svgW, svgH);
  const libW = virtual ? virtualV : svgW;
  const libH = virtual ? virtualV : svgH;
  const tipGap = isRadial
    ? virtual
      ? RADIAL_UNITS_PER_TIP
      : (Math.PI * (Math.min(libW, libH) - Math.min(300, Math.round(libW * 0.3)))) / Math.max(1, tree.tipCount)
    : spacing ?? (libH - 20 - (showScale ? 30 : 0)) / Math.max(1, tree.tipCount - 1);
  // fit view = the whole canvas. (Passing `viewport={undefined}` would NOT refit: PhyloTree then falls back to a private store that still holds
  // its first value, so the fit is always set explicitly. The library corrects the vertical extent itself when leafSpacing makes the tree taller.)
  useEffect(() => {
    setViewport({ x0: 0, x1: libW, y0: 0, y1: libH, xMin: 0, xMax: libW, yMin: 0, yMax: libH });
  }, [tree, mode, rowHeight, libW, libH]);
  const nodeRadius = nodeRadiusSel === 'auto' ? Math.round(Math.min(3.5, Math.max(0.6, 0.42 * tipGap)) * 100) / 100 : Number(nodeRadiusSel);

  // ---- styles from React state: clade colours, highlight
  const hlSet = useMemo(() => new Set(highlightedTips.slice(0, MAX_HL)), [highlightedTips]);
  const { nodeStyles, branchStyles, tipColour } = useMemo(() => {
    const ns: Record<string, TreeNodeStyle> = {};
    const bs: Record<string, TreeBranchStyle> = {};
    const tc = new Map<string, string>();
    const ids = prep.ids;
    for (const c of colouredClades) {
      const a = tree.nodeIndex(c.nodeId);
      const b = tree.subtreeEnd[a];
      for (let k = a; k < b; k++) {
        bs[ids[k]] = { color: c.colour };
        ns[ids[k]] = { color: c.colour };
        if (tree.childCount[k] === 0) tc.set(tree.tipLabels[tree.tipRank[k]], c.colour);
      }
    }
    const hl = colours.primary;
    for (const t of hlSet) {
      const i = tree.tipIndex(t);
      if (i < 0) continue;
      ns[ids[i]] = { color: hl, bold: true };
    }
    return { nodeStyles: ns, branchStyles: bs, tipColour: tc };
  }, [colouredClades, hlSet, prep, tree, colours]);

  const searchQuery = useMemo(() => {
    if (!dim || hlSet.size === 0) return undefined;
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return '^(' + Array.from(hlSet).map(esc).join('|') + ')$';
  }, [dim, hlSet]);

  const tipOfId = useCallback(
    (id: string, fallback: string) => {
      const i = prep.idToIdx.get(id);
      return i !== undefined && tree.childCount[i] === 0 ? tree.tipLabels[tree.tipRank[i]] : fallback;
    },
    [prep, tree],
  );

  // label slot: the library's only per-tip rendering hook. Italic scientific names, highlight halo, real links.
  const leafText = useCallback(
    ({ node, fontSize }: { node: { id: string; data: Tree }; fontSize?: number }) => {
      const name = node.data.name;
      const tip = tipOfId(node.id, name);
      const hl = hlSet.has(tip);
      const fill = hl ? 'var(--rbv-accent)' : tipColour.get(tip) ?? 'var(--gv-label)';
      const txt = (
        <text x={0} y={0} fill={fill} style={{ fontSize }}>
          {name}
        </text>
      );
      const href = tipLinks ? tipLinks(tip) : null;
      return (
        <g className={'gv-tip' + (hl ? ' hl' : '')} data-tip-label={tip}>
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" data-tip-id={tip} data-pan-ignore tabIndex={0}>
              {txt}
            </a>
          ) : (
            txt
          )}
        </g>
      );
    },
    [hlSet, tipColour, tipLinks, tipOfId],
  );

  // ---- events: library callbacks (click) and a delegated DOM listener (hover)
  const latest = useRef({ emit, clickAction, prep, tree, collapsedSet, selection });
  latest.current = { emit, clickAction, prep, tree, collapsedSet, selection };

  const handleNode = useCallback((info: TreeNodeInfo, event: React.MouseEvent) => {
    void event;
    const L = latest.current;
    if (info.id === REROOT_ID || !L.prep.idToIdx.has(info.id)) return;
    const idx = L.prep.idToIdx.get(info.id)!;
    const isTip = info.isLeaf;
    if (!isTip && L.clickAction === 'collapse') {
      setSelection((s) => ({ ...s, collapsed: s.collapsed.includes(info.id) ? s.collapsed.filter((c) => c !== info.id) : [...s.collapsed, info.id] }));
      return;
    }
    if (!isTip && L.clickAction === 'reroot') {
      if (info.rerootAbove) setSelection((s) => ({ ...s, ...info.rerootAbove!, order: undefined }));
      return;
    }
    L.emit({
      type: isTip ? 'tipClick' : 'nodeClick',
      nodeId: L.tree.nodeId(idx),
      isTip,
      tipIds: info.leafNames,
      source: 'library',
      libraryPayload: { id: info.id, name: info.name, isLeaf: info.isLeaf, isCollapsed: info.isCollapsed, leafNames: info.leafNames.length, descendantIds: info.descendantIds.length, sharedTipCount: L.tree.tipCountOf(idx), rerootedMismatch: info.leafNames.length !== L.tree.tipCountOf(idx) }, // after a reroot the library clade of an id can differ from the original rooted clade
    } as EmitEvent);
  }, []);
  const handleBranch = useCallback((info: TreeNodeInfo) => {
    const L = latest.current;
    if (!L.prep.idToIdx.has(info.id)) return;
    const idx = L.prep.idToIdx.get(info.id)!;
    L.emit({
      type: 'branchClick',
      nodeId: L.tree.nodeId(idx),
      isTip: false,
      tipIds: info.leafNames,
      source: 'library',
      libraryPayload: { id: info.id, leafNames: info.leafNames.length },
    } as EmitEvent);
  }, []);

  useEffect(() => {
    const el = wrapRef.current!;
    let lastKey = '';
    const onOver = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t || !t.closest) return;
      let id = '';
      const c = t.closest('circle[data-node-id]');
      const b = t.closest('path[data-branch-id]');
      const g = t.closest('[data-tip-label]');
      if (c) id = c.getAttribute('data-node-id')!;
      else if (b) id = b.getAttribute('data-branch-id')!;
      else if (g) {
        const i = latest.current.tree.tipIndex(g.getAttribute('data-tip-label')!);
        if (i >= 0) id = latest.current.prep.ids[i];
      }
      const key = (c ? 'c' : b ? 'b' : 'l') + id;
      if (key === lastKey) return;
      lastKey = key;
      const idx = latest.current.prep.idToIdx.get(id);
      if (idx === undefined) return;
      const T = latest.current.tree;
      const isTip = T.childCount[idx] === 0;
      // the library has no hover callback: this event is built by the adapter from a DOM mouseover
      latest.current.emit({ type: isTip ? 'tipHover' : 'nodeHover', nodeId: T.nodeId(idx), isTip, tipIds: T.descendantTips(idx), source: 'adapter-derived', libraryPayload: { via: 'dom mouseover', id } } as EmitEvent);
    };
    const onLeave = () => (lastKey = '');
    el.addEventListener('mouseover', onOver);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mouseover', onOver);
      el.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  // optional adapter patch: plain wheel zooms (the library pans on plain wheel and zooms on Ctrl/Cmd+wheel)
  useEffect(() => {
    const el = wrapRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!wheelZoom || e.ctrlKey || e.metaKey || (e as WheelEvent & { __gv?: boolean }).__gv) return;
      e.stopPropagation();
      e.preventDefault();
      const ne = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode, ctrlKey: true, view: window });
      (ne as WheelEvent & { __gv?: boolean }).__gv = true;
      (e.target as Element).dispatchEvent(ne);
    };
    el.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => el.removeEventListener('wheel', onWheel, { capture: true });
  }, [wheelZoom]);

  // ---- layout bookkeeping after each commit that changes the drawn tree
  const layoutKey = [libRoot, libLayout, spacing, selection, svgW, svgH, libW, libH, toolbar, nodeRadius, alignTips] as const;
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    // virtual radial canvas: the library sizes the <svg> to its (large) width/height props; show it at container size
    svg.style.width = svgW + 'px';
    svg.style.height = svgH + 'px';
    rowsRef.current = isRadial ? NO_ROWS : scanRows(svg, prep, tree, collapsedSet);
    lastCommitMs.current = performance.now() - renderStart;
    if (toolbar) {
      const top = svg.getBoundingClientRect().top - (leftRef.current?.getBoundingClientRect().top ?? 0);
      if (Math.abs(top - tbH) > 0.5 && top >= 0 && top < 200) setTbH(Math.round(top));
    } else if (tbH !== 0) setTbH(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, layoutKey as unknown as unknown[]);

  // ---- columns on an own canvas
  const ctmOf = () => svgRef.current?.getScreenCTM() ?? null; // DOM read: only for locate/bounds/locateCell, never on the render path
  // svg user space -> svg-relative px, from React state (viewBox of the controlled viewport, xMidYMid meet): no DOM reads while panning
  const viewMap = () => {
    const v = viewport;
    if (!v) return null;
    const sx = v.x1 - v.x0, sy = v.y1 - v.y0;
    if (!(sx > 0 && sy > 0)) return null;
    const sc = Math.min(svgW / sx, svgH / sy);
    return { a: sc, d: sc, e: (svgW - sx * sc) / 2 - v.x0 * sc, f: (svgH - sy * sc) / 2 - v.y0 * sc };
  };
  const colLeft = (k: number) => {
    let x = 4;
    for (let j = 0; j < k; j++) x += columns[j].width + COL_GAP;
    return x;
  };
  const drawColumns = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const W = colsW, H = svgH;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cv.style.width = W + 'px';
      cv.style.height = H + 'px';
    }
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const m = viewMap();
    const rows = rowsRef.current;
    if (!hasCols || !m || !rows.count) return;
    const { fg, bar: barC, fam } = colours;
    const rowPx = rows.gap * m.d;
    // visible row range by binary search on row y
    const toY = (r: number) => m.d * rows.y[r] + m.f;
    let lo = 0, hi = rows.count - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (toY(mid) < -rowPx) lo = mid + 1;
      else hi = mid;
    }
    const r0 = lo;
    let r1 = r0;
    while (r1 < rows.count - 1 && toY(r1) < H + rowPx) r1++;
    const step = rowPx < 1 ? Math.ceil(1 / rowPx) : 1; // more rows than pixels: draw every n-th row
    columns.forEach((c, k) => {
      const x0 = colLeft(k);
      if (c.kind === 'alignment') {
        const img = alignmentImage(c, rows, tree);
        if (img) {
          ctx.imageSmoothingEnabled = false;
          const top = toY(r0) - rowPx / 2;
          ctx.drawImage(img, 0, r0, img.width, r1 - r0 + 1, x0, top, c.width, (r1 - r0 + 1) * rowPx);
        }
        return;
      }
      const max = c.kind === 'bar' ? maxOf(c) : 0;
      for (let r = r0; r <= r1; r += step) {
        const i = rows.idx[r];
        if (tree.childCount[i] !== 0) continue; // collapsed clade row: no cell
        const val = c.values[tree.tipLabels[tree.tipRank[i]]];
        if (val === undefined) continue; // unmatched tip: nothing drawn
        const yc = toY(r);
        if (c.kind === 'bar') {
          ctx.fillStyle = barC;
          const h = Math.max(1, rowPx * 0.8);
          ctx.fillRect(x0 + 2, yc - h / 2, barWidth(Number(val), max, c.width), h);
        } else if (rowPx >= 8) {
          const fs = Math.min(12, rowPx * 0.7);
          ctx.fillStyle = fg;
          ctx.font = `${fs}px ${fam}`;
          ctx.textBaseline = 'middle';
          ctx.fillText(String(val), x0 + 2, yc, c.width - 4);
        } else {
          ctx.fillStyle = barC;
          ctx.globalAlpha = 0.35;
          ctx.fillRect(x0 + 2, yc - rowPx / 2, c.width - 4, Math.max(1, rowPx));
          ctx.globalAlpha = 1;
        }
      }
    });
  };
  useLayoutEffect(() => {
    drawColumns();
    // adapter LOD through CSS: the library draws every label at every zoom, so hide the label text while rows are thinner than 8 px
    const m = viewMap();
    const px = !m ? Infinity : isRadial ? tipGap * m.a : (rowsRef.current.gap || 1) * m.d;
    wrapRef.current?.classList.toggle('gv-dense', hideDense && px < 8);
  });

  // ---- focus: spacing + controlled viewport
  useEffect(() => {
    const fr = props.focusRequest;
    if (fr && fr.seq !== lastSeq.current) {
      lastSeq.current = fr.seq;
      pending.current = { tipId: fr.tipId, seq: fr.seq };
    }
  });
  useEffect(() => {
    const p = pending.current;
    const svg = svgRef.current;
    if (!p || !svg) return;
    const i = tree.tipIndex(p.tipId);
    if (i < 0) {
      pending.current = null;
      return;
    }
    const ni = i; // tipIndex() is the preorder node index of the tip
    // inside a collapsed clade: expand it first
    const hiddenBy = selection.collapsed.filter((id) => {
      const ci = prep.idToIdx.get(id);
      return ci !== undefined && ci !== ni && ni >= ci && ni < tree.subtreeEnd[ci];
    });
    if (hiddenBy.length) {
      setSelection((s) => ({ ...s, collapsed: s.collapsed.filter((c) => !hiddenBy.includes(c)) }));
      return;
    }
    const id = prep.ids[ni];
    const c = svg.querySelector(`circle[data-node-id="${id}"]`) as SVGCircleElement | null;
    if (!c) return; // not rendered yet (layout changing): retried on the next commit
    let ox = 0, oy = 0;
    const g = c.parentNode as SVGGElement;
    if (g.transform && g.transform.baseVal.numberOfItems > 0) {
      const m = g.transform.baseVal.consolidate()?.matrix;
      if (m) { ox = m.e; oy = m.f; }
    }
    const tx = c.cx.baseVal.value + ox, ty = c.cy.baseVal.value + oy;
    const W = svgW, H = svgH;
    if (!isRadial) {
      const rows = rowsRef.current;
      const gap = rows.gap || 1;
      if (gap < 14 && spacing === undefined) {
        setAutoSpacing(18); // rows too thin to read: the library's answer to many tips is leafSpacing
        return;
      }
      const lastY = rows.count ? rows.y[rows.count - 1] : ty;
      const contentH = Math.max(H, lastY + 10 + (showScale && libLayout !== 'cladogram' ? 30 : 0));
      const y0 = Math.max(0, Math.min(contentH - H, ty - H / 2));
      pending.current = null;
      setViewport({ x0: 0, x1: W, y0, y1: y0 + H, xMin: 0, xMax: W, yMin: 0, yMax: contentH });
    } else {
      const z = virtual ? 1 : 4; // virtual canvas: 1 user unit = 1 px, tips 14 px apart
      const sx = W / z, sy = H / z;
      const x0 = Math.max(0, Math.min(libW - sx, tx - sx / 2));
      const y0 = Math.max(0, Math.min(libH - sy, ty - sy / 2));
      pending.current = null;
      setViewport({ x0, x1: x0 + sx, y0, y1: y0 + sy, xMin: 0, xMax: libW, yMin: 0, yMax: libH });
    }
  });

  // ---- handle for the runner (client px)
  const nodeCircle = (id: string): SVGCircleElement | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    return svg.querySelector(`circle[data-node-id="${id}"]`) as SVGCircleElement | null;
  };
  const visibleRect = () => {
    const svg = svgRef.current;
    const r = (leftRef.current ?? wrapRef.current)!.getBoundingClientRect();
    const s = svg ? svg.getBoundingClientRect() : r;
    return { left: Math.max(r.left, s.left), top: Math.max(r.top, s.top), right: Math.min(r.right, s.right), bottom: Math.min(r.bottom, s.bottom) };
  };
  const handle: ViewHandle = {
    locate(t) {
      const i = t.kind === 'tip' ? tree.tipIndex(t.id) : tree.isNodeId(t.id) ? tree.nodeIndex(t.id) : -1;
      if (i < 0) return null;
      const c = nodeCircle(prep.ids[i]);
      if (!c) return null;
      const r = c.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const v = visibleRect();
      return x >= v.left + 1 && x <= v.right - 1 && y >= v.top + 1 && y <= v.bottom - 1 ? { x, y } : null;
    },
    bounds(t) {
      const i = t.kind === 'tip' ? tree.tipIndex(t.id) : tree.isNodeId(t.id) ? tree.nodeIndex(t.id) : -1;
      if (i < 0) return null;
      const m = ctmOf();
      const svg = svgRef.current;
      if (!m || !svg) return null;
      const v = visibleRect();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const ni = i;
      const end = t.kind === 'tip' ? ni + 1 : tree.subtreeEnd[ni];
      // extent of the clade = union of the marker boxes of its nodes (internal markers are always drawn)
      const lim = end - ni > 4000 ? 4000 : end - ni;
      const stepK = Math.max(1, Math.floor((end - ni) / lim));
      for (let k = ni; k < end; k += stepK) {
        const c = nodeCircle(prep.ids[k]);
        if (!c) continue;
        const r = c.getBoundingClientRect();
        if (r.left < x0) x0 = r.left;
        if (r.top < y0) y0 = r.top;
        if (r.right > x1) x1 = r.right;
        if (r.bottom > y1) y1 = r.bottom;
      }
      if (!isFinite(x0)) return null;
      x0 = Math.max(v.left, x0);
      y0 = Math.max(v.top, y0);
      x1 = Math.min(v.right, x1);
      y1 = Math.min(v.bottom, y1);
      if (x1 - x0 < 1 || y1 - y0 < 1) return null;
      return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } as Rect;
    },
    locateCell(colId, tipId) {
      const k = columns.findIndex((c) => c.id === colId);
      const i = tree.tipIndex(tipId);
      if (k < 0 || i < 0 || isRadial) return null;
      const c = columns[k];
      const val = c.values[tipId];
      if (val === undefined) return null;
      const rows = rowsRef.current;
      const row = rows.rowOfTipRank[tree.tipRank[i]];
      const m = ctmOf();
      const cv = canvasRef.current;
      if (row === undefined || row < 0 || !m || !cv) return null;
      const cr = cv.getBoundingClientRect();
      const yc = m.d * rows.y[row] + m.f;
      if (yc < cr.top || yc > cr.bottom) return null;
      const rowPx = rows.gap * m.d;
      const max = c.kind === 'bar' ? maxOf(c) : 0;
      const w = c.kind === 'bar' ? barWidth(Number(val), max, c.width) : c.width - 4;
      const h = c.kind === 'bar' ? Math.max(1, rowPx * 0.8) : Math.max(1, rowPx);
      return { x: cr.left + colLeft(k) + 2, y: yc - h / 2, width: w, height: h };
    },
    custom() {
      return { tips: tree.tipCount, nodes: tree.nodeCount, rows: rowsRef.current.count, commitMs: lastCommitMs.current, parseMs: prep.parseMs, leafSpacing: spacing ?? 0 };
    },
  };
  useLayoutEffect(() => {
    props.handleRef.current = handle;
    return () => {
      props.handleRef.current = null;
    };
  });

  // ---- ready
  const readied = useRef(false);
  useEffect(() => {
    if (readied.current) return;
    readied.current = true;
    const svg = svgRef.current;
    const drawn = svg ? svg.querySelectorAll('g.tipnode, g.collapsed-clade').length : 0;
    props.onReady({
      parseMs: prep.parseMs,
      tips: leafNamesRef.current.length || drawn,
      notes: `react-bio-viz ${LIB_VERSION} parseNewick ${prep.parseMs.toFixed(1)} ms (library parser, recursive); ids mapped by preorder (${prep.mapping}, ${prep.mismatches} mismatches); first commit ${lastCommitMs.current.toFixed(0)} ms; derived-lengths=${variant.derived}; tips = leaf names from onLeafOrderChange`,
    });
  }, []);

  const common = {
    tree: libRoot,
    width: libW,
    height: libH,
    layout: libLayout as 'rectangular' | 'cladogram' | 'radial',
    showSupportValues: showSupport,
    shadeBranchBySupport: shadeSupport,
    leafMarkerColor: colours.marker,
    fontSize: 10,
    alignTips,
    leafTextComponent: leafText,
    searchQuery,
    searchUseRegex: true,
    showScaleBar: showScale && mode !== 'radial-height',
    showBranchLengths: showBranchLen,
    branchWidth: virtual ? 3 : 1.25, // virtual radial canvas is shown at ~0.15x: thicker user-unit lines keep the fit view visible
    nodeRadius,
    labelFontSize: 11,
    leafSpacing: spacing,
    nodeStyles,
    branchStyles,
    onNodeClick: handleNode,
    onBranchClick: branchClicks ? handleBranch : undefined,
    dragEnabled: dragOn,
    onLeafOrderChange: (names: string[]) => {
      leafNamesRef.current = names;
    },
    svgRef,
    viewport,
    onViewportChange: setViewport,
    selection,
    onSelectionChange: setSelection,
  };

  return (
    <div ref={wrapRef} className={'gv' + (theme.dark ? ' dark' : '')} style={styleVars} aria-label={`Phylogenetic tree, ${tree.tipCount} tips (react-bio-viz)`}>
      <style>{CSS}</style>
      <div ref={leftRef} className="gv-left" style={{ width: svgW, height: size.height }}>
        {toolbar ? <PhyloTree {...common} /> : <SimplePhyloTree {...common} />}
      </div>
      {hasCols && (
        <div className="gv-right" style={{ width: colsW, height: size.height }}>
          <div className="gv-hdr" style={{ height: toolbar ? tbH : 22, ['--gv-hdr-h' as string]: (toolbar ? tbH : 22) + 'px' }}>
            {columns.map((c, k) => (
              <span key={c.id} style={{ left: colLeft(k) + 2, width: c.width - 4 }}>
                {c.header}
              </span>
            ))}
          </div>
          <canvas ref={canvasRef} aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

const capabilities: CapabilityReport = {
  tipClick: { level: 'yes', how: 'onNodeClick fires for leaf markers (TreeNodeInfo.isLeaf); markers are drawn for every leaf and receive clicks as soon as onNodeClick is set' },
  internalNodeClick: { level: 'yes', how: 'onNodeClick on the internal-node marker (drawn when onNodeClick or interactive is set); payload carries leafNames and descendantIds' },
  branchClick: { level: 'yes', how: 'onBranchClick adds a wide transparent hit path per branch; reports the node below the branch with its leafNames' },
  hover: { level: 'partial', how: 'the library has no hover callback. Workaround: delegated DOM mouseover on the wrapper (circle[data-node-id], path[data-branch-id], label group); tip sets are derived from the shared TreeModel (source adapter-derived)' },
  descendantTipsInPayload: { level: 'yes', how: 'TreeNodeInfo.leafNames (all leaves below the node) in the library payload on click; not on hover (adapter-derived there)' },
  cladeColouring: { level: 'partial', how: 'nodeStyles/branchStyles (colour per node id) for every descendant id, built in React state. Works, but each change re-renders the whole tree body (all nodes), so it is not an incremental update and cost grows with tree size; branch width cannot change per clade' },
  highlightTip: { level: 'yes', how: 'nodeStyles colour+bold on the tip marker and a halo/bold in the leafTextComponent slot; optional library search (searchQuery regex) dims all other tips' },
  focusTip: { level: 'partial', how: 'no focus API. Workaround: leafSpacing (px per row, library prop) when rows are thinner than 14 px, then a computed controlled viewport read back from the rendered marker position; relayouts the whole tree; radial zooms 8x around the marker' },
  tipAsLink: { level: 'yes', how: 'leafTextComponent renders an SVG <a href target=_blank data-tip-id tabindex=0> around the label text for every tip (all tips are in the DOM, there is no culling)' },
  customColumns: { level: 'partial', how: 'the library has no per-tip columns. Workaround: own canvas right of the tree, rows read back from the rendered markers and aligned through svg.getScreenCTM() on every viewport change; rectangular layouts only' },
  alignmentColumn: { level: 'partial', how: 'same own canvas as customColumns (residue runs coloured per amino acid); not a library feature (react-bio-viz has a separate MultipleSequenceAlignment component whose row order can be linked, not used here)' },
  radialLayout: { level: 'yes', how: 'layout="radial": circular phylogram with labels on spokes (names truncated to 24 chars); columns are not drawn in radial' },
  branchLengthToggle: { level: 'partial', how: 'rectangular: layout rectangular (phylogram) versus cladogram (library). Radial is always a phylogram: the cladogram variant feeds synthetic lengths (clade height differences, adapter-derived) so tips align; negative lengths are clamped to 0 in a copy' },
  scaleBar: { level: 'yes', how: 'showScaleBar (default on) draws an I-beam of a round length at the bottom of the tree; no time axis for dated trees; hidden in cladogram layout' },
  darkTheme: { level: 'partial', how: 'no theme prop: the stylesheet reads a .dark class and shadcn CSS variables (--background, --foreground, --primary, ...); the adapter sets them on its wrapper from gbifDarkTheme(). Branches/markers are currentColor so they follow; support/scale text keep sans-serif unless overridden with !important CSS' },
  cssTokens: { level: 'partial', how: 'CSS custom properties (--background, --foreground, --rbv-accent, shadcn tokens) are honoured; label font only via the leafTextComponent slot; support-value, scale-bar and collapsed-clade fonts are inline sans-serif and need !important CSS to change; branch opacity is a presentation attribute (CSS opacity:1 overrides)' },
  multipleInstances: { level: 'yes', how: 'no module-level state seen; per-instance Zustand store, two instances tested through window.__spike2' },
  cleanUnmount: { level: 'yes', how: 'React unmount; window pointer listeners are removed by the library effect cleanup; injected <style id> stays in document.head by design' },
  controlledState: { level: 'yes', how: 'viewport/onViewportChange and selection/onSelectionChange are controlled props (also *Store variants); colours, layout and all other inputs are plain props' },
  zoomToFit: { level: 'yes', how: 'the viewport is clamped to the extent, so zooming out stops at the fit view; PhyloTree toolbar has a reset button; fit on mount and layout change by the adapter (viewport state reset)' },
  overviewOrMinimap: { level: 'no', how: 'no minimap; no level of detail or culling: every node and label stays in the SVG at every zoom (collapse is manual or collapseBySupport)' },
};

export const adapter: CandidateAdapter = {
  candidate: {
    name: 'react-bio-viz',
    version: LIB_VERSION,
    license: 'MIT',
    notes: 'PhyloTree/SimplePhyloTree (SVG, one element set per node, no culling). Adapter workarounds: DOM hover, own column canvas, leafSpacing+viewport focus, synthetic lengths for radial cladogram.',
  },
  capabilities,
  View: RbvView,
  features: [
    { id: 'toolbar', label: 'Library toolbar (PhyloTree) instead of SimplePhyloTree', kind: 'toggle', default: true, description: 'PhyloTree adds the pan/zoom/reset buttons; SimplePhyloTree is the bare, fully controlled view.' },
    { id: 'rowHeight', label: 'Row height (leafSpacing)', kind: 'select', default: 'fit', options: [{ value: 'fit', label: 'Fit the tree to the height' }, { value: '12', label: '12 px per tip' }, { value: '18', label: '18 px per tip' }, { value: '28', label: '28 px per tip' }], description: 'The library draws everything; for many tips its answer is a tall tree you scroll (leafSpacing).' },
    { id: 'clickAction', label: 'Click on an internal node', kind: 'select', default: 'colour', options: [{ value: 'colour', label: 'Report + colour clade (demo)' }, { value: 'collapse', label: 'Collapse clade (library)' }, { value: 'reroot', label: 'Reroot above node (library)' }], description: 'Collapse and reroot are the library\'s own selection state (selection.collapsed, rerootedAt).' },
    { id: 'ladderize', label: 'Ladderize', kind: 'select', default: 'none', options: [{ value: 'none', label: 'File order' }, { value: 'asc', label: 'Small clades first' }, { value: 'desc', label: 'Large clades first' }], description: 'ladderizeOrder() -> selection.order. Re-sorts the tips; columns follow the library order.' },
    { id: 'midpoint', label: 'Midpoint root', kind: 'toggle', default: false, description: 'midpointRoot() -> selection.rerootedAt. Node ids stay valid, clade tip sets of nodes on the old root path change.' },
    { id: 'dissolveSupport', label: 'Dissolve nodes with support below', kind: 'select', default: '0', options: [{ value: '0', label: 'Off' }, { value: '0.9', label: '< 0.9 (support on a 0 to 1 scale)' }, { value: '50', label: '< 50 (percent scale)' }, { value: '90', label: '< 90 (percent scale)' }], description: 'collapseBySupport(): dissolves internal nodes whose numeric label is below the value into polytomies. Needs numeric internal labels; most test trees have none, and the library does not know the scale (0-1 versus 0-100).' },
    { id: 'showSupport', label: 'Internal labels / support values', kind: 'toggle', default: false, description: 'showSupportValues: prints every internal node name.' },
    { id: 'shadeSupport', label: 'Fade branches by support', kind: 'toggle', default: false, description: 'shadeBranchBySupport (numeric parent labels become the branch opacity).' },
    { id: 'showBranchLengths', label: 'Branch length labels', kind: 'toggle', default: false, description: 'showBranchLengths: a number on every branch.' },
    { id: 'scaleBar', label: 'Scale bar', kind: 'toggle', default: true, description: 'showScaleBar (phylogram only).' },
    { id: 'alignTips', label: 'Align labels in one column', kind: 'toggle', default: true, description: 'alignTips: labels in a column versus right after each branch.' },
    { id: 'nodeRadius', label: 'Node marker radius', kind: 'select', default: 'auto', options: [{ value: 'auto', label: 'Auto (follows tip spacing)' }, { value: '1', label: '1 px' }, { value: '0', label: '0 (hides every marker, also tip click targets)' }, { value: '2', label: '2 px' }, { value: '3', label: '3 px' }, { value: '4', label: '4 px (library default)' }, { value: '6', label: '6 px' }], description: 'One radius for all markers: there is no per-node size or shape.' },
    { id: 'branchClicks', label: 'Branch click targets', kind: 'toggle', default: true, description: 'onBranchClick adds an invisible wide path per branch (more DOM).' },
    { id: 'drag', label: 'Drag nodes to reorder / reroot', kind: 'toggle', default: false, description: 'dragEnabled: drag a marker among its siblings, or past the first/last row to reroot. Not available in radial.' },
    { id: 'dimOthers', label: 'Dim tips that are not highlighted', kind: 'toggle', default: false, description: 'Library search (searchQuery as a regex of the highlighted tips): bolds matches, dims the rest.' },
    { id: 'hideDense', label: 'Hide tip labels while rows are thinner than 8 px', kind: 'toggle', default: true, level: 'partial', how: 'The library draws every label at every zoom (they overlap into a blob). The adapter hides the label text with CSS (class on the wrapper, computed from the viewport) as a level-of-detail stand-in; the label elements and links stay in the DOM.', description: 'Not a library option: turn it off to see what the library draws.' },
    { id: 'wheelZoom', label: 'Plain wheel zooms (adapter patch)', kind: 'toggle', default: false, level: 'partial', how: 'The library pans on plain wheel and zooms on Ctrl/Cmd+wheel. This patch re-dispatches wheel events with ctrlKey set from a capture listener.', description: 'Not a library option.' },
  ],
};
