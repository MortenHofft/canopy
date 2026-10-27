#!/usr/bin/env node
// Open a dataset in the page, in headless Chromium, over the range server with a network profile, and time what a person does:
//   first view   the page loads and the first frame is drawn (the manifest and the overview)
//   colour       "Colour by country": the whole column is read and the tree is coloured
//   zoom         zoom into the biggest stub: the viewer opens it (a clade is read from nodes.parquet)
//   inspect      click a tip: its label, its sidecar row and its sequence (cold: the footers of those files are read too)
//   inspect2     a tip in another row group (the footers are known now)
// Every step reports milliseconds, HTTP requests and bytes received. Sizes of the files, the JS heap and the viewer's frame time come with it.
//
//   node scripts/bench.mjs --data ../../data/parquet/t100k [--profile wifi,4g] [--repeat 3] [--cpu 1] [--out result.json]
//     --data DIR       a dataset made by generate.mjs (its folder name is the dataset's URL name)
//     --profile LIST   none | wifi (20 ms, 30 Mbit/s) | 4g (150 ms, 9 Mbit/s) | 3g (300 ms, 1.6 Mbit/s); default none,4g
//     --repeat N       runs per profile; the median is reported (default 3)
//     --page-params S  extra query string for the page, e.g. gap=131072&plan=0&budget=2000
//     --rebuild        build the page first (also when dist/ is missing)
// The numbers are for headless Chromium on this machine with the CPU canvas (no GPU), a simulated network and a local disk: use them to
// compare layouts and sizes with each other, not as absolute figures for a phone.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const require = createRequire(import.meta.url);

export const PROFILES = {
  none: { latency: 0, mbps: 0 },
  wifi: { latency: 20, mbps: 30 },
  '4g': { latency: 150, mbps: 9 },
  '3g': { latency: 300, mbps: 1.6 },
};

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  for (const p of ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'])
    if (fs.existsSync(p)) return p;
  return undefined; // Playwright's own browser
}

export function buildPage() {
  const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
  const r = spawnSync(process.execPath, [vite, 'build'], { cwd: pkg, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('vite build failed');
}

const median = (a) => {
  const s = a.filter((x) => x !== undefined).sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : undefined;
};

/** One run: a fresh browser page, one profile. Returns the numbers of each step. */
async function runOnce(browser, server, name, profile, pageParams) {
  Object.assign(server.cfg, PROFILES[profile], { only: [`/${name}/`] }); // the page itself is not slowed, only the dataset
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const origin = server.url;
  await page.goto(`${origin}/index.html?url=${origin}/${name}&cpu=1${pageParams ? '&' + pageParams : ''}`);
  await page.waitForFunction(() => window.__parquet?.viewer.getStats().frames > 0, null, { timeout: 120000 });
  const first = await page.evaluate(() => ({
    ms: performance.now(),
    requests: window.__parquet.ds.stats.requests,
    bytes: window.__parquet.ds.stats.bytes,
  }));
  const colour = await page.evaluate(() => window.__parquet.colourBy('country'));
  // zoom into the biggest stub, wait until a clade has been read and a frame drawn
  const zoom = await page.evaluate(async () => {
    const { source, viewer, ds } = window.__parquet;
    const s = source.snapshot();
    let best = -1;
    let size = 0;
    for (let i = 0; i < s.nodeCount; i++) if (s.stub[i] && s.leafEnd[i] - s.leafStart[i] > size) [best, size] = [i, s.leafEnd[i] - s.leafStart[i]];
    const r0 = ds.stats.requests;
    const b0 = ds.stats.bytes;
    const t0 = performance.now();
    viewer.zoomToNode(s.globalId[best], false);
    while (source.stats.loadedClades < 1 && performance.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return {
      ms: performance.now() - t0,
      requests: ds.stats.requests - r0,
      bytes: ds.stats.bytes - b0,
      stubTips: size,
      loaded: source.stats.loadedClades,
    };
  });
  const tips = await page.evaluate(() => window.__parquet.ds.man.tips);
  const inspect = await page.evaluate((r) => window.__parquet.inspect(r), Math.floor(tips * 0.37));
  const inspect2 = await page.evaluate((r) => window.__parquet.inspect(r), Math.floor(tips * 0.81));
  const end = await page.evaluate(() => {
    if (typeof globalThis.gc === 'function') globalThis.gc();
    const st = window.__parquet.viewer.getStats();
    return {
      heapMB: (performance.memory?.usedJSHeapSize ?? 0) / 1e6,
      frameMs: st.frameMs,
      requests: window.__parquet.ds.stats.requests,
      bytes: window.__parquet.ds.stats.bytes,
    };
  });
  await page.close();
  return { first, colour, zoom, inspect, inspect2, end, errors };
}

/**
 * @param {{ data: string, profiles?: string[], repeat?: number, pageParams?: string, rebuild?: boolean, serverRoots?: string[] }} o
 * @returns the manifest summary and, for each profile, the median of each step over the runs
 */
export async function runCase(o) {
  if (o.rebuild || !fs.existsSync(path.join(pkg, 'dist', 'index.html'))) buildPage();
  const dataDir = path.resolve(o.data);
  const name = path.basename(dataDir);
  const server = await startServer({ roots: [path.join(pkg, 'dist'), path.dirname(dataDir)] });
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({
    executablePath: chromiumPath(),
    args: ['--no-sandbox', '--enable-precise-memory-info', '--js-flags=--expose-gc'],
  });
  try {
    const man = JSON.parse(fs.readFileSync(path.join(dataDir, 'manifest.json'), 'utf8'));
    const out = {
      dataset: name,
      tips: man.tips,
      nodes: man.nodes,
      generator: man.generator,
      files: Object.fromEntries(Object.entries(man.files).map(([k, f]) => [k, { bytes: f.bytes, footer: f.footer, row_groups: f.row_groups }])),
      profiles: {},
    };
    for (const profile of o.profiles ?? ['none', '4g']) {
      const runs = [];
      for (let i = 0; i < (o.repeat ?? 3); i++) runs.push(await runOnce(browser, server, name, profile, o.pageParams));
      const med = (step, field) => median(runs.map((r) => r[step][field]));
      const steps = {};
      for (const step of ['first', 'colour', 'zoom', 'inspect', 'inspect2'])
        steps[step] = { ms: med(step, 'ms'), requests: med(step, 'requests'), bytes: med(step, 'bytes') };
      steps.end = { heapMB: med('end', 'heapMB'), frameMs: med('end', 'frameMs'), requests: med('end', 'requests'), bytes: med('end', 'bytes') };
      steps.errors = runs.flatMap((r) => r.errors);
      out.profiles[profile] = steps;
    }
    return out;
  } finally {
    await browser.close();
    await server.close();
  }
}

const fmtB = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(2)} MB` : `${(b / 1e3).toFixed(0)} KB`);
export function table(r) {
  const lines = [
    `dataset ${r.dataset}: ${r.tips.toLocaleString('en')} tips; files ${Object.entries(r.files)
      .map(([k, f]) => `${k} ${fmtB(f.bytes)}/${f.row_groups}rg`)
      .join(', ')}`,
    '',
  ];
  lines.push('| profile | first view | colour | zoom | inspect (cold) | inspect (warm) | heap |', '|---|---|---|---|---|---|---|');
  for (const [p, s] of Object.entries(r.profiles)) {
    const c = (x) => `${x.ms.toFixed(0)} ms, ${x.requests} req, ${fmtB(x.bytes)}`;
    lines.push(`| ${p} | ${c(s.first)} | ${c(s.colour)} | ${c(s.zoom)} | ${c(s.inspect)} | ${c(s.inspect2)} | ${s.end.heapMB.toFixed(0)} MB |`);
  }
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values: v } = parseArgs({
    options: {
      data: { type: 'string' },
      profile: { type: 'string' },
      repeat: { type: 'string' },
      'page-params': { type: 'string' },
      out: { type: 'string' },
      rebuild: { type: 'boolean' },
    },
  });
  if (!v.data) {
    console.error(
      'usage: node scripts/bench.mjs --data ../../data/parquet/t100k [--profile none,4g] [--repeat 3] [--page-params gap=131072] [--out result.json] [--rebuild]',
    );
    process.exit(2);
  }
  const r = await runCase({
    data: v.data,
    profiles: v.profile?.split(','),
    repeat: v.repeat ? +v.repeat : undefined,
    pageParams: v['page-params'],
    rebuild: v.rebuild,
  });
  console.log(table(r));
  if (v.out) fs.writeFileSync(v.out, JSON.stringify(r, null, 1));
}
