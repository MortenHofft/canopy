import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNewick, parseNexus, parseSidecar, SidecarError } from '@gbif-phylo/io';

const NEWICK = '((A:1,B:1)Clade1:1,(C:1,D:1):1);';

test('TSV: columns, numbers and strings, read lazily', () => {
  const sc = parseSidecar('ID\tcountry\tyear\nA\tDenmark\t2019\nB\tKenya\t007\n');
  assert.equal(sc.delimiter, 'tab');
  assert.deepEqual(sc.columns, ['country', 'year']);
  assert.equal(sc.rowCount, 2);
  const tree = parseNewick(NEWICK);
  const b = sc.bind(tree);
  assert.equal(b.report.matchedRows, 2);
  assert.equal(b.get(tree.tipIndex('A'), 'country'), 'Denmark');
  assert.equal(b.get(tree.tipIndex('A'), 'year'), 2019);
  assert.equal(b.get(tree.tipIndex('B'), 'year'), '007'); // leading zeros stay a string
  assert.equal(b.get(tree.tipIndex('C'), 'year'), undefined);
  assert.equal(b.get(tree.tipIndex('A'), 'nope'), undefined);
  assert.equal(tree.annotations, null, 'the tree is not touched');
});

test('CSV with quotes, embedded commas, newlines and escaped quotes, BOM and CRLF', () => {
  const sc = parseSidecar('﻿id,note,country\r\n"A","a, with\nnewline","Den ""mark"""\r\nB,,Kenya\r\n');
  assert.equal(sc.delimiter, 'comma');
  assert.equal(sc.rowCount, 2);
  assert.deepEqual(sc.row(0), ['A', 'a, with\nnewline', 'Den "mark"']);
  const tree = parseNewick(NEWICK);
  const b = sc.bind(tree);
  assert.equal(b.get(tree.tipIndex('B'), 'note'), undefined); // empty cell
  assert.equal(b.get(tree.tipIndex('B'), 'country'), 'Kenya');
  assert.deepEqual({ ...b.record(tree.tipIndex('A')) }, { note: 'a, with\nnewline', country: 'Den "mark"' });
});

test('report: unmatched IDs, tips without a row, duplicate IDs', () => {
  const tree = parseNewick(NEWICK);
  const b = parseSidecar('ID\tx\nA\t1\nA\t2\nZ\t3\n').bind(tree);
  assert.deepEqual(b.report.unmatchedIds, ['Z']);
  assert.deepEqual(b.report.tipsWithoutRow, ['B', 'C', 'D']);
  assert.deepEqual(b.report.duplicateIds, ['A']);
  assert.equal(b.get(tree.tipIndex('A'), 'x'), 2); // later row wins
});

test('an ID can name an internal node; a duplicate tip label gets the row on every tip', () => {
  const tree = parseNewick('((A,A)Clade1,B);');
  const b = parseSidecar('ID,group\nClade1,north\nA,x\n').bind(tree);
  assert.equal(b.report.unmatchedIds.length, 0);
  assert.equal(b.get(1, 'group'), 'north'); // node 1 is Clade1
  assert.deepEqual(
    tree.tipIndices('A').map((k) => b.get(k, 'group')),
    ['x', 'x'],
  );
});

test('categories: codes by node, most frequent first, tips counted', () => {
  const tree = parseNewick('((A,B)Clade1,(C,D));');
  const b = parseSidecar('ID,c\nA,KE\nB,DK\nC,DK\nClade1,KE\n').bind(tree);
  const cat = b.categories('c');
  assert.deepEqual(cat.values, ['DK', 'KE']); // DK on 2 tips, KE on 1 (the internal row is not counted)
  assert.deepEqual(cat.counts, [2, 1]);
  const code = (l) => cat.codes[tree.tipIndex(l)];
  assert.deepEqual([code('A'), code('B'), code('C'), code('D')], [1, 0, 0, -1]);
  assert.equal(cat.codes[1], 1); // Clade1
  assert.throws(() => b.categories('nope'), SidecarError);
});

test('works on a NEXUS tree after TRANSLATE, and a new tree is a new bind', () => {
  const { tree } = parseNexus('#NEXUS\nbegin trees;\ntranslate 1 Alpha, 2 Beta;\ntree t = (1,2);\nend;\n');
  const sc = parseSidecar('ID\tcountry\nAlpha\tPeru\n');
  const b = sc.bind(tree);
  assert.deepEqual(b.report.tipsWithoutRow, ['Beta']);
  assert.equal(b.get(tree.tipIndex('Alpha'), 'country'), 'Peru');
  const other = parseNewick('(Beta,Alpha);'); // node numbers differ
  assert.equal(sc.bind(other).get(other.tipIndex('Alpha'), 'country'), 'Peru');
});

test('errors', () => {
  assert.throws(() => parseSidecar(''), SidecarError);
  assert.throws(() => parseSidecar('\n\n'), SidecarError);
  assert.throws(() => parseSidecar('name\tcountry\nA\tx\n'), /must be named ID/);
  assert.throws(() => parseSidecar('ID,x\n"A,1\n').cell(0, 1), /unterminated quote/);
});

test('short rows read as empty cells, blank lines are skipped, a last line without a newline counts', () => {
  const sc = parseSidecar('ID\ta\tb\n\nA\t1\n\nB\t2\t3');
  assert.equal(sc.rowCount, 2);
  assert.deepEqual([sc.cell(0, 1), sc.cell(0, 2), sc.cell(1, 2)], ['1', '', '3']);
});

test('long cells stay cheap: 20,000 rows of 2 kB parse and bind well under a second', () => {
  const seq = 'ACGT'.repeat(512);
  let t = 'ID\tcountry\tseq\n';
  for (let i = 0; i < 20000; i++) t += `t${i}\t${i % 3 ? 'DK' : 'SE'}\t${seq}\n`;
  const start = performance.now();
  const sc = parseSidecar(t);
  const tree = parseNewick('(' + Array.from({ length: 20000 }, (_, i) => `t${i}`).join(',') + ');');
  const b = sc.bind(tree);
  const cat = b.categories('country');
  assert.ok(performance.now() - start < 2000, `took ${performance.now() - start} ms`);
  assert.deepEqual(cat.values, ['DK', 'SE']);
  assert.equal(b.get(tree.tipIndex('t7'), 'seq').length, 2048);
});

test('a quote inside a bare field is text and does not join rows (inches, a stray quote)', () => {
  const sc = parseSidecar('ID,size\nA,12" screen\nB,5\nC,7\nD,9\n');
  assert.equal(sc.rowCount, 4);
  assert.equal(sc.cell(0, 1), '12" screen');
  assert.equal(sc.cell(3, 1), '9');
});

test('an unterminated quote at the start of a field throws when the table is read', () => {
  assert.throws(() => parseSidecar('ID,x\nA,"oops\nB,1\n'), /unterminated quote/);
});

test('rows without the delimiter are not quadratic', () => {
  const N = 100000;
  const sc = parseSidecar('ID\tcountry\n' + Array.from({ length: N }, (_, i) => `s${i}`).join('\n'));
  const tree = parseNewick('(' + Array.from({ length: N }, (_, i) => `s${i}`).join(',') + ');');
  const start = performance.now();
  const b = sc.bind(tree);
  b.categories('country');
  assert.ok(performance.now() - start < 1500, `took ${performance.now() - start} ms`);
  assert.equal(b.report.matchedRows, N);
});

test('categories leaves out values no tip has; an empty ID matches nothing', () => {
  const tree = parseNewick('(A,B,C,D);');
  const cat = parseSidecar('ID,c\nA,KE\nZ,US\nY,FR\n').bind(tree).categories('c');
  assert.deepEqual(cat.values, ['KE']);
  assert.deepEqual(cat.counts, [1]);
  assert.deepEqual([...cat.codes], [-1, 0, -1, -1, -1]);
  const un = parseNewick('((A,),(,D));');
  const b = parseSidecar('ID,x\n,zz\n').bind(un);
  assert.equal(b.report.matchedRows, 0);
  assert.deepEqual(b.report.unmatchedIds, ['']);
});

test('cells: a long accession stays text, NaN and Infinity are text, duplicate column names read the first', () => {
  const tree = parseNewick('(A,B);');
  const b = parseSidecar('ID,x,x\nA,12345678901234567890,2\nB,NaN,Infinity\n').bind(tree);
  assert.equal(b.get(tree.tipIndex('A'), 'x'), '12345678901234567890');
  assert.equal(b.get(tree.tipIndex('B'), 'x'), 'NaN');
  assert.equal(b.record(tree.tipIndex('A')).x, '12345678901234567890'); // the first column of that name, as get
});
