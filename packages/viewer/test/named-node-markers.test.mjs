// Unit tests of `namedNodeMarkers`: a named internal node gets a round marker in `namedNodeColour`, the others a smaller square, and
// the option off gives every internal node the one square of `nodeMarkerSize`. Read from the recording context's draw calls.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { makeViewer, destroyAll } = await import('./viewer-harness.mjs');
const { hasInternalName } = await import('../src/node-label.ts');

afterEach(destroyAll);

// preorder: 0 r, 1 x (named), 2 a, 3 b, 4 y (support only), 5 c, 6 d
const TREE = '((a:1,b:1)Aves:2,(c:1,d:1)0.5:3)r;';

test('hasInternalName: a name, not a support value', () => {
  for (const s of ['Aves', 'c__Spirochaetia', '98:Aves', '0.95/Aves', '1a']) assert.equal(hasInternalName(s), true, s);
  for (const s of ['', '95', '0.98', ' 100 ', '98:', '98: ']) assert.equal(hasInternalName(s), false, JSON.stringify(s));
});

/** Counts of the internal-node markers drawn: rects (squares) with their sizes, and arcs (circles) with their radii. */
async function markers(options, theme = {}) {
  const m = await makeViewer(TREE, { options: { axis: false, ...options }, theme: { namedNodeColour: '#ff0000', ...theme }, size: [500, 200] });
  m.env.flush();
  const rects = [],
    arcs = [];
  let fill = '';
  for (const e of m.ctx().log) {
    if (e[0] === 'fillStyle=') fill = e[1];
    else if (e[0] === 'rect' && e[3] === e[4]) rects.push(e[3]);
    else if (e[0] === 'arc' && fill === '#ff0000') arcs.push(e[3]);
  }
  return { rects, arcs };
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
