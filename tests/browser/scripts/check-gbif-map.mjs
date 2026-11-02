// Browser check of the GBIF map view example (examples/gbif-map): a Newick tree with a CSV sidecar of GBIF matches, shown with the library
// as it is. The tip names follow the toggle (GBIF name, name in the tree, both), a tip with no match keeps its own name and is listed
// in the match report, and a click on a tip opens a card with the links to gbif.org. No page errors.
//   node tests/browser/scripts/check-gbif-map.mjs [--url http://127.0.0.1:5311/]   (dev server: npm run dev in examples/gbif-map)
import { createRequire } from 'node:module';
import { chromiumPath } from './chromium.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const url = args.url || 'http://127.0.0.1:5311/';
let failures = 0;
const ok = (c, m) => {
  console.log((c ? '  ok   ' : '  FAIL ') + m);
  if (!c) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
page.setDefaultTimeout(10000);
page.on('pageerror', (e) => {
  console.log('PAGEERR', e.message);
  failures++;
});
await page.goto(`${url}${url.includes('?') ? '&' : '?'}cpu=1`);
await page.waitForFunction(() => window.__example?.viewer.getStats().frames > 0, null, { timeout: 60000 });
await sleep(300);
const ev = (fn, arg) => page.evaluate(fn, arg);

// ---- the match report
const tips = await ev(() => window.__example.viewer.getTree().tipLabels.slice());
ok(tips.length === 11, `the tree has 11 tips (${tips.length})`);
ok(
  /10 of 11 tips matched/.test(await page.locator('#summary').innerText()),
  `the summary counts the matched tips ("${await page.locator('#summary').innerText()}")`,
);
ok((await page.locator('#unmatched li').allInnerTexts()).join() === 'Wattle_sp_nov', 'the tip without a row is listed');
ok((await page.locator('#unused li').allInnerTexts()).join() === 'none', 'every row has a tip');

// ---- the names follow the toggle (the DOM anchors of the labels carry the text)
const labels = () =>
  ev(() => Object.fromEntries([...document.querySelectorAll('.phylo-tree [data-tip-id]')].map((a) => [a.dataset.tipId, a.textContent.trim()])));
let l = await labels();
ok(l.Australian_Blackwood === 'Acacia melanoxylon R.Br.', `GBIF name by default (${l.Australian_Blackwood})`);
ok(l.Acacia_salinga === 'Acacia saligna (Labill.) H.L.Wendl.', `a misspelt label shows the name GBIF interprets it as (${l.Acacia_salinga})`);
ok(l.Wattle_sp_nov === 'Wattle sp nov', `a tip with no match keeps its own name (${l.Wattle_sp_nov})`);
await page.locator('input[name=names][value=original]').check();
await sleep(300);
l = await labels();
ok(
  l.Australian_Blackwood === 'Australian Blackwood' && l.Acacia_salinga === 'Acacia salinga',
  `"Name in the tree" shows the labels as they are (${l.Australian_Blackwood}, ${l.Acacia_salinga})`,
);
await page.locator('input[name=names][value=both]').check();
await sleep(300);
l = await labels();
ok(l.Blue_Wattle === 'Acacia dealbata Link (Blue Wattle)', `"Both" shows the two (${l.Blue_Wattle})`);

// ---- a click on a tip opens the card, with the links; a tip with no match has only the search
const click = async (label) => {
  const at = await ev((t) => {
    const v = window.__example.viewer;
    const p = v.nodePosition(v.tipNode(t));
    const r = v.element.getBoundingClientRect();
    return p && { x: r.left + p.x, y: r.top + p.y };
  }, label);
  await page.mouse.click(at.x, at.y);
  await sleep(250);
};
await click('Australian_Blackwood');
let hrefs = await page.locator('.tip-card a').evaluateAll((as) => as.map((a) => a.href));
ok((await page.locator('.tip-card').getAttribute('data-tip-id')) === 'Australian_Blackwood', 'a click on a tip opens its card');
ok(hrefs[0] === 'https://www.gbif.org/taxon/8PN2', `the card links to the taxon (${hrefs[0]})`);
ok(
  hrefs[1] === 'https://www.gbif.org/occurrence/search?verbatimScientificName=Australian_Blackwood',
  `and to a search on the name in the tree (${hrefs[1]})`,
);
await click('Wattle_sp_nov');
hrefs = await page.locator('.tip-card a').evaluateAll((as) => as.map((a) => a.href));
ok(hrefs.length === 1 && hrefs[0].includes('verbatimScientificName=Wattle_sp_nov'), 'a tip with no match has no taxon link, only the search');
ok((await page.locator('.tip-card dd').allInnerTexts()).includes('no match'), 'and says so');

await browser.close();
console.log(failures ? `FAILED (${failures})` : 'OK');
process.exit(failures ? 1 : 0);
