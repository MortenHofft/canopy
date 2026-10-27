#!/usr/bin/env node
// Builds the demo site (what Vercel serves, see vercel.json; runnable locally):
//
//   node scripts/build-site.mjs [--out site-dist] [--no-remote]
//
//   /               the hub (site/)
//   /<id>/          each page listed in site/src/examples.json, built from its folder with base /<id>/
//   /data/...       exactly the data files those pages list (each example's catalogue JSON: every "path", "meta" and "fasta"),
//                   copied from data/. An entry with a "remote" URL (the large OTL trees on the data/otl-large branch) is copied from
//                   a local file when there is one (data/real-ladder/fetched/, made by fetch.sh) and downloaded otherwise;
//                   --no-remote skips those, and the page falls back to the remote URL at run time.
//   /thumbs/...     from site/public (made by site/scripts/capture-thumbs.mjs)
//
// The examples resolve the packages to their TypeScript source (Vite's '@canopy/source' condition), so the packages need no build
// first. Any failure fails the whole build: a deploy never silently lacks a page or a tree.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const out = path.resolve(root, argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'site-dist');
const remote = !argv.includes('--no-remote');
const vite = path.join(path.dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin', 'vite.js');

function die(msg) {
  console.error(`\nbuild-site: ${msg}`);
  process.exit(1);
}
function viteBuild(dir, base, outDir) {
  console.log(`\n> vite build ${path.relative(root, dir)} (base ${base})`);
  const r = spawnSync(process.execPath, [vite, 'build', '--base', base, '--outDir', outDir, '--emptyOutDir'], { cwd: dir, stdio: 'inherit' });
  if (r.status !== 0) die(`${path.relative(root, dir)}: vite build failed`);
}

/** Every data file a catalogue names: { path, meta?, fasta?, remote? } objects anywhere in the JSON. */
function dataFiles(json) {
  const found = [];
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    if (typeof v.path === 'string') {
      found.push({ path: v.path, remote: typeof v.remote === 'string' ? v.remote : null });
      for (const k of ['meta', 'fasta']) if (typeof v[k] === 'string') found.push({ path: v[k], remote: null });
    }
    Object.values(v).forEach(walk);
  };
  walk(json);
  return found;
}

async function copyData(files) {
  let bytes = 0;
  let downloaded = 0;
  const seen = new Set();
  for (const f of files) {
    if (seen.has(f.path)) continue;
    seen.add(f.path);
    const src = path.join(root, 'data', f.path);
    const dst = path.join(out, 'data', f.path);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
      bytes += fs.statSync(dst).size;
    } else if (f.remote && remote) {
      console.log(`  download ${f.remote}`);
      const r = await fetch(f.remote);
      if (!r.ok) die(`${f.path}: not in data/ and ${f.remote} answered ${r.status}`);
      fs.writeFileSync(dst, Buffer.from(await r.arrayBuffer()));
      bytes += fs.statSync(dst).size;
      downloaded++;
    } else if (f.remote) {
      console.log(`  skip ${f.path} (--no-remote; the page loads it from ${f.remote})`);
    } else die(`${f.path}: listed by an example but not in data/ (is it committed?)`);
  }
  console.log(`  ${seen.size} files, ${(bytes / 1e6).toFixed(1)} MB (${downloaded} downloaded)`);
}

fs.rmSync(out, { recursive: true, force: true });
const examples = JSON.parse(fs.readFileSync(path.join(root, 'site/src/examples.json'), 'utf8'));

// 1. the hub at the root
viteBuild(path.join(root, 'site'), '/', out);

// 2. each page under /<id>/
const files = [];
for (const e of examples) {
  const dir = path.join(root, e.dir);
  if (!fs.existsSync(path.join(dir, 'index.html'))) die(`${e.id}: no index.html in ${e.dir}`);
  // absolute base: Vercel (trailingSlash: false) serves /id/ as /id, where a relative ./assets would resolve from the site root
  viteBuild(dir, `/${e.id}/`, path.join(out, e.id));
  // `data`: the catalogue JSON of the page, or a list of them (the explorer reads the playground's catalogue and its own extras)
  for (const d of [e.data ?? []].flat()) files.push(...dataFiles(JSON.parse(fs.readFileSync(path.join(dir, d), 'utf8'))));
}

// 3. the data they load
console.log('\n> data');
await copyData(files);
console.log(`\nsite built in ${path.relative(root, out)}/: hub + ${examples.map((e) => e.id).join(', ')}`);
