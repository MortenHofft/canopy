// Dev-only page (not part of the production build): <TreeView> used the way a gbif.org page would use it, without
// the harness shell. Two instances share ONE controlled viewport (pan or zoom either one and the other follows),
// a click colours the clade in both, and the callbacks write into plain React state. Open /demo.html in `npm run dev`.
// The toolbar applies the user-triggered tree operations of shared/ops.ts (reroot, midpoint, ladderise, ...): each one
// returns a new tree that replaces the one shown; the original is kept for undo and reset, never changed.

import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../shared/gbif-tokens.css';
import { gbifTheme } from '../../shared/gbif-theme.ts';
import { loadTree } from '../../shared/data.ts';
import { parseNewick } from '../../shared/newick.ts';
import type { TreeModel } from '../../shared/tree.ts';
import { collapseBySupport, ladderise, midpointRoot, prune, reroot, rotate, subtree, type OpResult } from '../../shared/ops.ts';
import { TreeView, type CladeProp, type TreeNodeEvent } from './react/TreeView.tsx';
import type { Viewport } from './core/types.ts';

function App() {
  const params = new URLSearchParams(location.search);
  const [history, setHistory] = useState<TreeModel[]>([]); // [original, ...each operation's result]
  const tree = history[history.length - 1] ?? null;
  const [clades, setClades] = useState<CladeProp[]>([]);
  const [hl, setHl] = useState<string[]>([]);
  const [selected, setSelected] = useState<number | null>(null); // node index of the last clicked tip or clade
  const [vp, setVp] = useState<Viewport | undefined>(undefined);
  const [last, setLast] = useState('click a clade or a tip');
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
  const onNode = (e: TreeNodeEvent) => {
    setSelected(e.node);
    setClades((cs) => (cs.some((c) => c.nodeId === e.nodeId) ? cs.filter((c) => c.nodeId !== e.nodeId) : [...cs, { nodeId: e.nodeId, colour: palette[cs.length % palette.length] }]));
    setHl(e.tipIds().slice(0, 5));
    setLast(`${e.kind} ${e.nodeId}: ${e.tipCount} tips, range [${e.tipRange.join(', ')})`);
  };
  const onTip = (e: TreeNodeEvent) => {
    setSelected(e.node);
    setLast(`tip ${e.tipId}`);
  };

  /** Run an operation on the current tree; carry clade colours and the selection over through the node map. */
  const apply = (name: string, op: (t: TreeModel) => OpResult) => {
    let r: OpResult;
    const t0 = performance.now();
    try {
      r = op(tree);
    } catch (err) {
      setLast(`${name}: ${(err as Error).message}`);
      return;
    }
    const ms = performance.now() - t0;
    if (r.tree === tree) return setLast(`${name}: nothing to change`);
    const m = (id: string) => r.map[Number(id.slice(1))] ?? -1;
    setClades((cs) => cs.flatMap((c) => (m(c.nodeId) >= 0 ? [{ ...c, nodeId: 'n' + m(c.nodeId) }] : [])));
    setSelected((s) => (s !== null && r.map[s] >= 0 ? r.map[s] : null));
    setVp(undefined); // the new tree is fitted when its renderer mounts
    setHistory((h) => [...h, r.tree]);
    setLast(`${name}: ${ms.toFixed(1)} ms for ${tree.tipCount.toLocaleString('en')} tips (${r.tree.tipCount.toLocaleString('en')} after)`);
  };
  const back = (to: number) => {
    setHistory((h) => h.slice(0, to));
    setClades([]);
    setSelected(null);
    setVp(undefined);
    setLast(to === 1 ? 'reset to the tree as published' : 'undone');
  };
  const sel = selected !== null && selected < tree.nodeCount ? selected : null;
  const selIsTip = sel !== null && tree.childCount[sel] === 0;
  const common = { tree, clades, highlighted: hl, theme, viewport: vp, onViewportChange: setVp, onNodeClick: onNode, onTipClick: onTip, tipHref: (id: string) => `https://www.gbif.org/species/search?q=${encodeURIComponent(id.replace(/_/g, ' '))}` };
  const btn = 'btn btn-secondary';
  return (
    <div style={{ font: '14px var(--font-body)', padding: 12, color: 'var(--fg1)', background: 'var(--bg-surface)', minHeight: '100vh', boxSizing: 'border-box' }}>
      <div role="toolbar" aria-label="Tree operations" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
        <button className={btn} disabled={sel === null || sel === 0} title="Root on the branch above the selected tip or clade (halfway along it)" onClick={() => apply('reroot', (t) => reroot(t, sel!))}>Root on selected branch</button>
        <button className={btn} disabled={!tree.hasLengths} title={tree.hasLengths ? 'Root halfway along the longest tip-to-tip path' : 'needs branch lengths'} onClick={() => apply('midpoint root', midpointRoot)}>Midpoint root</button>
        <button className={btn} onClick={() => apply('ladderise', (t) => ladderise(t))}>Ladderise ↑</button>
        <button className={btn} onClick={() => apply('ladderise (decreasing)', (t) => ladderise(t, { order: 'decreasing' }))}>Ladderise ↓</button>
        <button className={btn} disabled={sel === null || selIsTip} onClick={() => apply('rotate', (t) => rotate(t, sel!))}>Rotate selected</button>
        <span style={{ display: 'inline-flex', gap: 'var(--space-1)', alignItems: 'center' }}>
          <button className={btn} disabled={!hasSupport} title={hasSupport ? 'Collapse branches with support below the value into polytomies' : 'this tree has no support values'} onClick={() => apply(`collapse support < ${minSupport}`, (t) => collapseBySupport(t, minSupport))}>Collapse support &lt;</button>
          <input type="number" aria-label="Minimum support" value={minSupport} min={0} step={1} onChange={(e) => setMinSupport(Number(e.target.value))} style={{ width: 64, font: 'inherit', padding: '4px 6px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)' }} />
        </span>
        <button className={btn} disabled={sel === null || selIsTip} onClick={() => apply('show clade only', (t) => subtree(t, sel!))}>Selected clade only</button>
        <button className={btn} disabled={colouredTips.n < 2} title="Keep only the tips of the coloured clades" onClick={() => apply('prune to coloured', (t) => prune(t, (r) => colouredTips.keep[r] === 1))}>Prune to coloured ({colouredTips.n.toLocaleString('en')})</button>
        <button className="btn btn-outline" disabled={history.length < 2} onClick={() => back(history.length - 1)}>Undo</button>
        <button className="btn btn-outline" disabled={history.length < 2} onClick={() => back(1)}>Reset</button>
      </div>
      <p style={{ margin: '0 0 8px' }} aria-live="polite">
        {last} · {history.length > 1 ? `${history.length - 1} operation${history.length > 2 ? 's' : ''} applied` : 'tree as published'} · selected {sel === null ? 'nothing' : 'n' + sel} · {clades.length} coloured clades
      </p>
      <div style={{ display: 'flex', gap: 12, height: 'calc(100vh - 110px)' }}>
        <div className="card" style={{ flex: 1, minWidth: 0, background: 'var(--bg1)' }}><TreeView {...common} branchLengths /></div>
        <div className="card" style={{ flex: 1, minWidth: 0, background: 'var(--bg1)' }}><TreeView {...common} branchLengths={false} options={{ overview: false }} /></div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
