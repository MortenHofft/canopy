#!/usr/bin/env node
// node spikes/runner/report.mjs: reads spikes/results/<candidate>/*.json, takes for every scenario (and every
// S1 tree) the latest run that contains it, prints a markdown summary and writes spikes/results/SUMMARY.md.
import fs from 'node:fs';
import path from 'node:path';
import { RESULTS_DIR, fmt } from './lib/util.mjs';

const SC = Array.from({ length: 15 }, (_, i) => `S${i + 1}`);
const LABEL = { pass: 'pass', partial: 'partial', fail: 'FAIL', unsupported: 'unsupported', timeout: 'TIMEOUT' };
const cell = (r) => (r ? LABEL[r.status] ?? r.status : '-');

const candidates = [];
if (fs.existsSync(RESULTS_DIR)) {
  for (const d of fs.readdirSync(RESULTS_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const runs = fs
      .readdirSync(path.join(RESULTS_DIR, d.name))
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, d.name, f), 'utf8')));
    if (runs.length) candidates.push({ name: d.name, runs });
  }
}

for (const c of candidates) {
  c.scenarios = {};
  c.scenarioRun = {};
  c.scale = {};
  c.scaleRun = {};
  for (const run of c.runs) {
    for (const [sid, r] of Object.entries(run.scenarios ?? {})) {
      if (sid === 'S1') continue;
      c.scenarios[sid] = r;
      c.scenarioRun[sid] = run.runId;
    }
    for (const [tid, r] of Object.entries(run.scale ?? {})) {
      c.scale[tid] = r;
      c.scaleRun[tid] = run.runId;
    }
  }
  // S1 aggregate over all merged trees
  const rows = Object.values(c.scale);
  if (rows.length) {
    const pass = rows.filter((r) => r.status === 'pass').length;
    const status = pass === rows.length ? 'pass' : pass > 0 ? 'partial' : rows.some((r) => r.status === 'fail') ? 'fail' : rows.some((r) => r.status === 'timeout') ? 'timeout' : 'partial';
    c.scenarios.S1 = { status, reason: rows.filter((r) => r.status !== 'pass').map((r) => `${r.treeId}: ${r.status} (${r.reason})`).join('; ') || `${rows.length} trees ok` };
  }
  c.last = c.runs[c.runs.length - 1];
}

const out = [];
out.push('# Spike results summary', '');
out.push(`Generated ${new Date().toISOString()} by \`node spikes/runner/report.mjs\` from \`spikes/results/*/*.json\`. For every scenario (and every S1 tree) the latest run that contains it is used. All numbers are **M** (measured) in headless Chromium **without a GPU** (SwiftShader), so canvas and WebGL FPS are pessimistic; get final scale numbers on a real laptop.`, '');
if (!candidates.length) out.push('No results yet. Run `node spikes/runner/run.mjs --candidate stub`.');
else {
  out.push('## Scenario matrix', '');
  out.push(`| Candidate | ${SC.join(' | ')} |`, `|---|${SC.map(() => '---').join('|')}|`);
  for (const c of candidates) out.push(`| ${c.name} ${c.last.candidate?.version ?? ''} | ${SC.map((s) => cell(c.scenarios[s])).join(' | ')} |`);
  out.push('', 'pass = all checks passed; partial = works with a workaround or only some checks pass; FAIL = checks failed; unsupported = adapter reports `no`; TIMEOUT = threshold exceeded (load > 10 s, p5 FPS < 20, click latency > 300 ms) or the scenario hung; `-` = not run. Titles: ' + SC.map((s) => `${s} ${c0title(s)}`).join('; ') + '.', '');

  out.push('## Scale table (S1)', '');
  out.push('| Candidate | Tree | Tips | Fetch ms | Parse ms | First render ms | Median fps | p5 fps | Click ms | Heap MB | Status |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const c of candidates) {
    const rows = Object.values(c.scale).sort((a, b) => a.tips - b.tips);
    if (!rows.length) out.push(`| ${c.name} | (S1 not run) | | | | | | | | | - |`);
    for (const r of rows) out.push(`| ${c.name} | ${r.treeId} | ${r.tips} | ${fmt(r.fetchMs)} | ${fmt(r.parseMs)} | ${fmt(r.firstRenderMs)} | ${fmt(r.fpsMedian, 1)} | ${fmt(r.fpsP5, 1)} | ${fmt(r.clickLatencyMs)} | ${fmt(r.heapMB, 0)} | ${LABEL[r.status] ?? r.status}${r.status === 'pass' ? '' : ' (' + String(r.reason).slice(0, 90) + ')'} |`);
  }
  out.push('', 'Parse ms is what the candidate reports (the stub reports 0 and uses the shared parser; see `sharedParseMs` in the JSON). First render ms is from handing the input to the adapter to two animation frames after it reports ready.', '');

  out.push('## Details', '');
  for (const c of candidates) {
    out.push(`### ${c.name} ${c.last.candidate?.version ?? ''} (${c.last.candidate?.license ?? '?'})`, '');
    out.push(`- Runs: ${[...new Set([...Object.values(c.scenarioRun), ...Object.values(c.scaleRun)])].sort().join(', ')}; Chromium ${c.last.chromium}; GPU: ${c.last.machine?.gpu ? 'yes' : 'no'}.`);
    const b = c.last.bundle;
    if (b) out.push(`- Bundle (dist/, minified): JS ${fmt(b.jsBytes / 1024)} KB (${fmt(b.jsGzipBytes / 1024)} KB gzip), CSS ${fmt(b.cssBytes / 1024)} KB (${fmt(b.cssGzipBytes / 1024)} KB gzip), total ${fmt(b.totalBytes / 1024)} KB (${fmt(b.totalGzipBytes / 1024)} KB gzip). Includes the shared shell and React.`);
    for (const s of SC) {
      const r = c.scenarios[s];
      if (r && r.status !== 'pass') out.push(`- **${s} ${cell(r)}**: ${String(r.reason).slice(0, 600)}`);
    }
    out.push('');
  }
}
function c0title(s) {
  const t = candidates.flatMap((c) => c.runs).map((r) => r.scenarios?.[s]?.title).find(Boolean);
  return t ?? '';
}
const text = out.join('\n') + '\n';
fs.mkdirSync(RESULTS_DIR, { recursive: true });
fs.writeFileSync(path.join(RESULTS_DIR, 'SUMMARY.md'), text);
console.log(text);
