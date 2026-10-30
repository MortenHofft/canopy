// Unit tests of `namedNodeMarkers`: a named internal node gets a round marker in `namedNodeColour`, the others a smaller square, and
// the option off gives every internal node the one square of `nodeMarkerSize`. Read from the recording context's draw calls: the
// positions of the circles and squares (a frame may be logged twice, so positions are kept in sets), with the fill and alpha in force.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { makeViewer, destroyAll } = await import('./viewer-harness.mjs');
const { namedNodeTest } = await import('../src/named-nodes.ts');

afterEach(destroyAll);

// preorder: 0 r (named), 1 x (named), 2 a, 3 b, 4 y (support only), 5 c, 6 d
const TREE = '((a:1,b:1)Aves:2,(c:1,d:1)0.5:3)r;';
const RED = '#ff0000';

async function make(options = {}, theme = {}, setup = () => {}, tree = TREE) {
  const m = await makeViewer(tree, {
    options: { axis: false, ...options },
    theme: { namedNodeColour: RED, foreground: '#112233', dimOpacity: 0.3, markerOpacity: 0.85, ...theme },
    size: [500, 200],
  });
  setup(m.viewer);
  m.env.flush();
  return m;
}

/** What the log from entry `from` on drew: circles of radius `r` by fill (Map fill -> Map "x,y" -> alpha), squares of side `side` ("x,y" set). */
function drawn(m, { r, side }, from = 0) {
  const circles = new Map();
  const squares = new Set();
  let fill = '',
    alpha = 1;
  for (const e of m.ctx().log.slice(from)) {
    if (e[0] === 'fillStyle=') fill = e[1];
    else if (e[0] === 'globalAlpha=') alpha = e[1];
    else if (e[0] === 'arc' && e[3] === r) {
      if (!circles.has(fill)) circles.set(fill, new Map());
      circles.get(fill).set(`${e[1]},${e[2]}`, alpha);
    } else if (e[0] === 'rect' && e[3] === side && e[4] === side) squares.add(`${e[1]},${e[2]}`);
  }
  return { circles, squares };
}
const at = (circles, fill) => [...(circles.get(fill)?.keys() ?? [])];

test('namedNodeTest: the rule of cladeName, asked once per row; a throwing cladeLabel is no name', () => {
  const tree = { nodeCount: 4, labels: ['', 'Aves', '0.95', 'boom'], childCount: [2, 2, 2, 2], globalId: null };
  let calls = 0;
  const cladeLabel = (node) => {
    calls++;
    if (node === 3) throw new Error('boom');
    return node === 0 ? '  ' : tree.labels[node].replace('0.95', '');
  };
  const test = namedNodeTest(tree, { formatLabel: (s) => s, cladeLabel });
  assert.deepEqual([0, 1, 2, 3].map(test), [false, true, false, false]);
  assert.deepEqual([0, 1, 2, 3].map(test), [false, true, false, false]);
  assert.equal(calls, 4);
  assert.equal(test(99), false); // out of range: not named, no throw
});

test('on: the named nodes are circles, the other internal node a small square, and no node has both', async () => {
  const m = await make({ namedNodeMarkers: true }, { namedNodeMarkerSize: 10, unnamedNodeMarkerSize: 2 });
  const { circles, squares } = drawn(m, { r: 5, side: 2 });
  assert.equal(at(circles, RED).length, 2); // r and x
  assert.equal(squares.size, 1); // y only
  assert.ok(!at(circles, RED).some((p) => squares.has(p)));
});

test('off: every internal node is the one square, no circle', async () => {
  const m = await make({ namedNodeMarkers: false }, { nodeMarkerSize: 6, namedNodeMarkerSize: 10 });
  const { circles, squares } = drawn(m, { r: 5, side: 6 });
  assert.equal(circles.size, 0);
  assert.equal(squares.size, 3); // r, x and y
});

test('namedNodeColour "" is the foreground', async () => {
  const m = await make({}, { namedNodeColour: '', namedNodeMarkerSize: 10 });
  assert.equal(at(drawn(m, { r: 5, side: 3 }).circles, '#112233').length, 2);
});

test('a named node in a coloured clade keeps the clade colour; the one outside takes namedNodeColour', async () => {
  const m = await make({}, { namedNodeMarkerSize: 10 }, (v) => v.setClades([{ node: 1, colour: '#00ff00' }]));
  const { circles } = drawn(m, { r: 5, side: 3 });
  assert.equal(at(circles, RED).length, 1); // r
  assert.equal(at(circles, '#00ff00').length, 1); // x
  assert.notEqual(at(circles, RED)[0], at(circles, '#00ff00')[0]);
});

test('dimming: a named node whose clade holds no highlighted tip is drawn at markerOpacity * dimOpacity', async () => {
  const m = await make({ highlightStyle: 'dim' }, { namedNodeMarkerSize: 10 }, (v) => v.setHighlighted(['c']));
  const red = drawn(m, { r: 5, side: 3 }).circles.get(RED);
  assert.equal(red.size, 2);
  assert.deepEqual([...red.values()].map((a) => Math.round(a * 1000) / 1000).sort(), [0.255, 0.85]); // x is dimmed, r holds c
});

test('cladeLabel decides what is named; one that throws does not stop the frame', async () => {
  assert.equal(drawn(await make({ cladeLabel: () => null }, { namedNodeMarkerSize: 10 }), { r: 5, side: 3 }).circles.size, 0);
  const m = await make(
    {
      cladeLabel: () => {
        throw new Error('boom');
      },
    },
    { namedNodeMarkerSize: 10 },
  );
  assert.equal(drawn(m, { r: 5, side: 3 }).circles.size, 0);
});

test('setOptions turns the markers on and off', async () => {
  const m = await make({ namedNodeMarkers: false }, { namedNodeMarkerSize: 10 });
  assert.equal(drawn(m, { r: 5, side: 3 }).circles.size, 0);
  const from = m.ctx().log.length;
  m.viewer.setOptions({ namedNodeMarkers: true });
  m.env.flush();
  assert.equal(at(drawn(m, { r: 5, side: 3 }, from).circles, RED).length, 2);
  const back = m.ctx().log.length;
  m.viewer.setOptions({ namedNodeMarkers: false });
  m.env.flush();
  assert.equal(drawn(m, { r: 5, side: 3 }, back).circles.size, 0);
});

/** The x of each support text ('95', '0.9', ...) of the last frame. */
function supportX(m) {
  const out = {};
  for (const e of m.ctx().log) if (e[0] === 'fillText' && /^[\d.]+$/.test(e[1])) out[e[1]] = e[2];
  return out;
}

test('support labels: the clearance of a node with no name is the same on and off; a named node clears its larger circle', async () => {
  const plain = '((a:1,b:1)0.9:2,(c:1,d:1)0.5:3)r;'; // no named internal node but the root, which has no label to place
  const on = supportX(await make({ nodeLabels: 'support' }, {}, () => {}, plain));
  const off = supportX(await make({ nodeLabels: 'support', namedNodeMarkers: false }, {}, () => {}, plain));
  assert.deepEqual(on, off);
  assert.equal(Object.keys(on).length, 2);
  const named = "((a:1,b:1)'98:Aves':2,(c:1,d:1)0.5:3)r;"; // a support and a name on one node
  const x = (m) => supportX(m)['98'];
  const withMarker = x(await make({ nodeLabels: 'support' }, { namedNodeMarkerSize: 8 }, () => {}, named));
  const without = x(await make({ nodeLabels: 'support', namedNodeMarkers: false }, {}, () => {}, named));
  assert.ok(withMarker < without, `${withMarker} < ${without}`); // the text ends further left of the node
});
