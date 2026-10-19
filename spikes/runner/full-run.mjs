#!/usr/bin/env node
// Sequential full re-run of all candidates (one at a time, idle machine, production builds), writing
// spikes/results/FINAL.json. Usage: node spikes/runner/full-run.mjs [candidate ...]   (default: all, in order)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { SPIKES_DIR, RESULTS_DIR, sleep } from './lib/util.mjs';

const ALL = ['stub', 'custom', 'react-bio-viz', 'phylotree-js', 'tbrowse', 'phylocanvas-gl', 'archaeopteryx-js', 'taxonium', 'reactree', 'heat-tree'];
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
  // 1M-tip step: only for candidates that mounted the 100k Yule tree within the 10 s load limit
  if (m) {
    try {
      const run = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, name, m[1] + '.json'), 'utf8'));
      const r100 = run.scale?.['syn-yule-100000'];
      const have = fs.existsSync(path.join(SPIKES_DIR, '..', 'data', 'synthetic', 'newick', 'yule_1000000.nwk'));
      if (have && r100 && r100.status !== 'skipped' && r100.loadMs && r100.loadMs <= 10000) {
        for (let i = 0; i < 40 && os.loadavg()[0] > 1.0; i++) await sleep(6000);
        log(`${name}: mounted 100k in ${Math.round(r100.loadMs)} ms, running S1 on the 1M-tip tree`);
        const out2 = await new Promise((resolve) => {
          let buf = '';
          const c = spawn('node', [path.join(SPIKES_DIR, 'runner/run.mjs'), '--candidate', name, '--no-build', '--scenarios', 'S1', '--trees', 'syn-yule-1000000', '--label', 'final-1m-' + new Date().toISOString().slice(0, 10)], { cwd: SPIKES_DIR });
          c.stdout.on('data', (d) => {
            buf += d;
            process.stdout.write(d);
          });
          c.stderr.on('data', (d) => process.stderr.write(d));
          c.on('exit', (code) => resolve({ code, buf }));
        });
        const m2 = /wrote [^\n]*\/(\d{8}-\d{6})\.json/.exec(out2.buf);
        if (m2) FINAL.candidates[name] = { ...(FINAL.candidates[name] ?? {}), runIds: [m[1], m2[1]], note1m: `${m2[1]} is S1 on the 1M-tip Yule tree only` };
      } else FINAL.candidates[name] = { ...(FINAL.candidates[name] ?? {}), note1m: `1M-tip tree not run: ${!have ? 'file missing' : !r100 || r100.status === 'skipped' ? '100k not run' : 'the 100k tree needed ' + Math.round(r100.loadMs ?? 0) + ' ms to mount (limit 10 s)'}` };
    } catch (e) {
      log(`1M step failed: ${e.message}`);
    }
  }
  FINAL.candidates[name] = { ...FINAL.candidates[name], runIds: FINAL.candidates[name].runIds ?? (m ? [m[1]] : []) };
  FINAL.generated = new Date().toISOString();
  fs.writeFileSync(finalFile, JSON.stringify(FINAL, null, 1) + '\n');
  log(`${name}: done in ${FINAL.candidates[name].minutes} min, run ${m?.[1] ?? 'NONE'}`);
}
log('all done');
