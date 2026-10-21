// Interfaces of the spike contract (see ../CONTRACT.md). Part 1 is the public test API on
// window.__spike exactly as in CONTRACT.md; part 2 is the adapter interface the app shell uses.
// Erasable TypeScript only (no enums, no parameter properties) so Node can import these files
// with type stripping (the runner does that for ground truth).

import type { ComponentType, MutableRefObject } from 'react';
import type { TreeModel } from './tree.ts';

// ---------------------------------------------------------------- part 1: window.__spike

export type Layout = 'rectangular' | 'radial';
export type Capability = 'yes' | 'partial' | 'no';

export interface MountOptions {
  treeId: string; // key in trees.json
  newick: string; // already fetched text
  layout: Layout;
  branchLengths: boolean; // phylogram (true) or cladogram (false)
  size: { width: number; height: number }; // CSS px of the container the tree must fill
}

export interface MountResult {
  parseMs: number; // time to parse/convert input inside the candidate (0 if included in firstRenderMs; say which in notes)
  firstRenderMs: number; // from the shell handing the input to the adapter to the first painted frame (two rAFs after done)
  tips: number; // tips the library reports/draws (checked against expected)
  notes?: string;
  /** Additive (see CONTRACT.md "Clarifications"): time the shell spent building the shared TreeModel before the clock started. */
  sharedParseMs?: number;
}

export interface Point {
  x: number;
  y: number;
} // client (viewport) CSS px
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpikeEvent {
  type: 'tipClick' | 'nodeClick' | 'branchClick' | 'tipHover' | 'nodeHover';
  nodeId: string; // shared id (tip: use tip's node id)
  isTip: boolean;
  tipIds: string[]; // descendant tips reported for the target (for a tip: [tipId])
  source: 'library' | 'adapter-derived'; // was tipIds in the library payload, or computed by us from the tree?
  libraryPayload?: unknown; // raw payload, trimmed (for debugging)
  t: number; // performance.now()
}

/** Optional `candidate.columnKinds`: the column kinds the library can draw (default all). S7 tests with the best supported kind and records it. */
export interface ColumnSpec {
  id: string;
  kind: 'bar' | 'text' | 'alignment';
  header: string;
  values: Record<string, number | string>; // by tip id; alignment: aligned sequence string per tip
  width: number; // CSS px
}

export interface SpikeApi {
  candidate: { name: string; version: string; license: string; notes?: string; columnKinds?: ('bar' | 'text' | 'alignment')[] };
  ready: Promise<void>;

  mount(o: MountOptions): Promise<MountResult>;
  unmount(): Promise<void>;

  setColouredClades(c: { nodeId: string; colour: string }[]): Promise<void>;
  highlightTips(tipIds: string[]): Promise<void>;
  focusTip(tipId: string): Promise<void>;
  setLayout(l: Layout): Promise<void>;
  setBranchLengths(on: boolean): Promise<void>;
  setColumns(cols: ColumnSpec[]): Promise<void>;
  setTheme(t: ThemeSpec): Promise<void>;
  setTipLinks(href: ((tipId: string) => string) | null): Promise<void>;

  locate(t: { kind: 'tip' | 'node'; id: string }): Promise<Point | null>;
  bounds(t: { kind: 'tip' | 'node'; id: string }): Promise<Rect | null>;
  locateCell(colId: string, tipId: string): Promise<Rect | null>;
  getEvents(): Promise<SpikeEvent[]>;
  clearEvents(): Promise<void>;
  getCapabilities(): Promise<Record<string, { level: Capability; how: string }>>;
  getStats(): Promise<{ domNodes: number; svgElements: number; canvases: number; custom?: Record<string, number> }>;
}

/**
 * Theme request. `dark` switches the light/dark palette. `tokens` is a free-form map; the runner only ever
 * passes the keys listed in TOKEN_KEYS (colour values as CSS colours, fontFamily as a CSS font stack).
 * Adapters map them onto whatever the library exposes (CSS variables, props, style callbacks).
 */
export interface ThemeSpec {
  dark: boolean;
  tokens?: Record<string, string>;
}
export const TOKEN_KEYS = ['background', 'foreground', 'branch', 'highlight', 'fontFamily'] as const;

/** Capability keys every adapter must report (CONTRACT.md). */
export const CAPABILITY_KEYS = [
  'tipClick',
  'internalNodeClick',
  'branchClick',
  'hover',
  'descendantTipsInPayload',
  'cladeColouring',
  'highlightTip',
  'focusTip',
  'tipAsLink',
  'customColumns',
  'alignmentColumn',
  'radialLayout',
  'branchLengthToggle',
  'scaleBar',
  'darkTheme',
  'cssTokens',
  'multipleInstances',
  'cleanUnmount',
  'controlledState',
  'zoomToFit',
  'overviewOrMinimap',
] as const;
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];
export type CapabilityReport = Record<string, { level: Capability; how: string }>;

// ---------------------------------------------------------------- part 2: adapter interface

/** What a View passes to `emit`; the shell adds `t` and stores/publishes the event. */
export type EmitEvent = Omit<SpikeEvent, 't'>;

export interface ColouredClade {
  nodeId: string;
  colour: string;
}

/** Request to centre a tip. `seq` increases on every call so repeated requests for the same tip still fire. */
export interface FocusRequest {
  tipId: string;
  seq: number;
}

/** Read-only introspection a View exposes through `handleRef`. All coordinates are client (viewport) CSS px. */
export interface ViewHandle {
  locate(t: { kind: 'tip' | 'node'; id: string }): Point | null;
  bounds(t: { kind: 'tip' | 'node'; id: string }): Rect | null;
  locateCell(colId: string, tipId: string): Rect | null;
  /** Extra counters merged into getStats().custom (for example visible rows, drawn nodes). */
  custom?(): Record<string, number>;
}

export interface ViewProps {
  instanceId: number; // 0 = primary container, 1 = secondary (S13)
  treeId: string;
  newick: string; // clean Newick text (Nexus is converted by data.ts)
  tree: TreeModel; // shared ground-truth model, for id mapping and adapter-derived tip sets
  sharedParseMs: number; // how long the shell took to build `tree`
  layout: Layout;
  branchLengths: boolean;
  size: { width: number; height: number }; // the container (already sized by the shell); the View fills 100% of it
  colouredClades: ColouredClade[];
  highlightedTips: string[];
  focusRequest: FocusRequest | null;
  columns: ColumnSpec[];
  theme: ThemeSpec;
  tipLinks: ((tipId: string) => string) | null;
  /** Report a user interaction. Must be called from the library's own callback. */
  emit(e: EmitEvent): void;
  /**
   * Call once when the library has parsed/converted the input and issued its first render.
   * The shell waits two animation frames after this call and then resolves mount().
   */
  onReady(r: { parseMs: number; tips: number; notes?: string }): void;
  /** Assign the introspection handle here (and null on unmount). */
  handleRef: MutableRefObject<ViewHandle | null>;
  /** Current values of the adapter's own `features` (the "Library options" card); keys are feature ids. */
  features: FeatureValues;
}

/** An extra control a candidate adds to the demo's "Library options" card (for example 'show support values'). */
export interface AdapterFeature {
  id: string;
  label: string;
  kind: 'toggle' | 'select';
  default: boolean | string;
  options?: { value: string; label: string }[]; // for kind 'select'
  description?: string;
  /** Optional: `no` disables the control and shows `how` as its reason; `partial` adds a badge. */
  level?: Capability;
  how?: string;
}
export type FeatureValues = Record<string, boolean | string>;

/** The parts of a candidate's spike.json the demo shows (see CONTRACT.md, Deployment metadata). */
export interface SpikeInfo {
  title?: string;
  library?: string;
  version?: string;
  license?: string;
  description?: string;
  repo?: string;
  demo?: string;
  demoLabel?: string; // label of the hub card's link to the candidate's standalone page (/<candidate>/demo), if it builds one
  docs?: string;
  rendering?: string;
  styling?: { applied?: string[]; not_possible?: string[]; notes?: string };
}

/**
 * What a candidate hands to mountShell(). A candidate is "a React component (View) plus facts about it".
 * Everything the test API does is routed through React props of the View.
 */
export interface CandidateAdapter {
  candidate: SpikeApi['candidate'];
  /** Self-reported capabilities; every key in CAPABILITY_KEYS must be present. */
  capabilities: CapabilityReport | (() => CapabilityReport | Promise<CapabilityReport>);
  View: ComponentType<ViewProps>;
  /** Optional: resolves when the library (workers, wasm, fonts) is ready. */
  ready?: Promise<void>;
  /** Optional: candidate-specific toggles and selects for the demo's "Library options" card. */
  features?: AdapterFeature[];
  /** Optional: import the candidate's spike.json and pass it here (library facts card). */
  spike?: SpikeInfo;
}

// ---------------------------------------------------------------- catalogue

export type TreeFormat = 'newick' | 'nexus';
export type TreeGroup = 'smoke' | 'ladder' | 'worst' | 'real' | 'cols' | 'align' | 'dated' | 'edge' | 'huge';

export interface ColumnSource {
  id: string;
  kind: 'bar' | 'text' | 'alignment';
  header: string;
  width: number;
  source: 'tsv' | 'fasta';
  field?: string; // tsv column name
}

export interface TreeEntry {
  id: string;
  label: string;
  path: string; // under data/, served at /data/<path>; or an absolute https URL (remote copy, needs CORS)
  format: TreeFormat;
  tips: number; // expected tip count (checked by runner/check-catalogue.mjs and by every run)
  hasLengths: boolean;
  ultrametric?: boolean;
  groups: TreeGroup[];
  licence?: string;
  treeIndex?: number; // nexus: which tree of a multi-tree file (default 0)
  meta?: string; // tip metadata TSV, path under data/ (key column: tsvKey)
  tsvKey?: string; // TSV column holding the tip label
  align?: string; // aligned FASTA, path under data/ (ids = tip labels)
  columns?: ColumnSource[]; // how meta / align become ColumnSpecs
  /** Not committed and not required: absent files are skipped by check-catalogue and the site build, and shown disabled in the demo. */
  optional?: boolean;
  notes?: string;
}
