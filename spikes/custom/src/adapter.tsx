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
        return { layoutMs: s.layoutMs, frameMs: s.frameMs, cutMs: s.cutMs, drawMs: s.drawMs, avgFrameMs: s.avgFrameMs, drawn: s.drawn, summaries: s.summaries, tipsDrawn: s.tips, labels: s.labels, visited: s.visited, minPxUsed: s.minPxUsed, budgetRetries: s.budgetRetries, budgetHit: s.budgetHit ? 1 : 0, frames: s.frames, hitBuildMs: s.hitBuildMs, kx: s.kx, ky: s.ky };
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

  return (
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
      onReady={({ layoutMs }) =>
        props.onReady({
          parseMs: 0,
          tips: tree.tipCount,
          notes: `tree parsed by the shell (sharedParseMs=${props.sharedParseMs.toFixed(1)}); layout (3 O(n) passes into typed arrays) ${layoutMs.toFixed(1)} ms is part of firstRenderMs`,
        })
      }
    />
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

const features: AdapterFeature[] = [
  { id: 'lod', label: 'Level of detail (collapse small clades, cull)', kind: 'toggle', default: true, description: 'Off draws every visible node (can be very slow above about 50k tips).' },
  { id: 'budget', label: 'Draw budget per frame', kind: 'select', default: '20000', options: [{ value: '2000', label: '2,000 primitives' }, { value: '20000', label: '20,000 primitives' }, { value: '100000', label: '100,000 primitives' }, { value: '400000', label: '400,000 primitives' }], description: 'If the cut exceeds it, the collapse threshold is doubled until it fits.' },
  { id: 'summaries', label: 'Show collapsed clades as triangles', kind: 'toggle', default: true },
  { id: 'overview', label: 'Show overview strip', kind: 'toggle', default: true },
  { id: 'density', label: 'Label density', kind: 'select', default: 'normal', options: [{ value: 'sparse', label: 'Sparse (rows >= 16 px)' }, { value: 'normal', label: 'Normal (rows >= 11 px)' }, { value: 'dense', label: 'Dense (rows >= 8 px)' }] },
  { id: 'rowHeight', label: 'Row height', kind: 'select', default: 'fit', options: [{ value: 'fit', label: 'Fit all tips' }, { value: '6', label: '6 px (scroll)' }, { value: '12', label: '12 px (scroll)' }, { value: '24', label: '24 px (scroll)' }] },
  { id: 'axis', label: 'Scale bar / time axis', kind: 'toggle', default: true },
  { id: 'cpuCanvas', label: 'CPU-backed canvas (willReadFrequently)', kind: 'toggle', default: true, description: 'Headless Chromium has no GPU: an accelerated canvas then runs through SwiftShader and is far slower than CPU raster. On a real GPU try it off.' },
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
