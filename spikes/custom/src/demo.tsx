// Standalone page: <TreeView> used the way a gbif.org page would use it, without the harness shell. Two instances share ONE
// controlled viewport (pan or zoom either one and the other follows), and the callbacks write into plain React state. Open
// /demo.html in `npm run dev`; `npm run build:demo` builds it into dist-demo/ (not dist/, so not part of the measured bundle) and
// scripts/build-site.mjs publishes it at /custom/demo.
//
// Tree operations come from packages/tree-ops (no rendering in there) and this page is the only place the two meet:
// clicking a tip or clade opens <TreeView>'s node menu with per-node actions (rotate, reroot here, ...), the toolbar holds
// whole-tree actions (midpoint root, ladderise, collapse by support). Each action returns a new tree that replaces the one
// shown; the tree as published is kept for undo and reset and never changed.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../shared/gbif-tokens.css';
import { gbifTheme } from '../../shared/gbif-theme.ts';
import { showBuildInfo } from '../../shared/build-info.ts';
import { loadTree } from '../../shared/data.ts';
import { parseNewick } from '../../shared/newick.ts';
import { TreeModel } from '../../shared/tree.ts';
import * as ops from '../../../packages/tree-ops/src/index.ts';
import { TreeView, type CladeProp, type NodeMenuItem, type TreeNodeEvent } from './react/TreeView.tsx';
import type { Viewport } from './core/types.ts';

/** What happens to a clade colour whose tips an operation splits (rerooting inside the clade puts its tips on both sides of the new
 *  root, so they are no longer one clade): 'remove' it, or keep it on the 'node' that was coloured, which now holds other tips. */
type SplitColour = 'remove' | 'node';

/** Where a clade colour goes after an operation. A colour stands for the tips of clade `k` of `tree` that survive in `next` (through
 *  `map`); if they still form one clade it moves there (`tipsBefore === tipsAfter`). If they do not, `rule` decides: no node
 *  ('remove'), or the coloured node itself if it survived ('node'; the caller warns that it now holds other tips). */
function moveColour(tree: TreeModel, next: TreeModel, map: Int32Array, k: number, rule: SplitColour): { node: number; split: boolean } {
  const tips: number[] = [];
  for (let rk = tree.leafStart[k]; rk < tree.leafEnd[k]; rk++) {
    const v = map[tree.tipNode[rk]];
    if (v >= 0) tips.push(v);
  }
  if (!tips.length) return { node: -1, split: false }; // all pruned
  const m = next.mrcaOf(tips);
  if (next.tipCountOf(m) === tips.length) return { node: m, split: false };
  return { node: rule === 'node' ? map[k] : -1, split: true };
}

/** Which build this is (commit, branch, time), from the site's /version.json; as on the harness pages. */
function BuildFooter() {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    void showBuildInfo(ref.current);
  }, []);
  return (
    <p ref={ref} style={{ margin: '8px 0 0' }}>
      Build: …
    </p>
  );
}

function App() {
  const params = new URLSearchParams(location.search);
  // [as published, ...each action's result]; `clades` and `collapsed` are what the entry had when the next action was applied, so
  // undo restores them exactly
  const [history, setHistory] = useState<{ tree: TreeModel; clades: CladeProp[]; collapsed: number[]; focus: ops.Focus }[]>([]);
  const tree = history[history.length - 1]?.tree ?? null;
  const [clades, setClades] = useState<CladeProp[]>([]);
  const [collapsed, setCollapsed] = useState<number[]>([]); // clades shown collapsed (node ids of `tree`), a view like collapse by support
  const [focus, setFocus] = useState<ops.Focus>(ops.NO_FOCUS); // the clade shown alone, with back and up (tree-ops' focus)
  const [hl, setHl] = useState<string[]>([]);
  const [vp, setVp] = useState<Viewport | undefined>(undefined);
  const [last, setLast] = useState('click a tip or a clade for its actions');
  const [minSupport, setMinSupport] = useState(70);
  const [collapseOn, setCollapseOn] = useState(false);
  const [splitColour, setSplitColour] = useState<SplitColour>('remove');
  // Runs once: `params` is rebuilt on every render but only read here for the initial tree name.
  useEffect(() => {
    void loadTree(params.get('tree') ?? 'rich-corvoid-680').then((t) =>
      setHistory([{ tree: parseNewick(t.newick), clades: [], collapsed: [], focus: ops.NO_FOCUS }]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const g = useMemo(() => gbifTheme(), []);
  const theme = useMemo(
    () => ({
      background: g.bg1,
      foreground: g.fg1,
      muted: g.fg3,
      branch: g.fg2,
      highlight: g.primary,
      summary: g.slate400,
      fontFamily: g.fontBody,
      categorical: g.categorical,
    }),
    [g],
  );
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
      const first = acc.toView;
      acc.toView = first ? first.map((v) => (v >= 0 ? r.map[v] : -1)) : r.map;
      acc.shown = new TreeModel(r.tree);
      return true;
    };
    step(ops.showFocus(tree, focus));
    let supportCollapsed = 0;
    if (collapseOn && hasSupport) {
      const before = acc.shown.nodeCount;
      if (step(ops.collapseBySupport(acc.shown, minSupport))) supportCollapsed = before - acc.shown.nodeCount;
    }
    const toShown = (v: number) => (acc.toView ? acc.toView[v] : v);
    const inShown = collapsed.map(toShown).filter((v) => v > 0); // the shown root is not collapsed
    let collapsedTips: number[] = [];
    if (inShown.length) {
      const r = ops.collapseClades(acc.shown, inShown);
      if (step(r)) collapsedTips = inShown.map((v) => r.map[v]).filter((v) => v >= 0);
    }
    const { shown, toView } = acc;
    if (!toView) return null;
    const toTree = new Int32Array(shown.nodeCount);
    for (let i = 0; i < toView.length; i++) if (toView[i] >= 0) toTree[toView[i]] = i;
    return { tree: shown, toView, toTree, supportCollapsed, collapsedIds: collapsedTips.map((n) => 'n' + n) };
  }, [tree, focus, collapseOn, hasSupport, minSupport, collapsed]);
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
  const uncolouredClades = useMemo(() => {
    if (!tree || colouredTips.n === 0) return [];
    const hit = new Int32Array(tree.nodeCount);
    for (let r = 0; r < tree.tipCount; r++) if (colouredTips.keep[r]) hit[tree.tipNode[r]] = 1;
    for (let i = tree.nodeCount - 1; i > 0; i--) hit[tree.parent[i]] += hit[i];
    const out: number[] = [];
    for (let i = 1; i < tree.nodeCount; i++) if (hit[i] === 0 && hit[tree.parent[i]] > 0 && tree.childCount[i] > 0) out.push(i);
    return out;
  }, [tree, colouredTips]);

  if (!tree) return <p style={{ padding: 16 }}>loading…</p>;
  const palette = g.categorical;

  /** Run a tree operation on the current tree. A clade colour is carried over by its tips (see moveColour): it goes to the clade
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
    const kept = clades.flatMap((c) => {
      const k = Number(c.nodeId.slice(1));
      const { node, split } = moveColour(tree, next, r.map, k, splitColour);
      if (split && node >= 0)
        notes.push(
          `⚠ a colour stayed on its node, which now holds ${next.tipCountOf(node).toLocaleString('en')} tips instead of ${tree.tipCountOf(k).toLocaleString('en')}`,
        );
      else if (split) notes.push('a colour was removed: its tips are no longer one clade');
      return node >= 0 ? [{ ...c, nodeId: 'n' + node }] : [];
    });
    // collapsed clades follow their tips the same way; one the operation split is expanded
    const keptCollapsed = collapsed.flatMap((k) => {
      const m = moveColour(tree, next, r.map, k, 'remove').node;
      return m >= 0 && next.childCount[m] > 0 ? [m] : [];
    });
    // so does the focus (a focused clade the operation split is left: back skips it)
    const keptFocus = ops.remapFocus(focus, (k) => {
      const m = moveColour(tree, next, r.map, k, 'remove').node;
      return m > 0 && next.childCount[m] > 0 ? m : -1;
    });
    setClades(kept);
    setCollapsed(keptCollapsed);
    setFocus(keptFocus);
    setVp(undefined); // the new tree is fitted when its renderer mounts
    setHistory((h) => [
      ...h.slice(0, -1),
      { tree, clades, collapsed, focus },
      { tree: next, clades: kept, collapsed: keptCollapsed, focus: keptFocus },
    ]);
    setLast(
      `${name}: ${ms.toFixed(1)} ms for ${tree.tipCount.toLocaleString('en')} tips (${next.tipCount.toLocaleString('en')} after)${notes.map((n) => ` · ${n}`).join('')}`,
    );
  };
  const back = (to: number) => {
    setHistory((h) => h.slice(0, to));
    setClades(history[to - 1].clades);
    setCollapsed(history[to - 1].collapsed);
    setFocus(history[to - 1].focus);
    setVp(undefined);
    setLast(to === 1 ? 'reset to the tree as published' : 'undone');
  };
  // focus (show only a clade): a navigation, so not in the undo history; Back and Up one level come from tree-ops' focus
  const navigate = (f: ops.Focus, msg: string) => {
    setFocus(f);
    setVp(undefined);
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
        disabled: v === 0,
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
    setLast(e.isTip ? `tip ${e.tipId}` : `${e.kind} ${e.nodeId}: ${e.tipCount} tips, range [${e.tipRange.join(', ')})`);
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
    clades: shownClades,
    highlighted: hl,
    collapsed: view?.collapsedIds,
    theme,
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
              setVp(undefined);
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
              setVp(undefined);
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
          <TreeView {...common} branchLengths />
        </div>
        <div className="card" style={{ flex: 1, minWidth: 0, background: 'var(--bg1)' }}>
          <TreeView {...common} branchLengths={false} options={{ overview: false }} />
        </div>
      </div>
      <BuildFooter />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
