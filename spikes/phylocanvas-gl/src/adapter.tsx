// Phylocanvas.gl 1.64.1 candidate (WebGL through deck.gl 8.9). A React wrapper written for this spike, about what a gbif.org
// developer would write: construct once in an effect, push React state in with setProps, take events out through the library's
// own plugin/decorate mechanism, destroy on unmount.
//
// What is the library and what is ours (also in docs/results/phylocanvas-gl.md):
//  * LIBRARY: layout (5 types), WebGL drawing of edges/tips/labels, pan/zoom controller, picking (leaf shapes, leaf labels, edges),
//    per-tip `styles`, `selectedIds` halos, hover highlight of a whole clade, collapse + pie charts, `rootId`, blocks (coloured squares).
//  * OURS: the React wrapper, events (the library has NO callbacks: we wrap selectNode / highlightNode / handleClick / render with
//    `decorate`), mapping of the library's synthetic internal ids (`__<preorder index>`) to our node ids, tip sets for clicked
//    internal nodes (computed from the shared TreeModel: source 'adapter-derived'), clade colouring by styling every tip below the
//    clade (+ styleNodeEdges for the branches), focus (we compute centre and step zoom), cladogram (synthetic branch lengths),
//    custom columns and scale bar (our own deck.gl layers through addLayer), tip links and keyboard focus (DOM overlay), cleanup.

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import PhylocanvasGL from '@phylocanvas/phylocanvas.gl';
import type { AdapterFeature, CandidateAdapter, CapabilityReport, ColumnSpec, Point, Rect, ThemeSpec, ViewHandle, ViewProps } from '../../shared/types.ts';
import type { TreeModel } from '../../shared/tree.ts';
import { gbifTheme, gbifDarkTheme } from '../../shared/gbif-theme.ts';
import { buildBiojs } from './source.ts';
import { hitTest } from './hit.ts';
import { patchTextLayerCharset, installCustomLayers, columnLeftPx, columnsTotalPx, alignedX, barPx, columnMax, COL_GAP } from './layers.ts';
import type { GbifProps } from './layers.ts';

const LIB_VERSION = '1.64.1';
const UNICODE_PATCHED = patchTextLayerCharset();
const CSS = `
.pc-wrap{position:relative;width:100%;height:100%;overflow:hidden;user-select:none}
.pc-host{width:100%;height:100%}
.pc-over{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.pc-over .row{position:absolute;pointer-events:auto;cursor:pointer;color:transparent;text-decoration:none;white-space:nowrap;border-radius:2px;outline-offset:1px}
.pc-over .row:hover{background:color-mix(in srgb,var(--pc-hl) 16%,transparent);box-shadow:inset 0 -2px 0 var(--pc-hl)}
.pc-over .row:focus-visible{outline:2px solid var(--pc-hl);background:color-mix(in srgb,var(--pc-hl) 16%,transparent)}
`;

type LibNode = any;
const TYPE_NAMES: Record<string, string> = { rc: 'rectangular', cr: 'circular', rd: 'radial (unrooted)', dg: 'diagonal', hr: 'hierarchical' };

// ------------------------------------------------------------------------------------------ theme

const _cv = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d', { willReadFrequently: true })! : null;
const rgbaCache = new Map<string, number[]>();
/** Any CSS colour to [r,g,b,a] 0..255 (the library accepts CSS strings itself; our own layers need arrays). */
function css2rgba(c: string): number[] {
  let v = rgbaCache.get(c);
  if (!v) {
    _cv!.clearRect(0, 0, 1, 1);
    _cv!.fillStyle = '#000';
    _cv!.fillStyle = c;
    _cv!.fillRect(0, 0, 1, 1);
    const d = _cv!.getImageData(0, 0, 1, 1).data;
    v = [d[0], d[1], d[2], d[3]];
    rgbaCache.set(c, v);
  }
  return v;
}

function resolveTheme(t: ThemeSpec) {
  const g = t.dark ? gbifDarkTheme() : gbifTheme();
  const k = t.tokens ?? {};
  return {
    bg: k.background ?? g.bg1,
    fg: k.foreground ?? g.fg1,
    branch: k.branch ?? (t.dark ? g.fg3 : g.fg2),
    hl: k.highlight ?? g.primary,
    font: k.fontFamily ?? g.fontBody,
    bar: g.categorical[1],
    header: k.foreground ?? g.fg2,
  };
}

// ------------------------------------------------------------------------------------------ the view

function useLatest<T>(v: T) {
  const r = useRef(v);
  r.current = v;
  return r;
}

function PhylocanvasView(props: ViewProps) {
  const { tree: tm, size, theme, features } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const libRef = useRef<any>(null);
  const appliedRef = useRef<Record<string, any>>({});
  const memoRef = useRef<Record<string, { deps: any[]; value: any }>>({});
  const exactRef = useRef(false);
  const pickLayerRef = useRef<string | null>(null);
  const lastHoverRef = useRef<string | null>(null);
  const latest = useLatest(props);
  const [clicked, setClicked] = useState<string | null>(null);
  const [rootK, setRootK] = useState<number | null>(null);
  const [rows, setRows] = useState<{ id: string; left: number; top: number; width: number; height: number }[]>([]);
  const rowsKey = useRef('');
  const overlayRaf = useRef(0);
  const boostRef = useRef(false);
  const originRef = useRef<'library' | 'own'>('library');
  const pickableRef = useRef<boolean | null>(null);
  const clickedRef = useLatest(clicked);
  const tmRef = useLatest(tm);
  const featRef = useLatest(features);

  // ---------------------------------------------------------------- id mapping (library id <-> shared node index)
  const libNodeOfK = (k: number): LibNode | null => {
    const lib = libRef.current;
    if (!lib || k < 0 || k >= tmRef.current.nodeCount) return null;
    const graph = lib.getGraphAfterLayout();
    if (exactRef.current) return graph.preorderTraversal[k] ?? null;
    const t = tmRef.current;
    if (t.childCount[k] === 0) return graph.ids[t.labels[k]] ?? null;
    // generic: climb from the first tip until the clade has the same number of tips and the same last tip
    let n = graph.ids[t.tipLabels[t.leafStart[k]]];
    const want = t.leafEnd[k] - t.leafStart[k];
    while (n && n.totalLeaves < want) n = n.parent;
    return n && n.totalLeaves === want ? n : null;
  };
  const kOfLibNode = (n: LibNode): number => {
    const t = tmRef.current;
    if (exactRef.current) return n.preIndex;
    if (n.isLeaf) return t.tipIndex(n.id);
    // find the shared node with the same tip set by its first and last leaf
    let a = n;
    while (!a.isLeaf) a = a.children[0];
    let z = n;
    while (!z.isLeaf) z = z.children[z.children.length - 1];
    let k = t.tipIndex(a.id);
    const last = t.tipIndex(z.id);
    if (k < 0 || last < 0) return -1;
    while (k > 0 && !(t.leafStart[k] === t.tipRank[t.tipIndex(a.id)] && t.leafEnd[k] === t.tipRank[last] + 1 && t.childCount[k] > 0)) k = t.parent[k];
    return k;
  };

  // ---------------------------------------------------------------- events
  const emitFor = (type: 'click' | 'hover', node: LibNode, layerId: string | null) => {
    const k = kOfLibNode(node);
    if (k < 0) return;
    const t = tmRef.current;
    const isTip = t.childCount[k] === 0;
    const count = t.tipCountOf(k);
    const big = type === 'hover' && !isTip && count > 2000;
    const tipIds = big ? t.descendantTips(k).slice(0, 2000) : t.descendantTips(k);
    latest.current.emit({
      type: type === 'click' ? (isTip ? 'tipClick' : layerId === 'piecharts' ? 'nodeClick' : 'branchClick') : isTip ? 'tipHover' : 'nodeHover',
      nodeId: t.nodeId(k),
      isTip,
      tipIds,
      // 'library' only for a tip picked by deck.gl itself (the node object carries the tip label). Internal nodes: the library hands
      // us a node object with synthetic id `__<n>` and no tip list in any payload, so the tip set comes from the TreeModel. With own
      // hit-testing the pick itself is ours too.
      source: isTip && originRef.current === 'library' ? 'library' : 'adapter-derived',
      libraryPayload: { origin: originRef.current === 'library' ? 'deck.gl GPU pick' : 'own CPU hit-test', layer: layerId, libId: node.id, preIndex: node.preIndex, totalLeaves: node.totalLeaves, truncatedTo: big ? 2000 : undefined },
    });
  };

  const plugin = useMemo(
    () => (tree: any, decorate: (name: string, fn: (orig: (...a: any[]) => any, args: any[]) => any) => void) => {
      // 1. which layer was picked (the library does not tell selectNode)
      decorate('handleClick', (orig, args) => {
        pickLayerRef.current = args[0]?.layer?.id ?? null;
        return orig(...args);
      });
      // 2. click: selectNode(node) receives leaves, and internal nodes through the picked edge or pie chart
      decorate('selectNode', (_orig, args) => {
        const a = args[0];
        const node: LibNode | null = a && typeof a === 'object' ? a : a != null ? tree.findNodeById(a) : null;
        if (!node) {
          setClicked(null); // click on empty space clears the library's selection; we keep the selection in React
          return undefined;
        }
        emitFor('click', node, pickLayerRef.current);
        if (node.isLeaf) setClicked(node.id);
        else if (featRef.current.rootAtClicked) {
          const k = kOfLibNode(node);
          if (k > 0) setRootK(k);
        }
        // Deliberately NOT calling the original: it would put the pick into tree.props.selectedIds itself and ignore internal
        // nodes. selectedIds is driven from React state (clicked tip + highlighted tips) instead.
        return undefined;
      });
      // 3. hover: highlightNode(node|null) is called by the hover handler
      decorate('highlightNode', (orig, args) => {
        const a = args[0];
        const node: LibNode | null = a && typeof a === 'object' ? a : a != null ? tree.findNodeById(a) : null;
        const id = node ? node.id : null;
        if (id !== lastHoverRef.current) {
          lastHoverRef.current = id;
          if (node) emitFor('hover', node, null);
        }
        return orig(...args);
      });
      // 4. every render (view change, props change): refresh the DOM overlay of visible rows
      decorate('render', (orig, args) => {
        const r = orig(...args);
        scheduleOverlay();
        return r;
      });
    },
    [],
  );

  // ---------------------------------------------------------------- props sent to the library
  const memo = <T,>(key: string, deps: any[], fn: () => T): T => {
    const m = memoRef.current[key];
    if (m && m.deps.length === deps.length && m.deps.every((d, i) => d === deps[i])) return m.value as T;
    const value = fn();
    memoRef.current[key] = { deps, value };
    return value;
  };

  const libType = (): string => {
    const f = String(featRef.current.treeType ?? 'auto');
    if (f !== 'auto') return f;
    return latest.current.layout === 'radial' ? 'cr' : 'rc';
  };

  const computeProps = (first: boolean): Record<string, any> => {
    const p = latest.current;
    const f = p.features;
    const th = resolveTheme(p.theme);
    const type = libType();
    const lib = libRef.current;
    const mode = p.branchLengths && tm.hasLengths ? 'lengths' : 'cladogram';
    const native = !!f.nativeParser;
    const source = memo('source', [tm, mode, native, p.newick], () => (native ? { type: 'newick', data: p.newick, trimQuotes: false } : { type: 'biojs', data: buildBiojs(tm, mode), trimQuotes: false }));
    // trimQuotes: false is a documented source option (utils/tree-traversal.js). The default strips a leading/trailing ' or " from tip
    // names, which changed the label `"Coelophysis" kayentakatae ott6520432` of the OpenTree 91k tree and broke the join key.
    const hover = f.hoverHighlight !== false;
    const interactive = memo('interactive', [hover], () => ({ pan: true, zoom: true, highlight: hover }));
    const sz = memo('size', [p.size.width, p.size.height], () => ({ width: p.size.width, height: p.size.height }));
    const labelsOn = f.labels !== false;
    const columnsOn = f.columnMode !== 'blocks' && type === 'rc' && p.columns.length > 0;
    const blocksOn = f.columnMode === 'blocks' && p.columns.length > 0 && type !== 'rd';
    const nodeSizeF = String(f.nodeSize ?? 'auto');
    // nodeSize is a fixed pixel size (it does not follow the row height), so pick it from the tree size; enlarge after focusTip
    const auto = tm.tipCount <= 60 ? 10 : tm.tipCount <= 120 ? 6 : tm.tipCount <= 400 ? 3 : 2;
    const nodeSize = nodeSizeF === 'auto' ? (boostRef.current ? Math.max(auto, 8) : auto) : Number(nodeSizeF);

    // clade colours -> per tip styles (the library only styles tips) + styleNodeEdges for the branches
    const styles = memo('styles', [p.colouredClades, tm], () => {
      const s: Record<string, { fillColour: string; strokeColour: string }> = {};
      for (const c of p.colouredClades) {
        const k = tm.nodeIndex(c.nodeId);
        for (let r = tm.leafStart[k]; r < tm.leafEnd[k]; r++) s[tm.tipLabels[r]] = { fillColour: c.colour, strokeColour: c.colour };
      }
      return s;
    });
    const selectedIds = memo('selected', [p.highlightedTips, clicked], () => {
      const ids = p.highlightedTips.filter((t) => tm.tipIndex(t) >= 0);
      if (clicked && !ids.includes(clicked)) ids.push(clicked);
      return ids;
    });
    const collapseN = Number(f.collapse ?? 0);
    const collapsedIds = memo('collapsed', [tm, collapseN, !!lib, first], () => {
      if (!collapseN || !lib) return [];
      const ids: string[] = [];
      for (let i = 1; i < tm.nodeCount; i++) {
        if (tm.childCount[i] > 0 && tm.leafEnd[i] - tm.leafStart[i] <= collapseN) {
          const n = libNodeOfK(i);
          if (n) ids.push(n.id);
          i = tm.subtreeEnd[i] - 1;
        }
      }
      return ids;
    });
    const rootId = memo('rootId', [rootK, !!f.rootAtClicked, !!lib], () => {
      if (!f.rootAtClicked || rootK === null || !lib) return null;
      return libNodeOfK(rootK)?.id ?? null;
    });

    // reserve width on the right for our custom columns through one dummy metadata block (the library sizes its drawing area
    // from blocks; custom layers know nothing about it)
    const customW = columnsOn ? columnsTotalPx(p.columns) : 0;
    const blocks = memo('blocks', [customW, blocksOn, p.columns, tm], () => (blocksOn ? p.columns.map((c) => c.header) : customW ? [''] : []));
    const metadata = memo('metadata', [blocksOn, p.columns, tm], () => {
      const m: Record<string, Record<string, { colour: string; label: string }>> = {};
      if (!blocksOn) return m;
      const pal = gbifTheme().categorical;
      for (const c of p.columns) {
        let max = 0;
        if (c.kind === 'bar') for (const k in c.values) max = Math.max(max, Number(c.values[k]));
        const cats = new Map<string, string>();
        for (const id in c.values) {
          const v = c.values[id];
          let colour: string;
          if (c.kind === 'bar') {
            // sequential single-hue ramp from the GBIF green: value -> alpha (blocks cannot vary in size)
            const a = max > 0 ? Math.log10(1 + Number(v)) / Math.log10(1 + max) : 0;
            colour = `rgba(76,155,69,${(0.12 + 0.88 * a).toFixed(3)})`;
          } else {
            const key = c.kind === 'alignment' ? String(v).slice(0, 1) : String(v);
            if (!cats.has(key)) cats.set(key, pal[cats.size % pal.length]);
            colour = cats.get(key)!;
          }
          (m[id] ??= {})[c.header] = { colour, label: String(v).slice(0, 40) };
        }
      }
      return m;
    });
    const gbif: GbifProps = memo('gbif', [p.columns, columnsOn, th.bar, th.fg, th.header, th.font, f.scaleBar, p.branchLengths, tm], () => ({
      columns: p.columns,
      columnsOn,
      barColour: css2rgba(th.bar),
      textColour: css2rgba(th.fg),
      headerColour: css2rgba(th.header),
      fontFamily: th.font,
      scaleBar: f.scaleBar !== false && p.branchLengths && tm.hasLengths,
      hasLengths: tm.hasLengths,
      tipCount: tm.tipCount,
    }));

    const out: Record<string, any> = {
      size: sz,
      type,
      source,
      interactive,
      styles,
      styleNodeEdges: true,
      styleLeafLabels: true,
      selectedIds,
      collapsedIds,
      rootId,
      showPiecharts: collapsedIds.length ? true : undefined,
      showLabels: labelsOn,
      showLeafLabels: labelsOn,
      showInternalLabels: !!f.internalLabels,
      showBranchLengths: !!f.branchLengthLabels,
      alignLabels: (!!f.alignLabels || columnsOn || blocksOn) && (type === 'rc' || type === 'cr' || type === 'hr'),
      showBlockHeaders: blocksOn,
      blocks,
      blockSize: blocksOn ? 14 : Math.max(1, customW - 4),
      blockPadding: 4,
      metadata,
      padding: columnsOn ? 26 : 16,
      nodeSize,
      nodeShape: String(f.tipShape ?? 'circle'),
      strokeWidth: Number(f.branchWidth ?? 1),
      haloWidth: 3,
      haloRadius: Math.max(nodeSize, 8),
      fontFamily: th.font,
      fontSize: Number(f.fontSize ?? 12),
      fontColour: th.fg,
      fillColour: th.fg,
      // Library bug (verified in source): the edge colour accessor is memoised on strokeColour/styleNodeEdges/highlight only, not on
      // `styles`, so after the first render deck.gl never re-reads edge colours when only `styles` change. A fresh array identity for
      // strokeColour busts the memo (a CSS string would be cached to the same array by colourToRGBA).
      strokeColour: memo('stroke', [th.branch, styles], () => css2rgba(th.branch).slice()),
      highlightColour: th.hl,
      backgroundColour: css2rgba(th.bg), // labels' background: the library hands this to deck.gl as is, so it must be an RGBA array (CSS strings work for every other colour prop)
      gbif,
    };
    return out;
  };

  /** Push changed props into the library in ONE setProps call (one render). Returns whether anything was applied. */
  const sync = (init = false) => {
    const lib = libRef.current;
    if (!lib) return;
    const next = computeProps(init);
    const prev = appliedRef.current;
    const patch: Record<string, any> = {};
    for (const k of Object.keys(next)) if (prev[k] !== next[k]) patch[k] = next[k];
    if ('type' in patch && prev.type !== undefined) Object.assign(patch, { centre: [0.5, 0.5], zoom: 0, branchZoom: 0, stepZoom: 0 });
    if (Object.keys(patch).length === 0) return;
    appliedRef.current = next;
    lib.setProps(patch);
    // GPU picking on/off (deck prop, reaching into the instance): own CPU hit-testing needs deck's pick-on-pointerdown switched off
    const wantPickable = String(latest.current.features.picking ?? 'own') !== 'own';
    if (pickableRef.current !== wantPickable) {
      pickableRef.current = wantPickable;
      lib.deck.setProps({ _pickable: wantPickable });
    }
    // host chrome that is not a library prop
    const host = hostRef.current;
    if (host) host.style.backgroundColor = resolveTheme(latest.current.theme).bg;
  };

  // ---------------------------------------------------------------- DOM overlay: links and keyboard rows (visible rows only)
  const computeRows = () => {
    const lib = libRef.current;
    if (!lib) return [] as typeof rows;
    const type = lib.getTreeType();
    if (type !== 'rc' && type !== 'dg') return [];
    const scale = lib.getScale();
    const pitch = lib.getStepScale() * scale;
    if (pitch < 9) return [];
    const graph = lib.getGraphAfterLayout();
    const { width: W, height: H } = lib.getCanvasSize();
    const nodeSize = lib.getNodeSize();
    const fs = Number(featRef.current.fontSize ?? 12);
    const fontFamily = lib.getFontFamily();
    const mc = measureCtx(fontFamily, fs);
    const align = lib.getAlignLeafLabels();
    const out: typeof rows = [];
    // leaves are in row order (y ascending in rectangular and diagonal layouts): bisect to the first visible row instead of
    // projecting every leaf (190k tips)
    const leaves = graph.leaves as any[];
    const yTop = lib.unprojectPoint([0, -pitch])[1];
    let lo = 0;
    let hi = leaves.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (leaves[mid].y < yTop) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < leaves.length; i++) {
      const leaf = leaves[i];
      if (leaf.isHidden) continue;
      const [px, py] = lib.projectPoint([leaf.x, leaf.y]);
      if (py > H + pitch) break;
      const aoff = align ? lib.getBranchScale() * (graph.root.totalSubtreeLength - leaf.distanceFromRoot) * scale : 0;
      const left = px + nodeSize + aoff;
      if (left > W) continue;
      const h = Math.min(pitch, fs + 6);
      out.push({ id: leaf.id, left, top: py - h / 2, width: Math.ceil(mc.measureText(leaf.label ?? leaf.id).width) + 4, height: h });
      if (out.length >= 400) break;
    }
    return out;
  };
  const scheduleOverlay = () => {
    if (overlayRaf.current) return;
    overlayRaf.current = requestAnimationFrame(() => {
      overlayRaf.current = 0;
      if (!libRef.current) return;
      const r = computeRows();
      const key = r.map((x) => `${x.id}:${Math.round(x.left)}:${Math.round(x.top)}`).join('|');
      if (key !== rowsKey.current) {
        rowsKey.current = key;
        setRows(r);
      }
    });
  };

  // ---------------------------------------------------------------- lifecycle: construct once, destroy on unmount
  useLayoutEffect(() => {
    const host = hostRef.current!;
    const p = latest.current;
    const t0 = performance.now();
    const conv0 = performance.now();
    // construct without our custom props first so that the first render is the complete one: computeProps needs libRef for
    // collapse/root only, which are empty on mount anyway
    const init = computeProps(true);
    const convMs = performance.now() - conv0;
    performance.clearMeasures('parse');
    const lib = new PhylocanvasGL(host, init, [plugin]);
    libRef.current = lib;
    (window as any).__phylocanvas = (window as any).__phylocanvas ?? [];
    (window as any).__phylocanvas[p.instanceId] = lib; // test aid for manual probing, read-only use
    appliedRef.current = init;
    // The constructor puts the CGPS logo on the host as a background image; remove it (MIT licence permits; their README forbids
    // using the name/logo for forks). DOM patching, not a library option.
    host.style.backgroundImage = 'none';
    host.style.backgroundColor = resolveTheme(p.theme).bg;
    // mjolnir.js (deck.gl's event manager) sets tabIndex=0 on the canvas for keyboard pan/zoom but nothing names it
    lib.deck.canvas.setAttribute('role', 'application');
    lib.deck.canvas.setAttribute('aria-label', `Phylogenetic tree, ${tm.tipCount} tips, WebGL canvas. Arrow keys pan and zoom. Tip rows follow when zoomed in.`);
    if (featRef.current.hiDpi) lib.deck.setProps({ useDevicePixels: true });
    installCustomLayers(lib);
    lib.setProps({}); // render once more now that the custom layers exist
    const ctorMs = performance.now() - t0;
    const parseEntry = performance.getEntriesByName('parse', 'measure').at(-1);
    // validate the mapping between the library's preorder and the shared TreeModel (O(n))
    const graph = lib.getGraphAfterLayout();
    const pre: LibNode[] = graph.preorderTraversal;
    let bad = pre.length === tm.nodeCount ? 0 : 1;
    if (!bad) {
      for (let k = 0; k < pre.length; k++) {
        const n = pre[k];
        if (n.isLeaf !== (tm.childCount[k] === 0) || (n.isLeaf ? n.id !== tm.labels[k] : n.totalLeaves !== tm.leafEnd[k] - tm.leafStart[k])) {
          bad++;
          if (bad > 50) break;
        }
      }
    }
    exactRef.current = bad === 0;
    const libTips = graph.root.totalLeaves;
    p.handleRef.current = handle;
    const notes =
      `source: ${init.source?.type === 'biojs' ? 'biojs object built from the shared TreeModel (' + convMs.toFixed(1) + ' ms)' : "library's own Newick parser"}; ` +
      `library parse (own performance.measure) ${(parseEntry?.duration ?? 0).toFixed(1)} ms; constructor total (parse + layout + layers) ${ctorMs.toFixed(1)} ms; ` +
      `id mapping ${exactRef.current ? 'exact (library preorder == shared preorder)' : `NOT exact (${bad} mismatches, falling back to tip-set search)`}; ` +
      `type ${lib.getTreeType()}; unicode label patch ${UNICODE_PATCHED ? 'on' : 'off'}`;
    // Warm-up pick (adapter): the first deck.gl pick compiles the picking shaders; with software GL that took about 2 s and ran
    // inside the pointerdown handler, which made mjolnir/Hammer drop the click (not a tap within 250 ms). The compile is moved into mount.
    let tries = 0;
    const finish = () => {
      // deck.gl installs the layers on its own first frame; picking before that compiles nothing
      const ready = (lib.deck?.layerManager?.getLayers?.().length ?? 0) > 0;
      if (!ready && tries++ < 120 && libRef.current === lib) {
        requestAnimationFrame(finish);
        return;
      }
      const w0 = performance.now();
      try {
        // only needed when deck.gl's GPU picking is in use (picking = library); own hit-testing never reads pixels back
        if (String(featRef.current.picking ?? 'own') !== 'own') {
          const s = lib.getCanvasSize();
          lib.deck.pickObject({ x: s.width / 2, y: s.height / 2, radius: 2 });
        }
      } catch {
        /* picking is a convenience here */
      }
      p.onReady({ parseMs: convMs + (parseEntry?.duration ?? 0), tips: libTips, notes: notes + `; warm-up pick ${(performance.now() - w0).toFixed(0)} ms after ${tries} frames` });
    };
    requestAnimationFrame(finish);
    // ---- own pointer handling (picking = own): clicks and hover from CPU hit-testing; routed through the SAME decorated
    // selectNode / highlightNode, so the plugin is the single door for events
    const wrap = wrapRef.current!;
    const own = () => String(featRef.current.picking ?? 'own') === 'own';
    const canvasPos = (e: PointerEvent): [number, number] => {
      const r = host.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const measureLabel = (label: string) => measureCtx(lib.getFontFamily(), Number(featRef.current.fontSize ?? 12)).measureText(label).width;
    let down: { x: number; y: number } | null = null;
    let hoverRaf = 0;
    let hoverPos: [number, number] | null = null;
    const onDown = (e: PointerEvent) => {
      if (own() && e.button === 0) down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!own() || !down || !libRef.current) return;
      const d = down;
      down = null;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return; // a drag, not a click
      if ((e.target as Element).closest?.('.row')) return; // overlay anchors act on their own
      if (hoverRaf) {
        // a pending hover belongs BEFORE this click (frames can be slow); flush it so events keep their order
        cancelAnimationFrame(hoverRaf);
        hoverNow();
      }
      const [x, y] = canvasPos(e);
      const h = hitTest(lib, x, y, measureLabel);
      originRef.current = 'own';
      pickLayerRef.current = h ? h.layer : null;
      try {
        lib.selectNode(h ? h.node : null, e.ctrlKey || e.metaKey);
      } finally {
        originRef.current = 'library';
      }
    };
    const hoverNow = () => {
      hoverRaf = 0;
      if (!libRef.current || !hoverPos) return;
      const h = hitTest(lib, hoverPos[0], hoverPos[1], measureLabel);
      originRef.current = 'own';
      try {
        lib.highlightNode(h ? h.node : null);
      } finally {
        originRef.current = 'library';
      }
      wrap.style.cursor = h ? 'pointer' : '';
    };
    const onMove = (e: PointerEvent) => {
      if (!own() || e.buttons || featRef.current.hoverHighlight === false) return;
      if ((e.target as Element).closest?.('.row')) return;
      hoverPos = canvasPos(e);
      if (!hoverRaf) hoverRaf = requestAnimationFrame(hoverNow);
    };
    const onLeave = () => {
      hoverPos = null;
      if (own() && libRef.current) {
        originRef.current = 'own';
        try {
          lib.highlightNode(null);
        } finally {
          originRef.current = 'library';
        }
      }
    };
    // ---- wheel: the library zooms BOTH axes with a plain wheel (deck OrthographicController); a table-like layout wants rows only.
    // Capture-phase listener that handles the plain wheel with the library's own setStepZoom (shift/alt keep the library path,
    // ctrl/meta = branch zoom is the library's). Zooming out to the fit snaps back to fitInCanvas().
    const onWheel = (e: WheelEvent) => {
      const l = libRef.current;
      const wm = String(featRef.current.wheel ?? 'auto');
      // 'auto': rows only up to 20k tips; setStepZoom re-lays out every node (O(n) JS per wheel step: 40 ms at 10k, 100 ms at 50k)
      if (!l || wm === 'library' || (wm === 'auto' && tm.tipCount > 20000)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !l.getStepZoomingAxis()) return;
      const r = host.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      e.preventDefault();
      e.stopPropagation();
      const delta = -e.deltaY * (e.deltaMode === 1 ? 33 : 1);
      const sc = 2 / (1 + Math.exp(-Math.abs(delta * 0.005))); // library: 0.01 (x1.54 per notch); gentler for a row zoom (x1.29)
      const dz = Math.log2(delta < 0 ? 1 / sc : sc);
      const cur = l.getStepZoom();
      if (cur + dz <= 0.001) {
        if (cur !== 0 || l.getZoom() !== 0 || l.getBranchZoom() !== 0) l.fitInCanvas();
        return;
      }
      const ratio = l.getStepScale() / Math.pow(2, cur);
      const ext = l.getTreeType() === 'hr' ? l.getCanvasSize().width : l.getCanvasSize().height;
      const max = Math.log2(Math.max(1, ext / 2 / ratio));
      l.setStepZoom(Math.min(max, cur + dz), [e.clientX - r.left, e.clientY - r.top]);
    };
    wrap.addEventListener('wheel', onWheel, { capture: true, passive: false });
    (window as any).__phylocanvasHit = (window as any).__phylocanvasHit ?? [];
    (window as any).__phylocanvasHit[p.instanceId] = (x: number, y: number) => hitTest(lib, x, y, measureLabel); // test aid (timing of the CPU hit-test)
    wrap.addEventListener('pointerdown', onDown);
    wrap.addEventListener('pointerup', onUp);
    wrap.addEventListener('pointermove', onMove);
    wrap.addEventListener('pointerleave', onLeave);
    scheduleOverlay();
    const host2 = host;
    return () => {
      wrap.removeEventListener('wheel', onWheel, { capture: true } as any);
      wrap.removeEventListener('pointerdown', onDown);
      wrap.removeEventListener('pointerup', onUp);
      wrap.removeEventListener('pointermove', onMove);
      wrap.removeEventListener('pointerleave', onLeave);
      cancelAnimationFrame(hoverRaf);
      cancelAnimationFrame(overlayRaf.current);
      overlayRaf.current = 0;
      props.handleRef.current = null;
      const l = libRef.current;
      libRef.current = null;
      if (l) {
        let gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;
        try {
          gl = l.deck?.animationLoop?.gl ?? null;
        } catch {
          gl = null;
        }
        l.destroy(); // deck.finalize(); does not remove the canvas element
        // belt and braces: release the GL context explicitly instead of waiting for GC (checked in docs/results: see S13)
        try {
          if (featRef.current.forceContextLoss !== false) gl?.getExtension('WEBGL_lose_context')?.loseContext();
        } catch {
          /* ignore */
        }
        host2.replaceChildren();
      }
    };
  }, []);

  // push React state into the library (after every render of this component; setProps only when something changed)
  useEffect(() => {
    sync();
  });

  // focus request: act when seq changes
  const lastSeq = useRef(0);
  useEffect(() => {
    const fr = props.focusRequest;
    if (!fr || fr.seq === lastSeq.current) return;
    lastSeq.current = fr.seq;
    focusTip(fr.tipId);
  }, [props.focusRequest]);

  // ---------------------------------------------------------------- focus: the library has no zoom-to-node
  const centreOnWorld = (lib: any, wx: number | null, wy: number | null) => {
    // library: centre (normalised) <-> deck target (world), utils/target-to-centre.js
    const sizeC = lib.getCanvasSize();
    const area = lib.getDrawingArea();
    const diff = [sizeC.width / 2 - (area.width / 2 + area.left), sizeC.height / 2 - (area.height / 2 + area.top)];
    const cur = lib.getView().target;
    const tx = wx ?? cur[0];
    const ty = wy ?? cur[1];
    return [(-tx + diff[0]) / sizeC.width + 0.5, (-ty + diff[1]) / sizeC.height + 0.5];
  };
  const focusTip = (tipId: string) => {
    const lib = libRef.current;
    if (!lib) return;
    const k = tm.tipIndex(tipId);
    const node = libNodeOfK(k);
    if (!node) return;
    const type = lib.getTreeType();
    const size0 = lib.getCanvasSize();
    lib.suspend();
    try {
      if (type === 'rc' || type === 'dg' || type === 'hr') {
        const horizontalRows = type === 'hr';
        // rows stay at the fit width; only the row axis is stretched (step zoom), like a table
        const want = 26;
        const ratio = lib.getStepScale() / Math.pow(2, lib.getStepZoom()); // px per row at step zoom 0, zoom 0
        const extent = horizontalRows ? size0.width : size0.height;
        const maxRow = extent / 4;
        const stepZoom = Math.log2(Math.max(1, Math.min(want, maxRow) / ratio));
        boostRef.current = true;
        lib.setProps({ zoom: 0, branchZoom: 0, stepZoom, centre: [0.5, 0.5], nodeSize: Math.max(lib.getNodeSize(), 8) });
        const n2 = lib.findNodeById(node.id);
        const centre = horizontalRows ? centreOnWorld(lib, n2.x, null) : centreOnWorld(lib, null, n2.y);
        // keep the other axis at the fit position
        const fit = centreOnWorld(lib, null, null);
        lib.setProps({ centre: horizontalRows ? [centre[0], fit[1]] : [fit[0], centre[1]] });
      } else {
        const scale0 = lib.getScale();
        const graph = lib.getGraphAfterLayout();
        const R = graph.root.totalSubtreeLength * lib.getBranchScale();
        const pitch0 = (2 * Math.PI * R * scale0) / Math.max(1, graph.root.visibleLeaves);
        const zoom = Math.min(lib.getMaxZoom(), Math.log2(Math.max(1, 18 / Math.max(pitch0, 1e-6))) + lib.getZoom());
        boostRef.current = true;
        lib.setProps({ zoom, branchZoom: 0, stepZoom: 0, nodeSize: Math.max(lib.getNodeSize(), 8) });
        lib.setProps({ centre: centreOnWorld(lib, node.x, node.y) });
      }
    } finally {
      lib.resume();
    }
  };

  // ---------------------------------------------------------------- introspection for the runner
  const hostRect = () => hostRef.current!.getBoundingClientRect();
  const nodeScreen = (lib: any, n: LibNode): [number, number] => lib.projectPoint([n.x, n.y]);
  const onScreen = (p: [number, number], m = 1) => {
    const s = libRef.current.getCanvasSize();
    return p[0] >= m && p[1] >= m && p[0] <= s.width - m && p[1] <= s.height - m;
  };
  /** A point on the node's own branch (the pickable edge of that node), a few px before the node. */
  const branchAnchor = (lib: any, n: LibNode): [number, number] => {
    const type = lib.getTreeType();
    const scale = lib.getScale();
    const par = n.parent;
    let A: number[], B: number[];
    if (!par || n === lib.getGraphAfterLayout().root) {
      const d = 4 / scale;
      if (type === 'hr') return lib.projectPoint([n.x, n.y - d]);
      if (type === 'rc' || type === 'dg') return lib.projectPoint([n.x - d, n.y]);
      return lib.projectPoint([n.x, n.y]);
    }
    if (type === 'rc' || type === 'hr') {
      // the node's own pick region is an L: the piece along the branch axis (rc: horizontal at n.y, hr: vertical at n.x) and the
      // connector to the parent (rc: vertical at par.x, hr: horizontal at par.y). Zero-length branches (common in gene trees) have no
      // branch piece, and the children's connectors would win the pick at the node, so use the connector then.
      const rcType = type === 'rc';
      const nodeEnd = lib.projectPoint([n.x, n.y]);
      const corner = lib.projectPoint(rcType ? [par.x, n.y] : [n.x, par.y]);
      const parentEnd = lib.projectPoint([par.x, par.y]);
      const Lb = Math.hypot(nodeEnd[0] - corner[0], nodeEnd[1] - corner[1]);
      const Lc = Math.hypot(parentEnd[0] - corner[0], parentEnd[1] - corner[1]);
      if (Lb >= 4 || Lc < 4) {
        const d = Math.min(6, Lb / 2);
        const t = Lb > 0 ? d / Lb : 0;
        return [nodeEnd[0] + (corner[0] - nodeEnd[0]) * t, nodeEnd[1] + (corner[1] - nodeEnd[1]) * t];
      }
      // three quarters of the way from the parent: the part of the connector not shared with a nearer sibling's connector
      return [parentEnd[0] + (corner[0] - parentEnd[0]) * 0.75, parentEnd[1] + (corner[1] - parentEnd[1]) * 0.75];
    }
    if (type === 'cr') (A = [n.x, n.y]), (B = [n.cx, n.cy]);
    else (A = [par.x, par.y]), (B = [n.x, n.y]);
    // circular: the radial line runs node -> parent radius (A is the node end); diagonal, radial: parent -> node (B is the node end)
    const pa = lib.projectPoint(A);
    const pb = lib.projectPoint(B);
    const L = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
    const from = type === 'cr' ? pa : pb;
    const to = type === 'cr' ? pb : pa;
    const d = Math.min(6, L / 2);
    const t = L > 0 ? d / L : 0;
    return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
  };
  const inView = (lib: any, n: LibNode): boolean => {
    const g = lib.getGraphAfterLayout();
    if (n.isHidden) return false;
    const r = g.root;
    return n.preIndex >= r.preIndex && n.preIndex < r.preIndex + r.totalNodes;
  };
  const handle: ViewHandle = {
    locate(t) {
      const lib = libRef.current;
      if (!lib) return null;
      const k = t.kind === 'tip' ? tm.tipIndex(t.id) : tm.isNodeId(t.id) ? tm.nodeIndex(t.id) : -1;
      const n = libNodeOfK(k);
      if (!n || !inView(lib, n)) return null;
      const r = hostRect();
      const p = t.kind === 'tip' || n.isCollapsed ? nodeScreen(lib, n) : branchAnchor(lib, n);
      return onScreen(p) ? { x: r.left + p[0], y: r.top + p[1] } : null;
    },
    bounds(t) {
      const lib = libRef.current;
      if (!lib) return null;
      const k = t.kind === 'tip' ? tm.tipIndex(t.id) : tm.isNodeId(t.id) ? tm.nodeIndex(t.id) : -1;
      const n = libNodeOfK(k);
      if (!n || !inView(lib, n)) return null;
      const r = hostRect();
      const s = lib.getCanvasSize();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      if (t.kind === 'tip') {
        const p = nodeScreen(lib, n);
        const h = lib.getNodeSize() / 2 + 2;
        (x0 = p[0] - h), (x1 = p[0] + h), (y0 = p[1] - h), (y1 = p[1] + h);
      } else {
        const graph = lib.getGraphAfterLayout();
        const pre = graph.preorderTraversal;
        const par = n.parent ? lib.projectPoint(branchAnchor(lib, n)) : null;
        void par;
        for (let i = n.preIndex; i < n.preIndex + n.totalNodes; i++) {
          const m = pre[i];
          if (m.isHidden && m !== n) continue;
          const p = lib.projectPoint([m.x, m.y]);
          if (p[0] < x0) x0 = p[0];
          if (p[0] > x1) x1 = p[0];
          if (p[1] < y0) y0 = p[1];
          if (p[1] > y1) y1 = p[1];
        }
      }
      x0 = Math.max(0, x0);
      y0 = Math.max(0, y0);
      x1 = Math.min(s.width, x1);
      y1 = Math.min(s.height, y1);
      if (x1 - x0 < 1 || y1 - y0 < 1) return null;
      return { x: r.left + x0, y: r.top + y0, width: x1 - x0, height: y1 - y0 };
    },
    locateCell(colId, tipId) {
      const lib = libRef.current;
      const p = latest.current;
      if (!lib) return null;
      const cols = p.columns;
      const ci = cols.findIndex((c) => c.id === colId);
      const k = tm.tipIndex(tipId);
      const n = libNodeOfK(k);
      if (ci < 0 || !n || !inView(lib, n)) return null;
      const c = cols[ci];
      const v = c.values[tipId];
      if (v === undefined) return null;
      const r = hostRect();
      const s = lib.getCanvasSize();
      if (String(featRef.current.columnMode ?? 'custom') === 'blocks') {
        // library blocks: a square of blockSize px at tip + pixelOffsets.length + blockPadding + ci * columnWidth
        if (lib.getTreeType() !== 'rc' || !lib.hasMetadata()) return null;
        const graph = lib.getGraphAfterLayout();
        const scale = lib.getScale();
        const pitch = lib.getStepScale() * scale;
        const bs = lib.getBlockSize();
        const [px, py] = lib.projectPoint([alignedX(lib, graph, n), n.y]);
        const x = px + lib.getPixelOffsets().length + lib.getBlockPadding() + ci * lib.getMetadataColumnWidth();
        const h = Math.min(bs, pitch);
        if (py < 0 || py > s.height) return null;
        return { x: r.left + x, y: r.top + py - h / 2, width: bs, height: h };
      }
      if (lib.getTreeType() !== 'rc') return null;
      const graph = lib.getGraphAfterLayout();
      const scale = lib.getScale();
      const pitch = lib.getStepScale() * scale;
      const [px, py] = lib.projectPoint([alignedX(lib, graph, n), n.y]);
      if (py < 0 || py > s.height) return null;
      const x = px + columnLeftPx(lib, cols, ci);
      if (c.kind === 'bar') {
        const w = barPx(Number(v), columnMax(c), c.width);
        const h = Math.max(1, pitch * 0.8);
        return { x: r.left + x, y: r.top + py - h / 2, width: w, height: h };
      }
      if (c.kind === 'alignment' && graph.leaves.length !== tm.tipCount) return null;
      return { x: r.left + x, y: r.top + py - pitch / 2, width: c.width - 4, height: Math.max(1, pitch) };
    },
    custom(): Record<string, number> {
      const lib = libRef.current;
      if (!lib) return {};
      const g = lib.getGraphAfterLayout();
      return { tips: g.root.totalLeaves, nodes: g.root.totalNodes, scale: lib.getScale(), stepPx: lib.getStepScale() * lib.getScale(), deckLayers: lib.deck?.layerManager?.getLayers?.().length ?? -1, overlayRows: rowsKey.current ? rowsKey.current.split('|').length : 0 };
    },
  };
  useLayoutEffect(() => {
    if (libRef.current) props.handleRef.current = handle;
  });

  // ---------------------------------------------------------------- render
  const th = resolveTheme(theme);
  const links = props.tipLinks;
  const keyActivate = (id: string) => {
    const k = tm.tipIndex(id);
    if (k < 0) return;
    latest.current.emit({ type: 'tipClick', nodeId: tm.nodeId(k), isTip: true, tipIds: [id], source: 'adapter-derived', libraryPayload: { via: 'keyboard row overlay (ours, not a library event)' } });
    setClicked(id);
  };
  return (
    <div ref={wrapRef} className="pc-wrap" style={{ ['--pc-hl' as any]: th.hl }} aria-label={`Phylogenetic tree, ${tm.tipCount} tips (Phylocanvas.gl WebGL canvas; tip rows below are an overlay of visible rows)`} role="tree">
      <style>{CSS}</style>
      <div ref={hostRef} className="pc-host" />
      <div className="pc-over" role="presentation">
        {rows.map((r) =>
          links ? (
            <a key={r.id} className="row" data-tip-id={r.id} href={links(r.id)} target="_blank" rel="noopener noreferrer" tabIndex={0} style={{ left: r.left, top: r.top, width: r.width, height: r.height, lineHeight: r.height + 'px', fontFamily: th.font, fontSize: Number(features.fontSize ?? 12) }} aria-label={r.id}>
              {r.id}
            </a>
          ) : (
            <span key={r.id} className="row" data-tip-id={r.id} role="treeitem" tabIndex={0} aria-label={r.id} onClick={() => keyActivate(r.id)} onKeyDown={(e) => e.key === 'Enter' && keyActivate(r.id)} style={{ left: r.left, top: r.top, width: r.width, height: r.height, pointerEvents: 'none' }}>
              {r.id}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

let _mc: CanvasRenderingContext2D | null = null;
function measureCtx(family: string, size: number): CanvasRenderingContext2D {
  _mc ??= document.createElement('canvas').getContext('2d')!;
  _mc.font = `${size}px ${family}`;
  return _mc;
}

// ------------------------------------------------------------------------------------------ capabilities and features

const capabilities: CapabilityReport = {
  tipClick: { level: 'partial', how: 'No callback API. A plugin wraps selectNode (decorate): leaf shapes and leaf labels are picked by deck.gl and arrive as selectNode(node); we emit tipClick with the label, and keep the selection in React (we do not call the original selectNode).' },
  internalNodeClick: { level: 'partial', how: 'Leaf-only selection in the library. Internal nodes have no marker; clicking the BRANCH of a clade (edge picking) calls selectNode(node) with an internal node object, which our wrapper turns into branchClick. Collapsed clades (pie charts) give nodeClick. Ids are synthetic (__<preorder>), mapped by us to n<k>, validated against the shared TreeModel at mount.' },
  branchClick: { level: 'partial', how: 'Edge layers are pickable (pickingRadius 2 px); the picked edge is the child node of the branch. Sub-pixel rows make the pick ambiguous at the fit view of large trees.' },
  hover: { level: 'partial', how: 'highlightNode(node) is wrapped (decorate); hovering a branch also highlights the whole clade in the highlight colour (library-native). Needs interactive.highlight. Hover on big clades reports at most 2000 tip ids.' },
  descendantTipsInPayload: { level: 'no', how: 'The library never reports tip sets. For internal nodes the wrapper computes them from the shared TreeModel (source: adapter-derived).' },
  cladeColouring: { level: 'partial', how: 'Per-tip styles only: every tip under the clade gets fillColour and strokeColour; styleNodeEdges makes the clade branches take the colour when all children agree (the clade root edge and all inside it). Two sibling clades of the same colour also colour their parent edge. Re-styles O(tips).' },
  highlightTip: { level: 'yes', how: 'selectedIds draws a halo ring and forces the label even when labels are thinned; set from React state.' },
  focusTip: { level: 'partial', how: 'No zoom-to-node in the library. Wrapper computes step zoom (rows to 26 px) and the normalised centre from node coordinates (getGraphAfterLayout + the library\'s own target/centre maths) and sets them with one batched setProps (suspend/resume). Rectangular, diagonal, hierarchical and circular/radial handled.' },
  tipAsLink: { level: 'partial', how: 'Not in the library (WebGL text). DOM overlay of real a[href][data-tip-id] elements for the visible rows only (rows >= 9 px, rectangular and diagonal layouts), positioned from projectPoint on every render; other tips have no anchor.' },
  customColumns: { level: 'partial', how: 'Library: coloured-block columns (metadata + blocks, rectangular/circular, one colour per cell, no text or size). Ours: bar and text columns as custom deck.gl layers via addLayer, drawn for visible rows only; width reserved through a dummy block.' },
  alignmentColumn: { level: 'partial', how: 'Own addLayer: one BitmapLayer texture (one pixel per residue) stretched over the rows; only valid when no clade is collapsed and the root is not changed.' },
  radialLayout: { level: 'yes', how: 'Library layouts: circular (cr, used for the shell\'s radial tab), radial/unrooted equal-angle (rd), diagonal, hierarchical; selectable in Library options.' },
  branchLengthToggle: { level: 'partial', how: 'The library always draws branch lengths. Cladogram is emulated by feeding synthetic lengths (parentHeight - height, tips aligned) as the source, which re-parses and re-lays out the whole tree. Negative lengths become 0 in our conversion (the library would take the absolute value).' },
  scaleBar: { level: 'partial', how: 'Not in the library. Own addLayer: line + label with a nice length computed from getBranchScale() * getScale(); only for phylograms with lengths; no time axis.' },
  darkTheme: { level: 'yes', how: 'Colour props (fontColour, fillColour, strokeColour, highlightColour, backgroundColour as CSS strings) from gbifDarkTheme(); canvas background is our host element\'s CSS background colour, not a library prop.' },
  cssTokens: { level: 'partial', how: 'No CSS: WebGL. Tokens are read in JS (gbifTheme) and passed as props; the runner tokens background/foreground/branch/highlight/fontFamily map to host background, fontColour+fillColour, strokeColour, highlightColour, fontFamily.' },
  multipleInstances: { level: 'yes', how: 'Each instance owns a Deck + WebGL context; two live instances (main + side panel) worked. The library says "single WebGL context", which holds per instance, not per page. Browser limit of about 16 live contexts applies.' },
  cleanUnmount: { level: 'partial', how: 'destroy() runs deck.finalize() but leaves the canvas, the host inline styles and (until GC) the GL context; wrapper removes children and calls WEBGL_lose_context.loseContext(). Perf entries from the parser accumulate in performance.getEntries().' },
  controlledState: { level: 'partial', how: 'Input is controlled (setProps with source, type, styles, selectedIds, collapsedIds, rootId, zoom, centre, ...). Output has no callbacks: view (zoom/centre) changes through setView, selection/hover through wrapped methods. We only forward click and hover; view state is not exposed to React.' },
  zoomToFit: { level: 'partial', how: 'Fit on mount and on type change; fitInCanvas() exists but the shell has no refit control. Wheel = uniform zoom, shift/alt+wheel = stretch rows only (step zoom), ctrl/meta+wheel = stretch branches only (branch zoom).' },
  overviewOrMinimap: { level: 'no', how: 'No minimap. Zoomed out the whole tree is drawn (every edge, one shape per tip, thinned labels); no clade summaries. Collapsing clades into pie charts is manual (collapsedIds).' },
};

const features: AdapterFeature[] = [
  { id: 'wheel', label: 'Mouse wheel zooms', kind: 'select', default: 'auto', options: [{ value: 'auto', label: 'Rows only up to 20k tips, else both axes' }, { value: 'rows', label: 'Rows only (table-like)' }, { value: 'library', label: 'Both axes (library default)' }], level: 'partial', how: 'The library controller zooms both axes on a plain wheel (shift/alt = rows, ctrl/meta = branches). We intercept the plain wheel in rectangular, diagonal and hierarchical layouts and call the library\'s setStepZoom, which re-lays out all nodes (O(n) JS per step); zooming out to the fit calls fitInCanvas(). Above 20k tips auto leaves the wheel to the library.' },
  { id: 'treeType', label: 'Layout (library tree type)', kind: 'select', default: 'auto', options: [{ value: 'auto', label: 'Follow rectangular/radial tabs' }, { value: 'rc', label: 'Rectangular (rc)' }, { value: 'cr', label: 'Circular (cr)' }, { value: 'rd', label: 'Radial / unrooted (rd)' }, { value: 'dg', label: 'Diagonal (dg)' }, { value: 'hr', label: 'Hierarchical (hr)' }], level: 'yes', how: 'Library `type` prop; resets zoom and centre on change.' },
  { id: 'labels', label: 'Tip labels', kind: 'toggle', default: true, description: 'showLabels + showLeafLabels. Labels are thinned by the library when rows are smaller than the font.' },
  { id: 'alignLabels', label: 'Align tip labels (leader lines)', kind: 'toggle', default: false, description: 'alignLabels (rectangular, circular, hierarchical). Switched on automatically when columns are shown.' },
  { id: 'internalLabels', label: 'Internal node labels (names, support)', kind: 'toggle', default: false, description: 'showInternalLabels: the internal node name text of the source; there are no internal node markers.' },
  { id: 'branchLengthLabels', label: 'Branch length labels', kind: 'toggle', default: false, description: 'showBranchLengths.' },
  { id: 'scaleBar', label: 'Scale bar (our own layer)', kind: 'toggle', default: true, level: 'partial', how: 'Custom deck.gl layer through addLayer; the library has none.' },
  { id: 'collapse', label: 'Collapse clades smaller than', kind: 'select', default: '0', options: [{ value: '0', label: 'Off' }, { value: '5', label: '5 tips' }, { value: '20', label: '20 tips' }, { value: '100', label: '100 tips' }, { value: '1000', label: '1000 tips' }], level: 'partial', how: 'collapsedIds + pie charts are in the library; choosing which clades to collapse is ours (top-most clades below the size). Columns that need one row per tip (alignment) switch off while collapsed.' },
  { id: 'rootAtClicked', label: 'Re-root view at last clicked clade', kind: 'toggle', default: false, level: 'partial', how: 'rootId prop shows only that subtree; click a branch (or a collapsed clade) to pick it. Clearing the switch restores the whole tree.' },
  { id: 'columnMode', label: 'Columns as', kind: 'select', default: 'custom', options: [{ value: 'custom', label: 'Own layers (bars, text, alignment)' }, { value: 'blocks', label: 'Library coloured blocks' }], level: 'partial', how: 'Blocks: one coloured square per cell (bar values become opacity of the GBIF green, categories use the palette); no text, no bar length, no alignment letters.' },
  { id: 'nodeSize', label: 'Tip marker size (px)', kind: 'select', default: 'auto', options: [{ value: 'auto', label: 'Auto by tree size' }, { value: '2', label: '2' }, { value: '4', label: '4' }, { value: '6', label: '6' }, { value: '10', label: '10' }, { value: '14', label: '14' }], description: 'nodeSize is fixed in px and also reserves layout space; it does not shrink with row height.' },
  { id: 'tipShape', label: 'Tip marker shape', kind: 'select', default: 'circle', options: ['circle', 'square', 'diamond', 'triangle', 'pentagram', 'hexagon', 'plus', 'cross'].map((v) => ({ value: v, label: v })) },
  { id: 'branchWidth', label: 'Branch width', kind: 'select', default: '1', options: [{ value: '1', label: '1 px' }, { value: '2', label: '2 px' }, { value: '3', label: '3 px' }], description: 'strokeWidth (one width for every edge).' },
  { id: 'fontSize', label: 'Label font size', kind: 'select', default: '12', options: ['10', '12', '14', '16'].map((v) => ({ value: v, label: v + ' px' })) },
  { id: 'hoverHighlight', label: 'Hover highlight (picking on every mouse move)', kind: 'toggle', default: true, description: 'interactive.highlight. Each pointer move makes deck.gl render a picking pass; the hovered clade is recoloured (edge colours of the whole subtree).' },
  { id: 'nativeParser', label: "Parse with the library's Newick parser", kind: 'toggle', default: false, level: 'partial', how: 'Default: a biojs object built from the shared TreeModel (the library tokenizer breaks on quoted labels with delimiters, comments and NHX). On = hands the Newick text over; changes parse time and may change ids.' },
  { id: 'hiDpi', label: 'Device pixel ratio rendering (applies on next mount)', kind: 'toggle', default: false, level: 'partial', how: 'The library hard-codes useDevicePixels: false (blurry on retina). deck.setProps({ useDevicePixels: true }) on the instance works around it (reaching into tree.deck).' },
  { id: 'forceContextLoss', label: 'Release GL context on unmount (WEBGL_lose_context)', kind: 'toggle', default: true, level: 'partial', how: 'Workaround on top of destroy(); switch off to test what destroy() alone leaves behind (applies on unmount).' },
];

// `?pc.<featureId>=<value>` overrides a Library option default (for probing and screenshots; not used by the runner).
if (typeof location !== 'undefined') {
  const q = new URLSearchParams(location.search);
  for (const f of features) {
    const v = q.get('pc.' + f.id);
    if (v !== null) f.default = f.kind === 'toggle' ? v === '1' || v === 'true' : v;
  }
}

export const adapter: CandidateAdapter = {
  candidate: {
    name: 'phylocanvas-gl',
    version: LIB_VERSION,
    license: 'MIT',
    notes: '@phylocanvas/phylocanvas.gl 1.64.1 + deck.gl 8.9.36 (WebGL), own React wrapper in this folder. Library has no callbacks: events through plugin/decorate.',
  },
  capabilities,
  View: PhylocanvasView,
  features,
  // fonts must be loaded before deck builds its glyph atlas (it caches glyphs per font string and never refreshes)
  ready: typeof document === 'undefined' ? undefined : Promise.race([document.fonts.load('12px Rubik').then(() => undefined), new Promise<void>((r) => setTimeout(r, 1500))]).catch(() => undefined),
};

export type { ColumnSpec, Point, Rect, TreeModel };
void COL_GAP;
