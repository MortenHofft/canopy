// <TreeView>: the React layer over @gbif-phylo/viewer. Props are the whole state (clades, highlighted tips,
// columns, layout, lengths, theme, optional controlled viewport); callbacks report interaction. No globals:
// every instance owns its viewer, which is created in a layout effect and destroyed on unmount (rAF
// cancelled, observers and listeners removed, canvases released).

import React, { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { changedKeys, stripUndefined, useShallowStable, useStable } from './props.ts';
import {
  TreeViewer,
  InMemorySource,
  Zoom,
  Fit,
  NodeMenu,
  Tooltip,
  defaultTooltip as defaultTooltipFor,
  type Control,
  type NodeMenuItem as ViewerMenuItem,
  type TreeSource,
  DEFAULT_OPTIONS,
  themeEquals,
  FALLBACK_THEME,
  type CladeColour,
  type Column,
  type FrameStats,
  type LayoutKind,
  type TreeEvent,
  type ViewerOptions,
  type TreeData,
  type TreeTheme,
  type Viewport,
} from '@gbif-phylo/viewer';

/** The viewer's event (`TreeEvent` of @gbif-phylo/viewer): node id as 'n<preorder index>' and number, tip or not, what was hit, the
 *  descendant tips as the rank range [tipStart, tipEnd) with `tipIds()` / `tipLabels()`, pointer position, and `preventDefault()`. */
export type TreeNodeEvent = TreeEvent;

export interface TreeViewHandle {
  fit(): void;
  focusTip(tipId: string): void;
  zoomToNode(nodeId: string): void;
  getViewport(): Viewport;
  setViewport(v: Viewport): void;
  locateTip(tipId: string): { x: number; y: number } | null;
  locateNode(nodeId: string): { x: number; y: number } | null;
  nodeBounds(nodeId: string): { x: number; y: number; width: number; height: number } | null;
  columnCell(colId: string, tipId: string): { x: number; y: number; width: number; height: number } | null;
  getStats(): ReturnType<TreeViewer['getStats']>;
  benchmark(n: number): ReturnType<TreeViewer['benchmark']>;
  renderer(): TreeViewer | null;
}

/** One entry of the node menu (the viewer's `NodeMenuItem`). The view only shows the list and calls onSelect; what an action does (and
 *  whether it changes the tree) is the page's business, so the viewer and this component stay free of tree operations. */
export type NodeMenuItem = ViewerMenuItem;

export interface CladeProp {
  nodeId: string;
  colour: string;
  /** Name in a legend (see the Legend control). */
  label?: string;
}

/**
 * Props are the whole state; there is no need to memoise them. Identity rules (what makes a prop count as changed):
 *  - `options`, `theme`: compared field by field (`Object.is` on every own value; `theme.categorical` element-wise). An inline object
 *    literal with the same values is no change. A function-valued option (`formatLabel`) or `tipHref` is compared by identity, so
 *    an inline arrow is a change on every render: hoist it or wrap it in `useCallback` (or `useMemo` for the object). A change
 *    to `softwareCanvas` re-creates the renderer.
 *  - `highlighted`: compared element-wise with the last array applied. A new array with the same ids costs one O(n) compare.
 *  - `clades`: compared by content (node id, colour and label, in order).
 *  - `columns`: each column is compared by `id`, `kind`, `header`, `width` and `values` BY REFERENCE (a deep compare of a dictionary
 *    with millions of entries costs as much as recompiling). Column objects are compared by reference first, so replace them too
 *    rather than mutating one in place. Only columns that changed are compiled again; if the data object
 *    is unchanged and only the header or width changed, the compiled data is kept. Pass the same `values` object while the data
 *    is unchanged and a new object (never an in-place mutation) when it changed. A new array of the same columns is no change.
 *  - `viewport`: compared by its four numbers.
 *  - `focus`: acts when `seq` changes; the tip id alone changing does nothing.
 *  - `controls`: compared element by element by identity; a control that is no longer in the list is removed, a new one added. Create
 *    them once (`useMemo` / `useState`), not inline: `defaultControls()` in render makes new controls every time.
 *  - `layout`, `branchLengths` and the fields of `options` act when their value changes: a change made on the viewer itself (by the
 *    LayoutToggle control, say) stays until that prop changes; they are not re-applied when another prop changes.
 *  - `tree` / `source`: a new one is handed to the same renderer (`TreeViewer.setTree`), so the controls, layout, theme overrides and
 *    listeners stay and `onReady` fires once per renderer, not per edit. The view is fitted, or, with `treeMap`, kept. Only a change
 *    between `tree` and `source` (a different kind of input), or of `options.softwareCanvas`, re-creates the renderer.
 *  - `treeMap`: read when `tree` / `source` changes; it is not a trigger by itself.
 *  - callbacks are read at call time and never trigger anything.
 */
export interface TreeViewProps {
  tree?: TreeData; // a tree in memory (wrapped in an InMemorySource) ...
  source?: TreeSource; // ... or a source that loads parts of it on demand; one of the two, `source` wins
  /** The node map (old node -> new node, -1 removed) of the operation that produced the new `tree`, e.g. tree-ops' `map`. With it the
   *  viewport stays on the same tips; without it a new `tree` is fitted. Pass it in the same render as the new `tree`. */
  treeMap?: Int32Array;

  layout?: LayoutKind;
  branchLengths?: boolean;
  clades?: CladeProp[];
  highlighted?: string[];
  /** Node ids of tips that stand for collapsed clades (the page replaced each clade by one tip, e.g. with tree-ops' collapseClades):
   *  drawn as a triangle instead of a dot, with the label moved past it. */
  collapsed?: string[];
  columns?: Column[]; // see the identity rules above: `values` by reference
  viewport?: Viewport; // controlled; omit for uncontrolled
  theme?: Partial<TreeTheme>;
  tipHref?: ((tipId: string) => string) | null; // compared by identity
  focus?: { tipId: string; seq: number } | null; // declarative "centre this tip" request; acts when seq changes
  /** Every field passes through to the viewer; a field that is absent or undefined is the default (removing a key reverts it). */
  options?: Partial<Omit<ViewerOptions, 'layout' | 'branchLengths' | 'tipHref'>>;
  /** Controls on the viewer (`@gbif-phylo/viewer` controls or your own); default zoom and fit (as `defaultControls()`), [] for none. */
  controls?: Control[];
  /** The hover tooltip: true (default content), false, or your content for the event (rendered into the viewer's tooltip box). */
  tooltip?: boolean | ((e: TreeNodeEvent) => React.ReactNode);
  /** Actions for the clicked tip or clade, shown as a menu at the click (keyboard: Enter on the cursor opens it, arrows move,
   *  Escape closes, Tab out closes). Return null or [] for no menu. Called after onTipClick / onNodeClick. */
  nodeMenu?: (e: TreeNodeEvent) => NodeMenuItem[] | null | undefined;
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
  onNodeClick?(e: TreeNodeEvent): void; // internal nodes, collapsed clades and branches
  onTipClick?(e: TreeNodeEvent): void;
  onHover?(e: TreeNodeEvent | null): void;
  onViewportChange?(v: Viewport): void;
  onFrame?(s: FrameStats): void;
  onReady?(info: { layoutMs: number; tips: number }): void;
}

const NODE_ID = /^n(\d+)$/;
const EMPTY = {} as NonNullable<TreeViewProps['options']>;
const EMPTY_IDS: string[] = [];
const EMPTY_COLUMNS: Column[] = [];

function nodeIndexOf(nodeCount: number, id: string): number {
  const m = NODE_ID.exec(id);
  if (!m) return -1;
  const k = Number(m[1]);
  return k < nodeCount ? k : -1;
}

function toCladeColours(nodeCount: number, clades: CladeProp[] | undefined): CladeColour[] {
  return (clades ?? []).map((c) => ({ node: nodeIndexOf(nodeCount, c.nodeId), colour: c.colour, label: c.label })).filter((c) => c.node >= 0);
}

/** Create the renderer in a layout effect and destroy it in the cleanup (strict-mode safe: the cleanup undoes everything the effect did).
 *  `make` builds the renderer over the host element and returns it with an extra cleanup; it is read from a ref, so it may close over
 *  the props of the latest render, and the renderer is re-created only when the kind of input (`tree` or `source`) or `softwareCanvas` changes; a new tree goes to `setTree`. Returns the instance
 *  as state (the prop-sync effects depend on it, so they re-run once it exists and again after a re-creation, without anything reading
 *  a ref during render) and as a ref for the imperative handle, which is only called after mount. */
function useRenderer(
  hostRef: React.RefObject<HTMLElement>,
  kind: 'tree' | 'source',
  softwareCanvas: boolean | undefined,
  make: (host: HTMLElement) => [TreeViewer, () => void],
): { renderer: TreeViewer | null; rendererRef: React.MutableRefObject<TreeViewer | null> } {
  const [renderer, setRenderer] = useState<TreeViewer | null>(null);
  const rendererRef = useRef<TreeViewer | null>(null);
  const makeRef = useRef(make);
  useLayoutEffect(() => {
    makeRef.current = make; // declared before the create effect below, so that one sees this render's closure
  });
  useLayoutEffect(() => {
    const [r, cleanup] = makeRef.current(hostRef.current!);
    rendererRef.current = r;
    setRenderer(r);
    return () => {
      cleanup();
      r.destroy();
      rendererRef.current = null;
      setRenderer(null);
    };
  }, [hostRef, kind, softwareCanvas]);
  return { renderer, rendererRef };
}

/** The renderer if it is the live one. The effects below close over the renderer of the render they were created in; on a `source` change (or a
 *  strict-mode remount) the create effect's cleanup has already destroyed that instance when they run, so each one acts only on a live instance. */
function liveRenderer(r: TreeViewer | null, ref: React.RefObject<TreeViewer | null>): TreeViewer | null {
  return r !== null && r === ref.current ? r : null;
}

export const TreeView = forwardRef<TreeViewHandle, TreeViewProps>(function TreeView(props, ref) {
  const {
    layout = 'rectangular',
    branchLengths = true,
    clades,
    highlighted,
    collapsed,
    columns,
    viewport,
    tipHref = null,
    focus,
    tooltip = true,
  } = props;
  const source = useMemo<TreeSource>(() => props.source ?? new InMemorySource(props.tree!), [props.source, props.tree]);
  const hostRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  const sourceRef = useRef(source);
  useLayoutEffect(() => {
    latest.current = props; // the listeners the viewer holds always call the newest callbacks
    sourceRef.current = source;
  });

  // Identity-stable inputs: an inline `options` / `theme` object is a new object on every parent render, but the effects below only
  // run when a value in it changed (the viewer's setters also ignore unchanged values, belt and braces).
  const options = useShallowStable(props.options ?? EMPTY);
  // the whole option set, defaults included: an option removed from `options` (or set to undefined) goes back to its default
  const rendererOptions = useMemo<ViewerOptions>(
    () => ({ ...DEFAULT_OPTIONS, ...stripUndefined(options), layout, branchLengths, tipHref }),
    [options, layout, branchLengths, tipHref],
  );
  // the overrides only: the viewer puts them over its fallback theme
  const themeOverrides = useStable<Partial<TreeTheme>>(stripUndefined(props.theme ?? {}), (a, b) =>
    themeEquals({ ...FALLBACK_THEME, ...a }, { ...FALLBACK_THEME, ...b }),
  );

  // The tooltip and the node menu are the viewer's own Tooltip and NodeMenu controls, created once per component. A tooltip given as a
  // function renders its React content through a portal into a box that the Tooltip shows (flushSync, so it is measured with it).
  const [portalBox] = useState(() => document.createElement('div'));
  const [tipEvent, setTipEvent] = useState<TreeNodeEvent | null>(null);
  const [tooltipControl] = useState(
    () =>
      new Tooltip({
        render: (e, v) => {
          const t = latest.current.tooltip;
          if (typeof t !== 'function') return defaultTooltipFor(e, v);
          flushSync(() => setTipEvent(e));
          return portalBox;
        },
      }),
  );
  const [menuControl] = useState(() => new NodeMenu({ items: (e) => latest.current.nodeMenu?.(e) }));

  const { renderer: R, rendererRef: rendRef } = useRenderer(hostRef, props.source ? 'source' : 'tree', options.softwareCanvas, (host) => {
    const r = new TreeViewer({ target: host, source, options: rendererOptions, theme: themeOverrides });
    r.on('click', (ev) => (ev.isTip ? latest.current.onTipClick?.(ev) : latest.current.onNodeClick?.(ev)));
    r.on('hover', (ev) => latest.current.onHover?.(ev));
    r.on('viewchange', (v) => latest.current.onViewportChange?.(v));
    r.on('frame', (s) => latest.current.onFrame?.(s));
    let ready = 0;
    ready = requestAnimationFrame(() => {
      ready = requestAnimationFrame(() => latest.current.onReady?.({ layoutMs: r.layout.layoutMs, tips: source.tipCount }));
    });
    return [r, () => cancelAnimationFrame(ready)];
  });

  // ---- props -> viewer. Each effect re-runs when the viewer is (re)created or its input changed; the viewer's setters are no-ops for
  // an input equal to the current one, so none of them needs more than its own value in the dependency list.
  useLayoutEffect(() => {
    liveRenderer(R, rendRef)?.setTheme(themeOverrides);
  }, [R, rendRef, themeOverrides]);
  // Only the options whose prop changed since the last render are applied: an option changed on the viewer itself (the LayoutToggle
  // control sets `layout`) stays until its prop changes, instead of being reset whenever some other option prop changes.
  const applied = useRef<{ r: TreeViewer; o: ViewerOptions } | null>(null);
  useLayoutEffect(() => {
    const r = liveRenderer(R, rendRef);
    if (!r) return;
    const prev = applied.current;
    applied.current = { r, o: rendererOptions };
    if (!prev || prev.r !== r) return r.setOptions(rendererOptions); // a new viewer: the whole set (it was created with it anyway)
    const patch: Partial<ViewerOptions> = {};
    for (const k of changedKeys(prev.o, rendererOptions)) (patch as Record<string, unknown>)[k] = rendererOptions[k];
    r.setOptions(patch);
  }, [R, rendRef, rendererOptions]);
  // A new tree or source goes to the renderer that shows the old one. Clades, highlights and collapsed marks go in the same call, so
  // the first frame of the new tree is drawn with them; the effects below then find nothing to change.
  const treeMap = props.treeMap;
  useLayoutEffect(() => {
    const r = liveRenderer(R, rendRef);
    if (!r || r.getSource() === source) return;
    r.setTree(source, {
      map: treeMap,
      view: treeMap ? 'keep' : 'fit',
      clades: toCladeColours(source.nodeCount, clades),
      highlighted: highlighted ?? EMPTY_IDS,
      collapsed: (collapsed ?? EMPTY_IDS).map((id) => nodeIndexOf(source.nodeCount, id)).filter((n) => n >= 0),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- treeMap, clades, highlighted and collapsed are read for this change of `source` only
  }, [R, rendRef, source]);
  // `source` is in the dependency list of the next two only because their bodies read it; the new viewer's first run is triggered by `R`
  useLayoutEffect(() => {
    liveRenderer(R, rendRef)?.setClades(toCladeColours(source.nodeCount, clades));
  }, [R, rendRef, source, clades]);
  useLayoutEffect(() => {
    liveRenderer(R, rendRef)?.setHighlighted(highlighted ?? EMPTY_IDS);
  }, [R, rendRef, highlighted]);
  useLayoutEffect(() => {
    liveRenderer(R, rendRef)?.setCollapsed((collapsed ?? EMPTY_IDS).map((id) => nodeIndexOf(source.nodeCount, id)).filter((n) => n >= 0));
  }, [R, rendRef, source, collapsed]);
  useLayoutEffect(() => {
    liveRenderer(R, rendRef)?.setColumns(columns ?? EMPTY_COLUMNS);
  }, [R, rendRef, columns]);
  // the default is Zoom and Fit themselves, not defaultControls(): that would bundle every control into every app using <TreeView>
  const [ownControls] = useState<Control[]>(() => [new Zoom(), new Fit()]);
  const controls = useStable(props.controls ?? ownControls, (a, b) => a.length === b.length && a.every((c, i) => c === b[i]));
  const hasMenu = props.nodeMenu !== undefined;
  useLayoutEffect(() => {
    const r = liveRenderer(R, rendRef);
    if (!r) return;
    const want = [...controls, ...(tooltip ? [tooltipControl] : []), ...(hasMenu ? [menuControl] : [])];
    for (const c of r.getControls()) if (!want.includes(c)) r.removeControl(c);
    for (const c of want) r.addControl(c);
  }, [R, rendRef, controls, tooltip, tooltipControl, hasMenu, menuControl]);
  const [vx0, vx1, vy0, vy1] = [viewport?.x0, viewport?.x1, viewport?.y0, viewport?.y1]; // compared by value: a new object with the same numbers is no change
  useLayoutEffect(() => {
    if (vx0 !== undefined && vx1 !== undefined && vy0 !== undefined && vy1 !== undefined)
      liveRenderer(R, rendRef)?.setViewport({ x0: vx0, x1: vx1, y0: vy0, y1: vy1 });
  }, [R, rendRef, vx0, vx1, vy0, vy1]);
  const focusSeq = focus?.seq;
  // acts when `seq` changes or the renderer is created, not when a new tree arrives (that would override the view it kept)
  useLayoutEffect(() => {
    const f = latest.current.focus;
    const r = liveRenderer(R, rendRef);
    if (!f || !r) return;
    const snap = sourceRef.current.snapshot();
    const n = snap.tipIndex(f.tipId);
    if (n >= 0) r.focusTip(snap.tipRank[n]);
  }, [R, rendRef, focusSeq]);

  useImperativeHandle(
    ref,
    () => ({
      fit: () => rendRef.current?.fit(true),
      focusTip: (id) => {
        const n = source.snapshot().tipIndex(id);
        if (n >= 0) rendRef.current?.focusTip(source.snapshot().tipRank[n], true);
      },
      zoomToNode: (id) => {
        const k = nodeIndexOf(source.nodeCount, id);
        if (k >= 0) rendRef.current?.zoomToNode(k, true);
      },
      getViewport: () => rendRef.current!.getViewport(),
      setViewport: (v) => rendRef.current?.setViewport(v),
      locateTip: (id) => {
        const n = source.snapshot().tipIndex(id);
        return n < 0 ? null : (rendRef.current?.locateNode(n) ?? null);
      },
      locateNode: (id) => {
        const k = nodeIndexOf(source.nodeCount, id);
        return k < 0 ? null : (rendRef.current?.locateNode(k) ?? null);
      },
      nodeBounds: (id) => {
        const k = nodeIndexOf(source.nodeCount, id);
        return k < 0 ? null : (rendRef.current?.nodeBounds(k) ?? null);
      },
      columnCell: (c, id) => {
        const n = source.snapshot().tipIndex(id);
        return n < 0 ? null : (rendRef.current?.columnCell(c, source.snapshot().tipRank[n]) ?? null);
      },
      getStats: () => rendRef.current!.getStats(),
      benchmark: (n) => rendRef.current!.benchmark(n),
      renderer: () => rendRef.current,
    }),
    [source, rendRef],
  );

  return (
    <div
      ref={hostRef}
      className={props.className}
      style={{ position: 'relative', width: props.width ?? '100%', height: props.height ?? '100%', overflow: 'hidden', ...props.style }}
    >
      {typeof tooltip === 'function' && tipEvent && createPortal(tooltip(tipEvent), portalBox)}
    </div>
  );
});
