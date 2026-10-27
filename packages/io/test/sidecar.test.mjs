import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNewick, parseNexus, parseSidecar, SidecarError } from '@canopy/io';

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

test('a blank first line does not change how quotes are read (the delimiter comes from the first line with content)', () => {
  for (const lead of ['\n', '\r\n', '﻿\r\n', '\n\n']) {
    const sc = parseSidecar(`${lead}ID\tnote\na\t"line1\nline2"\nb\tx\n`);
    assert.deepEqual([sc.rowCount, sc.cell(0, 1), sc.cell(1, 1)], [2, 'line1\nline2', 'x']);
  }
  const sc = parseSidecar('\nID\tnote\na\tx,"y\nb\tz\n');
  assert.deepEqual([sc.rowCount, sc.cell(0, 1), sc.cell(1, 1)], [2, 'x,"y', 'z']);
});

test('numbers: kept when the double says what the cell says, else text', () => {
  const tree = parseNewick('(A,B,C,D,E,F);');
  const cells = ['9007199254740993.0', '12345678901234567890.5', '-0', '1e3', '+5', '3.14159'];
  const b = parseSidecar(
    'ID,x\n' +
      'ABCDEF'
        .split('')
        .map((l, i) => `${l},${cells[i]}`)
        .join('\n'),
  ).bind(tree);
  assert.deepEqual(
    'ABCDEF'.split('').map((l) => b.get(tree.tipIndex(l), 'x')),
    ['9007199254740993.0', '12345678901234567890.5', '-0', 1000, 5, 3.14159],
  );
});

// A seeded generator of tricky tables, written the way RFC 4180 says (quoted when a cell needs it, sometimes when it does not): the
// line scanner and the field splitter must agree on every row and field, whatever the delimiter, line ends and leading blank lines.
test('round trip: random tables with quotes, delimiters, newlines and CRs read back exactly', () => {
  let seed = 12345;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
  const pieces = ['', 'a', 'x y', ' x ', '"', '""', ',', '\t', '\n', '\r\n', '\r', 'x"y', '12"', '"q', 'é'];
  for (let n = 0; n < 400; n++) {
    const sep = rnd(2) ? '\t' : ',';
    const cols = 1 + rnd(3);
    const eol = rnd(2) ? '\n' : '\r\n';
    const write = (c) => (/[",\t\n\r]/.test(c) || rnd(4) === 0 || /^\s|\s$/.test(c) ? `"${c.replaceAll('"', '""')}"` : c);
    const rows = Array.from({ length: 1 + rnd(5) }, (_, r) => [
      `r${r}`,
      ...Array.from({ length: cols }, () => Array.from({ length: rnd(4) }, () => pieces[rnd(pieces.length)]).join('')),
    ]);
    const head = ['ID', ...Array.from({ length: cols }, (_, c) => `c${c}`)];
    const text = (rnd(3) === 0 ? eol : '') + [head, ...rows].map((r) => r.map(write).join(sep)).join(eol) + (rnd(2) ? eol : '');
    let sc;
    try {
      sc = parseSidecar(text);
    } catch (e) {
      assert.fail(`${JSON.stringify(text)}: ${e.message}`);
    }
    assert.equal(sc.rowCount, rows.length, JSON.stringify(text));
    rows.forEach((r, i) => {
      assert.deepEqual(
        sc.row(i),
        r.map((c) => c.trim()),
        JSON.stringify(text),
      );
      r.forEach((c, k) => assert.equal(sc.cell(i, k), c.trim(), JSON.stringify(text)));
    });
  }
});
