// The pixel-cell dedupe of the cut (Seen, cell) and coordinates beyond the cells (#111). A deep radial zoom puts the nodes of the clades in
// view thousands of px away (a long branch under a tree of thousands of tips), outside the 13 bits a cell has. Clamping them put every
// such node in the same cell, so two sibling summaries of the same size, a whole row apart, were taken for the same pixels and one was
// dropped: its slot was drawn as nothing, next to a summary that ends where the slot begins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', '..');
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));
const core = path.join(root, 'packages/viewer/src');
const { computeLayout, ensureTrig, setLayoutFan } = await import(path.join(core, 'layout.ts'));
const { InMemorySource } = await import(path.join(core, 'source.ts'));
const { makeTransform } = await import(path.join(core, 'geom.ts'));
const { projectionFor } = await import(path.join(core, 'projection.ts'));
const { searchCut, DrawList, Seen, cell, OUT_OF_CELLS, K_SUMMARY, K_TIP } = await import(path.join(core, 'lod.ts'));

test('cell: a coordinate beyond the 13 bits is OUT_OF_CELLS, one inside them is its cell', () => {
  assert.equal(cell(0), 1024);
  assert.equal(cell(7166.5), 8190);
  assert.equal(cell(7167), 8191, 'the last cell');
  assert.equal(cell(7168), OUT_OF_CELLS);
  assert.equal(cell(-1024), 0, 'the first cell');
  assert.equal(cell(-1025), OUT_OF_CELLS);
  assert.ok(OUT_OF_CELLS + 5 * 8192 < 0, 'still negative with the kind added to it');
});

test('Seen.add: a key with a coordinate beyond the cells is never taken for one already seen', () => {
  const s = new Seen();
  assert.equal(s.add(1, 2, 3, 4, 5), true);
  assert.equal(s.add(1, 2, 3, 4, 5), false);
  const far = [OUT_OF_CELLS, 2, 3, 4, 5];
  assert.equal(s.add(...far), true);
  assert.equal(s.add(...far), true, 'again: its position is not known, so it cannot be a repeat');
  assert.equal(s.add(1, 2, OUT_OF_CELLS, 4, 5), true);
  assert.equal(s.add(1, 2, 3, OUT_OF_CELLS + 3 * 8192, 5), true);
  assert.equal(s.add(1, 2, 3, 4, OUT_OF_CELLS), true);
});

/** A tree of N + 10 tips in a circle. Rows 0..9 are ten unary clades under P (clade nodes at depth 0.2, their one tip at depth 1), then a
 *  polytomy of N tips at depth 1. Zoomed on rows 0..9 with the rows 13 px apart, the clade nodes are 0.8 of the radius (~ 0.8 * 13 / 2pi
 *  * N px) from the view: far beyond the cells. */
function farTree(N) {
  const unary = Array.from({ length: 10 }, (_, k) => `(u${k}:0.8)c${k}:0.1`).join(',');
  const poly = Array.from({ length: N }, (_, k) => `q${k}:1`).join(',');
  const snap = new InMemorySource(parseNewick(`((${unary})P:0.1,(${poly})Q:0)root;`)).snapshot();
  return snap;
}

test('a deep radial zoom keeps every one of the sibling summaries in view: no slot is left empty (#111)', () => {
  const N = 20000;
  const snap = farTree(N);
  const L = computeLayout(snap, true);
  // the rows start at 45 degrees: the view lies on a diagonal from the centre, so both of its coordinates are far from the nodes
  const FAN = { start: Math.PI / 4, span: 2 * Math.PI };
  setLayoutFan(L, FAN);
  ensureTrig(L);
  const rows = snap.tipCount;
  const da = (2 * Math.PI) / rows;
  const W = 300,
    H = 200;
  const k = 13 / da; // px per unit of the unit circle: tips 13 px apart at the rim
  const c = FAN.start + 5 * da; // the angle of row 5
  const vp = { x0: Math.cos(c) - W / 2 / k, x1: Math.cos(c) + W / 2 / k, y0: Math.sin(c) - H / 2 / k, y1: Math.sin(c) + H / 2 / k };
  const area = { ax: 0, ay: 0, aw: W, ah: H, clipL: 0, clipT: 0, clipR: W, clipB: H };
  const T = makeTransform('radial', W, H, vp, area, rows, FAN);
  const list = new DrawList();
  searchCut(projectionFor(snap, L, T), null, list, new Seen(), { lod: true, base: 14, budget: 5000, summaries: true, hint: 0 });
  const units = [];
  for (let r = 0; r < 10; r++) {
    // the unary clade node of row r and the entry that covers its row
    const e = [...Array(list.count).keys()].find((e) => {
      const i = list.node[e];
      if (list.kind[e] !== K_SUMMARY && list.kind[e] !== K_TIP) return false;
      return L.rowStart[i] <= r && r < L.rowEnd[list.last[e] >= 0 ? list.last[e] : i];
    });
    units.push(e === undefined ? -1 : list.kind[e]);
  }
  assert.deepEqual(
    units.map((u) => u >= 0),
    Array(10).fill(true),
    `rows 0..9 each have a tip or a summary, entry kinds ${units}`,
  );
});
