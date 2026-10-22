// Screenshots of the built pages for the hub's cards (site/public/thumbs/<id>.jpg, 1024×640 JPEG). Run after `npm run build:site`,
// then build again to publish them:  node site/scripts/capture-thumbs.mjs
// Each page is put in a state that shows what it is about (the playground with data columns, the explorer with colours).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumPath } from '../../tests/browser/scripts/chromium.mjs';
import { serveSite } from '../../tests/browser/scripts/static-site.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// playwright-core is a dev dependency of tests/browser
const { chromium } = createRequire(path.join(here, '../../tests/browser/package.json'))('playwright-core');
const out = (id) => path.join(here, '..', 'public', 'thumbs', `${id}.jpg`);

const { url, close } = await serveSite(path.join(here, '../../site-dist'));
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const ready = () => page.waitForFunction(() => document.querySelector('canvas'), null, { timeout: 60000 });

// playground: a tree with traits and an alignment, the overview on
await page.goto(`${url}/playground?tree=syn-yule-1000&s.overview=1&s.preset=gbif`);
await ready();
await page.waitForTimeout(1200);
await page.screenshot({ path: out('playground'), type: 'jpeg', quality: 72 });

// explorer: two coloured clades, taller rows
await page.goto(`${url}/explorer`);
await ready();
await page.waitForFunction(() => typeof window.__explorer === 'function' && window.__explorer());
await page.locator('input[aria-label=Height]').fill('3');
await page.locator('.ex-outer button', { hasText: 'Color' }).click();
const clade = (lo, hi, skip) =>
  page.evaluate(
    ([lo, hi, skip]) => {
      const v = window.__explorer();
      const t = v.getTree();
      for (let i = 1; i < t.nodeCount; i++) {
        const c = t.leafEnd[i] - t.leafStart[i];
        if (t.firstChild[i] >= 0 && c >= lo && c <= hi && skip-- <= 0) {
          const q = v.locateNode(i);
          if (q) return q;
        }
      }
    },
    [lo, hi, skip],
  );
await page.locator('button[aria-label=Pink]').click();
let q = await clade(20, 40, 0);
await page.mouse.click(q.x, q.y);
await page.locator('button[aria-label=Teal]').click();
q = await clade(4, 8, 1);
await page.mouse.click(q.x, q.y);
await page.locator('.ex-outer button', { hasText: 'Color' }).click();
await page.mouse.move(2, 2);
await page.evaluate(() => window.scrollTo(0, 0)); // the clicks scrolled the pane into view
await page.waitForTimeout(500);
await page.screenshot({ path: out('explorer'), type: 'jpeg', quality: 72 });

await browser.close();
close();
console.log('thumbnails written to site/public/thumbs/');
