#!/usr/bin/env node
// Builds one static site containing every spike candidate, a hub page and a side-by-side compare page.
//
//   node scripts/build-site.mjs [--only name1,name2] [--skip-install] [--out site-dist] [--max-data-mb 120]
//
// Output (default site-dist/):
//   /                 hub (spikes/site)
//   /compare          side-by-side compare page
//   /<candidate>/     each candidate app (spikes/<candidate>, any folder with a package.json and a build script)
//   /data/...         the committed test trees (data/), the subset listed in spikes/shared/trees.json plus
//                     metadata and alignments they reference
//   /candidates.json  what the hub lists (from spikes/<candidate>/spike.json, falling back to package.json)
//   /results/         latest runner results, when present
//
// Used by Vercel (see vercel.json) and runnable locally. Candidates are built independently so their
// dependency trees never clash; a candidate that fails to build is skipped and reported, not fatal.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spikes = path.join(root, 'spikes');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? (args[i + 1] ?? true) : dflt; };
const outDir = path.resolve(root, opt('out', 'site-dist'));
const only = opt('only', '') ? String(opt('only')).split(',') : null;
const skipInstall = args.includes('--skip-install');
const maxDataMb = Number(opt('max-data-mb', 120));
const NON_CANDIDATES = new Set(['shared', 'runner', 'site', 'results', 'node_modules']);

function run(cmd, argv, cwd) {
  console.log(`$ (${path.relative(root, cwd) || '.'}) ${cmd} ${argv.join(' ')}`);
  const r = spawnSync(cmd, argv, { cwd, stdio: 'inherit', env: { ...process.env, CI: '1' } });
  return r.status === 0;
}
function readJson(p, dflt = null) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return dflt; } }
function copyDir(src, dst) { fs.mkdirSync(dst, { recursive: true }); fs.cpSync(src, dst, { recursive: true }); }
function dirBytes(p) {
  let n = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const q = path.join(p, e.name);
    n += e.isDirectory() ? dirBytes(q) : fs.statSync(q).size;
  }
  return n;
}
function installAndBuild(dir) {
  if (!skipInstall || !fs.existsSync(path.join(dir, 'node_modules'))) {
    const ok = fs.existsSync(path.join(dir, 'package-lock.json'))
      ? run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], dir)
      : run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], dir);
    if (!ok) return false;
  }
  fs.rmSync(path.join(dir, 'dist'), { recursive: true, force: true });
  return run('npm', ['run', 'build'], dir) && fs.existsSync(path.join(dir, 'dist', 'index.html'));
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// 1. candidates
const candidates = [];
const failed = [];
for (const name of fs.readdirSync(spikes).sort()) {
  const dir = path.join(spikes, name);
  if (NON_CANDIDATES.has(name) || !fs.statSync(dir).isDirectory()) continue;
  const pkg = readJson(path.join(dir, 'package.json'));
  if (!pkg?.scripts?.build) continue;
  if (only && !only.includes(name)) continue;
  console.log(`\n=== candidate: ${name}`);
  if (!installAndBuild(dir)) { console.warn(`!! ${name}: build failed, skipped`); failed.push(name); continue; }
  copyDir(path.join(dir, 'dist'), path.join(outDir, name));
  const meta = readJson(path.join(dir, 'spike.json'), {});
  candidates.push({
    name,
    title: meta.title ?? name,
    library: meta.library ?? name,
    version: meta.version ?? '',
    license: meta.license ?? pkg.license ?? '',
    description: meta.description ?? pkg.description ?? '',
    repo: meta.repo ?? '',
    rendering: meta.rendering ?? '',
    path: `/${name}/`,
  });
}
fs.writeFileSync(path.join(outDir, 'candidates.json'), JSON.stringify(candidates, null, 2));

// 2. hub and compare page
console.log('\n=== hub');
const siteDir = path.join(spikes, 'site');
if (fs.existsSync(path.join(siteDir, 'package.json'))) {
  if (installAndBuild(siteDir)) fs.cpSync(path.join(siteDir, 'dist'), outDir, { recursive: true });
  else { console.error('hub build failed'); failed.push('site'); }
}

// 3. data: the trees the catalogue lists, with their companions
console.log('\n=== data');
const dataSrc = path.join(root, 'data');
const dataDst = path.join(outDir, 'data');
const catalogue = readJson(path.join(spikes, 'shared', 'trees.json'), []);
const entries = Array.isArray(catalogue) ? catalogue : (catalogue.trees ?? []);
const available = [];
const wanted = new Set();
for (const t of entries) {
  const rel = t.path ?? t.file;
  if (!rel) continue;
  const abs = path.join(dataSrc, rel);
  if (!fs.existsSync(abs)) { console.log(`   missing (not deployed): ${rel}`); continue; }
  wanted.add(rel);
  const companions = [typeof t.meta === 'string' ? t.meta : t.meta?.tsv, t.meta?.fasta, t.meta?.align, t.align, t.tsv, t.fasta];
  for (const c of companions) {
    if (typeof c === 'string' && fs.existsSync(path.join(dataSrc, c))) wanted.add(c);
  }
  available.push({ ...t, bytes: fs.statSync(abs).size });
}
let dataBytes = 0;
for (const rel of wanted) {
  const dst = path.join(dataDst, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(dataSrc, rel), dst);
  dataBytes += fs.statSync(dst).size;
}
// metadata and alignment folders used by the column scenarios, whole (they are small)
for (const rel of ['synthetic/meta', 'synthetic/align', 'synthetic/nexus', 'rich/edge-cases']) {
  const src = path.join(dataSrc, rel);
  if (fs.existsSync(src)) { copyDir(src, path.join(dataDst, rel)); }
}
dataBytes = dirBytes(dataDst);
fs.writeFileSync(path.join(dataDst, 'available.json'), JSON.stringify(available, null, 2));
console.log(`   ${available.length} trees, ${(dataBytes / 1e6).toFixed(1)} MB`);
if (dataBytes / 1e6 > maxDataMb) { console.error(`data is ${(dataBytes / 1e6).toFixed(0)} MB, over --max-data-mb ${maxDataMb}`); process.exit(1); }

// 4. latest results (optional)
const resDir = path.join(spikes, 'results');
if (fs.existsSync(resDir)) {
  const dst = path.join(outDir, 'results');
  fs.mkdirSync(dst, { recursive: true });
  const index = {};
  for (const c of fs.readdirSync(resDir, { withFileTypes: true })) {
    if (!c.isDirectory()) continue;
    const runs = fs.readdirSync(path.join(resDir, c.name)).filter((f) => f.endsWith('.json')).sort();
    if (!runs.length) continue;
    const latest = runs[runs.length - 1];
    fs.mkdirSync(path.join(dst, c.name), { recursive: true });
    fs.copyFileSync(path.join(resDir, c.name, latest), path.join(dst, c.name, latest));
    index[c.name] = `${c.name}/${latest}`;
  }
  fs.writeFileSync(path.join(dst, 'index.json'), JSON.stringify(index, null, 2));
}

console.log(`\nSite built in ${path.relative(root, outDir)}: ${candidates.length} candidates${failed.length ? `, FAILED: ${failed.join(', ')}` : ''}.`);
if (!fs.existsSync(path.join(outDir, 'index.html'))) {
  console.error('No hub page was produced; refusing to publish an empty site.');
  process.exit(1);
}
