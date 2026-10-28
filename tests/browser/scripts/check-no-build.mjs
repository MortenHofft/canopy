// Browser check of the no-build example (examples/no-build/index.html): the viewer used as a plain ES module through an import map, the
// files served as they are by a plain static server (no Vite, no bundler). Asserts that the tree draws, a control works, a click event
// arrives, there are no page errors, and every request stayed on the static server (nothing fetched from elsewhere).
//   node tests/browser/scripts/check-no-build.mjs [--url <page URL>]   (default: serve the repository root here; run `npm run build` first)
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumPath } from './chromium.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
let failures = 0;
const ok = (c, m) => {
  console.log((c ? '  ok   ' : '  FAIL ') + m);
  if (!c) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- a plain static file server over the repository (GET only, no directory listings, nothing outside the repository)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json', '.nwk': 'text/plain' };
const serve = (cors) =>
  http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.resolve(repo, '.' + path.posix.normalize(rel));
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!file.startsWith(repo + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      ...(cors && { 'Access-Control-Allow-Origin': '*' }),
    });
    fs.createReadStream(file).pipe(res);
  });
let server = null;
let cdn = null; // a second origin that sends CORS headers, standing in for a CDN
let base = args.url;
if (!base) {
  server = serve(false);
  cdn = serve(true);
  await new Promise((r) => cdn.listen(0, '127.0.0.1', r));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/examples/no-build/`;
}
const origin = new URL(base).origin;

const browser = await chromium.launch({
  executablePath: chromiumPath(),
  headless: true,
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  page.setDefaultTimeout(10000);
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('pageerror', (e) => {
    console.log('PAGEERR', e.message);
    failures++;
  });
  await page.goto(`${base}${base.includes('?') ? '&' : '?'}cpu=1`);
  await page.waitForFunction(() => window.__noBuild?.viewer.getStats().frames > 0, null, { timeout: 30000 });
  await sleep(300);

  const info = await page.evaluate(() => ({ tips: window.__noBuild.viewer.getTree().tipCount, zoom: !!document.querySelector('.phylo-zoom') }));
  ok(info.tips === 200, `the tree is drawn (${info.tips} tips)`);
  ok(info.zoom, 'the default controls are there');
  const scripts = requests.filter((u) => /\.js(\?|$)/.test(u)).map((u) => new URL(u).pathname);
  ok(
    scripts.length === 3 &&
      scripts.every(
        (p) => p.endsWith('/dist/browser/viewer.js') || p.endsWith('/dist/browser/io.js') || p.endsWith('/dist/browser/io-parse-worker.js'),
      ),
    `three module requests, the single-file builds and the parse worker (${scripts.join(', ')})`,
  );
  const elsewhere = requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:'));
  ok(elsewhere.length === 0, `nothing fetched from outside the static server${elsewhere.length ? ': ' + elsewhere.join(', ') : ''}`);
  const radius = await page.evaluate(() => getComputedStyle(document.querySelector('.phylo-zoom')).borderRadius);
  ok(radius !== '0px', `viewer.css is applied (zoom bar radius ${radius})`);

  const v0 = await page.evaluate(() => window.__noBuild.viewer.getViewport());
  await page.locator('.phylo-zoom button[aria-label="Zoom in"]').click();
  await sleep(250);
  const v1 = await page.evaluate(() => window.__noBuild.viewer.getViewport());
  ok(v1.y1 - v1.y0 < (v0.y1 - v0.y0) * 0.8, 'the zoom button zooms');
  await page.locator('.phylo-fit button').click();
  await sleep(500);

  const tip = await page.evaluate(() => {
    const v = window.__noBuild.viewer;
    const t = v.getTree();
    const r = v.element.getBoundingClientRect();
    for (let k = 0; k < t.tipCount; k++) {
      const p = v.nodePosition(t.tipNode[k]);
      if (p && p.y > 60) return { x: r.left + p.x, y: r.top + p.y, id: t.tipLabels[k] };
    }
    return null;
  });
  await page.mouse.click(tip.x, tip.y);
  await sleep(200);
  ok((await page.locator('#last').textContent()) === tip.id, `a tip click reaches the page's listener (${tip.id})`);

  if (cdn) {
    // the build loaded from another origin: a worker cannot start from there, so the build starts it through a small module of its own
    const cdnBase = `http://127.0.0.1:${cdn.address().port}`;
    const tips = await page.evaluate(async (u) => {
      const { parseInWorker } = await import(`${u}/packages/io/dist/browser/io.js`);
      const { tree } = await parseInWorker('((a:1,b:1):1,(c:1,d:1):1);');
      return tree.tipCount;
    }, cdnBase);
    ok(tips === 4, `the parse worker starts from a build on another origin (${tips} tips)`);
  }
} finally {
  await browser.close();
  server?.close();
  cdn?.close();
}
console.log(failures ? `FAILED (${failures})` : 'OK');
process.exit(failures ? 1 : 0);
