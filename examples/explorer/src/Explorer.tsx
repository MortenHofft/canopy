// The explorer: the styled showcase of the library. Its look started from Reactree (reactreejs 1.0.3: two toolbar rows over a dotted tree
// pane, an inspector, a floating search, a colour palette, an export menu); it is built only from the public API of @canopy:
// <TreeView> and its handle for the drawing, its props for clades / highlights / collapsed clades / theme / the node menu,
// its callbacks for clicks and hovers, tree-ops for every edit and view (focus) and the viewer's options and controls.
// Which control uses which API is the table in ../README.md.

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TreeModel, toNewick, toNexus, splitInternalLabel } from '@canopy/io';
import * as ops from '@canopy/tree-ops';
import { TreeView, useTreeViewer, type CladeProp, type NodeMenuItem, type TreeNodeEvent, type TreeViewHandle } from '@canopy/react';
import { defaultControls, InMemorySource, internalName, namedDescendants, type CladeLabelFn, type NamedDescendant } from '@canopy/viewer';
import * as I from './icons.tsx';
import * as J from './icons-ours.tsx';
import * as K from './icons-click.tsx';
import { Scroller } from './Scroller.tsx';
import { DebugPanel } from './DebugPanel.tsx';
import { restoredSettings, type DebugInfo } from './debug.ts';

/** What a click on a node or tip does: the node menu (inspect), or one action at once. */
type ClickAction = 'inspect' | 'collapse' | 'subtree' | 'reroot' | 'colour';
const CLICK_ICONS = { inspect: K.IconInspect, collapse: K.IconCollapse, subtree: K.IconSubtree, reroot: K.IconReroot, colour: K.IconColour };
type Layout = 'rectangular' | 'radial';
type NodeLabelMode = 'none' | 'support' | 'length';
type HighlightStyle = 'band' | 'dim' | 'both';
/** Drill-down (tree-ops autoCollapse): the rows of the overview of the clade shown, and of a collapsed clade expanded in place. */
const OVERVIEW_ROWS = 50;
const EXPAND_ROWS = 20;
/** Open Tree's unnamed clades are labelled 'mrcaott99343ott3606205': no name, so they are not named in labels, summaries or the legend. */
const OTL_SYNTHETIC = /^mrcaott\d+ott\d+$/;
const cladeLabel: CladeLabelFn = (node, t) => {
  const name = internalName(t.labels[t.toLocal(node)] ?? '');
  return OTL_SYNTHETIC.test(name) ? null : name;
};
/** How many named descendants a collapsed clade's Info panel lists. */
const INFO_NAMES = 12;

/** Reactree's 12 swatches; the colours themselves are CSS custom properties (--ex-palette-<name>) in explorer.css. */
const PALETTE = ['Red', 'Orange', 'Amber', 'Lime', 'Emerald', 'Teal', 'Sky', 'Indigo', 'Violet', 'Pink', 'Slate', 'Brown'];
const ERASE = 'reset';
/** The colour action steps through the palette by 5 of its 12 swatches, so two clades painted one after the other are far apart. */
const COLOUR_STRIDE = 5;
const TRUNCATE_AT = 30; // Reactree: names longer than 30 characters become 28 plus an ellipsis
const LABEL_SIZE = 11.5; // the tip labels' size at a font scale of 1

interface Step {
  tree: TreeModel;
  clades: CladeProp[];
  collapsed: number[];
  /** The node map of the edit that made this step from the one before it (old tree -> this tree); none for the first. */
  map?: Int32Array;
  /** How many steps before this one were dropped to stay within the memory budget: then `map` is from the tree as published, and
   *  Undo stops here. */
  dropped?: number;
}

/** What the trees kept for Undo may take, the tree as published and the current one aside (#44): about 45 to 60 steps of a 10k-tip tree, two
 *  of the 190k-tip GTDB tree, none of a tree of a million tips, where only Reset is offered. */
const UNDO_BUDGET = 64 * 1024 * 1024;

/** Keeps the steps between the tree as published (`h[0]`) and the current one (the last) within `budget` bytes (tree-ops' treeBytes),
 *  dropping the oldest first. The step after a dropped one takes a map from the tree as published, so Reset still keeps the view. */
function trimHistory(h: Step[], budget: number): Step[] {
  let bytes = 0;
  for (let k = 1; k < h.length - 1; k++) bytes += ops.treeBytes(h[k].tree);
  while (h.length > 2 && bytes > budget) {
    bytes -= ops.treeBytes(h[1].tree);
    h = [h[0], { ...h[2], map: ops.composeMaps(h[1].map!, h[2].map!), dropped: (h[1].dropped ?? 0) + 1 }, ...h.slice(3)];
  }
  return h;
}

/** A note, shown once there is an edit, that says why Undo (Ctrl/Cmd+Z, with no button) is off for the tree or stops at a dropped step. */
function UndoNote(p: { canUndo: boolean; undoOn: boolean }) {
  if (p.canUndo) return null;
  return (
    <>
      <span className="ex-undo-note">
        {p.undoOn ? 'Older steps were dropped to save memory' : 'Undo is off: the tree is too large to keep earlier versions'}
      </span>
      <div className="ex-divider" />
    </>
  );
}

const fmt = (x: number) => x.toFixed(6).replace(/\.?0+$/, '');
const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** A pointer click on the triangle of a collapsed clade expands it (drill-down); a click on its branch, or Enter, opens its menu. */
const expandsOnClick = (e: TreeNodeEvent) => e.collapsed && e.kind === 'summary' && e.via === 'pointer' && !e.run;

/** The selected node (of the tree) in the ids of what is shown: itself, or the nearest ancestor the view keeps (Show only leaves
 *  nodes out; the selection then moves to the clade that holds it, as the viewer's does to a collapsed clade). Null when
 *  nothing is selected or the view shows none of them. */
function shownSelection(selected: number | null, view: { toView: Int32Array } | null, parent: ArrayLike<number>): number | null {
  if (selected === null || !view) return selected;
  const toView = view.toView;
  for (let u = selected; u >= 0 && u < toView.length; u = parent[u]) if (toView[u] >= 0) return toView[u];
  return null;
}

/** Whether the "Scroll to zoom" hint is drawn. The rectangular one shares the bottom-right corner with the viewer's clade legend, so it gives way while that shows. */
function hintShown(gone: boolean, layout: Layout, legendOn: boolean, shownCladeCount: number): boolean {
  return !gone && (layout === 'radial' || !(legendOn && shownCladeCount > 0));
}

type Inside = { names: NamedDescendant[]; more: boolean };
type Snapshot = ReturnType<InMemorySource['snapshot']>;

type HoverFacts = { title: string; support: number | null; length: number | null; tips: number | null; first: string; last: string };

/** At most two decimals, no trailing zeros. */
const twoDecimals = (x: number) => String(Number(x.toFixed(2)));

/** The hover box of a node: a tip's full name, or a clade's (collapsed or open) tips and its first and last tip; both with the support
 *  and the branch length when the tree has them. */
function NodeHoverBox(p: { facts: HoverFacts }) {
  const f = p.facts;
  return (
    <span className="ex-tip ex-tip--node">
      {f.title && <span className="ex-tip-title">{f.title}</span>}
      <dl className="ex-tip-rows">
        {f.tips !== null && (
          <>
            <dt>Tips</dt>
            <dd>{f.tips.toLocaleString('en')}</dd>
          </>
        )}
        {f.support !== null && (
          <>
            <dt>Support</dt>
            <dd>{twoDecimals(f.support)}</dd>
          </>
        )}
        {f.length !== null && (
          <>
            <dt>Branch length</dt>
            <dd>{twoDecimals(f.length)}</dd>
          </>
        )}
        {f.tips !== null && (
          <>
            <dt>First</dt>
            <dd>{f.first}</dd>
            <dt>Last</dt>
            <dd>{f.last}</dd>
          </>
        )}
      </dl>
    </span>
  );
}

/** The Info panel's rows for a clade: its tips and, when it is collapsed, the highest named clades inside it. Nothing for a tip. */
function InfoClade(p: { tips: number | null; inside: Inside | null }) {
  if (p.tips === null) return null;
  return (
    <>
      <dl className="ex-info-rows ex-info-rows--clade">
        <dt>Tips</dt>
        <dd>{p.tips.toLocaleString('en')}</dd>
      </dl>
      {p.inside && p.inside.names.length > 0 && (
        <div className="ex-info-inside">
          <div className="ex-info-inside-head">Named clades inside</div>
          <ul>
            {p.inside.names.map((d) => (
              <li key={d.node}>
                <span>{d.name}</span>
                <span className="ex-info-inside-tips">{d.tips.toLocaleString('en')}</span>
              </li>
            ))}
            {p.inside.more && <li className="ex-info-inside-more">and more</li>}
          </ul>
        </div>
      )}
    </>
  );
}

/** What the Info panel adds for the node `v` of `tree`: its tips (null for a tip) and, when `collapsed` holds it, what is inside it. */
function infoClade(tree: TreeModel, snap: Snapshot, v: number, collapsed: number[], formatLabel: (s: string) => string) {
  if (tree.childCount[v] === 0) return { tips: null, inside: null };
  const inside = collapsed.includes(v) ? namedDescendants(snap, v, { formatLabel, cladeLabel }, { max: INFO_NAMES }) : null;
  return { tips: tree.tipCountOf(v), inside };
}

/** The toast after Collapse to 50 clades, `n` clades collapsed inside the clade shown. */
function collapseMessage(n: number): string {
  if (!n) return 'The clade shown fits open';
  return `Collapsed to ${OVERVIEW_ROWS} rows: the largest clades open, ${n.toLocaleString('en')} collapsed. Click one to expand it`;
}

export function Explorer({
  published,
  defaultHeight = 520,
  undoBudget = UNDO_BUDGET,
  debug,
}: {
  published: TreeModel;
  defaultHeight?: number;
  /** Bytes the trees kept for Undo may take ({@link UNDO_BUDGET}); a tree larger than this has Reset only. */
  undoBudget?: number;
  /** The debug panel (?debug=1) and the view to restore (?view=, src/debug.ts); no panel without it. */
  debug?: DebugInfo;
}) {
  // the starting state: the explorer's defaults, or the view restored
  const [init] = useState(() => restoredSettings(debug, LABEL_SIZE));
  const ref = useRef<TreeViewHandle>(null);
  // the viewer as state, and the theme in force: React follows every theme change, whoever made it
  const viewer = useTreeViewer(ref);
  const outer = useRef<HTMLDivElement>(null);
  const [history, setHistory] = useState<Step[]>([{ tree: published, clades: [], collapsed: [] }]);
  const tree = history[history.length - 1].tree;
  // Undo needs one more tree in memory than Reset: off when even one does not fit; it stops at a step whose earlier steps were dropped
  const undoOn = useMemo(() => ops.treeBytes(published) <= undoBudget, [published, undoBudget]);
  const canUndo = undoOn && history.length > 1 && !history[history.length - 1].dropped;
  // the last change of `tree` and the map it came with (edit: the op's map; undo: its inverse), to keep the view across it
  const [move, setMove] = useState<{ from: TreeModel; to: TreeModel; map: Int32Array } | null>(null);
  const [clades, setClades] = useState<CladeProp[]>([]);
  const [collapsed, setCollapsed] = useState<number[]>(init.collapsed); // clades the user collapsed (ids of `tree`)
  const [focus, setFocus] = useState<ops.Focus>(ops.NO_FOCUS); // the clade shown alone, with Reset and Up one level (tree-ops focus)
  const [highlightStyle, setHighlightStyle] = useState<HighlightStyle>('dim');
  const [showOverview, setShowOverview] = useState(false);
  // the "Scroll to zoom · Drag to pan" hint goes for good once the user zooms or pans (a wheel turn, a drag or pinch, a zoom or arrow key);
  // a click does not count, and a new tree or layout does not bring it back
  const [hintGone, setHintGone] = useState(false);
  const dismissHint = () => setHintGone(true);
  const dragFrom = useRef<{ x: number; y: number } | null>(null); // where a drag in the pane began (not on the resize grip)
  const [showLegend, setShowLegend] = useState(true); // the clade legend: hidden by itself while no clade is coloured

  const [layout, setLayout] = useState<Layout>(init.layout);
  const [phylogram, setPhylogram] = useState(init.phylogram);
  const drawsLengths = phylogram && tree.hasLengths; // a tree without branch lengths is a cladogram, whatever was asked
  const [truncate, setTruncate] = useState(true);
  const [labelMode, setLabelMode] = useState<NodeLabelMode>('none');
  const [alignLabels, setAlignLabels] = useState(init.alignLabels);

  const [clickAction, setClickAction] = useState<ClickAction>('inspect');
  const colourStep = useRef(0); // the colour action's place in the palette
  const [showTooltips, setShowTooltips] = useState(true); // the hover box on the tree
  const [pickAt, setPick] = useState<{ node: number; x: number; y: number } | null>(null); // the node (of `tree`) the menu's Colour… is for, and where the palette opens (px in the component)
  const pick = pickAt?.node ?? null;

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matchIdx, setMatchIdx] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);

  // the selected node (of `tree`): the viewer's selection (a click selects, Info opens the inspector on it). It stays across layout and
  // tree type switches, which keep the view where it was rather than going to it; an edit, Undo or a navigation clears it
  const [selected, setSelected] = useState<number | null>(null);
  const [infoOpen, setInfoOpen] = useState(false); // the inspector shows `selected`
  const deselect = () => {
    setSelected(null);
    setInfoOpen(false);
  };
  // the ⋮ menu: closed, its main list (branch style, toggles, ladderize, Export…) or the export list it opens in its place
  const [menu, setMenu] = useState<'closed' | 'main' | 'export'>('closed');
  const [toast, setToast] = useState<string | null>(null);
  const [height, setHeight] = useState(defaultHeight);

  // ---- what is shown: a VIEW of the current tree, not a step in its history: the clade shown alone (focus). It makes a different tree, so
  // node ids shift: `toView` maps a node of `tree` to the view (-1: hidden), `toTree` the other way. The clades the user collapsed are NOT
  // part of it: the viewer collapses them on the tree it is given (`collapsed` below, in the view's ids).
  const hasSupport = useMemo(() => tree.support.some((v) => !Number.isNaN(v)), [tree]);
  const view = useMemo(() => {
    const acc: { shown: TreeModel; toView: Int32Array | null } = { shown: tree, toView: null }; // toView: tree -> shown, composed
    const step = (r: ops.OpResult) => {
      if (!r.changed) return false;
      acc.toView = acc.toView ? ops.composeMaps(acc.toView, r.map) : r.map;
      acc.shown = new TreeModel(r.tree);
      return true;
    };
    step(ops.showFocus(tree, focus));
    const { shown, toView } = acc;
    if (!toView) return null;
    return { tree: shown, toView, toTree: ops.invertMap(toView, shown.nodeCount) };
  }, [tree, focus]);
  const shown = view?.tree ?? tree;
  // a node of what is shown -> the node of `tree` an action works on; -1 for an id the shown tree does not have. The hover box is rendered
  // with the last hover event, which can hold an id of the tree shown BEFORE Show only / Up / Reset changed it.
  const toTree = (k: number) => {
    const v = view ? view.toTree[k] : k;
    return v === undefined || v < 0 || v >= tree.nodeCount ? -1 : v;
  };
  const selectedShown = shownSelection(selected, view, tree.parent);
  const shownClades = useMemo(
    () =>
      view
        ? clades.flatMap((c) => {
            const k = view.toView[c.node];
            return k >= 0 ? [{ ...c, node: k }] : [];
          })
        : clades,
    [view, clades],
  );
  // the collapsed clades in the shown tree's ids (a clade that focus left out has none)
  const collapsedIds = useMemo(
    () => (view ? collapsed.map((v) => view.toView[v]) : collapsed).filter((k) => k > 0 && k < shown.nodeCount),
    [collapsed, view, shown],
  );

  // What the viewer is told when what is shown changes, so it keeps the view: shown (before) -> tree (before) -> tree (now) -> shown
  // (now), each leg a node map (an edit's, and the view's two). Changing the focus is a navigation: fitted, no map. The previous values
  // are kept in a ref written after the commit.
  const lastShown = useRef<{ shown: TreeModel; tree: TreeModel; focus: ops.Focus; toTree: Int32Array | null }>({
    shown,
    tree,
    focus,
    toTree: view?.toTree ?? null,
  });
  const treeMap = useMemo(() => {
    const prev = lastShown.current;
    if (prev.shown === shown) return undefined;
    let leg: Int32Array | null = null;
    if (prev.tree !== tree) {
      if (!move || move.from !== prev.tree || move.to !== tree) return undefined; // not an edit we know the map of: fit
      leg = move.map;
    } else if (prev.focus !== focus) return undefined;
    // compose only the legs there are (a missing one is the identity: no array of the tree's size is made for it)
    const legs = [prev.toTree, leg, view?.toView ?? null].filter((m): m is Int32Array => m !== null);
    if (legs.length === 0) return undefined;
    try {
      return legs.reduce((a, b) => ops.composeMaps(a, b));
    } catch {
      return undefined;
    }
  }, [shown, tree, view, focus, move]);
  useLayoutEffect(() => {
    lastShown.current = { shown, tree, focus, toTree: view?.toTree ?? null };
  }, [shown, tree, view, focus]);

  const hasTruncatable = useMemo(() => published.tipLabels.some((l) => l.length > TRUNCATE_AT), [published]);
  const formatLabel = useMemo(
    () => (id: string) => {
      const n = id.replace(/_/g, ' ');
      return truncate && n.length > TRUNCATE_AT ? n.slice(0, TRUNCATE_AT - 2) + '…' : n;
    },
    [truncate],
  );
  // `tree` as the viewer's helpers read it (cladeName, namedDescendants): node ids of `tree`, the ids the actions and the inspector use
  const treeSnap = useMemo(() => new InMemorySource(tree).snapshot(), [tree]);
  // ---- search: case-insensitive substring of the displayed name (Reactree's rule; an underscore and a space are the same); matches
  // highlighted, the current one centred. One regular expression over the labels, not a string rebuilt per label (about 0.1 s on 2.4
  // million labels), and every match kept: highlighting a million tips costs little (docs/design/highlight-cost.md, #58).
  const matches = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[ _]/g, '[ _]'), 'i');
    // node ids, not labels: a label that several tips carry is several matches, each focused in turn and counted
    const out: number[] = [];
    const labels = shown.tipLabels;
    for (let r = 0; r < labels.length; r++) if (re.test(labels[r])) out.push(shown.tipNode[r]);
    return out;
  }, [query, shown]);
  const currentIdx = matches.length ? ((matchIdx % matches.length) + matches.length) % matches.length : -1;
  const current = currentIdx >= 0 ? matches[currentIdx] : null;
  const [focusSeq, setFocusSeq] = useState(0);
  useEffect(() => setFocusSeq((s) => s + 1), [current]);

  // ---- node labels: the viewer draws them (`nodeLabels`). 'support' reads `support` of the tree, which is the same for a support in
  // the labels (0.95, 100) and for one that load() copied there from an annotation (BEAST posterior). A collapsed clade shows its own
  // support or length on its stem.
  const nodeLabels = labelMode;
  // the viewer's own overview and clade legend, over the tree; its zoom and fit buttons are not shown (the toolbar has Fit)
  const controls = useMemo(
    () => defaultControls({ zoom: false, fit: false, overview: showOverview, legend: showLegend }),
    [showOverview, showLegend],
  );

  // for the browser check (tests/browser/scripts/check-explorer.mjs): the viewer, to find where nodes are
  useEffect(() => {
    (window as unknown as { __explorer?: () => unknown }).__explorer = () => ref.current?.renderer() ?? null;
  }, []);
  // ... and the tree with its support (the viewer's snapshot has none), to pick a clade by its support
  const treeNow = useRef(tree);
  treeNow.current = tree;
  useEffect(() => {
    (window as unknown as { __explorerTree?: () => TreeModel }).__explorerTree = () => treeNow.current;
  }, []);

  const flash = (msg: string) => setToast(msg);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- edits: each returns a new tree (tree-ops), the step before is kept for Undo
  const apply = (op: (t: TreeModel) => ops.OpResult, what: string) => {
    let r: ops.OpResult;
    try {
      r = op(tree);
    } catch (err) {
      return flash(`${what}: ${(err as Error).message}`);
    }
    if (!r.changed) return flash(`${what}: nothing to change`);
    setPick(null);
    const next = new TreeModel(r.tree);
    const followedClades = ops.followClades(
      tree,
      next,
      r.map,
      clades.map((c) => c.node),
    );
    const keptClades = clades.flatMap((c, i) => {
      const m = followedClades[i].node;
      return m >= 0 ? [{ ...c, node: m }] : [];
    });
    const keptCollapsed = ops
      .followClades(tree, next, r.map, collapsed)
      .map((f) => f.node)
      .filter((m) => m > 0 && next.childCount[m] > 0);
    // so does the focus: navigation is not in the history, so Undo leaves it as it is (remapped through the inverse map). A focused
    // clade the edit split is gone from it (Back skips it)
    const remapped = ops.remapFocus(focus, tree, next, r.map);
    const keptFocus = remapped.stack.length === focus.stack.length && remapped.stack.every((v, i) => v === focus.stack[i]) ? focus : remapped; // same object while nothing changed
    const notes: string[] = [];
    if (keptClades.length < clades.length) notes.push(`${clades.length - keptClades.length} colour(s) removed: their tips are no longer one clade`);
    if (ops.focusedNode(focus) >= 0 && ops.focusedNode(keptFocus) < 0)
      notes.push('the clade shown alone is no longer one clade after this edit: showing the whole tree');
    if (notes.length) flash(notes.join(' · '));
    setHistory((h) =>
      trimHistory(
        [...h.slice(0, -1), { ...h[h.length - 1], clades, collapsed }, { tree: next, clades: keptClades, collapsed: keptCollapsed, map: r.map }],
        undoBudget,
      ),
    );
    setMove({ from: tree, to: next, map: r.map });
    setClades(keptClades);
    setCollapsed(keptCollapsed);
    setFocus(keptFocus);
    deselect();
  };
  // back to step `to` of the history: Undo is the step before the last, Reset the first (the tree as published)
  const back = (to: number) => {
    const prev = history[to];
    // the way back: the inverses of the edits' maps, last first, chained (a tip stays the tip it was; an edit that added nodes has none
    // to send back)
    let way: Int32Array | null = null;
    for (let k = history.length - 1; k > to; k--) {
      const inverse = ops.invertMap(history[k].map!, history[k].tree.nodeCount);
      way = way ? ops.composeMaps(way, inverse) : inverse;
    }
    if (way) {
      const w = way;
      setMove({ from: tree, to: prev.tree, map: w });
      setFocus((f) => (ops.canGoBack(f) || ops.canGoUp(f) ? ops.remapFocus(f, tree, prev.tree, w) : f)); // navigation stays; it follows the tips
    }
    setHistory((h) => h.slice(0, to + 1));
    setClades(prev.clades);
    setCollapsed(prev.collapsed);
    deselect();
    setPick(null);
  };
  const undo = () => back(history.length - 2);

  const closePick = () => {
    setPick(null);
    ref.current?.renderer()?.focus(); // back to the tree
  };
  // ---- show only a clade: a navigation, not an edit, so it is not in the undo history. Reset and Up one level come from tree-ops' focus.
  const navigate = (f: ops.Focus) => {
    setFocus(f);
    deselect();
    const v = ops.focusedNode(f);
    flash(v < 0 ? 'Showing the whole tree' : `Showing only a clade of ${tree.tipCountOf(v).toLocaleString('en')} tips`);
  };
  // ---- drill-down (#57): the overview of the clade shown (its largest clades open, the rest collapsed, about OVERVIEW_ROWS rows), and
  // on a collapsed clade expand in place (a click) or jump into it (Show only). tree-ops mergeAutoCollapse replaces the collapsed clades
  // inside the clade by its own overview and keeps the others. Rows are counted on `tree`.
  const overviewOfShown = () => {
    const root = Math.max(0, ops.focusedNode(focus));
    const next = ops.mergeAutoCollapse(tree, collapsed, { root, maxRows: OVERVIEW_ROWS });
    // the clade shown alone stays collapsed in the view around it (as jumpInto leaves it), so Reset returns to that view
    if (root > 0 && collapsed.includes(root)) {
      next.push(root);
      next.sort((a, b) => a - b);
    }
    setCollapsed(next);
    deselect();
    const n = next.filter((v) => v > root && v < tree.subtreeEnd[root]).length;
    flash(collapseMessage(n));
  };
  /** Open the collapsed clade `v` (of `tree`) with its own overview of about EXPAND_ROWS rows inside. */
  const expandInPlace = (v: number) => setCollapsed((cs) => ops.mergeAutoCollapse(tree, cs, { root: v, maxRows: EXPAND_ROWS }));
  /** Show only the collapsed clade `v`, with its overview inside. It stays collapsed in the view around it, so Reset returns to that view. */
  const jumpInto = (v: number) => {
    setCollapsed((cs) => [...ops.mergeAutoCollapse(tree, cs, { root: v, maxRows: OVERVIEW_ROWS }), v].sort((a, b) => a - b));
    navigate(ops.focusOn(tree, focus, v));
  };
  const colourOf = (name: string) => cssVar(`--ex-palette-${name.toLowerCase()}`);
  /** Paint (or with ERASE, unpaint) the clade `v` of `tree`. The label is left out: the legend then names the clade by its node. */
  const nextColour = () => PALETTE[(colourStep.current++ * COLOUR_STRIDE) % PALETTE.length];
  const paint = (v: number, name: string) => {
    const rest = clades.filter((c) => c.node !== v);
    setClades(name === ERASE ? rest : [...rest, { node: v, colour: colourOf(name) }]);
  };

  // ---- clicks: with the click action Inspect, the viewer's node menu opens (nodeMenu below) and a click on the triangle of a collapsed
  // clade expands it; any other action acts on the click at once, with no selection and no menu.
  const onToolClick = (e: TreeNodeEvent) => {
    if (clickAction === 'inspect') {
      if (expandsOnClick(e)) {
        e.preventDefault();
        const v = toTree(e.node);
        if (v >= 0) expandInPlace(v);
      }
      return;
    }
    e.preventDefault();
    if (e.run) return flash('Zoom in: this is a run of small clades drawn as one');
    const v = toTree(e.node);
    if (v < 0) return;
    switch (clickAction) {
      case 'collapse':
        if (e.collapsed) return expandInPlace(v);
        if (e.isTip) return flash('Collapse needs a clade');
        if (e.node === 0) return flash('The root of what is shown cannot be collapsed');
        return setCollapsed((cs) => [...cs, v]);
      case 'subtree':
        if (e.collapsed) return jumpInto(v);
        if (e.isTip) return flash('Show only needs a clade');
        if (e.node === 0) return flash('This is the clade shown already');
        return navigate(ops.focusOn(tree, focus, v));
      case 'reroot':
        if (e.collapsed) return flash('Reroot needs a tip or an open clade');
        if (v === 0) return flash('This is the root already');
        if (ops.canGoUp(focus) && e.node !== 0) return flash('Back to root to reroot the whole tree');
        return apply((t) => ops.reroot(t, v), 'Reroot');
      case 'colour':
        return paint(v, clades.some((c) => c.node === v) ? ERASE : nextColour()); // a second click takes the colour off
    }
  };

  // the node menu: what a click on this tip or clade offers. Not while another click action is chosen, which acts on the click itself.
  const nodeMenu = (e: TreeNodeEvent): NodeMenuItem[] | null => {
    const v = toTree(e.node);
    if (clickAction !== 'inspect' || e.run || v < 0) return null;
    const isTip = e.isTip;
    const isCollapsed = e.collapsed;
    const shownRoot = e.node === 0; // the root of what is shown: the tree's, or the clade shown alone
    const trueRoot = v === 0;
    const info: NodeMenuItem = {
      id: 'info',
      label: 'Info',
      onSelect: () => {
        setSelected(v);
        setInfoOpen(true);
      },
    };
    const expand: NodeMenuItem = {
      id: 'expand',
      label: 'Expand',
      onSelect: () => setCollapsed((cs) => cs.filter((c) => c !== v)), // the whole clade, unlike a click on it (expandInPlace)
    };
    const collapse: NodeMenuItem = {
      id: 'collapse',
      label: 'Collapse',
      onSelect: () => setCollapsed((cs) => [...cs, v]),
    };
    const only: NodeMenuItem = {
      id: 'subtree',
      label: 'Show only',
      onSelect: () => navigate(ops.focusOn(tree, focus, v)),
    };
    const reroot: NodeMenuItem = {
      id: 'reroot',
      label: 'Reroot here',
      onSelect: () => apply((t) => ops.reroot(t, v), 'Reroot'),
    };
    const colour: NodeMenuItem = {
      id: 'colour',
      label: 'Colour…',
      onSelect: (ev) => {
        const r = outer.current?.getBoundingClientRect();
        setPick({ node: v, x: r ? ev.clientX - r.left : 16, y: r ? ev.clientY - r.top : 92 });
      },
    };
    if (isCollapsed) return [expand, info, { ...only, onSelect: () => jumpInto(v) }, colour];
    // inside a clade shown alone a reroot would split it: the menu leaves it out there
    const canReroot = !ops.canGoUp(focus) || shownRoot;
    if (isTip) return canReroot ? [info, reroot, colour] : [info, colour];
    const items: NodeMenuItem[] = [];
    // the root of a clade shown alone leads out of it
    if (shownRoot && ops.canGoUp(focus)) {
      items.push({
        id: 'up',
        label: 'Up one level',
        onSelect: () => navigate(ops.focusUp(tree, focus)),
      });
      items.push({ id: 'root', label: 'Back to root', onSelect: () => navigate(ops.NO_FOCUS) });
    }
    items.push(info);
    if (trueRoot) return [...items, colour];
    // the root of what is shown is not collapsed or shown alone again
    if (!shownRoot) items.push(collapse, only);
    if (canReroot) items.push(reroot);
    items.push(colour);
    return items;
  };

  // the hover box: what the tree knows about the node
  const tooltip = (e: TreeNodeEvent) => {
    const v = toTree(e.node);
    if (e.run || v < 0) return null;
    const clean = (l: string) => l.replace(/_/g, ' ');
    const sup = e.isTip ? (v > 0 ? tree.support[tree.parent[v]] : NaN) : tree.support[v];
    const len = tree.length[v];
    const [r0, r1] = tree.tipRange(v);
    const facts: HoverFacts = {
      title: e.isTip ? clean(tree.labels[v]) : clean(splitInternalLabel(tree.labels[v]).name),
      support: Number.isNaN(sup) ? null : sup,
      length: Number.isNaN(len) ? null : len,
      tips: e.isTip ? null : r1 - r0,
      first: clean(tree.tipLabels[r0]),
      last: clean(tree.tipLabels[r1 - 1]),
    };
    return <NodeHoverBox facts={facts} />;
  };

  // ---- keyboard, as Reactree: Ctrl/Cmd+F search, Ctrl/Cmd+Z undo, Escape returns to the Inspect click action or closes a panel (only while focus is in here)
  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      setSearchOpen(true);
      searchInput.current?.focus(); // already open; a new panel focuses itself (autoFocus)
    } else if (mod && e.key.toLowerCase() === 'z' && canUndo) {
      e.preventDefault();
      undo();
    } else if (e.key === 'Escape') {
      if (menu !== 'closed') {
        setMenu('closed');
        viewRef.current?.querySelector('button')?.focus(); // back to the ⋮ button
      } else if (pick !== null) closePick();
      else if (clickAction !== 'inspect') setClickAction('inspect');
      else if (searchOpen) closeSearch();
      else setInfoOpen(false);
    }
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
    setMatchIdx(0);
  };

  // ---- export: PNG is the viewer's toBlob; Newick and NEXUS through @canopy/io
  const download = (blob: Blob, name: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const exportPng = (scale: 1 | 2 | 4) => {
    // the view as an image, `scale` canvas pixels per CSS pixel, on the theme's background (the pane's grey), as on screen
    ref.current
      ?.renderer()
      ?.toBlob({ scale })
      .then((b) => download(b, scale === 1 ? 'phylotree.png' : `phylotree@${scale}x.png`))
      .catch((err) => flash(`PNG export at ${scale}×: ${(err as Error).message}`));
  };
  // Newick and NEXUS give the clade shown alone when there is one, the whole tree otherwise
  const exportRoot = ops.focusedNode(focus);
  const exported = () => (exportRoot < 0 ? tree : new TreeModel(ops.subtree(tree, exportRoot).tree));
  const exportText = (text: string, name: string) => download(new Blob([text], { type: 'text/plain' }), name);

  // close the ⋮ menu on a press outside it
  const viewRef = useRef<HTMLDivElement>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (menu === 'closed') return;
    const f = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!viewRef.current?.contains(t) && !viewMenuRef.current?.contains(t)) setMenu('closed');
    };
    document.addEventListener('pointerdown', f);
    return () => document.removeEventListener('pointerdown', f);
  }, [menu]);

  // the focus goes into the ⋮ menu when it opens and when it swaps lists (the button that had it is gone), so the keyboard works there
  useEffect(() => {
    if (menu !== 'closed') viewMenuRef.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }, [menu]);

  // ---- resize handle: drag the bottom edge of the pane
  const onResizeDown = (e: React.PointerEvent) => {
    const y0 = e.clientY;
    const h0 = height;
    const move = (m: PointerEvent) => setHeight(Math.max(240, h0 + m.clientY - y0));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ---- inspector rows for a node of `tree`
  const inspector = useMemo(() => {
    const info = infoOpen ? selected : null;
    if (info === null || info >= tree.nodeCount) return null;
    let root = 0;
    let any = false;
    for (let u = info; u > 0; u = tree.parent[u])
      if (!Number.isNaN(tree.length[u])) {
        root += tree.length[u];
        any = true;
      }
    const isTip = tree.childCount[info] === 0;
    const sup = isTip ? (info > 0 ? tree.support[tree.parent[info]] : NaN) : tree.support[info];
    return {
      name: isTip ? tree.labels[info] : splitInternalLabel(tree.labels[info]).name || `Clade of ${tree.tipCountOf(info)} tips`,
      raw: tree.labels[info],
      branch: Number.isNaN(tree.length[info]) ? null : tree.length[info],
      root: any ? root : null,
      depth: tree.depth[info],
      support: Number.isNaN(sup) ? null : sup,
      clade: infoClade(tree, treeSnap, info, collapsed, formatLabel),
    };
  }, [infoOpen, selected, tree, treeSnap, collapsed, formatLabel]);

  const theme = useMemo(() => ({ labelSize: LABEL_SIZE * init.fontScale, branchWidth: 1.5, cladeBranchWidth: 2.2 }), [init.fontScale]);

  return (
    <div className={`ex-outer ex-click-${clickAction}`} ref={outer} onKeyDown={onKeyDown}>
      {/* ── Row 1: view settings ── */}
      <Scroller className="ex-row" role="toolbar" aria-label="View">
        <label
          className={`ex-select${clickAction !== 'inspect' ? ' ex-select--active' : ''}`}
          title="What a click on a node or tip does (blue while it is not Inspect)"
        >
          <span className="ex-select-icon" aria-hidden="true">
            {React.createElement(CLICK_ICONS[clickAction])}
          </span>
          <select
            aria-label="Click action"
            value={clickAction}
            onChange={(e) => {
              setClickAction(e.target.value as ClickAction);
              setPick(null);
            }}
          >
            <option value="inspect">Inspect</option>
            <option value="collapse">Collapse</option>
            <option value="subtree">Subtree</option>
            <option value="reroot">Reroot</option>
            <option value="colour">Colour</option>
          </select>
          <span className="ex-select-caret" aria-hidden="true" />
        </label>
        <div className="ex-divider" />
        <button type="button" className="ex-btn" aria-label="Fit tree" title="Fit tree" onClick={() => viewer?.fit(false)}>
          <J.IconFit />
        </button>
        <div className="ex-divider" />
        <div className="ex-group">
          <button
            type="button"
            className={layout === 'rectangular' ? 'active' : ''}
            aria-pressed={layout === 'rectangular'}
            title="Rectangular"
            onClick={() => setLayout('rectangular')}
          >
            <I.IconRect />
          </button>
          <button
            type="button"
            className={layout === 'radial' ? 'active' : ''}
            aria-pressed={layout === 'radial'}
            title="Circular"
            onClick={() => setLayout('radial')}
          >
            <I.IconCirc />
          </button>
        </div>
        <div className="ex-spacer" />
        <div className="ex-pinned">
          <button
            type="button"
            className={`ex-btn${searchOpen ? ' ex-search-active' : ''}`}
            aria-label="Search tips"
            title="Search tips (⌘F)"
            onClick={() => {
              if (searchOpen) return closeSearch();
              setSearchOpen(true);
              searchInput.current?.focus(); // already open; a new panel focuses itself (autoFocus)
            }}
          >
            <I.IconSearch />
          </button>
          <div className="ex-divider" />
          <div className="ex-export" ref={viewRef}>
            <button
              type="button"
              className={`ex-btn${menu !== 'closed' ? ' open' : ''}`}
              aria-label="More options"
              aria-haspopup="menu"
              aria-expanded={menu !== 'closed'}
              title="Tree style, labels, ladderize and export"
              onClick={() => setMenu((m) => (m === 'closed' ? 'main' : 'closed'))}
            >
              <J.IconMore />
            </button>
          </div>
        </div>
      </Scroller>

      {/* ── Row 2: interaction tools ── */}
      <Scroller className="ex-row" role="toolbar" aria-label="Edit">
        {history.length > 1 && <UndoNote canUndo={canUndo} undoOn={undoOn} />}
        {ops.focusedNode(focus) >= 0 && (
          <div className="ex-group" role="group" aria-label="Clade shown">
            <button type="button" aria-label="Back to root" title="Show the whole tree again" onClick={() => navigate(ops.NO_FOCUS)}>
              <J.IconReset />
              <span className="ex-btn-text">Back to root</span>
            </button>
            <button
              type="button"
              aria-label="Up one level"
              disabled={!ops.canGoUp(focus)}
              title="Up one level: show the clade that contains the one shown"
              onClick={() => navigate(ops.focusUp(tree, focus))}
            >
              <J.IconUpLevel />
              <span className="ex-btn-text">Up one level</span>
            </button>
          </div>
        )}
        {clades.length > 0 && (
          <button type="button" className="ex-btn" title="Remove every colour" onClick={() => setClades([])}>
            Clear colours
            <span className="ex-count">{clades.length}</span>
          </button>
        )}
        <div className="ex-spacer" />
      </Scroller>

      {/* ── Body: the tree ── */}
      <div
        className="ex-pane"
        style={{ height }}
        onWheel={dismissHint}
        onPointerDown={(e) => {
          dragFrom.current = (e.target as Element).closest('.ex-resize') ? null : { x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          const d = dragFrom.current;
          if (d && e.buttons > 0 && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) dismissHint();
        }}
        onPointerUp={() => (dragFrom.current = null)}
        onKeyDown={(e) => ['+', '=', '-', '_'].includes(e.key) && dismissHint()}
      >
        <TreeView
          ref={ref}
          tree={shown}
          treeMap={treeMap}
          layout={layout}
          branchLengths={phylogram}
          clades={shownClades}
          highlighted={matches}
          collapsed={collapsedIds}
          controls={controls}
          theme={theme}
          focus={current ? { tipId: current, seq: focusSeq } : null}
          selected={selectedShown}
          onSelectionChange={(k) => setSelected(k === null || toTree(k) < 0 ? null : toTree(k))}
          options={{
            formatLabel,
            cladeLabel,
            labelDensity: 'dense',
            highlightStyle,
            alignLabels,
            nodeLabels,
            themeObserver: 'document',
            // the hover ring grows in, as in Reactree (the default; said here as the look depends on it)
            hoverAnimation: true,
            // a view restored (?view=) sets the level-of-detail options it was copied with
            ...init.options,
          }}
          tooltip={showTooltips ? tooltip : false}
          tooltipBare
          nodeMenu={nodeMenu}
          onNodeClick={onToolClick}
          onTipClick={onToolClick}
        />

        {searchOpen && (
          <div className="ex-search">
            <span className="ex-search-icon">
              <I.IconSearch />
            </span>
            <input
              ref={searchInput}
              autoFocus
              type="text"
              aria-label="Search tips"
              placeholder="Search tips…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setMatchIdx(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'Enter') {
                  e.preventDefault();
                  setMatchIdx((i) => i + 1);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setMatchIdx((i) => i - 1);
                }
              }}
            />
            {query.trim() && (
              <span className={`ex-search-count${matches.length ? '' : ' none'}`}>
                {matches.length ? `${(currentIdx + 1).toLocaleString('en')} / ${matches.length.toLocaleString('en')}` : 'No match'}
              </span>
            )}
            {matches.length > 1 && (
              <span className="ex-search-nav">
                <button type="button" title="Previous match (↑)" onClick={() => setMatchIdx((i) => i - 1)}>
                  <I.IconUp />
                </button>
                <button type="button" title="Next match (↓ or Enter)" onClick={() => setMatchIdx((i) => i + 1)}>
                  <I.IconDown />
                </button>
              </span>
            )}
            <label className="ex-select ex-select--bare" title="How the matches show: a band on the row, everything else dimmed, or both">
              <J.IconHighlight />
              <select aria-label="Highlight style" value={highlightStyle} onChange={(e) => setHighlightStyle(e.target.value as HighlightStyle)}>
                <option value="band">band</option>
                <option value="dim">dim</option>
                <option value="both">both</option>
              </select>
            </label>
            <button type="button" className="ex-search-close" title="Close search (Esc)" onClick={closeSearch}>
              <I.IconClose />
            </button>
          </div>
        )}

        {inspector && (
          <div className="ex-info" role="dialog" aria-label="Node information">
            <div className="ex-info-head">
              <span className="ex-info-name">{inspector.name.replace(/_/g, ' ')}</span>
              <button type="button" title="Close" onClick={() => setInfoOpen(false)}>
                <I.IconClose />
              </button>
            </div>
            <dl className="ex-info-rows">
              {inspector.branch !== null && (
                <>
                  <dt>Branch length</dt>
                  <dd>{fmt(inspector.branch)}</dd>
                </>
              )}
              {inspector.root !== null && (
                <>
                  <dt>Root distance</dt>
                  <dd>{fmt(inspector.root)}</dd>
                </>
              )}
              <dt>Depth</dt>
              <dd>{inspector.depth}</dd>
              {inspector.support !== null && (
                <>
                  <dt>Bootstrap</dt>
                  <dd>{inspector.support}</dd>
                </>
              )}
            </dl>
            <InfoClade {...inspector.clade} />
            <button
              type="button"
              className="ex-info-copy"
              title="Copy raw taxon name"
              onClick={() => void navigator.clipboard?.writeText(inspector.raw)}
            >
              <I.IconCopy />
              Copy name
            </button>
          </div>
        )}

        {toast && (
          <div className="ex-toast" role="status">
            {toast}
          </div>
        )}
        {/* the viewer's clade legend is bottom right too, and grows with its entries: the rectangular hint (also bottom right) gives way to it.
            The radial hint is bottom left, clear of it. */}
        {hintShown(hintGone, layout, showLegend, shownClades.length) && (
          <div className={`ex-hint ex-hint--${layout}`}>Scroll to zoom · Drag to pan</div>
        )}
        <div className="ex-resize" title="Drag to resize" onPointerDown={onResizeDown}>
          <div className="ex-grip" />
        </div>
      </div>

      <DebugPanel viewer={viewer} debug={debug} collapsed={collapsedIds} asLoaded={shown === published} />

      {menu !== 'closed' && (
        <div className="ex-menu" role="menu" aria-label={menu === 'export' ? 'Export' : 'More options'} ref={viewMenuRef}>
          {menu === 'export' ? (
            <>
              <button type="button" role="menuitem" onClick={() => setMenu('main')}>
                <span className="ex-menu-icon">‹</span>
                <span className="ex-menu-label">Back</span>
              </button>
              <div className="ex-menu-divider" role="separator" />
              {(
                [
                  ['PNG 1×', 'Screen size', <I.IconFilePng key="i" />, () => exportPng(1)],
                  ['PNG 2×', 'Twice', <I.IconFilePng key="i" />, () => exportPng(2)],
                  ['PNG 4×', 'Print', <I.IconFilePng key="i" />, () => exportPng(4)],
                  null,
                  [
                    'Newick',
                    exportRoot < 0 ? 'Tree' : 'Subtree',
                    <I.IconFileNewick key="i" />,
                    () => exportText(toNewick(exported()), exportRoot < 0 ? 'phylotree.nwk' : 'subtree.nwk'),
                  ],
                  [
                    'NEXUS',
                    exportRoot < 0 ? 'Tree' : 'Subtree',
                    <I.IconFileNexus key="i" />,
                    () => exportText(toNexus(exported()), exportRoot < 0 ? 'phylotree.nex' : 'subtree.nex'),
                  ],
                ] as const
              ).map((item, k) =>
                item === null ? (
                  <div key={k} className="ex-menu-divider" role="separator" />
                ) : (
                  <button
                    key={item[0]}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      item[3]();
                      setMenu('closed');
                    }}
                  >
                    <span className="ex-menu-icon">{item[2]}</span>
                    <span className="ex-menu-label">{item[0]}</span>
                    <span className="ex-menu-desc">{item[1]}</span>
                  </button>
                ),
              )}
            </>
          ) : (
            <>
              <div className="ex-menu-head" role="presentation">
                Branches
              </div>
              {(
                [
                  ['Phylogram', 'Lengths proportional', true, tree.hasLengths],
                  ['Cladogram', 'Topology only', false, true],
                ] as const
              ).map(([label, desc, value, enabled]) => (
                <button
                  key={label}
                  type="button"
                  role="menuitemradio"
                  aria-checked={drawsLengths === value}
                  disabled={!enabled}
                  onClick={() => setPhylogram(value)}
                >
                  <span className="ex-menu-check">{drawsLengths === value && '●'}</span>
                  <span className="ex-menu-label">{label}</span>
                  <span className="ex-menu-desc">{desc}</span>
                </button>
              ))}
              <div className="ex-menu-divider" role="separator" />
              {(
                [
                  ['Legend', showLegend, () => setShowLegend((x) => !x), true, true],
                  ['Minimap', showOverview, () => setShowOverview((x) => !x), true, true],
                  ['Tooltips', showTooltips, () => setShowTooltips((x) => !x), true, true],
                  ['Align labels', alignLabels, () => setAlignLabels((x) => !x), drawsLengths, true],
                  ['Truncate names', truncate, () => setTruncate((x) => !x), hasTruncatable, true],
                  ['Show support', labelMode === 'support', () => setLabelMode((m) => (m === 'support' ? 'none' : 'support')), true, hasSupport],
                  [
                    'Show branch length',
                    labelMode === 'length',
                    () => setLabelMode((m) => (m === 'length' ? 'none' : 'length')),
                    true,
                    tree.hasLengths,
                  ],
                ] as const
              )
                .filter((item) => item[4])
                .map(([label, on, toggle, enabled]) => (
                  <button key={label} type="button" role="menuitemcheckbox" aria-checked={on} disabled={!enabled} onClick={toggle}>
                    <span className="ex-menu-check">{on && '✓'}</span>
                    <span className="ex-menu-label">{label}</span>
                  </button>
                ))}
              <div className="ex-menu-divider" role="separator" />
              {(
                [
                  [
                    `Collapse to ${OVERVIEW_ROWS} clades`,
                    'Largest clades open, the rest collapsed',
                    <J.IconClades key="i" />,
                    overviewOfShown,
                    shown.tipCount > OVERVIEW_ROWS,
                  ],
                  [
                    'Expand all',
                    `${collapsed.length} collapsed clades open again`,
                    <I.IconExpandAll key="i" />,
                    () => setCollapsed([]),
                    collapsed.length > 0,
                  ],
                  [
                    'Ladderize ascending',
                    'Smallest clades at top',
                    <J.IconLadderBy key="i" />,
                    () => apply((t) => ops.ladderise(t, { by: 'tips' }), 'Ladderize'),
                    true,
                  ],
                  [
                    'Ladderize descending',
                    'Largest clades at top',
                    <J.IconLadderBy key="i" descending />,
                    () => apply((t) => ops.ladderise(t, { by: 'tips', order: 'decreasing' }), 'Ladderize'),
                    true,
                  ],
                  ['Midpoint root', 'Middle of the longest path', null, () => apply(ops.midpointRoot, 'Midpoint'), tree.hasLengths],
                  ['Reset', 'Back to the tree as published', null, () => back(0), history.length > 1],
                ] as const
              )
                .filter((item) => item[4]) // not offered: the overview on a small clade, Expand all without collapsed clades, the midpoint without branch lengths, Reset on the tree as published
                .map(([label, desc, icon, run, enabled]) => (
                  <button
                    key={label}
                    type="button"
                    role="menuitem"
                    disabled={!enabled}
                    onClick={() => {
                      run();
                      setMenu('closed');
                    }}
                  >
                    <span className="ex-menu-icon">{icon}</span>
                    <span className="ex-menu-label">{label}</span>
                    <span className="ex-menu-desc">{desc}</span>
                  </button>
                ))}
              <div className="ex-menu-divider" role="separator" />
              <button type="button" role="menuitem" onClick={() => setMenu('export')}>
                <span className="ex-menu-icon">
                  <I.IconExport />
                </span>
                <span className="ex-menu-label">Export…</span>
                <span className="ex-menu-desc">›</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* ── The node menu's Colour…: one colour for one clade ── */}
      {pickAt !== null && pickAt.node < tree.nodeCount && (
        <div
          className="ex-palette ex-palette--near"
          role="dialog"
          aria-label="Colour this clade"
          // opens where the click was, kept inside the component (the palette is about 240 x 150 px)
          style={{ left: Math.max(8, Math.min(pickAt.x, (outer.current?.clientWidth ?? 1000) - 262)), top: Math.max(8, pickAt.y), right: 'auto' }}
        >
          <div className="ex-palette-head">
            <I.IconPalette />
            <span>
              Colour this {tree.childCount[pickAt.node] === 0 ? 'tip' : `clade of ${tree.tipCountOf(pickAt.node).toLocaleString('en')} tips`}
            </span>
            <span className="ex-palette-tip">Esc to close</span>
          </div>
          <div className="ex-palette-grid">
            {PALETTE.map((name, k) => (
              <button
                key={name}
                type="button"
                title={name}
                aria-label={name}
                className="ex-swatch"
                autoFocus={k === 0} // focus moves into the palette; Esc closes it
                style={{ ['--sw' as string]: `var(--ex-palette-${name.toLowerCase()})` }}
                onClick={() => {
                  paint(pickAt.node, name);
                  closePick();
                }}
              />
            ))}
          </div>
          <div className="ex-palette-divider" />
          <div className="ex-palette-foot">
            <button
              type="button"
              className="ex-erase"
              disabled={!clades.some((c) => c.node === pickAt.node)}
              onClick={() => {
                paint(pickAt.node, ERASE);
                closePick();
              }}
            >
              <I.IconEraser /> Erase
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
