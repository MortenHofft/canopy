import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNewick, parseNexus, NewickError } from '@gbif-phylo/io';

// Each case: input, expected warning codes (in order), tip count, and the expected position of
// each warning in the input. Positions are the character offset of the problematic token.
const LENIENT = [
  { input: '(A:1,B:2)', codes: ['missing-trailing-semicolon'], tipCount: 2, positions: [8] }, // the ')'
  { input: '(A:xyz,B:1);', codes: ['non-numeric-length'], tipCount: 2, positions: [3] }, // 'xyz'
  { input: '(A:,B:1);', codes: ['dangling-colon'], tipCount: 2, positions: [2] }, // the ':'
  { input: '(A,B,);', codes: ['empty-tip'], tipCount: 3, positions: [4] }, // the trailing ','
  { input: '(,A,B);', codes: ['empty-tip'], tipCount: 3, positions: [1] }, // the leading ','
  { input: '(A,,B);', codes: ['empty-tip'], tipCount: 3, positions: [3] }, // the middle ','
  { input: '((A:1,B:1):10);', codes: ['extra-paren-root'], tipCount: 2, positions: [1] }, // the inner '('
];

for (const { input, codes, tipCount, positions } of LENIENT) {
  test(`default mode: ${input} parses with warnings ${JSON.stringify(codes)}`, () => {
    const t = parseNewick(input);
    assert.equal(t.tipCount, tipCount);
    assert.ok(Array.isArray(t.warnings), 'tree.warnings is an array');
    assert.deepEqual(
      t.warnings.map((w) => w.code),
      codes,
      `warning codes for ${JSON.stringify(input)}`,
    );
    for (const w of t.warnings) {
      assert.equal(typeof w.message, 'string');
      assert.equal(typeof w.position, 'number');
    }
    if (positions) {
      assert.deepEqual(
        t.warnings.map((w) => w.position),
        positions,
        `warning positions for ${JSON.stringify(input)}`,
      );
    }
  });

  test(`strict mode: ${input} throws NewickError`, () => {
    assert.throws(() => parseNewick(input, { strict: true }), NewickError);
    assert.throws(
      () => parseNewick(input, { strict: true }),
      (e) => e.message.includes(`[${codes[0]}]`),
    );
  });
}

// extra-paren-root must NOT fire on single-tip chains (unary wrappers around a tip, not an extra
// root paren). Only trees where the inner unary wrapper contains an actual subtree (>=2 kids)
// should trigger it.
for (const input of ['(A);', '((A));', '((Clade));', '(A:1);']) {
  test(`extra-paren-root does NOT fire on ${JSON.stringify(input)}`, () => {
    const t = parseNewick(input);
    const codes = t.warnings.map((w) => w.code);
    assert.ok(!codes.includes('extra-paren-root'), `unexpected extra-paren-root in ${JSON.stringify(codes)}`);
  });
}

// A clean parse has no warnings in either mode.
test('clean parse has no warnings', () => {
  const t = parseNewick('((A:1,B:2):0.5,C);');
  assert.equal(t.warnings.length, 0);
  // Strict mode shouldn't throw on a clean parse.
  const t2 = parseNewick('((A:1,B:2):0.5,C);', { strict: true });
  assert.equal(t2.warnings.length, 0);
});

// Structurally ambivalent cases fail hard in both modes.
const HARD_ERRORS = [
  { input: '("A","B");', match: /double-quoted/, about: 'double-quoted labels' },
  { input: "(A'q',B);", match: /unexpected '/, about: 'quote mid-token' },
];

for (const { input, match, about } of HARD_ERRORS) {
  test(`default mode: ${about} throws NewickError (${JSON.stringify(input)})`, () => {
    assert.throws(() => parseNewick(input), NewickError);
    assert.throws(() => parseNewick(input), match);
  });
  test(`strict mode: ${about} still throws (${JSON.stringify(input)})`, () => {
    assert.throws(() => parseNewick(input, { strict: true }), NewickError);
    assert.throws(() => parseNewick(input, { strict: true }), match);
  });
}

// Double colon stays lenient (last colon wins) but warns, because real-world generators use
// '(sub:len,tip)' as a shortcut and we don't want to break them.
test('double colon: default mode warns, last colon wins', () => {
  const t = parseNewick('(A:1:2,B);');
  assert.equal(t.tipCount, 2);
  const t0 = t.tipNode[0];
  assert.equal(t.length[t0], 2, 'the second colon wins');
  assert.ok(t.warnings.some((w) => w.code === 'double-colon'));
});
test('double colon: strict mode throws', () => {
  assert.throws(() => parseNewick('(A:1:2,B);', { strict: true }), /double-colon/);
});

// NEXUS header missing: warning in default, throw in strict.
test('NEXUS without #NEXUS header: default mode warns', () => {
  const r = parseNexus('BEGIN TREES;\n  TREE t = (A:1,B:2);\nEND;\n');
  assert.equal(r.tree.tipCount, 2);
  assert.ok(r.tree.warnings.some((w) => w.code === 'missing-nexus-header'));
});

test('NEXUS without #NEXUS header: strict mode throws', () => {
  assert.throws(() => parseNexus('BEGIN TREES;\n  TREE t = (A:1,B:2);\nEND;\n', { strict: true }), /missing-nexus-header/);
});

test('NEXUS with #NEXUS header: no header warning', () => {
  const r = parseNexus('#NEXUS\nBEGIN TREES;\n  TREE t = (A:1,B:2);\nEND;\n');
  assert.equal(r.tree.tipCount, 2);
  assert.ok(!r.tree.warnings.some((w) => w.code === 'missing-nexus-header'));
});

// Multiple warnings in one tree accumulate.
test('multiple warnings accumulate on one tree', () => {
  const t = parseNewick('(A:xyz,B:,,C:1)');
  const codes = t.warnings.map((w) => w.code);
  assert.ok(codes.includes('non-numeric-length'), `expected non-numeric-length in ${JSON.stringify(codes)}`);
  assert.ok(codes.includes('dangling-colon'), `expected dangling-colon in ${JSON.stringify(codes)}`);
  assert.ok(codes.includes('empty-tip'), `expected empty-tip in ${JSON.stringify(codes)}`);
  assert.ok(codes.includes('missing-trailing-semicolon'), `expected missing-trailing-semicolon in ${JSON.stringify(codes)}`);
});

// Positions point at the offending character.
test('warning positions point at the offending character', () => {
  const t = parseNewick('(A:xyz,B:1);');
  const w = t.warnings.find((x) => x.code === 'non-numeric-length');
  assert.ok(w);
  // 'xyz' starts at index 3
  assert.equal(w.position, 3);
});
