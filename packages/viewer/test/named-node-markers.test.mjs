// Unit tests of `namedNodeMarkers`: a named internal node gets a round marker in `namedNodeColour`, the others a smaller square, and
// the option off gives every internal node the one square of `nodeMarkerSize`. Read from the recording context's draw calls.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { makeViewer, destroyAll } = await import('./viewer-harness.mjs');
const { namedNodeTest } = await import('../src/named-nodes.ts');

afterEach(destroyAll);

// preorder: 0 r, 1 x (named), 2 a, 3 b, 4 y (support only), 5 c, 6 d
const TREE = '((a:1,b:1)Aves:2,(c:1,d:1)0.5:3)r;';

test('namedNodeTest: the rule of cladeName, asked once per row', () => {
  const tree = { nodeCount: 3, labels: ['', 'Aves', '0.95'], childCount: [2, 2, 2], globalId: null };
  let calls = 0;
  const test = namedNodeTest(tree, {
    formatLabel: (s) => s,
    cladeLabel: (node) => (calls++, node === 0 ? '  ' : tree.labels[node].replace('0.95', '')),
  });
  assert.deepEqual([0, 1, 2].map(test), [false, true, false]);
  assert.deepEqual([0, 1, 2].map(test), [false, true, false]);
  assert.equal(calls, 3);
});

/** Counts of the internal-node markers drawn: rects (squares) with their sizes, and arcs (circles) with their radii. */
async function markers(options, theme = {}, setup = () => {}) {
  const m = await makeViewer(TREE, { options: { axis: false, ...options }, theme: { namedNodeColour: '#ff0000', ...theme }, size: [500, 200] });
  setup(m.viewer);
  m.env.flush();
  const rects = [],
    arcs = [],
    green = [];
  let fill = '';
  for (const e of m.ctx().log) {
    if (e[0] === 'fillStyle=') fill = e[1];
    else if (e[0] === 'rect' && e[3] === e[4]) rects.push(e[3]);
    else if (e[0] === 'arc' && fill === '#ff0000') arcs.push(e[3]);
    else if (e[0] === 'arc' && fill === '#00ff00' && e[3] === 5) green.push(e[3]);
  }
  return { rects, arcs, green };
}

test('on: the named node is a circle, the other internal nodes are small squares', async () => {
  const { rects, arcs } = await markers({ namedNodeMarkers: true }, { namedNodeMarkerSize: 10, unnamedNodeMarkerSize: 2 });
  assert.deepEqual([...new Set(arcs)], [5]); // one size: x only (a frame may be logged twice)
  assert.ok(rects.includes(2));
  assert.ok(!rects.includes(4));
});

test('off: every internal node is the one square', async () => {
  const { rects, arcs } = await markers({ namedNodeMarkers: false }, { nodeMarkerSize: 6 });
  assert.deepEqual(arcs, []);
  assert.ok(rects.filter((s) => s === 6).length >= 2);
});

test('a named node in a coloured clade keeps the clade colour; the others take namedNodeColour', async () => {
  const { arcs, green } = await markers({ namedNodeMarkers: true }, { namedNodeMarkerSize: 10 }, (v) =>
    v.setClades([{ node: 1, colour: '#00ff00' }]),
  );
  assert.ok(green.length > 0); // x, in its clade's colour
  assert.deepEqual([...new Set(arcs)], [5]); // r, outside the clade: in namedNodeColour (and x is not among the red ones)
});

test('cladeLabel decides what is named', async () => {
  const { arcs } = await markers({ namedNodeMarkers: true, cladeLabel: () => null }, { namedNodeMarkerSize: 10 });
  assert.deepEqual(arcs, []);
});

test('setOptions turns the markers on and off', async () => {
  const m = await makeViewer(TREE, { options: { axis: false, namedNodeMarkers: false }, theme: { namedNodeColour: '#ff0000' }, size: [500, 200] });
  m.env.flush();
  const reds = (from) => {
    let fill = '';
    return m
      .ctx()
      .log.slice(from)
      .filter((e) => (e[0] === 'fillStyle=' ? ((fill = e[1]), false) : e[0] === 'arc' && fill === '#ff0000')).length;
  };
  assert.equal(reds(0), 0);
  const at = m.ctx().log.length;
  m.viewer.setOptions({ namedNodeMarkers: true });
  m.env.flush();
  assert.ok(reds(at) > 0);
});
