// colourBy: categories, the 'Other' bucket, tips without a value, and the swatch column's data.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { colourBy } = await import('../src/colour-by.ts');

const THEME = { categorical: ['#111', '#222'], muted: '#999' };
// tips are nodes 1..5; codes by node, most frequent value first (DK 2, KE 1, PE 1)
const tree = { tipCount: 5, tipNode: [1, 2, 3, 4, 5] };
const by = { key: 'country', codes: [-1, 0, 0, 1, 2, -1], values: ['DK', 'KE', 'PE'], counts: [2, 1, 1] };

test('most frequent values take the palette in order, the rest share Other', () => {
  const r = colourBy(tree, by, THEME);
  assert.equal(r.coloured, 4);
  assert.deepEqual(
    r.clades.map((c) => [c.node, c.colour, c.label]),
    [
      [1, '#111', 'DK'],
      [2, '#111', 'DK'],
      [3, '#222', 'KE'],
      [4, '#999', 'PE'],
    ],
  );
  assert.deepEqual(
    r.items.map((i) => i.label),
    ['DK', 'KE', 'Other'],
  );
  assert.equal(r.items[0].detail, '2 tips');
  assert.equal(r.items[2].detail, '1 tip, 1 values');
});

test('swatch column: prepare gives a class per rank, -1 where there is no value', () => {
  const r = colourBy(tree, by, THEME);
  assert.equal(r.column.id, 'colour-by:country');
  const d = r.column.renderer.prepare({ values: {}, nodeValues: null, tipLabels: [], tipNodes: tree.tipNode, tipCount: 5 });
  assert.deepEqual([...d], [0, 0, 1, 2, -1]);
  assert.equal(r.column.renderer.hasCell(d, 4), false);
});

test('a column with no values colours nothing', () => {
  const r = colourBy(tree, { key: 'x', codes: [-1, -1, -1, -1, -1, -1], values: [], counts: [] }, THEME);
  assert.deepEqual([r.clades.length, r.items.length], [0, 0]);
});

test('palette and other can be overridden', () => {
  const r = colourBy(tree, by, THEME, { palette: ['#a'], other: '#o' });
  assert.deepEqual(
    r.clades.map((c) => c.colour),
    ['#a', '#a', '#o', '#o'],
  );
});
