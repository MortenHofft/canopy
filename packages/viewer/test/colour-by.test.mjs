// colourBy: categories, the 'Other' bucket, tips without a value, and the swatch column's data.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { colourBy } = await import('../src/colour-by.ts');

const THEME = { categorical: ['#111', '#222'], muted: '#999' };
// tips are nodes 1..5
const VALUES = { 1: 'DK', 2: 'DK', 3: 'KE', 4: 'PE', 5: undefined };
const tree = { tipCount: 5, tipNode: [1, 2, 3, 4, 5], annotations: { get: (n, k) => (k === 'country' ? VALUES[n] : undefined) } };

test('most frequent values take the palette in order, the rest share Other', () => {
  const r = colourBy(tree, 'country', THEME);
  assert.equal(r.coloured, 4);
  assert.deepEqual(
    r.clades.map((c) => [c.node, c.colour]),
    [
      [1, '#111'],
      [2, '#111'],
      [3, '#222'],
      [4, '#999'],
    ],
  );
  assert.deepEqual(
    r.items.map((i) => i.label),
    ['DK', 'KE', 'Other'],
  );
  assert.equal(r.items[0].detail, '2 tips');
});

test('swatch column: prepare gives a class per rank, -1 where there is no value', () => {
  const r = colourBy(tree, 'country', THEME);
  const d = r.column.renderer.prepare({ values: {}, nodeValues: r.column.nodeValues, tipLabels: [], tipNodes: tree.tipNode, tipCount: 5 });
  assert.deepEqual([...d], [0, 0, 1, 2, -1]);
  assert.equal(r.column.renderer.hasCell(d, 4), false);
});

test('a tree without annotations, or a missing key, colours nothing', () => {
  assert.equal(colourBy({ ...tree, annotations: null }, 'country', THEME).clades.length, 0);
  assert.equal(colourBy(tree, 'nope', THEME).items.length, 0);
});

test('palette and other can be overridden', () => {
  const r = colourBy(tree, 'country', THEME, { palette: ['#a'], other: '#o' });
  assert.deepEqual(
    r.clades.map((c) => c.colour),
    ['#a', '#a', '#o', '#o'],
  );
});
