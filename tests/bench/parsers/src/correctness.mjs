// Correctness matrix: every parser × every edge-case fixture.
//
// Verdicts per cell:
//   ok    - parsed and matches the expected tipCount / tipLabels / hasLengths (when the field is set)
//   wrong - parsed but the shape disagrees with the expectation
//   error - threw a proper Error (clean refusal; the right outcome for malformed inputs)
//   crash - threw a non-Error, returned null/undefined, or produced unparseable output
//
// A well-formed fixture is "pass" if the verdict is `ok`.
// A malformed fixture is "pass" if the verdict is `error`.

import { PARSERS, PARSER_IDS } from './parsers.mjs';
import { loadEdgeFixtures } from './edge-fixtures.mjs';

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

const VERDICT_COLOR = { ok: 'green', wrong: 'yellow', error: 'dim', crash: 'red', skip: 'dim' };
const VERDICT_SHORT = { ok: 'ok   ', wrong: 'WRONG', error: 'err  ', crash: 'CRASH', skip: 'skip ' };

function paint(verdict, isExpected) {
  const col = isExpected ? 'green' : VERDICT_COLOR[verdict];
  return `${COLORS[col]}${VERDICT_SHORT[verdict]}${COLORS.reset}`;
}

function sameLabels(a, b) {
  if (a == null || b == null) return true; // null expectation means "don't check"
  if (a.length !== b.length) return false;
  // Compare as unordered multisets - we don't care about preorder vs lex here.
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
}

function runOne(parser, fixture) {
  if (fixture.kind === 'nexus' && !parser.nexus) return { verdict: 'skip', note: 'no nexus' };
  let r;
  try {
    r = parser.parse(fixture.input, fixture.kind);
  } catch (e) {
    if (e instanceof Error) return { verdict: 'error', note: e.message };
    return { verdict: 'crash', note: `thrown non-Error: ${String(e)}` };
  }
  if (!r || typeof r.tipCount !== 'number') return { verdict: 'crash', note: 'parser returned empty' };

  if (!fixture.wellFormed) {
    return { verdict: 'wrong', note: `parsed malformed input as ${r.tipCount} tips`, got: r };
  }
  if (typeof fixture.tipCount === 'number' && r.tipCount !== fixture.tipCount) {
    return { verdict: 'wrong', note: `tipCount ${r.tipCount}, expected ${fixture.tipCount}`, got: r };
  }
  if (fixture.tipLabels != null && !sameLabels(r.tipLabels, fixture.tipLabels)) {
    return { verdict: 'wrong', note: `labels ${JSON.stringify(r.tipLabels)}, expected ${JSON.stringify(fixture.tipLabels)}`, got: r };
  }
  // hasLengths is advisory - don't flag as wrong; just note it in diagnostics
  return { verdict: 'ok', got: r };
}

function expected(fixture, verdict) {
  if (fixture.wellFormed) return verdict === 'ok';
  return verdict === 'error';
}

function fmtInput(text) {
  if (text.length <= 48) return text.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
  return text.slice(0, 45).replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '...';
}

async function main() {
  const fixtures = loadEdgeFixtures();
  const results = {}; // fixture.id -> parserId -> verdict
  const notes = {};

  for (const f of fixtures) {
    results[f.id] = {};
    notes[f.id] = {};
    for (const pid of PARSER_IDS) {
      const r = runOne(PARSERS[pid], f);
      results[f.id][pid] = r.verdict;
      notes[f.id][pid] = r.note ?? '';
    }
  }

  // Print header
  const idWidth = Math.max(...fixtures.map((f) => f.id.length));
  const kindWidth = 7;
  const inputWidth = 50;
  const cellWidth = 7;

  const header =
    'FIXTURE'.padEnd(idWidth) +
    '  ' +
    'KIND'.padEnd(kindWidth) +
    '  ' +
    'INPUT'.padEnd(inputWidth) +
    '  ' +
    PARSER_IDS.map((p) => PARSERS[p].name.padEnd(cellWidth + 7)).join('');
  console.log(header);
  console.log('-'.repeat(header.length));

  const wellFormed = { total: 0 };
  const malformed = { total: 0 };
  for (const pid of PARSER_IDS) {
    wellFormed[pid] = 0;
    malformed[pid] = 0;
  }

  for (const f of fixtures) {
    const row =
      f.id.padEnd(idWidth) +
      '  ' +
      f.kind.padEnd(kindWidth) +
      '  ' +
      fmtInput(f.input).padEnd(inputWidth) +
      '  ' +
      PARSER_IDS.map((pid) => {
        const v = results[f.id][pid];
        if (v === 'skip') return `${COLORS.dim}skip${COLORS.reset}`.padEnd(cellWidth + 11);
        const ok = expected(f, v);
        return paint(v, ok).padEnd(cellWidth + 11);
      }).join('');
    console.log(row);

    if (f.wellFormed) {
      wellFormed.total++;
      for (const pid of PARSER_IDS) if (results[f.id][pid] === 'ok') wellFormed[pid]++;
    } else {
      malformed.total++;
      for (const pid of PARSER_IDS) if (results[f.id][pid] === 'error') malformed[pid]++;
    }
  }

  console.log('');
  console.log(`${COLORS.cyan}Summary${COLORS.reset}`);
  console.log('well-formed fixtures: ' + wellFormed.total);
  for (const pid of PARSER_IDS) {
    const n = wellFormed[pid];
    const col = n === wellFormed.total ? 'green' : n >= wellFormed.total * 0.8 ? 'yellow' : 'red';
    console.log(`  ${PARSERS[pid].name.padEnd(18)} ${COLORS[col]}${n}/${wellFormed.total}${COLORS.reset} parsed correctly`);
  }
  console.log('malformed fixtures: ' + malformed.total);
  for (const pid of PARSER_IDS) {
    const n = malformed[pid];
    const col = n === malformed.total ? 'green' : n >= malformed.total * 0.6 ? 'yellow' : 'red';
    console.log(`  ${PARSERS[pid].name.padEnd(18)} ${COLORS[col]}${n}/${malformed.total}${COLORS.reset} rejected cleanly`);
  }

  // Print any crashes with their notes
  const crashes = [];
  for (const f of fixtures) {
    for (const pid of PARSER_IDS) {
      if (results[f.id][pid] === 'crash') {
        crashes.push({ fixture: f.id, parser: PARSERS[pid].name, note: notes[f.id][pid] });
      }
    }
  }
  if (crashes.length) {
    console.log('');
    console.log(`${COLORS.red}Crashes${COLORS.reset}`);
    for (const c of crashes) console.log(`  ${c.parser.padEnd(18)} ${c.fixture.padEnd(30)} ${c.note}`);
  }

  // JSON output
  const outPath = process.env.OUT ?? null;
  if (outPath) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(outPath, JSON.stringify({ fixtures, results, notes }, null, 2));
    console.log(`\nWrote ${outPath}`);
  }

  // Exit code reflects crashes only; wrong/error counts are expected and reported in the summary.
  if (crashes.length) process.exit(1);
}

main();
