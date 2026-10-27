// Cross-check every edge fixture against DendroPy (the Python reference impl) and compare the
// four JS implementations' verdicts to DendroPy's.
//
// For each fixture:
//   - DendroPy parses and reports its verdict (ok / wrong / error / crash) and tip count.
//   - Each JS lib parses and reports the same.
//   - We flag disagreements with DendroPy as the reference, column-by-column.
//
// DendroPy is not infallible — it has its own opinions on malformed input — but it is the most
// widely-used reference implementation in bioinformatics and is a useful tie-breaker.

import { spawn } from 'node:child_process';
import { PARSERS, PARSER_IDS } from './parsers.mjs';
import { loadEdgeFixtures } from './edge-fixtures.mjs';

const COLORS = { reset: '\x1b[0m', dim: '\x1b[2m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m' };

function sameLabels(a, b) {
  if (a == null || b == null) return true;
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
}

function runJsParser(parser, fixture) {
  if (fixture.kind === 'nexus' && !parser.nexus) return { verdict: 'skip' };
  try {
    const r = parser.parse(fixture.input, fixture.kind);
    if (!r || typeof r.tipCount !== 'number') return { verdict: 'crash', note: 'empty' };
    return { verdict: 'parsed', tipCount: r.tipCount, tipLabels: r.tipLabels };
  } catch (e) {
    if (e instanceof Error) return { verdict: 'error', note: e.message.slice(0, 80) };
    return { verdict: 'crash', note: String(e).slice(0, 80) };
  }
}

async function runDendropy(fixtures) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['src/dendropy-oracle.py'], { cwd: process.cwd() });
    let out = '';
    let err = '';
    child.stdout.on('data', (b) => {
      out += b.toString();
    });
    child.stderr.on('data', (b) => {
      err += b.toString();
    });
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`dendropy exited ${code}: ${err.slice(0, 300)}`));
      const results = {};
      for (const line of out.split('\n')) {
        const s = line.trim();
        if (!s) continue;
        try {
          const r = JSON.parse(s);
          results[r.id] = r;
        } catch {
          console.error('bad oracle line:', s.slice(0, 80));
        }
      }
      resolve(results);
    });
    for (const f of fixtures) child.stdin.write(JSON.stringify(f) + '\n');
    child.stdin.end();
  });
}

function verdictOfJs(fixture, r) {
  if (r.verdict === 'skip') return 'skip';
  if (r.verdict === 'error') return 'error';
  if (r.verdict === 'crash') return 'crash';
  // parsed
  if (!fixture.wellFormed) return 'wrong';
  if (typeof fixture.tipCount === 'number' && r.tipCount !== fixture.tipCount) return 'wrong';
  if (fixture.tipLabels != null && !sameLabels(r.tipLabels, fixture.tipLabels)) return 'wrong';
  return 'ok';
}

const SHORT = { ok: 'ok  ', wrong: 'WRNG', error: 'err ', crash: 'CRSH', skip: 'skip' };
const COLOR_BY_VERDICT = { ok: 'green', wrong: 'yellow', error: 'dim', crash: 'red', skip: 'dim' };

function paint(v) {
  return `${COLORS[COLOR_BY_VERDICT[v]]}${SHORT[v]}${COLORS.reset}`;
}

async function main() {
  const fixtures = loadEdgeFixtures();
  console.log(`${COLORS.cyan}Running DendroPy on ${fixtures.length} edge fixtures...${COLORS.reset}`);
  let oracle;
  try {
    oracle = await runDendropy(fixtures);
  } catch (e) {
    console.error(`DendroPy oracle failed: ${e.message}`);
    process.exit(1);
  }

  const idWidth = Math.max(...fixtures.map((f) => f.id.length));
  const colWidth = 15;

  const header =
    'FIXTURE'.padEnd(idWidth) +
    '  ' +
    'DendroPy'.padStart(colWidth) +
    '  ' +
    PARSER_IDS.map((p) => PARSERS[p].name.padStart(colWidth)).join('  ') +
    '  ' +
    'DISAGREE'.padStart(colWidth);
  console.log(header);
  console.log('-'.repeat(header.length));

  // Count agreements per lib with DendroPy, and overall accuracy per lib
  const agree = { oracle: 0 };
  const total = { oracle: 0 };
  for (const pid of PARSER_IDS) {
    agree[pid] = 0;
    total[pid] = 0;
  }
  const correctJs = {};
  for (const pid of PARSER_IDS) correctJs[pid] = 0;
  let correctOracle = 0;

  const disagreements = [];
  for (const f of fixtures) {
    const or = oracle[f.id] ?? { verdict: 'crash', note: 'no result' };
    const orVerdict = or.verdict;
    const orPasses = f.wellFormed ? orVerdict === 'ok' : orVerdict === 'error';
    if (orPasses) correctOracle++;

    const row = [f.id.padEnd(idWidth), paint(orVerdict).padStart(colWidth + 11)];
    const diff = [];
    for (const pid of PARSER_IDS) {
      const r = runJsParser(PARSERS[pid], f);
      const v = verdictOfJs(f, r);
      row.push(paint(v).padStart(colWidth + 11));
      if (v === 'skip') continue;
      if (f.wellFormed ? v === 'ok' : v === 'error') correctJs[pid]++;
      total[pid]++;
      // Compare with oracle (both must have a non-skip verdict)
      if (orVerdict === 'skip' || orVerdict === 'crash') continue;
      if (v === orVerdict || (v === 'ok' && orVerdict === 'ok')) agree[pid]++;
      else diff.push(`${PARSERS[pid].name}:${v}`);
    }
    row.push(diff.length ? `${COLORS.yellow}${diff.length}${COLORS.reset}`.padStart(colWidth + 9) : '');
    console.log(row.join('  '));

    if (diff.length) disagreements.push({ fixture: f, oracle: or, diffs: diff });
  }

  console.log('');
  console.log(`${COLORS.cyan}Agreement with DendroPy (same verdict family: ok vs error)${COLORS.reset}`);
  for (const pid of PARSER_IDS) {
    const a = agree[pid];
    const t = total[pid];
    console.log(`  ${PARSERS[pid].name.padEnd(18)} ${a}/${t} agreements`);
  }
  console.log('');
  console.log(`${COLORS.cyan}Correctness vs fixture expectations (we were right)${COLORS.reset}`);
  console.log(`  ${'DendroPy'.padEnd(18)} ${correctOracle}/${fixtures.length}`);
  for (const pid of PARSER_IDS) {
    console.log(`  ${PARSERS[pid].name.padEnd(18)} ${correctJs[pid]}/${total[pid]}`);
  }

  // DendroPy-only disagreements worth attention: cases where DendroPy and OURS differ.
  console.log('');
  console.log(`${COLORS.cyan}Where DendroPy and canopy/io differ (potential bugs in ours or in our fixture expectation)${COLORS.reset}`);
  for (const f of fixtures) {
    const or = oracle[f.id];
    if (!or) continue;
    const ours = runJsParser(PARSERS.ours, f);
    const oursV = verdictOfJs(f, ours);
    // Normalize: both parsed vs both erred vs mixed
    const orSide = or.verdict === 'ok' ? 'ok' : or.verdict === 'wrong' ? 'parsed-wrong' : or.verdict;
    const usSide = oursV;
    if (orSide !== usSide) {
      const orDesc = or.verdict === 'ok' ? `${or.tipCount}t` : (or.note ?? '').slice(0, 60);
      const usDesc = ours.verdict === 'parsed' ? `${ours.tipCount}t` : (ours.note ?? '').slice(0, 60);
      console.log(`  ${f.id.padEnd(idWidth)}  DendroPy=${orSide} (${orDesc})  ours=${usSide} (${usDesc})`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
