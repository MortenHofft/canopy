// nexusIndex and nexusTrees: the trees of a file found in one pass, read one at a time.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { toNewick } from '../src/newick.ts';
import { nexusIndex, nexusTrees, parseNexus } from '../src/nexus.ts';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data');
const read = (p) => {
  const b = fs.readFileSync(path.join(DATA, p));
  return (p.endsWith('.gz') ? zlib.gunzipSync(b) : b).toString('utf8');
};

test('real multi-tree files: the index, the generator and parseNexus(text, i) give the same trees', () => {
  for (const f of [
    'rich/birdtree-100-posterior/output2.nex.gz',
    'synthetic/nexus/multi_yule_200_x10.nex',
    'rich/edge-cases/multi-tree-translate.nex',
  ]) {
    const text = read(f);
    const index = nexusIndex(text);
    const n = index.trees.length;
    assert.equal(parseNexus(text).treeCount, n, f);
    const all = [...nexusTrees(text)];
    assert.equal(all.length, n, f);
    for (const i of new Set([0, 1, n >> 1, n - 1])) {
      const direct = parseNexus(text, i);
      assert.equal(toNewick(all[i].tree), toNewick(direct.tree), `${f} tree ${i}`);
      assert.equal(toNewick(index.parse(i).tree), toNewick(direct.tree), `${f} tree ${i}`);
      assert.equal(all[i].info.name, direct.treeName);
      assert.equal(index.trees[i].index, i);
    }
    assert.throws(() => index.parse(n), /no tree number/);
  }
});

test('the offsets of a tree are those of its TREE command in the text', () => {
  const text = read('rich/edge-cases/multi-tree-translate.nex');
  const { trees } = nexusIndex(text);
  assert.equal(trees.length, 3);
  for (const t of trees) {
    assert.match(text.slice(t.start, t.end), /^tree\s/i);
    assert.equal(text[t.end], ';');
  }
  assert.deepEqual(
    trees.map((t) => [t.name, t.rooted]),
    [
      ['rooted_tree', true],
      ['unrooted_tree', false],
      ['no_lengths_tree', true],
    ],
  );
});

test('tree-level facts: name, default star, rooting flag, weight, MCMC state', () => {
  const nex = `#NEXUS
begin trees;
  tree STATE_0 [&lnP=-1.5] = [&R] (a,b);
  tree gen.100000 = [&U] (a,b);
  tree * 'my tree' = [&R] [&W 1/2] (a,b);
  tree plain = [&W 0.25] (a,b);
  utree u2 = (a,b);
  tree 7 = (a,b);
  tree 'it''s' = (a,b);
end;`;
  const t = nexusIndex(nex).trees;
  assert.deepEqual(
    t.map((x) => [x.name, x.isDefault, x.rooted, x.weight, x.state]),
    [
      ['STATE_0', false, true, null, 0],
      ['gen.100000', false, false, null, 100000],
      ['my tree', true, true, 0.5, null],
      ['plain', false, null, 0.25, null],
      ['u2', false, null, null, null],
      ['7', false, null, null, null],
      ["it's", false, null, null, null],
    ],
  );
});

test('tree-level facts on real files: BEAST and MrBayes state names, the rooting flag of a BEAST MCC tree', () => {
  const mcc = nexusIndex(read('rich/beast-hcv-2k1b/2k1b_fullGenome_9GTR1clock_COO_BSSVSMJ.MCC.tree.gz')).trees;
  assert.equal(mcc.length, 1);
  assert.equal(mcc[0].rooted, true);
  const posterior = nexusIndex(read('rich/birdtree-100-posterior/output2.nex.gz')).trees;
  assert.equal(posterior.length, 100);
  assert.equal(posterior[0].name, 'tree_0000');
  assert.ok(posterior.every((x) => x.rooted === null && x.state === null));
});

test('several TREES blocks keep their own TRANSLATE table and TAXA block', () => {
  const nex = `#NEXUS
begin taxa; title one; dimensions ntax=2; taxlabels a b; end;
begin taxa; title two; dimensions ntax=2; taxlabels x y; end;
begin trees; link taxa = one; translate 1 A, 2 B; tree t0 = (1,2); tree t1 = (2,1); end;
begin trees; link taxa = two; tree t2 = (1,2); end;
begin trees; link taxa = two; translate 1 P, 2 Q; tree t3 = (1,2); end;`;
  const index = nexusIndex(nex);
  assert.deepEqual(
    index.trees.map((t) => t.name),
    ['t0', 't1', 't2', 't3'],
  );
  const labels = [...nexusTrees(nex)].map((r) => [...r.tree.tipLabels]);
  assert.deepEqual(labels, [
    ['A', 'B'],
    ['B', 'A'],
    ['x', 'y'],
    ['P', 'Q'],
  ]);
  assert.deepEqual(
    [...nexusTrees(nex)].map((r) => r.translateEntries),
    [2, 2, 0, 2],
  );
  assert.deepEqual(index.ignored, []); // both TAXA blocks are used by some TREES block
  assert.deepEqual(
    index.parse(2).ignored.map((n) => n.code),
    ['nexus-taxon-numbers'],
  );
});

test('the index parses no tree: a broken tree is found only when it is asked for', () => {
  const nex = '#NEXUS\nbegin trees; tree a = (A,B); tree b = (A,B; tree c = (A,B,C); end;';
  const index = nexusIndex(nex);
  assert.equal(index.trees.length, 3);
  assert.deepEqual(index.parse(0).tree.tipLabels, ['A', 'B']);
  assert.throws(() => index.parse(1), /unbalanced/);
  assert.deepEqual(index.parse(2).tree.tipLabels, ['A', 'B', 'C']);
  const seen = [];
  assert.throws(() => {
    for (const r of nexusTrees(nex)) seen.push(r.info.name);
  }, /unbalanced/);
  assert.deepEqual(seen, ['a']);
});

test('a scan that stops keeps the trees found before it; a missing tree then says why', () => {
  const after = "#NEXUS\nbegin trees; tree a = (A,B); tree b = (A,B,C); end;\nbegin notes; text 'unfinished; end;";
  const index = nexusIndex(after);
  assert.equal(index.trees.length, 2);
  assert.ok(index.ignored.some((n) => n.code === 'nexus-scan-stopped'));
  assert.equal(index.parse(1).tree.tipCount, 3);
  assert.throws(() => index.parse(2), /unterminated quote/);
  // before the trees nothing is found, and parseNexus still throws what it always threw
  assert.throws(() => parseNexus("#NEXUS\nbegin notes; text 'unfinished; end;\nbegin trees; tree a = (A,B); end;"), /unterminated quote/);
});

test('options reach every tree: annotations and strict', () => {
  const nex = '#NEXUS\nbegin trees; tree a = (A[&x=1],B); tree b = (A,B)\nend;';
  const first = nexusTrees(nex, { annotations: true }).next().value;
  assert.equal(first.tree.annotations.get(first.tree.tipNode[0], 'x'), 1);
  const index = nexusIndex(nex, { strict: true });
  assert.equal(index.parse(0).tree.tipCount, 2);
  assert.throws(() => index.parse(1), /missing-trailing-semicolon/);
  assert.throws(() => nexusIndex('begin trees; tree a = (A,B); end;', { strict: true }), /missing-nexus-header/);
});

test('a file of thousands of trees: the index, the last tree and every tree', () => {
  const n = 5000;
  let nex = '#NEXUS\nbegin taxa; dimensions ntax=3; taxlabels A B C; end;\nbegin trees; translate 1 A, 2 B, 3 C;\n';
  for (let i = 0; i < n; i++) nex += `tree STATE_${i * 1000} = [&U] (1:${i + 1},(2:1,3:1):1);\n`;
  nex += 'end;';
  const index = nexusIndex(nex);
  assert.equal(index.trees.length, n);
  assert.equal(index.trees[n - 1].state, (n - 1) * 1000);
  const last = index.parse(n - 1).tree;
  assert.equal(last.length[last.tipNode[0]], n);
  assert.equal([...nexusTrees(nex)].length, n);
});

test('tree info: the offsets, the weight and rooted flag in odd places, the state names', () => {
  const nex = `#NEXUS
begin trees;
  tree b = [&W 1/0] (x,y);
  tree c = [&W 1e400] (x,y);
  tree d = [&W 2e-1] (x,y);
  tree gen_30 = (x,y);
  tree STATE.4 = (x,y);
  tree e = [& R ] (x,y);
  [c] tree a = [&R &W 2] (x,y);
end;`;
  const t = nexusIndex(nex).trees;
  assert.deepEqual(
    t.slice(0, 3).map((x) => x.weight),
    [null, null, 0.2],
  );
  assert.deepEqual(
    t.slice(3, 5).map((x) => x.state),
    [null, null],
  );
  assert.equal(t[5].rooted, true);
  assert.equal(nex.slice(t[6].start, t[6].end), 'tree a = [&R &W 2] (x,y)'); // from the keyword, a comment before it left out
  assert.deepEqual([t[6].rooted, t[6].weight], [true, 2]);
  // an END read into the command (no ';') is not part of the tree
  const open = '#NEXUS\nbegin trees; tree a = (x,y)\nend;';
  const [a] = nexusIndex(open).trees;
  assert.equal(open.slice(a.start, a.end), 'tree a = (x,y)');
});

test('the index cannot be changed from outside, and trees do not share a header warning', () => {
  const nex = 'begin trees; tree a = (A,B); tree b = (A,B); end;';
  const index = nexusIndex(nex);
  assert.ok(Object.isFrozen(index.trees[0]) && Object.isFrozen(index.ignored));
  const [a, b] = [index.parse(0).tree, index.parse(1).tree];
  assert.deepEqual(
    a.warnings.map((w) => w.code),
    ['missing-nexus-header'],
  );
  assert.notEqual(a.warnings[0], b.warnings[0]);
});

test('parse(i) brings the notes that depend on its tips, the sequence notes too', () => {
  const nex = `#NEXUS
begin taxa; dimensions ntax=2; taxlabels A B; end;
begin characters; dimensions nchar=2; format datatype=dna; matrix
A AC
B GT
; end;
begin trees; tree t = (A,B); tree u = (A,C); end;`;
  const index = nexusIndex(nex);
  assert.deepEqual(index.ignored, []);
  assert.deepEqual(
    index.parse(0).ignored.map((n) => n.code),
    ['nexus-sequences-ignored'],
  );
  assert.deepEqual(
    index.parse(1).ignored.map((n) => n.code),
    ['nexus-taxa-mismatch', 'nexus-sequences-unlinked'],
  );
  assert.deepEqual(
    parseNexus(nex).ignored.map((n) => n.code),
    ['nexus-sequences-ignored', 'nexus-other-trees'],
  );
});

test('a TITLE and a LINK match the way names do: case and an unquoted _ for a space do not matter', () => {
  const nex = "#NEXUS\nbegin taxa; title 'My Taxa'; dimensions ntax=2; taxlabels A B; end;\nbegin trees; link taxa = My_taxa; tree t = (1,2); end;";
  const index = nexusIndex(nex);
  assert.deepEqual(index.ignored, []);
  assert.deepEqual(index.parse(0).tree.tipLabels, ['A', 'B']);
});

test('TRANSLATE entries that are not a token and a name are reported, not guessed', () => {
  const nex = '#NEXUS\nbegin trees; translate 1 Homo sapiens, 2 Pan, 3 Gorilla; tree t = (1,2,3); end;';
  const index = nexusIndex(nex);
  assert.deepEqual(
    index.ignored.map((n) => n.code),
    ['nexus-translate-malformed'],
  );
  assert.match(index.ignored[0].message, /1 TRANSLATE entries.*Homo sapiens/);
  assert.deepEqual(index.parse(0).tree.tipLabels, ['1', 'Pan', 'Gorilla']);
  const odd = nexusIndex('#NEXUS\nbegin trees; translate 1 A 2 B 3; tree t = (1,2); end;');
  assert.deepEqual(
    odd.ignored.map((n) => n.code),
    ['nexus-translate-malformed'],
  );
});

test('a file with thousands of blocks is indexed without a quadratic step', () => {
  let nex = '#NEXUS\n';
  for (let i = 0; i < 20000; i++) nex += `begin taxa; dimensions ntax=1; taxlabels t${i}; end; begin trees; tree x${i} = (t${i},u); end;\n`;
  const index = nexusIndex(nex);
  assert.equal(index.trees.length, 20000);
  assert.deepEqual([...index.parse(19999).tree.tipLabels], ['t19999', 'u']);
});
