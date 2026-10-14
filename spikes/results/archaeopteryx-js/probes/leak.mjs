// What is left in <body>, <head> and localStorage after unmount. Needs the demo on 127.0.0.1:5305.
// Paths assume the repository at /home/user/gbif-phylo.
import { open } from './lib.mjs';
const { browser, page } = await open('http://127.0.0.1:5305/?tree=syn-yule-200');
await page.waitForSelector('[data-testid=tree-container][data-state=mounted]', { timeout: 60000 });
const r = await page.evaluate(async () => {
  const out = {};
  const bodyKids = () => [...document.body.children].map(e => e.tagName + '.' + (e.className || e.id || '')).filter(x => !x.startsWith('DIV.root') && !x.startsWith('DIV.#root'));
  const ls = () => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k).slice(0, 30); } return o; };
  out.mounted = { body: bodyKids(), head: [...document.head.querySelectorAll('style')].map(s => s.id || 'style'), ls: ls() };
  await window.__spike.unmount(); await new Promise(r => setTimeout(r, 300));
  out.unmounted = { body: bodyKids(), head: [...document.head.querySelectorAll('style')].map(s => s.id || 'style'), ls: ls() };
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
