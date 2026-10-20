// Adapter between the harness (shared/app-shell.tsx) and the custom renderer. All the renderer lives in
// ./core (no React) and ./react/TreeView.tsx; this file only maps harness props to <TreeView> props, turns
// its callbacks into harness events and answers the introspection calls.

import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { AdapterFeature, CandidateAdapter, CapabilityReport, ThemeSpec, ViewHandle, ViewProps } from '../../shared/types.ts';
import { gbifDarkTheme, gbifTheme } from '../../shared/gbif-theme.ts';
import { TreeView, type TreeNodeEvent, type TreeViewHandle } from './react/TreeView.tsx';
import type { LabelDensity, TreeTheme } from './core/types.ts';

/** GBIF tokens -> renderer theme. Runner tokens (background, foreground, branch, highlight, fontFamily) override. */
function buildTheme(t: ThemeSpec): TreeTheme {
  const g = t.dark ? gbifDarkTheme() : gbifTheme();
  const k = t.tokens ?? {};
  return {
    dark: t.dark,
    background: k.background ?? g.bg1,
    foreground: k.foreground ?? g.fg1,
    muted: t.dark ? g.slate400 : g.fg3,
    branch: k.branch ?? (t.dark ? g.fg3 : g.fg2),
    highlight: k.highlight ?? g.primary,
    summary: t.dark ? g.slate400 : g.slate400,
    fontFamily: k.fontFamily ?? g.fontBody,
    categorical: g.categorical,
  };
}

function CustomView(props: ViewProps) {
  const { tree, layout, branchLengths, size, columns, theme, tipLinks, emit, features, colouredClades, highlightedTips, focusRequest } = props;
  const ref = useRef<TreeViewHandle>(null);
  const th = useMemo(() => buildTheme(theme), [theme]);
  const options = useMemo(
    () => ({
      lod: features.lod !== false,
      drawBudget: Number(features.budget ?? 20000),
      showSummaries: features.summaries !== false,
      overview: features.overview !== false,
      labelDensity: (features.density as LabelDensity) ?? 'normal',
      rowHeight: features.rowHeight === undefined || features.rowHeight === 'fit' ? null : Number(features.rowHeight),
      axis: features.axis !== false,
      softwareCanvas: features.cpuCanvas !== false,
      dprCap: features.dprCap === 'native' ? Infinity : Number(features.dprCap ?? 2),
      radialMaxNodes: features.radialMax === 'unlimited' ? Infinity : Number(features.radialMax ?? 2000),
      interactionLOD: features.interactionLOD !== false,
      ariaLabel: `Phylogenetic tree, ${tree.tipCount} tips (custom Canvas2D renderer)`,
    }),
    [features, tree],
  );

  const evt = (e: TreeNodeEvent, hover: boolean) => {
    const type = e.isTip ? (hover ? 'tipHover' : 'tipClick') : hover ? 'nodeHover' : e.kind === 'branch' ? 'branchClick' : 'nodeClick';
    emit({
      type,
      nodeId: e.nodeId,
      isTip: e.isTip,
      tipIds: e.isTip ? [e.tipId as string] : e.tipIds(),
      // the descendant set is the leaf-contiguous range of the shared TreeModel (preorder layout), O(1) to find and
      // a slice to materialise; reported as adapter-derived because the data model is ours, not a library payload
      source: 'adapter-derived',
      libraryPayload: { kind: e.kind, via: e.via, tipRange: e.tipRange, tipCount: e.tipCount },
    });
  };

  useLayoutEffect(() => {
    const h = (): TreeViewHandle | null => ref.current;
    const idOf = (t: { kind: 'tip' | 'node'; id: string }): string | null => (t.kind === 'tip' ? tree.tipNodeId(t.id) : tree.isNodeId(t.id) ? t.id : null);
    const handle: ViewHandle = {
      locate: (t) => {
        const id = idOf(t);
        return id ? h()?.locateNode(id) ?? null : null;
      },
      bounds: (t) => {
        const id = idOf(t);
        return id ? h()?.nodeBounds(id) ?? null : null;
      },
      locateCell: (colId, tipId) => h()?.columnCell(colId, tipId) ?? null,
      custom: (): Record<string, number> => {
        const s = h()?.getStats();
        if (!s) return {};
        return { layoutMs: s.layoutMs, frameMs: s.frameMs, cutMs: s.cutMs, drawMs: s.drawMs, avgFrameMs: s.avgFrameMs, drawn: s.drawn, summaries: s.summaries, tipsDrawn: s.tips, labels: s.labels, visited: s.visited, minPxUsed: s.minPxUsed, budgetRetries: s.budgetRetries, budgetHit: s.budgetHit ? 1 : 0, frames: s.frames, hitBuildMs: s.hitBuildMs, kx: s.kx, ky: s.ky, budget: s.budget, forced: s.forced, summaryTips: s.summaryTips, mergedTips: s.mergedTips, reduced: s.reduced ? 1 : 0, scale: s.scale };
      },
    };
    props.handleRef.current = handle;
    // debug hook for the benchmark scripts (instance 0 only); not part of the component API
    const w = window as unknown as Record<string, unknown>;
    if (props.instanceId === 0) w.__customTree = { bench: (n: number) => h()?.benchmark(n), stats: () => h()?.getStats(), handle: () => h() };
    return () => {
      props.handleRef.current = null;
      if (props.instanceId === 0) delete w.__customTree;
    };
  });

  // Frame-time readout (feature 'frameReadout'): JS = cut + draw of the last frame; paint = from the start of that
  // frame to just after the browser has painted it (rAF + 0 ms timeout), which includes raster and compositing;
  // fps = rate over the last second while frames are being drawn. Written straight to the DOM, no React render.
  const readoutRef = useRef<HTMLDivElement>(null);
  const meter = useRef({ times: [] as number[], paint: 0, js: 0, drawn: 0, last: 0 });
  const onFrame = (st: { frameMs: number; drawn: number }) => {
    const m = meter.current;
    const end = performance.now();
    m.js = st.frameMs; m.drawn = st.drawn;
    const start = end - st.frameMs;
    m.times.push(end);
    while (m.times.length && end - m.times[0] > 1000) m.times.shift();
    requestAnimationFrame(() => setTimeout(() => {
      m.paint = performance.now() - start;
      const el = readoutRef.current;
      if (!el) return;
      const active = performance.now() - m.times[m.times.length - 1] < 1000;
      const fps = m.times.length > 1 ? ((m.times.length - 1) * 1000) / (m.times[m.times.length - 1] - m.times[0]) : 0;
      el.textContent = `JS ${m.js.toFixed(1)} ms · paint ${m.paint.toFixed(0)} ms${active && fps ? ` · ${fps.toFixed(0)} fps` : ''} · ${m.drawn.toLocaleString()} drawn`;
    }, 0));
  };

  const view = (
    <TreeView
      ref={ref}
      tree={tree}
      layout={layout}
      branchLengths={branchLengths}
      clades={colouredClades}
      highlighted={highlightedTips}
      columns={columns}
      theme={th}
      tipHref={tipLinks}
      focus={focusRequest}
      options={options}
      tooltip={features.tooltip !== false}
      width={size.width}
      height={size.height}
      onTipClick={(e) => evt(e, false)}
      onNodeClick={(e) => evt(e, false)}
      onHover={(e) => e && evt(e, true)}
      onFrame={features.frameReadout === false ? undefined : onFrame}
      onReady={({ layoutMs }) =>
        props.onReady({
          parseMs: 0,
          tips: tree.tipCount,
          notes: `tree parsed by the shell (sharedParseMs=${props.sharedParseMs.toFixed(1)}); layout (3 O(n) passes into typed arrays) ${layoutMs.toFixed(1)} ms is part of firstRenderMs`,
        })
      }
    />
  );
  if (features.frameReadout === false) return view;
  return (
    <div style={{ position: 'relative', width: size.width, height: size.height }}>
      {view}
      <div ref={readoutRef} aria-hidden="true" style={{ position: 'absolute', right: 8, bottom: 8, zIndex: 6, padding: '2px 8px', borderRadius: 6, font: '11px/1.5 ui-monospace, monospace', background: 'rgba(15,23,42,.72)', color: '#fff', pointerEvents: 'none' }}>frame time: move or zoom</div>
    </div>
  );
}

const capabilities: CapabilityReport = {
  tipClick: { level: 'yes', how: 'pointer hit-test against the frame draw list through a uniform-grid spatial index (tip dot, or the label text box); also Enter on the keyboard cursor' },
  internalNodeClick: { level: 'yes', how: 'internal node markers (clades >= 7 px) and collapsed clade triangles are hit-tested; clicking a collapsed clade reports the clade root' },
  branchClick: { level: 'yes', how: 'distance to the branch segment (4 px slop): the horizontal branch above a node or the vertical connector of the clade; reported as branchClick with the clade below' },
  hover: { level: 'yes', how: 'pointer move is hit-tested once per animation frame; tipHover/nodeHover are emitted when the target changes; built-in tooltip near the cursor and a ring on a separate canvas' },
  descendantTipsInPayload: { level: 'yes', how: 'every event carries the descendant tips as the leaf-contiguous range of the preorder TreeModel (O(1) range lookup, then a slice); reported as source=adapter-derived because the data model is our own, not a library payload' },
  cladeColouring: { level: 'yes', how: 'colour classes per node index from React state (nested clades: later wins); branches, collapsed triangles, markers and tip labels take the class colour; one canvas redraw, no re-layout' },
  highlightTip: { level: 'yes', how: 'translucent row band across tree and columns, ring on the tip, bold primary-coloured label, ticks in the overview strip' },
  focusTip: { level: 'yes', how: 'rows set to at least 26 px and the tip centred; the x window moves only if the tip is outside it. Instant when requested through props; animated (220 ms) from the imperative handle' },
  tipAsLink: { level: 'yes', how: 'real <a href data-tip-id target=_blank rel=noopener> elements positioned over the canvas text for the rows that have labels (visible rows only, <= 600 DOM nodes), keyboard focusable; rows too small for labels have no anchor (a visually hidden list of the tips in view stands in for them)' },
  customColumns: { level: 'yes', how: 'bar (log scale), text and alignment columns drawn on the canvas, pinned to the right edge, windowed to visible rows with header; below 1 px per row bars are binned per pixel row (mean)' },
  alignmentColumn: { level: 'yes', how: 'whole alignment rasterised once into an offscreen bitmap (1 px per residue), only visible rows are blitted; > 8M residues falls back to runs for visible rows' },
  radialLayout: { level: 'yes', how: 'angle from tip rank, radius from root distance, same layout arrays as rectangular; LOD, culling (sector bounding boxes), hit-testing, labels, overview all work in radial; columns are not drawn in radial' },
  branchLengthToggle: { level: 'yes', how: 'phylogram (cumulative length, negative and missing lengths count as 0) versus cladogram (tips aligned); layout recomputed in O(n) and cached for both' },
  scaleBar: { level: 'yes', how: 'distance axis with round ticks for phylograms (rectangular), a time-before-tips axis with gridlines when the tree is ultrametric (dated), a round-length scale bar in radial' },
  darkTheme: { level: 'yes', how: 'gbifDarkTheme() values (derived from tokens; GBIF defines no dark set) passed as the renderer theme; canvases redraw' },
  cssTokens: { level: 'yes', how: 'theme object resolved from gbifTheme() (canvas cannot read CSS variables); runner tokens background, foreground, branch, highlight, fontFamily override' },
  multipleInstances: { level: 'yes', how: 'no module state except a text-width cache keyed by font; each instance owns its renderer, DOM and canvases' },
  cleanUnmount: { level: 'yes', how: 'destroy(): rAF cancelled, ResizeObserver disconnected, window pointer and font listeners removed, canvases resized to 0, DOM removed' },
  controlledState: { level: 'yes', how: 'clades, highlighted tips, columns, layout, lengths, theme, tip links and an optional viewport are props; viewport changes come back through onViewportChange (once per frame)' },
  zoomToFit: { level: 'yes', how: 'fits on mount and on layout/length/column changes while the view has not been touched; fit() from the handle, key 0 and double click on empty space; wheel zoom-out stops at 1.6x the tree' },
  overviewOrMinimap: { level: 'yes', how: 'overview strip (rectangular, aligned with the rows) or a small disc (radial) drawn once from the LOD cut at fit, with a draggable viewport rectangle; click or drag to move' },
};

/** CPU canvas default: automation (navigator.webdriver, the runner) keeps the CPU canvas because headless Chromium has no GPU and
 *  an accelerated canvas there runs through SwiftShader, 3 to 10 times slower; real visitors get the GPU canvas. ?cpu=1|0 overrides. */
const CPU_DEFAULT: boolean = (() => {
  try {
    const q = new URLSearchParams(window.location.search).get('cpu');
    if (q === '1') return true;
    if (q === '0') return false;
    return navigator.webdriver === true;
  } catch {
    return false;
  }
})();

const features: AdapterFeature[] = [
  { id: 'lod', label: 'Level of detail (collapse small clades, cull)', kind: 'toggle', default: true, description: 'Off draws every visible node (can be very slow above about 50k tips).' },
  { id: 'frameReadout', label: 'Frame-time readout', kind: 'toggle', default: true, description: 'JS time per frame, time until painted (includes raster) and fps while interacting. Useful for reporting numbers from your own device.' },
  { id: 'budget', label: 'Draw budget per frame', kind: 'select', default: '20000', options: [{ value: '500', label: '500 primitives' }, { value: '1000', label: '1,000 primitives' }, { value: '2000', label: '2,000 primitives' }, { value: '20000', label: '20,000 primitives' }, { value: '100000', label: '100,000 primitives' }, { value: '400000', label: '400,000 primitives' }], description: 'If the cut exceeds it, the collapse threshold is doubled until it fits.' },
  { id: 'summaries', label: 'Show collapsed clades as triangles', kind: 'toggle', default: true },
  { id: 'overview', label: 'Show overview strip', kind: 'toggle', default: true },
  { id: 'density', label: 'Label density', kind: 'select', default: 'normal', options: [{ value: 'sparse', label: 'Sparse (rows >= 16 px)' }, { value: 'normal', label: 'Normal (rows >= 11 px)' }, { value: 'dense', label: 'Dense (rows >= 8 px)' }] },
  { id: 'rowHeight', label: 'Row height', kind: 'select', default: 'fit', options: [{ value: 'fit', label: 'Fit all tips' }, { value: '6', label: '6 px (scroll)' }, { value: '12', label: '12 px (scroll)' }, { value: '24', label: '24 px (scroll)' }] },
  { id: 'axis', label: 'Scale bar / time axis', kind: 'toggle', default: true },
  { id: 'cpuCanvas', label: 'CPU-backed canvas (willReadFrequently)', kind: 'toggle', default: CPU_DEFAULT, description: 'Forces software (CPU) rasterisation of the canvas. Off = GPU-accelerated canvas, the right choice on a real browser; it is slow only in headless Chromium without a GPU, where it runs through SwiftShader. Default: on when the browser reports navigator.webdriver (automation, the test runner), off otherwise; ?cpu=1 or ?cpu=0 in the URL overrides. Changing it remounts the canvases.' },
  { id: 'dprCap', label: 'Resolution: device pixel ratio cap', kind: 'select', default: '2', options: [{ value: '1', label: '1 (fastest, soft on retina)' }, { value: '1.5', label: '1.5' }, { value: '2', label: '2 (default)' }, { value: 'native', label: 'Native (3 on some phones)' }], description: 'Canvas backing store is min(devicePixelRatio, cap) times the CSS size. At ratio 2 or 3 the canvas has 4 or 9 times the pixels of ratio 1, which costs raster time on large canvases. Hit-testing and the overlay always use CSS pixels.' },
  { id: 'radialMax', label: 'Max drawn nodes (radial)', kind: 'select', default: '2000', options: [{ value: '500', label: '500' }, { value: '1000', label: '1,000' }, { value: '2000', label: '2,000 (default)' }, { value: '5000', label: '5,000' }, { value: '20000', label: '20,000' }, { value: 'unlimited', label: 'Unlimited (draw budget only)' }], description: 'Radial layout only. If the visible sector holds more primitives than this, the smallest clades are drawn as fans (summaries) until it fits; zooming in reveals them. A note in the corner says when this happens. Rectangular keeps the draw budget above.' },
  { id: 'interactionLOD', label: 'Reduce detail while zooming or dragging', kind: 'toggle', default: true, description: 'During wheel, pinch and drag the draw uses a quarter of the budget (at least 500) and a coarser clade threshold, then one full-quality frame follows 120 ms after the last input. Clicks and hovers always use a full-quality frame.' },
  { id: 'tooltip', label: 'Built-in tooltip at the cursor', kind: 'toggle', default: true },
];

export const adapter: CandidateAdapter = {
  candidate: { name: 'custom', version: '0.1.0', license: 'Apache-2.0', notes: 'Own typed-array model + Canvas2D renderer with viewport level of detail; no tree or rendering library. Core in src/core (no React), component in src/react.' },
  capabilities,
  View: CustomView,
  features,
};

void React;
void useEffect;
