import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseNexus } from '@gbif-phylo/io';

const TAXA = (title = '', labels = 'A B C') =>
  `BEGIN TAXA;${title ? ` TITLE ${title};` : ''} DIMENSIONS NTAX=${(labels.match(/'[^']*'|\S+/g) ?? []).length}; TAXLABELS ${labels}; END;\n`;
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

test('taxon numbers: TRANSLATE token first, then taxon label, then position in the linked TAXA block', () => {
  // numbers with no TRANSLATE are positions in the TAXA block, and the note says so
  const r = parseNexus('#NEXUS\n' + TAXA() + TREES('', '(1,2,3)'));
  assert.deepEqual(r.tree.tipLabels, ['A', 'B', 'C']);
  assert.deepEqual(
    r.ignored.map((n) => n.code),
    ['nexus-taxon-numbers'],
  );
  assert.match(r.ignored[0].message, /3 tips were taxon numbers/);
  // a TRANSLATE token wins over the position
  const withTable = '#NEXUS\n' + TAXA() + 'BEGIN TREES; TRANSLATE 1 C, 2 B, 3 A; TREE t = (1,2,3); END;';
  assert.deepEqual(parseNexus(withTable).tree.tipLabels, ['C', 'B', 'A']);
  assert.deepEqual(codes(withTable), []);
  // a taxon label wins over the position: the taxon called "2" stays "2", the number 3 is the third taxon
  assert.deepEqual(parseNexus('#NEXUS\n' + TAXA('', '2 A B') + TREES('', '(2,3,A)')).tree.tipLabels, ['2', 'B', 'A']);
  // out of range, or no TAXA block: left alone
  assert.deepEqual(parseNexus('#NEXUS\n' + TAXA() + TREES('', '(1,2,7)')).tree.tipLabels, ['A', 'B', '7']);
  assert.deepEqual(parseNexus('#NEXUS\nbegin trees; tree t = (1,2); end;').tree.tipLabels, ['1', '2']);
});

test('taxon numbers use the TAXA block the TREES block links to', () => {
  const two = '#NEXUS\n' + TAXA('one', 'A B C') + TAXA('two', 'X Y Z') + TREES('two', '(1,2,3)');
  assert.deepEqual(parseNexus(two).tree.tipLabels, ['X', 'Y', 'Z']);
  assert.deepEqual(parseNexus('#NEXUS\n' + TAXA('one', 'A B C') + TAXA('two', 'X Y Z') + TREES('', '(1,2,3)')).tree.tipLabels, ['X', 'Y', 'Z']);
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

test('NTAX that disagrees with the taxa listed is reported, and the file is read', () => {
  const r = parseNexus('#NEXUS\nbegin taxa; dimensions ntax=2; taxlabels A B C; end;\n' + TREES());
  assert.deepEqual(r.tree.tipLabels, ['A', 'B', 'C']);
  assert.deepEqual(
    r.ignored.map((n) => n.code),
    ['nexus-ntax-mismatch'],
  );
  assert.match(r.ignored[0].message, /NTAX=2 but lists 3/);
});
