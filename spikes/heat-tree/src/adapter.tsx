// Heat-tree (@grunwaldlab/heat-tree 0.3.1) adapter.
//
// What the library is: `heatTree(container, trees, options)` builds an SVG tree (d3, one <g>/<path> per node and
// branch, d3-zoom for pan and zoom) plus its OWN toolbar (tabs: data, layout, aesthetics, export ...) inside an open
// Shadow DOM attached to `container`. It has no React component, no destroy(), no click/hover/select callbacks and no
// highlight/focus API (verified in the shipped source, see docs/results/heat-tree.md).
//
// How this adapter works (everything marked "workaround" is reaching into the library's DOM or public-but-undocumented
// fields; see the capability `how` strings, none of it is a library event):
//  * mount: `heatTree(div, [{ name, tree: newick }], { layout, transitionDuration })` in an effect; the returned handle
//    gives getCurrentTreeState() (TreeState: setLayout, update, setAesthetics ...) and getCurrentTreeView().
//  * layout: TreeState.setLayout('circular' | 'rectangular') (supported).
//  * branch lengths: there is no cladogram mode. Workaround: rewrite `node.data.length` on the d3 hierarchy (cladogram =
//    tips aligned, length = height(parent) - height(child)) and call TreeState.update(). Original lengths are restored.
//  * clicks and hover: capture listeners on the open shadow root read the d3 datum (`__data__`) of the library's own
//    hit areas (.hit, .tip-hit). The tip set is derived from the shared TreeModel => source 'adapter-derived'.
//  * clade colour and highlight: inline styles / a class on the library's branch paths and tip-label <text> elements,
//    re-applied after the library's own redraws (TreeState 'coordinateChange').
//  * custom columns: no aligned columns exist. Text columns drive tipLabelColor and bar columns drive tipLabelSize through
//    the library's own metadata mapping (TreeData.addTable + TreeState.setAesthetics).
//  * focus: d3-zoom transform through TreeView.treeZoom (public field, undocumented).
//  * tip links: HTML <a> overlay over the visible tip labels (the library only draws SVG text).
//  * theme: the library's own CSS custom properties (--color-background ...) overridden by a <style> appended to the
//    shadow root, values from gbifTheme().

import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { heatTree } from '@grunwaldlab/heat-tree';
import type { AdapterFeature, CandidateAdapter, CapabilityReport, ColumnSpec, Point, Rect, ThemeSpec, ViewHandle, ViewProps } from '../../shared/types.ts';
import { gbifTheme, gbifDarkTheme } from '../../shared/gbif-theme.ts';

const VERSION = '0.3.1';

// ---------------------------------------------------------------- loosely typed view of the library internals
/* eslint-disable @typescript-eslint/no-explicit-any */
type D3Node = any; // d3.hierarchy node with library fields (xPx, yPx, tipLabelSizePx, bounds, id, data.name ...)

function allNodes(root: D3Node): D3Node[] {
  return root.descendants(); // d3-hierarchy: iterative
}

/** Style sheet appended to the shadow root. The library's own sheet (prepended) sets light colours and a black label fill. */
const SHADOW_CSS = `
:host{display:block;width:100%;height:100%}
.ht-widget{--color-background:var(--g-bg);--color-text:var(--g-fg);--color-border:var(--g-border);--color-muted:var(--g-muted);--color-accent:var(--g-accent);color-scheme:var(--g-scheme) !important;outline:none !important;border-radius:0 !important;font-family:var(--g-font)}
.ht-tree svg{background:var(--g-bg)}
.branch-group path{stroke:var(--g-branch)}
.tip-label{font-family:var(--g-font) !important;font-style:italic !important}
.ht-plain .tip-label{fill:var(--g-fg) !important}
.node-label,.legend-layer text{fill:var(--g-fg) !important}
.legend-layer line,.legend-layer path:not([fill]){stroke:var(--g-fg)}
.tip-label.ad-hl{fill:var(--g-hl) !important;font-weight:700 !important;paint-order:stroke;stroke:var(--g-hl-soft);stroke-width:5px;stroke-linejoin:round}
/* the toolbar's colours are hard-coded hex values in the library's CSS (not variables): override the main ones, accent = primary */
.ht-widget .ht-tabs{background-color:var(--g-bar);border-bottom-color:var(--g-border)}
.ht-widget .ht-tab,.ht-widget .ht-control-label,.ht-button{font-family:var(--g-font);color:var(--g-fg)}
.ht-widget .ht-tab.active{color:var(--g-fg);border-bottom-color:var(--g-accent)}
.ht-widget .ht-controls,.ht-widget .ht-aesthetic-settings-content{background-color:var(--g-bar);border-bottom-color:var(--g-border)}
.ht-button{background-color:var(--g-panel);border-color:var(--g-border)}
.ht-button.primary,.ht-toggle.active{background-color:var(--g-accent);color:#fff}
.ht-control-panel-toggle .ht-hamburger-icon{color:var(--g-fg)}
.hit,.tip-hit{outline:none}
.ht-tree .selection-rect{stroke:var(--g-hl) !important}
`;

function themeVars(t: ThemeSpec): Record<string, string> {
  const g = t.dark ? gbifDarkTheme() : gbifTheme();
  const k = t.tokens ?? {};
  const bg = k.background ?? g.bg1;
  return {
    '--g-bg': bg,
    '--g-fg': k.foreground ?? g.fg1,
    '--g-branch': k.branch ?? (t.dark ? g.fg3 : g.fg2),
    '--g-hl': k.highlight ?? g.primary,
    '--g-hl-soft': t.dark ? g.dark : g.primaryLight,
    '--g-border': g.border,
    '--g-bar': g.bg2,
    '--g-panel': t.dark ? g.surface : g.bg1,
    '--g-muted': t.dark ? g.slate400 : g.fg3,
    '--g-accent': g.primary,
    '--g-scheme': t.dark ? 'dark' : 'light',
    '--g-font': k.fontFamily ?? g.fontBody,
  };
}

interface Inst {
  host: HTMLDivElement;
  lib: any; // return value of heatTree()
  shadow: ShadowRoot;
  bodyExtras: Node[];
  libNodeToShared: Map<number, number>;
  origLength: Map<D3Node, number | undefined>;
  lengthsMode: 'original' | 'cladogram';
  unsub: (() => void)[];
}

function HeatTreeView(props: ViewProps) {
  const { tree, size, theme, emit } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const linksRef = useRef<HTMLDivElement>(null);
  const inst = useRef<Inst | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const hitCache = useRef<{ ver: number; tipHit: Map<number, Element>; hit: Map<number, Element>; label: Map<number, Element> } | null>(null);
  const ver = useRef(0);
  const colourTableId = useRef<string | null>(null);

  // ---- shared <-> library mapping -------------------------------------------------------------------------------
  /** key (first tip rank, last tip rank) -> topmost shared node with exactly that leaf range */
  const rangeToShared = useMemo(() => {
    const m = new Map<number, number>();
    for (let i = 0; i < tree.nodeCount; i++) {
      const key = tree.leafStart[i] * (tree.tipCount + 1) + (tree.leafEnd[i] - 1);
      if (!m.has(key)) m.set(key, i);
    }
    return m;
  }, [tree]);

  const buildMapping = (lib: any): Map<number, number> => {
    const root: D3Node = lib.getCurrentTreeState().displayedRoot;
    const out = new Map<number, number>();
    const lo = new Map<D3Node, number>();
    const hi = new Map<D3Node, number>();
    root.eachAfter((d: D3Node) => {
      if (!d.children) {
        const ti = tree.tipIndex(d.data.name);
        const r = ti >= 0 ? tree.tipRank[ti] : -1;
        lo.set(d, r);
        hi.set(d, r);
      } else {
        let a = Infinity;
        let b = -Infinity;
        for (const c of d.children) {
          const ca = lo.get(c)!;
          const cb = hi.get(c)!;
          if (ca >= 0 && ca < a) a = ca;
          if (cb > b) b = cb;
        }
        lo.set(d, a === Infinity ? -1 : a);
        hi.set(d, b);
      }
      const a = lo.get(d)!;
      if (a >= 0) {
        const s = rangeToShared.get(a * (tree.tipCount + 1) + hi.get(d)!);
        if (s !== undefined) out.set(d.id, s);
      }
    });
    return out;
  };

  // ---- DOM lookups into the shadow root ----------------------------------------------------------------------------
  const svgEl = (): SVGSVGElement | null => (inst.current?.shadow.querySelector('.ht-tree svg') as SVGSVGElement | null) ?? null;
  const caches = () => {
    const i = inst.current;
    if (!i) return null;
    const c = hitCache.current;
    if (c && c.ver === ver.current) return c;
    const next = { ver: ver.current, tipHit: new Map<number, Element>(), hit: new Map<number, Element>(), label: new Map<number, Element>() };
    i.shadow.querySelectorAll('.tip-hit').forEach((el) => next.tipHit.set((el as any).__data__.id, el));
    i.shadow.querySelectorAll('.hit').forEach((el) => next.hit.set((el as any).__data__.id, el));
    i.shadow.querySelectorAll('.tip-label').forEach((el) => {
      const d = (el as any).__data__;
      if (d) next.label.set(d.id, el);
    });
    hitCache.current = next;
    return next;
  };
  const libTip = (name: string): D3Node | null => {
    const i = inst.current;
    if (!i) return null;
    const root: D3Node = i.lib.getCurrentTreeState().displayedRoot;
    // tip lookups are rare (locate/focus); a scan over leaves is fine and robust to the library's re-sorting
    for (const d of root.leaves()) if (d.data.name === name) return d;
    return null;
  };
  const libNodeOf = (sharedIdx: number): D3Node | null => {
    const i = inst.current;
    if (!i) return null;
    const root: D3Node = i.lib.getCurrentTreeState().displayedRoot;
    for (const d of allNodes(root)) if (i.libNodeToShared.get(d.id) === sharedIdx) return d;
    return null;
  };

  const svgArea = (): DOMRect | null => svgEl()?.getBoundingClientRect() ?? null;
  const inArea = (x: number, y: number, m = 2): boolean => {
    const r = svgArea();
    return !!r && x >= r.left + m && x <= r.right - m && y >= r.top + m && y <= r.bottom - m;
  };
  const groupToClient = (x: number, y: number): Point | null => {
    const g = inst.current?.shadow.querySelector('.tree-elements') as SVGGElement | null;
    const m = g?.getScreenCTM();
    if (!g || !m) return null;
    return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
  };

  // ---- introspection handle ------------------------------------------------------------------------------------------
  /** Candidate click points inside a node's own hit area: the strip between the node and its nearest child, sampled
   *  along the clade's extent (the clade is usually much taller than the viewport, so the middle is often off screen). */
  const nodePoints = (d: D3Node): Point[] => {
    const circular = inst.current!.lib.getCurrentTreeState().state.layout === 'circular';
    const kids: D3Node[] = d.children ?? [];
    const out: Point[] = [];
    if (!kids.length || !d.bounds) return out;
    const add = (x: number, y: number) => {
      const p = groupToClient(x, y);
      if (p) out.push(p);
    };
    const area = svgArea();
    const m = (inst.current!.shadow.querySelector('.tree-elements') as SVGGElement | null)?.getScreenCTM();
    if (circular) {
      const gap = Math.min(...kids.map((k) => k.radiusPx - d.radiusPx));
      const a0 = d.bounds.minAngle;
      const a1 = d.bounds.maxAngle;
      const N = 90;
      for (const f of [0.5, 0.25, 0.75]) {
        const r = d.radiusPx + Math.max(1, gap) * f;
        for (let k = 0; k < N; k++) {
          const ang = a0 + ((a1 - a0) * (k + 0.5)) / N;
          add(r * Math.cos(ang), r * Math.sin(ang));
        }
      }
    } else {
      const gap = Math.min(...kids.map((k) => k.xPx - d.xPx));
      const x = d.xPx + Math.max(1, gap) * 0.5;
      let y0 = d.bounds.minY;
      let y1 = d.bounds.maxY;
      if (area && m && m.d > 0) {
        y0 = Math.max(y0, (area.top - m.f) / m.d);
        y1 = Math.min(y1, (area.bottom - m.f) / m.d);
      }
      const N = 24;
      for (let k = 0; k < N; k++) add(x, y0 + ((y1 - y0) * (k + 0.5)) / N);
    }
    const cx = area ? (area.left + area.right) / 2 : 0;
    const cy = area ? (area.top + area.bottom) / 2 : 0;
    return out.sort((p, q) => Math.hypot(p.x - cx, p.y - cy) - Math.hypot(q.x - cx, q.y - cy));
  };
  const confirm = (p: Point | null, el: Element | undefined): Point | null => {
    if (!p || !el || !inArea(p.x, p.y)) return null;
    const top = inst.current!.shadow.elementFromPoint(p.x, p.y);
    return top === el ? p : null;
  };
  const clip = (r: DOMRect): Rect | null => {
    const a = svgArea();
    if (!a) return null;
    const x0 = Math.max(a.left, r.left);
    const y0 = Math.max(a.top, r.top);
    const x1 = Math.min(a.right, r.right);
    const y1 = Math.min(a.bottom, r.bottom);
    return x1 - x0 < 1 || y1 - y0 < 1 ? null : { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  };

  const handle: ViewHandle = {
    locate(t) {
      const i = inst.current;
      const c = caches();
      if (!i || !c) return null;
      if (t.kind === 'tip') {
        const d = libTip(t.id);
        const el = d && c.tipHit.get(d.id);
        if (!d || !el) return null;
        const r = (el as SVGGraphicsElement).getBoundingClientRect();
        // try the label start, then the centre
        for (const f of [0.15, 0.5, 0.3, 0.7]) {
          const p = confirm({ x: r.left + r.width * f, y: r.top + r.height / 2 }, el);
          if (p) return p;
        }
        return null;
      }
      if (!tree.isNodeId(t.id)) return null;
      const d = libNodeOf(tree.nodeIndex(t.id));
      const el = d && c.hit.get(d.id);
      if (!d || !el) return null;
      for (const p of nodePoints(d)) {
        const ok = confirm(p, el);
        if (ok) return ok;
      }
      return null;
    },
    bounds(t) {
      const c = caches();
      if (!c) return null;
      if (t.kind === 'tip') {
        const d = libTip(t.id);
        const el = d && c.tipHit.get(d.id);
        return el ? clip((el as SVGGraphicsElement).getBoundingClientRect()) : null;
      }
      if (!tree.isNodeId(t.id)) return null;
      const d = libNodeOf(tree.nodeIndex(t.id));
      const el = d && c.hit.get(d.id);
      return el ? clip((el as SVGGraphicsElement).getBoundingClientRect()) : null;
    },
    locateCell(colId, tipId) {
      // No aligned columns exist. The "cell" is the tip label itself, which carries the encoding (colour or size).
      const col = latest.current.columns.find((c) => c.id === colId);
      if (!col || col.values[tipId] === undefined) return null;
      if (!mappedCols.current.has(colId)) return null;
      const d = libTip(tipId);
      const c = caches();
      const el = d && c?.label.get(d.id);
      if (!el) return null;
      const r = (el as SVGGraphicsElement).getBoundingClientRect();
      const cr = clip(r);
      if (!cr || cr.height < r.height * 0.5) return null;
      return cr;
    },
    custom() {
      const i = inst.current;
      const st = i?.lib.getCurrentTreeState();
      return { tips: tree.tipCount, shadowElements: i ? i.shadow.querySelectorAll('*').length : 0, shadowSvgElements: i ? i.shadow.querySelectorAll('svg, svg *').length : 0, hitAreas: i ? i.shadow.querySelectorAll('.hit,.tip-hit').length : 0, branchLenToPx: st?.branchLenToPxFactor ?? 0, labelPx: st?.labelSizeToPxFactor ?? 0 };
    },
  };
  useLayoutEffect(() => {
    props.handleRef.current = handle;
    return () => {
      props.handleRef.current = null;
    };
  });

  // ---- mount / unmount ------------------------------------------------------------------------------------------------
  useEffect(() => {
    const root = rootRef.current!;
    const host = document.createElement('div'); // fresh element per mount: a shadow root can be attached only once
    host.style.cssText = 'position:absolute;inset:0';
    root.appendChild(host);
    const beforeBody = new Set(Array.from(document.body.children));
    const p = latest.current;
    const t0 = performance.now();
    let lib: any;
    try {
      lib = heatTree(host, [{ name: 'tree', tree: p.newick }], {
        layout: p.layout === 'radial' ? 'circular' : 'rectangular',
        transitionDuration: p.features.animate ? 500 : 0,
        autoZoom: p.features.fit === 'Default' || !p.features.fit ? 'Default' : p.features.fit,
        isolation: 'shadow',
      });
    } catch (e) {
      host.remove();
      throw e;
    }
    const parseMs = performance.now() - t0;
    const shadow = lib.shadowRoot as ShadowRoot;
    const style = document.createElement('style');
    style.textContent = SHADOW_CSS;
    shadow.appendChild(style);
    const extras = Array.from(document.body.children).filter((n) => !beforeBody.has(n)); // TextSizeEstimator's hidden 5000x5000 container
    const i: Inst = { host, lib, shadow, bodyExtras: extras, libNodeToShared: new Map(), origLength: new Map(), lengthsMode: 'original', unsub: [] };
    inst.current = i;
    i.libNodeToShared = buildMapping(lib);
    const st = lib.getCurrentTreeState();
    const view = lib.getCurrentTreeView();
    i.origLength = new Map(allNodes(st.displayedRoot).map((d: D3Node) => [d, d.data.length]));
    applyThemeVars(p.theme);

    // library redraws -> refresh caches and re-apply the adapter's own styling
    const bump = () => {
      ver.current++;
      requestAnimationFrame(() => {
        if (inst.current === i) {
          paintClades();
          paintHighlights();
          layoutLinks();
        }
      });
    };
    i.unsub.push(st.subscribe('coordinateChange', bump), st.subscribe('layoutChange', bump), st.subscribe('tipLabelColorChange', bump), st.subscribe('tipLabelSizeChange', bump));
    view.treeZoom.on('zoom.adapter', () => layoutLinks());
    i.unsub.push(() => view.treeZoom.on('zoom.adapter', null));

    // clicks and hover: read the d3 datum of the library's own hit areas (capture phase on the open shadow root)
    const datumOf = (e: Event): { d: D3Node; cls: string } | null => {
      const el = e.composedPath()[0] as Element | undefined;
      if (!el || !(el as any).classList) return null;
      const cls = el.classList.contains('tip-hit') ? 'tip' : el.classList.contains('hit') ? 'node' : el.classList.contains('collapsed-hit') ? 'collapsed' : '';
      const d = (el as any).__data__;
      return cls && d ? { d, cls } : null;
    };
    const fire = (how: 'click' | 'hover', x: { d: D3Node; cls: string }) => {
      const sIdx = x.cls === 'tip' ? tree.tipIndex(x.d.data.name) : i.libNodeToShared.get(x.d.id) ?? -1;
      if (sIdx < 0) return;
      const isTip = x.cls === 'tip';
      emit({
        type: how === 'click' ? (isTip ? 'tipClick' : 'nodeClick') : isTip ? 'tipHover' : 'nodeHover',
        nodeId: tree.nodeId(sIdx),
        isTip,
        tipIds: tree.descendantTips(sIdx),
        source: 'adapter-derived',
        libraryPayload: { libNodeId: x.d.id, name: x.d.data.name ?? null, leafCount: x.d.leafCount, hit: x.cls },
      });
    };
    const onClick = (e: Event) => {
      const x = datumOf(e);
      if (x && x.cls !== 'collapsed') fire('click', x);
    };
    let lastHover = -1;
    const onOver = (e: Event) => {
      const x = datumOf(e);
      const id = x ? x.d.id : -1;
      if (id === lastHover) return;
      lastHover = id;
      if (x && x.cls !== 'collapsed') fire('hover', x);
    };
    shadow.addEventListener('click', onClick, true);
    shadow.addEventListener('mouseover', onOver);
    i.unsub.push(
      () => shadow.removeEventListener('click', onClick, true),
      () => shadow.removeEventListener('mouseover', onOver),
    );

    // lengths
    if (!p.branchLengths || !tree.hasLengths) setLengths(false);

    const nTips = st.displayedRoot.leaves().length;
    p.onReady({
      parseMs,
      tips: nTips,
      notes: `parseMs = whole heatTree() call (library parse + layout + first SVG render, not separable); transitionDuration ${p.features.animate ? 500 : 0}; shared parse ${p.sharedParseMs.toFixed(1)} ms is separate; ${!tree.hasLengths ? 'tree has no lengths: cladogram lengths synthesised by the adapter' : ''}`,
    });

    return () => {
      for (const u of i.unsub) {
        try {
          u();
        } catch {
          /* ignore */
        }
      }
      try {
        // no destroy() on the widget: stop what the library would still do on the detached SVG (a pending d3 'zoom'
        // transition or the debounced ResizeObserver fitToView throws 'Could not resolve relative length' otherwise)
        const v = lib.getCurrentTreeView();
        if (v) {
          v.options.autoZoom = 'None';
          v.options.autoPan = 'None';
          v.svg.interrupt();
          v.svg.selectAll('*').interrupt();
          v.destroy();
        }
      } catch {
        /* ignore */
      }
      host.remove();
      for (const n of i.bodyExtras) n.parentNode?.removeChild(n);
      inst.current = null;
      hitCache.current = null;
    };
  }, []);

  // ---- theme ------------------------------------------------------------------------------------------------------------
  const applyThemeVars = (t: ThemeSpec) => {
    const i = inst.current;
    if (!i) return;
    const v = themeVars(t);
    for (const k of Object.keys(v)) i.host.style.setProperty(k, v[k]);
  };
  useEffect(() => {
    applyThemeVars(theme);
  }, [theme]);

  // ---- layout / lengths ------------------------------------------------------------------------------------------------
  useEffect(() => {
    const i = inst.current;
    if (!i) return;
    const want = props.layout === 'radial' ? 'circular' : 'rectangular';
    const st = i.lib.getCurrentTreeState();
    if (st.state.layout !== want) st.setLayout(want);
  }, [props.layout]);

  const setLengths = (original: boolean) => {
    const i = inst.current;
    if (!i) return;
    const st = i.lib.getCurrentTreeState();
    const root: D3Node = st.displayedRoot.collapsedParent ? st.displayedRoot : st.displayedRoot;
    const full: D3Node = st.state.treeData.tree; // the whole hierarchy (displayedRoot may be a sub-root after "collapse root")
    if (original && i.lengthsMode === 'original') return;
    if (!original && i.lengthsMode === 'cladogram') return;
    if (original) {
      for (const d of allNodes(full)) d.data.length = i.origLength.get(d);
      i.lengthsMode = 'original';
    } else {
      const h = new Map<D3Node, number>();
      full.eachAfter((d: D3Node) => {
        let m = 0;
        if (d.children) for (const c of d.children) m = Math.max(m, (h.get(c) as number) + 1);
        h.set(d, m);
      });
      full.each((d: D3Node) => {
        if (d.parent) d.data.length = (h.get(d.parent) as number) - (h.get(d) as number);
      });
      i.lengthsMode = 'cladogram';
    }
    void root;
    st.update();
  };
  useEffect(() => {
    if (!inst.current) return;
    setLengths(props.branchLengths && tree.hasLengths);
  }, [props.branchLengths]);

  // ---- coloured clades, highlight (styles on the library's own elements) -------------------------------------------------
  const paintClades = () => {
    const i = inst.current;
    if (!i) return;
    const clades = latest.current.colouredClades.map((c) => {
      const a = tree.nodeIndex(c.nodeId);
      return { a, b: tree.subtreeEnd[a], colour: c.colour };
    });
    const colourOfLib = (d: D3Node): string | null => {
      const s = i.libNodeToShared.get(d.id);
      if (s === undefined) return null;
      let col: string | null = null;
      for (const c of clades) if (s >= c.a && s < c.b) col = c.colour; // later (nested) entries win
      return col;
    };
    i.shadow.querySelectorAll('.branch-group').forEach((g) => {
      const link = (g as any).__data__;
      const col = link ? colourOfLib(link.target) : null;
      g.querySelectorAll('path').forEach((p) => {
        if (col) (p as SVGPathElement).style.stroke = col;
        else (p as SVGPathElement).style.removeProperty('stroke');
      });
    });
    i.shadow.querySelectorAll('.tip-label').forEach((el) => {
      const d = (el as any).__data__;
      const col = d ? colourOfLib(d) : null;
      const s = (el as SVGTextElement).style;
      if (col) s.setProperty('fill', col, 'important');
      else if (s.getPropertyPriority('fill') === 'important') s.removeProperty('fill');
    });
  };
  useEffect(() => {
    paintClades();
  }, [props.colouredClades]);

  const paintHighlights = () => {
    const i = inst.current;
    if (!i) return;
    const set = new Set(latest.current.highlightedTips);
    i.shadow.querySelectorAll('.tip-label').forEach((el) => {
      const d = (el as any).__data__;
      el.classList.toggle('ad-hl', !!d && set.has(d.data.name));
    });
  };
  useEffect(() => {
    paintHighlights();
  }, [props.highlightedTips]);

  // ---- focus ---------------------------------------------------------------------------------------------------------------
  useEffect(() => {
    const fr = props.focusRequest;
    const i = inst.current;
    if (!fr || !i) return;
    const d = libTip(fr.tipId);
    if (!d) return;
    const view = i.lib.getCurrentTreeView();
    const a = svgArea();
    if (!a) return;
    const st = i.lib.getCurrentTreeState();
    const circular = st.state.layout === 'circular';
    const k0 = view.currentTransform.k;
    const labelPx = Math.max(1, d.tipLabelSizePx || 12);
    const rb = st.displayedRoot.bounds;
    let k: number;
    let tx: number;
    if (circular) {
      k = Math.max(k0, 18 / labelPx);
      tx = a.width / 2 - d.xPx * k;
    } else {
      // keep the whole tree width on screen (so the clade's ancestors stay clickable), only centre the row vertically
      const bw = Math.max(1, rb.maxX - rb.minX);
      const fitK = (a.width - 10) / bw;
      k = Math.max(Math.min(k0, 1e9), Math.min(18 / labelPx, fitK));
      tx = bw * k <= a.width ? (a.width - bw * k) / 2 - rb.minX * k : 5 - rb.minX * k;
    }
    const ty = a.height / 2 - d.yPx * k;
    // d3-zoom transform object: identity.translate().scale(), built without importing d3
    const T = view.currentTransform.constructor;
    const tr = new T(k, tx, ty);
    view.svg.call(view.treeZoom.transform, tr);
  }, [props.focusRequest]);

  // ---- custom columns -> library metadata mapping --------------------------------------------------------------------------
  const mappedCols = useRef<Set<string>>(new Set());
  useEffect(() => {
    const i = inst.current;
    if (!i) return;
    const st = i.lib.getCurrentTreeState();
    const td = st.state.treeData;
    const root = i.shadow.querySelector('.ht-widget');
    if (colourTableId.current) {
      td.deleteTable(colourTableId.current);
      colourTableId.current = null;
    }
    mappedCols.current = new Set();
    const cols: ColumnSpec[] = props.columns;
    const txt = cols.find((c) => c.kind === 'text');
    const bar = cols.find((c) => c.kind === 'bar');
    if (!txt && !bar) {
      st.setAesthetics({ tipLabelColor: undefined, tipLabelSize: undefined });
      root?.classList.add('ht-plain');
      bump2();
      return;
    }
    const names = tree.tipLabels;
    const header = ['tip_id', txt ? 'text_col' : null, bar ? 'bar_col' : null].filter(Boolean).join('\t');
    const lines = [header];
    for (const n of names) {
      const row = [n];
      if (txt) row.push(txt.values[n] === undefined ? '' : String(txt.values[n]));
      if (bar) row.push(bar.values[n] === undefined ? '' : String(bar.values[n]));
      lines.push(row.join('\t'));
    }
    const tid = td.addTable(lines.join('\n'), 'Adapter columns');
    colourTableId.current = tid;
    const aes: Record<string, string | undefined> = {};
    if (txt) {
      aes.tipLabelColor = `${tid}_text_col`;
      mappedCols.current.add(txt.id);
    } else aes.tipLabelColor = undefined;
    if (bar) {
      aes.tipLabelSize = `${tid}_bar_col`;
      mappedCols.current.add(bar.id);
    } else aes.tipLabelSize = undefined;
    st.setAesthetics(aes, true);
    if (txt) {
      const g = gbifTheme();
      const sc = st.aestheticsScales.tipLabelColor;
      if (sc?.updateState) {
        try {
          sc.updateState({ colorPalette: g.categorical.slice(0, 5), colorPositions: g.categorical.slice(0, 5).map((_: string, k: number) => k / 4), maxCategories: 8 });
        } catch {
          /* leave the library's palette */
        }
      }
      root?.classList.remove('ht-plain');
    } else root?.classList.add('ht-plain');
    bump2();
  }, [props.columns]);
  const bump2 = () => {
    ver.current++;
    requestAnimationFrame(() => {
      paintClades();
      paintHighlights();
    });
  };
  // plain label fill unless a text column is mapped
  useEffect(() => {
    inst.current?.shadow.querySelector('.ht-widget')?.classList.add('ht-plain');
  }, []);

  // ---- features ---------------------------------------------------------------------------------------------------------------
  useEffect(() => {
    const v = inst.current?.lib.getCurrentTreeView();
    if (v) v.options.transitionDuration = props.features.animate ? 500 : 0;
  }, [props.features.animate]);
  useEffect(() => {
    const v = inst.current?.lib.getCurrentTreeView();
    if (!v) return;
    const f = String(props.features.fit ?? 'Default');
    v.options.autoZoom = f;
    v.fitToView({ transition: false });
  }, [props.features.fit]);
  useEffect(() => {
    const v = inst.current?.lib.getCurrentTreeView();
    if (v) v.options.manualZoomAndPanEnabled = props.features.manualZoom !== false;
  }, [props.features.manualZoom]);

  // ---- tip links overlay -----------------------------------------------------------------------------------------------------
  const layoutLinks = () => {
    const box = linksRef.current;
    const i = inst.current;
    const href = latest.current.tipLinks;
    if (!box) return;
    if (!href || !i) {
      if (box.childElementCount) box.replaceChildren();
      return;
    }
    const rootRect = rootRef.current!.getBoundingClientRect();
    const area = svgArea();
    if (!area) return;
    const items: { name: string; r: DOMRect }[] = [];
    i.shadow.querySelectorAll('.tip-label').forEach((el) => {
      if (items.length >= 400) return;
      const d = (el as any).__data__;
      if (!d || !d.data.name) return;
      const r = (el as SVGGraphicsElement).getBoundingClientRect();
      if (r.bottom < area.top || r.top > area.bottom || r.right < area.left || r.left > area.right) return;
      if (r.height < 4) return;
      items.push({ name: d.data.name, r });
    });
    const existing = new Map<string, HTMLAnchorElement>();
    box.querySelectorAll('a').forEach((a) => existing.set(a.dataset.tipId!, a as HTMLAnchorElement));
    const keep = new Set<string>();
    for (const it of items) {
      keep.add(it.name);
      let a = existing.get(it.name);
      if (!a) {
        a = document.createElement('a');
        a.dataset.tipId = it.name;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.tabIndex = 0;
        a.setAttribute('aria-label', it.name);
        a.className = 'ht-link';
        box.appendChild(a);
      }
      const h = href(it.name);
      if (a.getAttribute('href') !== h) a.setAttribute('href', h);
      a.style.left = it.r.left - rootRect.left + 'px';
      a.style.top = it.r.top - rootRect.top + 'px';
      a.style.width = it.r.width + 'px';
      a.style.height = it.r.height + 'px';
    }
    existing.forEach((a, k) => {
      if (!keep.has(k)) a.remove();
    });
  };
  useEffect(() => {
    layoutLinks();
    const id = window.setTimeout(layoutLinks, 80);
    return () => clearTimeout(id);
  }, [props.tipLinks, size.width, size.height]);

  return (
    <div ref={rootRef} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }} role="group" aria-label={`Phylogenetic tree, ${tree.tipCount} tips (Heat-tree)`}>
      <style>{`.ht-link{position:absolute;display:block;background:transparent;opacity:1;outline-offset:1px;z-index:5}.ht-link:focus-visible{outline:2px solid var(--color-primary,#4c9b45)}`}</style>
      <div ref={linksRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }} className="ht-links" />
      <LinksPointer />
    </div>
  );
}

/** anchors inside the overlay must receive pointer events although the overlay itself does not */
function LinksPointer() {
  return <style>{`.ht-links a{pointer-events:auto}`}</style>;
}

const capabilities: CapabilityReport = {
  tipClick: { level: 'partial', how: 'No callback. A capture listener on the open shadow root reads the d3 datum (__data__) of the library\'s own .tip-hit path; emitted tip set is adapter-derived from the shared TreeModel. The library also shows its selection box and action buttons (collapse, hide, rotate).' },
  internalNodeClick: { level: 'partial', how: 'No callback and no node markers. Clicking inside a clade selects the deepest .hit region (a clade-sized rectangle or wedge); read from the d3 datum via the shadow root. The click point for a node is the strip between the node and its first child.' },
  branchClick: { level: 'no', how: 'Branches are not clickable; only the clade-sized hit areas are. A branch click selects the clade region, which is reported as nodeClick.' },
  hover: { level: 'partial', how: 'mouseover on .hit / .tip-hit read from the shadow root; tip sets adapter-derived. Hover over a clade region reports the deepest enclosing clade (no per-branch hover).' },
  descendantTipsInPayload: { level: 'no', how: 'The library emits nothing. Tip sets are computed by the adapter from the shared TreeModel (source adapter-derived).' },
  cladeColouring: { level: 'partial', how: 'No API. Adapter sets inline stroke on the library\'s branch paths and fill (important) on tip-label text, derived from d3 datums, and re-applies after TreeState coordinateChange. Elements created later by expanding a collapsed clade are styled after the next redraw.' },
  highlightTip: { level: 'partial', how: 'No API. A class on the library\'s tip-label <text> (bold, primary colour, soft halo via paint-order stroke); no marker or row band. Applies to rendered labels only.' },
  focusTip: { level: 'partial', how: 'No API. Applies a d3-zoom transform through TreeView.treeZoom (public but undocumented field) centred on the tip with label size at least 18 px; instant.' },
  tipAsLink: { level: 'partial', how: 'The library draws SVG text only. HTML <a href data-tip-id tabindex=0> overlay positioned over up to 400 visible tip labels, repositioned on every zoom event (d3-zoom namespaced listener).' },
  customColumns: { level: 'partial', how: 'No aligned columns. The first text column drives tipLabelColor (categorical, GBIF palette) and the first bar column drives tipLabelSize (continuous), through TreeData.addTable + TreeState.setAesthetics (the library\'s own per-field mapping). The "cell" is the tip label.' },
  alignmentColumn: { level: 'no', how: 'No sequence or alignment rendering; only label colour, size, font, style and text can be mapped to metadata.' },
  radialLayout: { level: 'yes', how: 'TreeState.setLayout(\'circular\'); real polar layout with rotated labels.' },
  branchLengthToggle: { level: 'partial', how: 'No cladogram mode. Adapter rewrites node.data.length on the d3 hierarchy (height difference, tips aligned) and calls TreeState.update(); original lengths are restored for the phylogram. Trees without lengths get synthetic lengths.' },
  scaleBar: { level: 'yes', how: 'A branch-length scale legend is always drawn under the tree.' },
  darkTheme: { level: 'partial', how: 'Library CSS custom properties (--color-background, --color-text ...) and branch/label/legend rules overridden by a <style> appended to the open shadow root. The built-in toolbar follows the variables and color-scheme; colours set by metadata mappings stay as mapped.' },
  cssTokens: { level: 'partial', how: 'Page CSS cannot reach into the shadow root (default isolation). Values from gbifTheme() are passed as custom properties on the host and consumed by an adapter-supplied <style> in the shadow root. isolation:\'none\' exists but injects the library\'s global stylesheet into the page.' },
  multipleInstances: { level: 'yes', how: 'Each heatTree() call attaches its own shadow root; no module singletons found. Each call also appends a hidden 5000x5000 measurement container to document.body (removed by the adapter on unmount).' },
  cleanUnmount: { level: 'partial', how: 'No destroy(). Adapter removes the host, calls TreeView.destroy(), detaches its listeners and removes the library\'s hidden <div> from document.body. The library\'s ResizeObserver is not exposed and is left to garbage collection with the detached element.' },
  controlledState: { level: 'partial', how: 'Layout is a TreeState method; everything else (colour, highlight, lengths, columns) goes through adapter workarounds. No props, no update(options): options are read once at heatTree().' },
  zoomToFit: { level: 'yes', how: 'Fits on mount, on layout change and on container resize (ResizeObserver, 100 ms debounce); TreeView.fitToView() and the autoZoom/autoPan options (Default, Both, X, Y, None).' },
  overviewOrMinimap: { level: 'no', how: 'None. Collapse (triangle) of clades is manual through the selection buttons; no level of detail by zoom.' },
};

const features: AdapterFeature[] = [
  { id: 'animate', label: 'Animated transitions (library default 500 ms)', kind: 'toggle', default: false, description: 'transitionDuration option. Off here (0 ms) so the runner can read stable positions; the library default is 500 ms.' },
  { id: 'fit', label: 'Auto zoom', kind: 'select', default: 'Default', options: [{ value: 'Default', label: 'Default' }, { value: 'Both', label: 'Fit both' }, { value: 'X', label: 'Fit width' }, { value: 'Y', label: 'Fit height' }, { value: 'None', label: 'None' }], description: 'autoZoom option (supported).' },
  { id: 'manualZoom', label: 'Manual zoom and pan', kind: 'toggle', default: true, description: 'manualZoomAndPanEnabled option (supported).' },
  { id: 'toolbar', label: 'Show Heat-tree control panel', kind: 'toggle', default: true, level: 'no', how: 'There is no option in 0.3.1 to hide or omit the built-in toolbar (src/index.js always creates .ht-toolbar). Hiding it would need CSS into the shadow root, which the contract does not allow as a pass.' },
];

export const adapter: CandidateAdapter = {
  candidate: {
    name: 'heat-tree',
    version: VERSION,
    license: 'MIT (declared; no LICENSE file in tarball)',
    notes: 'd3 SVG widget with its own toolbar inside a shadow root; no callbacks, so click/hover/colour/highlight/focus are adapter workarounds on its DOM.',
    columnKinds: ['text'],
  },
  capabilities,
  View: HeatTreeView,
  features,
};
