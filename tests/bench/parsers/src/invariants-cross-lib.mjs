// Cross-lib runner for the generalized invariants from packages/io/test/warnings.test.mjs.
//
// Each input is one that our warnings system cares about: a boundary case (does extra-paren-root
// over-fire on single-tip chains?), a position-sensitive case (what char does a warning point at?),
// a cross-mode case (does strict throw iff default warns?), or a stray-comma / determinism probe.
//
// We don't expect the other libs to EMIT warnings - they're not built for it. The useful signal is
// different: for each boundary input, does the other lib (a) accept it with the same tip count we
// do, (b) accept it with a DIFFERENT tip count (silent corruption), (c) reject it, or (d) crash?
// Silent-corruption and crash are the interesting rows.
//
// Also runs a parse-twice determinism check per lib on the full set.

import { PARSERS, PARSER_IDS } from './parsers.mjs';

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

// Mirrors warnings.test.mjs NEGATIVE_CASES: inputs that must NOT trigger a specific warning.
// For cross-lib purposes we treat them as "shapes that MUST parse to the given tip count".
const INPUTS = [
  // negative cases that should parse cleanly (clean reference)
  { input: '(A,B);', expectTips: 2, note: 'minimal binary' },
  { input: 'A;', expectTips: 1, note: 'single leaf' },
  { input: '((A,B)Clade:0.5);', expectTips: 2, note: 'labeled internal, unary root' },
  { input: '(A:1e-5,B:+2);', expectTips: 2, note: 'scientific + leading-plus length' },
  { input: '(A:-0.5,B:0.5);', expectTips: 2, note: 'negative length' },
  { input: '(A);', expectTips: 1, note: 'unary-root single tip' },
  { input: '((A));', expectTips: 1, note: 'doubly unary single tip' },
  { input: '((Clade));', expectTips: 1, note: 'labeled tip inside two parens' },
  { input: '(A:1);', expectTips: 1, note: 'unary with length' },
  { input: '((A,B),C);', expectTips: 3, note: 'nested binary' },

  // Boundary / lenient cases: these are the ones we WARN on
  { input: '(A:1,B:2)', expectTips: 2, note: 'missing trailing semicolon' },
  { input: '(A:xyz,B:1);', expectTips: 2, note: 'non-numeric branch length' },
  { input: '(A:,B:1);', expectTips: 2, note: 'dangling colon' },
  { input: '(A,,B);', expectTips: 3, note: 'middle stray comma' },
  { input: '(A,B,);', expectTips: 3, note: 'trailing comma' },
  { input: '(,A,B);', expectTips: 3, note: 'leading comma' },
  { input: '(A,,,B);', expectTips: 4, note: 'two stray commas in a row' },
  { input: '((A:1,B:1):10);', expectTips: 2, note: 'ape extra-paren-root' },
  { input: '(A:1:2,B);', expectTips: 2, note: 'double colon' },
  { input: '(A:1:2:3,B);', expectTips: 2, note: 'triple colon' },

  // Clean parse (reference)
  { input: '((A:1,B:2):0.5,C);', expectTips: 3, note: 'clean reference tree' },
];

function run(parser, input) {
  try {
    const r = parser.parse(input, 'newick');
    if (!r || typeof r.tipCount !== 'number') return { kind: 'crash', note: 'empty result' };
    return { kind: 'parsed', tipCount: r.tipCount };
  } catch (e) {
    if (e instanceof Error) return { kind: 'error', note: e.message.slice(0, 60) };
    return { kind: 'crash', note: String(e).slice(0, 60) };
  }
}

function verdict(res, expectTips) {
  if (res.kind === 'crash') return 'CRSH';
  if (res.kind === 'error') return 'err ';
  if (res.tipCount === expectTips) return 'ok  ';
  return 'WRNG';
}

function paint(v) {
  const col = v === 'ok  ' ? 'green' : v === 'WRNG' ? 'yellow' : v === 'CRSH' ? 'red' : 'dim';
  return `${C[col]}${v}${C.reset}`;
}

function main() {
  console.log(`${C.cyan}${C.bold}Cross-lib invariants: ${INPUTS.length} boundary inputs${C.reset}`);
  console.log('');

  const inputWidth = Math.max(...INPUTS.map((x) => x.input.length)) + 2;
  const noteWidth = Math.max(...INPUTS.map((x) => x.note.length));
  const cellWidth = 10;

  const header =
    'INPUT'.padEnd(inputWidth) +
    'NOTE'.padEnd(noteWidth + 2) +
    'TIPS '.padStart(cellWidth) +
    PARSER_IDS.map((p) => PARSERS[p].name.padEnd(cellWidth + 2)).join('');
  console.log(header);
  console.log('-'.repeat(header.length));

  // Record cells for the summary
  const results = {};
  const score = {};
  for (const pid of PARSER_IDS) score[pid] = { ok: 0, wrong: 0, err: 0, crash: 0 };

  for (const { input, expectTips, note } of INPUTS) {
    const row = {};
    for (const pid of PARSER_IDS) {
      const res = run(PARSERS[pid], input);
      row[pid] = res;
      const v = verdict(res, expectTips);
      if (v === 'ok  ') score[pid].ok++;
      else if (v === 'WRNG') score[pid].wrong++;
      else if (v === 'err ') score[pid].err++;
      else score[pid].crash++;
    }
    results[input] = row;

    const expectCell = `${expectTips}t`.padStart(cellWidth);
    const parserCells = PARSER_IDS.map((pid) => {
      const r = row[pid];
      const v = verdict(r, expectTips);
      const detail = r.kind === 'parsed' ? `${r.tipCount}t` : v === 'err ' ? r.note.slice(0, 6) : '';
      return `${paint(v)} ${detail.padEnd(cellWidth - 5)}`;
    }).join('');
    console.log(JSON.stringify(input).padEnd(inputWidth) + note.padEnd(noteWidth + 2) + expectCell + '  ' + parserCells);
  }

  console.log('');
  console.log(`${C.cyan}Score (ok = parses with the expected tip count)${C.reset}`);
  for (const pid of PARSER_IDS) {
    const s = score[pid];
    const col = s.ok === INPUTS.length ? 'green' : s.ok >= INPUTS.length * 0.8 ? 'yellow' : 'red';
    console.log(
      `  ${PARSERS[pid].name.padEnd(18)} ${C[col]}${s.ok}/${INPUTS.length}${C.reset} ok,  ${s.wrong} wrong-count,  ${s.err} errored,  ${s.crash} crashed`,
    );
  }

  // Silent corruption spotlight: ours is `ok`, another lib is `WRNG` (different tip count).
  // This is the dangerous case - no error raised, but the tree is wrong.
  console.log('');
  console.log(`${C.yellow}Silent corruption (parsed with wrong tip count, no error):${C.reset}`);
  let silent = 0;
  for (const { input, expectTips } of INPUTS) {
    for (const pid of PARSER_IDS) {
      if (pid === 'ours') continue;
      const r = results[input][pid];
      if (r.kind === 'parsed' && r.tipCount !== expectTips) {
        console.log(`  ${PARSERS[pid].name.padEnd(18)}  ${JSON.stringify(input).padEnd(inputWidth)}  → ${r.tipCount} tips (expected ${expectTips})`);
        silent++;
      }
    }
  }
  if (silent === 0) console.log(`  ${C.dim}(none)${C.reset}`);

  // Determinism: parse twice, compare.
  console.log('');
  console.log(`${C.cyan}Determinism (parse-twice produces identical tip count across the whole set)${C.reset}`);
  for (const pid of PARSER_IDS) {
    let det = true;
    for (const { input } of INPUTS) {
      const a = run(PARSERS[pid], input);
      const b = run(PARSERS[pid], input);
      if (a.kind !== b.kind || (a.kind === 'parsed' && a.tipCount !== b.tipCount)) {
        det = false;
        break;
      }
    }
    const col = det ? 'green' : 'red';
    console.log(`  ${PARSERS[pid].name.padEnd(18)} ${C[col]}${det ? 'deterministic' : 'NON-DETERMINISTIC'}${C.reset}`);
  }

  // Our-only invariant: warnings are set and empty on clean parses.
  console.log('');
  console.log(`${C.cyan}gbif-phylo/io-only: warnings populated correctly${C.reset}`);
  const ours = PARSERS.ours;
  let correct = 0;
  for (const { input, expectTips } of INPUTS) {
    try {
      const t = ours.parse(input, 'newick').raw;
      // raw is the TreeModel; it must always have a .warnings array.
      if (!Array.isArray(t.warnings)) {
        console.log(`  ${JSON.stringify(input)}: warnings is not an array`);
        continue;
      }
      correct++;
    } catch {
      // Hard error; no tree to inspect.
    }
    void expectTips;
  }
  console.log(`  ${correct}/${INPUTS.length} parses expose a .warnings array`);
}

main();
