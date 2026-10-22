// The explorer: the page around <Explorer> (src/Explorer.tsx), a tree picker and a light/dark switch. `npm run dev` in this
// folder, then open the printed URL (?tree=<id> picks a tree from src/trees.ts, ?theme=dark starts dark). The picker has the playground's
// groups: every tree of its catalogue, and a few of our own.

import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@gbif-phylo/viewer/viewer.css';
import './explorer.css';
import type { TreeModel } from '@gbif-phylo/io';
import { Explorer } from './Explorer.tsx';
import { GROUPS, loadTree } from './trees.ts';

function App() {
  const params = new URLSearchParams(location.search);
  const [id, setId] = useState(params.get('tree') ?? 'rich-fish-carangaria-135');
  const [dark, setDark] = useState(params.get('theme') === 'dark');
  const [data, setData] = useState<{ id: string; tree: TreeModel; fasta: Record<string, string> | null; bytes: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    setData(null);
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
          Tree explorer <small>on @gbif-phylo</small>
        </h1>
        <label>
          Tree{' '}
          <select value={id} onChange={(e) => setId(e.target.value)}>
            {Object.entries(GROUPS).map(([group, entries]) => (
              <optgroup key={group} label={group}>
                {Object.entries(entries).map(([k, t]) => (
                  <option key={k} value={k}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <button type="button" className="theme-toggle" aria-pressed={dark} onClick={() => setDark((d) => !d)}>
          {dark ? '☀ Light' : '☾ Dark'}
        </button>
      </header>
      {error && <p className="page-error">{error}</p>}
      {/* a new tree is a new component: Reactree, too, resets everything when its newick prop changes */}
      {data ? <Explorer key={data.id} published={data.tree} fasta={data.fasta} /> : !error && <p className="page-loading">loading {id}…</p>}
      <p className="page-foot">
        Most toolbar icons are from <a href="https://github.com/vaaloo/reactreejs">reactreejs</a> (MIT), the look started there too. Everything else
        is @gbif-phylo: the README lists which control uses which API.
      </p>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
