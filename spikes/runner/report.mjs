#!/usr/bin/env node
// node spikes/runner/report.mjs: reads spikes/results/<candidate>/*.json and prints a markdown summary (also written to
// spikes/results/SUMMARY.md). If spikes/results/FINAL.json exists ({candidates: {<name>: {runIds: [...]}}}) only those
// runs are used; otherwise, for every scenario (and every S1 tree) the latest run that contains it.
import fs from 'node:fs';
import path from 'node:path';
import { RESULTS_DIR, fmt } from './lib/util.mjs';

const SC = Array.from({ length: 15 }, (_, i) => `S${i + 1}`);
const LABEL = { pass: 'pass', partial: 'partial', fail: 'FAIL', unsupported: 'unsupported', timeout: 'TIMEOUT', 'n/a': 'n/a', skipped: 'skipped' };
const cell = (r) => (r ? LABEL[r.status] ?? r.status : '-');
const ORDER = ['stub', 'custom', 'react-bio-viz', 'phylotree-js', 'tbrowse', 'phylocanvas-gl', 'archaeopteryx-js'];

const finalFile = path.join(RESULTS_DIR, 'FINAL.json');
const FINAL = fs.existsSync(finalFile) ? JSON.parse(fs.readFileSync(finalFile, 'utf8')) : null;

const candidates = [];
if (fs.existsSync(RESULTS_DIR)) {
  for (const d of fs.readdirSync(RESULTS_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    let runs = fs
      .readdirSync(path.join(RESULTS_DIR, d.name))
      .filter((f) => /^\d{8}-\d{6}.*\.json$/.test(f))
      .sort()
      .map((f) => JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, d.name, f), 'utf8')));
    if (FINAL) {
      const ids = FINAL.candidates?.[d.name]?.runIds;
      runs = ids ? runs.filter((r) => ids.includes(r.runId)) : [];
    }
    if (runs.length) candidates.push({ name: d.name, runs });
  }
}
candidates.sort((a, b) => (ORDER.indexOf(a.name) + 100) % 100 - (ORDER.indexOf(b.name) + 100) % 100 || a.name.localeCompare(b.name));

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
      c.scale[tid] = { ...r, _load: run.load };
      c.scaleRun[tid] = run.runId;
    }
  }
  const rows = Object.values(c.scale).filter((r) => r.status !== 'skipped');
  if (rows.length) {
    const pass = rows.filter((r) => r.status === 'pass').length;
    const status = pass === rows.length ? 'pass' : pass > 0 ? 'partial' : rows.some((r) => r.status === 'fail') ? 'fail' : rows.some((r) => r.status === 'timeout') ? 'timeout' : 'partial';
    c.scenarios.S1 = { status, reason: rows.filter((r) => r.status !== 'pass').map((r) => `${r.treeId}: ${r.status} (${r.reason})`).join('; ') || `${rows.length} trees ok` };
  }
  c.last = c.runs[c.runs.length - 1];
  c.noisy = c.runs.some((r) => r.load?.noisy);
}

const out = [];
out.push('# Spike results summary', '');
out.push(`Generated ${new Date().toISOString()} by \`node spikes/runner/report.mjs\` from \`spikes/results/*/*.json\`${FINAL ? ' (runs listed in FINAL.json only)' : ' (latest run per scenario and tree)'}. All numbers are **M** (measured) in headless Chromium **without a GPU** (SwiftShader), 4 vCPU, one candidate at a time. Canvas and WebGL FPS are pessimistic; get final scale numbers on a real laptop.`, '');
if (!candidates.length) out.push('No results yet. Run `node spikes/runner/run.mjs --candidate stub`.');
else {
  out.push('## Scenario matrix', '');
  out.push(`| Candidate | ${SC.join(' | ')} |`, `|---|${SC.map(() => '---').join('|')}|`);
  for (const c of candidates) out.push(`| ${c.name} ${c.last.candidate?.version ?? ''}${c.noisy ? ' (noisy)' : ''} | ${SC.map((s) => cell(c.scenarios[s])).join(' | ')} |`);
  out.push('', 'pass = all checks passed; partial = works with a workaround, adapter-derived data, or only some checks pass; FAIL = checks failed; unsupported = adapter reports `no`; n/a = precondition not met (for example the plain wheel does not zoom, so S10 cannot be tested); TIMEOUT = unusable threshold exceeded or the scenario hung; skipped = not run (rule or time cap); `-` = not run. Scenario titles: ' + SC.map((s) => `${s} ${title(s)}`).join('; ') + '.', '');

  out.push('## Scale table (S1)', '');
  out.push('Judged on load time, the share of time in frames over 50 ms, main-thread CPU per interaction step and click latency (CONTRACT.md Clarifications 15), not on raw p5. Median fps is the median rAF rate during scripted wheel and drag (mostly idle frames, so about 60 unless the page freezes); p5 is the best of 3 rounds. "Rel fps" is the candidate\'s best p5 divided by the best p5 of the plain Canvas2D calibration page measured at the start of the same run (1.0 = as smooth as a trivial canvas under the same load). `*` marks rows measured with a 1-minute load average above 4.', '');
  out.push('| Candidate | Tree | Tips | Fetch ms | Parse ms | First render ms | Median fps | p5 fps (best of 3) | Rel fps | CPU ms/step | Click ms | Heap MB | Load | Status |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const c of candidates) {
    const rows = Object.values(c.scale).sort((a, b) => a.tips - b.tips || a.treeId.localeCompare(b.treeId));
    if (!rows.length) out.push(`| ${c.name} | (S1 not run) | | | | | | | | | | | | - |`);
    for (const r of rows) {
      const noisy = (r.loadAvgAtStart ?? 0) > 4 ? '*' : '';
      out.push(`| ${c.name} | ${r.treeId} | ${r.tips} | ${fmt(r.fetchMs)} | ${fmt(r.parseMs)} | ${fmt(r.firstRenderMs)} | ${fmt(r.fpsMedian, 1)} | ${fmt(r.fpsP5, 1)} | ${fmt(r.relP5Fps, 2)} | ${fmt(r.cpuMsPerStep)} | ${fmt(r.clickLatencyMs)} | ${fmt(r.heapMB, 0)} | ${fmt(r.loadAvgAtStart, 1)}${noisy} | ${LABEL[r.status] ?? r.status}${r.status === 'pass' ? '' : ' (' + String(r.reason).slice(0, 110) + ')'} |`);
    }
  }
  out.push('', 'Parse ms is what the candidate reports (adapters that use the shared parser report 0; see `sharedParseMs` in the JSON). First render ms is from handing the input to the adapter to two animation frames after it reports ready.', '');

  out.push('## Calibration and load', '');
  out.push('| Candidate | Run | Load start / end | Canvas ref: median fps, best p5, CPU ms/step | Stub at 200 tips: median fps, best p5, CPU ms/step | Noisy |', '|---|---|---|---|---|---|');
  for (const c of candidates)
    for (const r of c.runs) {
      const k = r.calibration?.canvas, s = r.calibration?.stub200;
      out.push(`| ${c.name} | ${r.runId} | ${fmt(r.load?.start, 1)} / ${fmt(r.load?.end, 1)} (max ${fmt(r.load?.max, 1)}) | ${k && !k.error ? `${fmt(k.fpsMedian, 1)}, ${fmt(k.fpsP5, 1)}, ${fmt(k.cpuMsPerStep, 1)}` : 'n/a'} | ${s && !s.error ? `${fmt(s.fpsMedian, 1)}, ${fmt(s.fpsP5, 1)}, ${fmt(s.cpuMsPerStep, 1)}` : 'n/a'} | ${r.load?.noisy ? 'yes' : 'no'} |`);
    }
  out.push('');

  out.push('## Details', '');
  for (const c of candidates) {
    out.push(`### ${c.name} ${c.last.candidate?.version ?? ''} (${c.last.candidate?.license ?? '?'})`, '');
    out.push(`- Runs: ${[...new Set([...Object.values(c.scenarioRun), ...Object.values(c.scaleRun)])].sort().join(', ')}; Chromium ${c.last.chromium}; GPU: ${c.last.machine?.gpu ? 'yes' : 'no'}.`);
    const b = c.last.bundle;
    if (b) out.push(`- Bundle (dist/, minified): JS ${fmt(b.jsBytes / 1024)} KB (${fmt(b.jsGzipBytes / 1024)} KB gzip), CSS ${fmt(b.cssBytes / 1024)} KB (${fmt(b.cssGzipBytes / 1024)} KB gzip), total ${fmt(b.totalBytes / 1024)} KB (${fmt(b.totalGzipBytes / 1024)} KB gzip). Includes the shared shell and React.`);
    for (const s of SC) {
      const r = c.scenarios[s];
      if (r && r.status !== 'pass') out.push(`- **${s} ${cell(r)}**: ${String(r.reason).slice(0, 700)}`);
    }
    out.push('');
  }
}
function title(s) {
  const t = candidates.flatMap((c) => c.runs).map((r) => r.scenarios?.[s]?.title).find(Boolean);
  return t ?? '';
}
const text = out.join('\n') + '\n';
fs.mkdirSync(RESULTS_DIR, { recursive: true });
fs.writeFileSync(path.join(RESULTS_DIR, 'SUMMARY.md'), text);
console.log(text);
