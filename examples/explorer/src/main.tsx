// The explorer: the page around <Explorer> (src/Explorer.tsx), a tree picker and a light/dark switch. `npm run dev` in this
// folder, then open the printed URL (?tree=<id> picks a tree from src/trees.ts, ?theme=dark starts dark, ?undo-budget=<bytes>
// sets what Undo may keep, ?debug=1 shows the debug panel, ?view= restores a view it copied: src/debug.ts). The picker has the playground's groups: every tree of its catalogue, a few of our own, and a file from
// your computer (src/TreePicker.tsx).

import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@canopy/viewer/viewer.css';
import './explorer.css';
import { Explorer } from './Explorer.tsx';
import { GROUPS, TREES, loadFile, loadTree, type Loaded, type LoadOptions, type LoadProgress } from './trees.ts';
import { TreePicker } from './TreePicker.tsx';
import { readDebug, sameTree, type DebugInfo, type TreeName } from './debug.ts';

/** What is shown: a tree of the list, or a file of one's own (`key` tells two picks of a file apart). */
type Pick = { id: string } | { file: File; key: string };

const nameOf = (p: Pick) => ('id' in p ? p.id : p.file.name);
const keyOf = (p: Pick) => ('id' in p ? p.id : p.key);
const load = (p: Pick, o: LoadOptions): Promise<Loaded> => ('id' in p ? loadTree(p.id, o) : loadFile(p.file, o));
/** What the loading line says of a step. */
const stepOf = (p: LoadProgress) =>
  p.phase === 'labels'
    ? `labels ${Math.round((100 * (p.done ?? 0)) / (p.total || 1))}%`
    : { fetch: 'fetching', read: 'reading', inflate: 'inflating', decode: 'decoding', parse: 'parsing', pack: 'packing' }[p.phase];
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
  // The tree shown stays while the next one loads (in a worker, so the page responds). The list names the tree loading, else the tree
  // shown, else nothing (a first load that failed or was cancelled), so Cancel or a failed load goes back to the tree shown and any
  // entry, the same one too, can be chosen again. A pick always clears the last error.
  const [data, setData] = useState<(Loaded & { id: string; pick: Pick }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<{ step: string; cancel: () => void } | null>(null);
  const listed = loading ? pick : (data?.pick ?? null);

  useEffect(() => {
    setError(null);
    if (data?.id === keyOf(pick)) return setLoading(null); // the tree shown, picked again while another loaded
    const ac = new AbortController();
    const cancel = () => {
      ac.abort();
      setLoading(null);
      if (!data) setError(`loading ${nameOf(pick)} was cancelled`);
    };
    setLoading({ step: 'starting', cancel });
    load(pick, { signal: ac.signal, onProgress: (p) => !ac.signal.aborted && setLoading({ step: stepOf(p), cancel }) }).then(
      (d) => {
        if (ac.signal.aborted) return;
        setLoading(null);
        setData({ id: keyOf(pick), pick, ...d });
      },
      (e: Error) => {
        if (ac.signal.aborted) return;
        setLoading(null);
        setError(e.message);
      },
    );
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new pick starts a load; the data shown changes with it
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
          value={listed === null ? '' : 'id' in listed ? listed.id : null}
          fileName={listed && 'file' in listed ? listed.file.name : undefined}
          onTree={(id) => setPick({ id })}
          onFile={(file) => setPick({ file, key: `file:${++files}` })}
        />
        <button type="button" className="theme-toggle" aria-pressed={dark} onClick={() => setDark((d) => !d)}>
          {dark ? '☀ Light' : '☾ Dark'}
        </button>
      </header>
      {error && <p className="page-error">{error}</p>}
      {loading && (
        <p className="page-loading" role="status">
          loading {nameOf(pick)}: {loading.step}…{' '}
          <button type="button" onClick={loading.cancel}>
            Cancel
          </button>
        </p>
      )}
      {/* a new tree is a new component: Reactree, too, resets everything when its newick prop changes */}
      {data && <Explorer key={data.id} published={data.tree} fasta={data.fasta} undoBudget={undoBudget} debug={debugInfo(debug, data.pick)} />}
      <p className="page-foot">
        Most toolbar icons are from <a href="https://github.com/vaaloo/reactreejs">reactreejs</a> (MIT), the look started there too. Everything else
        is @canopy: the README lists which control uses which API.
      </p>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
