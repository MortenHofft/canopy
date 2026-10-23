// A clade of at most two tips is never folded by size (#112): not at any threshold, not under a small budget. A run of 16 or more small
// siblings (rule R) still folds, whatever mix of tips, one-tip clades and cherries it is made of.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));
const core = path.join(root, 'packages/viewer/src');
const { computeLayout, ensureTrig } = await import(path.join(core, 'layout.ts'));
const { InMemorySource } = await import(path.join(core, 'source.ts'));
const { makeTransform } = await import(path.join(core, 'geom.ts'));
const { projectionFor } = await import(path.join(core, 'projection.ts'));
const { DrawList, Seen, searchCut, K_NODE, K_TIP, K_SUMMARY } = await import(path.join(core, 'lod.ts'));

const W = 600,
  H = 400;
const area = { ax: 0, ay: 0, aw: W, ah: H, clipL: 0, clipT: 0, clipR: W, clipB: H };

/** A balanced binary tree of n tips (a power of two) with unit lengths and tip names starting with p. */
function balanced(n, p) {
  const go = (m, q) => (m === 1 ? `${q}:1` : `(${go(m / 2, q + 'a')},${go(m / 2, q + 'b')}):1`);
  return go(n, p);
}

/** Four big clades, a clade of one tip, a cherry and a chain of three single-child nodes over one tip, as the children of the root. */
const MIXED = `(${[balanced(64, 'a'), balanced(64, 'b'), balanced(64, 'c'), '(one:1):1', '(two1:1,two2:1):1', '(((chain:1):1):1):1', balanced(64, 'd')].join(',')});`;

function setup(newick, kind) {
  const tree = new InMemorySource(parseNewick(newick)).snapshot();
  const L = computeLayout(tree, true);
  ensureTrig(L);
  const view = kind === 'radial' ? { x0: -1, x1: 1, y0: -1, y1: 1 } : { x0: 0, x1: 1, y0: 0, y1: L.rows };
  const proj = projectionFor(tree, L, makeTransform(kind, W, H, view, area, L.rows, L.fan));
  return { tree, proj };
}
const tipNodeOf = (tree, label) => {
  for (let r = 0; r < tree.tipCount; r++) if (tree.labels[tree.tipNode[r]] === label) return tree.tipNode[r];
  throw new Error(`no tip ${label}`);
};
function cut({ proj }, base, budget) {
  const list = new DrawList();
  const r = searchCut(proj, null, list, new Seen(), { lod: true, base, budget, summaries: true, hint: 0, cap: Infinity });
  return { ...r, list };
}
const entries = (list) => Array.from({ length: list.count }, (_, e) => ({ node: list.node[e], kind: list.kind[e], last: list.last[e] }));
const kindsAt = (list, node) =>
  entries(list)
    .filter((e) => e.node === node)
    .map((e) => e.kind);

for (const kind of ['rectangular', 'radial'])
  for (const [base, budget] of [
    [3, 1_000_000],
    [14, 1_000_000],
    [200, 1_000_000],
    [1e6, 1_000_000],
    [3, kind === 'radial' ? 100 : 500],
    [14, kind === 'radial' ? 100 : 500],
  ])
    test(`${kind}: no clade of one or two tips is a summary, minCladePx ${base}, budget ${budget}`, () => {
      const s = setup(MIXED, kind);
      const { tree } = s;
      const r = cut(s, base, budget);
      assert.equal(r.res.overflow, false, 'fits');
      assert.ok(r.list.count <= budget);
      for (const e of entries(r.list))
        if (e.kind === K_SUMMARY && e.last < 0) {
          const tips = tree.leafEnd[e.node] - tree.leafStart[e.node];
          assert.ok(tips > 2, `node ${e.node} (${tips} tips) is a summary`);
        }
      // the one-tip clade, the cherry and the chain are drawn: every node over their tips is open
      for (const label of ['one', 'two1', 'two2', 'chain']) {
        const t = tipNodeOf(tree, label);
        assert.deepEqual(kindsAt(r.list, t), [K_TIP], `${label} is drawn as a tip`);
        for (let a = tree.parent[t]; a > 0 && tree.leafEnd[a] - tree.leafStart[a] <= 2; a = tree.parent[a])
          assert.deepEqual(kindsAt(r.list, a), [K_NODE], `the clade over ${label} is open`);
      }
      if (base >= 200)
        assert.ok(
          entries(r.list).some((e) => e.kind === K_SUMMARY),
          'the big clades are folded',
        );
    });

for (const kind of ['rectangular', 'radial'])
  test(`${kind}: a run of 16 or more small siblings (tips, one-tip clades and cherries) is still one entry`, () => {
    const kids = [];
    for (let i = 0; i < 24; i++) kids.push(i % 3 === 0 ? `t${i}:1` : i % 3 === 1 ? `(u${i}:1):1` : `(v${i}a:1,v${i}b:1):1`);
    // a big clade beside the polytomy keeps the rows few px tall
    const s = setup(`(${kids.join(',')},${balanced(256, 'x')});`, kind);
    const r = cut(s, 14, 1_000_000);
    const runs = entries(r.list).filter((e) => e.kind === K_SUMMARY && e.last >= 0);
    assert.equal(runs.length, 1, 'one run');
    assert.equal(s.tree.leafEnd[runs[0].last] - s.tree.leafStart[runs[0].node], 8 + 8 + 16, 'it holds every tip of the 24 small clades');
    // nothing of the run's members is drawn on its own: the ones emitted before the run reached 16 are taken back with their children
    for (const e of entries(r.list))
      if (e.node > runs[0].node && e.node < s.tree.subtreeEnd[runs[0].last]) assert.fail(`entry ${e.node} inside the run`);
  });

for (const kind of ['rectangular', 'radial'])
  test(`${kind}: fewer than 16 small siblings are drawn open, as nodes and tips`, () => {
    const kids = [];
    for (let i = 0; i < 10; i++) kids.push(i % 2 === 0 ? `(u${i}:1):1` : `(v${i}a:1,v${i}b:1):1`);
    const s = setup(`(${kids.join(',')},${balanced(256, 'x')});`, kind);
    const r = cut(s, 14, 1_000_000);
    assert.equal(entries(r.list).filter((e) => e.kind === K_SUMMARY && e.last >= 0).length, 0, 'no run');
    for (let i = 0; i < 10; i++)
      for (const label of i % 2 === 0 ? [`u${i}`] : [`v${i}a`, `v${i}b`])
        assert.deepEqual(kindsAt(r.list, tipNodeOf(s.tree, label)), [K_TIP], `${label} drawn`);
  });
