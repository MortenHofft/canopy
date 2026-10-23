// The debug panel's state, out of the page (?debug=1, src/DebugPanel.tsx): the build, a view written down exactly enough to reproduce a
// level-of-detail bug headless, and that view read back from ?view=. A view is the tree, the layout, the canvas size, the viewport and
// every option and theme value the cut and the labels read; it is kept in the URL as base64url JSON (plain JSON is read too).

import type { Viewport, ViewerOptions } from '@gbif-phylo/viewer';

declare const __BUILD__: { commit: string; branch: string; env: string; time: string } | undefined;

/** The build (vite.config.ts defines it from Vercel's variables or git); "dev" when the page was built without the define. */
export const BUILD = typeof __BUILD__ === 'undefined' ? { commit: 'dev', branch: '', env: 'local', time: '' } : __BUILD__;

/** Which tree: one of the list (its id, and its label as the picker shows it), or a file of one's own by its name. */
export type TreeName = { id: string; label: string } | { file: string };

/** The options a view sets again: the cut's (minCladePx, drawBudget, lod, showSummaries, radialMaxNodes, interactionLOD), the labels'
 *  (labelDensity) and the area's (radialOpening, dprCap). `alignLabels` is restored through the explorer's own toggle. */
export const VIEW_OPTIONS = [
  'minCladePx',
  'drawBudget',
  'lod',
  'showSummaries',
  'radialMaxNodes',
  'interactionLOD',
  'labelDensity',
  'radialOpening',
  'dprCap',
] as const;
export type ViewOptions = Partial<Pick<ViewerOptions, (typeof VIEW_OPTIONS)[number]>>;

export interface SavedView {
  /** The build it was copied on. */
  commit: string;
  tree: TreeName;
  layout: 'rectangular' | 'radial';
  branchLengths: boolean;
  /** CSS px of the viewer, the page's devicePixelRatio. */
  canvas: { width: number; height: number; dpr: number };
  viewport: Viewport;
  labelSize: number;
  alignLabels: boolean;
  options: ViewOptions;
  /** For the record only, not restored: the tree area's width ('auto' or the explorer's '40%' with the alignment), the columns shown. */
  treeWidth: ViewerOptions['treeWidth'];
  columns: number;
  /** The collapsed clades, ids of the tree shown. */
  collapsed: number[];
  /** False when the tree shown was not the tree as loaded (an edit, Show only, collapse by support): the restore loads it as loaded. */
  asLoaded: boolean;
}

/** What the page hands the explorer while debugging: the tree shown, and the view to restore with whether it is of that tree. */
export interface DebugInfo {
  tree: TreeName;
  restore: SavedView | null;
  /** The view is of the tree shown, so its viewport and collapsed clades apply; its layout and options apply to any tree. */
  matches: boolean;
  /** Why ?view= could not be read. */
  error: string | null;
}

const toBase64Url = (s: string) => {
  let bin = '';
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

export const viewJson = (v: SavedView) => JSON.stringify(v);
export const encodeView = (v: SavedView) => toBase64Url(viewJson(v));

/** The page's URL that restores `v`: this page with ?debug=1&view=, nothing else of its query. */
export const viewUrl = (v: SavedView) => `${location.origin}${location.pathname}?debug=1&view=${encodeView(v)}`;

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** A ?view= value (base64url or plain JSON) as a view; throws with what is wrong. */
export function decodeView(s: string): SavedView {
  const text = s.trimStart().startsWith('{') ? s : fromBase64Url(s);
  const v = JSON.parse(text) as SavedView;
  const vp = v?.viewport;
  if (!vp || ![vp.x0, vp.x1, vp.y0, vp.y1].every(isNum)) throw new Error('no viewport');
  if (v.layout !== 'rectangular' && v.layout !== 'radial') throw new Error(`layout ${JSON.stringify(v.layout)}`);
  if (!v.tree || !('id' in v.tree || 'file' in v.tree)) throw new Error('no tree');
  return { ...v, options: v.options ?? {}, collapsed: Array.isArray(v.collapsed) ? v.collapsed : [] };
}

/** ?debug=1 shows the panel; ?view= restores a view (and shows it too). */
export function readDebug(params: URLSearchParams): { on: boolean; restore: SavedView | null; error: string | null } {
  const raw = params.get('view');
  if (raw === null) return { on: params.get('debug') === '1', restore: null, error: null };
  try {
    return { on: true, restore: decodeView(raw), error: null };
  } catch (e) {
    return { on: true, restore: null, error: `?view= could not be read: ${(e as Error).message}` };
  }
}

/** Whether `a` and `b` name the same tree: the same id, or files of the same name. */
export const sameTree = (a: TreeName, b: TreeName) => ('id' in a && 'id' in b ? a.id === b.id : 'file' in a && 'file' in b && a.file === b.file);

/** The explorer's starting state from a view to restore (its own defaults without one). `baseLabelSize` is the explorer's label size at
 *  a font scale of 1. Only the options the view gives are set, so the explorer's own stay otherwise. Only for the view's own tree: once
 *  another tree is picked, the explorer's defaults apply again (a restored minCladePx must not follow the user to another tree). */
export function restoredSettings(debug: DebugInfo | undefined, baseLabelSize: number) {
  const v = debug?.matches ? debug.restore : undefined;
  if (!v) return { layout: 'rectangular' as const, phylogram: true, fontScale: 1, alignLabels: false, collapsed: [] as number[], options: {} };
  const options: Record<string, unknown> = {};
  for (const k of VIEW_OPTIONS) if (v.options[k] !== undefined && v.options[k] !== null) options[k] = v.options[k];
  return {
    layout: v.layout,
    phylogram: v.branchLengths !== false,
    fontScale: isNum(v.labelSize) ? v.labelSize / baseLabelSize : 1,
    alignLabels: v.alignLabels === true,
    collapsed: v.asLoaded !== false ? v.collapsed : [], // ids of the tree shown then: only the tree as loaded has them
    options: options as ViewOptions,
  };
}
