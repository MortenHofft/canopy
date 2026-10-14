// <TreeView>: the React layer over the renderer core. Props are the whole state (clades, highlighted tips,
// columns, layout, lengths, theme, optional controlled viewport); callbacks report interaction. No globals:
// every instance owns its renderer, which is created in a layout effect and destroyed on unmount (rAF
// cancelled, observers and listeners removed, canvases released).

import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { TreeRenderer } from '../core/renderer.ts';
import {
  FALLBACK_THEME,
  type Column, type FrameStats, type HitKind, type LayoutKind, type NodeEvent, type RendererOptions, type TreeData, type TreeTheme, type Viewport,
} from '../core/types.ts';

export interface TreeNodeEvent {
  nodeId: string; // 'n<preorder index>', the id scheme of the shared TreeModel
  node: number;
  isTip: boolean;
  kind: HitKind; // what was hit: a tip, an internal node marker, a collapsed clade or a branch
  tipId: string | null; // the tip's label when isTip
  tipCount: number;
  tipRange: [number, number]; // descendant tips are the leaf-rank range [start, end): O(1), no traversal
  tipIds(): string[]; // the descendant tip labels (a slice; allocated on demand)
  via: 'pointer' | 'keyboard';
  clientX: number;
  clientY: number;
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

export interface TreeViewProps {
  tree: TreeData;
  layout?: LayoutKind;
  branchLengths?: boolean;
  clades?: CladeProp[];
  highlighted?: string[];
  columns?: Column[];
  viewport?: Viewport; // controlled; omit for uncontrolled
  theme?: Partial<TreeTheme>;
  tipHref?: ((tipId: string) => string) | null;
  focus?: { tipId: string; seq: number } | null; // declarative "centre this tip" request; acts when seq changes
  options?: Partial<Omit<RendererOptions, 'layout' | 'branchLengths' | 'tipHref'>>;
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

function nodeIndexOf(tree: TreeData, id: string): number {
  const m = NODE_ID.exec(id);
  if (!m) return -1;
  const k = Number(m[1]);
  return k < tree.nodeCount ? k : -1;
}

export const TreeView = forwardRef<TreeViewHandle, TreeViewProps>(function TreeView(props, ref) {
  const { tree, layout = 'rectangular', branchLengths = true, clades, highlighted, columns, viewport, theme, tipHref = null, focus, options = EMPTY, tooltip = true } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rendRef = useRef<TreeRenderer | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [gen, setGen] = useState(0);
  const [tip, setTip] = useState<{ ev: TreeNodeEvent; x: number; y: number } | null>(null);

  const toEvent = (e: NodeEvent): TreeNodeEvent => {
    const isTip = tree.childCount[e.node] === 0;
    return {
      nodeId: 'n' + e.node,
      node: e.node,
      isTip,
      kind: e.kind,
      tipId: isTip ? tree.labels[e.node] : null,
      tipCount: e.tipEnd - e.tipStart,
      tipRange: [e.tipStart, e.tipEnd],
      tipIds: () => tree.tipLabels.slice(e.tipStart, e.tipEnd),
      via: e.via,
      clientX: e.clientX,
      clientY: e.clientY,
    };
  };

  // ---- create / destroy (also strict-mode safe: the cleanup undoes everything the effect did)
  useLayoutEffect(() => {
    const host = hostRef.current!;
    const o = latest.current.options ?? EMPTY;
    const r = new TreeRenderer(
      host,
      tree,
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
      { ...o, layout: latest.current.layout ?? 'rectangular', branchLengths: latest.current.branchLengths ?? true, tipHref: latest.current.tipHref ?? null },
      { ...FALLBACK_THEME, ...(latest.current.theme ?? {}) },
    );
    rendRef.current = r;
    setGen((g) => g + 1);
    let ready = 0;
    ready = requestAnimationFrame(() => {
      ready = requestAnimationFrame(() => latest.current.onReady?.({ layoutMs: r.layout.layoutMs, tips: tree.tipCount }));
    });
    return () => {
      cancelAnimationFrame(ready);
      r.destroy();
      rendRef.current = null;
      setTip(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, options.softwareCanvas]);

  const R = rendRef.current;
  useLayoutEffect(() => { R?.setTheme({ ...FALLBACK_THEME, ...(theme ?? {}) }); }, [gen, theme]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    R?.setOptions({
      layout, branchLengths, tipHref,
      ...(o(options.lod) && { lod: options.lod }), ...(o(options.drawBudget) && { drawBudget: options.drawBudget }), ...(o(options.showSummaries) && { showSummaries: options.showSummaries }),
      ...(o(options.overview) && { overview: options.overview }), ...(o(options.labelDensity) && { labelDensity: options.labelDensity }), ...(o(options.rowHeight) && { rowHeight: options.rowHeight }),
      ...(o(options.axis) && { axis: options.axis }), ...(o(options.italicLabels) && { italicLabels: options.italicLabels }), ...(o(options.minCladePx) && { minCladePx: options.minCladePx }),
      ...(o(options.formatLabel) && { formatLabel: options.formatLabel }), ...(o(options.ariaLabel) && { ariaLabel: options.ariaLabel }),
    });
  }, [gen, layout, branchLengths, tipHref, options.lod, options.drawBudget, options.showSummaries, options.overview, options.labelDensity, options.rowHeight, options.axis, options.italicLabels, options.minCladePx, options.formatLabel, options.ariaLabel]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    R?.setClades((clades ?? []).map((c) => ({ node: nodeIndexOf(tree, c.nodeId), colour: c.colour })).filter((c) => c.node >= 0));
  }, [gen, clades]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { R?.setHighlighted(highlighted ?? []); }, [gen, highlighted]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { R?.setColumns(columns ?? []); }, [gen, columns]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { if (viewport) R?.setViewport(viewport); }, [gen, viewport?.x0, viewport?.x1, viewport?.y0, viewport?.y1]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!focus) return;
    const n = tree.tipIndex(focus.tipId);
    if (n >= 0) R?.focusTip(tree.tipRank[n]);
  }, [gen, focus?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    fit: () => rendRef.current?.fit(true),
    focusTip: (id) => { const n = tree.tipIndex(id); if (n >= 0) rendRef.current?.focusTip(tree.tipRank[n], true); },
    zoomToNode: (id) => { const k = nodeIndexOf(tree, id); if (k >= 0) rendRef.current?.zoomToNode(k, true); },
    getViewport: () => rendRef.current!.getViewport(),
    setViewport: (v) => rendRef.current?.setViewport(v),
    locateTip: (id) => { const n = tree.tipIndex(id); return n < 0 ? null : rendRef.current?.locateNode(n) ?? null; },
    locateNode: (id) => { const k = nodeIndexOf(tree, id); return k < 0 ? null : rendRef.current?.locateNode(k) ?? null; },
    nodeBounds: (id) => { const k = nodeIndexOf(tree, id); return k < 0 ? null : rendRef.current?.nodeBounds(k) ?? null; },
    columnCell: (c, id) => { const n = tree.tipIndex(id); return n < 0 ? null : rendRef.current?.columnCell(c, tree.tipRank[n]) ?? null; },
    getStats: () => rendRef.current!.getStats(),
    benchmark: (n) => rendRef.current!.benchmark(n),
    renderer: () => rendRef.current,
  }), [tree]);

  // keep the tooltip fresh only while hovering
  useEffect(() => { if (!tooltip) setTip(null); }, [tooltip]);

  const defaultTip = (e: TreeNodeEvent) => (
    <>
      <div style={{ fontStyle: e.isTip ? 'italic' : 'normal', fontWeight: 600 }}>{e.isTip ? (options.formatLabel ?? ((s: string) => s.replace(/_/g, ' ')))(e.tipId ?? '') : e.kind === 'summary' ? `Collapsed clade, ${e.tipCount} tips` : `Clade, ${e.tipCount} tips`}</div>
      {!e.isTip && tree.labels[e.node] && <div>{tree.labels[e.node]}</div>}
    </>
  );
  return (
    <div ref={wrapRef} className={props.className} style={{ position: 'relative', width: props.width ?? '100%', height: props.height ?? '100%', overflow: 'hidden', ...props.style }}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      {tooltip && tip && (
        <div role="tooltip" data-treeview-tooltip="" style={{ position: 'absolute', left: Math.min(tip.x + 14, 4000), top: tip.y + 14, pointerEvents: 'none', zIndex: 5, padding: '4px 8px', borderRadius: 6, fontSize: 12, lineHeight: 1.35, background: theme?.background ?? FALLBACK_THEME.background, color: theme?.foreground ?? FALLBACK_THEME.foreground, border: `1px solid ${theme?.muted ?? FALLBACK_THEME.muted}`, boxShadow: '0 2px 8px rgba(0,0,0,.18)', fontFamily: theme?.fontFamily ?? FALLBACK_THEME.fontFamily, maxWidth: 260 }}>
          {typeof tooltip === 'function' ? tooltip(tip.ev) : defaultTip(tip.ev)}
        </div>
      )}
    </div>
  );
});

const o = <T,>(v: T | undefined): v is T => v !== undefined;
