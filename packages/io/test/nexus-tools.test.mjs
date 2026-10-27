// NEXUS as the programs write it. The MrBayes and BEAST 2 files below are written by hand in the format of their output
// (not real output, not checked against a real run); the real files come from data/rich and test/fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseNexus, toNewick } from '../src/newick.ts';
import { supportFrom } from '../src/annotations.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, '../../../data');
const readFile = (f) => {
  const b = fs.readFileSync(f);
  return (f.endsWith('.gz') ? zlib.gunzipSync(b) : b).toString('utf8');
};
const eol = (s, e) => s.replace(/\r?\n/g, e);

const MRBAYES_CON = `#NEXUS
[ID: 9409050143]
begin taxa;
	dimensions ntax=4;
	taxlabels
		A
		B
		C
		D
		;
end;
begin trees;
	translate
		1 A,
		2 B,
		3 C,
		4 D;
	tree con_50_majrule = [&U] ((1[&prob=1.00000000e+00,prob_stddev=0.00000000e+00,prob_range={1.00000000e+00,1.00000000e+00},prob(percent)="100",prob+-sd="100+-0"]:2.5e-02[&length_mean=2.5e-02,length_median=2.4e-02,length_95%HPD={1.1e-02,4.0e-02}],2[&prob=1.0]:1.0E-2[&length_mean=1.0e-02])[&prob=9.9e-01,prob(percent)="99"]:3.0e-02[&length_mean=3.0e-02],3[&prob=1.0]:4.0e-02[&length_mean=4.0e-02],4[&prob=1.0]:5.0e-02[&length_mean=5.0e-02]);
end;
`;

const MRBAYES_T = `#NEXUS
[ID: 1234567890]
begin trees;
	translate
		1 Alpha,
		2 Beta,
		3 'Gamma delta';
tree rep.1000 = [&U] (1:0.1,2:0.2,3:0.3);
tree rep.2000 = [&U] (1:0.11,(2:0.21,3:0.31):0.01);
end;
`;

const BEAST1 = `#NEXUS
Begin taxa;
	Dimensions ntax=3;
	Taxlabels
		'Hu/1/2009'
		'Hu/2/2010'
		'Sw/3/2011'
		;
End;
Begin trees;
	Translate
		1 'Hu/1/2009',
		2 'Hu/2/2010',
		3 'Sw/3/2011'
		;
tree TREE1 = [&R] ((1[&rate=1.1,height=0.0]:[&rate=1.1]2.5,2[&rate=0.9]:[&rate=0.9]1.5)[&height=2.5,height_95%_HPD={1.9,3.1},height_median=2.4,height_range={1.8,3.2},posterior=0.98,rate=1.0,rate_95%_HPD={0.8,1.2}]:[&rate=1.0]1.0,3[&rate=1.0]:[&rate=1.0]3.5)[&height=3.5,posterior=1.0];
End;
`;

const BEAST2 = `#NEXUS
Begin taxa;
	Dimensions ntax=3;
	Taxlabels
		a
		b
		c
	;
End;
Begin trees;
	Translate
		1 a,
		2 b,
		3 c
	;
tree STATE_0 = [&R] (1[&height=0.0]:1.0,(2:0.5,3:0.5):0.5)[&lnP=-123.4]:0.0;
tree STATE_1000 [&lnP=-100.1] = [&R] ((1:1.0,2:1.0):0.5,3:1.5);
End;
`;

for (const [name, e] of [
  ['LF', '\n'],
  ['CRLF', '\r\n'],
  ['CR', '\r'],
]) {
  test(`MrBayes .con.tre (${name}): labels, scientific lengths, node and edge annotations`, () => {
    const r = parseNexus(eol(MRBAYES_CON, e), { annotations: true });
    const t = r.tree;
    assert.equal(r.treeName, 'con_50_majrule');
    assert.deepEqual(t.tipLabels, ['A', 'B', 'C', 'D']);
    assert.deepEqual(
      [...t.tipNode].map((n) => t.length[n]),
      [0.025, 0.01, 0.04, 0.05],
    );
    const a = t.annotations;
    const [A, B, , D] = t.tipNode;
    assert.equal(a.get(A, 'prob'), 1);
    assert.deepEqual(a.get(A, 'prob_range'), [1, 1]);
    assert.equal(a.get(A, 'prob(percent)'), '100');
    assert.equal(a.get(A, 'prob+-sd'), '100+-0');
    assert.deepEqual(a.get(A, 'length_95%HPD', 'edge'), [0.011, 0.04]);
    assert.equal(a.get(B, 'length_mean', 'edge'), 0.01);
    assert.equal(a.get(D, 'prob'), 1);
    const ab = t.mrca(A, B);
    assert.equal(a.get(ab, 'prob'), 0.99);
    assert.equal(a.get(ab, 'prob(percent)'), '99');
    assert.equal(t.length[ab], 0.03);
  });

  test(`MrBayes .t (${name}): TRANSLATE, a quoted name with a space, the second tree`, () => {
    const first = parseNexus(eol(MRBAYES_T, e));
    assert.equal(first.treeName, 'rep.1000');
    assert.deepEqual(first.tree.tipLabels, ['Alpha', 'Beta', 'Gamma delta']);
    assert.equal(first.translateEntries, 3);
    const second = parseNexus(eol(MRBAYES_T, e), 1);
    assert.equal(second.treeName, 'rep.2000');
    assert.equal(toNewick(second.tree), "(Alpha:0.11,(Beta:0.21,'Gamma delta':0.31):0.01);");
    assert.throws(() => parseNexus(eol(MRBAYES_T, e), 2), /no tree number 2/);
  });

  test(`BEAST 1 MCC (${name}): rate on the edge before the length, HPD arrays, quoted labels with '/'`, () => {
    const t = parseNexus(eol(BEAST1, e), { annotations: true }).tree;
    assert.deepEqual(t.tipLabels, ['Hu/1/2009', 'Hu/2/2010', 'Sw/3/2011']);
    assert.deepEqual(
      [...t.tipNode].map((n) => t.length[n]),
      [2.5, 1.5, 3.5],
    );
    const a = t.annotations;
    assert.equal(a.get(t.tipNode[0], 'rate', 'edge'), 1.1);
    assert.equal(a.get(t.tipNode[0], 'rate'), 1.1);
    const ab = t.mrca(t.tipNode[0], t.tipNode[1]);
    assert.deepEqual(a.get(ab, 'height_95%_HPD'), [1.9, 3.1]);
    assert.deepEqual(a.get(ab, 'height_range'), [1.8, 3.2]);
    assert.equal(supportFrom(t, 'posterior')[ab], 0.98);
    assert.equal(a.get(0, 'height'), 3.5);
  });
}

test('BEAST 2: a [&...] comment between the tree name and "=", a root edge, the next tree', () => {
  const a = parseNexus(BEAST2, { annotations: true });
  assert.equal(a.treeName, 'STATE_0');
  assert.deepEqual(a.tree.tipLabels, ['a', 'b', 'c']);
  assert.equal(a.tree.length[0], 0);
  assert.equal(a.tree.annotations.get(0, 'lnP'), -123.4);
  const b = parseNexus(BEAST2, { annotations: true, treeIndex: 1 });
  assert.equal(b.treeName, 'STATE_1000');
  assert.deepEqual(b.tree.tipLabels, ['a', 'b', 'c']);
  assert.equal(toNewick(b.tree), '((a:1,b:1):0.5,c:1.5);');
});

test('the same tree comes out with and without annotations, for every tool shape', () => {
  for (const src of [MRBAYES_CON, MRBAYES_T, BEAST1, BEAST2]) {
    assert.equal(toNewick(parseNexus(src).tree), toNewick(parseNexus(src, { annotations: true }).tree));
  }
});

test('tree weights, the default-tree star and UTREE', () => {
  const w = parseNexus("#NEXUS\nbegin trees;\n tree 'my tree' = [&R] [&W 0.5] (A:1,B:1);\nend;");
  assert.equal(w.treeName, 'my tree');
  assert.deepEqual(w.tree.tipLabels, ['A', 'B']);
  const s = parseNexus('#nexus\nBEGIN TREES;\n TREE * best = [&U] (A,B,(C,D));\n UTREE u2 = (A,B,C);\nENDBLOCK;', 1);
  assert.equal(s.treeName, 'u2');
  assert.deepEqual(s.tree.tipLabels, ['A', 'B', 'C']);
  assert.equal(parseNexus('#nexus\nBEGIN TREES;\n TREE * best = (A,B,(C,D));\nEND;').treeName, 'best');
});

test('an apostrophe inside a comment, and a block we do not read, do not disturb the tree', () => {
  const r = parseNexus("#NEXUS\nbegin mrbayes;\n [don't panic: lset nst=6;]\n mcmc ngen=1000;\nend;\nbegin trees; tree t = (A,B); end;");
  assert.deepEqual(r.tree.tipLabels, ['A', 'B']);
});

test('real-world oddities (Biopython test_Nexus_input.nex): interleaved DATA, SETS, a private block, nested comments, three trees', () => {
  const text = readFile(path.join(HERE, 'fixtures/biopython-test_Nexus_input.nex'));
  const r = parseNexus(text);
  assert.equal(r.tree.tipCount, 9);
  assert.equal(r.treeName, 'tree1');
  for (const i of [1, 2]) assert.equal(parseNexus(text, i).tree.tipCount, 9);
  assert.throws(() => parseNexus(text, 3), /no tree number 3/);
});

// Every NEXUS tree in data/rich, checked against the numbers of data/rich/scripts/treecheck.py (an independent
// implementation, in Python, with its own parser).
const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'rich/manifest.json'), 'utf8')).datasets;
for (const d of manifest.filter((x) => x.format_detected === 'nexus')) {
  test(`data/rich/${d.id}: tips, nodes, root, branch lengths and tree count agree with treecheck.py`, () => {
    const text = readFile(path.join(DATA, 'rich', d.main_tree));
    const t = parseNexus(text).tree;
    assert.equal(t.tipCount, d.tips);
    assert.equal(t.nodeCount, d.tips + d.internal_nodes);
    assert.equal(t.children(0).length, d.root_children);
    const bl = d.branch_lengths;
    const lens = [];
    for (let i = 1; i < t.nodeCount; i++) if (!Number.isNaN(t.length[i])) lens.push(t.length[i]);
    assert.equal(lens.length, bl.n_with);
    assert.equal(t.nodeCount - 1 - lens.length, bl.n_missing);
    assert.equal(lens.filter((v) => v < 0).length, bl.n_negative);
    assert.equal(lens.filter((v) => v === 0).length, bl.n_zero);
    assert.ok(Math.abs(Math.min(...lens) - bl.min) <= 1e-9 * Math.max(1, Math.abs(bl.min)));
    assert.ok(Math.abs(Math.max(...lens) - bl.max) <= 1e-9 * Math.max(1, Math.abs(bl.max)));
    // the last tree of the file is there, the one after it is not
    const n = d.trees_in_main_file;
    assert.equal(parseNexus(text, n - 1).tree.tipCount > 0, true);
    assert.throws(() => parseNexus(text, n), /no tree number/);
  });
}

test('a TRANSLATE table belongs to its own TREES block', () => {
  const nex =
    '#NEXUS\nbegin trees; translate 1 A, 2 B; tree a=(1,2); end;\nbegin trees; tree b=(1,2); end;\nbegin trees; translate 1 X, 2 Y; tree c=(1,2); end;';
  assert.deepEqual(parseNexus(nex, 0).tree.tipLabels, ['A', 'B']);
  assert.deepEqual(parseNexus(nex, 1).tree.tipLabels, ['1', '2']);
  assert.deepEqual(parseNexus(nex, 2).tree.tipLabels, ['X', 'Y']);
});

test('no header: parsed, with the warning; strict throws', () => {
  const nex = 'begin trees; tree t=(A,B,C); end;';
  assert.deepEqual(
    parseNexus(nex).tree.warnings.map((w) => w.code),
    ['missing-nexus-header'],
  );
  assert.throws(() => parseNexus(nex, { strict: true }), /missing-nexus-header/);
});

test('a byte order mark, keywords in any case, spaces before ";", an END that is missing', () => {
  assert.deepEqual(parseNexus('﻿#NEXUS\nbegin trees; tree t=(A,B); end;').tree.tipLabels, ['A', 'B']);
  assert.equal(parseNexus('#NEXUS\nBeGiN TrEeS ;\nTrEe T = (A,B,C);\nEnD ;').treeName, 'T');
  assert.deepEqual(parseNexus('#NEXUS\nbegin trees; tree t=(A,B,C);').tree.tipLabels, ['A', 'B', 'C']);
  assert.deepEqual(parseNexus('#NEXUS\nbegin trees; tree t=(Müller_1,Çelik_2); end;').tree.tipLabels, ['Müller_1', 'Çelik_2']);
});

test('a file with no tree says what it holds', () => {
  const cases = [
    ['#NEXUS\nbegin taxa; dimensions ntax=2; taxlabels A B; end;', /no tree number 0.*blocks: taxa/],
    ['#NEXUS\nbegin trees; translate 1 A, 2 B; end;', /saw 0; blocks: trees/],
    ['#NEXUS\ntree t=(A,B,C);', /blocks: none/],
    ['', /no tree number 0/],
  ];
  for (const [nex, re] of cases) assert.throws(() => parseNexus(nex), re);
});

test('malformed input throws a NewickError with a position, whatever the mode', () => {
  const bad = [
    ['#NEXUS\nbegin trees; tree t (A,B,C); end;', /without "="/],
    ['#NEXUS\nbegin trees; tree t=(A,B; end;', /unbalanced/],
    ['#NEXUS\n[unclosed\nbegin trees; tree t=(A,B,C); end;', /unterminated \[comment\]/],
    ["#NEXUS\nbegin trees; tree t=(A,'B,C); end;", /unterminated quote/],
  ];
  for (const [nex, re] of bad) {
    for (const strict of [false, true]) {
      assert.throws(
        () => parseNexus(nex, { strict }),
        (e) => e.name === 'NewickError' && re.test(e.message) && typeof e.position === 'number',
      );
    }
  }
});

test("brackets inside a 'quoted' name are part of the name, in TRANSLATE and TAXLABELS and in the tree", () => {
  // idea from Biopython Tests/Nexus/test_Nexus_input.nex: a taxon called isn'that [a] strange name?
  const nex = `#NEXUS
begin taxa; dimensions ntax=3; taxlabels 'isn''that [a] strange name?' 'x]y' z; end;
begin trees; translate 1 'isn''that [a] strange name?', 2 'x]y', 3 z; tree t = [&R] (1,2,3); end;`;
  assert.deepEqual(parseNexus(nex).tree.tipLabels, ["isn'that [a] strange name?", 'x]y', 'z']);
  assert.deepEqual(parseNexus(nex).ignored, []); // the TAXA block lists the same names
  assert.deepEqual(parseNexus("#NEXUS\nbegin trees; tree t = ('a [b] c',d);end;").tree.tipLabels, ['a [b] c', 'd']);
  assert.deepEqual(parseNexus("#NEXUS\nbegin trees; tree t = (a[comment 'with' quotes],d);end;").tree.tipLabels, ['a', 'd']);
});

test("a quoted tree name may hold '=' and parentheses", () => {
  assert.equal(parseNexus("#NEXUS\nbegin trees; tree 'a=b (c)' = [&R] (x,y,z); end;").treeName, 'a=b (c)');
  assert.equal(parseNexus("#NEXUS\nbegin trees; tree 'it''s=1' = (x,y,z); end;").treeName, "it's=1");
  assert.deepEqual(parseNexus("#NEXUS\nbegin trees; tree 'a=b' = (x,y,z); end;").tree.tipLabels, ['x', 'y', 'z']);
});

test('a tree with no ";" before END, or at the end of the file, is read with a warning (strict throws); END is not a label', () => {
  for (const nex of [
    '#NEXUS\nbegin trees;\n tree t = (A,B,C)\nend;',
    '#NEXUS\nbegin trees;\n tree t = (A,B,C)\nendblock;',
    '#NEXUS\nbegin trees; tree t = (A,B,C)',
  ]) {
    const r = parseNexus(nex);
    assert.deepEqual(r.tree.tipLabels, ['A', 'B', 'C']);
    assert.equal(r.tree.labels[0], '');
    assert.deepEqual(
      r.tree.warnings.map((w) => w.code),
      ['missing-trailing-semicolon'],
    );
    assert.throws(() => parseNexus(nex, { strict: true }), /missing-trailing-semicolon/);
  }
  assert.deepEqual(parseNexus('#NEXUS\nbegin trees; tree t = (A,B,C); end;').tree.warnings, []);
  assert.deepEqual(parseNexus('#NEXUS\nbegin trees; tree t = (A,B)end; end;').tree.labels[0], 'end'); // a root called "end"
});

// found by the review of this change
test('a TRANSLATE table without commas is read as token and value pairs', () => {
  const nex = `#NEXUS
begin taxa; dimensions ntax=4; taxlabels Delta Gamma Beta Alpha; end;
begin trees;
 translate
  1 Alpha
  2 Beta
  3 Gamma
  4 Delta;
 tree t = ((1,2),(3,4));
end;`;
  const r = parseNexus(nex);
  assert.equal(toNewick(r.tree), '((Alpha,Beta),(Gamma,Delta));');
  assert.equal(r.translateEntries, 4);
  assert.deepEqual(r.ignored, []); // nothing was renamed by position
});

test('translateEntries is the table of the returned tree, whichever blocks follow it', () => {
  const nex = 'begin trees; translate 1 A, 2 B; tree t0=(1,2); end; begin trees; tree t1=(1,2); end;';
  assert.equal(parseNexus(nex, 0).translateEntries, 2);
  assert.equal(parseNexus(nex, 1).translateEntries, 0);
  assert.equal(parseNexus('begin trees; tree t=(A,B); end; begin trees; translate 1 A; tree u=(1,2); end;').translateEntries, 0);
});

test('an END that follows a tree with no ";" is taken for the end of the block, comments after it included', () => {
  for (const nex of ['#NEXUS\nbegin trees; tree t = (a,b)\nEND [trees done];', '#NEXUS\nbegin trees; tree t = (a,b) [x] endblock [y];']) {
    const r = parseNexus(nex);
    assert.equal(r.tree.labels[0], '');
    assert.deepEqual(
      r.tree.warnings.map((w) => w.code),
      ['missing-trailing-semicolon'],
    );
  }
  // END inside the tree is a tip, and a label glued to the parenthesis is a label
  assert.deepEqual(parseNexus('#NEXUS\nbegin trees; tree t = (a,\nend); end;').tree.tipLabels, ['a', 'end']);
  assert.equal(parseNexus('#NEXUS\nbegin trees; tree t = (a,b)end; end;').tree.labels[0], 'end');
});

test('names are compared without regard to case, and shown as written', () => {
  const nex = `#NEXUS
begin taxa; dimensions ntax=3; taxlabels Homo Pan Gorilla; end;
begin data; dimensions ntax=3 nchar=2; format datatype=dna; matrix
HOMO AC
PAN AC
GORILLA AC
; end;
begin trees; tree t = (homo,pan,gorilla); end;`;
  const r = parseNexus(nex);
  assert.deepEqual(r.tree.tipLabels, ['homo', 'pan', 'gorilla']);
  assert.deepEqual(
    r.ignored.map((n) => n.code),
    ['nexus-sequences-ignored'],
  );
});

test('sequence rows: a CHARACTERS block without NTAX is checked against the taxa; its own LINK is honoured', () => {
  const taxa = (t, l) => `begin taxa; title ${t}; dimensions ntax=2; taxlabels ${l}; end;\n`;
  const wrapped = `begin characters; link taxa = one; dimensions nchar=8; format datatype=dna; matrix
a ACGT
 ACGT
b ACGT
 ACGT
; end;\n`;
  const trees = 'begin trees; link taxa = one; tree t = (a,b); end;';
  // wrapped lines look like extra rows: with two taxa and three first words the block is not compared row by row
  const r = parseNexus('#NEXUS\n' + taxa('one', 'a b') + wrapped + trees);
  assert.deepEqual(
    r.ignored.map((n) => n.code),
    ['nexus-sequences-unlinked'],
  );
  assert.match(r.ignored[0].message, /could not be told apart/);
  const plain = wrapped.replace('a ACGT\n ACGT\nb ACGT\n ACGT', 'a ACGTACGT\nb ACGTACGT');
  assert.deepEqual(
    parseNexus('#NEXUS\n' + taxa('one', 'a b') + plain + trees).ignored.map((n) => n.code),
    ['nexus-sequences-ignored'],
  );
  const other = parseNexus('#NEXUS\n' + taxa('one', 'a b') + taxa('two', 'x y') + plain.replace('= one', '= two') + trees);
  assert.deepEqual(
    other.ignored.map((n) => n.code),
    ['nexus-taxa-unused', 'nexus-sequences-unlinked'],
  );
  assert.match(other.ignored[1].message, /links to the TAXA block "two", not the one the tree uses/);
});

test('the first block is reported at its BEGIN, not at #NEXUS', () => {
  const nex = '#NEXUS\n\nbegin sets;\n charset x = 1-2;\nend;\nbegin trees; tree t = (a,b); end;';
  assert.equal(parseNexus(nex).ignored[0].position, nex.indexOf('begin sets'));
});

test('an END after a tree with no ";" is found whatever comment stands before or after it', () => {
  const long = '[' + 'x'.repeat(300) + ']';
  for (const tail of ['(a,b)[&c]END;', '(a,b) END [x[y]z];', `(a,b) END ${long};`, '(a,b)\nendblock\n[&c]']) {
    const r = parseNexus(`#NEXUS\nbegin trees; tree a = ${tail}`);
    assert.equal(toNewick(r.tree), '(a,b);', tail.slice(0, 30));
    assert.deepEqual(
      r.tree.warnings.map((w) => w.code),
      ['missing-trailing-semicolon'],
      tail.slice(0, 30),
    );
  }
});

test('parseNexus reports the links of the tree it returns, not those of other TREES blocks', () => {
  const nex = `#NEXUS
begin taxa; title one; dimensions ntax=2; taxlabels a b; end;
begin taxa; title two; dimensions ntax=2; taxlabels x y; end;
begin trees; link taxa = one; tree t = (a,b); end;
begin trees; link taxa = nope; tree u = (a,b); end;
begin trees; tree v = (a,b); end;`;
  assert.deepEqual(
    parseNexus(nex, 0).ignored.map((n) => n.code),
    ['nexus-taxa-unused', 'nexus-other-trees'],
  );
  assert.deepEqual(
    parseNexus(nex, 1).ignored.map((n) => n.code),
    ['nexus-taxa-unused', 'nexus-taxa-unused', 'nexus-taxa-link-unresolved', 'nexus-other-trees'],
  );
  assert.deepEqual(
    parseNexus(nex, 2).ignored.map((n) => n.code),
    ['nexus-taxa-unused', 'nexus-taxa-mismatch', 'nexus-taxa-ambiguous', 'nexus-other-trees'],
  );
});
