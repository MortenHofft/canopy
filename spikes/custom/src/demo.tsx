// Dev-only page (not part of the production build): <TreeView> used the way a gbif.org page would use it, without
// the harness shell. Two instances share ONE controlled viewport (pan or zoom either one and the other follows),
// and the callbacks write into plain React state. Open /demo.html in `npm run dev`.
//
// Tree operations come from packages/tree-ops (no rendering in there) and this page is the only place the two meet:
// clicking a tip or clade opens <TreeView>'s node menu with per-node actions (rotate, reroot here, ...), the toolbar holds
// whole-tree actions (midpoint root, ladderise, collapse by support). Each action returns a new tree that replaces the one
// shown; the tree as published is kept for undo and reset and never changed.

import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../shared/gbif-tokens.css';
import { gbifTheme } from '../../shared/gbif-theme.ts';
import { loadTree } from '../../shared/data.ts';
import { parseNewick } from '../../shared/newick.ts';
import { TreeModel } from '../../shared/tree.ts';
import * as ops from '../../../packages/tree-ops/src/index.ts';
import { TreeView, type CladeProp, type NodeMenuItem, type TreeNodeEvent } from './react/TreeView.tsx';
import type { Viewport } from './core/types.ts';

function App() {
  const params = new URLSearchParams(location.search);
  const [history, setHistory] = useState<TreeModel[]>([]); // [as published, ...each action's result]
  const tree = history[history.length - 1] ?? null;
  const [clades, setClades] = useState<CladeProp[]>([]);
  const [hl, setHl] = useState<string[]>([]);
  const [vp, setVp] = useState<Viewport | undefined>(undefined);
  const [last, setLast] = useState('click a tip or a clade for its actions');
  const [minSupport, setMinSupport] = useState(70);
  useEffect(() => {
    void loadTree(params.get('tree') ?? 'rich-corvoid-680').then((t) => setHistory([parseNewick(t.newick)]));
  }, []);
  const g = useMemo(() => gbifTheme(), []);
  const theme = useMemo(() => ({ background: g.bg1, foreground: g.fg1, muted: g.fg3, branch: g.fg2, highlight: g.primary, summary: g.slate400, fontFamily: g.fontBody, categorical: g.categorical }), [g]);
  const hasSupport = useMemo(() => !!tree && tree.support.some((s) => s === s), [tree]);
  const colouredTips = useMemo(() => {
    let n = 0;
    if (!tree) return { keep: new Uint8Array(0), n };
    const keep = new Uint8Array(tree.tipCount);
    for (const c of clades) {
      const k = Number(c.nodeId.slice(1));
      if (k < tree.nodeCount) for (let r = tree.leafStart[k]; r < tree.leafEnd[k]; r++) if (!keep[r]) { keep[r] = 1; n++; }
    }
    return { keep, n };
  }, [tree, clades]);

  if (!tree) return <p style={{ padding: 16 }}>loading…</p>;
  const palette = g.categorical;

  /** Run a tree operation on the current tree. A clade colour stands for a set of tips, so it is carried over by tips, not by
   *  node: after a reroot the node that held the colour may now hold the complementary tips. It is kept on the MRCA of its
   *  surviving tips if those still form exactly a clade, and dropped (and reported) otherwise. */
  const apply = (name: string, op: (t: TreeModel) => ops.OpResult) => {
    let r: ops.OpResult;
    const t0 = performance.now();
    try {
      r = op(tree);
    } catch (err) {
      setLast(`${name}: ${(err as Error).message}`);
      return;
    }
    if (!r.changed) return setLast(`${name}: nothing to change`);
    const next = new TreeModel(r.tree);
    const ms = performance.now() - t0;
    let dropped = 0;
    const kept = clades.flatMap((c) => {
      const k = Number(c.nodeId.slice(1));
      const tips: number[] = [];
      for (let rk = tree.leafStart[k]; rk < tree.leafEnd[k]; rk++) { const v = r.map[tree.tipNode[rk]]; if (v >= 0) tips.push(v); }
      const m = tips.length ? next.mrcaOf(tips) : -1;
      if (m >= 0 && next.tipCountOf(m) === tips.length) return [{ ...c, nodeId: 'n' + m }];
      dropped++;
      return [];
    });
    setClades(kept);
    setVp(undefined); // the new tree is fitted when its renderer mounts
    setHistory((h) => [...h, next]);
    setLast(`${name}: ${ms.toFixed(1)} ms for ${tree.tipCount.toLocaleString('en')} tips (${next.tipCount.toLocaleString('en')} after)${dropped ? ` · ${dropped} colour${dropped > 1 ? 's' : ''} removed: no longer a clade` : ''}`);
  };
  const back = (to: number) => {
    setHistory((h) => h.slice(0, to));
    setClades([]);
    setVp(undefined);
    setLast(to === 1 ? 'reset to the tree as published' : 'undone');
  };
  const toggleColour = (nodeId: string) =>
    setClades((cs) => (cs.some((c) => c.nodeId === nodeId) ? cs.filter((c) => c.nodeId !== nodeId) : [...cs, { nodeId, colour: palette[cs.length % palette.length] }]));

  // per-node actions: what the node menu offers for the clicked tip or clade
  const nodeMenu = (e: TreeNodeEvent): NodeMenuItem[] => {
    if (e.run) return []; // a run of small siblings is not one node
    const v = e.node;
    const what = e.isTip ? 'tip' : 'clade';
    const coloured = clades.some((c) => c.nodeId === e.nodeId);
    const items: NodeMenuItem[] = [];
    if (!e.isTip) items.push({ id: 'rotate', label: 'Rotate', hint: 'swap the order of its branches', disabled: tree.childCount[v] < 2, onSelect: () => apply('rotate', (t) => ops.rotate(t, v)) });
    items.push({ id: 'reroot', label: 'Reroot here', hint: `root on the branch above this ${what}`, disabled: v === 0, onSelect: () => apply('reroot', (t) => ops.reroot(t, v)) });
    if (!e.isTip) items.push({ id: 'subtree', label: 'Show only this clade', hint: `${e.tipCount.toLocaleString('en')} tips`, disabled: v === 0, onSelect: () => apply('show only this clade', (t) => ops.subtree(t, v)) });
    items.push({
      id: 'remove', label: `Remove this ${what}`, hint: e.isTip ? 'prune the tip' : `prune its ${e.tipCount.toLocaleString('en')} tips`, disabled: v === 0 || e.tipCount >= tree.tipCount - 1,
      onSelect: () => apply(`remove ${what}`, (t) => ops.prune(t, (r) => r < t.leafStart[v] || r >= t.leafEnd[v])),
    });
    if (!e.isTip) items.push({ id: 'colour', label: coloured ? 'Remove colour' : 'Colour this clade', onSelect: () => toggleColour(e.nodeId) });
    return items;
  };
  const onClick = (e: TreeNodeEvent) => {
    setHl(e.isTip ? [] : e.tipIds().slice(0, 5));
    setLast(e.isTip ? `tip ${e.tipId}` : `${e.kind} ${e.nodeId}: ${e.tipCount} tips, range [${e.tipRange.join(', ')})`);
  };

  const common = { tree, clades, highlighted: hl, theme, viewport: vp, onViewportChange: setVp, onNodeClick: onClick, onTipClick: onClick, nodeMenu, tipHref: (id: string) => `https://www.gbif.org/species/search?q=${encodeURIComponent(id.replace(/_/g, ' '))}` };
  const btn = 'btn btn-secondary';
  return (
    <div style={{ font: '14px var(--font-body)', padding: 12, color: 'var(--fg1)', background: 'var(--bg-surface)', minHeight: '100vh', boxSizing: 'border-box' }}>
      <div role="toolbar" aria-label="Whole-tree actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
        <button className={btn} disabled={!tree.hasLengths} title={tree.hasLengths ? 'Root halfway along the longest tip-to-tip path' : 'needs branch lengths'} onClick={() => apply('midpoint root', ops.midpointRoot)}>Midpoint root</button>
        <button className={btn} title="Smaller clades first" onClick={() => apply('ladderise', (t) => ops.ladderise(t))}>Ladderise ↑</button>
        <button className={btn} title="Larger clades first" onClick={() => apply('ladderise (decreasing)', (t) => ops.ladderise(t, { order: 'decreasing' }))}>Ladderise ↓</button>
        <span style={{ display: 'inline-flex', gap: 'var(--space-1)', alignItems: 'center' }}>
          <button className={btn} disabled={!hasSupport} title={hasSupport ? 'Collapse branches with support below the value into polytomies' : 'this tree has no support values'} onClick={() => apply(`collapse support < ${minSupport}`, (t) => ops.collapseBySupport(t, minSupport))}>Collapse support &lt;</button>
          <input type="number" aria-label="Minimum support" value={minSupport} min={0} step={1} onChange={(e) => setMinSupport(Number(e.target.value))} style={{ width: 64, font: 'inherit', padding: '4px 6px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)' }} />
        </span>
        <button className={btn} disabled={colouredTips.n < 2} title="Keep only the tips of the coloured clades" onClick={() => apply('keep coloured', (t) => ops.prune(t, (r) => colouredTips.keep[r] === 1))}>Keep coloured ({colouredTips.n.toLocaleString('en')})</button>
        <button className="btn btn-outline" disabled={history.length < 2} onClick={() => back(history.length - 1)}>Undo</button>
        <button className="btn btn-outline" disabled={history.length < 2} onClick={() => back(1)}>Reset</button>
      </div>
      <p style={{ margin: '0 0 8px' }} aria-live="polite">
        {last} · {history.length > 1 ? `${history.length - 1} change${history.length > 2 ? 's' : ''} by you, not as published` : 'tree as published'} · {clades.length} coloured clades
      </p>
      <div style={{ display: 'flex', gap: 12, height: 'calc(100vh - 110px)' }}>
        <div className="card" style={{ flex: 1, minWidth: 0, background: 'var(--bg1)' }}><TreeView {...common} branchLengths /></div>
        <div className="card" style={{ flex: 1, minWidth: 0, background: 'var(--bg1)' }}><TreeView {...common} branchLengths={false} options={{ overview: false }} /></div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
