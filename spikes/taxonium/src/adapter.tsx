// Taxonium (taxonium-component 2.1.24, GPL-3.0): DEMO ONLY, never something to ship in gbif.org.
//
// What Taxonium is: a whole viewer app (deck.gl/WebGL tree, search panel, minimap, legend, modals) in one React 19
// component. It takes a tree FILE (Newick/Nexus/jsonl/Nextstrain text) plus an optional metadata TSV and parses and
// lays it out in a module-level singleton Web Worker. Its only callbacks are onNodeSelect(nodeId) and
// onNodeDetailsLoaded(nodeId, details). Its controlled state is `query` (search, colour field, x axis).
//
// How this adapter uses it (see convert.ts for the data side):
//  * the shared TreeModel is written as Newick (internal nodes named n<preorder>) plus a TSV with one unique key per tip;
//  * click: onNodeSelect gives the library's node_id, onNodeDetailsLoaded gives the node record (name, is_tip, num_tips);
//    the name maps back to our ids. The tip list of an internal node is NOT in the payload: it comes from the TreeModel
//    (source: 'adapter-derived');
//  * highlight: a text_per_line search on the tip name through the controlled `query` prop (library-native, red rings);
//  * everything else Taxonium does not expose as props (view state, colour of tips, line/label colours, minimap) is
//    reached through React fiber props of the library's inner <Deck> component: `view.setViewState`,
//    `setAdditionalColorMapping`, the `settings` setters and `deckRef.current.deck`. That is reaching into internals:
//    every capability that needs it is reported 'partial' and described.
// No recursion over trees.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Taxonium from 'taxonium-component';
import type { CandidateAdapter, CapabilityReport, Point, Rect, ThemeSpec, ViewHandle, ViewProps } from '../../shared/types.ts';
import { gbifTheme, gbifDarkTheme } from '../../shared/gbif-theme.ts';
import { buildInput, taxoniumLayout } from './convert.ts';
import type { Geometry, TaxInput } from './convert.ts';

const VERSION = '2.1.24';

const CSS = `
.tx-root{position:relative;width:100%;height:100%;overflow:hidden;background:var(--tx-bg);color:var(--tx-fg);font-family:var(--tx-font)}
.tx-root .taxonium{background:transparent}
/* Taxonium's colour legend (Key) lists 10 arbitrary tip keys in our use (one unique key per tip): hidden with CSS, there is no prop for it (h3 = collapsed state, .key-text = expanded) */
.tx-root div:has(> h3.cursor-pointer), .tx-root div:has(> .key-text){display:none}
.tx-links{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.tx-links a{position:absolute;white-space:nowrap;pointer-events:auto;font-style:italic;color:var(--tx-fg);background:var(--tx-bg);text-decoration:underline;padding:0 2px;outline-offset:1px;font-family:var(--tx-font)}
.tx-links a:focus-visible{outline:2px solid var(--tx-hl)}
`;

type RGB = [number, number, number];

function parseColour(c: string, fallback: RGB = [128, 128, 128]): RGB {
  const s = c.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16)) as RGB;
  m = /^#([0-9a-f]{6})/i.exec(s);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
  m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(s);
  if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
  return fallback;
}

function themeVals(t: ThemeSpec) {
  const g = t.dark ? gbifDarkTheme() : gbifTheme();
  const k = t.tokens ?? {};
  return {
    bg: k.background ?? g.bg1,
    fg: k.foreground ?? g.fg1,
    branch: k.branch ?? (t.dark ? g.fg3 : g.fg2),
    hl: k.highlight ?? g.primary,
    font: k.fontFamily ?? g.fontBody,
    tip: k.foreground ?? (t.dark ? g.fg3 : g.fg2),
  };
}

// ------------------------------------------------------------------------------------------- fiber access
interface DeckProps {
  deckRef: { current: { deck?: any } | null };
  setAdditionalColorMapping: (f: (old: Record<string, unknown>) => Record<string, unknown>) => void;
  settings: Record<string, any>;
  view: { setViewState: (f: (vs: any) => any) => void; zoomReset: () => void };
  config?: Record<string, any>;
}

/** Find the props of Taxonium's inner <Deck> component through the React fiber of any DOM node it rendered. */
function findDeckProps(root: HTMLElement): DeckProps | null {
  const els = root.querySelectorAll('div');
  for (const el of Array.from(els)) {
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    if (!key) continue;
    let f = (el as any)[key];
    for (let d = 0; f && d < 80; d++, f = f.return) {
      const p = f.memoizedProps;
      if (p && p.deckRef && p.setAdditionalColorMapping && p.settings && p.view) {
        // a fiber and its alternate hold the props of two renders: prefer the one whose config is loaded
        const q = f.alternate?.memoizedProps;
        if (q && q.config && (!p.config || (q.config.num_nodes ?? 0) > (p.config.num_nodes ?? 0))) return q as DeckProps;
        return p as DeckProps;
      }
    }
  }
  return null;
}

const ZERO_QUERY = {
  backend: '',
  xType: 'x_dist',
  mutationTypesEnabled: JSON.stringify({ aa: true, nt: false }),
  treenomeEnabled: false,
  color: JSON.stringify({ field: 'meta_id' }),
};
const HL_KEY = 'gbifhl';
const hlSpec = (text: string) => ({ key: HL_KEY, type: 'name', method: 'text_per_line', text, gene: 'S', position: 484, new_residue: 'any', min_tips: 0 });

/** Affine map from Taxonium coordinates to canvas px: screen = s * data + b (orthographic view). */
interface Cam {
  sx: number;
  sy: number;
  bx: number;
  by: number;
  w: number;
  h: number;
}
const camOfViewport = (vp: any): Cam => {
  const a = vp.project([0, 0]);
  const b = vp.project([1, 1]);
  return { sx: b[0] - a[0], sy: b[1] - a[1], bx: a[0], by: a[1], w: vp.width, h: vp.height };
};

function TaxView(props: ViewProps) {
  const { tree, branchLengths, theme, features, size, emit } = props;
  const latest = useRef(props);
  latest.current = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const internals = useRef<DeckProps | null>(null);
  const getInternals = useCallback((): DeckProps | null => {
    if (internals.current && internals.current.deckRef.current?.deck) return internals.current;
    const el = rootRef.current;
    internals.current = el ? findDeckProps(el) : null;
    return internals.current;
  }, []);

  // ---- data: Newick + TSV from the shared model; layout replica for coordinates
  const input = useMemo<TaxInput>(() => buildInput(tree, branchLengths), [tree, branchLengths]);
  const geom = useMemo<Geometry>(() => taxoniumLayout(tree, branchLengths), [tree, branchLengths]);
  const geomRef = useRef(geom);
  geomRef.current = geom;
  const colourStat = useRef({ ms: 0, entries: 0, calls: 0 });
  const inputRef = useRef(input);
  inputRef.current = input;
  const sourceData = useMemo(
    () => ({
      status: 'loaded',
      filename: 'tree.nwk',
      filetype: 'nwk',
      data: input.newick,
      metadata: { status: 'loaded', filename: 'meta.tsv', filetype: 'meta_tsv', data: input.tsv },
    }),
    [input],
  );

  // ---- controlled query state (this is Taxonium's own controlled-state API)
  const [query, setQuery] = useState<Record<string, unknown>>(() => ({
    ...ZERO_QUERY,
    srch: JSON.stringify([hlSpec('')]),
    enabled: JSON.stringify({ [HL_KEY]: false }),
  }));
  const updateQuery = useCallback((q: Record<string, unknown>) => setQuery((o) => ({ ...o, ...q })), []);

  // ---- events from the library's two callbacks
  const pendingId = useRef<string | number | null>(null);
  const onNodeSelect = useCallback((id: string | number | null) => {
    pendingId.current = id;
  }, []);
  const onNodeDetailsLoaded = useCallback((id: string | number | null, d: any) => {
    if (d == null || id == null || pendingId.current !== id) return;
    pendingId.current = null;
    const L = latest.current;
    const inp = inputRef.current;
    const name = String(d.name).replace(/;$/, ''); // the library keeps the Newick terminator in the root's name
    const payload = { node_id: d.node_id, name, is_tip: d.is_tip, num_tips: d.num_tips };
    if (d.is_tip) {
      const tipId = inp.renamed.get(name) ?? name;
      const i = L.tree.tipIndex(tipId);
      if (i < 0) return;
      L.emit({ type: 'tipClick', nodeId: L.tree.nodeId(i), isTip: true, tipIds: [tipId], source: 'library', libraryPayload: payload });
    } else {
      let i: number;
      try {
        i = L.tree.nodeIndex(name);
      } catch {
        return;
      }
      L.emit({
        type: 'nodeClick',
        nodeId: L.tree.nodeId(i),
        isTip: false,
        tipIds: L.tree.descendantTips(i),
        source: 'adapter-derived',
        libraryPayload: { ...payload, treeModelTips: L.tree.tipCountOf(i) },
      });
    }
  }, []);

  // ---- camera (read from deck.gl through the fiber) and projection
  const camOf = useCallback((): { vp: any; canvas: HTMLElement } | null => {
    const ip = getInternals();
    const deck = ip?.deckRef.current?.deck;
    if (!deck) return null;
    const vp = (deck.getViewports?.() ?? []).find((v: any) => v.id === 'main');
    const canvas: HTMLElement | undefined = deck.canvas ?? deck.getCanvas?.();
    return vp && canvas ? { vp, canvas } : null;
  }, [getInternals]);

  const project = useCallback(
    (x: number, y: number): Point | null => {
      const c = camOf();
      if (!c) return null;
      const [px, py] = c.vp.project([x, y]);
      const r = c.canvas.getBoundingClientRect();
      return { x: r.left + px, y: r.top + py };
    },
    [camOf],
  );

  const blocked = useCallback(
    (p: Point): boolean => {
      const c = camOf();
      if (!c) return true;
      const r = c.canvas.getBoundingClientRect();
      const x = p.x - r.left;
      const y = p.y - r.top;
      if (x < 6 || y < 6 || x > r.width - 6 || y > r.height - 6) return true;
      if (latest.current.features.minimap !== false && x >= r.width * 0.78 && x <= r.width * 0.995 && y <= r.height * 0.37) return true; // minimap view sits on top
      if (x > r.width - 150 && y > r.height - 40) return true; // library's own button strip
      return false;
    },
    [camOf],
  );

  const handle: ViewHandle = {
    locate(t) {
      const g = geomRef.current;
      if (t.kind === 'tip') {
        const n = tree.tipIndex(t.id); // tipIndex returns the NODE index of the tip
        if (n < 0) return null;
        const p = project(g.X[n], g.Y[n]);
        return p && !blocked(p) ? p : null;
      }
      if (!tree.isNodeId(t.id)) return null;
      const i = tree.nodeIndex(t.id);
      if (i === 0) return null; // the root has no edge and no marker: nothing to click
      if (tree.childCount[i] === 0) {
        const p = project(g.X[i], g.Y[i]);
        return p && !blocked(p) ? p : null;
      }
      // internal node: the click target is its own horizontal edge (midpoint); there are no node markers
      const p = project((g.X[i] + g.X[tree.parent[i]]) / 2, g.Y[i]);
      return p && !blocked(p) ? p : null;
    },
    bounds(t) {
      const g = geomRef.current;
      const i = t.kind === 'tip' ? tree.tipIndex(t.id) : tree.isNodeId(t.id) ? tree.nodeIndex(t.id) : -1;
      if (i < 0) return null;
      const c = camOf();
      if (!c) return null;
      let x0 = g.X[i];
      let x1 = g.X[i];
      for (let k = i; k < tree.subtreeEnd[i]; k++) if (g.X[k] > x1) x1 = g.X[k];
      const ya = g.Y[tree.tipNode[tree.leafStart[i]]];
      const yb = g.Y[tree.tipNode[tree.leafEnd[i] - 1]];
      const a = c.vp.project([x0, Math.min(ya, yb)]);
      const b = c.vp.project([x1, Math.max(ya, yb)]);
      const r = c.canvas.getBoundingClientRect();
      let rx0 = Math.max(0, Math.min(a[0], b[0]));
      let rx1 = Math.min(r.width, Math.max(a[0], b[0]) + 4);
      let ry0 = Math.max(0, Math.min(a[1], b[1]) - 2);
      let ry1 = Math.min(r.height, Math.max(a[1], b[1]) + 2);
      if (t.kind === 'tip') {
        rx0 = Math.max(0, a[0] - 5);
        rx1 = Math.min(r.width, a[0] + 5);
        ry0 = Math.max(0, a[1] - 5);
        ry1 = Math.min(r.height, a[1] + 5);
      }
      if (rx1 - rx0 < 1 || ry1 - ry0 < 1) return null;
      return { x: r.left + rx0, y: r.top + ry0, width: rx1 - rx0, height: ry1 - ry0 };
    },
    locateCell() {
      return null;
    },
    custom() {
      const c = camOf();
      const out: Record<string, number> = { tips: tree.tipCount, nodes: tree.nodeCount, inputMs: inputRef.current.ms, newickKB: inputRef.current.newick.length / 1024, lastColourBuildMs: colourStat.current.ms, colourCalls: colourStat.current.calls };
      if (c) {
        const ip = getInternals();
        const layer = ip?.deckRef.current?.deck?.props?.layers?.find?.((l: any) => l?.id === 'main-line-horiz');
        out.drawnNodes = layer?.props?.data?.length ?? 0;
        // self-check of the layout replica: compare the library's own node coordinates (by name) with ours
        const gg = geomRef.current;
        const inp = inputRef.current;
        let err = 0;
        let checked = 0;
        for (const nd of layer?.props?.data ?? []) {
          let i = -1;
          if (nd.is_tip) {
            i = tree.tipIndex(inp.renamed.get(nd.name) ?? nd.name);
          } else if (tree.isNodeId(nd.name.replace(/;$/, ''))) i = tree.nodeIndex(nd.name.replace(/;$/, ''));
          if (i < 0) continue;
          checked++;
          err = Math.max(err, Math.abs(nd.x_dist - gg.X[i]) / (gg.maxX - gg.minX), Math.abs(nd.y - gg.Y[i]) / 2000);
        }
        out.geomCheckedNodes = checked;
        out.geomMaxRelErr = err;
        const cc = camOfViewport(c.vp);
        out.pxPerUnitX = cc.sx;
        out.pxPerUnitY = cc.sy;
      }
      return out;
    },
  };
  // read-only debugging hook for scripts/probe (not used by the runner)
  if (typeof window !== 'undefined' && props.instanceId === 0) (window as any).__taxoniumDebug = { getInternals, geomRef, inputRef, tree, camOf, colourStat };
  useLayoutEffect(() => {
    props.handleRef.current = handle;
    return () => {
      props.handleRef.current = null;
    };
  });
  useEffect(
    () => () => {
      if (props.instanceId === 0) delete (window as any).__taxoniumDebug; // do not keep the tree alive after unmount
    },
    [],
  );

  // ---- view: fit and focus through view.setViewState (Taxonium has no prop for the camera)
  const fit = useCallback(() => {
    const ip = getInternals();
    const c = camOf();
    if (!ip || !c) return false;
    const g = geomRef.current;
    const W = c.vp.width;
    const H = c.vp.height;
    const span = Math.max(1e-6, g.maxX - g.minX);
    const zx = Math.log2((W * 0.8) / span);
    const zy = Math.log2((H * 0.94) / 2000);
    const tx = g.minX + (W * 0.46) / 2 ** zx;
    ip.view.setViewState((vs: any) => ({ ...vs, zoom: [zx, zy], target: [tx, 1000] }));
    return true;
  }, [camOf, getInternals]);

  useEffect(() => {
    const fr = props.focusRequest;
    if (!fr) return;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      const ip = getInternals();
      const c = camOf();
      const node = tree.tipIndex(fr.tipId); // node index of the tip
      if (!ip || !c || node < 0) return void setTimeout(run, 50);
      const g = geomRef.current;
      const H = c.vp.height;
      const pitch = 2000 / Math.max(1, tree.tipCount - 1);
      const rows = Math.min(tree.tipCount, 26);
      const zy = Math.log2(H / (rows * pitch));
      const cur = c.vp.zoom ?? [0, 0];
      ip.view.setViewState((vs: any) => ({ ...vs, zoom: [Array.isArray(vs.zoom) ? vs.zoom[0] : cur[0], Math.max(zy, Array.isArray(vs.zoom) ? vs.zoom[1] : zy)], target: [g.X[node], g.Y[node]] }));
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [props.focusRequest]);

  // ---- ready: wait for the worker, fit, theme, colours
  const dataKey = useMemo(() => Math.random().toString(36).slice(2), [input]);
  useEffect(() => {
    let cancelled = false;
    const t0 = performance.now();
    const layerOf = () => getInternals()?.deckRef.current?.deck?.props?.layers?.find?.((l: any) => l?.id === 'main-line-horiz');
    const tick = () => {
      if (cancelled) return;
      const ip = getInternals();
      const layer = layerOf();
      if (ip && layer && layer.props?.data?.length > 0 && camOf()) {
        pushSettings();
        pushColours();
        fit();
        const first = layer.props.data;
        const t1 = performance.now();
        const done = () => {
          if (cancelled) return;
          props.onReady({
            parseMs: inputRef.current.ms,
            tips: Number(((rootRef.current && findDeckProps(rootRef.current)) || getInternals())?.config?.num_tips ?? 0),
            notes: `parseMs = adapter-side Newick+TSV writing only (the worker's parse and layout are inside firstRenderMs); first data after ${(t1 - t0).toFixed(0)} ms; tips from the library's config.num_tips; library draws a de-overplotted subset (${first.length} nodes at first query)`,
          });
        };
        // wait for the query that follows the fit (debounced 100 ms inside the library) or at most 1.2 s
        const w0 = performance.now();
        const wait = () => {
          if (cancelled) return;
          const l2 = layerOf();
          if ((l2 && l2.props.data !== first) || performance.now() - w0 > 1200) done();
          else setTimeout(wait, 40);
        };
        wait();
        return;
      }
      if (performance.now() - t0 > 120000) return;
      setTimeout(tick, 30);
    };
    tick();
    return () => {
      cancelled = true;
      internals.current = null;
    };
  }, [dataKey]);

  // ---- theme and library settings (settings setters reached through the fiber)
  const tv = themeVals(theme);
  const pushSettings = useCallback(() => {
    const ip = getInternals();
    if (!ip) return;
    const v = themeVals(latest.current.theme);
    const s = ip.settings;
    s.setLineColor?.(parseColour(v.branch));
    s.setTerminalNodeLabelColor?.(parseColour(v.fg));
    s.setCladeLabelColor?.(parseColour(v.fg));
    s.setNodeSize?.(Number(latest.current.features.nodeSize ?? 3));
    s.setOpacity?.(1);
    s.setDisplayPointsForInternalNodes?.(!!latest.current.features.internalMarkers);
    if (Boolean(s.minimapEnabled) !== (latest.current.features.minimap !== false)) s.toggleMinimapEnabled?.();
  }, [getInternals]);
  const minimapShown = useRef<boolean | null>(null);
  useEffect(() => {
    const ip = getInternals();
    if (!ip) return;
    pushSettings();
  }, [theme, features.nodeSize, features.internalMarkers]);
  useEffect(() => {
    // minimap toggle is a toggle in the library (no setter): call it only when our wish differs from the last wish
    const ip = getInternals();
    const want = features.minimap !== false;
    if (!ip) {
      minimapShown.current = true;
      return;
    }
    if (minimapShown.current === null) minimapShown.current = true;
    if (minimapShown.current !== want) {
      ip.settings.toggleMinimapEnabled?.();
      minimapShown.current = want;
    }
  }, [features.minimap]);

  // ---- clade colours: one key per tip (TSV column 'id') -> RGB through the library's own colour mapping state
  const pushColours = useCallback(() => {
    const ip = getInternals();
    if (!ip) return;
    const t0 = performance.now();
    const L = latest.current;
    const v = themeVals(L.theme);
    const def = parseColour(v.tip);
    const inp = inputRef.current;
    const m: Record<string, RGB> = {};
    for (let r = 0; r < L.tree.tipCount; r++) m[inp.libName(L.tree.tipLabels[r])] = def;
    for (const c of L.colouredClades) {
      let a: number;
      try {
        a = L.tree.nodeIndex(c.nodeId);
      } catch {
        continue;
      }
      const col = parseColour(c.colour);
      for (let r = L.tree.leafStart[a]; r < L.tree.leafEnd[a]; r++) m[inp.libName(L.tree.tipLabels[r])] = col;
    }
    ip.setAdditionalColorMapping(() => m);
    colourStat.current = { ms: performance.now() - t0, entries: L.tree.tipCount, calls: colourStat.current.calls + 1 };
  }, [getInternals]);
  useEffect(() => {
    pushColours();
  }, [props.colouredClades, theme, dataKey]);

  // ---- highlight: library search (text_per_line on tip name), shown as rings
  useEffect(() => {
    const names = props.highlightedTips.map((t) => inputRef.current.libName(t));
    updateQuery({ srch: JSON.stringify([hlSpec(names.join('\n'))]), enabled: JSON.stringify({ [HL_KEY]: names.length > 0 }) });
  }, [props.highlightedTips, dataKey]);

  // ---- tip links: DOM anchors over the visible rows (Taxonium draws labels in WebGL)
  const [cam, setCam] = useState<Cam | null>(null);
  useEffect(() => {
    if (!props.tipLinks) {
      setCam(null);
      return;
    }
    let raf = 0;
    let last = '';
    const loop = () => {
      const c = camOf();
      if (c) {
        const cc = camOfViewport(c.vp);
        const key = [cc.sx, cc.sy, cc.bx, cc.by, cc.w, cc.h].map((x) => x.toFixed(4)).join(',');
        if (key !== last) {
          last = key;
          setCam(cc);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [props.tipLinks, dataKey]);

  const links: React.ReactNode[] = [];
  if (props.tipLinks && cam) {
    const pitchPx = (cam.sy * 2000) / Math.max(1, tree.tipCount - 1);
    if (pitchPx >= 8) {
      const g = geomRef.current;
      const perRow = 2000 / Math.max(1, tree.tipCount - 1);
      const r0 = Math.max(0, Math.floor(-cam.by / cam.sy / perRow) - 1);
      const r1 = Math.min(tree.tipCount - 1, Math.ceil((cam.h - cam.by) / cam.sy / perRow) + 1);
      for (let r = r0; r <= r1 && links.length < 400; r++) {
        const node = tree.tipNode[r];
        const sx = g.X[node] * cam.sx + cam.bx;
        const sy = g.Y[node] * cam.sy + cam.by;
        if (sx < -50 || sx > cam.w || sy < -pitchPx || sy > cam.h + pitchPx) continue;
        const text = tree.tipLabels[r];
        const fs = Math.min(13, Math.max(8, pitchPx * 0.7));
        links.push(
          <a key={r} data-tip-id={text} href={props.tipLinks(text)} target="_blank" rel="noopener noreferrer" style={{ left: sx + 8, top: sy - fs * 0.75, fontSize: fs, lineHeight: fs * 1.5 + 'px' }}>
            {text}
          </a>,
        );
      }
    }
  }

  const style = {
    '--tx-bg': tv.bg,
    '--tx-fg': tv.fg,
    '--tx-hl': tv.hl,
    '--tx-font': tv.font,
  } as React.CSSProperties;

  return (
    <div ref={rootRef} className="tx-root" style={style} aria-label={`Phylogenetic tree, ${tree.tipCount} tips (Taxonium, WebGL canvas)`}>
      <style>{CSS}</style>
      <Taxonium
        key={dataKey}
        sourceData={sourceData}
        query={query}
        updateQuery={updateQuery}
        sidePanelHiddenByDefault={true}
        onNodeSelect={onNodeSelect}
        onNodeDetailsLoaded={onNodeDetailsLoaded}
        configDict={{ title: 'GBIF phylo spike' }}
      />
      <div className="tx-links">{links}</div>
    </div>
  );
}

const capabilities: CapabilityReport = {
  tipClick: { level: 'yes', how: 'onNodeSelect(node_id) then onNodeDetailsLoaded(node_id, details); details.name is the tip label. The event reaches us only after the worker answered the details request (about 50 ms debounce plus a round trip)' },
  internalNodeClick: { level: 'partial', how: 'Internal nodes have no marker: a click on the node\'s branch line selects it (pickingRadius 10 px). Same callbacks as tips; the node name comes back as n<preorder> because the adapter named the internal nodes in the Newick it wrote. The root has no edge and cannot be selected' },
  branchClick: { level: 'partial', how: 'A branch click IS the node selection (the line object is the child node); the library cannot tell the two apart, so it is reported as nodeClick' },
  hover: { level: 'no', how: 'No hover prop or callback in 2.1.24. The library shows its own hover tooltip and ring internally (useHoverDetails), which we cannot subscribe to' },
  descendantTipsInPayload: { level: 'no', how: 'Details carry num_tips, not the tip list (the side panel has a separate "list" request that no callback exposes). Tip sets are computed from the TreeModel (source adapter-derived); num_tips is cross-checked in libraryPayload' },
  cladeColouring: { level: 'partial', how: 'Colours TIP DOTS only (branches use one line colour from settings; internal nodes have no dots unless the internal-markers option is on). Done by giving every tip a unique key (TSV column) and pushing a key-to-RGB map into the library\'s own colour state through setAdditionalColorMapping (React fiber props of the inner Deck). O(tips) per change; the library recolours without a reload' },
  highlightTip: { level: 'partial', how: 'query.srch / query.enabled (controlled prop): a text_per_line search on the tip name draws red rings (fixed colour list, radius 5 px). Debounced 500 ms plus a worker round trip; matching is case-insensitive; at most 10k results' },
  focusTip: { level: 'partial', how: 'No prop. Calls the library\'s own view.setViewState (React fiber props of the inner Deck) with a new zoom and target; instant, no animation. query.zoomToSearch exists but is read only when the component mounts (useState initialiser), so it cannot refocus a loaded tree' },
  tipAsLink: { level: 'partial', how: 'DOM overlay: real a[href][data-tip-id] elements for rows at least 8 px tall (the WebGL labels stay under them); other tips have no anchor' },
  customColumns: { level: 'no', how: 'No aligned per-tip columns. Metadata TSV columns only appear in the hover tooltip, the side panel and as a colour-by field' },
  alignmentColumn: { level: 'no', how: 'No alignment column (the JBrowse panel is for mutation-annotated trees of the Treenome kind, not for sequences from a FASTA)' },
  radialLayout: { level: 'no', how: 'Rectangular only: the layers are horizontal and vertical lines on an orthographic view (useLayers.tsx)' },
  branchLengthToggle: { level: 'partial', how: 'The library always lays out with branch lengths (useDistances is forced true in the worker). A cladogram is obtained by writing the Newick without lengths and remounting the component (full reload of the tree). x_time exists only for jsonl/Nextstrain files, so xType cannot switch a Newick tree' },
  scaleBar: { level: 'no', how: 'No scale bar or time axis in the main view for a Newick tree (no axis layer in useLayers.tsx)' },
  darkTheme: { level: 'partial', how: 'Host background via CSS; line, label and dot colours by the library settings setters (React fiber props). The library\'s own chrome (buttons, tooltips, hover ring, selection ring, minimap) is fixed light/black and does not follow' },
  cssTokens: { level: 'partial', how: 'Background, line colour, tip colour and label colour from the GBIF tokens through settings setters and the colour mapping. Not possible: label font (hard-coded Roboto in the TextLayer), highlight colour, selection ring, tooltip chrome, minimap colours' },
  multipleInstances: { level: 'no', how: 'useLocalBackend.ts creates ONE module-level Worker and global onQueryReceipt/onConfigReceipt callbacks: a second <Taxonium> replaces the first one\'s tree (see S13)' },
  cleanUnmount: { level: 'partial', how: 'React unmount tears down deck.gl, but the module-level worker is never terminated and keeps the last parsed tree in memory (see S13 and the leak probe)' },
  controlledState: { level: 'partial', how: 'query/updateQuery control search, colour field and x axis. Selection, camera and colour mapping are internal state (reached through fiber props)' },
  zoomToFit: { level: 'partial', how: 'The library\'s default view is a fixed zoom/target, not a fit; the adapter fits on mount through view.setViewState. The in-canvas reset button returns to the library default, not to our fit' },
  overviewOrMinimap: { level: 'yes', how: 'Built-in minimap (top right) showing the whole de-overplotted tree and the viewport; click to pan. Toggle in Library options (settings.toggleMinimapEnabled)' },
};

export const adapter: CandidateAdapter = {
  candidate: {
    name: 'taxonium',
    version: VERSION,
    license: 'GPL-3.0',
    notes: 'DEMO ONLY, GPL-3.0, not for shipping. React 19, WebGL (deck.gl 9.1.14 bundled), singleton worker. Camera, colours and settings are reached through React fiber props of the library\'s inner Deck component.',
  },
  capabilities,
  View: TaxView,
  features: [
    { id: 'minimap', label: 'Minimap', kind: 'toggle', default: true, description: 'Taxonium\'s built-in overview (top right).' },
    { id: 'internalMarkers', label: 'Show internal node dots', kind: 'toggle', default: false, description: 'settings.displayPointsForInternalNodes: dots on internal nodes (also clickable).' },
    { id: 'nodeSize', label: 'Tip dot size', kind: 'select', default: '3', options: [{ value: '2', label: '2 px' }, { value: '3', label: '3 px' }, { value: '5', label: '5 px' }, { value: '8', label: '8 px' }] },
  ],
};
