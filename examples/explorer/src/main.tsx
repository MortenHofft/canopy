// The explorer: the page around <Explorer> (src/Explorer.tsx), a tree picker and a light/dark switch. `npm run dev` in this
// folder, then open the printed URL (?tree=<id> picks a tree from src/trees.ts, ?theme=dark starts dark, ?undo-budget=<bytes>
// sets what Undo may keep, ?debug=1 shows the debug panel, ?view= restores a view it copied: src/debug.ts). The picker has the playground's groups: every tree of its catalogue, a few of our own, and a file from
// your computer (src/TreePicker.tsx).

import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@canopy/viewer/viewer.css';
import './explorer.css';
import type { TreeModel } from '@canopy/io';
import { Explorer } from './Explorer.tsx';
import { GROUPS, TREES, loadTree } from './trees.ts';
import { TreePicker } from './TreePicker.tsx';
import { loadTreeFile } from '../../shared/data.ts';
import { readDebug, sameTree, type DebugInfo, type TreeName } from './debug.ts';

/** What is shown: a tree of the list, or a file of one's own (`key` tells two picks of a file apart). */
type Pick = { id: string } | { file: File; key: string };
type Loaded = { tree: TreeModel; fasta: Record<string, string> | null; bytes: number };

const nameOf = (p: Pick) => ('id' in p ? p.id : p.file.name);
const keyOf = (p: Pick) => ('id' in p ? p.id : p.key);
const load = (p: Pick): Promise<Loaded> => ('id' in p ? loadTree(p.id) : loadTreeFile(p.file).then((d) => ({ ...d, fasta: null })));
let files = 0;

const treeName = (p: Pick): TreeName => ('id' in p ? { id: p.id, label: TREES[p.id]?.label ?? p.id } : { file: p.file.name });
/** The tree to start with: the one of the view restored when it is in the list, else ?tree=, else the Carangaria tree. */
const firstTree = (params: URLSearchParams, debug: ReturnType<typeof readDebug>) => {
  const t = debug.restore?.tree;
  return t && 'id' in t && TREES[t.id] ? t.id : (params.get('tree') ?? 'rich-fish-carangaria-135');
};
/** What the explorer gets while debugging (nothing otherwise): the tree shown, and the view to restore with whether it is of it. */
function debugInfo(debug: ReturnType<typeof readDebug>, pick: Pick): DebugInfo | undefined {
  if (!debug.on) return undefined;
  const tree = treeName(pick);
  const restore = debug.restore;
  return { tree, restore, matches: restore !== null && sameTree(restore.tree, tree), error: debug.error };
}

function App() {
  const params = new URLSearchParams(location.search);
  const [debug] = useState(() => readDebug(params));
  const [pick, setPick] = useState<Pick>(() => ({ id: firstTree(params, debug) }));
  const [dark, setDark] = useState(params.get('theme') === 'dark');
  const budgetParam = Number(params.get('undo-budget') ?? NaN); // a missing or bad value: the default
  const undoBudget = Number.isFinite(budgetParam) ? budgetParam : undefined;
  const [data, setData] = useState<(Loaded & { id: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    setData(null);
    load(pick).then(
      (d) => live && setData({ id: keyOf(pick), ...d }),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [pick]);
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
          Tree explorer <small>on @canopy</small>
        </h1>
        <TreePicker
          groups={GROUPS}
          value={'id' in pick ? pick.id : null}
          fileName={'file' in pick ? pick.file.name : undefined}
          onTree={(id) => setPick({ id })}
          onFile={(file) => setPick({ file, key: `file:${++files}` })}
        />
        <button type="button" className="theme-toggle" aria-pressed={dark} onClick={() => setDark((d) => !d)}>
          {dark ? '☀ Light' : '☾ Dark'}
        </button>
      </header>
      {error && <p className="page-error">{error}</p>}
      {/* a new tree is a new component: Reactree, too, resets everything when its newick prop changes */}
      {data ? (
        <Explorer key={data.id} published={data.tree} fasta={data.fasta} undoBudget={undoBudget} debug={debugInfo(debug, pick)} />
      ) : (
        !error && <p className="page-loading">loading {nameOf(pick)}…</p>
      )}
      <p className="page-foot">
        Most toolbar icons are from <a href="https://github.com/vaaloo/reactreejs">reactreejs</a> (MIT), the look started there too. Everything else
        is @canopy: the README lists which control uses which API.
      </p>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
