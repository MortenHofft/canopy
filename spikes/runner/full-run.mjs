#!/usr/bin/env node
// Sequential full re-run of all candidates (one at a time, idle machine, production builds), writing
// spikes/results/FINAL.json. Usage: node spikes/runner/full-run.mjs [candidate ...]   (default: all, in order)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { SPIKES_DIR, RESULTS_DIR, sleep } from './lib/util.mjs';

const ALL = ['stub', 'custom', 'react-bio-viz', 'phylotree-js', 'tbrowse', 'phylocanvas-gl', 'archaeopteryx-js'];
const list = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const TREES = 'smoke,ladder,worst,cols,align,dated';
const finalFile = path.join(RESULTS_DIR, 'FINAL.json');
const FINAL = fs.existsSync(finalFile) ? JSON.parse(fs.readFileSync(finalFile, 'utf8')) : { generated: null, candidates: {} };
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

for (const name of list) {
  const dir = path.join(SPIKES_DIR, name);
  log(`=== ${name}: build`);
  const b = spawnSync('npm', ['run', 'build'], { cwd: dir, encoding: 'utf8' });
  if (b.status !== 0) {
    log(`build failed: ${(b.stdout + b.stderr).slice(-400)}`);
    FINAL.candidates[name] = { runIds: [], error: 'build failed' };
    continue;
  }
  for (let i = 0; i < 40 && os.loadavg()[0] > 1.0; i++) await sleep(6000); // let the previous browser's load decay
  log(`${name}: load ${os.loadavg()[0].toFixed(2)}, starting run`);
  const t0 = Date.now();
  const out = await new Promise((resolve) => {
    let buf = '';
    const c = spawn('node', [path.join(SPIKES_DIR, 'runner/run.mjs'), '--candidate', name, '--no-build', '--trees', TREES, '--skip-large', '--max-minutes', '40', '--label', 'final-' + new Date().toISOString().slice(0, 10)], { cwd: SPIKES_DIR });
    c.stdout.on('data', (d) => {
      buf += d;
      process.stdout.write(d);
    });
    c.stderr.on('data', (d) => process.stderr.write(d));
    c.on('exit', (code) => resolve({ code, buf }));
  });
  const m = /wrote [^\n]*\/(\d{8}-\d{6})\.json/.exec(out.buf);
  FINAL.candidates[name] = { runIds: m ? [m[1]] : [], exitCode: out.code, minutes: +((Date.now() - t0) / 60000).toFixed(1), order: 'one candidate at a time, idle machine, production build' };
  FINAL.generated = new Date().toISOString();
  fs.writeFileSync(finalFile, JSON.stringify(FINAL, null, 1) + '\n');
  log(`${name}: done in ${FINAL.candidates[name].minutes} min, run ${m?.[1] ?? 'NONE'}`);
}
log('all done');
