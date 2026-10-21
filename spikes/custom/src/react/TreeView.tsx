// <TreeView>: the React layer over the renderer core. Props are the whole state (clades, highlighted tips,
// columns, layout, lengths, theme, optional controlled viewport); callbacks report interaction. No globals:
// every instance owns its renderer, which is created in a layout effect and destroyed on unmount (rAF
// cancelled, observers and listeners removed, canvases released).

import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TreeRenderer } from '../core/renderer.ts';
import { InMemorySource, type TreeSource } from '../core/source.ts';
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

/** One entry of the node menu. The view only shows the list and calls onSelect; what an action does (and whether it changes
 *  the tree) is the page's business, so the renderer and this component stay free of tree operations. */
export interface NodeMenuItem {
  id: string;
  label: string;
  hint?: string; // shown under the label (and as the title)
  disabled?: boolean;
  onSelect(): void;
}

export interface CladeProp {
  nodeId: string;
  colour: string;
}

export interface TreeViewProps {
  tree?: TreeData; // a tree in memory (wrapped in an InMemorySource) ...
  source?: TreeSource; // ... or a source that loads parts of it on demand; one of the two, `source` wins

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
  /** Actions for the clicked tip or clade, shown as a menu at the click (keyboard: Enter on the cursor opens it, arrows move,
   *  Escape closes). Return null or [] for no menu. Called after onTipClick / onNodeClick. */
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

function nodeIndexOf(nodeCount: number, id: string): number {
  const m = NODE_ID.exec(id);
  if (!m) return -1;
  const k = Number(m[1]);
  return k < nodeCount ? k : -1;
}

export const TreeView = forwardRef<TreeViewHandle, TreeViewProps>(function TreeView(props, ref) {
  const { layout = 'rectangular', branchLengths = true, clades, highlighted, columns, viewport, theme, tipHref = null, focus, options = EMPTY, tooltip = true } = props;
  const source = useMemo<TreeSource>(() => props.source ?? new InMemorySource(props.tree!), [props.source, props.tree]);
  const hostRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rendRef = useRef<TreeRenderer | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [gen, setGen] = useState(0);
  const [tip, setTip] = useState<{ ev: TreeNodeEvent; x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{ ev: TreeNodeEvent; items: NodeMenuItem[]; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuOpen = useRef(false); // read by the renderer callbacks, which are created once
  menuOpen.current = menu !== null;
  const refocus = useRef(false); // set while a menu action runs; read when the action remounts the renderer

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

  // ---- create / destroy (also strict-mode safe: the cleanup undoes everything the effect did)
  useLayoutEffect(() => {
    const host = hostRef.current!;
    const o = latest.current.options ?? EMPTY;
    const r = new TreeRenderer(
      host,
      source,
      {
        onClick: (e) => {
          const ev = toEvent(e);
          const p = latest.current;
          if (ev.isTip) p.onTipClick?.(ev);
          else p.onNodeClick?.(ev);
          const items = p.nodeMenu?.(ev);
          if (items?.length && wrapRef.current) {
            const b = wrapRef.current.getBoundingClientRect();
            setTip(null);
            setMenu({ ev, items, x: ev.clientX - b.left, y: ev.clientY - b.top });
          } else setMenu(null);
        },
        onHover: (e) => {
          const ev = e ? toEvent(e) : null;
          latest.current.onHover?.(ev);
          if (menuOpen.current) return setTip(null);
          if (!ev || !wrapRef.current) return setTip(null);
          const b = wrapRef.current.getBoundingClientRect();
          setTip({ ev, x: ev.clientX - b.left, y: ev.clientY - b.top });
        },
        onViewportChange: (v) => {
          if (menuOpen.current) setMenu(null); // the menu is anchored to a point of the old view
          latest.current.onViewportChange?.(v);
        },
        onFrame: (s) => latest.current.onFrame?.(s),
      },
      { ...o, layout: latest.current.layout ?? 'rectangular', branchLengths: latest.current.branchLengths ?? true, tipHref: latest.current.tipHref ?? null },
      { ...FALLBACK_THEME, ...(latest.current.theme ?? {}) },
    );
    rendRef.current = r;
    setGen((g) => g + 1);
    // a menu action that replaced the tree removed the focused canvas with the old renderer: give focus to the new one
    if (refocus.current) { refocus.current = false; r.root.focus(); }
    let ready = 0;
    ready = requestAnimationFrame(() => {
      ready = requestAnimationFrame(() => latest.current.onReady?.({ layoutMs: r.layout.layoutMs, tips: source.tipCount }));
    });
    return () => {
      cancelAnimationFrame(ready);
      r.destroy();
      rendRef.current = null;
      setTip(null);
      setMenu(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, options.softwareCanvas]);

  const R = rendRef.current;
  useLayoutEffect(() => { R?.setTheme({ ...FALLBACK_THEME, ...(theme ?? {}) }); }, [gen, theme]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    R?.setOptions({
      layout, branchLengths, tipHref,
      ...(o(options.lod) && { lod: options.lod }), ...(o(options.drawBudget) && { drawBudget: options.drawBudget }), ...(o(options.showSummaries) && { showSummaries: options.showSummaries }),
      ...(o(options.overview) && { overview: options.overview }), ...(o(options.labelDensity) && { labelDensity: options.labelDensity }), ...(o(options.rowHeight) && { rowHeight: options.rowHeight }),
      ...(o(options.axis) && { axis: options.axis }), ...(o(options.italicLabels) && { italicLabels: options.italicLabels }), ...(o(options.minCladePx) && { minCladePx: options.minCladePx }),
      ...(o(options.formatLabel) && { formatLabel: options.formatLabel }), ...(o(options.ariaLabel) && { ariaLabel: options.ariaLabel }),
      ...(o(options.dprCap) && { dprCap: options.dprCap }), ...(o(options.radialMaxNodes) && { radialMaxNodes: options.radialMaxNodes }), ...(o(options.interactionLOD) && { interactionLOD: options.interactionLOD }), ...(o(options.refineMs) && { refineMs: options.refineMs }), ...(o(options.summaryNotice) && { summaryNotice: options.summaryNotice }),
    });
  }, [gen, layout, branchLengths, tipHref, options.lod, options.drawBudget, options.showSummaries, options.overview, options.labelDensity, options.rowHeight, options.axis, options.italicLabels, options.minCladePx, options.formatLabel, options.ariaLabel, options.dprCap, options.radialMaxNodes, options.interactionLOD, options.refineMs, options.summaryNotice]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    R?.setClades((clades ?? []).map((c) => ({ node: nodeIndexOf(source.nodeCount, c.nodeId), colour: c.colour })).filter((c) => c.node >= 0));
  }, [gen, clades]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { R?.setHighlighted(highlighted ?? []); }, [gen, highlighted]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { R?.setColumns(columns ?? []); }, [gen, columns]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { if (viewport) R?.setViewport(viewport); }, [gen, viewport?.x0, viewport?.x1, viewport?.y0, viewport?.y1]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!focus) return;
    const n = source.snapshot().tipIndex(focus.tipId);
    if (n >= 0) R?.focusTip(source.snapshot().tipRank[n]);
  }, [gen, focus?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    fit: () => rendRef.current?.fit(true),
    focusTip: (id) => { const n = source.snapshot().tipIndex(id); if (n >= 0) rendRef.current?.focusTip(source.snapshot().tipRank[n], true); },
    zoomToNode: (id) => { const k = nodeIndexOf(source.nodeCount, id); if (k >= 0) rendRef.current?.zoomToNode(k, true); },
    getViewport: () => rendRef.current!.getViewport(),
    setViewport: (v) => rendRef.current?.setViewport(v),
    locateTip: (id) => { const n = source.snapshot().tipIndex(id); return n < 0 ? null : rendRef.current?.locateNode(n) ?? null; },
    locateNode: (id) => { const k = nodeIndexOf(source.nodeCount, id); return k < 0 ? null : rendRef.current?.locateNode(k) ?? null; },
    nodeBounds: (id) => { const k = nodeIndexOf(source.nodeCount, id); return k < 0 ? null : rendRef.current?.nodeBounds(k) ?? null; },
    columnCell: (c, id) => { const n = source.snapshot().tipIndex(id); return n < 0 ? null : rendRef.current?.columnCell(c, source.snapshot().tipRank[n]) ?? null; },
    getStats: () => rendRef.current!.getStats(),
    benchmark: (n) => rendRef.current!.benchmark(n),
    renderer: () => rendRef.current,
  }), [source]);

  // node menu: focus the first item on open; close on Escape, outside pointer, or after an action (focus back to the canvas)
  const closeMenu = (refocus: boolean) => {
    setMenu(null);
    if (refocus) rendRef.current?.root.focus();
  };
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    const down = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null); };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, [menu]);
  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return closeMenu(true); }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const btns = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
    const k = btns.indexOf(document.activeElement as HTMLButtonElement);
    btns[(k + (e.key === 'ArrowDown' ? 1 : btns.length - 1)) % btns.length]?.focus();
  };

  // keep the tooltip fresh only while hovering
  useEffect(() => { if (!tooltip) setTip(null); }, [tooltip]);

  const nodeLabel = (node: number): string => { const t = source.snapshot(); return t.labels[t.toLocal(node)] ?? ''; };
  const defaultTip = (e: TreeNodeEvent) => (
    <>
      <div style={{ fontStyle: e.isTip ? 'italic' : 'normal', fontWeight: 600 }}>{e.isTip ? (options.formatLabel ?? ((s: string) => s.replace(/_/g, ' ')))(e.tipId ?? '') : e.run ? runText(e) : e.kind === 'summary' ? `Collapsed clade, ${e.tipCount} tips` : `Clade, ${e.tipCount} tips`}</div>
      {!e.isTip && (e.run ? <div>under {nodeLabel(e.node) || 'an unnamed node'}</div> : nodeLabel(e.node) && <div>{nodeLabel(e.node)}</div>)}
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
      {menu && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={menu.ev.isTip ? `Actions for tip ${menu.ev.tipId ?? ''}` : `Actions for clade of ${menu.ev.tipCount} tips`}
          data-treeview-menu=""
          onKeyDown={onMenuKey}
          onBlur={(e) => { if (!menuRef.current?.contains(e.relatedTarget as Node | null)) setMenu(null); }}
          style={{ position: 'absolute', left: Math.max(4, Math.min(menu.x + 6, (wrapRef.current?.clientWidth ?? 0) - 244)), top: Math.max(4, Math.min(menu.y + 6, (wrapRef.current?.clientHeight ?? 0) - 40 - 44 * menu.items.length)), zIndex: 7, width: 240, boxSizing: 'border-box', padding: 4, borderRadius: 6, background: theme?.background ?? FALLBACK_THEME.background, color: theme?.foreground ?? FALLBACK_THEME.foreground, border: `1px solid ${theme?.muted ?? FALLBACK_THEME.muted}`, boxShadow: '0 4px 16px rgba(0,0,0,.18)', fontFamily: theme?.fontFamily ?? FALLBACK_THEME.fontFamily, fontSize: 13 }}
        >
          <div aria-hidden="true" style={{ padding: '4px 8px 6px', fontWeight: 600, fontStyle: menu.ev.isTip ? 'italic' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {menu.ev.isTip ? (options.formatLabel ?? ((s: string) => s.replace(/_/g, ' ')))(menu.ev.tipId ?? '') : nodeLabel(menu.ev.node) || `Clade, ${menu.ev.tipCount.toLocaleString('en')} tips`}
          </div>
          {menu.items.map((it) => (
            <button
              key={it.id}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              title={it.hint}
              data-action={it.id}
              onClick={() => {
                refocus.current = true;
                closeMenu(true);
                it.onSelect();
                requestAnimationFrame(() => { refocus.current = false; }); // the remount, if any, happened in this task
              }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', border: 0, borderRadius: 4, background: 'transparent', color: 'inherit', font: 'inherit', cursor: it.disabled ? 'default' : 'pointer', opacity: it.disabled ? 0.45 : 1 }}
              onMouseEnter={(e) => { if (!it.disabled) e.currentTarget.style.background = theme?.dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.05)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              {it.label}
              {it.hint && <span style={{ display: 'block', fontSize: 11, opacity: 0.7 }}>{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

const o = <T,>(v: T | undefined): v is T => v !== undefined;

/** Tooltip headline of a run of small siblings: '6,900 tips in 3,450 clades and 12 single tips'. */
function runText(e: TreeNodeEvent): string {
  const r = e.run!;
  const n = (v: number) => v.toLocaleString('en');
  const parts: string[] = [];
  if (r.clades) parts.push(`${n(r.clades)} ${r.clades === 1 ? 'clade' : 'clades'}`);
  if (r.single) parts.push(`${n(r.single)} single ${r.single === 1 ? 'tip' : 'tips'}`);
  return `${n(e.tipCount)} tips in ${parts.join(' and ')}`;
}
