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
];
let bad = 0;
for (const c of cases) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spike-selftest-'));
  const env = { ...process.env, ...(c.fault ? { SPIKE_QUERY: `fault=${c.fault}` } : {}) };
  const r = spawnSync('node', [path.join(SPIKES_DIR, 'runner/run.mjs'), '--candidate', 'stub', '--no-build', '--no-calibration', '--scenarios', c.scenario, '--trees', 'syn-yule-200', '--out', out], { env, encoding: 'utf8' });
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
  fs.rmSync(out, { recursive: true, force: true });
}
console.log(bad ? `${bad} selftest problem(s)` : 'selftest ok: every injected fault was flagged and the clean stub passes');
process.exit(bad ? 1 : 0);
