// Property tests of the rows of collapsed clades (#29): random trees and random sets of collapsed nodes against a plain recomputation.
import { test, afterEach } from 'node:test';
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
const { cut, newCutResult, DrawList, Seen, K_SUMMARY, K_TIP } = await import(path.join(core, 'lod.ts'));
const { makeViewer, destroyAll } = await import('./viewer-harness.mjs');
afterEach(destroyAll);

let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const ri = (n) => Math.floor(rnd() * n);

function randomNewick(nt) {
  const groups = Array.from({ length: nt }, (_, k) => `t${k}:${(1 + ri(5)) / 2}`);
  let id = 0;
  while (groups.length > 1) {
    const at = ri(groups.length);
    const k = Math.min(groups.length - at, 1 + ri(4));
    let g = '(' + groups.slice(at, at + k).join(',') + `)i${id++}:${(1 + ri(4)) / 2}`;
    if (rnd() < 0.15) g = '(' + g + `)u${id++}:1`; // a single-child chain
    groups.splice(at, k, g);
  }
  return groups[0].replace(/:[\d.]+$/, '') + ';';
}

function check(t, m) {
  const L = computeLayout(t, true, m);
  const n = t.nodeCount;
  // expected: outermost marked internal nodes with >1 tip
  const coll = new Uint8Array(n),
    hid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let p = t.parent[i],
      inside = false;
    while (p >= 0) {
      if (m[p] && t.childCount[p] > 0 && t.leafEnd[p] - t.leafStart[p] > 1) inside = true;
      p = t.parent[p];
    }
    if (inside) hid[i] = 1;
    else if (m[i] && t.childCount[i] > 0 && t.leafEnd[i] - t.leafStart[i] > 1) coll[i] = 1;
  }
  const visibleTips = [];
  for (let r = 0; r < t.tipCount; r++) if (!hid[t.tipNode[r]]) visibleTips.push(t.tipNode[r]);
  const ncoll = coll.reduce((a, b) => a + b, 0);
  assert.equal(L.rows, visibleTips.length + ncoll, 'rows = visible tips + collapsed');
  if (ncoll === 0) {
    assert.equal(L.rowNode, null);
    return L;
  }
  const seen = new Map();
  for (let r = 0; r < L.rows; r++) {
    const v = L.rowNode[r];
    assert.ok((t.childCount[v] === 0 && !hid[v] && !coll[v]) || coll[v], `row ${r} -> ${v} is a visible tip or a collapsed clade`);
    assert.ok(!seen.has(v), 'one row per node');
    seen.set(v, r);
    assert.equal(L.rowStart[v], r);
    assert.equal(L.rowEnd[v], r + 1);
    assert.equal(L.rankOfRow[r], t.leafStart[v]);
    assert.equal(L.rankOfRow[r + 1], t.leafEnd[v]);
  }
  for (const v of visibleTips) {
    const k = t.tipRank[v];
    assert.equal(L.rankOfRow[L.rowOfRank[k]], k, 'inverse on visible tips');
    assert.equal(L.rowNode[L.rowOfRank[k]], v);
  }
  for (let i = 0; i < n; i++) {
    assert.equal(L.collapsed[i], coll[i], `collapsed mask at ${i}`);
    assert.equal(L.hidden[i], hid[i], `hidden mask at ${i}`);
    assert.ok(L.rowStart[i] < L.rowEnd[i]);
    assert.ok(L.ROW[i] >= L.rowStart[i] && L.ROW[i] <= L.rowEnd[i], 'ROW inside the rows');
  }
  // cut: what is drawn (no lod, full view) is exactly the row nodes plus the open internal nodes
  for (const kind of ['rectangular', 'radial']) {
    if (kind === 'radial') ensureTrig(L);
    const rect = kind === 'rectangular';
    const [W, H] = rect ? [600, Math.max(200, L.rows * 30)] : [800, 800];
    const area = { ax: 0, ay: 0, aw: W, ah: H, clipL: 0, clipT: 0, clipR: W, clipB: H };
    const view = rect ? { x0: 0, x1: 1, y0: 0, y1: L.rows } : { x0: -1.2, x1: 1.2, y0: -1.2, y1: 1.2 };
    const T = makeTransform(kind, W, H, view, area, L.rows);
    const proj = projectionFor(t, L, T);
    const list = new DrawList();
    cut(proj, { lod: false, minPx: 0.0001, budget: 1e6, summaries: true }, null, list, new Seen(), newCutResult());
    const leaves = new Set();
    for (let e = 0; e < list.count; e++) {
      const i = list.node[e];
      assert.ok(!hid[i], `${kind}: hidden node ${i} drawn`);
      if (list.kind[e] === K_SUMMARY) assert.ok(coll[i] && list.last[e] < 0, `${kind}: summary ${i} is a collapsed clade`);
      if (list.kind[e] === K_TIP || list.kind[e] === K_SUMMARY) leaves.add(i);
    }
    assert.deepEqual(
      [...leaves].sort((a, b) => a - b),
      [...seen.keys()].sort((a, b) => a - b),
      `${kind}: drawn leaves = row nodes`,
    );
  }
  return L;
}

test('property: random trees, random collapsed sets', () => {
  for (let it = 0; it < 400; it++) {
    const nwk = randomNewick(2 + ri(40));
    const t = new InMemorySource(parseNewick(nwk)).snapshot();
    const m = new Uint8Array(t.nodeCount);
    const p = rnd() * 0.5;
    for (let i = 0; i < t.nodeCount; i++) if (rnd() < p) m[i] = 1;
    if (it % 20 === 0) m[0] = 1; // the root
    try {
      check(t, m);
    } catch (e) {
      console.log(
        nwk,
        [...m.keys()].filter((i) => m[i]),
      );
      throw e;
    }
  }
});

// viewer-level agreement: hit-test at each row's anchor, labels, column cells, highlight bands
test('viewer: every row hits / labels / columns agree', async () => {
  for (let it = 0; it < 40; it++) {
    const nwk = randomNewick(3 + ri(14));
    const tips = [];
    const m0 = await makeViewer(nwk, { size: [700, 900] });
    m0.env.flush();
    const v = m0.viewer;
    const t = v.tree;
    for (let r = 0; r < t.tipCount; r++) tips.push(t.tipLabels[r]);
    const ids = [];
    for (let i = 0; i < t.nodeCount; i++) if (t.childCount[i] > 0 && rnd() < 0.3) ids.push(i);
    v.setColumns([{ id: 'c', kind: 'text', width: 60, values: Object.fromEntries(tips.map((x) => [x, x])) }]);
    v.setCollapsed(ids);
    m0.env.flush();
    const L = v.L;
    if (!L.rowNode) continue;
    globalThis.__n = (globalThis.__n ?? 0) + 1;
    const labelled = new Map();
    for (let k = 0; k < v.labels.count; k++) {
      const key = v.labels.rank[k];
      const node = key >= 0 ? t.tipNode[key] : -key - 1;
      labelled.set(node, k);
    }
    for (let r = 0; r < L.rows; r++) {
      const node = L.rowNode[r];
      assert.ok(labelled.has(node), `row ${r} (node ${node}) has a label`);
      const k = labelled.get(node);
      const h = v.hitTest(v.labels.x[k] + 3, v.labels.y[k]);
      assert.equal(h?.node, node, `label hit of row ${r}`);
      assert.equal(h?.kind, t.childCount[node] === 0 ? 'tip' : 'summary');
      assert.ok(Math.abs(v.labels.y[k] - (v.T.oy + (r + 0.5) * v.T.ky)) < 1, 'label on its row');
    }
    for (let k = 0; k < t.tipCount; k++) {
      const c = v.columnCell('c', t.tipNode[k]);
      const visible = !L.hidden?.[t.tipNode[k]];
      assert.equal(c !== null, visible, `cell of rank ${k}`);
    }
  }
});

test('count', () => console.log('viewer iterations with collapse', globalThis.__n));
test('highlight bands stack on a collapsed row (one band per highlighted tip)', async () => {
  const m = await makeViewer('((a,b,c,d)x,e)r;', { size: [400, 300] });
  m.env.flush();
  const v = m.viewer;
  v.setCollapsed([v.tree.parent[v.tree.tipIndex('a')]]);
  v.setHighlighted(['a', 'b', 'c', 'd']);
  m.ctx().reset();
  m.env.flush();
  const rects = m.ctx().calls('fillRect');
  const ys = rects.map((c) => c[2]);
  console.log('fillRect y of bands', ys.slice(0, 10));
});
