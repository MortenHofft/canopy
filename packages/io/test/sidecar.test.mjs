import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNewick, parseNexus, parseSidecar, applySidecar, SidecarError } from '@gbif-phylo/io';

const NEWICK = '((A:1,B:1)Clade1:1,(C:1,D:1):1);';

test('TSV: columns, numbers and strings', () => {
  const t = parseSidecar('ID\tcountry\tyear\nA\tDenmark\t2019\nB\tKenya\t007\n');
  assert.equal(t.delimiter, 'tab');
  assert.deepEqual(t.columns, ['country', 'year']);
  const tree = parseNewick(NEWICK);
  const r = applySidecar(tree, t);
  assert.equal(r.matchedRows, 2);
  const a = tree.tipIndex('A');
  assert.equal(tree.annotations.get(a, 'country'), 'Denmark');
  assert.equal(tree.annotations.get(a, 'year'), 2019);
  assert.equal(tree.annotations.get(tree.tipIndex('B'), 'year'), '007'); // leading zeros stay a string
});

test('CSV with quotes, embedded commas, escaped quotes, BOM and CRLF', () => {
  const t = parseSidecar('﻿id,note,country\r\n"A","a, with comma","Den ""mark"""\r\nB,,Kenya\r\n');
  assert.equal(t.delimiter, 'comma');
  assert.deepEqual(t.rows[0], { id: 'A', cells: ['a, with comma', 'Den "mark"'] });
  assert.deepEqual(t.rows[1].cells, ['', 'Kenya']);
  const tree = parseNewick(NEWICK);
  applySidecar(tree, t);
  assert.equal(tree.annotations.get(tree.tipIndex('B'), 'note'), undefined); // empty cell is not set
  assert.equal(tree.annotations.get(tree.tipIndex('B'), 'country'), 'Kenya');
});

test('report: unmatched IDs, tips without a row, duplicate IDs', () => {
  const tree = parseNewick(NEWICK);
  const r = applySidecar(tree, parseSidecar('ID\tx\nA\t1\nA\t2\nZ\t3\n'));
  assert.deepEqual(r.unmatchedIds, ['Z']);
  assert.deepEqual(r.tipsWithoutRow, ['B', 'C', 'D']);
  assert.deepEqual(r.duplicateIds, ['A']);
  assert.equal(tree.annotations.get(tree.tipIndex('A'), 'x'), 2); // later row wins
});

test('an ID can name an internal node; a duplicate tip label gets the row on every tip', () => {
  const tree = parseNewick('((A,A)Clade1,B);');
  const r = applySidecar(tree, parseSidecar('ID,group\nClade1,north\nA,x\n'));
  assert.equal(r.unmatchedIds.length, 0);
  assert.equal(tree.annotations.get(1, 'group'), 'north'); // node 1 is Clade1
  assert.deepEqual(
    tree.tipIndices('A').map((k) => tree.annotations.get(k, 'group')),
    ['x', 'x'],
  );
});

test('merges into existing BEAST annotations without losing them', () => {
  const tree = parseNewick('(A[&posterior=0.9],B);', { annotations: true });
  applySidecar(tree, parseSidecar('ID,country\nA,Denmark\n'));
  const a = tree.tipIndex('A');
  assert.equal(tree.annotations.get(a, 'posterior'), 0.9);
  assert.equal(tree.annotations.get(a, 'country'), 'Denmark');
});

test('works on a NEXUS tree after TRANSLATE', () => {
  const { tree } = parseNexus('#NEXUS\nbegin trees;\ntranslate 1 Alpha, 2 Beta;\ntree t = (1,2);\nend;\n');
  const r = applySidecar(tree, parseSidecar('ID\tcountry\nAlpha\tPeru\n'));
  assert.deepEqual(r.tipsWithoutRow, ['Beta']);
  assert.equal(tree.annotations.get(tree.tipIndex('Alpha'), 'country'), 'Peru');
});

test('errors', () => {
  assert.throws(() => parseSidecar(''), SidecarError);
  assert.throws(() => parseSidecar('name\tcountry\nA\tx\n'), /must be named ID/);
  assert.throws(() => parseSidecar('ID,x\n"A,1\n'), /unterminated quote/);
});

test('short rows are padded, blank lines skipped', () => {
  const t = parseSidecar('ID\ta\tb\n\nA\t1\n\nB\t2\t3\n');
  assert.deepEqual(
    t.rows.map((r) => r.cells),
    [
      ['1', ''],
      ['2', '3'],
    ],
  );
});
