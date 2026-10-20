#!/usr/bin/env node
// Browser measurement harness: headless Chromium (Playwright) against the local Range server with network profiles.
//   SERVE=/path/to/serve node run-browser.mjs --trees yule100k,yule1M --profiles wifi,4g,3g,none --out results/browser-NAME.json [--reps 3]
// Starts two servers (data 5210 throttled, page 5310 unthrottled) and stops them at the end. Run niced, one at a time.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: A } = parseArgs({ options: { trees: { type: 'string' }, profiles: { type: 'string', default: 'wifi,4g,3g' }, out: { type: 'string' }, reps: { type: 'string', default: '2' }, baseline: { type: 'string', default: 'yes' }, 'full-parquet': { type: 'string', default: 'wifi,4g' }, 'offset-index': { type: 'string', default: 'no' } } });
const SERVE = process.env.SERVE; if (!SERVE) throw new Error('set SERVE');
const PROFILES = { wifi: { mbps: 30, latency: 20 }, '4g': { mbps: 9, latency: 150 }, '3g': { mbps: 1.6, latency: 400 }, none: { mbps: 0, latency: 0 } };
const DATA = 'http://127.0.0.1:5210', PAGE = 'http://127.0.0.1:5310';
const procs = [];
const start = (args) => { const p = spawn('node', [path.join(here, 'server.mjs'), ...args], { stdio: 'ignore' }); procs.push(p); return p; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cfg = (p) => fetch(`${DATA}/__cfg?latency=${p.latency}&mbps=${p.mbps}&connect=2`).then((r) => r.json());
const slog = async () => (await fetch(`${DATA}/__log`)).json();
const sreset = () => fetch(`${DATA}/__reset`);
const load = () => os.loadavg()[0].toFixed(2);

start(['--root', SERVE, '--port', '5210']);
start(['--root', path.join(here, 'web'), '--port', '5310']);
await sleep(700);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--disable-gpu', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const version = browser.version();
const out = { when: new Date().toISOString(), chromium: version, machine: `${os.cpus().length} vCPU, ${os.cpus()[0].model}`, node: process.version, loadNote: 'load = 1-minute load average at measurement start/end (other agents share the machine)', model: 'server: latency per response + 2x latency per new connection, shared bandwidth bucket; see server.mjs', results: {} };
const reps = +A.reps;

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(`${PAGE}/harness.html`);
  await page.waitForFunction('window.ready === true');
  return { ctx, page };
}

try {
  for (const tree of A.trees.split(',')) {
    const dir = path.join(SERVE, tree);
    const clades = JSON.parse(fs.readFileSync(path.join(dir, 'clades.json'), 'utf8'));
    const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    const R = (out.results[tree] = { tips: man.tips, nodes: man.nodes, files: Object.fromEntries(Object.entries(man.files).map(([k, v]) => [k, v.bytes])), newickGz: fs.statSync(path.join(dir, 'tree.nwk.gz')).size, profiles: {} });
    for (const pname of A.profiles.split(',')) {
      const prof = PROFILES[pname];
      await cfg(prof);
      const P = (R.profiles[pname] = { profile: prof, loadStart: load() });
      const base = `${DATA}/${tree}`;
      const popts = A['offset-index'] === 'yes' ? { useOffsetIndex: true } : {};
      // ---- A. overview first (fresh page each rep)
      P.overview = [];
      for (let k = 0; k < (pname === '3g' ? 2 : reps); k++) {
        const { ctx, page } = await newPage();
        await sreset();
        const t0 = Date.now();
        const r = await page.evaluate(([b, o]) => PQ.M.overviewFirst(b, o), [base, popts]);
        r.serverLog = (await slog()).map((x) => ({ url: x.url, method: x.method ?? "GET", range: x.range, bytes: x.bytes, fresh: x.fresh }));
        r.wallMs = Date.now() - t0;
        P.overview.push(r);
        if (k < (pname === '3g' ? 2 : reps) - 1) await ctx.close(); else P._page = { ctx, page };
      }
      const { ctx, page } = P._page; delete P._page;
      // ---- footers, deeper levels
      await sreset();
      P.footers = await page.evaluate(() => PQ.M.warmFooters());
      P.levels = [];
      const nl = man.overview.level_rows.length;
      for (let L = 1; L < nl; L++) P.levels.push(await page.evaluate((l) => PQ.M.overviewLevel(l), L));
      // ---- B. clades
      P.clades = [];
      for (const c of clades.clades) {
        if (pname === '3g' && c.target > 10000) continue; // 100k-tip clades cost minutes on slow 3G; extrapolate from bytes
        const rr = [];
        for (let k = 0; k < (pname === '3g' ? 1 : reps); k++) {
          const a = await page.evaluate(([n, e, ls, t]) => PQ.M.fetchClade(n, e, ls, t, false, undefined), [c.node, c.end, c.leaf_start, c.tips]);
          const b = await page.evaluate(([n, e, ls, t]) => PQ.M.fetchClade(n, e, ls, t, true, undefined), [c.node, c.end, c.leaf_start, c.tips]);
          rr.push({ nodesOnly: a, withLabels: b });
        }
        P.clades.push({ target: c.target, node: c.node, tips: c.tips, nodeRows: c.nodes, reps: rr });
      }
      const big = clades.clades.filter((c) => c.target <= (pname === '3g' ? 10000 : 100000)).at(-1);
      { const { ctx: c3, page: p3 } = await newPage(); P.memory = await p3.evaluate(([b, c, o]) => PQ.M.memoryFresh(b, c, o), [base, big ?? null, popts]); await c3.close(); }
      P.memoryClade = big ? { target: big.target, tips: big.tips } : null;
      // ---- path to a tip
      P.paths = [];
      for (const tn of clades.tip_nodes.slice(0, 3)) P.paths.push(await page.evaluate((n) => PQ.M.path(n), tn));
      P.labelLookup = [];
      for (const r of clades.tip_ranks.slice(0, 3)) P.labelLookup.push(await page.evaluate((rk) => PQ.M.tipRank(rk), r));
      P.focus = [];
      for (const tn of clades.tip_nodes.slice(0, 3)) P.focus.push(await page.evaluate((n) => PQ.M.focusTip(n, 1000), tn));
      // ---- tip metadata columns: visible tips of the 10k clade (or 1k)
      const c10 = clades.clades.find((c) => c.target === 10000) ?? clades.clades[0];
      if (c10) {
        P.tipColumns = {};
        for (const cols of [['occurrence_count'], ['occurrence_count', 'country'], ['tip_label'], ['tip_label', 'occurrence_count', 'country']]) {
          P.tipColumns[cols.join('+')] = await page.evaluate(([a, b, cs]) => PQ.M.tipColumns(a, b, cs), [c10.leaf_start, c10.leaf_start + c10.tips, cols]);
        }
        P.tipColumns._allTips_occ = await page.evaluate(([n]) => PQ.M.tipColumns(0, n, ['occurrence_count']), [man.tips]);
      }
      // ---- decode benchmark (cache-hot), only on the unthrottled profile
      if (pname === 'none') {
        const n = man.nodes, hi = Math.min(n, 200000);
        P.decode = {
          nodesAll: await page.evaluate(([h]) => PQ.M.decodeBench(0, h, undefined), [hi]),
          nodesTwoCols: await page.evaluate(([h]) => PQ.M.decodeBench(0, h, ['subtree_end', 'tip_count']), [hi]),
          tipsLabels: await page.evaluate(([h]) => PQ.M.decodeBenchTips(0, h, ['tip_label']), [Math.min(man.tips, 100000)]),
          tipsOcc: await page.evaluate(([h]) => PQ.M.decodeBenchTips(0, h, ['occurrence_count']), [Math.min(man.tips, 100000)]),
        };
      }
      if (A['full-parquet'].split(',').includes(pname)) P.fullParquet = await page.evaluate(() => PQ.M.fullParquet());
      await ctx.close();
      // ---- C. baseline: whole gzipped Newick, inflate, parse, TreeModel
      if (A.baseline === 'yes') {
        P.baseline = [];
        for (let k = 0; k < (pname === '3g' ? 1 : reps); k++) {
          const { ctx: c2, page: p2 } = await newPage();
          await sreset();
          const h0 = await p2.evaluate(() => { gc(); return performance.memory.usedJSHeapSize; });
          const r = await p2.evaluate((u) => PQ.baseline(u), `${base}/tree.nwk.gz`);
          r.heapAfter = await p2.evaluate(() => { gc(); return performance.memory.usedJSHeapSize; });
          r.heapDelta = r.heapAfter - h0;
          P.baseline.push(r);
          await c2.close();
        }
      }
      P.loadEnd = load();
      console.log(tree, pname, 'overview', P.overview.map((o) => o.ms.toFixed(0)).join('/'), 'ms; baseline', P.baseline?.map((b) => b.totalMs.toFixed(0)).join('/'), 'ms; load', P.loadStart, '->', P.loadEnd);
      fs.writeFileSync(A.out, JSON.stringify(out, null, 1));
    }
  }
} finally {
  await browser.close();
  for (const p of procs) p.kill('SIGTERM');
}
