#!/usr/bin/env node
// Spike runner: node spikes/runner/run.mjs --candidate <name> [--scenarios S1,S2|all] [--trees smoke|ladder|worst|real|cols|align|dated|edge|<ids>]
//                                          [--port N] [--no-build] [--out dir]
// See spikes/README.md and spikes/CONTRACT.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, SPIKES_DIR, RESULTS_DIR, runId, freePort, withTimeout, TimeoutError, fmt, sleep } from './lib/util.mjs';
import { build, bundleSize, startPreview } from './lib/server.mjs';
import { Browser } from './lib/session.mjs';
import { shrinkPng } from './lib/pixels.mjs';
import { catalogue, getEntry, treesInGroup, dataExists } from './lib/truth.mjs';
import { makeScenarios, SCENARIO_TITLES } from './lib/scenarios.mjs';

const ALL = Array.from({ length: 15 }, (_, i) => `S${i + 1}`);
const GROUPS = ['smoke', 'ladder', 'worst', 'real', 'cols', 'align', 'dated', 'edge'];

function usage() {
  console.log(`usage: node spikes/runner/run.mjs --candidate <name> [--scenarios S1,S2|all] [--trees smoke|ladder|worst|real|cols|align|dated|edge|<tree ids>]
                                     [--port N] [--no-build] [--out dir] [--functional-tree <id>]
  --trees selects the trees for S1 (scale table) and S10; the other scenarios use fixed trees (see README).
  tree ids: ${catalogue.map((t) => t.id).join(', ')}`);
}

const args = parseArgs(process.argv.slice(2));
if (!args.candidate || args.help) {
  usage();
  process.exit(args.help ? 0 : 2);
}
const name = String(args.candidate);
const dir = path.join(SPIKES_DIR, name);
if (!fs.existsSync(path.join(dir, 'package.json'))) {
  console.error(`no candidate at ${dir} (expected spikes/${name}/package.json)`);
  process.exit(2);
}
if (!fs.existsSync(path.join(dir, 'node_modules'))) {
  console.error(`${dir}/node_modules is missing: run "npm ci --ignore-scripts" (or npm install --ignore-scripts) there first`);
  process.exit(2);
}

const scenarioIds = args.scenarios && args.scenarios !== 'all' ? String(args.scenarios).split(',').map((s) => s.trim().toUpperCase()) : ALL;
for (const s of scenarioIds) if (!ALL.includes(s)) {
  console.error(`unknown scenario ${s}`);
  process.exit(2);
}
// trees
const treeSpec = String(args.trees || 'smoke').split(',').map((x) => x.trim()).filter(Boolean);
const scaleTrees = [];
for (const x of treeSpec) {
  const list = GROUPS.includes(x) ? treesInGroup(x) : [getEntry(x)];
  for (const e of list) if (!scaleTrees.some((y) => y.id === e.id)) scaleTrees.push(e);
}
scaleTrees.sort((a, b) => a.tips - b.tips);
const missingData = scaleTrees.filter((e) => !dataExists(e.path));
if (missingData.length) console.warn(`warning: data files missing, these trees will fail: ${missingData.map((e) => e.id).join(', ')} (see data/README.md)`);

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const id = runId();
const outRoot = args.out ? path.resolve(String(args.out)) : path.join(RESULTS_DIR, name);
const screensDir = path.join(outRoot, 'screens');
fs.mkdirSync(screensDir, { recursive: true });
const screens = [];
const saveShot = (label, buf) => {
  if (screens.length >= 12) return;
  try {
    const out = shrinkPng(buf, 140 * 1024);
    const file = `${id}-${label.replace(/[^A-Za-z0-9_.-]/g, '_')}.png`;
    fs.writeFileSync(path.join(screensDir, file), out);
    screens.push({ label, file: `screens/${file}`, bytes: out.length });
  } catch (e) {
    log(`screenshot ${label} failed: ${e.message}`);
  }
};

const started = Date.now();
if (!args['no-build']) build(dir, log);
const bundle = bundleSize(dir);
if (!bundle) {
  console.error(`no dist/ in ${dir}; build first or drop --no-build`);
  process.exit(2);
}
const port = args.port ? Number(args.port) : await freePort();
const server = await startPreview(dir, port, log);
const browser = new Browser(server.url, log);
let exitCode = 0;
try {
  await browser.launch();
  log(`Chromium ${browser.version}`);
  // candidate facts
  let info = { candidate: { name, version: '?', license: '?' }, capabilities: {} };
  try {
    info = await browser.withSession('info', async (s) => ({ candidate: await s.page.evaluate(() => ({ name: window.__spike.candidate.name, version: window.__spike.candidate.version, license: window.__spike.candidate.license, notes: window.__spike.candidate.notes })), capabilities: await s.call('getCapabilities') }), 60000);
  } catch (e) {
    log(`could not read candidate info: ${e.message}`);
  }
  log(`candidate ${info.candidate.name} ${info.candidate.version} (${info.candidate.license}); scenarios ${scenarioIds.join(',')}; scale trees ${scaleTrees.map((t) => t.id).join(',')}`);

  const opts = { scaleTrees, functionalTree: args['functional-tree'] };
  const S = makeScenarios({ browser, opts, saveShot, log });
  const scenarios = {};
  for (const sid of scenarioIds) {
    const t0 = Date.now();
    log(`${sid} ${SCENARIO_TITLES[sid]}`);
    let r;
    try {
      r = await withTimeout(S[sid](), sid === 'S1' ? 3 * 3600e3 : 600e3, sid);
    } catch (e) {
      r = { status: e instanceof TimeoutError ? 'timeout' : 'fail', reason: `${e instanceof TimeoutError ? '' : 'runner/candidate error: '}${String(e.message).split('\n')[0]}` };
    }
    r.title = SCENARIO_TITLES[sid];
    r.evidence = 'M';
    r.durationSec = (Date.now() - t0) / 1000;
    scenarios[sid] = r;
    log(`${sid} -> ${r.status}: ${r.reason}`);
    if (r.status === 'timeout' || /closed|crash|Target/i.test(r.reason ?? '')) {
      // make sure the next scenario starts with a healthy browser
      try {
        await withTimeout(browser.browser.newContext().then((c) => c.close()), 8000, 'browser health check');
      } catch {
        await browser.restart();
      }
    }
  }
  const scale = scenarios.S1?.trees ?? {};
  const run = {
    runId: id,
    candidate: info.candidate,
    capabilities: info.capabilities,
    date: new Date().toISOString(),
    chromium: browser.version,
    chromiumArgs: (await import('./lib/session.mjs')).CHROMIUM_ARGS,
    machine: { platform: `${os.platform()} ${os.release()}`, cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, memGB: Math.round(os.totalmem() / 2 ** 30), gpu: false },
    caveat: 'Headless Chromium without a GPU (SwiftShader software rendering): absolute FPS for canvas and WebGL candidates is pessimistic; use for functional tests and relative comparison. Final scale numbers need a real browser on a normal laptop.',
    thresholds: { loadMs: 10000, p5Fps: 20, clickMs: 300 },
    selection: { scenarios: scenarioIds, scaleTrees: scaleTrees.map((t) => t.id) },
    bundle,
    scenarios,
    scale,
    screenshots: screens,
    wallSec: (Date.now() - started) / 1000,
    runner: { version: '0.1.0', node: process.version },
  };
  fs.mkdirSync(outRoot, { recursive: true });
  const file = path.join(outRoot, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(run, null, 1) + '\n');
  log(`wrote ${path.relative(process.cwd(), file)} (${screens.length} screenshots)`);
  console.log('\n' + scenarioIds.map((sid) => `${sid.padEnd(4)} ${scenarios[sid].status.padEnd(12)} ${scenarios[sid].reason}`.slice(0, 220)).join('\n'));
  if (Object.values(scenarios).some((r) => r.status === 'fail')) exitCode = 1;
} catch (e) {
  console.error(e);
  exitCode = 3;
} finally {
  await browser.close();
  await server.stop();
}
process.exit(exitCode);
