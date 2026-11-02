// Unit tests of the search: the index (`createSearchIndex`: tips and named internal nodes, prefix first, runs of spaces and underscores)
// the control is tested in controls.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { createSearchIndex } = await import('../src/search-index.ts');
const { InMemorySource } = await import('../src/source.ts');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));

const NEWICK = "((A:1,B:1)0.95:1,(C:1,D:1)'100:c__Spirochaetia':1,(E:1,F:1)node_EF:1,(x_c_spirochaetia:1,G:1)Plain:1)root_label;";
const ident = (s) => s;

function index(tree = parseNewick(NEWICK)) {
  return { tree, idx: createSearchIndex(new InMemorySource(tree).snapshot(), { formatLabel: ident }) };
}
const nodeOf = (tree, label) => [...Array(tree.nodeCount).keys()].find((i) => tree.labels[i] === label);

test('the index finds internal nodes by name, not support values', () => {
  const { tree, idx } = index();
  assert.deepEqual(idx.find('node ef').hits, [{ node: nodeOf(tree, 'node_EF'), clade: true }]);
  assert.equal(idx.find('0.95').total, 0, 'a support value is no name');
  assert.deepEqual(idx.find('root').hits, [{ node: nodeOf(tree, 'root_label'), clade: true }]);
});

test('the index: a run of spaces and underscores is one separator, prefix matches first', () => {
  const { tree, idx } = index();
  const r = idx.find('c spirochaetia');
  assert.equal(r.total, 2);
  assert.deepEqual(
    r.hits.map((h) => h.clade),
    [true, false],
    'the clade starting with it comes before the tip that contains it',
  );
  assert.equal(idx.find('c__spirochaetia').total, 2);
  assert.equal(idx.find('  ').total, 0);
  assert.equal(idx.find('i', 1).hits.length, 1, 'at most max hits, total counts all');
  assert.ok(idx.find('i', 1).total > 1);
  assert.equal(tree.tipCount, 8);
});

test('the index: a trailing underscore is part of the query, white space round it is not', () => {
  const { idx } = index(parseNewick('(a_b:1,a:1,ab:1)r;'));
  assert.equal(idx.find('a_').total, 1);
  assert.equal(idx.find(' a ').total, 3);
});

test('formatLabel gets the node id too: tips with one label can be named differently, and an internal name is looked up by node', () => {
  const tree = parseNewick('((A,A)Genus,B);');
  const snap = new InMemorySource(tree).snapshot();
  const calls = [];
  const names = ['', '', 'Plant one', 'Plant two', 'Bee'];
  const idx = createSearchIndex(snap, {
    formatLabel: (label, node) => {
      calls.push([label, node]);
      return label === 'Genus' ? 'Genus Mill.' : names[node];
    },
  });
  assert.deepEqual(
    calls.sort((a, b) => a[1] - b[1]),
    [
      ['Genus', 1],
      ['A', 2],
      ['A', 3],
      ['B', 4],
    ].sort((a, b) => a[1] - b[1]),
    'every named node, with its own id',
  );
  assert.deepEqual(idx.find('plant one').hits, [{ node: 2, clade: false }]);
  assert.deepEqual(idx.find('plant two').hits, [{ node: 3, clade: false }]);
  assert.deepEqual(idx.find('genus mill').hits, [{ node: 1, clade: true }]);
});
