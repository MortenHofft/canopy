// Public types of the renderer core. No React, no imports from the harness: `TreeData` is the structural
// subset of shared/tree.ts `TreeModel` that the core reads, so the core could be lifted into its own package
// with any tree model that has preorder ids and leaf-contiguous subtree ranges.

export interface TreeData {
  readonly nodeCount: number;
  readonly tipCount: number;
  readonly parent: Int32Array; // parent[i] < i
  readonly firstChild: Int32Array; // -1 for tips
  readonly nextSibling: Int32Array;
  readonly childCount: Int32Array;
  readonly subtreeEnd: Int32Array; // subtree of i is the index range [i, subtreeEnd[i])
  readonly length: Float64Array; // NaN when missing
  readonly leafStart: Int32Array; // descendant tips of i are the rank range [leafStart[i], leafEnd[i])
  readonly leafEnd: Int32Array;
  readonly tipNode: Int32Array; // rank -> node index
  readonly tipRank: Int32Array; // node index -> rank, -1 for internal nodes
  readonly tipLabels: string[]; // by rank
  readonly labels: string[]; // by node index
  readonly hasLengths: boolean;
  heights(): Int32Array;
  tipIndex(label: string): number; // label -> node index, -1 if absent
}

/** Rollups of a partially loaded tree, one value per snapshot row (all rows, stubs and loaded). The layout takes X, XMAX and ROW
 *  from them instead of from its own passes, because a stub row has no descendants to derive them from. */
export interface RollupData {
  readonly cumLength: Float64Array; // distance from the root, clamped lengths, before normalisation
  readonly maxCum: Float64Array; // largest cumLength in the subtree (XMAX source)
  readonly depth: Int32Array;
  readonly maxDepth: Int32Array; // deepest tip below; cladogram X = 1 - (maxDepth - depth) / maxDepth[0]
  readonly row: Float64Array; // layout row (y) of the node
}

/** What the renderer reads each frame: the tree as typed arrays over the rows that are currently loaded, in preorder, plus the
 *  fields that only a partially loaded tree needs. The in-memory snapshot is a plain TreeData with all three of them null.
 *  `nodeCount` is the number of ROWS of this snapshot (array length); ids in the arrays (parent, subtreeEnd, tipNode) are row
 *  indexes; `tipCount`, `leafStart`, `leafEnd` and `tipRank` are ranks of the FULL tree. */
export interface TreeSnapshot extends TreeData {
  /** 1 = the row stands for a clade whose rows are not loaded: drawn as a triangle from its rollups, never descended into
   *  (subtreeEnd[i] = i + 1, childCount[i] > 0 so it is not taken for a tip). null = no stubs (in memory). */
  readonly stub: Uint8Array | null;
  /** row -> preorder id in the full tree, what the public API and NodeEvent.node speak. null = identity. */
  readonly globalId: Int32Array | null;
  readonly rollup: RollupData | null;
  /** row of a global id, or -1 when that node is not part of the snapshot */
  toLocal(globalId: number): number;
}

export type LayoutKind = 'rectangular' | 'radial';

/** Visible window in layout coordinates. Rectangular: x in [0,1] (root to tips), y in rows (tip rank, 0..tips).
 *  Radial: world units where the root is (0,0) and the outermost tip circle has radius 1. */
export interface Viewport {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface TreeTheme {
  dark: boolean;
  background: string;
  foreground: string; // labels, axis text
  muted: string; // axis lines, gridlines, headers
  branch: string;
  highlight: string; // selection, highlight bands, focus ring
  summary: string; // fill of collapsed clades without own colour
  fontFamily: string;
  categorical: string[];
}

export const FALLBACK_THEME: TreeTheme = {
  dark: false,
  background: '#ffffff',
  foreground: '#162d3d',
  muted: '#6b7c8a',
  branch: '#44576a',
  highlight: '#4c9b45',
  summary: '#9aa7b3',
  fontFamily: 'system-ui, sans-serif',
  categorical: ['#684393', '#5b7ac8', '#c0399c', '#e8845b', '#4aa8d8'],
};

export interface CladeColour {
  node: number; // node index
  colour: string;
}

export type ColumnKind = 'bar' | 'text' | 'alignment';
export interface Column {
  id: string;
  kind: ColumnKind;
  header: string;
  width: number; // CSS px
  values: Record<string, number | string>; // by tip label
}

export type LabelDensity = 'sparse' | 'normal' | 'dense';

export interface RendererOptions {
  layout: LayoutKind;
  branchLengths: boolean;
  lod: boolean; // viewport level of detail: collapse small clades into summaries, dedupe sub-pixel primitives
  drawBudget: number; // max drawn tree primitives per frame; LOD thresholds are raised until the cut fits
  showSummaries: boolean; // draw collapsed clades as triangles (otherwise only their branch is drawn)
  overview: boolean; // overview strip with viewport rectangle
  labelDensity: LabelDensity;
  rowHeight: number | null; // fixed px per tip row at fit (rectangular); null = fit all tips into the height
  axis: boolean; // scale bar / time axis
  italicLabels: boolean;
  minCladePx: number; // collapse clades smaller than this many pixels (either direction)
  /** Alignment columns: 'residues' = coloured cells (one pixel per residue, as before); 'blocks' = ETE-style grey blocks for the
   *  stretches without gaps joined by a thin line (rows at least 1.5 px tall, otherwise residues). */
  alignStyle: 'residues' | 'blocks';
  /** Alignment columns: empty px between neighbouring sequences (rows at least 4 px tall); blocks always keep at least a quarter of the row free. */
  alignRowGap: number;
  formatLabel: (tipId: string) => string;
  tipHref: ((tipId: string) => string) | null;
  ariaLabel: string;
  /** Create the 2D contexts with willReadFrequently (CPU-backed canvas). Read at construction only. */
  softwareCanvas: boolean;
  /** Cap on the canvas backing-store pixel ratio (device pixels per CSS pixel): the canvas is min(devicePixelRatio, dprCap)
   *  times the CSS size. Infinity = native. Hit-testing, overlay and events always use CSS pixels. */
  dprCap: number;
  /** Radial layout only: most primitives (expanded nodes, tips, summary fans) drawn per frame. When the viewport holds more,
   *  the collapse threshold is raised until it fits, so small clades become fans. Infinity = only `drawBudget` applies. */
  radialMaxNodes: number;
  /** While the user wheels, pinches or drags, draw with a quarter of the budget (min 500) and a coarser collapse threshold,
   *  then refine once after `refineMs` without input. Hit-testing always settles to a full-quality frame first. */
  interactionLOD: boolean;
  refineMs: number;
  /** Small notice in the canvas corner when the radial cut-off is summarising clades the normal threshold would show. */
  summaryNotice: boolean;
}

export const DEFAULT_OPTIONS: RendererOptions = {
  layout: 'rectangular',
  branchLengths: true,
  lod: true,
  drawBudget: 20000,
  showSummaries: true,
  overview: true,
  labelDensity: 'normal',
  rowHeight: null,
  axis: true,
  italicLabels: true,
  minCladePx: 3,
  alignStyle: 'residues',
  alignRowGap: 0,
  formatLabel: (s) => s.replace(/_/g, ' '),
  tipHref: null,
  ariaLabel: 'Phylogenetic tree',
  softwareCanvas: false,
  dprCap: 2,
  radialMaxNodes: 2000,
  interactionLOD: true,
  refineMs: 120,
  summaryNotice: true,
};

export type HitKind = 'tip' | 'node' | 'summary' | 'branch';
export interface Hit {
  node: number; // a run: the parent of its members
  kind: HitKind;
  run?: { first: number; last: number }; // a run of small siblings drawn as one slice: first and last member (node indices)
}

export interface NodeEvent {
  node: number; // node index (tip: the tip's node); with a partial source the preorder id in the FULL tree
  isTip: boolean;
  tipId: string | null; // the tip's label when isTip and the label is loaded
  kind: HitKind;
  tipStart: number; // descendant tips are the rank range [tipStart, tipEnd)
  tipEnd: number;
  clientX: number;
  clientY: number;
  via: 'pointer' | 'keyboard';
  /** Set for a run of small siblings drawn as one slice (kind 'summary'): `node` is then their parent, but the tip range is only
   *  the run's, [tipStart, tipEnd), and these are what it holds: clades (with two or more tips) and single tips. */
  run?: { clades: number; single: number };
}

export interface RendererCallbacks {
  onClick?(e: NodeEvent): void;
  onHover?(e: NodeEvent | null): void;
  onViewportChange?(v: Viewport): void;
  onFrame?(s: FrameStats): void;
}

export interface FrameStats {
  frameMs: number; // JS time of the last render() call (cut + draw; raster happens after)
  cutMs: number;
  drawMs: number;
  visited: number; // nodes looked at by the cut
  drawn: number; // primitives in the draw list (expanded nodes, tips, summaries)
  summaries: number;
  tips: number;
  labels: number;
  minPxUsed: number; // effective collapse threshold after the budget rule
  budgetRetries: number; // how many times the threshold had to be raised to fit the budget
  budgetHit: boolean;
  truncated: boolean; // even the highest threshold overflowed (list was cut)
  frames: number; // total frames rendered so far
  budget: number; // primitive budget in force for this frame (radial: the cut-off; reduced while interacting)
  forced: number; // summary fans that the normal threshold would have expanded (clades summarised because of the budget)
  summaryTips: number; // tips inside the drawn summaries
  mergedTips: number; // tips of primitives not emitted because they land on the same pixel cells as an earlier one
  reduced: boolean; // this frame was drawn in reduced (interaction) quality
  scale: number; // canvas backing pixels per CSS pixel (after the dprCap)
}
