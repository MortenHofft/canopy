// Dev-only page (not part of the production build): <TreeView> used the way a gbif.org page would use it, without
// the harness shell. Two instances share ONE controlled viewport (pan or zoom either one and the other follows),
// a click colours the clade in both, and the callbacks write into plain React state. Open /demo.html in `npm run dev`.

import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../shared/gbif-tokens.css';
import { gbifTheme } from '../../shared/gbif-theme.ts';
import { loadTree } from '../../shared/data.ts';
import { parseNewick } from '../../shared/newick.ts';
import type { TreeModel } from '../../shared/tree.ts';
import { TreeView, type CladeProp, type TreeNodeEvent } from './react/TreeView.tsx';
import type { Viewport } from './core/types.ts';

function App() {
  const params = new URLSearchParams(location.search);
  const [tree, setTree] = useState<TreeModel | null>(null);
  const [clades, setClades] = useState<CladeProp[]>([]);
  const [hl, setHl] = useState<string[]>([]);
  const [vp, setVp] = useState<Viewport | undefined>(undefined);
  const [last, setLast] = useState('click a clade or a tip');
  // Runs once: `params` is rebuilt on every render but only read here for the initial tree name.
  useEffect(() => {
    void loadTree(params.get('tree') ?? 'rich-corvoid-680').then((t) => setTree(parseNewick(t.newick)));
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
  if (!tree) return <p style={{ padding: 16 }}>loading…</p>;
  const palette = g.categorical;
  const onNode = (e: TreeNodeEvent) => {
    setClades((cs) =>
      cs.some((c) => c.nodeId === e.nodeId)
        ? cs.filter((c) => c.nodeId !== e.nodeId)
        : [...cs, { nodeId: e.nodeId, colour: palette[cs.length % palette.length] }],
    );
    setHl(e.tipIds().slice(0, 5));
    setLast(`${e.kind} ${e.nodeId}: ${e.tipCount} tips, range [${e.tipRange.join(', ')})`);
  };
  const common = {
    tree,
    clades,
    highlighted: hl,
    theme,
    viewport: vp,
    onViewportChange: setVp,
    onNodeClick: onNode,
    onTipClick: (e: TreeNodeEvent) => setLast(`tip ${e.tipId}`),
    tipHref: (id: string) => `https://www.gbif.org/species/search?q=${encodeURIComponent(id.replace(/_/g, ' '))}`,
  };
  return (
    <div
      style={{
        font: '14px var(--font-body)',
        padding: 12,
        color: 'var(--fg1)',
        background: 'var(--bg-surface)',
        minHeight: '100vh',
        boxSizing: 'border-box',
      }}
    >
      <p style={{ margin: '0 0 8px' }}>
        {last} · viewport{' '}
        {vp ? `y ${vp.y0.toFixed(1)}..${vp.y1.toFixed(1)}, x ${vp.x0.toFixed(3)}..${vp.x1.toFixed(3)}` : 'uncontrolled until the first change'} ·{' '}
        {clades.length} coloured clades
      </p>
      <div style={{ display: 'flex', gap: 12, height: 'calc(100vh - 60px)' }}>
        <div className="card" style={{ flex: 1, minWidth: 0, background: 'var(--bg1)' }}>
          <TreeView {...common} branchLengths />
        </div>
        <div className="card" style={{ flex: 1, minWidth: 0, background: 'var(--bg1)' }}>
          <TreeView {...common} branchLengths={false} options={{ overview: false }} />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
