// Unit tests of the stub opener (src/core/detail-loader.ts) with a fake partial source: which stubs are asked for, in what order, how
// many at once, and when it stops asking. No DOM, no canvas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { DetailLoader } = await import(path.join(root, 'spikes/custom/src/core/detail-loader.ts'));
const { K_SUMMARY, K_TIP } = await import(path.join(root, 'spikes/custom/src/core/lod.ts'));

// Rows 0..5: row r is a stub standing for r * 10 tips (rows 0 and 5 are not drawn as stubs); global id = row + 100.
function fixture(sizes) {
  const n = sizes.length;
  const stub = new Uint8Array(n).fill(1);
  const leafStart = new Int32Array(n);
  const leafEnd = new Int32Array(n);
  let rank = 0;
  sizes.forEach((s, i) => {
    leafStart[i] = rank;
    leafEnd[i] = rank + s;
    rank += s;
  });
  const globalId = Int32Array.from(sizes, (_, i) => 100 + i);
  const tree = { stub, globalId, leafStart, leafEnd };
  const list = { count: n, kind: new Uint8Array(n).fill(K_SUMMARY), node: Int32Array.from(sizes, (_, i) => i) };
  return { tree, list };
}
const T = { ky: 5, k: 100, da: 0.01, clipT: 0, clipB: 600, clipL: 0, clipR: 800 };
const L = { XMAX: new Float32Array(16).fill(1) };

function source(over = {}) {
  const calls = [];
  const s = {
    version: 1,
    calls,
    openCost: over.openCost,
    ensureClade(id, o) {
      return new Promise((resolve, reject) => calls.push({ id, o, resolve, reject }));
    },
  };
  return s;
}
const flush = () => new Promise((r) => setImmediate(r));

test('a fitted view asks for nothing; otherwise only stubs taller than 40 px, biggest first', () => {
  const { tree, list } = fixture([4, 20, 9, 30, 12]); // px at ky 5: 20 100 45 150 60 -> rows 0 (20 px) is too small
  const src = source();
  const d = new DetailLoader(src, () => {});
  d.request(tree, list, T, L, true, true, 1);
  assert.equal(src.calls.length, 0, 'the first view is the overview as it is');
  d.request(tree, list, T, L, true, false, 1);
  assert.deepEqual(
    src.calls.map((c) => c.id),
    [103, 101, 104, 102],
    'tall enough only (not row 0), biggest first',
  );
  assert.deepEqual(
    src.calls.map((c) => c.o.priority),
    [150, 100, 60, 45],
  );
});

test('at most four requests in flight; a stub that left the view is aborted', () => {
  const { tree, list } = fixture([20, 20, 20, 20, 20, 20]);
  const src = source();
  const d = new DetailLoader(src, () => {});
  d.request(tree, list, T, L, true, false, 1);
  assert.equal(src.calls.length, 4);
  d.request(tree, list, T, L, true, false, 1);
  assert.equal(src.calls.length, 4, 'the same four are still pending: not asked again');
  list.count = 2; // only rows 0 and 1 stay in view
  d.request(tree, list, T, L, true, false, 1);
  assert.deepEqual(
    src.calls.map((c) => c.o.signal.aborted),
    [false, false, true, true],
  );
  d.destroy();
  assert.ok(src.calls.every((c) => c.o.signal.aborted));
});

test('only summary rows with stub = 1 are candidates', () => {
  const { tree, list } = fixture([20, 20, 20]);
  list.kind[0] = K_TIP;
  tree.stub[1] = 0;
  const src = source();
  new DetailLoader(src, () => {}).request(tree, list, T, L, true, false, 1);
  assert.deepEqual(
    src.calls.map((c) => c.id),
    [102],
  );
});

test('a big clade waits until it fills a third of the view', () => {
  const { tree, list } = fixture([20, 40]); // 100 px and 200 px, view 600 px: need 198 px
  const src = source({ openCost: (id) => (id === 101 ? 50000 : 10) });
  new DetailLoader(src, () => {}).request(tree, list, T, L, true, false, 1);
  assert.deepEqual(
    src.calls.map((c) => c.id),
    [101, 100],
  );
  const small = fixture([20, 30]); // 150 px < 198
  const src2 = source({ openCost: () => 50000 });
  new DetailLoader(src2, () => {}).request(small.tree, small.list, T, L, true, false, 1);
  assert.equal(src2.calls.length, 0);
});

test('radial: the size on screen is the arc at the clade outer radius', () => {
  const { tree, list } = fixture([10, 80]); // arc = tips * da * XMAX * k = 10 and 80 px
  const src = source();
  new DetailLoader(src, () => {}).request(tree, list, T, L, false, false, 1);
  assert.deepEqual(
    src.calls.map((c) => c.id),
    [101],
  );
});

test('resolved with a new source version: redraw; resolved without: not asked again until the version moves', async () => {
  const { tree, list } = fixture([20]);
  const src = source();
  let redraws = 0;
  const d = new DetailLoader(src, () => redraws++);
  d.request(tree, list, T, L, true, false, 1);
  src.version = 2; // rows arrived
  src.calls[0].resolve();
  await flush();
  assert.equal(redraws, 1);
  d.request(tree, list, T, L, true, false, 2);
  assert.equal(src.calls.length, 2, 'the stub is still a stub in this fixture: asked again');
  src.calls[1].resolve(); // nothing changed
  await flush();
  assert.equal(redraws, 1);
  d.request(tree, list, T, L, true, false, 2);
  assert.equal(src.calls.length, 2, 'at the same version it is not asked again');
  d.request(tree, list, T, L, true, false, 3);
  assert.equal(src.calls.length, 3, 'once the version moved it is');
});

test('a failed request is not retried; an aborted one is not a failure', async () => {
  const { tree, list } = fixture([20, 20]);
  const src = source();
  const d = new DetailLoader(src, () => {});
  const warn = console.warn;
  const warned = [];
  console.warn = (...a) => warned.push(a);
  try {
    d.request(tree, list, T, L, true, false, 1);
    assert.equal(src.calls.length, 2);
    src.calls[0].reject(new Error('boom'));
    list.count = 1; // row 1 leaves the view: aborted
    d.request(tree, list, T, L, true, false, 1);
    src.calls[1].reject(new Error('aborted'));
    await flush();
    list.count = 2;
    d.request(tree, list, T, L, true, false, 1);
    assert.equal(src.calls.length, 3, 'row 0 failed for good, row 1 (aborted) is asked for again');
    assert.equal(src.calls[2].id, 101);
    assert.equal(warned.length, 1, 'only the real failure is reported');
  } finally {
    console.warn = warn;
  }
});
