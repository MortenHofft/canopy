// Browser check of the built demo site, served as Vercel serves it (tests/browser/scripts/static-site.mjs follows vercel.json's URL
// rules): the hub lists every page of site/src/examples.json with a working link, thumbnail and source link; /<id>/ redirects to
// /<id> and the page still loads its assets (the absolute base); the data files are there, the large OTL trees included unless the
// build skipped them; then the pages' own checks run against the built site (check-playground.mjs, check-explorer.mjs, check-table.mjs).
//   node tests/browser/scripts/check-site.mjs [--no-build]     (without --no-build it runs scripts/build-site.mjs first)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumPath } from './chromium.mjs';
import { serveSite } from './static-site.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const dist = path.join(root, 'site-dist');
let failures = 0;
const ok = (c, m) => {
  console.log((c ? '  ok   ' : '  FAIL ') + m);
  if (!c) failures++;
};

if (!process.argv.includes('--no-build')) {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/build-site.mjs')], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const examples = JSON.parse(fs.readFileSync(path.join(root, 'site/src/examples.json'), 'utf8'));
const { url, close } = await serveSite(dist);

console.log('\nhub and URLs');
const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => {
  console.log('PAGEERR', e.message);
  failures++;
});
const missing = [];
page.on('response', (r) => r.status() >= 400 && missing.push(`${r.status()} ${r.url()}`));
await page.goto(url + '/');
await page.waitForSelector('.demo');
const cards = await page.locator('.demo h3 a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
ok(cards.join() === examples.map((e) => `/${e.id}/`).join(), `the hub lists every page (${cards.join(' ')})`);
ok((await page.locator('.demo .thumb img').count()) === examples.length, 'every card has its thumbnail');
ok((await page.locator('.demo a.src').first().getAttribute('href')).startsWith('https://github.com/'), 'source links to GitHub');
ok(/Built .* from /.test(await page.locator('#build').innerText()), 'the footer says what was built');
for (const e of examples) {
  await page.goto(`${url}/${e.id}/`);
  await page.waitForSelector('canvas', { timeout: 60000 });
  ok(new URL(page.url()).pathname === `/${e.id}`, `/${e.id}/ redirects to /${e.id} and the page draws a tree`);
}
ok(missing.length === 0, `no failed requests${missing.length ? ': ' + missing.join(', ') : ''}`);

console.log('\ndata');
for (const p of ['rich/fish-carangaria-mcc/Carangaria-MCC.tre', 'synthetic/meta/yule_1000.meta.tsv', 'real-ladder/trees/gtdb-190k-bacteria.nwk.gz']) {
  const r = await fetch(`${url}/data/${p}`);
  ok(r.ok, `/data/${p}`);
}
const big = path.join(dist, 'data/real-ladder/fetched/otl-2m-full.nwk.gz');
ok(!fs.existsSync(big) || fs.statSync(big).size > 20e6, 'the 2.39M-tip OTL tree, when built in, is complete (24 MB)');
await browser.close();

// the pages' own checks, against the built site
for (const [check, id] of [
  ['check-playground.mjs', 'playground'],
  ['check-explorer.mjs', 'explorer'],
  ['check-table.mjs', 'table'],
]) {
  console.log(`\n${check} on ${url}/${id}`);
  // async: the static server runs in this process, so a synchronous spawn would block it from answering the check
  const code = await new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(here, check), '--url', `${url}/${id}`], { stdio: 'inherit' });
    c.on('exit', (status) => resolve(status ?? 1));
    c.on('error', () => resolve(1));
  });
  ok(code === 0, `${check} passes on the built site`);
}
close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks pass');
process.exit(failures ? 1 : 0);
