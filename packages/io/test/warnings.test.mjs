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

// ----------------------------------------------------------------------------- generalized invariants
//
// These tests guard the whole warnings system against the class of bug an adversarial code review
// surfaced (positions pointing at the wrong character, warning predicates over-firing on lookalike
// inputs, strict mode disagreeing with default mode). Each is a property that must hold on EVERY
// input, so new warning codes added later are automatically covered.

// Negative-space suite: for every warning code, a list of inputs that look similar but should NOT
// trigger it. If a future change to a warning's predicate makes it too loose, these fail.
const NEGATIVE_CASES = {
  'missing-trailing-semicolon': ['(A,B);', 'A;', '((A,B)Clade:0.5);'],
  'non-numeric-length': ['(A:1,B:2);', '(A:1e-5,B:+2);', '(A:-0.5,B:0.5);'],
  'dangling-colon': ['(A:1,B:2);', '((A,B):0.5,C);'],
  'empty-tip': ['(A,B);', '((A,B),C);', '(A);'],
  'extra-paren-root': ['(A);', '((A));', '((Clade));', '(A:1);', '(A,B);', '((A,B),C);'],
  'double-colon': ['(A:1,B:2);', '((A,B):0.5,C);'],
  'missing-nexus-header': [], // Newick inputs don't test NEXUS; this is tested separately
};

for (const [code, inputs] of Object.entries(NEGATIVE_CASES)) {
  for (const input of inputs) {
    test(`${code} must NOT fire on ${JSON.stringify(input)}`, () => {
      const t = parseNewick(input);
      const codes = t.warnings.map((w) => w.code);
      assert.ok(!codes.includes(code), `unexpected ${code} in warnings: ${JSON.stringify(codes)}`);
    });
  }
}

// Position-within-bounds invariant: EVERY warning's position must be a valid character offset.
// Catches a hard-coded 0 as a position (bug the review found), and any position that drifts past
// the end of input due to trailing whitespace handling.
const POSITION_BOUNDS_INPUTS = [
  '(A:1,B:2)',
  '(A:xyz,B:1);',
  '(A:,B:1);',
  '(A,B,);',
  '(,A,B);',
  '(A,,B);',
  '((A:1,B:1):10);',
  '(A:xyz,B:,,C:1)', // multiple warnings
  '(A,B)\n\n\n', // trailing whitespace
  '((A:1,B:2):0.5,C);', // clean
  '(A:1:2,B);',
  '(A:1:2:3,B);',
];
for (const input of POSITION_BOUNDS_INPUTS) {
  test(`every warning position is in [0, ${input.length}) for ${JSON.stringify(input)}`, () => {
    const t = parseNewick(input);
    for (const w of t.warnings) {
      assert.ok(w.position >= 0, `position ${w.position} is negative on ${w.code}`);
      assert.ok(w.position < input.length, `position ${w.position} is past end-of-input (length ${input.length}) on ${w.code}`);
      // The character at the position should not be whitespace (that would mean we blamed a
      // non-content character). Exception: for '(A,B,);' the position is a comma, '(': they're
      // never whitespace; this is a general sanity check.
      const code = input.charCodeAt(w.position);
      assert.ok(
        code !== 32 && code !== 9 && code !== 10 && code !== 13,
        `warning ${w.code} points at a whitespace character (${JSON.stringify(input[w.position])}) at ${w.position}`,
      );
    }
  });
}

// Cross-mode consistency: for every input, { strict: true } throws if and only if the default-mode
// parse has at least one warning. A disagreement means strict mode has a path that produces a
// warning not thrown, or throws something default mode doesn't record.
const CROSS_MODE_INPUTS = [
  // clean
  '((A:1,B:2):0.5,C);',
  '(A,B);',
  '(A:1);',
  // various warnings
  '(A:1,B:2)',
  '(A:xyz,B:1);',
  '(A:,B:1);',
  '(A,,B);',
  '(A,B,);',
  '(,A,B);',
  '((A:1,B:1):10);',
  '(A:1:2,B);',
  // mixed
  '(A:xyz,B:,,C:1)',
];
for (const input of CROSS_MODE_INPUTS) {
  test(`cross-mode: strict throws iff default has warnings for ${JSON.stringify(input)}`, () => {
    const t = parseNewick(input);
    const defaultHasWarnings = t.warnings.length > 0;
    let strictThrew = false;
    try {
      parseNewick(input, { strict: true });
    } catch {
      strictThrew = true;
    }
    assert.equal(
      strictThrew,
      defaultHasWarnings,
      `inconsistent: default warnings=${t.warnings.length}, strict threw=${strictThrew} for ${JSON.stringify(input)}`,
    );
  });
}

// Determinism: parsing the same input twice produces the same warnings in the same order with
// the same positions. Rules out any non-deterministic state leak (e.g. a shared mutable array,
// or an uninitialised counter).
test('warnings are deterministic across repeated parses', () => {
  const input = '(A:xyz,B:,,C:1)';
  const a = parseNewick(input);
  const b = parseNewick(input);
  assert.deepEqual(
    a.warnings.map((w) => ({ code: w.code, position: w.position })),
    b.warnings.map((w) => ({ code: w.code, position: w.position })),
  );
});

// (A,,B,,C,,); emits one empty-tip per stray comma. Rules out single-fire-and-silence bugs.
test('every stray comma emits its own empty-tip warning', () => {
  const t = parseNewick('(A,,,B);');
  const emptyTips = t.warnings.filter((w) => w.code === 'empty-tip');
  // Two internal strays between A and B, so two empty tips, so two warnings.
  assert.equal(emptyTips.length, 2);
  // Positions should be strictly increasing.
  for (let i = 1; i < emptyTips.length; i++) {
    assert.ok(emptyTips[i].position > emptyTips[i - 1].position, 'positions not strictly increasing');
  }
});

// warnings is a readonly array on the public type but must be a fresh array per parse (not shared
// across TreeModels). Rules out a module-level singleton.
test('warnings arrays are not shared between trees', () => {
  const a = parseNewick('(A:xyz,B);');
  const b = parseNewick('((A:1,B:1):10);');
  assert.notEqual(a.warnings, b.warnings, 'two trees share the same warnings array');
  assert.notDeepEqual(
    a.warnings.map((w) => w.code),
    b.warnings.map((w) => w.code),
  );
});
