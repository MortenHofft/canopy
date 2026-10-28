// React example: <TreeView> used the way a gbif.org page would use it. Two instances share ONE controlled viewport (pan or zoom
// either one and the other follows), and the callbacks write into plain React state. `npm run dev` in this folder, then open the
// printed URL (?tree=<id> picks a tree from src/trees.ts).
//
// Tree operations come from @canopy/tree-ops (no rendering in there) and this page is the only place the two meet:
// clicking a tip or clade opens <TreeView>'s node menu with per-node actions (rotate, reroot here, ...), the toolbar holds
// whole-tree actions (midpoint root, ladderise, collapse by support). Each action returns a new tree that replaces the one
// shown; the tree as published is kept for reset and never changed, and the trees between it and the current one for undo, within a
// memory budget (tree-ops' treeBytes, #44).

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@canopy/viewer/viewer.css';
import '@canopy/viewer/gbif.css';
import '../../shared/gbif-tokens.css';
import { gbifTheme } from './gbif-theme.ts';
import { loadTree } from './trees.ts';
import { TreeModel } from '@canopy/io';
import * as ops from '@canopy/tree-ops';
import { TreeView, type CladeProp, type NodeMenuItem, type TreeNodeEvent, type TreeViewHandle } from '@canopy/react';
import { defaultControls, type Viewport } from '@canopy/viewer';

/** What happens to a clade colour whose tips an operation splits (rerooting inside the clade puts its tips on both sides of the new
 *  root, so they are no longer one clade): 'remove' it, or keep it on the 'node' that was coloured, which now holds other tips
 *  (tree-ops' `onSplit: 'drop'` and `'keep'`). */
type SplitColour = 'remove' | 'node';

const NO_NODES: number[] = [];

/** An entry of the history: `clades`, `collapsed` and `focus` are what it had when the next action was applied, so undo restores them
 *  exactly; `map` is the node map of the action that made it (the tree before -> this tree), and `dropped` counts the entries before it
 *  dropped to stay within the memory budget (then `map` is from the tree as published, and undo stops here). */
interface Entry {
  tree: TreeModel;
  clades: CladeProp[];
  collapsed: number[];
  focus: ops.Focus;
  map?: Int32Array;
  dropped?: number;
}
/** What the trees kept for undo may take, the tree as published and the current one aside (#44): a tree larger than this has reset
 *  only. `?undo-budget=<bytes>` sets it. */
const UNDO_BUDGET = 64 * 1024 * 1024;

/** Undo (only while a step is available), Reset, and a note when undo is off for the tree or stops at a dropped entry. */
function UndoControls(p: { canUndo: boolean; canReset: boolean; undoOn: boolean; onUndo: () => void; onReset: () => void }) {
  const note = !p.undoOn
    ? 'Undo is off: the tree is too large to keep earlier versions'
    : p.canReset && !p.canUndo
      ? 'Older steps were dropped to save memory'
      : null;
  return (
    <>
      {p.canUndo && (
        <button className="btn btn-outline" onClick={p.onUndo}>
          Undo
        </button>
      )}
      <button className="btn btn-outline" disabled={!p.canReset} onClick={p.onReset}>
        Reset
      </button>
      {note && <span style={{ fontSize: 13 }}>{note}</span>}
    </>
  );
}

/** Keeps the entries between the tree as published (`h[0]`) and the current one (the last) within `budget` bytes (tree-ops' treeBytes),
 *  dropping the oldest first; the entry after a dropped one takes a map from the tree as published, so reset still keeps the view. */
function trimHistory(h: Entry[], budget: number): Entry[] {
  let bytes = 0;
  for (let k = 1; k < h.length - 1; k++) bytes += ops.treeBytes(h[k].tree);
  while (h.length > 2 && bytes > budget) {
    bytes -= ops.treeBytes(h[1].tree);
    h = [h[0], { ...h[2], map: ops.composeMaps(h[1].map!, h[2].map!), dropped: (h[1].dropped ?? 0) + 1 }, ...h.slice(3)];
  }
  return h;
}

function App() {
  const params = new URLSearchParams(location.search);
  // [as published, ...each action's result, within the memory budget]
  const [history, setHistory] = useState<Entry[]>([]);
  const tree = history[history.length - 1]?.tree ?? null;
  const budgetParam = Number(params.get('undo-budget') ?? NaN); // a missing or bad value: the default
  const undoBudget = Number.isFinite(budgetParam) ? budgetParam : UNDO_BUDGET;
  // undo needs one more tree in memory than reset: off when even one does not fit
  const published = history[0]?.tree ?? null;
  const undoOn = useMemo(() => !published || ops.treeBytes(published) <= undoBudget, [published, undoBudget]);
  const canUndo = undoOn && history.length > 1 && !history[history.length - 1].dropped;
  const changes = history.length - 1 + (history[1]?.dropped ?? 0);
  const [clades, setClades] = useState<CladeProp[]>([]);
  const [collapsed, setCollapsed] = useState<number[]>([]); // clades shown collapsed (node ids of `tree`): the viewer collapses them
  const [focus, setFocus] = useState<ops.Focus>(ops.NO_FOCUS); // the clade shown alone, with back and up (tree-ops' focus)
  const [hl, setHl] = useState<number[]>([]); // the highlighted tips as nodes of `tree` (a label would light every tip that carries it)
  // the last change of `tree` with its node map (an action's map; for undo the inverse of the actions undone), to keep the view
  const [move, setMove] = useState<{ from: TreeModel; to: TreeModel; map: Int32Array } | null>(null);
  const [vp, setVp] = useState<Viewport | undefined>(undefined);
  const [last, setLast] = useState('click a tip or a clade for its actions');
  const [minSupport, setMinSupport] = useState(70);
  const [collapseOn, setCollapseOn] = useState(false);
  const [splitColour, setSplitColour] = useState<SplitColour>('remove');
  // Runs once: `params` is rebuilt on every render but only read here for the initial tree name.
  useEffect(() => {
    void loadTree(params.get('tree') ?? 'rich-corvoid-680').then((t) => setHistory([{ tree: t, clades: [], collapsed: [], focus: ops.NO_FOCUS }]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // the viewers take their look from @canopy/viewer/gbif.css (CSS custom properties); the palette for clade colours comes from the
  // same GBIF tokens
  const g = useMemo(() => gbifTheme(), []);
  // support range, shown next to the threshold because files use different scales (0.95 versus 95)
  const supportRange = useMemo(() => {
    if (!tree) return null;
    let lo = Infinity,
      hi = -Infinity;
    for (const s of tree.support) {
      if (Number.isNaN(s)) continue;
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
    }
    return lo <= hi ? { lo, hi } : null;
  }, [tree]);
  const hasSupport = supportRange !== null;
  // What is shown is a VIEW of the current tree, not a step in its history: the clade shown alone (focus), then collapse by support
  // (recomputed when the threshold changes, so a lower one brings branches back). Both make a different tree, so node ids shift:
  // `toView` maps a node of `tree` to the view (-1: hidden), `toTree` the other way. Collapsed clades are NOT part of it: the viewer
  // collapses them on the tree it is given (`collapsed` below), so a click on one reports the node it is.
  const protectedNodes = collapseOn && hasSupport ? collapsed : NO_NODES; // changes only when it matters, so a collapse alone does not rebuild the view
  const view = useMemo(() => {
    if (!tree) return null;
    const acc: { shown: TreeModel; toView: Int32Array | null } = { shown: tree, toView: null }; // toView: tree -> shown, composed
    const step = (r: ops.OpResult) => {
      if (!r.changed) return false;
      acc.toView = acc.toView ? ops.composeMaps(acc.toView, r.map) : r.map;
      acc.shown = new TreeModel(r.tree);
      return true;
    };
    step(ops.showFocus(tree, focus));
    let supportCollapsed = 0;
    if (collapseOn && hasSupport) {
      const before = acc.shown.nodeCount;
      // a clade the viewer collapses keeps its node (tree-ops' `keep`)
      const keep = protectedNodes.map((v) => (acc.toView ? acc.toView[v] : v)).filter((k) => k > 0);
      const r = ops.collapseBySupport(acc.shown, minSupport, { keep, extend: acc.shown.hasLengths && acc.shown.isUltrametric(1e-3) });
      if (step(r)) supportCollapsed = before - acc.shown.nodeCount;
    }
    const { shown, toView } = acc;
    if (!toView) return null;
    return { tree: shown, toView, toTree: ops.invertMap(toView, shown.nodeCount), supportCollapsed };
  }, [tree, focus, collapseOn, hasSupport, minSupport, protectedNodes]);
  // What the viewers are told when what is shown changes, so they keep the view: shown (before) -> tree (before) -> tree (now) -> shown
  // (now), each leg a node map. Changing the focus is a navigation: fitted, no map. The previous values are kept in a ref written after
  // the commit.
  const lastShown = useRef<{ shown: TreeModel; tree: TreeModel; focus: ops.Focus; toTree: Int32Array | null } | null>(null);
  const treeMap = useMemo(() => {
    const prev = lastShown.current;
    if (!tree || !prev) return undefined;
    const shown = view?.tree ?? tree;
    if (prev.shown === shown) return undefined;
    let leg: Int32Array | null = null;
    if (prev.tree !== tree) {
      if (!move || move.from !== prev.tree || move.to !== tree) return undefined;
      leg = move.map;
    } else if (prev.focus !== focus) return undefined;
    const identity = (n: number) => Int32Array.from({ length: n }, (_, i) => i);
    try {
      return ops.composeMaps(
        ops.composeMaps(prev.toTree ?? identity(prev.shown.nodeCount), leg ?? identity(tree.nodeCount)),
        view?.toView ?? identity(tree.nodeCount),
      );
    } catch {
      return undefined;
    }
  }, [tree, view, focus, move]);
  useLayoutEffect(() => {
    if (tree) lastShown.current = { shown: view?.tree ?? tree, tree, focus, toTree: view?.toTree ?? null };
  }, [tree, view, focus]);
  // for the browser check (tests/browser/scripts/check-node-menu.mjs): the two viewers, and the current tree (the viewers hold a
  // snapshot of what is shown, not the tree model kept in the history)
  const leftPane = useRef<TreeViewHandle>(null);
  const rightPane = useRef<TreeViewHandle>(null);
  const treeNow = useRef(tree);
  treeNow.current = tree;
  useEffect(() => {
    (window as unknown as { __panes?: () => unknown }).__panes = () => [leftPane.current?.renderer() ?? null, rightPane.current?.renderer() ?? null];
    (window as unknown as { __tree?: () => TreeModel | null }).__tree = () => treeNow.current;
  }, []);
  const colouredTips = useMemo(() => {
    let n = 0;
    if (!tree) return { keep: new Uint8Array(0), n };
    const keep = new Uint8Array(tree.tipCount);
    for (const c of clades) {
      const k = c.node;
      if (k < tree.nodeCount)
        for (let r = tree.leafStart[k]; r < tree.leafEnd[k]; r++)
          if (!keep[r]) {
            keep[r] = 1;
            n++;
          }
    }
    return { keep, n };
  }, [tree, clades]);
  // the largest clades (of two or more tips) without a coloured tip, for 'Collapse uncoloured'; none while nothing is coloured
  // only inside the clade shown, and not those already collapsed or inside a collapsed clade (so the count is what a click adds)
  const uncolouredClades = useMemo(() => {
    if (!tree || colouredTips.n === 0) return [];
    const hit = new Int32Array(tree.nodeCount);
    for (let r = 0; r < tree.tipCount; r++) if (colouredTips.keep[r]) hit[tree.tipNode[r]] = 1;
    for (let i = tree.nodeCount - 1; i > 0; i--) hit[tree.parent[i]] += hit[i];
    const covered = new Uint8Array(tree.nodeCount); // collapsed, or inside a collapsed clade
    for (const c of collapsed) covered.fill(1, c, tree.subtreeEnd[c]);
    const f = ops.focusedNode(focus);
    const [lo, hi] = f < 0 ? [1, tree.nodeCount] : [f + 1, tree.subtreeEnd[f]];
    const out: number[] = [];
    for (let i = lo; i < hi; i++) if (hit[i] === 0 && hit[tree.parent[i]] > 0 && tree.childCount[i] > 0 && !covered[i]) out.push(i);
    return out;
  }, [tree, colouredTips, collapsed, focus]);

  // the left view gets the overview, search and legend on top of zoom and fit; the right one the default controls (zoom and fit)
  const leftControls = useMemo(() => defaultControls({ overview: true, search: { highlight: true }, legend: true }), []);

  if (!tree) return <p style={{ padding: 16 }}>loading…</p>;
  const palette = g.categorical;

  /** Run a tree operation on the current tree. A clade colour is carried over by its tips (see ops.followClade): it goes to the clade
   *  they form; when the operation split them, `splitColour` removes it or keeps it on its node with a warning in the status line. */
  const apply = (name: string, op: (t: TreeModel) => ops.OpResult) => {
    let r: ops.OpResult;
    const t0 = performance.now();
    try {
      r = op(tree);
    } catch (err) {
      setLast(`${name}: ${(err as Error).message}`);
      return;
    }
    if (!r.changed) {
      const info = (r as Partial<ReturnType<typeof ops.midpointRoot>>).info;
      return setLast(
        info
          ? `${name}: nothing to change, the root already is the midpoint of the longest tip-to-tip path (${tree.labels[info.tips[0]]} to ${tree.labels[info.tips[1]]}, ${info.diameter.toPrecision(4)})`
          : `${name}: nothing to change`,
      );
    }
    const next = new TreeModel(r.tree);
    const ms = performance.now() - t0;
    const notes: string[] = [];
    const followed = ops.followClades(
      tree,
      next,
      r.map,
      clades.map((c) => c.node),
      { onSplit: splitColour === 'node' ? 'keep' : 'drop' },
    );
    const kept = clades.flatMap((c, i) => {
      const k = c.node;
      const { node, split } = followed[i];
      if (split && node >= 0)
        notes.push(
          `⚠ a colour stayed on its node, which now holds ${next.tipCountOf(node).toLocaleString('en')} tips instead of ${tree.tipCountOf(k).toLocaleString('en')}`,
        );
      else if (split) notes.push('a colour was removed: its tips are no longer one clade');
      return node >= 0 ? [{ ...c, node }] : [];
    });
    // collapsed clades follow their tips the same way; one the operation split is expanded
    const keptCollapsed = ops
      .followClades(tree, next, r.map, collapsed)
      .map((f) => f.node)
      .filter((m) => m >= 0 && next.childCount[m] > 0);
    // so does the focus (a focused clade the operation split is left: back skips it)
    const keptFocus = ops.remapFocus(focus, tree, next, r.map);
    setHl((h) => h.map((v) => r.map[v]).filter((k) => k >= 0)); // a highlighted tip an operation removed is dropped
    setClades(kept);
    setCollapsed(keptCollapsed);
    setFocus(keptFocus);
    setMove({ from: tree, to: next, map: r.map });
    setHistory((h) =>
      trimHistory(
        [
          ...h.slice(0, -1),
          { ...h[h.length - 1], clades, collapsed, focus }, // keeps the map that made it
          { tree: next, clades: kept, collapsed: keptCollapsed, focus: keptFocus, map: r.map },
        ],
        undoBudget,
      ),
    );
    setLast(
      `${name}: ${ms.toFixed(1)} ms for ${tree.tipCount.toLocaleString('en')} tips (${next.tipCount.toLocaleString('en')} after)${notes.map((n) => ` · ${n}`).join('')}`,
    );
  };
  const back = (to: number) => {
    // the way back to entry `to - 1`: the actions undone, last first, each map turned around and chained
    let way: Int32Array | null = null;
    for (let k = history.length - 1; k >= to; k--) {
      const inv = ops.invertMap(history[k].map!, history[k].tree.nodeCount);
      way = way ? ops.composeMaps(way, inv) : inv;
    }
    if (way) {
      const w = way;
      setMove({ from: tree, to: history[to - 1].tree, map: w });
      setHl((h) => h.map((v) => w[v]).filter((k) => k >= 0)); // the highlighted tip goes back with the tree
    }
    setHistory((h) => h.slice(0, to));
    setClades(history[to - 1].clades);
    setCollapsed(history[to - 1].collapsed);
    setFocus(history[to - 1].focus);
    setLast(to === 1 ? 'reset to the tree as published' : 'undone');
  };
  // focus (show only a clade): a navigation, so not in the undo history; Back and Up one level come from tree-ops' focus
  const navigate = (f: ops.Focus, msg: string) => {
    setFocus(f);
    setLast(msg);
  };
  const focusMsg = (f: ops.Focus) => {
    const v = ops.focusedNode(f);
    return v < 0 ? 'showing the whole tree' : `showing only a clade of ${tree.tipCountOf(v).toLocaleString('en')} tips`;
  };
  const goUp = () => {
    const f = ops.focusUp(tree, focus);
    navigate(f, focusMsg(f));
  };
  const goBack = () => {
    const f = ops.focusBack(focus);
    navigate(f, focusMsg(f));
  };
  const toggleColour = (node: number) =>
    setClades((cs) =>
      cs.some((c) => c.node === node) ? cs.filter((c) => c.node !== node) : [...cs, { node, colour: palette[cs.length % palette.length] }],
    );

  // per-node actions: what the node menu offers for the clicked tip or clade
  const nodeMenu = (e: TreeNodeEvent): NodeMenuItem[] => {
    if (e.run) return []; // a run of small siblings is not one node
    const v = view ? view.toTree[e.node] : e.node; // actions work on the tree, not on its view (focus and support only)
    const isCollapsed = e.collapsed;
    const isTip = e.isTip;
    const what = isTip ? 'tip' : 'clade';
    const tips = tree.tipCountOf(v);
    const coloured = clades.some((c) => c.node === v);
    const items: NodeMenuItem[] = [];
    // the root of a focused clade (the shown tree's root) leads out of it
    if (e.node === 0 && ops.canGoUp(focus)) {
      items.push({ id: 'up', label: 'Up one level', hint: 'show the clade that contains this one', onSelect: () => goUp() });
      items.push({ id: 'back', label: 'Back', hint: 'to the view before', onSelect: () => goBack() });
    }
    if (isCollapsed)
      items.push({
        id: 'expand',
        label: 'Expand',
        hint: `show its ${tips.toLocaleString('en')} tips again`,
        onSelect: () => setCollapsed((cs) => cs.filter((c) => c !== v)),
      });
    if (!e.isTip)
      items.push({
        id: 'rotate',
        label: 'Rotate',
        hint: 'swap the order of its branches',
        disabled: tree.childCount[v] < 2,
        onSelect: () => apply('rotate', (t) => ops.rotate(t, v)),
      });
    items.push({
      id: 'reroot',
      label: 'Reroot here',
      hint: `root on the branch above this ${what}`,
      disabled: v === 0,
      onSelect: () => apply('reroot', (t) => ops.reroot(t, v)),
    });
    if (!isTip)
      items.push({
        id: 'subtree',
        label: 'Show only this clade',
        hint: `${tips.toLocaleString('en')} tips; Back or Up one level return`,
        disabled: e.node === 0, // already the clade shown
        onSelect: () => navigate(ops.focusOn(tree, focus, v), `showing only a clade of ${tips.toLocaleString('en')} tips`),
      });
    if (!e.isTip && !isCollapsed)
      items.push({
        id: 'collapse',
        label: 'Collapse',
        hint: `show its ${tips.toLocaleString('en')} tips as one triangle`,
        disabled: e.node === 0, // the root of what is shown (the whole tree, or the clade shown alone) is not collapsed
        onSelect: () => setCollapsed((cs) => [...cs, v]),
      });
    if (isTip)
      items.push({
        id: 'remove',
        label: 'Remove this tip',
        hint: 'prune the tip',
        disabled: tree.tipCount <= 2,
        onSelect: () => apply('remove tip', (t) => ops.prune(t, (r) => r !== t.tipRank[v])),
      });
    // a tip is coloured only when a kept colour's node became a tip (rule 'node' after a prune), so it offers only removal
    if (!isTip || coloured) items.push({ id: 'colour', label: coloured ? 'Remove colour' : 'Colour this clade', onSelect: () => toggleColour(v) });
    return items;
  };
  const onClick = (e: TreeNodeEvent) => {
    // a clicked tip is highlighted; a clicked clade is not (it was: its first five tips, which read as if the click had selected
    // them). Colouring a clade is the menu's job.
    // by node, so only the clicked tip when the tree repeats a label; the event's node is in the shown tree, `hl` is in `tree`'s
    setHl(e.isTip ? [view ? view.toTree[e.node] : e.node] : []);
    setLast(e.isTip ? `tip ${e.tipId}` : `${e.kind} ${e.node}: ${e.tipCount} tips, range [${e.tipStart}, ${e.tipEnd})`);
  };

  const shown = view?.tree ?? tree;
  const shownClades = view
    ? clades.flatMap((c) => {
        const k = view.toView[c.node];
        return k >= 0 ? [{ ...c, node: k }] : [];
      })
    : clades;
  // the collapsed clades in the shown tree's ids (the same as `tree`'s while no view is on; a clade that focus left out, or that collapse
  // by support contracted into its parent, has none)
  const shownCollapsed = view ? collapsed.map((v) => view.toView[v]).filter((k) => k > 0) : collapsed;
  const shownHl = view ? hl.map((v) => view.toView[v]).filter((k) => k >= 0) : hl; // a tip the view left out has none
  const common = {
    tree: shown,
    treeMap,
    clades: shownClades,
    highlighted: shownHl,
    collapsed: shownCollapsed,
    viewport: vp,
    onViewportChange: setVp,
    onNodeClick: onClick,
    onTipClick: onClick,
    nodeMenu,
    tipHref: (id: string) => `https://www.gbif.org/species/search?q=${encodeURIComponent(id.replace(/_/g, ' '))}`,
  };
  const btn = 'btn btn-secondary';
  return (
    <div
      style={{
        font: '14px var(--font-body)',
        padding: 12,
        color: 'var(--fg1)',
        background: 'var(--bg-surface)',
        height: '100vh',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column', // toolbar, status, the two panes (the rest of the height), build footer
      }}
    >
      <div
        role="toolbar"
        aria-label="Whole-tree actions"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-2)' }}
      >
        <button
          className="btn btn-outline"
          disabled={!ops.canGoBack(focus)}
          title="Back to the view before (Show only this clade / Up one level)"
          onClick={goBack}
        >
          ← Back
        </button>
        <button className="btn btn-outline" disabled={!ops.canGoUp(focus)} title="Show the clade that contains the one shown" onClick={goUp}>
          ↑ Up one level
        </button>
        <button
          className={btn}
          disabled={!tree.hasLengths}
          title={tree.hasLengths ? 'Root halfway along the longest tip-to-tip path' : 'needs branch lengths'}
          onClick={() => apply('midpoint root', ops.midpointRoot)}
        >
          Midpoint root
        </button>
        <button className={btn} title="Smaller clades first" onClick={() => apply('ladderise', (t) => ops.ladderise(t))}>
          Ladderise ↑
        </button>
        <button
          className={btn}
          title="Larger clades first"
          onClick={() => apply('ladderise (decreasing)', (t) => ops.ladderise(t, { order: 'decreasing' }))}
        >
          Ladderise ↓
        </button>
        <label
          style={{ display: 'inline-flex', gap: 'var(--space-1)', alignItems: 'center' }}
          title={
            hasSupport
              ? 'Show branches with support below the value collapsed into polytomies. A view only: change or clear it to get them back.'
              : 'this tree has no support values'
          }
        >
          <input
            type="checkbox"
            checked={collapseOn && hasSupport}
            disabled={!hasSupport}
            onChange={(e) => {
              setCollapseOn(e.target.checked);
            }}
          />
          Collapse support &lt;
          <input
            type="number"
            aria-label="Minimum support"
            value={minSupport}
            min={0}
            step={supportRange && supportRange.hi <= 1 ? 0.05 : 1}
            disabled={!hasSupport}
            onChange={(e) => {
              setMinSupport(Number(e.target.value));
            }}
            style={{ width: 72, font: 'inherit', padding: '4px 6px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)' }}
          />
          {supportRange && (
            <span style={{ color: 'var(--fg3)', fontSize: 'var(--text-sm)' }}>
              {view?.supportCollapsed ? `${view.supportCollapsed.toLocaleString('en')} collapsed · ` : ''}support {supportRange.lo}–{supportRange.hi}
            </span>
          )}
        </label>
        <label
          style={{ display: 'inline-flex', gap: 'var(--space-1)', alignItems: 'center' }}
          title="What happens to a clade colour when an action (e.g. rerooting inside the clade) leaves its tips no longer one clade"
        >
          Split colour:
          <select
            aria-label="When a colour's tips are no longer one clade"
            value={splitColour}
            onChange={(e) => setSplitColour(e.target.value as SplitColour)}
            style={{ font: 'inherit', padding: '4px 6px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)' }}
          >
            <option value="remove">remove it</option>
            <option value="node">keep on its node (warn)</option>
          </select>
        </label>
        <button
          className={btn}
          disabled={uncolouredClades.length === 0}
          title="Collapse every largest clade that has no coloured tips into a triangle"
          onClick={() => setCollapsed((cs) => [...new Set([...cs, ...uncolouredClades])])}
        >
          Collapse uncoloured ({uncolouredClades.length.toLocaleString('en')})
        </button>
        <button className={btn} disabled={collapsed.length === 0} onClick={() => setCollapsed([])}>
          Expand all
        </button>
        <UndoControls
          canUndo={canUndo}
          canReset={history.length > 1}
          undoOn={undoOn}
          onUndo={() => back(history.length - 1)}
          onReset={() => back(1)}
        />
      </div>
      <p style={{ margin: '0 0 8px' }} aria-live="polite">
        {last} · {changes > 0 ? `${changes} change${changes > 1 ? 's' : ''} by you, not as published` : 'tree as published'} · {clades.length}{' '}
        coloured clades
      </p>
      <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
        <div className="card" style={{ flex: 1, minWidth: 0, background: 'var(--bg1)' }}>
          <TreeView ref={leftPane} {...common} branchLengths controls={leftControls} />
        </div>
        <div className="card" style={{ flex: 1, minWidth: 0, background: 'var(--bg1)' }}>
          <TreeView ref={rightPane} {...common} branchLengths={false} />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
