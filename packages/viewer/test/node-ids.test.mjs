// Unit tests of node handles (#30): a node is a number, its preorder id in the tree the viewer holds. Anything else passed where a node
// is expected (a string such as 'n1' or '1', a fraction, an id past the last node) is ignored with a warning, not silently.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { makeViewer, destroyAll } = await import('./viewer-harness.mjs');
afterEach(destroyAll);

// preorder: 0 r, 1 x, 2 a, 3 b, 4 y, 5 c, 6 d ; 7 nodes
const NWK = '((a:1,b:2)x:1,(c:1,d:2)y:2)r;';

/** Run fn with console.warn collected. */
function warnings(fn) {
  const seen = [];
  const had = console.warn;
  console.warn = (...a) => seen.push(a.join(' '));
  try {
    fn();
  } finally {
    console.warn = had;
  }
  return seen;
}

test('setClades: valid node numbers give no warning; strings, fractions and unknown ids are dropped with one warning', async () => {
  const { viewer: v, env } = await makeViewer(NWK);
  env.flush();
  assert.deepEqual(
    warnings(() => v.setClades([{ node: 1, colour: '#f00' }])),
    [],
  );
  const w = warnings(() =>
    v.setClades([
      { node: 4, colour: '#0f0' },
      { node: 'n1', colour: '#f00' },
      { node: 7, colour: '#00f' },
      { node: 1.5, colour: '#00f' },
    ]),
  );
  assert.equal(w.length, 1);
  assert.match(w[0], /setClades: "n1", 7, 1\.5 are not nodes of this tree/);
  assert.match(w[0], /0 to 6/);
  assert.deepEqual(
    v.getClades().map((c) => c.node),
    [4],
    'only the valid entry is kept',
  );
});

test('setCollapsed: a tip is ignored without a warning (it is a node), an unknown id with one', async () => {
  const { viewer: v, env } = await makeViewer(NWK);
  env.flush();
  assert.deepEqual(
    warnings(() => v.setCollapsed([2])),
    [],
  );
  assert.equal(v.L.collapsed, null);
  const w = warnings(() => v.setCollapsed(['n1', -1, 4]));
  assert.equal(w.length, 1);
  assert.match(w[0], /setCollapsed: "n1", -1 are not nodes/);
  assert.equal(v.L.rows, 3, 'y is collapsed: a, b and the clade');
});

test('setTree: clades and collapsed of the options are checked against the new tree', async () => {
  const { viewer: v, env } = await makeViewer(NWK);
  env.flush();
  const { parseNewick } = await import('../../io/src/newick.ts');
  const w = warnings(() => v.setTree(parseNewick('(a,b)r;'), { clades: [{ node: 5, colour: '#f00' }], collapsed: [6] }));
  assert.equal(w.length, 2);
  assert.match(w[0], /setTree collapsed: 6 is not a node of this tree \(nodes are numbers, the preorder ids 0 to 2\)/);
  assert.match(w[1], /setTree clades: 5 is not a node/);
  assert.deepEqual(v.getClades(), []);
});

test('zoomToNode, locateNode and nodeBounds warn about an id that is not a node, and do nothing', async () => {
  const { viewer: v, env } = await makeViewer(NWK);
  env.flush();
  const before = v.getViewport();
  let w = warnings(() => v.zoomToNode('n1'));
  assert.equal(w.length, 1);
  assert.match(w[0], /zoomToNode: "n1" is not a node/);
  assert.deepEqual(v.getViewport(), before);
  w = warnings(() => assert.equal(v.locateNode(99), null));
  assert.match(w[0], /locateNode: 99 is not a node/);
  w = warnings(() => assert.equal(v.nodeBounds('1'), null));
  assert.match(w[0], /nodeBounds: "1" is not a node/);
  assert.deepEqual(
    warnings(() => v.zoomToNode(1)),
    [],
  );
});

test('more than five bad ids: the first five and a count', async () => {
  const { viewer: v, env } = await makeViewer(NWK);
  env.flush();
  const w = warnings(() => v.setCollapsed([10, 11, 12, 13, 14, 15, 16]));
  assert.match(w[0], /setCollapsed: 10, 11, 12, 13, 14 and 2 more are not nodes/);
});

test('a partial source: any id below nodeCount is an id (a node not loaded yet is no error), anything else warns', async () => {
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const { parseNewick } = await import('../../io/src/newick.ts');
  const { InMemorySource } = await import('../src/source.ts');
  const { partialSnapshot } = await import(path.join(here, 'partial-snapshot.mjs'));
  const full = new InMemorySource(parseNewick('((A:1,B:2)AB:1,(C:1,(D:2,E:3)DE:1)CDE:2,F:4)root;')).snapshot();
  const { snap } = partialSnapshot(full, [4], 1000); // ids are row + 1000, CDE (4) not loaded
  const source = {
    nodeCount: full.nodeCount + 1000, // ids are the full tree's ids + 1000
    tipCount: full.tipCount,
    hasLengths: true,
    version: 0,
    subscribe: () => () => {},
    snapshot: () => snap,
    ensureClade: async () => {},
    tipLabels: async () => [],
    destroy() {},
  };
  const { viewer: v, env } = await makeViewer(parseNewick('(a,b)r;'));
  env.flush();
  v.setTree(source);
  assert.deepEqual(
    warnings(() => v.setClades([{ node: 1001, colour: '#f00' }])),
    [],
  );
  const out = warnings(() => v.setClades([{ node: 1000 + full.nodeCount, colour: '#f00' }]));
  assert.match(out[0], /setClades: 1010 is not a node of this tree \(nodes are numbers, the preorder ids 0 to 1009\)/);
  const w = warnings(() => v.zoomToNode('1001'));
  assert.match(w[0], /zoomToNode: "1001" is not a node of this tree \(nodes are numbers, the preorder ids 0 to 1009\)/);
});
