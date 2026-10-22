// Reactree look-alike: the page around <Reactree> (src/Reactree.tsx), a tree picker and a light/dark switch. `npm run dev` in this
// folder, then open the printed URL (?tree=<id> picks a tree from src/trees.ts, ?theme=dark starts dark).

import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@gbif-phylo/viewer/viewer.css';
import './reactree.css';
import type { TreeModel } from '@gbif-phylo/io';
import { Reactree } from './Reactree.tsx';
import { TREES, loadTree } from './trees.ts';

function App() {
  const params = new URLSearchParams(location.search);
  const [id, setId] = useState(params.get('tree') ?? 'rich-fish-carangaria-135');
  const [dark, setDark] = useState(params.get('theme') === 'dark');
  const [data, setData] = useState<{ id: string; tree: TreeModel; fasta: Record<string, string> | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    loadTree(id).then(
      (d) => live && setData({ id, ...d }),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [id]);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [dark]);

  return (
    <div className="page">
      <header className="page-head">
        <a className="page-back" href="/">
          ← All demos
        </a>
        <h1>
          Reactree<span>.js</span> <small>look-alike on @gbif-phylo</small>
        </h1>
        <label>
          Tree{' '}
          <select value={id} onChange={(e) => setId(e.target.value)}>
            {Object.entries(TREES).map(([k, t]) => (
              <option key={k} value={k}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="theme-toggle" aria-pressed={dark} onClick={() => setDark((d) => !d)}>
          {dark ? '☀ Light' : '☾ Dark'}
        </button>
      </header>
      {error && <p className="page-error">{error}</p>}
      {/* a new tree is a new component: Reactree, too, resets everything when its newick prop changes */}
      {data ? <Reactree key={data.id} published={data.tree} fasta={data.fasta} /> : !error && <p>loading…</p>}
      <p className="page-foot">
        Toolbar icons from <a href="https://github.com/vaaloo/reactreejs">reactreejs</a> (MIT). Everything else is @gbif-phylo: see the README for
        what maps to which API and what could not be matched.
      </p>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
