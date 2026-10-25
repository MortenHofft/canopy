// At the 1 px threshold a clade folded by size is drawn as a branch from its node to its deepest tip, and that tip is hovered at the end of
// the line (#126): the layout's DEEPEST, the line in the branch stroke instead of a fan or triangle, and the hit test.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeViewer, destroyAll } from './viewer-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', '..');
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));
const { computeLayout } = await import(path.join(root, 'packages/viewer/src/layout.ts'));
const { InMemorySource } = await import(path.join(root, 'packages/viewer/src/source.ts'));
const { partialSnapshot } = await import('./partial-snapshot.mjs');

afterEach(destroyAll);

/** Node index of the tip labelled `label`. */
const tipNode = (snap, label) => snap.tipNode[snap.tipLabels.indexOf(label)];

test('DEEPEST: a tip of the clade at its XMAX, the first in preorder of equals; -1 where it is not loaded', () => {
  const snap = new InMemorySource(parseNewick('((a:1,b:3)x:1,(c:4,d:4)y:0,e:1)root;')).snapshot();
  const L = computeLayout(snap, true);
  const x = snap.parent[tipNode(snap, 'a')],
    y = snap.parent[tipNode(snap, 'c')];
  assert.equal(L.DEEPEST[x], tipNode(snap, 'b'));
  assert.equal(L.DEEPEST[y], tipNode(snap, 'c'), 'c and d tie: the first');
  assert.equal(L.DEEPEST[0], tipNode(snap, 'b'), 'b, c and d tie: the first');
  assert.equal(L.DEEPEST[tipNode(snap, 'e')], tipNode(snap, 'e'), 'a tip is its own');
  // y not loaded: its deepest tips are unknown, and the root takes b, which reaches as far
  const { snap: part, rowOf } = partialSnapshot(snap, [y]);
  const P = computeLayout(part, true);
  assert.equal(P.DEEPEST[rowOf(y)], -1);
  assert.equal(P.DEEPEST[0], rowOf(tipNode(snap, 'b')));
  // with only y's tips that far, the root's deepest is not loaded either
  const s2 = new InMemorySource(parseNewick('((a:1,b:2)x:1,(c:4,d:4)y:0)root;')).snapshot();
  const p2 = partialSnapshot(s2, [s2.parent[tipNode(s2, 'c')]]);
  assert.equal(computeLayout(p2.snap, true).DEEPEST[0], -1);
});

/** A and B are siblings under P, three tips each; B's b2 runs far out. Q's `n` tips make the rows small enough that A and B fold at a
 *  threshold of 1 px while P (six rows) stays open; their tips are short, so Q's slice ends well before B's line. */
const tree = (n) =>
  `(((a0:0.02,a1:0.02,a2:0.02)A:0.01,(b0:0.02,b1:0.02,b2:0.4)B:0.01)P:0.4,(${Array.from({ length: n }, (_, k) => `q${k}:0.05`).join(',')})Q:0)root;`;

for (const [layout, n] of [
  ['radial', 3000],
  ['rectangular', 1000],
]) {
  test(`${layout}: at the 1 px threshold a folded clade is a branch to its deepest tip, and that tip is hovered at its end`, async () => {
    const { viewer, env, ctx } = await makeViewer(tree(n), { size: [300, 300], options: { layout, minCladePx: 1 } });
    env.flush();
    const t = viewer.getTree();
    const b2 = tipNode(t, 'b2'),
      B = t.parent[b2];
    const proj = viewer.proj;
    const end = { x: 0, y: 0 },
      node = { x: 0, y: 0 };
    proj.nodeXY(b2, end);
    proj.nodeXY(B, node);
    assert.equal(viewer.getStats().minPxUsed, 1, 'the threshold is at the floor');
    const entry = [...Array(viewer.list.count).keys()].find((e) => viewer.list.node[e] === B);
    assert.ok(entry !== undefined && viewer.list.kind[entry] === 2, 'B is a summary');
    const near = (a, p) => Math.abs(a[1] - p.x) < 1e-6 && Math.abs(a[2] - p.y) < 1e-6;
    const lines = ctx().calls('lineTo');
    assert.ok(
      lines.some((a) => near(a, end)),
      'a line ends at b2',
    );

    const hit = viewer.hitTest(end.x - 1, end.y);
    assert.deepEqual(hit, { node: b2, kind: 'tip' }, 'the end of the line is b2');
    const mid = viewer.hitTest((end.x + node.x) / 2, (end.y + node.y) / 2);
    assert.deepEqual(mid, { node: B, kind: 'summary' }, 'the rest of it is the clade');

    // above the floor the clade is a fan or a triangle again, and b2 is not hovered
    ctx().reset();
    viewer.setOptions({ minCladePx: 3 });
    env.flush();
    assert.ok(viewer.getStats().minPxUsed > 1);
    proj.nodeXY(b2, end);
    assert.ok(
      !ctx()
        .calls('lineTo')
        .some((a) => near(a, end)),
      'no line to b2',
    );
    assert.notDeepEqual(viewer.hitTest(end.x - 1, end.y), { node: b2, kind: 'tip' });
  });
}
