// Timing benchmark: every parser × every real/synthetic fixture.
//
// Each (parser, fixture) runs in a child Node process so we can kill it on wall-clock timeout
// (synchronous parses are otherwise impossible to interrupt). The child does 1 warmup + N timed
// iterations, prints a single JSON line, and exits. The parent collects, formats, and prints.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PARSERS, PARSER_IDS } from './parsers.mjs';
import { BENCH_FIXTURES, loadFixture } from './fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const WORKER = resolve(here, 'bench-worker.mjs');

const COLORS = { reset: '\x1b[0m', dim: '\x1b[2m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', bold: '\x1b[1m' };

const ITERATIONS = Number(process.env.ITER ?? 5);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 15000);

function runWorker(parserId, fixtureId) {
  return new Promise((resolveP) => {
    const req = JSON.stringify({ parserId, fixtureId, iterations: ITERATIONS });
    const child = spawn(process.execPath,
      ['--conditions=@gbif-phylo/source', '--experimental-transform-types', '--no-warnings', WORKER, req],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      try { child.kill('SIGKILL'); } catch {}
    }, TIMEOUT_MS);
    child.stdout.on('data', (b) => { out += b.toString(); });
    child.stderr.on('data', (b) => { err += b.toString(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) return resolveP({ timedOut: true });
      if (code !== 0) return resolveP({ error: `exit ${code}: ${err.slice(0, 80)}` });
      try {
        const line = out.trim().split('\n').pop();
        resolveP(JSON.parse(line));
      } catch {
        resolveP({ error: `bad output: ${out.slice(0, 80)}` });
      }
    });
  });
}

function stats(ms) {
  const s = [...ms].sort((a, b) => a - b);
  return { min: s[0], max: s[s.length - 1], median: s[Math.floor(s.length / 2)] };
}
function fmt(ms) {
  if (ms < 1) return (ms * 1000).toFixed(0) + 'us';
  if (ms < 100) return ms.toFixed(1) + 'ms';
  return ms.toFixed(0) + 'ms';
}
function fmtTips(tps) {
  if (tps > 1e6) return (tps / 1e6).toFixed(1) + 'M';
  if (tps > 1e3) return (tps / 1e3).toFixed(0) + 'k';
  return tps.toFixed(0);
}
function fmtMB(bytes) { return (bytes / 1024 / 1024).toFixed(2) + 'MB'; }

async function main() {
  console.log(`${COLORS.cyan}${COLORS.bold}Parser timing benchmark${COLORS.reset}`);
  console.log(`iterations: ${ITERATIONS}  per-pair timeout: ${TIMEOUT_MS}ms`);
  console.log('');

  const idWidth = Math.max(...BENCH_FIXTURES.map((f) => f.id.length));
  const sizeWidth = 10;
  const tipsWidth = 7;
  const cellWidth = 24;

  const header =
    'FIXTURE'.padEnd(idWidth) + '  ' +
    'SIZE'.padStart(sizeWidth) + '  ' +
    'TIPS'.padStart(tipsWidth) + '  ' +
    PARSER_IDS.map((p) => PARSERS[p].name.padStart(cellWidth)).join('');
  console.log(header);
  console.log('-'.repeat(header.length));

  const results = {}; // fixtureId -> parserId -> result

  for (const f of BENCH_FIXTURES) {
    let bytes = 0;
    try { bytes = Buffer.byteLength(loadFixture(f), 'utf8'); }
    catch (e) { console.log(`${f.id}: load failed: ${e.message}`); continue; }

    results[f.id] = {};
    const row = [];
    let tipCount = '?';
    for (const pid of PARSER_IDS) {
      const parser = PARSERS[pid];
      if (f.kind === 'nexus' && !parser.nexus) {
        results[f.id][pid] = { skipped: true };
        row.push(`${COLORS.dim}skip${COLORS.reset}`.padStart(cellWidth + 9));
        continue;
      }
      const r = await runWorker(pid, f.id);
      results[f.id][pid] = { ...r, bytes };
      if (r.error) {
        row.push(`${COLORS.red}ERR${COLORS.reset} ${r.error.slice(0, cellWidth - 5)}`.padStart(cellWidth + 9));
      } else if (r.timedOut) {
        row.push(`${COLORS.red}SLOW >${TIMEOUT_MS / 1000}s${COLORS.reset}`.padStart(cellWidth + 9));
      } else {
        const s = stats(r.times);
        const tps = (r.tipCount / s.median) * 1000;
        const mbs = (bytes / s.median) * 1000 / 1024 / 1024;
        row.push(`${fmt(s.median).padStart(7)} ${fmtTips(tps).padStart(5)}t/s ${mbs.toFixed(1).padStart(4)}MB/s`.padStart(cellWidth));
        if (tipCount === '?') tipCount = r.tipCount;
      }
    }
    console.log(
      f.id.padEnd(idWidth) + '  ' +
      fmtMB(bytes).padStart(sizeWidth) + '  ' +
      String(tipCount).padStart(tipsWidth) + '  ' +
      row.join('')
    );
  }

  // Speedup summary
  console.log('');
  console.log(`${COLORS.cyan}Speed ratio vs gbif-phylo/io  (>1.0 = we are faster)${COLORS.reset}`);
  const otherIds = PARSER_IDS.filter((p) => p !== 'ours');
  console.log('FIXTURE'.padEnd(idWidth) + '  ' + otherIds.map((p) => PARSERS[p].name.padStart(16)).join(''));
  console.log('-'.repeat(idWidth + 2 + otherIds.length * 16));
  const ratios = {};
  for (const f of BENCH_FIXTURES) {
    const ours = results[f.id]?.ours;
    if (!ours || ours.error || ours.timedOut || ours.skipped) continue;
    const ourMedian = stats(ours.times).median;
    const row = otherIds.map((pid) => {
      const r = results[f.id][pid];
      if (!r || r.error || r.skipped) return 'n/a'.padStart(16);
      if (r.timedOut) return `${COLORS.red}SLOW${COLORS.reset}`.padStart(16 + 9);
      const ratio = stats(r.times).median / ourMedian;
      if (!ratios[pid]) ratios[pid] = [];
      ratios[pid].push(ratio);
      const col = ratio > 1.5 ? 'green' : ratio < 0.75 ? 'red' : 'yellow';
      return `${COLORS[col]}${ratio.toFixed(2)}x${COLORS.reset}`.padStart(16 + 9);
    });
    console.log(f.id.padEnd(idWidth) + '  ' + row.join(''));
  }

  console.log('');
  console.log(`${COLORS.cyan}Geometric mean speedup (per fixture)${COLORS.reset}`);
  for (const pid of otherIds) {
    const rs = ratios[pid];
    if (!rs || rs.length === 0) continue;
    const gm = Math.exp(rs.reduce((a, b) => a + Math.log(b), 0) / rs.length);
    const col = gm > 1.5 ? 'green' : gm < 0.75 ? 'red' : 'yellow';
    console.log(`  ${PARSERS[pid].name.padEnd(18)} ${COLORS[col]}${gm.toFixed(2)}x${COLORS.reset} vs ours (n=${rs.length} fixtures where both finished)`);
  }

  if (process.env.OUT) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(process.env.OUT, JSON.stringify({ fixtures: BENCH_FIXTURES, results }, null, 2));
    console.log(`\nWrote ${process.env.OUT}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
