// Duplicate tip labels (#18): labels are lookup keys, not the identity of a tip. Every tip is kept, the duplicates are reported, a label
// lookup finds the first tip with it (`tipIndex`) or all of them (`tipIndices`).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNewick, parseNexus } from '../src/newick.ts';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data');
const text = fs.readFileSync(path.join(DATA, 'rich/edge-cases/duplicate-tip-labels.nwk'), 'utf8');

// preorder: 0 Hominoidea, 1 Hominini, 2 H1, 3 Homo, 4 Homo, 5 Pan, 6 (), 7 Homo, 8 Gorilla, 9 (), 10 (), 11 Pongo, 12 '3 taxa', 13 (),
// 14 Hylobates, 15 '3 taxa'
test('the edge-case tree keeps every tip and reports the duplicated labels with all their tips in preorder', () => {
  const t = parseNewick(text);
  assert.equal(t.tipCount, 9);
  const d = t.duplicateTipLabels();
  assert.deepEqual([...d.keys()].sort(), ['3 taxa', 'Homo_sapiens']);
  assert.deepEqual(d.get('Homo_sapiens'), [3, 4, 7]);
  assert.deepEqual(d.get('3 taxa'), [12, 15]);
});

test('tipIndex is the first tip with the label, tipIndices all of them; a unique label has one, an unknown none', () => {
  const t = parseNewick(text);
  assert.equal(t.tipIndex('Homo_sapiens'), 3, 'the first in preorder, not the last');
  assert.equal(t.tipNodeId('3 taxa'), 'n12');
  assert.deepEqual(t.tipIndices('Homo_sapiens'), [3, 4, 7]);
  assert.deepEqual(t.tipIndices('Pan_troglodytes'), [5]);
  assert.deepEqual(t.tipIndices('Nope'), []);
  assert.equal(t.tipIndex('Nope'), -1);
  t.tipIndices('Homo_sapiens').push(99);
  assert.deepEqual(t.tipIndices('Homo_sapiens'), [3, 4, 7], 'the returned array is a copy');
});

test('a tree with unique labels reports no duplicates', () => {
  const t = parseNewick('((A,B),(C,D));');
  assert.equal(t.duplicateTipLabels().size, 0);
  assert.deepEqual(t.tipIndices('C'), [t.tipIndex('C')]);
});

test('mrcaOf counts every tip of a duplicated label', () => {
  const t = parseNewick(text);
  assert.equal(t.mrcaOf(['Homo_sapiens']), 0, 'Homo_sapiens is in Hominini and in its sister clade: the MRCA is the root');
  assert.equal(t.mrcaOf(['3 taxa']), 9);
  assert.equal(t.mrcaOf(['Pan_troglodytes', 3]), 1);
});

test('NEXUS: duplicates made by TRANSLATE are reported too, and relabelling rebuilds the index', () => {
  const nex = `#NEXUS
begin trees;
  translate 1 Homo_sapiens, 2 Pan_troglodytes, 3 Homo_sapiens;
  tree t = ((1,2),3);
end;`;
  const { tree } = parseNexus(nex);
  assert.deepEqual(tree.duplicateTipLabels().get('Homo_sapiens'), [2, 4]);
  let k = 0;
  tree.relabelTips((l) => (l === 'Homo_sapiens' ? `Homo_sapiens_${++k}` : undefined));
  assert.equal(tree.duplicateTipLabels().size, 0);
  assert.equal(tree.tipIndex('Homo_sapiens_2'), 4);
});
