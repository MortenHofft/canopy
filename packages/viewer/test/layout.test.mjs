// Unit test of the layout invariants (src/core/layout.ts) on a tiny tree. Template for core unit tests: import the TypeScript modules
// directly (Node >= 22.7 with --experimental-transform-types, which `npm test` passes), build a snapshot from the shared Newick parser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));
const { computeLayout } = await import(path.join(root, 'packages/viewer/src/layout.ts'));
const { InMemorySource } = await import(path.join(root, 'packages/viewer/src/source.ts'));

// A trifurcating root, a ladder (C,(D,E)) and unequal branch lengths, so that midpoints, LAST and XMAX are all non-trivial.
const NEWICK = '((A:1,B:2)AB:1,(C:1,(D:2,E:3)DE:1)CDE:2,F:4)root;';

function snapshot(newick = NEWICK) {
  return new InMemorySource(parseNewick(newick)).snapshot();
}

for (const branchLengths of [true, false]) {
  test(`layout invariants (${branchLengths ? 'phylogram' : 'cladogram'})`, () => {
    const t = snapshot();
    const L = computeLayout(t, branchLengths);
    assert.equal(L.n, t.nodeCount);
    assert.equal(L.tips, 6);
    assert.equal(L.usedLengths, branchLengths);
    for (let i = 0; i < t.nodeCount; i++) {
      // LAST: the last child in preorder, -1 for tips
      let last = -1;
      for (let c = t.firstChild[i]; c >= 0; c = t.nextSibling[c]) last = c;
      assert.equal(L.LAST[i], last, `LAST of node ${i}`);
      if (t.childCount[i] === 0) {
        // ROW of a tip: its rank + 0.5
        assert.equal(L.ROW[i], t.tipRank[i] + 0.5, `ROW of tip ${i}`);
        assert.equal(L.XMAX[i], Math.fround(L.X[i]), `XMAX of tip ${i} is its own X`);
      } else {
        // ROW of an internal node: midpoint of its first and last child
        assert.equal(L.ROW[i], (L.ROW[t.firstChild[i]] + L.ROW[last]) / 2, `ROW of node ${i}`);
        assert.ok(L.XMAX[i] >= Math.fround(L.X[i]), `XMAX of node ${i} covers its own X`);
      }
      if (i > 0) {
        const p = t.parent[i];
        assert.ok(L.X[i] >= L.X[p], `X does not decrease from parent ${p} to child ${i}`);
        assert.ok(L.XMAX[p] >= L.XMAX[i], `XMAX is monotone: parent ${p} >= child ${i}`);
      }
    }
    assert.equal(L.X[0], 0, 'the root is at X = 0');
    assert.equal(Math.max(...L.XMAX), 1, 'the deepest tip is at X = 1');
  });
}

test('phylogram X is the normalised distance from the root', () => {
  const t = snapshot();
  const L = computeLayout(t, true);
  assert.equal(L.maxLen, 6, 'the deepest tip is E at 2 + 1 + 3');
  const x = (l) => L.X[t.tipIndex(l)];
  assert.ok(Math.abs(x('E') - 1) < 1e-12, 'E is the deepest tip');
  assert.ok(Math.abs(x('A') - 2 / 6) < 1e-12);
  assert.ok(Math.abs(x('F') - 4 / 6) < 1e-12);
});

test('cladogram aligns all tips at X = 1', () => {
  const t = snapshot();
  const L = computeLayout(t, false);
  for (let r = 0; r < t.tipCount; r++) assert.equal(L.X[t.tipNode[r]], 1);
});
