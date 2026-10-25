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
const { searchCut, DrawList, Seen, cell, clipRay, CLIP, K_SUMMARY, K_TIP } = await import(path.join(core, 'lod.ts'));

test('clipRay: the cells of the part of a ray inside them, far end first; a ray that misses them is keyed by its ring', () => {
  // a ray along +x from the anchor: the window centre is at (ou, ov) = (0, 0), the cells cover -1024..7167 on both axes
  assert.equal(clipRay(0, 100, 1, 0, 0, 0), true);
  assert.deepEqual([...CLIP], [cell(100), cell(0), cell(0), cell(0)], 'inside: its own ends');
  assert.equal(clipRay(0, 100000, 1, 0, 0, 0), true);
  assert.deepEqual([...CLIP], [cell(7167), cell(0), cell(0), cell(0)], 'far end cut at the last cell');
  assert.equal(clipRay(50000, 100000, 1, 0, 0, 0), false, 'starts beyond the cells');
  assert.equal(clipRay(0, 100000, 0, 1, 0, -3000), true, 'a ray up the y axis, the window 3000 px from its start');
  assert.equal(clipRay(0, 100, 0, 1, 5000, 0), false, 'parallel to an axis and outside the cells on the other');
  // two rays whose ends are far on the same side and which cross the cells at different places have different keys
  clipRay(0, 1e6, Math.cos(0.01), Math.sin(0.01), 0, 0);
  const k1 = [...CLIP];
  clipRay(0, 1e6, Math.cos(0.012), Math.sin(0.012), 0, 0);
  assert.notDeepEqual([...CLIP], k1);
  // a miss: the key is the ring, the same for rays at the same distance from the window centre
  clipRay(1e6, 2e6, 1, 0, 0, 0);
  const m1 = CLIP[0];
  clipRay(1e6, 2e6, 0, 1, 0, 0);
  assert.equal(CLIP[0], m1);
  clipRay(3e6, 4e6, 1, 0, 0, 0);
  assert.equal(CLIP[0], 8191, 'a ring far from the window is clamped: one key for all');
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
  searchCut(projectionFor(snap, L, T), null, list, new Seen(), { lod: true, base: 14, cap: Infinity, budget: 5000, summaries: true, hint: 0 });
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

// ---- what the dedupe must keep doing (rule C): a caterpillar zoomed far in still folds, it does not emit every node on the way

/** A comb of n tips with equal short branches. */
function combSnap(n) {
  const parts = ['t0:0.01'];
  for (let i = 1; i < n; i++) parts.push(`:0.01,t${i}:0.01)`);
  return new InMemorySource(parseNewick('('.repeat(n - 1) + parts.join('') + ';')).snapshot();
}

test('a 20k comb zoomed deep, radial and rectangular: the threshold stays at the base and the list stays small', () => {
  const snap = combSnap(20000);
  const L = computeLayout(snap, true);
  ensureTrig(L);
  const rows = snap.tipCount;
  const W = 1198,
    H = 520;
  const area = { ax: 0, ay: 0, aw: W, ah: H, clipL: 0, clipT: 0, clipR: W, clipB: H };
  const cutOf = (kind, vp) => {
    const list = new DrawList();
    const r = searchCut(projectionFor(snap, L, makeTransform(kind, W, H, vp, area, rows)), null, list, new Seen(), {
      lod: true,
      base: 14,
      cap: Infinity,
      budget: 20000,

      summaries: true,
      hint: 0,
    });
    return { list, r };
  };
  let tip = -1;
  for (let i = 0; i < snap.nodeCount && tip < 0; i++) if (snap.childCount[i] === 0 && L.rowStart[i] === Math.floor(0.7 * rows)) tip = i;
  const x = L.X[tip] * L.COS[tip],
    y = L.X[tip] * L.SIN[tip];
  // the most entries a view may have: not deduping the far primitives at all gives 6529, 6020 and 6001 at these three
  const LIMIT = { 64: 8000, 4096: 1500, 262144: 5000 };
  for (const z of [64, 4096, 262144]) {
    const k = (Math.min(W, H) / 2.2) * z;
    const { list, r } = cutOf('radial', { x0: x - W / 2 / k, x1: x + W / 2 / k, y0: y - H / 2 / k, y1: y + H / 2 / k });
    assert.equal(r.minPx, 14, `radial z=${z}: threshold at the base`);
    assert.ok(!r.res.overflow && list.count > 0 && list.count < LIMIT[z], `radial z=${z}: ${list.count} entries`);
  }
  for (const zx of [1, 20, 400]) {
    const yc = 0.5 * rows,
      hy = rows / 10000 / 2,
      hx = 0.55 / zx;
    const { list, r } = cutOf('rectangular', { x0: 0.95 - hx, x1: 0.95 + hx, y0: yc - hy, y1: yc + hy });
    assert.equal(r.minPx, 14, `rectangular zx=${zx}: threshold at the base`);
    assert.ok(!r.res.overflow && list.count > 0 && list.count < 15000, `rectangular zx=${zx}: ${list.count} entries`);
  }
});

test('a deep zoom on the boundary of two collapsed clades of equal depth draws both of them (#111)', () => {
  // four app-collapsed clades of 1000 tips under the root, all at the same depth: their summaries are fans out to the same rim; the centre
  // ray of each misses the cells at a deep zoom, and the two at the window are at the same ring and the same size
  const n = 1000;
  const clade = (p) => '(' + Array.from({ length: n }, (_, k) => `${p}${k}:1`).join(',') + `)${p}:1`;
  const snap = new InMemorySource(parseNewick(`(${clade('A')},${clade('B')},${clade('C')},${clade('D')})r;`)).snapshot();
  const collapsed = new Uint8Array(snap.nodeCount);
  for (let i = 1; i < snap.nodeCount; i++) if (snap.childCount[i] > 0) collapsed[i] = 1;
  const L = computeLayout(snap, true, collapsed);
  const FAN = { start: 0.3, span: 2 * Math.PI };
  setLayoutFan(L, FAN);
  ensureTrig(L);
  const W = 1198,
    H = 520;
  const area = { ax: 0, ay: 0, aw: W, ah: H, clipL: 0, clipT: 0, clipR: W, clipB: H };
  const a = FAN.start + Math.PI / 2; // the boundary of the first two clades
  const R = Math.max(...L.XMAX);
  for (const z of [4, 64, 1024]) {
    const k = (Math.min(W, H) / 2.2) * z;
    const x = R * Math.cos(a),
      y = R * Math.sin(a);
    const T = makeTransform('radial', W, H, { x0: x - W / 2 / k, x1: x + W / 2 / k, y0: y - H / 2 / k, y1: y + H / 2 / k }, area, L.rowEnd[0], FAN);
    const list = new DrawList();
    searchCut(projectionFor(snap, L, T), null, list, new Seen(), { lod: true, base: 14, cap: Infinity, budget: 20000, summaries: true, hint: 0 });
    const drawn = [];
    for (let e = 0; e < list.count; e++) if (list.kind[e] === K_SUMMARY) drawn.push(list.node[e]);
    const [nodeA, nodeB] = [1, 1 + n + 1];
    assert.ok(drawn.includes(nodeA) && drawn.includes(nodeB), `z=${z}: both clades on the boundary are drawn, got ${drawn}`);
  }
});

// ---- a summary is told apart by how far it reaches, not only by its node: a clade with a long branch is not dropped for a short one

test('two folded sibling clades in the same cells, the second reaching far: its summary is kept, radial and rectangular', () => {
  // A and B are siblings under P, each three tips on sub-pixel rows (Q's 6000 tips make the rows small); A's tips end just past it, one of
  // B's runs far out. Keyed by their node, B's summary had A's cells and was dropped, and with it the long branch
  const filler = Array.from({ length: 6000 }, (_, k) => `q${k}:1`).join(',');
  const snap = new InMemorySource(
    parseNewick(`(((a0:0.02,a1:0.02,a2:0.02)A:0.01,(b0:0.02,b1:0.02,b2:0.4)B:0.01)P:0.4,(${filler})Q:0)root;`),
  ).snapshot();
  const L = computeLayout(snap, true);
  ensureTrig(L);
  const rows = snap.tipCount;
  let b2 = 0;
  while (!(snap.childCount[b2] === 0 && snap.tipLabels[snap.leafStart[b2]] === 'b2')) b2++;
  const B = snap.parent[b2];
  const W = 300,
    H = 300;
  const area = { ax: 0, ay: 0, aw: W, ah: H, clipL: 0, clipT: 0, clipR: W, clipB: H };
  const views = { radial: { x0: -1.1, x1: 1.1, y0: -1.1, y1: 1.1 }, rectangular: { x0: 0, x1: 1, y0: 0, y1: H / 0.12 } }; // rectangular: rows of 0.12 px
  for (const [kind, vp] of Object.entries(views)) {
    const list = new DrawList();
    searchCut(projectionFor(snap, L, makeTransform(kind, W, H, vp, area, rows)), null, list, new Seen(), {
      lod: true,
      base: 0.5, // P (0.7 px) stays open, A and B (0.4 px at most) fold
      cap: Infinity,
      budget: 5000,
      summaries: true,
      hint: 0,
    });
    const entries = [...Array(list.count).keys()].filter((e) => list.node[e] === B);
    assert.ok(entries.length === 1 && list.kind[entries[0]] === K_SUMMARY, `${kind}: B is drawn as a summary (${entries.length} entries)`);
  }
});
