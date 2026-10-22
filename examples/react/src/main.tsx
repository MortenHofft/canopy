// React example: <TreeView> used the way a gbif.org page would use it. Two instances share ONE controlled viewport (pan or zoom
// either one and the other follows), and the callbacks write into plain React state. `npm run dev` in this folder, then open the
// printed URL (?tree=<id> picks a tree from src/trees.ts).
//
// Tree operations come from @gbif-phylo/tree-ops (no rendering in there) and this page is the only place the two meet:
// clicking a tip or clade opens <TreeView>'s node menu with per-node actions (rotate, reroot here, ...), the toolbar holds
// whole-tree actions (midpoint root, ladderise, collapse by support). Each action returns a new tree that replaces the one
// shown; the tree as published is kept for undo and reset and never changed.

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@gbif-phylo/viewer/viewer.css';
import '@gbif-phylo/viewer/gbif.css';
import './gbif-tokens.css';
import { gbifTheme } from './gbif-theme.ts';
import { loadTree } from './trees.ts';
import { TreeModel } from '@gbif-phylo/io';
import * as ops from '@gbif-phylo/tree-ops';
import { TreeView, type CladeProp, type NodeMenuItem, type TreeNodeEvent, type TreeViewHandle } from '@gbif-phylo/react';
import { defaultControls, type Viewport } from '@gbif-phylo/viewer';

/** What happens to a clade colour whose tips an operation splits (rerooting inside the clade puts its tips on both sides of the new
 *  root, so they are no longer one clade): 'remove' it, or keep it on the 'node' that was coloured, which now holds other tips
 *  (tree-ops' `onSplit: 'drop'` and `'keep'`). */
type SplitColour = 'remove' | 'node';

function App() {
  const params = new URLSearchParams(location.search);
  // [as published, ...each action's result]; `clades` and `collapsed` are what the entry had when the next action was applied, so
  // undo restores them exactly; `map` is the node map of the action that made the entry (the tree before -> this tree)
  const [history, setHistory] = useState<{ tree: TreeModel; clades: CladeProp[]; collapsed: number[]; focus: ops.Focus; map?: Int32Array }[]>([]);
  const tree = history[history.length - 1]?.tree ?? null;
  const [clades, setClades] = useState<CladeProp[]>([]);
  const [collapsed, setCollapsed] = useState<number[]>([]); // clades shown collapsed (node ids of `tree`), a view like collapse by support
  const [focus, setFocus] = useState<ops.Focus>(ops.NO_FOCUS); // the clade shown alone, with back and up (tree-ops' focus)
  const [hl, setHl] = useState<string[]>([]);
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
  // the viewers take their look from @gbif-phylo/viewer/gbif.css (CSS custom properties); the palette for clade colours comes from the
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
  // What is shown is a VIEW of the current tree, not a step in its history: collapse by support (recomputed when the threshold
  // changes, so a lower one brings branches back), then the collapsed clades (each replaced by one tip, drawn as a triangle;
  // expanding brings it back). Colours, collapsed clades and menu actions stay in `tree`'s node ids; `toView` maps a node of
  // `tree` to the view (-1: hidden), `toTree` the other way; `collapsedTips` are the view's tips that stand for collapsed clades.
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
    // collapsed clades before collapse by support: a collapsed clade is then a tip, which the support collapse never removes (the
    // other way round, a collapsed node with low support was contracted first and its triangle lost)
    const toShown = (v: number) => (acc.toView ? acc.toView[v] : v);
    const inShown = collapsed.map(toShown).filter((v) => v > 0); // the shown root is not collapsed
    let collapsedTips: number[] = [];
    if (inShown.length) {
      const r = ops.collapseClades(acc.shown, inShown);
      if (step(r)) collapsedTips = inShown.map((v) => r.map[v]).filter((v) => v >= 0);
    }
    let supportCollapsed = 0;
    if (collapseOn && hasSupport) {
      const before = acc.shown.nodeCount;
      const r = ops.collapseBySupport(acc.shown, minSupport);
      if (step(r)) {
        supportCollapsed = before - acc.shown.nodeCount;
        collapsedTips = collapsedTips.map((v) => r.map[v]); // tips are kept
      }
    }
    const { shown, toView } = acc;
    if (!toView) return null;
    return { tree: shown, toView, toTree: ops.invertMap(toView, shown.nodeCount), supportCollapsed, collapsedIds: collapsedTips.map((n) => 'n' + n) };
  }, [tree, focus, collapseOn, hasSupport, minSupport, collapsed]);
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
  // for the browser check (tests/browser/scripts/check-node-menu.mjs): the two viewers
  const leftPane = useRef<TreeViewHandle>(null);
  const rightPane = useRef<TreeViewHandle>(null);
  useEffect(() => {
    (window as unknown as { __panes?: () => unknown }).__panes = () => [leftPane.current?.renderer() ?? null, rightPane.current?.renderer() ?? null];
  }, []);
  const colouredTips = useMemo(() => {
    let n = 0;
    if (!tree) return { keep: new Uint8Array(0), n };
    const keep = new Uint8Array(tree.tipCount);
    for (const c of clades) {
      const k = Number(c.nodeId.slice(1));
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
      clades.map((c) => Number(c.nodeId.slice(1))),
      { onSplit: splitColour === 'node' ? 'keep' : 'drop' },
    );
    const kept = clades.flatMap((c, i) => {
      const k = Number(c.nodeId.slice(1));
      const { node, split } = followed[i];
      if (split && node >= 0)
        notes.push(
          `⚠ a colour stayed on its node, which now holds ${next.tipCountOf(node).toLocaleString('en')} tips instead of ${tree.tipCountOf(k).toLocaleString('en')}`,
        );
      else if (split) notes.push('a colour was removed: its tips are no longer one clade');
      return node >= 0 ? [{ ...c, nodeId: 'n' + node }] : [];
    });
    // collapsed clades follow their tips the same way; one the operation split is expanded
    const keptCollapsed = ops
      .followClades(tree, next, r.map, collapsed)
      .map((f) => f.node)
      .filter((m) => m >= 0 && next.childCount[m] > 0);
    // so does the focus (a focused clade the operation split is left: back skips it)
    const keptFocus = ops.remapFocus(focus, tree, next, r.map);
    setClades(kept);
    setCollapsed(keptCollapsed);
    setFocus(keptFocus);
    setMove({ from: tree, to: next, map: r.map });
    setHistory((h) => [
      ...h.slice(0, -1),
      { ...h[h.length - 1], clades, collapsed, focus }, // keeps the map that made it
      { tree: next, clades: kept, collapsed: keptCollapsed, focus: keptFocus, map: r.map },
    ]);
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
    if (way) setMove({ from: tree, to: history[to - 1].tree, map: way });
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
  const toggleColour = (nodeId: string) =>
    setClades((cs) =>
      cs.some((c) => c.nodeId === nodeId) ? cs.filter((c) => c.nodeId !== nodeId) : [...cs, { nodeId, colour: palette[cs.length % palette.length] }],
    );

  // per-node actions: what the node menu offers for the clicked tip or clade
  const nodeMenu = (e: TreeNodeEvent): NodeMenuItem[] => {
    if (e.run) return []; // a run of small siblings is not one node
    const v = view ? view.toTree[e.node] : e.node; // actions work on the tree, not on its view
    const nodeId = 'n' + v;
    const isCollapsed = e.isTip && tree.childCount[v] > 0; // a tip of the view that stands for a collapsed clade
    const isTip = e.isTip && !isCollapsed;
    const what = isTip ? 'tip' : 'clade';
    const tips = tree.tipCountOf(v);
    const coloured = clades.some((c) => c.nodeId === nodeId);
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
    if (!e.isTip)
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
    if (!isTip || coloured)
      items.push({ id: 'colour', label: coloured ? 'Remove colour' : 'Colour this clade', onSelect: () => toggleColour(nodeId) });
    return items;
  };
  const onClick = (e: TreeNodeEvent) => {
    // a clicked tip is highlighted; a clicked clade is not (it was: its first five tips, which read as if the click had selected
    // them). Colouring a clade is the menu's job.
    setHl(e.isTip && e.tipId ? [e.tipId] : []);
    setLast(e.isTip ? `tip ${e.tipId}` : `${e.kind} ${e.nodeId}: ${e.tipCount} tips, range [${e.tipStart}, ${e.tipEnd})`);
  };

  const shown = view?.tree ?? tree;
  const shownClades = view
    ? clades.flatMap((c) => {
        const k = view.toView[Number(c.nodeId.slice(1))];
        return k >= 0 ? [{ ...c, nodeId: 'n' + k }] : [];
      })
    : clades;
  const common = {
    tree: shown,
    treeMap,
    clades: shownClades,
    highlighted: hl,
    collapsed: view?.collapsedIds,
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
        <button className="btn btn-outline" disabled={history.length < 2} onClick={() => back(history.length - 1)}>
          Undo
        </button>
        <button className="btn btn-outline" disabled={history.length < 2} onClick={() => back(1)}>
          Reset
        </button>
      </div>
      <p style={{ margin: '0 0 8px' }} aria-live="polite">
        {last} · {history.length > 1 ? `${history.length - 1} change${history.length > 2 ? 's' : ''} by you, not as published` : 'tree as published'}{' '}
        · {clades.length} coloured clades
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
