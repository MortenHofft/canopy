// <TreeView>: the React layer over the renderer core. Props are the whole state (clades, highlighted tips,
// columns, layout, lengths, theme, optional controlled viewport); callbacks report interaction. No globals:
// every instance owns its renderer, which is created in a layout effect and destroyed on unmount (rAF
// cancelled, observers and listeners removed, canvases released).

import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TreeRenderer } from '../core/renderer.ts';
import { InMemorySource, type TreeSource } from '../core/source.ts';
import { stripUndefined, useShallowStable, useStable } from './props.ts';
import {
  DEFAULT_OPTIONS,
  FALLBACK_THEME,
  themeEquals,
  type Column,
  type FrameStats,
  type HitKind,
  type LayoutKind,
  type NodeEvent,
  type RendererOptions,
  type TreeData,
  type TreeTheme,
  type Viewport,
} from '../core/types.ts';

export interface TreeNodeEvent {
  nodeId: string; // 'n<preorder index>', the id scheme of the shared TreeModel
  node: number;
  isTip: boolean;
  kind: HitKind; // what was hit: a tip, an internal node marker, a collapsed clade or a branch
  tipId: string | null; // the tip's label when isTip
  tipCount: number;
  tipRange: [number, number]; // descendant tips are the leaf-rank range [start, end): O(1), no traversal
  tipIds(): string[]; // the descendant tip labels (a slice; allocated on demand); only the loaded ones with a partial source
  tipLabels(): Promise<string[]>; // the same through the source, also for clades whose labels are not loaded
  via: 'pointer' | 'keyboard';
  clientX: number;
  clientY: number;
  /** A run of small siblings drawn as one slice: `node` is their parent, kind is 'summary' and tipRange / tipCount / tipIds()
   *  are ONLY the run's tips. Absent for every other target. */
  run?: { clades: number; single: number };
}

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
  getStats(): ReturnType<TreeRenderer['getStats']>;
  benchmark(n: number): ReturnType<TreeRenderer['benchmark']>;
  renderer(): TreeRenderer | null;
}

export interface CladeProp {
  nodeId: string;
  colour: string;
}

/**
 * Props are the whole state; there is no need to memoise them. Identity rules (what makes a prop count as changed):
 *  - `options`, `theme`: compared field by field (`Object.is` on every own value; `theme.categorical` element-wise). An inline object
 *    literal with the same values is no change. A function-valued option (`formatLabel`) or `tipHref` is compared by identity, so
 *    an inline arrow is a change on every render: hoist it or wrap it in `useCallback` (or `useMemo` for the object). A change
 *    to `softwareCanvas` re-creates the renderer.
 *  - `highlighted`: compared element-wise with the last array applied. A new array with the same ids costs one O(n) compare.
 *  - `clades`: compared by content (node id and colour, in order).
 *  - `columns`: each column is compared by `id`, `kind`, `header`, `width` and `values` BY REFERENCE (a deep compare of a dictionary
 *    with millions of entries costs as much as recompiling). Column objects are compared by reference first, so replace them too
 *    rather than mutating one in place. Only columns that changed are compiled again; if the data object
 *    is unchanged and only the header or width changed, the compiled data is kept. Pass the same `values` object while the data
 *    is unchanged and a new object (never an in-place mutation) when it changed. A new array of the same columns is no change.
 *  - `viewport`: compared by its four numbers.
 *  - `focus`: acts when `seq` changes; the tip id alone changing does nothing.
 *  - `tree` / `source`: a new one re-creates the renderer (and so resets the view).
 *  - callbacks are read at call time and never trigger anything.
 */
export interface TreeViewProps {
  tree?: TreeData; // a tree in memory (wrapped in an InMemorySource) ...
  source?: TreeSource; // ... or a source that loads parts of it on demand; one of the two, `source` wins

  layout?: LayoutKind;
  branchLengths?: boolean;
  clades?: CladeProp[];
  highlighted?: string[];
  columns?: Column[]; // see the identity rules above: `values` by reference
  viewport?: Viewport; // controlled; omit for uncontrolled
  theme?: Partial<TreeTheme>;
  tipHref?: ((tipId: string) => string) | null; // compared by identity
  focus?: { tipId: string; seq: number } | null; // declarative "centre this tip" request; acts when seq changes
  options?: Partial<Omit<RendererOptions, 'layout' | 'branchLengths' | 'tipHref'>>; // every field passes through to the renderer; a field that is absent or undefined is the default (removing a key reverts it)
  tooltip?: boolean | ((e: TreeNodeEvent) => React.ReactNode);
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

/** Create the renderer in a layout effect and destroy it in the cleanup (strict-mode safe: the cleanup undoes everything the effect did).
 *  `make` builds the renderer over the host element and returns it with an extra cleanup; it is read from a ref, so it may close over
 *  the props of the latest render, and the renderer is re-created only when `source` or `softwareCanvas` changes. Returns the instance
 *  as state (the prop-sync effects depend on it, so they re-run once it exists and again after a re-creation, without anything reading
 *  a ref during render) and as a ref for the imperative handle, which is only called after mount. */
function useRenderer(
  hostRef: React.RefObject<HTMLElement>,
  source: TreeSource,
  softwareCanvas: boolean | undefined,
  make: (host: HTMLElement) => [TreeRenderer, () => void],
): { renderer: TreeRenderer | null; rendererRef: React.MutableRefObject<TreeRenderer | null> } {
  const [renderer, setRenderer] = useState<TreeRenderer | null>(null);
  const rendererRef = useRef<TreeRenderer | null>(null);
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
  }, [hostRef, source, softwareCanvas]);
  return { renderer, rendererRef };
}

/** The renderer if it is the live one. The effects below close over the renderer of the render they were created in; on a `source` change (or a
 *  strict-mode remount) the create effect's cleanup has already destroyed that instance when they run, so each one acts only on a live instance. */
function liveRenderer(r: TreeRenderer | null, ref: React.RefObject<TreeRenderer | null>): TreeRenderer | null {
  return r !== null && r === ref.current ? r : null;
}

export const TreeView = forwardRef<TreeViewHandle, TreeViewProps>(function TreeView(props, ref) {
  const { layout = 'rectangular', branchLengths = true, clades, highlighted, columns, viewport, tipHref = null, focus, tooltip = true } = props;
  const source = useMemo<TreeSource>(() => props.source ?? new InMemorySource(props.tree!), [props.source, props.tree]);
  const hostRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props; // the callbacks the renderer holds always call the newest ones
  });
  const [tip, setTip] = useState<{ ev: TreeNodeEvent; x: number; y: number } | null>(null);

  // Identity-stable inputs: an inline `options` / `theme` object is a new object on every parent render, but the effects below only
  // run when a value in it changed (the renderer's setters also ignore unchanged values, belt and braces).
  const options = useShallowStable(props.options ?? EMPTY);
  // the whole option set, defaults included: an option removed from `options` (or set to undefined) goes back to its default
  const rendererOptions = useMemo<RendererOptions>(
    () => ({ ...DEFAULT_OPTIONS, ...stripUndefined(options), layout, branchLengths, tipHref }),
    [options, layout, branchLengths, tipHref],
  );
  const fullTheme = useStable<TreeTheme>({ ...FALLBACK_THEME, ...stripUndefined(props.theme ?? {}) }, themeEquals);

  const toEvent = (e: NodeEvent): TreeNodeEvent => {
    return {
      nodeId: 'n' + e.node,
      node: e.node,
      isTip: e.isTip,
      kind: e.kind,
      tipId: e.tipId,
      tipCount: e.tipEnd - e.tipStart,
      tipRange: [e.tipStart, e.tipEnd],
      tipIds: () => source.snapshot().tipLabels.slice(e.tipStart, e.tipEnd),
      tipLabels: () => source.tipLabels(e.tipStart, e.tipEnd),
      via: e.via,
      clientX: e.clientX,
      clientY: e.clientY,
      run: e.run,
    };
  };

  const { renderer: R, rendererRef: rendRef } = useRenderer(hostRef, source, options.softwareCanvas, (host) => {
    const r = new TreeRenderer(
      host,
      source,
      {
        onClick: (e) => {
          const ev = toEvent(e);
          const p = latest.current;
          if (ev.isTip) p.onTipClick?.(ev);
          else p.onNodeClick?.(ev);
        },
        onHover: (e) => {
          const ev = e ? toEvent(e) : null;
          latest.current.onHover?.(ev);
          if (!ev || !wrapRef.current) return setTip(null);
          const b = wrapRef.current.getBoundingClientRect();
          setTip({ ev, x: ev.clientX - b.left, y: ev.clientY - b.top });
        },
        onViewportChange: (v) => latest.current.onViewportChange?.(v),
        onFrame: (s) => latest.current.onFrame?.(s),
      },
      rendererOptions,
      fullTheme,
    );
    let ready = 0;
    ready = requestAnimationFrame(() => {
      ready = requestAnimationFrame(() => latest.current.onReady?.({ layoutMs: r.layout.layoutMs, tips: source.tipCount }));
    });
    return [
      r,
      () => {
        cancelAnimationFrame(ready);
        setTip(null);
      },
    ];
  });

  // ---- props -> renderer. Each effect re-runs when the renderer is (re)created or its input changed; the renderer's setters are no-ops
  // for an input equal to the current one, so none of them needs more than its own value in the dependency list.
  useLayoutEffect(() => {
    liveRenderer(R, rendRef)?.setTheme(fullTheme);
  }, [R, rendRef, fullTheme]);
  useLayoutEffect(() => {
    liveRenderer(R, rendRef)?.setOptions(rendererOptions);
  }, [R, rendRef, rendererOptions]);
  // `source` is in the dependency list of the next two only because their bodies read it; the new renderer's first run is triggered by `R`
  useLayoutEffect(() => {
    liveRenderer(R, rendRef)?.setClades(
      (clades ?? []).map((c) => ({ node: nodeIndexOf(source.nodeCount, c.nodeId), colour: c.colour })).filter((c) => c.node >= 0),
    );
  }, [R, rendRef, source, clades]);
  useLayoutEffect(() => {
    liveRenderer(R, rendRef)?.setHighlighted(highlighted ?? EMPTY_IDS);
  }, [R, rendRef, highlighted]);
  useLayoutEffect(() => {
    liveRenderer(R, rendRef)?.setColumns(columns ?? EMPTY_COLUMNS);
  }, [R, rendRef, columns]);
  const [vx0, vx1, vy0, vy1] = [viewport?.x0, viewport?.x1, viewport?.y0, viewport?.y1]; // compared by value: a new object with the same numbers is no change
  useLayoutEffect(() => {
    if (vx0 !== undefined && vx1 !== undefined && vy0 !== undefined && vy1 !== undefined)
      liveRenderer(R, rendRef)?.setViewport({ x0: vx0, x1: vx1, y0: vy0, y1: vy1 });
  }, [R, rendRef, vx0, vx1, vy0, vy1]);
  const focusSeq = focus?.seq;
  useLayoutEffect(() => {
    const f = latest.current.focus; // acts when `seq` changes, not when only the tip id does
    const r = liveRenderer(R, rendRef);
    if (!f || !r) return;
    const n = source.snapshot().tipIndex(f.tipId);
    if (n >= 0) r.focusTip(source.snapshot().tipRank[n]);
  }, [R, rendRef, source, focusSeq]);

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

  // keep the tooltip fresh only while hovering
  useEffect(() => {
    if (!tooltip) setTip(null);
  }, [tooltip]);

  const nodeLabel = (node: number): string => {
    const t = source.snapshot();
    return t.labels[t.toLocal(node)] ?? '';
  };
  const defaultTip = (e: TreeNodeEvent) => (
    <>
      <div style={{ fontStyle: e.isTip ? 'italic' : 'normal', fontWeight: 600 }}>
        {e.isTip
          ? (options.formatLabel ?? ((s: string) => s.replace(/_/g, ' ')))(e.tipId ?? '')
          : e.run
            ? runText(e)
            : e.kind === 'summary'
              ? `Collapsed clade, ${e.tipCount} tips`
              : `Clade, ${e.tipCount} tips`}
      </div>
      {!e.isTip && (e.run ? <div>under {nodeLabel(e.node) || 'an unnamed node'}</div> : nodeLabel(e.node) && <div>{nodeLabel(e.node)}</div>)}
    </>
  );
  return (
    <div
      ref={wrapRef}
      className={props.className}
      style={{ position: 'relative', width: props.width ?? '100%', height: props.height ?? '100%', overflow: 'hidden', ...props.style }}
    >
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      {tooltip && tip && (
        <div
          role="tooltip"
          data-treeview-tooltip=""
          style={{
            position: 'absolute',
            left: Math.min(tip.x + 14, 4000),
            top: tip.y + 14,
            pointerEvents: 'none',
            zIndex: 5,
            padding: '4px 8px',
            borderRadius: 6,
            fontSize: 12,
            lineHeight: 1.35,
            background: fullTheme.background,
            color: fullTheme.foreground,
            border: `1px solid ${fullTheme.muted}`,
            boxShadow: '0 2px 8px rgba(0,0,0,.18)',
            fontFamily: fullTheme.fontFamily,
            maxWidth: 260,
          }}
        >
          {typeof tooltip === 'function' ? tooltip(tip.ev) : defaultTip(tip.ev)}
        </div>
      )}
    </div>
  );
});

/** Tooltip headline of a run of small siblings: '6,900 tips in 3,450 clades and 12 single tips'. */
function runText(e: TreeNodeEvent): string {
  const r = e.run!;
  const n = (v: number) => v.toLocaleString('en');
  const parts: string[] = [];
  if (r.clades) parts.push(`${n(r.clades)} ${r.clades === 1 ? 'clade' : 'clades'}`);
  if (r.single) parts.push(`${n(r.single)} single ${r.single === 1 ? 'tip' : 'tips'}`);
  return `${n(e.tipCount)} tips in ${parts.join(' and ')}`;
}
