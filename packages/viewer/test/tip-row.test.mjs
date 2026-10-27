// Tips named by label or node id: the lookup behind TreeViewer.focusTip / columnCell and <TreeView>'s handle (#18, #82).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { tipRow } = await import(path.join(root, 'packages/viewer/src/tip-row.ts'));
const { makeViewer, destroyAll } = await import('./viewer-harness.mjs');

afterEach(destroyAll);

test('tipRow: a label is its first tip (warning when several carry it), a number a node that must be a tip (#18)', async () => {
  const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));
  const { InMemorySource } = await import(path.join(root, 'packages/viewer/src/source.ts'));
  // preorder: 0 root, 1 (), 2 Homo, 3 Homo, 4 Pan, 5 Homo
  const snap = new InMemorySource(parseNewick('((Homo_sapiens,Homo_sapiens),Pan_troglodytes,Homo_sapiens)root;')).snapshot();
  const seen = [];
  const had = console.warn;
  console.warn = (...a) => seen.push(a.join(' '));
  try {
    assert.equal(tipRow(snap, 'Homo_sapiens'), 2);
    assert.equal(tipRow(snap, 5), 5);
    assert.equal(tipRow(snap, 'nope'), -1);
    assert.deepEqual(seen, [], 'no warning without a `where`');
    assert.equal(tipRow(snap, 'Pan_troglodytes', 'focusTip'), 4);
    assert.deepEqual(seen, [], 'a unique label does not warn');
    assert.equal(tipRow(snap, 'Homo_sapiens', 'focusTip'), 2);
    assert.match(seen.pop(), /focusTip: 3 tips have the label "Homo_sapiens"; the first is used/);
    assert.equal(tipRow(snap, 1, 'focusTip'), -1);
    assert.match(seen.pop(), /focusTip: 1 is an internal node/);
    assert.equal(tipRow(snap, 6, 'focusTip'), -1);
    assert.match(seen.pop(), /focusTip: 6 is not a node/);
    assert.equal(tipRow(snap, 2.5, 'focusTip'), -1);
    assert.match(seen.pop(), /2\.5 is not a node/);
  } finally {
    console.warn = had;
  }
  // a partial snapshot: numbers are ids of the full tree, a row that is not loaded is -1 without a warning
  const partial = {
    ...snap,
    globalId: Int32Array.from({ length: snap.nodeCount }, (_, i) => i + 100),
    toLocal: (g) => (g >= 100 && g < 106 ? g - 100 : -1),
  };
  // ids are bounded by the full tree's node count (the source's), not by the snapshot's row count (#91)
  assert.equal(tipRow(partial, 105, 'focusTip', 200), 5);
  assert.equal(tipRow(partial, 7, 'focusTip', 200), -1, 'a number inside the tree but not loaded: no warning');
  const seen2 = [];
  console.warn = (...a) => seen2.push(a.join(' '));
  try {
    assert.equal(tipRow(partial, 205, 'focusTip', 200), -1);
    assert.match(seen2.pop(), /focusTip: 205 is not a node/);
    assert.equal(tipRow(partial, 150, 'focusTip', 200), -1);
    assert.deepEqual(seen2, [], 'an id below the limit that is not loaded does not warn');
  } finally {
    console.warn = had;
  }
});

test('focusTip and columnCell take a label or a node id, not a leaf rank (#82)', async () => {
  // preorder: 0 root, 1 x, 2 a, 3 b, 4 c ; ranks: a0 b1 c2
  const m = await makeViewer('((a,b)x,c)root;', { size: [400, 300] });
  m.env.flush();
  const v = m.viewer;
  const had = console.warn;
  const seen = [];
  console.warn = (...a) => seen.push(a.join(' '));
  try {
    const y = (tip) => {
      v.focusTip(tip);
      m.env.flush();
      const w = v.getViewport();
      return (w.y0 + w.y1) / 2;
    };
    const rowOfC = y('c');
    assert.equal(y(4), rowOfC, 'the node id of c is c');
    assert.ok(v.columnCell('nope', 'c') === null);
    assert.deepEqual(seen, []);
    v.setColumns([{ id: 'v', kind: 'text', width: 60, values: { a: 'a', b: 'b', c: 'c' } }]);
    m.env.flush();
    const byLabel = v.columnCell('v', 'b');
    assert.ok(byLabel, 'a cell by label');
    assert.deepEqual(v.columnCell('v', 3), byLabel, 'and by node id');
    assert.equal(v.columnCell('v', 1), null, 'node 1 is x, an internal node, not rank 1');
    assert.equal(v.columnCell('v', 'zzz'), null);
    v.focusTip(1); // internal node: ignored with a warning, the view stays
    assert.match(seen.pop(), /focusTip: 1 is an internal node/);
  } finally {
    console.warn = had;
  }
});
