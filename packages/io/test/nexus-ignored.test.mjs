import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseNexus } from '@gbif-phylo/io';

const TAXA = (title = '', labels = 'A B C') => `BEGIN TAXA;${title ? ` TITLE ${title};` : ''} DIMENSIONS NTAX=3; TAXLABELS ${labels}; END;\n`;
const TREES = (link = '', tree = '(A,B,C)') => `BEGIN TREES;${link ? ` LINK TAXA=${link};` : ''} TREE t = ${tree};\nEND;\n`;
const codes = (nex) => parseNexus(nex).ignored.map((n) => n.code);

test('a file with the taxa and the one tree reports nothing', () => {
  assert.deepEqual(parseNexus('#NEXUS\n' + TAXA() + TREES()).ignored, []);
});

test('a block we do not read is named, with its position', () => {
  const nex = '#NEXUS\n' + TAXA() + TREES() + "BEGIN MRBAYES;\n  lset nst=6;\n  report 'x';\nEND;\n";
  const r = parseNexus(nex);
  assert.deepEqual(
    r.ignored.map((n) => [n.code, n.block, n.position]),
    [['nexus-ignored-block', 'mrbayes', nex.indexOf('BEGIN MRBAYES')]],
  );
  assert.match(r.ignored[0].message, /MRBAYES block \(2 statements\)/);
});

test('the real FigTree block of the HCV file is reported', () => {
  const f = fileURLToPath(new URL('../../../data/rich/hcv-2k-iqtree-alignment/2k1b_2k_ext_IQTree_midpoint.tre', import.meta.url));
  const r = parseNexus(readFileSync(f, 'utf8'));
  assert.deepEqual(
    r.ignored.map((n) => [n.code, n.block]),
    [['nexus-ignored-block', 'figtree']],
  );
});

test('other trees of the file are counted', () => {
  const nex = '#NEXUS\n' + TAXA() + 'BEGIN TREES; TREE a = (A,B,C); TREE b = (A,(B,C)); TREE c = ((A,B),C); END;';
  const r = parseNexus(nex, 1);
  assert.equal(r.treeCount, 3);
  assert.equal(r.treesSeen, 2);
  assert.deepEqual(
    r.ignored.map((n) => n.code),
    ['nexus-other-trees'],
  );
  assert.match(r.ignored[0].message, /3 trees; only tree 2 \(b\)/);
});

test('two TAXA blocks and no LINK: the last one before the trees is assumed, the other is reported unused', () => {
  const nex = '#NEXUS\n' + TAXA('first', 'X Y Z') + TAXA('second') + TREES();
  assert.deepEqual(codes(nex), ['nexus-taxa-unused', 'nexus-taxa-ambiguous']);
  const r = parseNexus(nex);
  assert.match(r.ignored[0].message, /"first"/);
});

test('LINK picks the TAXA block by title; the other is unused', () => {
  const nex = '#NEXUS\n' + TAXA('one') + TAXA('two', 'X Y Z') + TREES('one');
  const r = parseNexus(nex);
  assert.deepEqual(
    r.ignored.map((n) => n.code),
    ['nexus-taxa-unused'],
  );
  assert.match(r.ignored[0].message, /"two"/);
});

test('LINK to a title that does not exist', () => {
  assert.deepEqual(codes('#NEXUS\n' + TAXA('one') + TREES('nope')), ['nexus-taxa-unused', 'nexus-taxa-link-unresolved']);
});

test('tips that are not in the TAXA block, and taxa that have no tip', () => {
  const r = parseNexus('#NEXUS\n' + TAXA('', 'A B C D') + TREES('', '(A,B,Q)'));
  assert.deepEqual(
    r.ignored.map((n) => n.code),
    ['nexus-taxa-mismatch'],
  );
  assert.match(r.ignored[0].message, /1 tips that are not in the TAXA block \(Q\).*2 taxa with no tip \(C, D\)/);
});

test('numeric tips with no TRANSLATE are reported, with TRANSLATE they are not', () => {
  assert.deepEqual(codes('#NEXUS\n' + TAXA() + TREES('', '(1,2,3)')), ['nexus-numeric-tips']);
  const withTable = '#NEXUS\n' + TAXA() + 'BEGIN TREES; TRANSLATE 1 A, 2 B, 3 C; TREE t = (1,2,3); END;';
  assert.deepEqual(codes(withTable), []);
});

const DATA = (rows, ntax = 3) => `BEGIN DATA;\n DIMENSIONS NTAX=${ntax} NCHAR=4;\n FORMAT DATATYPE=DNA;\n MATRIX\n${rows}\n ;\nEND;\n`;

test('sequences whose rows match every tip are ignored but named', () => {
  const r = parseNexus('#NEXUS\n' + TAXA() + DATA('A ACGT\n B ACGT\n C ACGT') + TREES());
  assert.deepEqual(
    r.ignored.map((n) => [n.code, n.block]),
    [['nexus-sequences-ignored', 'data']],
  );
  assert.match(r.ignored[0].message, /3 sequences, 4 characters.*every row matches a tip/);
});

test('sequences that do not line up with the tips are reported with the difference', () => {
  const r = parseNexus('#NEXUS\n' + TAXA() + DATA("A ACGT\n 'B b' ACGT\n Z ACGT") + TREES());
  assert.deepEqual(
    r.ignored.map((n) => n.code),
    ['nexus-sequences-unlinked'],
  );
  assert.match(r.ignored[0].message, /1 rows match a tip.*2 rows match none \(B b, Z\).*2 tips have no row \(B, C\)/);
});

test('a CHARACTERS block with wrapped sequence lines is not compared row by row', () => {
  const r = parseNexus('#NEXUS\n' + TAXA() + DATA('A ACGT\n ACGT\n ACGT\n B ACGT', 2) + TREES());
  assert.deepEqual(
    r.ignored.map((n) => n.code),
    ['nexus-sequences-unlinked'],
  );
  assert.match(r.ignored[0].message, /could not be told apart/);
});

test('a stray quote in a block after the tree stops the scan but keeps the tree', () => {
  const r = parseNexus('#NEXUS\n' + TAXA() + TREES() + "BEGIN NOTES;\n TEXT 'unfinished;\nEND;\n");
  assert.equal(r.tree.tipCount, 3);
  assert.deepEqual(
    r.ignored.map((n) => n.code),
    ['nexus-ignored-block', 'nexus-scan-stopped'],
  );
});

test('strict mode does not throw for ignored parts', () => {
  assert.doesNotThrow(() => parseNexus('#NEXUS\n' + TAXA() + TREES() + 'BEGIN SETS; END;', { strict: true }));
});

test('line endings: CRLF and old Mac CR-only files read their sequence rows the same way', () => {
  const nex = '#NEXUS\n' + TAXA() + DATA('A ACGT\n B ACGT\n C ACGT') + TREES();
  for (const eol of ['\r\n', '\r']) {
    assert.deepEqual(
      parseNexus(nex.replace(/\n/g, eol)).ignored.map((n) => n.code),
      ['nexus-sequences-ignored'],
    );
  }
});

test("an unquoted '_' reads as a space when rows, taxa and tips are compared", () => {
  // from Biopython's Tests/Nexus/test_Nexus_input.nex: one taxon spelled both ways in an interleaved matrix
  const rows = "'B b' ACGT\n A ACGT\n C ACGT\n\n B_b ACGT\n A ACGT\n C ACGT";
  const r = parseNexus('#NEXUS\n' + TAXA('', "A 'B b' C") + DATA(rows) + TREES('', '(A,B_b,C)'));
  assert.deepEqual(
    r.ignored.map((n) => n.code),
    ['nexus-sequences-ignored'],
  );
  assert.match(r.ignored[0].message, /3 sequences/);
});
