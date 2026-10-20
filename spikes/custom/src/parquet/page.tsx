// Dev-only page (not part of the production build): <TreeView> over a ParquetSource, i.e. a tree that is only partly in memory.
//   npm run dev, then open /parquet.html?url=http://127.0.0.1:5210/otl-1m-metazoa[&layout=radial][&level=0]
// `url` is the folder with manifest.json, overview.parquet, nodes.parquet, tips.parquet (a server with Range support, see
// spikes/parquet-experiment/server.mjs). The status line shows what the source has fetched; window.__pq is for the test script.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../shared/gbif-tokens.css';
import { gbifTheme } from '../../../shared/gbif-theme.ts';
import { TreeView, type TreeNodeEvent, type TreeViewHandle } from '../react/TreeView.tsx';
import { ParquetSource } from './ParquetSource.ts';

function App() {
  const params = new URLSearchParams(location.search);
  const url = params.get('url') ?? 'http://127.0.0.1:5210/otl-1m-metazoa';
  const layout = params.get('layout') === 'radial' ? 'radial' : 'rectangular';
  const [src, setSrc] = useState<ParquetSource | null>(null);
  const [err, setErr] = useState('');
  const [last, setLast] = useState('click a triangle or a tip');
  const [tick, setTick] = useState(0);
  const ref = useRef<TreeViewHandle>(null);
  useEffect(() => {
    const t0 = performance.now();
    ParquetSource.open(url, { level: Number(params.get('level') ?? 0) }).then((s) => {
      setSrc(s);
      (window as unknown as Record<string, unknown>).__pq = { source: s, handle: () => ref.current, openMs: performance.now() - t0, events: [] };
      s.subscribe(() => setTick((k) => k + 1));
    }, (e) => setErr(String(e)));
  }, [url]);
  const g = useMemo(() => gbifTheme(), []);
  const theme = useMemo(() => ({ background: g.bg1, foreground: g.fg1, muted: g.fg3, branch: g.fg2, highlight: g.primary, summary: g.slate400, fontFamily: g.fontBody, categorical: g.categorical }), [g]);
  if (err) return <p style={{ padding: 16, color: 'var(--color-danger)' }}>Could not open {url}: {err}</p>;
  if (!src) return <p style={{ padding: 16 }}>loading the overview…</p>;
  const st = src.stats;
  const onNode = (e: TreeNodeEvent) => {
    ((window as unknown as { __pq: { events: unknown[] } }).__pq.events).push({ node: e.node, kind: e.kind, tipRange: e.tipRange, tipCount: e.tipCount });
    setLast(`${e.kind} ${e.nodeId}: ${e.tipCount.toLocaleString('en')} tips, range [${e.tipRange.join(', ')}); loading labels…`);
    // only the first three labels: the range itself is the answer for a big clade, labels are a separate read of tips.parquet
    void src.tipLabels(e.tipRange[0], Math.min(e.tipRange[1], e.tipRange[0] + 3)).then((l) => setLast(`${e.kind} ${e.nodeId}: ${e.tipCount.toLocaleString('en')} tips, range [${e.tipRange.join(', ')}), first labels: ${l.join(', ')}`));
  };
  return (
    <div style={{ font: '14px var(--font-body)', padding: 12, color: 'var(--fg1)', background: 'var(--bg-surface)', minHeight: '100vh', boxSizing: 'border-box' }} data-tick={tick}>
      <p style={{ margin: '0 0 8px' }} data-testid="status">
        {src.tipCount.toLocaleString('en')} tips · {st.requests} requests, {(st.bytes / 1024).toFixed(0)} KB · {st.rows.toLocaleString('en')} rows ({st.stubs.toLocaleString('en')} stubs), {st.loadedClades} clades loaded, overview level {st.overviewLevel} · {last}
      </p>
      <div className="card" style={{ height: 'calc(100vh - 70px)', background: 'var(--bg1)' }}>
        <TreeView ref={ref} source={src} layout={layout} branchLengths={false} theme={theme} onNodeClick={onNode} onTipClick={(e) => setLast(`tip ${e.tipId ?? e.node}`)} />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
