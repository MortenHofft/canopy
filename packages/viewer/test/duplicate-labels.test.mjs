// Duplicate tip labels (#18): a label is a lookup key, not the identity of a tip. `setHighlighted` takes labels (every tip that carries
// one) and node ids (that tip alone); `tipNodes` lists every tip with a label; a highlighted node id follows its tip through setTree's map.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNewick, TreeModel } from '@canopy/io';

const { makeViewer, destroyAll } = await import('./viewer-harness.mjs');
const { reroot } = await import('../../tree-ops/src/index.ts');
afterEach(destroyAll);

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data');
const NWK = fs.readFileSync(path.join(DATA, 'rich/edge-cases/duplicate-tip-labels.nwk'), 'utf8');
// preorder: 0 Hominoidea, 1 Hominini, 2 H1, 3 Homo, 4 Homo, 5 Pan, 6 (), 7 Homo, 8 Gorilla, 9 (), 10 (), 11 Pongo, 12 '3 taxa', 13 (),
// 14 Hylobates, 15 '3 taxa'. Ranks: Homo 0, 1, 3; '3 taxa' 6, 8.

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

test('a label highlights every tip that carries it; a node id that tip alone', async () => {
  const { viewer: v, env } = await makeViewer(NWK);
  env.flush();
  v.setHighlighted(['Homo_sapiens']);
  assert.deepEqual([...v.hlRanks], [0, 1, 3], 'all three tips, not the last one only');
  v.setHighlighted(['3 taxa', 'Pan_troglodytes']);
  assert.deepEqual([...v.hlRanks], [2, 6, 8]);
  v.setHighlighted([7]);
  assert.deepEqual([...v.hlRanks], [3], 'node 7 is the third Homo_sapiens');
  v.setHighlighted([4, 'Homo_sapiens', 'unknown']);
  assert.deepEqual([...v.hlRanks], [0, 1, 3], 'a tip named twice counts once');
  assert.deepEqual(v.getHighlighted(), [4, 'Homo_sapiens', 'unknown'], 'getHighlighted gives back what was set');
});

test('highlightchange carries labels and node ids; an identical list is a no-op', async () => {
  const { viewer: v, env } = await makeViewer(NWK);
  env.flush();
  const seen = [];
  v.on('highlightchange', (ids) => seen.push(ids));
  v.setHighlighted([3, 'Pan_troglodytes']);
  v.setHighlighted([3, 'Pan_troglodytes']);
  v.setHighlighted(['3', 'Pan_troglodytes']);
  assert.deepEqual(seen, [
    [3, 'Pan_troglodytes'],
    ['3', 'Pan_troglodytes'],
  ]);
  assert.deepEqual([...v.hlRanks], [2], "'3' is a label (no tip has it), not node 3");
});

test('numbers that are not tips are ignored with a warning; labels never warn', async () => {
  const { viewer: v, env } = await makeViewer(NWK);
  env.flush();
  assert.deepEqual(
    warnings(() => v.setHighlighted(['Homo_sapiens', 'no such tip', 3])),
    [],
  );
  const w = warnings(() => v.setHighlighted([16, 1.5, 2, 'Pan_troglodytes']));
  assert.equal(w.length, 2);
  assert.match(w[0], /setHighlighted: 16, 1\.5 are not nodes of this tree/);
  assert.match(w[1], /setHighlighted: 2 is an internal node, not tips/);
  assert.deepEqual([...v.hlRanks], [2], 'only the label is highlighted');
});

test('tipNode is the first tip with a label, tipNodes all of them', async () => {
  const { viewer: v, env } = await makeViewer(NWK);
  env.flush();
  assert.equal(v.tipNode('Homo_sapiens'), 3);
  assert.deepEqual(v.tipNodes('Homo_sapiens'), [3, 4, 7]);
  assert.deepEqual(v.tipNodes('Gorilla_gorilla'), [8]);
  assert.deepEqual(v.tipNodes('nope'), []);
});

test('a tree without tipIndices (a custom TreeData): a label names the tip tipIndex finds', async () => {
  const t = parseNewick(NWK);
  const custom = Object.create(t);
  custom.tipIndices = undefined;
  const { viewer: v, env } = await makeViewer(custom);
  env.flush();
  v.setHighlighted(['Homo_sapiens']);
  assert.deepEqual([...v.hlRanks], [0]);
  assert.deepEqual(v.tipNodes('Homo_sapiens'), [3]);
});

test('setTree: a highlighted node id follows its tip through the map, a label stays a label', async () => {
  const a = parseNewick(NWK);
  const { viewer: v, env } = await makeViewer(a);
  env.flush();
  v.setHighlighted([7, '3 taxa']);
  const r = reroot(a, 11); // on Pongo's edge: every tip moves
  const b = new TreeModel(r.tree);
  v.setTree(b, { map: r.map });
  const q = r.map[7];
  assert.equal(b.labels[q], 'Homo_sapiens');
  assert.deepEqual(v.getHighlighted(), [q, '3 taxa']);
  const want = [b.tipRank[q], ...b.tipIndices('3 taxa').map((k) => b.tipRank[k])].sort((x, y) => x - y);
  assert.deepEqual([...v.hlRanks], want);
  // a tip that is gone is dropped from the list
  v.setHighlighted([b.tipIndex('Gorilla_gorilla'), 'Pan_troglodytes']);
  const map = new Int32Array(b.nodeCount).fill(-1);
  const keep = parseNewick('(Pan_troglodytes,Hylobates_lar);');
  map[b.tipIndex('Pan_troglodytes')] = 1;
  v.setTree(keep, { map });
  assert.deepEqual(v.getHighlighted(), ['Pan_troglodytes']);
  assert.deepEqual([...v.hlRanks], [0]);
});

test('column values by label go to every tip with the label; nodeValues by node id win for their tip', async () => {
  const { compileColumn, columnSpecEquals } = await import('../src/columns.ts');
  const { InMemorySource } = await import('../src/source.ts');
  const snap = new InMemorySource(parseNewick(NWK)).snapshot();
  const values = { Homo_sapiens: 'x', '3 taxa': 3 };
  const text = compileColumn(snap, { id: 't', kind: 'text', header: 'T', width: 40, values });
  assert.deepEqual(
    [0, 1, 3, 6, 8].map((r) => text.txt[r]),
    ['x', 'x', 'x', '3', '3'],
  );
  const nodeValues = new Map([
    [4, 'y'],
    [5, 'pan'],
  ]);
  const spec = { id: 't', kind: 'text', header: 'T', width: 40, values, nodeValues };
  const both = compileColumn(snap, spec);
  assert.deepEqual(
    [0, 1, 2, 3].map((r) => both.txt[r]),
    ['x', 'y', 'pan', 'x'],
  );
  assert.equal(columnSpecEquals(spec, { ...spec, nodeValues: new Map(nodeValues) }), false, 'nodeValues compared by reference');
  const bar = compileColumn(snap, { id: 'b', kind: 'bar', header: 'B', width: 40, values: { Homo_sapiens: 2 }, nodeValues: new Map([[7, 5]]) });
  assert.deepEqual([...bar.num.slice(0, 4)], [2, 2, NaN, 5]);
  let got = null;
  const custom = compileColumn(snap, {
    id: 'c',
    kind: 'custom',
    header: 'C',
    width: 40,
    values: { Pan_troglodytes: 1 },
    nodeValues: new Map([[8, 2]]),
    renderer: {
      prepare: (src) => (got = src),
      draw() {},
    },
  });
  assert.equal(got.nodeValues.get(8), 2);
  assert.equal(got.tipNodes[4], 8, 'rank 4 is node 8');
  assert.deepEqual([...custom.has], [0, 0, 1, 0, 1, 0, 0, 0, 0], 'the default hasCell reads both');
});
