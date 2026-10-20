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
  node: number;
  kind: HitKind;
}

export interface NodeEvent {
  node: number; // node index (tip: the tip's node)
  kind: HitKind;
  tipStart: number; // descendant tips are the rank range [tipStart, tipEnd)
  tipEnd: number;
  clientX: number;
  clientY: number;
  via: 'pointer' | 'keyboard';
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
