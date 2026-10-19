#!/usr/bin/env node
// Runner self-test by fault injection: the stub (with ?fault=<x>, see stub/src/adapter.tsx) must pass the relevant
// scenario without a fault and be flagged with it. Usage: node spikes/runner/selftest.mjs   (needs stub/dist built)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SPIKES_DIR } from './lib/util.mjs';

const cases = [
  { fault: null, scenario: 'S2,S3,S4,S6,S7,S8,S10,S11,S14', expect: { S2: ['pass'], S3: ['pass'], S4: ['pass'], S6: ['pass'], S7: ['pass'], S8: ['pass'], S10: ['pass', 'partial'], S11: ['pass'], S14: ['pass'] } },
  { fault: 'colour', scenario: 'S4', expect: { S4: ['fail'] } },
  { fault: 'align', scenario: 'S7', expect: { S7: ['fail', 'partial'] } },
  { fault: 'link', scenario: 'S6', expect: { S6: ['fail'] } },
  { fault: 'keyboard', scenario: 'S14', expect: { S14: ['fail', 'partial'] } },
  { fault: 'tips', scenario: 'S3', expect: { S3: ['fail', 'partial'] } },
  { fault: 'wheel', scenario: 'S10', expect: { S10: ['n/a'] } },
  // S15: click-to-paint must be measured on the same clock, after the commit, never negative
  { fault: null, scenario: 'S15', expect: { S15: ['pass', 'partial'] }, check: (run) => { const m = run.scenarios.S15.measures; return m.medianPaintMs >= m.medianCommitMs && m.medianCommitMs >= 0 ? null : `paint ${m.medianPaintMs} vs commit ${m.medianCommitMs}`; } },
  // a small --max-minutes must still measure something in S1 (it used to skip every tree below 9 minutes)
  { fault: null, scenario: 'S1', extra: ['--max-minutes', '3'], expect: { S1: ['pass', 'partial'] }, check: (run) => (Object.values(run.scale).some((r) => r.status !== 'skipped') ? null : 'every tree skipped') },
];
let bad = 0;
for (const c of cases) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spike-selftest-'));
  const env = { ...process.env, ...(c.fault ? { SPIKE_QUERY: `fault=${c.fault}` } : {}) };
  const r = spawnSync('node', [path.join(SPIKES_DIR, 'runner/run.mjs'), '--candidate', 'stub', '--no-build', '--no-calibration', '--scenarios', c.scenario, '--trees', 'syn-yule-200', '--out', out, ...(c.extra ?? [])], { env, encoding: 'utf8' });
  const f = fs.readdirSync(out).find((x) => x.endsWith('.json'));
  if (!f) {
    console.log(`ERROR  fault=${c.fault}: no result\n${r.stdout.slice(-500)}${r.stderr.slice(-500)}`);
    bad++;
    continue;
  }
  const run = JSON.parse(fs.readFileSync(path.join(out, f), 'utf8'));
  for (const [sid, ok] of Object.entries(c.expect)) {
    const st = run.scenarios[sid]?.status;
    const good = ok.includes(st);
    if (!good) bad++;
    console.log(`${good ? 'ok   ' : 'WRONG'}  fault=${String(c.fault).padEnd(8)} ${sid.padEnd(4)} -> ${st} (expected ${ok.join(' or ')})  ${good ? '' : run.scenarios[sid]?.reason?.slice(0, 160)}`);
  }
  if (c.check) {
    const err = c.check(run);
    if (err) bad++;
    console.log(`${err ? 'WRONG' : 'ok   '}  check ${c.scenario} ${c.extra ? c.extra.join(' ') : ''} ${err ?? ''}`);
  }
  fs.rmSync(out, { recursive: true, force: true });
}
console.log(bad ? `${bad} selftest problem(s)` : 'selftest ok: every injected fault was flagged and the clean stub passes');
process.exit(bad ? 1 : 0);
