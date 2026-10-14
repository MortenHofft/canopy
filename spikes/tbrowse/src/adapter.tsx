// tbrowse adapter (tbrowse 2.10.0, MIT, React 18). See ../spike.json and docs/results/tbrowse.md.
//
// How a gbif.org developer would use it:  <TBrowse tree zones viewState onViewStateChange hostData ... />
//  * tree: tbrowse takes a flat node table {id, parentId, distance, isLeaf, geneId, bootstrap}; it is built from the shared
//    TreeModel (convertTree, timed and reported as parseMs). Node ids are the shared ids ('n<preorder>') so no mapping is needed.
//  * zones: the built-in treeZone / msaZone, plus our own ZoneDefinitions: a label zone ("tips": real <a> links, clade colour,
//    highlight band) and one zone per custom column (bar / text). Per-instance data reaches them through the `hostData` prop.
//  * state: viewState is CONTROLLED (React state here); clicks arrive as ViewState.selectedNodeId changes; hover is read from
//    ZoneRenderProps.hoveredNodeId inside our own zone. Collapse / prune / swap / row height / layout mode are ViewState fields.
//  * workarounds (reported `partial`): clade colouring (the library has no such prop) patches inline styles on the tree SVG;
//    tip sets of clicks and hovers are computed from the shared TreeModel (source: adapter-derived); highlight reuses the
//    library's search state through a host SearchField; focus scrolls the library's own scroll container.
// Nothing here is recursive over trees (typed-array passes only).

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TBrowse, treeZone, labelsZone, msaZone, computeVisibleRows } from 'tbrowse';
import type { MSA, SearchField, Tree, TreeNode, ViewState, VisibleRow, ZoneDefinition, ZoneRenderProps } from 'tbrowse';
import type { AdapterFeature, CandidateAdapter, CapabilityReport, ColumnSpec, EmitEvent, Point, Rect, ThemeSpec, ViewHandle, ViewProps } from '../../shared/types.ts';
import { gbifTheme, gbifDarkTheme } from '../../shared/gbif-theme.ts';
import type { TreeModel } from '../../shared/tree.ts';

const TBROWSE_VERSION = '2.10.0';
const HEADER_H = 56; // zone header row height inside the library grid (Layout.tsx HEADER_HEIGHT)
const LEAF_R = '2.5'; // tree zone leaf glyph radius attribute (Tree.tsx LEAF_GLYPH_RADIUS)

// ------------------------------------------------------------------------------------------ data conversion

interface Converted {
  tree: Tree;
  scale: number;
  ms: number;
  leaves: number;
}

/**
 * TreeModel -> tbrowse's flat node table. tbrowse floors every branch at an ABSOLUTE 0.01 (zones/tree/layout.ts
 * MIN_BRANCH_DISTANCE), so a tree whose root-to-tip depth is small (substitutions per site, typical branch 1e-3) would be drawn
 * as a cladogram and an ultrametric tree would lose its aligned tips. When the maximum root-to-tip length is below 100 the
 * lengths are multiplied by a power of ten that lifts it to at least 100 (proportions kept); the library tooltip then shows
 * the scaled number (reported as lengthScale).
 */
function convertTree(t: TreeModel, rescale: boolean): Converted {
  const t0 = performance.now();
  const D = t.maxCumLength;
  const scale = rescale && D > 0 && D < 100 ? Math.pow(10, Math.ceil(Math.log10(100 / D))) : 1;
  const nodes: Record<string, TreeNode> = {};
  let leaves = 0;
  for (let i = 0; i < t.nodeCount; i++) {
    const isLeaf = t.childCount[i] === 0;
    const l = t.length[i];
    const n: TreeNode = { id: 'n' + i, parentId: i === 0 ? null : 'n' + t.parent[i], distance: l === l ? l * scale : 0, isLeaf };
    if (isLeaf) {
      n.geneId = t.labels[i];
      leaves++;
    } else if (t.support[i] === t.support[i]) n.bootstrap = t.support[i];
    nodes['n' + i] = n;
  }
  return { tree: { rootId: 'n0', nodes }, scale, ms: performance.now() - t0, leaves };
}

// ------------------------------------------------------------------------------------------ geometry mirror
// tbrowse does not expose where it drew a node. The tree zone's y positions are a pure function of the visible rows
// (end y = row centre, internal y = midpoint of the first and last visible child), so they are recomputed here with the
// library's own computeVisibleRows and the same formula. Used for locate / bounds / focus / colour patching only.

interface Geo {
  key: string;
  rows: VisibleRow[];
  rowH: number;
  endTop: Float64Array; // NaN when the node is not a row (leaf row or collapsed summary)
  endH: Float64Array;
  yc: Float64Array; // drawn y centre, NaN when not visible
  lo: Float64Array; // top of the first row below
  hi: Float64Array; // bottom of the last row below
  pairs: Map<string, number> | null;
}

const pairKey = (py: number, cy: number) => Math.round(py * 100) + '|' + Math.round(cy * 100);

function buildGeo(tm: TreeModel, tb: Tree, vs: ViewState, rowH: number, key: string): Geo | null {
  let rows: VisibleRow[];
  try {
    rows = computeVisibleRows({ tree: tb, collapsedNodeIds: new Set(vs.collapsedNodeIds), prunedNodeIds: new Set(vs.prunedNodeIds), swappedNodeIds: new Set(vs.swappedNodeIds), rowHeight: rowH });
  } catch {
    return null; // the library's own row derivation is recursive: a very deep tree overflows the stack there first
  }
  const n = tm.nodeCount;
  const endTop = new Float64Array(n).fill(NaN);
  const endH = new Float64Array(n).fill(NaN);
  for (const r of rows) {
    const i = Number(r.nodeId.slice(1));
    endTop[i] = r.y;
    endH[i] = r.height;
  }
  const yc = new Float64Array(n).fill(NaN);
  const lo = new Float64Array(n).fill(Infinity);
  const hi = new Float64Array(n).fill(-Infinity);
  const minC = new Float64Array(n).fill(Infinity);
  const maxC = new Float64Array(n).fill(-Infinity);
  for (let i = n - 1; i >= 0; i--) {
    if (endTop[i] === endTop[i]) {
      yc[i] = endTop[i] + endH[i] / 2;
      lo[i] = endTop[i];
      hi[i] = endTop[i] + endH[i];
    } else if (minC[i] <= maxC[i]) yc[i] = (minC[i] + maxC[i]) / 2;
    else continue;
    if (i > 0) {
      const p = tm.parent[i];
      if (yc[i] < minC[p]) minC[p] = yc[i];
      if (yc[i] > maxC[p]) maxC[p] = yc[i];
      if (lo[i] < lo[p]) lo[p] = lo[i];
      if (hi[i] > hi[p]) hi[p] = hi[i];
    }
  }
  return { key, rows, rowH, endTop, endH, yc, lo, hi, pairs: null };
}

function pairMap(g: Geo, tm: TreeModel): Map<string, number> {
  if (g.pairs) return g.pairs;
  const m = new Map<string, number>();
  for (let i = 1; i < tm.nodeCount; i++) if (g.yc[i] === g.yc[i] && g.yc[tm.parent[i]] === g.yc[tm.parent[i]]) m.set(pairKey(g.yc[tm.parent[i]], g.yc[i]), i);
  g.pairs = m;
  return m;
}

const PATH_RE = /^M ([-\d.e+]+) ([-\d.e+]+) L ([-\d.e+]+) ([-\d.e+]+) L ([-\d.e+]+) ([-\d.e+]+)$/;
function parsePath(d: string | null): { px: number; py: number; cx: number; cy: number } | null {
  if (!d) return null;
  const m = PATH_RE.exec(d);
  return m ? { px: Number(m[1]), py: Number(m[2]), cx: Number(m[5]), cy: Number(m[6]) } : null;
}

// ------------------------------------------------------------------------------------------ host bag for our zones

interface Clade {
  a: number; // node index (preorder range [a, b))
  b: number;
  colour: string;
}
interface Bag {
  tm: TreeModel;
  clades: Clade[];
  highlighted: ReadonlySet<string>;
  tipLinks: ((id: string) => string) | null;
  cols: Record<string, ColumnSpec>;
  barColour: string;
  onHover: (nodeId: string | null) => void;
}
const bagOf = (d: ZoneRenderProps['data']): Bag | undefined => d.hostData?.gbif as Bag | undefined;

function cladeColour(bag: Bag, nodeIdx: number): string | undefined {
  let c: string | undefined;
  for (const k of bag.clades) if (nodeIdx >= k.a && nodeIdx < k.b) c = k.colour;
  return c;
}

const rowBase = (r: VisibleRow): React.CSSProperties => ({
  position: 'absolute',
  top: r.y,
  left: 0,
  right: 0,
  height: r.height,
  display: 'flex',
  alignItems: 'center',
  borderBottom: '1px solid var(--tbrowse-border-row)',
  opacity: r.opacity ?? 1,
  overflow: 'hidden',
});

function rowBackground(p: ZoneRenderProps, r: VisibleRow, hl: boolean): string {
  if (hl) return 'var(--tbrowse-accent-soft)';
  if (p.selectedNodeId === r.nodeId) return 'var(--tbrowse-row-select-bg)';
  if (p.hoveredNodeId === r.nodeId) return 'var(--tbrowse-row-hover-bg)';
  if (p.hoveredSubtreeIds.has(r.nodeId)) return 'var(--tbrowse-row-subtree-bg)';
  return 'transparent';
}

// ---- tips zone (replaces the built-in labels zone: real links, clade colour, highlight)

function TipsHeader(p: ZoneRenderProps) {
  const bag = bagOf(p.data);
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px 0 18px', fontSize: 13, color: 'var(--tbrowse-text)' }}>
      <span style={{ fontWeight: 600 }}>Tips</span>
      <span style={{ color: 'var(--tbrowse-text-muted)', fontSize: 11 }}>{bag ? bag.tm.tipCount + ' tips' : ''}</span>
    </div>
  );
}

function TipsBody(p: ZoneRenderProps) {
  const bag = bagOf(p.data);
  const hovered = p.hoveredNodeId;
  useEffect(() => {
    bag?.onHover(hovered);
  }, [hovered, bag]);
  if (!bag) return null;
  const rows = p.visibleRows.slice(p.rowRange.startIndex, p.rowRange.endIndex);
  return (
    <div role="list" aria-label="Tips" data-zone="tips">
      {rows.map((r) => {
        const idx = Number(r.nodeId.slice(1));
        const collapsed = r.kind === 'collapsedSummary';
        const label = collapsed ? '' : (p.data.tree.nodes[r.nodeId]?.geneId ?? r.nodeId);
        const hl = !collapsed && bag.highlighted.has(label);
        const colour = cladeColour(bag, idx);
        const select = () => p.onSelectNode(r.nodeId);
        const tiny = r.height < 9; // adapter-side level of detail: no text when the row is too thin to read (the library draws it anyway)
        const common = {
          'data-tip-id': collapsed ? undefined : label,
          style: { color: colour ?? (collapsed ? 'var(--tbrowse-text-muted)' : 'var(--tbrowse-text)'), fontStyle: collapsed ? 'normal' : 'italic', fontWeight: hl || colour ? 600 : 400, textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', outlineOffset: 1 } as React.CSSProperties,
        };
        return (
          <div
            key={r.nodeId}
            role="listitem"
            data-row-node={r.nodeId}
            onMouseEnter={() => p.onHoverNode(r.nodeId)}
            onMouseLeave={() => p.onHoverNode(null)}
            onClick={select}
            style={{ ...rowBase(r), padding: '0 10px', fontSize: 'var(--tbrowse-font-size, 12px)', cursor: 'pointer', background: rowBackground(p, r, hl), borderLeft: hl ? '3px solid var(--tbrowse-accent)' : colour ? `3px solid ${colour}` : '3px solid transparent' }}
          >
            {tiny ? null : collapsed ? (
              <span {...common}>{r.leafCount} tips</span>
            ) : bag.tipLinks ? (
              <a {...common} href={bag.tipLinks(label)} target="_blank" rel="noopener noreferrer" tabIndex={0} onClick={(e) => e.stopPropagation()} style={{ ...common.style, textDecoration: 'underline' }}>
                {label}
              </a>
            ) : (
              <span {...common} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && select()}>
                {label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

const tipsZone = {
  id: 'tips',
  displayName: 'Tips',
  Header: TipsHeader,
  Body: TipsBody,
  defaultWidth: 20,
  minWidth: 120,
  defaultZoneState: {},
  isAvailable: (d: ZoneRenderProps["data"]) => !!bagOf(d),
} as unknown as ZoneDefinition;

// ---- one zone per custom column (bar / text), created once per column id so React keeps the component type stable

const colZones = new Map<string, ZoneDefinition>();
function barWidth(v: number, max: number, w: number): number {
  if (!(max > 0) || !(v > 0)) return 1;
  return Math.max(1, (Math.log10(1 + v) / Math.log10(1 + max)) * (w - 8));
}
function columnZone(spec: ColumnSpec): ZoneDefinition {
  let z = colZones.get(spec.id);
  if (z) return z;
  const id = spec.id;
  const Header = (p: ZoneRenderProps) => {
    const c = bagOf(p.data)?.cols[id];
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', padding: '0 10px 0 18px', fontSize: 13, fontWeight: 600, color: 'var(--tbrowse-text)' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c?.header ?? id}</span>
      </div>
    );
  };
  const Body = (p: ZoneRenderProps) => {
    const bag = bagOf(p.data);
    const col = bag?.cols[id];
    const max = useMemo(() => {
      let m = 0;
      if (col?.kind === 'bar') for (const k in col.values) m = Math.max(m, Number(col.values[k]));
      return m;
    }, [col]);
    if (!bag || !col) return null;
    const tm = bag.tm;
    const rows = p.visibleRows.slice(p.rowRange.startIndex, p.rowRange.endIndex);
    return (
      <div data-zone={id}>
        {rows.map((r) => {
          const idx = Number(r.nodeId.slice(1));
          const collapsed = r.kind === 'collapsedSummary';
          let val: number | string | undefined;
          let aggregated = false;
          if (collapsed) {
            // adapter-derived summary of a collapsed clade: mean of the matched values (bar) or nothing (text)
            if (col.kind === 'bar') {
              let s = 0;
              let k = 0;
              for (let q = tm.leafStart[idx]; q < tm.leafEnd[idx]; q++) {
                const v = col.values[tm.tipLabels[q]];
                if (v !== undefined) {
                  s += Number(v);
                  k++;
                }
              }
              if (k) val = s / k;
              aggregated = true;
            }
          } else val = col.values[p.data.tree.nodes[r.nodeId]?.geneId ?? ''];
          const tip = collapsed ? undefined : (p.data.tree.nodes[r.nodeId]?.geneId ?? '');
          const hl = !collapsed && bag.highlighted.has(tip ?? '');
          const colour = cladeColour(bag, idx);
          return (
            <div key={r.nodeId} data-col={id} data-tip-id={tip} style={{ ...rowBase(r), padding: '0 6px', background: rowBackground(p, r, hl), fontSize: 'var(--tbrowse-font-size, 12px)', color: 'var(--tbrowse-text)' }}>
              {val === undefined ? null : col.kind === 'bar' ? (
                <div data-bar title={String(val)} style={{ height: Math.max(1, r.height * 0.7), width: barWidth(Number(val), max, col.width), background: colour ?? bag.barColour, opacity: aggregated ? 0.45 : 1, borderRadius: 1 }} />
              ) : (
                r.height < 9 ? null : <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(val)}</span>
              )}
            </div>
          );
        })}
      </div>
    );
  };
  z = { id, displayName: spec.header, Header, Body, defaultWidth: Math.max(8, Math.round(spec.width / 6)), minWidth: 60, defaultZoneState: {}, isAvailable: (d: ZoneRenderProps["data"]) => !!bagOf(d)?.cols[id] } as unknown as ZoneDefinition;
  colZones.set(id, z);
  return z;
}

// ------------------------------------------------------------------------------------------ theme

function themeCss(t: ThemeSpec): { css: string; vars: Record<string, string> } {
  const g = t.dark ? gbifDarkTheme() : gbifTheme();
  const k = t.tokens ?? {};
  const mix = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;
  const bg = k.background ?? g.bg1;
  const fg = k.foreground ?? g.fg1;
  const accent = k.highlight ?? g.primary;
  const vars: Record<string, string> = {
    '--tbrowse-bg': bg,
    '--tbrowse-bg-alt': k.background ?? g.surface,
    '--tbrowse-bg-strip': k.background ?? g.bg2,
    '--tbrowse-bg-elevated': bg,
    '--tbrowse-bg-input': bg,
    '--tbrowse-text': fg,
    '--tbrowse-text-muted': k.foreground ? mix(fg, 70) : g.fg3,
    '--tbrowse-text-subtle': k.foreground ? mix(fg, 50) : g.fg4,
    '--tbrowse-border': g.border,
    '--tbrowse-border-soft': g.tableBorder,
    '--tbrowse-border-row': g.tableBorder,
    '--tbrowse-divider': g.border,
    '--tbrowse-accent': accent,
    '--tbrowse-accent-strong': g.primaryHover,
    '--tbrowse-accent-soft': mix(accent, 16),
    '--tbrowse-accent-fg': t.dark ? g.dark : g.bg1,
    '--tbrowse-danger': g.danger,
    '--tbrowse-danger-soft': mix(g.danger, 14),
    '--tbrowse-search': accent,
    '--tbrowse-search-soft': mix(accent, 25),
    '--tbrowse-tooltip-shadow': mix(fg, 22),
    '--tbrowse-row-hover-bg': mix(accent, 10),
    '--tbrowse-row-select-bg': mix(accent, 18),
    '--tbrowse-row-subtree-bg': mix(accent, 5),
    '--tbrowse-branch': k.branch ?? (t.dark ? g.fg3 : g.fg2),
    '--tbrowse-leaf-extension': t.dark ? g.fg3 : g.slate200,
  };
  const body = Object.entries(vars)
    .map(([a, b]) => `${a}:${b}`)
    .join(';');
  return { css: `.gbif-tb.tbrowse-root{${body};font-family:${k.fontFamily ?? g.fontBody}}`, vars };
}

// ------------------------------------------------------------------------------------------ view state helpers

function sameExceptIdentity(a: ViewState, b: ViewState): boolean {
  const ka = Object.keys(a) as (keyof ViewState)[];
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

/** Greedy overview: expand the largest collapsed clade until the next split would exceed maxRows. Returns collapsed ids. */
function overviewCollapsed(tm: TreeModel, maxRows: number): string[] {
  const n = tm.nodeCount;
  if (tm.tipCount <= maxRows) return [];
  const size = (i: number) => tm.leafEnd[i] - tm.leafStart[i];
  // binary max-heap on clade size (indices into node array)
  const heap: number[] = [0];
  const swap = (a: number, b: number) => {
    const t = heap[a];
    heap[a] = heap[b];
    heap[b] = t;
  };
  const up = (i: number) => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (size(heap[p]) >= size(heap[i])) break;
      swap(p, i);
      i = p;
    }
  };
  const down = (i: number) => {
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < heap.length && size(heap[l]) > size(heap[m])) m = l;
      if (r < heap.length && size(heap[r]) > size(heap[m])) m = r;
      if (m === i) break;
      swap(m, i);
      i = m;
    }
  };
  let rows = 1;
  const collapsed: number[] = [];
  while (heap.length) {
    const top = heap[0];
    const kids = tm.childCount[top];
    if (kids === 0) {
      // a leaf at the top means everything left is a leaf
      break;
    }
    if (rows - 1 + kids > maxRows) break;
    // expand `top`
    heap[0] = heap[heap.length - 1];
    heap.pop();
    if (heap.length) down(0);
    rows += kids - 1;
    for (let c = tm.firstChild[top]; c >= 0; c = tm.nextSibling[c]) {
      heap.push(c);
      up(heap.length - 1);
    }
  }
  for (const i of heap) if (tm.childCount[i] > 0) collapsed.push(i);
  void n;
  return collapsed.map((i) => 'n' + i);
}

/** Swap list that orders children by clade size (binary-minded: reverses nodes whose first child is smaller/larger than the last). */
function swapList(tm: TreeModel, mode: string): string[] {
  if (mode === 'file') return [];
  const out: string[] = [];
  const size = (i: number) => tm.leafEnd[i] - tm.leafStart[i];
  for (let i = 0; i < tm.nodeCount; i++) {
    if (tm.childCount[i] < 2) continue;
    const first = tm.firstChild[i];
    let last = first;
    while (tm.nextSibling[last] >= 0) last = tm.nextSibling[last];
    const larger = size(first) >= size(last);
    if (mode === 'large-first' ? !larger : larger && size(first) !== size(last)) out.push('n' + i);
  }
  return out;
}

const ZONE_FR = { tree: 30, tips: 20, labels: 20 };

function rowHeightFor(features: Record<string, boolean | string>, size: { height: number }, tm: TreeModel): number {
  const f = String(features.rowHeight ?? '16');
  if (f !== 'fit') return Number(f);
  const toolbar = features.toolbar !== false;
  const rows = features.overview && features.overview !== 'off' ? Math.min(tm.tipCount, Number(features.overview)) : tm.tipCount;
  return Math.max(0.2, (size.height - HEADER_H - (toolbar ? 32 : 0) - 4) / Math.max(1, rows));
}

function initialViewState(tm: TreeModel, features: Record<string, boolean | string>, branchLengths: boolean, rowHeight: number): ViewState {
  const useBuiltinLabels = features.labels === 'builtin';
  return {
    selectedNodeId: null,
    collapsedNodeIds: features.overview && features.overview !== 'off' ? overviewCollapsed(tm, Number(features.overview)) : [],
    prunedNodeIds: [],
    swappedNodeIds: swapList(tm, String(features.order ?? 'file')),
    compressedNodeIds: [],
    nodeOfInterestId: null,
    zones: [
      { id: 'tree', width: ZONE_FR.tree, visible: features.showTree !== false },
      { id: useBuiltinLabels ? 'labels' : 'tips', width: ZONE_FR.tips, visible: features.showLabels !== false },
    ],
    zoneStates: { tree: { ...treeZone.defaultZoneState, layoutMode: branchLengths ? 'phylogram' : 'cladogram', autoCompressLongBranches: !!features.compress, showLeafExtensions: features.leafExt !== false } },
    search: null,
    rowHeight,
  };
}

function alphabetOf(seqs: Record<string, string>): MSA['alphabet'] {
  let n = 0;
  for (const k in seqs) {
    const s = seqs[k];
    for (let i = 0; i < Math.min(s.length, 400); i++) if (!/[ACGTUNacgtun\-.]/.test(s[i])) return 'protein';
    if (++n > 20) break;
  }
  return 'dna';
}

// ------------------------------------------------------------------------------------------ the view

function TbrowseView(props: ViewProps) {
  const { tree: tm, size, theme, features, highlightedTips, columns, tipLinks, colouredClades } = props;
  const rescale = features.rescale !== false;
  const conv = useMemo(() => convertTree(tm, rescale), [tm, rescale]);
  const [vs, setVs] = useState<ViewState>(() => initialViewState(tm, features, props.branchLengths, rowHeightFor(features, size, tm)));
  const vsRef = useRef(vs);
  vsRef.current = vs;
  const latest = useRef(props);
  latest.current = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const geoRef = useRef<Geo | null>(null);
  const patched = useRef<Set<SVGElement>>(new Set());
  const hoverRef = useRef<string | null>(null);

  const toolbar = features.toolbar !== false;
  const rowH = rowHeightFor(features, size, tm);

  // ---- clades (preorder ranges) for our zones and the DOM patch
  const clades = useMemo<Clade[]>(
    () =>
      colouredClades
        .filter((c) => tm.isNodeId(c.nodeId))
        .map((c) => {
          const a = tm.nodeIndex(c.nodeId);
          return { a, b: tm.subtreeEnd[a], colour: c.colour };
        }),
    [colouredClades, tm],
  );
  const highlighted = useMemo(() => new Set(highlightedTips), [highlightedTips]);
  const colsById = useMemo(() => {
    const m: Record<string, ColumnSpec> = {};
    for (const c of columns) if (c.kind !== 'alignment') m[c.id] = c;
    return m;
  }, [columns]);
  const g = useMemo(() => gbifTheme(), [theme.dark]);
  const onHover = useCallback((nodeId: string | null) => {
    if (nodeId === hoverRef.current) return;
    hoverRef.current = nodeId;
    if (!nodeId) return;
    const i = latest.current.tree.nodeIndex(nodeId);
    const isTip = latest.current.tree.childCount[i] === 0;
    latest.current.emit({ type: isTip ? 'tipHover' : 'nodeHover', nodeId, isTip, tipIds: latest.current.tree.descendantTips(i), source: 'adapter-derived', libraryPayload: { hoveredNodeId: nodeId, via: 'ZoneRenderProps.hoveredNodeId' } });
  }, []);
  const bag = useMemo<Bag>(() => ({ tm, clades, highlighted, tipLinks, cols: colsById, barColour: g.categorical[1], onHover }), [tm, clades, highlighted, tipLinks, colsById, g, onHover]);
  const hostData = useMemo(() => ({ gbif: bag }), [bag]);

  // ---- alignment column -> the built-in MSA zone
  const alignment = columns.find((c) => c.kind === 'alignment');
  const msa = useMemo<MSA | undefined>(() => {
    if (!alignment) return undefined;
    const seqs: Record<string, string> = {};
    let len = 0;
    for (const k in alignment.values) {
      const s = String(alignment.values[k]);
      seqs[k] = s;
      if (s.length > len) len = s.length;
    }
    return { alphabet: alphabetOf(seqs), length: len, sequences: seqs };
  }, [alignment]);

  // ---- zones
  const builtinLabels = features.labels === 'builtin';
  const zones = useMemo<ZoneDefinition[]>(() => {
    const z: ZoneDefinition[] = [treeZone as unknown as ZoneDefinition, builtinLabels ? (labelsZone as unknown as ZoneDefinition) : tipsZone];
    for (const c of columns) if (c.kind !== 'alignment') z.push(columnZone(c));
    if (alignment) z.push(msaZone as unknown as ZoneDefinition);
    return z;
  }, [columns, alignment, builtinLabels]);

  // ---- highlight through the library's search state: a host SearchField that matches the highlighted tips
  const searchFields = useMemo<SearchField[]>(
    () => [
      {
        id: 'host-highlight',
        label: 'Highlighted tips (from the host page)',
        buildPredicate: () => ({ ok: true as const, test: (n: TreeNode) => !!n.geneId && highlighted.has(n.geneId) }),
      },
    ],
    [highlighted],
  );
  useEffect(() => {
    setVs((prev) => {
      const searchOwn = prev.search?.excludedFields?.includes('gene-id') && prev.search.query.startsWith('highlighted:');
      if (highlighted.size === 0) return searchOwn ? { ...prev, search: null } : prev;
      return { ...prev, search: { query: `highlighted: ${highlighted.size} tip${highlighted.size === 1 ? '' : 's'}`, excludedFields: ['gene-id', 'gene-name', 'gene-description', 'node-id', 'taxonomy-scientific', 'taxonomy-common'] } };
    });
  }, [highlighted]);

  // ---- props -> ViewState (controlled state)
  useEffect(() => {
    setVs((prev) => {
      const cur = (prev.zoneStates.tree ?? treeZone.defaultZoneState) as Record<string, unknown>;
      const next = { ...cur, layoutMode: props.branchLengths ? 'phylogram' : 'cladogram', autoCompressLongBranches: !!features.compress, showLeafExtensions: features.leafExt !== false };
      if (cur.layoutMode === next.layoutMode && cur.autoCompressLongBranches === next.autoCompressLongBranches && cur.showLeafExtensions === next.showLeafExtensions) return prev;
      return { ...prev, zoneStates: { ...prev.zoneStates, tree: next } };
    });
  }, [props.branchLengths, features.compress, features.leafExt]);
  useEffect(() => {
    setVs((prev) => (prev.rowHeight === rowH ? prev : { ...prev, rowHeight: rowH }));
  }, [rowH]);
  const firstOverview = useRef(true);
  useEffect(() => {
    if (firstOverview.current) {
      firstOverview.current = false;
      return;
    }
    const ov = String(features.overview ?? 'off');
    setVs((prev) => ({ ...prev, collapsedNodeIds: ov === 'off' ? [] : overviewCollapsed(tm, Number(ov)), selectedNodeId: null }));
  }, [features.overview, tm]);
  const firstOrder = useRef(true);
  useEffect(() => {
    if (firstOrder.current) {
      firstOrder.current = false;
      return;
    }
    setVs((prev) => ({ ...prev, swappedNodeIds: swapList(tm, String(features.order ?? 'file')) }));
  }, [features.order, tm]);
  useEffect(() => {
    setVs((prev) => {
      const want = [
        { id: 'tree', visible: features.showTree !== false },
        { id: builtinLabels ? 'labels' : 'tips', visible: features.showLabels !== false },
      ];
      let changed = false;
      const zs = prev.zones.map((z) => {
        const w = want.find((x) => x.id === z.id);
        if (w && z.visible !== w.visible) {
          changed = true;
          return { ...z, visible: w.visible, userToggled: true };
        }
        return z;
      });
      return changed ? { ...prev, zones: zs } : prev;
    });
  }, [features.showTree, features.showLabels, builtinLabels]);
  useEffect(() => {
    const scheme = String(features.scheme ?? 'default');
    setVs((prev) => {
      const cur = (prev.zoneStates.msa ?? msaZone.defaultZoneState) as Record<string, unknown>;
      const id = scheme === 'default' ? undefined : scheme;
      if (cur.colorSchemeId === id) return prev;
      return { ...prev, zoneStates: { ...prev.zoneStates, msa: { ...cur, colorSchemeId: id } } };
    });
  }, [features.scheme]);

  // ---- clicks: ViewState.selectedNodeId is the library's click signal
  const onViewStateChange = useCallback((next: ViewState) => {
    const prev = vsRef.current;
    vsRef.current = next;
    setVs(next);
    const sel = next.selectedNodeId;
    if (!sel) return;
    if (sel === prev.selectedNodeId && !sameExceptIdentity(prev, next)) return; // some other change with the selection unchanged
    const L = latest.current;
    const i = L.tree.nodeIndex(sel);
    const isTip = L.tree.childCount[i] === 0;
    const e: EmitEvent = {
      type: isTip ? 'tipClick' : 'nodeClick',
      nodeId: sel,
      isTip,
      tipIds: isTip ? [L.tree.tipLabels[L.tree.tipRank[i]]] : L.tree.descendantTips(i),
      source: 'adapter-derived',
      libraryPayload: { selectedNodeId: sel, via: sel === prev.selectedNodeId ? 'ViewState (same id, re-click)' : 'ViewState.selectedNodeId' },
    };
    L.emit(e);
  }, []);

  // ---- geometry mirror (lazy, cached per layout-relevant view state)
  const geoKeyOf = (v: ViewState) => `${v.collapsedNodeIds.length}:${v.prunedNodeIds.length}:${v.swappedNodeIds.length}:${v.rowHeight ?? 16}`;
  const geoStamp = useRef<{ c: unknown; p: unknown; s: unknown; h: unknown } | null>(null);
  const getGeo = (): Geo | null => {
    const v = vsRef.current;
    const st = geoStamp.current;
    if (!geoRef.current || !st || st.c !== v.collapsedNodeIds || st.p !== v.prunedNodeIds || st.s !== v.swappedNodeIds || st.h !== v.rowHeight) {
      geoRef.current = buildGeo(tm, conv.tree, v, v.rowHeight ?? 16, geoKeyOf(v));
      geoStamp.current = { c: v.collapsedNodeIds, p: v.prunedNodeIds, s: v.swappedNodeIds, h: v.rowHeight };
    }
    return geoRef.current;
  };

  // ---- DOM helpers
  const treeSvg = () => rootRef.current?.querySelector('.tbrowse-zone-body > svg') as SVGSVGElement | null;
  const outerEl = () => rootRef.current?.querySelector('.tbrowse-outer') as HTMLElement | null;
  const visibleBand = (): { top: number; bottom: number; left: number; right: number } | null => {
    const o = outerEl();
    if (!o) return null;
    const r = o.getBoundingClientRect();
    return { top: r.top + HEADER_H + 1, bottom: r.bottom - 1, left: r.left, right: r.right };
  };

  /** Clade colour patch: inline style on the library's SVG branches and leaf glyphs (React never writes `style` there). */
  const patchTree = () => {
    const svg = treeSvg();
    const L = latest.current;
    const cl = cladesRef.current;
    const set = patched.current;
    if (!svg) return;
    if (cl.length === 0 && set.size === 0) return;
    const geo = cl.length ? getGeo() : null;
    const want = new Map<SVGElement, { prop: 'stroke' | 'fill'; colour: string }>();
    if (geo && cl.length) {
      const pm = pairMap(geo, L.tree);
      const colourOf = (i: number) => {
        let c: string | undefined;
        for (const k of cl) if (i >= k.a && i < k.b) c = k.colour;
        return c;
      };
      svg.querySelectorAll<SVGPathElement>('path[stroke^="var(--tbrowse"]').forEach((el) => {
        const d = parsePath(el.getAttribute('d'));
        if (!d) return;
        const i = pm.get(pairKey(d.py, d.cy));
        if (i === undefined) return;
        const c = colourOf(i);
        if (c) want.set(el, { prop: 'stroke', colour: c });
      });
      svg.querySelectorAll<SVGCircleElement>(`circle[r="${LEAF_R}"]`).forEach((el) => {
        const cy = Number(el.getAttribute('cy'));
        const k = Math.floor(cy / geo.rowH);
        const row = geo.rows[k];
        if (!row || Math.abs(row.y + row.height / 2 - cy) > 0.01) return;
        const c = colourOf(Number(row.nodeId.slice(1)));
        if (c) want.set(el, { prop: 'fill', colour: c });
      });
    }
    for (const el of set) {
      if (!want.has(el)) {
        el.style.stroke = '';
        el.style.fill = '';
        set.delete(el);
      }
    }
    for (const [el, w] of want) {
      if (el.style[w.prop] !== w.colour) el.style[w.prop] = w.colour;
      set.add(el);
    }
  };
  const cladesRef = useRef(clades);
  cladesRef.current = clades;
  const patchRef = useRef(patchTree);
  patchRef.current = patchTree;
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const mo = new MutationObserver(() => patchRef.current());
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
  useLayoutEffect(() => {
    patchRef.current();
  }, [clades, vs]);
  useEffect(() => {
    const t = setTimeout(() => patchRef.current(), 350); // after the library's 260 ms row animation
    return () => clearTimeout(t);
  }, [clades, vs.collapsedNodeIds, vs.prunedNodeIds, vs.swappedNodeIds, vs.rowHeight]);

  // ---- focus: un-hide the tip, then scroll the library's own scroll container
  useEffect(() => {
    const fr = props.focusRequest;
    if (!fr) return;
    const i = tm.tipIndex(fr.tipId);
    if (i < 0) return;
    const anc = new Set(tm.ancestors(i).map((k) => 'n' + k));
    setVs((prev) => {
      const col = prev.collapsedNodeIds.filter((x) => !anc.has(x));
      const pru = prev.prunedNodeIds.filter((x) => !anc.has(x));
      if (col.length === prev.collapsedNodeIds.length && pru.length === prev.prunedNodeIds.length) return prev;
      return { ...prev, collapsedNodeIds: col, prunedNodeIds: pru, selectedNodeId: prev.selectedNodeId };
    });
    let n = 0;
    const go = () => {
      const geo = getGeo();
      const o = outerEl();
      if (geo && o && geo.yc[i] === geo.yc[i]) o.scrollTop = Math.max(0, geo.yc[i] - (o.clientHeight - HEADER_H) / 2);
      else if (++n < 10) requestAnimationFrame(go);
    };
    requestAnimationFrame(() => requestAnimationFrame(go));
  }, [props.focusRequest?.seq]);

  // ---- introspection
  const handle: ViewHandle = {
    locate(t) {
      const L = latest.current;
      const svg = treeSvg();
      const geo = getGeo();
      const band = visibleBand();
      if (!svg || !geo || !band) return null;
      const i = t.kind === 'tip' ? L.tree.tipIndex(t.id) : L.tree.isNodeId(t.id) ? L.tree.nodeIndex(t.id) : -1;
      if (i < 0 || !(geo.yc[i] === geo.yc[i])) return null;
      const sr = svg.getBoundingClientRect();
      const y = sr.top + geo.yc[i];
      const inBand = y >= band.top && y <= band.bottom;
      if (t.kind === 'tip' || L.tree.childCount[i] === 0) {
        if (!inBand) return null;
        for (const el of Array.from(svg.querySelectorAll<SVGCircleElement>(`circle[r="${LEAF_R}"]`))) {
          if (Math.abs(Number(el.getAttribute('cy')) - geo.yc[i]) < 0.01) {
            const r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }
        }
        return null;
      }
      if (i === 0) {
        if (!inBand) return null;
        const ln = svg.querySelector('line[stroke="transparent"]');
        if (!ln) return null;
        const r = ln.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
      // internal node: the library's hit path is the whole L-shaped branch of the node (horizontal piece into the node plus the
      // vertical connector at the parent's x), so a click anywhere on it selects the node. Prefer the node's own horizontal
      // piece; fall back to the vertical connector when the node itself is scrolled out of view.
      const py = geo.yc[L.tree.parent[i]];
      let hit: SVGPathElement | null = null;
      let d: ReturnType<typeof parsePath> = null;
      for (const el of Array.from(svg.querySelectorAll<SVGPathElement>('path[stroke="transparent"]'))) {
        const q = parsePath(el.getAttribute('d'));
        if (q && Math.abs(q.cy - geo.yc[i]) < 0.01 && Math.abs(q.py - py) < 0.01) {
          hit = el;
          d = q;
          break;
        }
      }
      if (!hit || !d) return null;
      if (inBand) {
        for (let x = d.cx - 3; x >= d.px + 1; x -= 3) if (document.elementFromPoint(sr.left + x, y) === hit) return { x: sr.left + x, y };
      }
      const lo = Math.max(Math.min(d.py, d.cy), band.top - sr.top);
      const hi = Math.min(Math.max(d.py, d.cy), band.bottom - sr.top);
      if (hi - lo >= 2) {
        const far = (v: number) => Math.abs(v - d!.py) >= 7 && Math.abs(v - d!.cy) >= 7;
        const cands: number[] = [];
        for (let k = 0; k <= 8; k++) cands.push(lo + ((hi - lo) * (k % 2 ? 0.5 + k / 18 : 0.5 - k / 18)) );
        cands.sort((a, b) => Math.abs(a - (lo + hi) / 2) - Math.abs(b - (lo + hi) / 2));
        for (const v of cands) {
          if (!far(v) && hi - lo > 16) continue;
          if (document.elementFromPoint(sr.left + d.px, sr.top + v) === hit) return { x: sr.left + d.px, y: sr.top + v };
        }
      }
      return inBand ? { x: sr.left + d.cx - 3, y } : null;
    },
    bounds(t) {
      const L = latest.current;
      const svg = treeSvg();
      const geo = getGeo();
      const band = visibleBand();
      if (!svg || !geo || !band) return null;
      const i = t.kind === 'tip' ? L.tree.tipIndex(t.id) : L.tree.isNodeId(t.id) ? L.tree.nodeIndex(t.id) : -1;
      if (i < 0 || !(geo.yc[i] === geo.yc[i])) return null;
      const sr = svg.getBoundingClientRect();
      let x0 = sr.left;
      if (t.kind === 'tip' || L.tree.childCount[i] === 0) {
        const p = handle.locate({ kind: 'tip', id: L.tree.tipLabels[L.tree.tipRank[i]] });
        return p ? { x: p.x - 4, y: p.y - 4, width: 8, height: 8 } : null;
      }
      if (i > 0) {
        const py = geo.yc[L.tree.parent[i]];
        for (const el of Array.from(svg.querySelectorAll<SVGPathElement>('path[stroke="transparent"]'))) {
          const q = parsePath(el.getAttribute('d'));
          if (q && Math.abs(q.cy - geo.yc[i]) < 0.01 && Math.abs(q.py - py) < 0.01) {
            x0 = sr.left + q.cx;
            break;
          }
        }
      }
      const y0 = Math.max(band.top, sr.top + geo.lo[i]);
      const y1 = Math.min(band.bottom, sr.top + geo.hi[i]);
      const x1 = band.right;
      if (y1 - y0 < 1 || x1 - x0 < 1) return null;
      return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    },
    locateCell(colId, tipId) {
      const L = latest.current;
      const band = visibleBand();
      const geo = getGeo();
      if (!band || !geo || !rootRef.current) return null;
      const i = L.tree.tipIndex(tipId);
      if (i < 0 || !(geo.yc[i] === geo.yc[i])) return null;
      const spec = L.columns.find((c) => c.id === colId);
      if (!spec || spec.values[tipId] === undefined) return null;
      if (spec.kind === 'alignment') {
        const cv = rootRef.current.querySelector<HTMLCanvasElement>('.tbrowse-zone-body canvas');
        if (!cv) return null;
        const r = cv.getBoundingClientRect();
        const y = r.top + geo.endTop[i];
        if (y + geo.endH[i] / 2 < band.top || y + geo.endH[i] / 2 > band.bottom) return null;
        return { x: r.left, y, width: Math.min(r.width, 480), height: geo.endH[i] };
      }
      const cell = rootRef.current.querySelector(`[data-col="${CSS.escape(colId)}"][data-tip-id="${CSS.escape(tipId)}"]`);
      if (!cell) return null;
      const target = cell.querySelector('[data-bar]') ?? cell;
      const r = target.getBoundingClientRect();
      if (r.top + r.height / 2 < band.top || r.top + r.height / 2 > band.bottom) return null;
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    },
    custom() {
      const geo = geoRef.current;
      return { tips: tm.tipCount, nodes: tm.nodeCount, convertMs: conv.ms, rows: geo ? geo.rows.length : -1, rowHeight: vsRef.current.rowHeight ?? 16, lengthScale: conv.scale, collapsed: vsRef.current.collapsedNodeIds.length };
    },
  };
  useLayoutEffect(() => {
    props.handleRef.current = handle;
    return () => {
      props.handleRef.current = null;
    };
  });

  // ---- ready
  useEffect(() => {
    props.onReady({
      parseMs: conv.ms,
      tips: conv.leaves,
      notes: `TreeModel -> tbrowse node table in ${conv.ms.toFixed(1)} ms (${tm.nodeCount} nodes, lengths x${conv.scale}); tips counted from the converted table (tbrowse does not report a tip count); the library renders every row on its first render before its ResizeObserver switches virtualisation on`,
    });
  }, []);

  const th = themeCss(theme);
  return (
    <div ref={rootRef} style={{ width: size.width, height: size.height, position: 'relative', overflow: 'hidden', background: theme.tokens?.background ?? (theme.dark ? gbifDarkTheme().bg1 : g.bg1) }} data-testid="tbrowse-host">
      <style>{th.css}</style>
      <TBrowse
        tree={conv.tree}
        zones={zones}
        msa={msa}
        searchFields={searchFields}
        hostData={hostData}
        viewState={vs}
        onViewStateChange={onViewStateChange}
        theme={theme.dark ? 'dark' : 'light'}
        className="gbif-tb"
        showHeader={toolbar}
        rowHeight={rowH}
        hotkeys={{ search: false }}
      />
    </div>
  );
}

// ------------------------------------------------------------------------------------------ capability report

const capabilities: CapabilityReport = {
  tipClick: { level: 'yes', how: 'click on a leaf row, branch or label sets ViewState.selectedNodeId (library state); the adapter turns the change into a tipClick event' },
  internalNodeClick: { level: 'yes', how: 'click on an internal branch or collapsed triangle sets ViewState.selectedNodeId; the library also opens its own tooltip with collapse / prune / swap / reroot actions' },
  branchClick: { level: 'partial', how: 'the branch hit path IS the click target of its child node; branch and node clicks are the same event (reported as nodeClick)' },
  hover: { level: 'yes', how: 'ZoneRenderProps.hoveredNodeId inside our own zone body (fires only while that zone is visible); not available through TBrowseProps' },
  descendantTipsInPayload: { level: 'no', how: 'the library reports only a node id (selectedNodeId); tip sets are computed from the shared TreeModel and flagged source=adapter-derived (hoveredSubtreeIds exists but only in zone render props)' },
  cladeColouring: { level: 'partial', how: 'no colour prop in the library: inline style patched on the tree SVG branches and leaf dots (path d parsed back to a node through mirrored row geometry) plus React-rendered colour in our tips and column zones; internal-node glyphs and dashed leaders stay grey; re-patched by a MutationObserver' },
  highlightTip: { level: 'partial', how: 'library search state (host SearchField) draws a ring on the leaf dot and marks collapsed triangles; our zones add a row band; typing in the library search box replaces it' },
  focusTip: { level: 'partial', how: 'scrolls the library .tbrowse-outer scroll container to centre the row (DOM access, no API); un-collapses and un-prunes ancestors through ViewState first' },
  tipAsLink: { level: 'partial', how: 'real <a href data-tip-id target=_blank> rendered by our own label zone (ZoneDefinition) for rows in the virtualised range; the built-in labels zone has no links' },
  customColumns: { level: 'yes', how: 'one ZoneDefinition per column (Header + Body from ZoneRenderProps.visibleRows/rowRange, data via the hostData prop); rows stay aligned because every zone shares the same row grid' },
  alignmentColumn: { level: 'partial', how: 'built-in msaZone fed from MSA {alphabet,length,sequences} keyed by geneId = tip label; canvas is as tall as ALL rows, so it goes blank beyond the browser canvas limit (about 1,365 rows at 24 px, source-derived); one alignment only' },
  radialLayout: { level: 'no', how: 'rectangular phylogram/cladogram only (TreeZoneState.layoutMode)' },
  branchLengthToggle: { level: 'yes', how: 'TreeZoneState.layoutMode phylogram | cladogram through controlled viewState; adapter rescales lengths (absolute 0.01 floor in the library); optional // compression of long branches is a separate toggle' },
  scaleBar: { level: 'no', how: 'no scale bar or time axis in the tree zone' },
  darkTheme: { level: 'yes', how: 'theme="dark" prop plus CSS custom properties (--tbrowse-*) re-pointed at gbifDarkTheme() values' },
  cssTokens: { level: 'partial', how: '--tbrowse-* custom properties on .tbrowse-root take GBIF token values (bg, text, branch, accent, borders); fixed in code: selection amber, branch width by clade size, glyph sizes, residue colours; no per-node style callbacks' },
  multipleInstances: { level: 'yes', how: 'zustand store per <TBrowse>; only global is one injected <style id=tbrowse-theme-style>' },
  cleanUnmount: { level: 'yes', how: 'React unmount; the document keydown listener for the search hotkey is removed (and disabled here with hotkeys={{search:false}})' },
  controlledState: { level: 'yes', how: 'viewState / onViewStateChange (selection, collapse, prune, swap, zone widths and states, search, row height) controlled from React state' },
  zoomToFit: { level: 'partial', how: 'no zoom: fixed 24 px rows in a native scroll container. ViewState.rowHeight can be set to fit all rows (the "fit" row-height option) but then every row, SVG node and label is drawn (no culling benefit)' },
  overviewOrMinimap: { level: 'partial', how: 'no minimap or semantic zoom; collapsedNodeIds turns clades into triangle rows (the adapter "overview" option picks them), the MSA zone has its own coverage minimap' },
};

const features: AdapterFeature[] = [
  { id: 'toolbar', label: 'Library toolbar (search, zones)', kind: 'toggle', default: true, description: 'showHeader prop: hides the tbrowse toolbar with its logo, search and zone toggles.' },
  { id: 'rowHeight', label: 'Row height', kind: 'select', default: '16', options: [{ value: '24', label: '24 px (library default)' }, { value: '18', label: '18 px' }, { value: '16', label: '16 px (demo default)' }, { value: '12', label: '12 px' }, { value: '8', label: '8 px' }, { value: 'fit', label: 'fit all rows' }], description: 'ViewState.rowHeight. "fit all rows" is the nearest thing to zoom-out: it draws every row.' },
  { id: 'overview', label: 'Overview: collapse to at most N rows', kind: 'select', default: 'off', options: [{ value: 'off', label: 'off' }, { value: '50', label: '50 rows' }, { value: '200', label: '200 rows' }, { value: '1000', label: '1000 rows' }], description: 'Adapter picks the largest clades and sets ViewState.collapsedNodeIds (triangles). Click a triangle to open the tooltip, Expand to drill down.' },
  { id: 'order', label: 'Clade order (swap)', kind: 'select', default: 'file', options: [{ value: 'file', label: 'file order' }, { value: 'large-first', label: 'larger clade first' }, { value: 'large-last', label: 'larger clade last' }], description: 'ViewState.swappedNodeIds (reverses the children of listed nodes).' },
  { id: 'rescale', label: 'Rescale short branch lengths (adapter)', kind: 'toggle', default: true, description: 'tbrowse floors every branch at an absolute 0.01. On: lengths x10^k so the tree depth is at least 100 (tooltip then shows scaled numbers). Off: raw lengths, trees with tiny branches turn into cladograms and ultrametric tips stop aligning.' },
  { id: 'compress', label: 'Compress long branches (//)', kind: 'toggle', default: false, description: 'TreeZoneState.autoCompressLongBranches: library default is ON; off here so lengths stay faithful.' },
  { id: 'leafExt', label: 'Dashed leader lines to labels', kind: 'toggle', default: true, description: 'TreeZoneState.showLeafExtensions.' },
  { id: 'labels', label: 'Label zone', kind: 'select', default: 'custom', options: [{ value: 'custom', label: 'ours (links, colour)' }, { value: 'builtin', label: 'built-in labelsZone' }], description: 'The built-in labelsZone has a field picker but no links, colour or highlight band.' },
  { id: 'showTree', label: 'Tree zone visible', kind: 'toggle', default: true, description: 'ViewState.zones[].visible (table-only view when off).' },
  { id: 'showLabels', label: 'Label zone visible', kind: 'toggle', default: true, description: 'ViewState.zones[].visible.' },
  { id: 'scheme', label: 'MSA colour scheme', kind: 'select', default: 'default', options: [{ value: 'default', label: 'default' }, { value: 'plain', label: 'plain' }, { value: 'clustal', label: 'clustal' }, { value: 'hydrophobicity', label: 'hydrophobicity' }, { value: 'nucleotide', label: 'nucleotide' }], description: 'MSAZoneState.colorSchemeId (used when an alignment column is shown).' },
];

export const adapter: CandidateAdapter = {
  candidate: { name: 'tbrowse', version: TBROWSE_VERSION, license: 'MIT', notes: 'Flat node table + pluggable row-aligned zones; SVG tree zone, DOM label/column zones, canvas MSA zone; native-scroll virtualised rows, no zoom.' },
  capabilities,
  View: TbrowseView,
  features,
};
