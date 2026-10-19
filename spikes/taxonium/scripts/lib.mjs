import { createRequire } from 'node:module';
const require = createRequire('/home/user/gbif-phylo/spikes/package.json');
export const { chromium } = require('playwright-core');
export const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export const ARGS = ['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--disable-gpu-rasterization','--enable-precise-memory-info','--js-flags=--expose-gc'];
export async function launch(opts={}) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ARGS });
  const ctx = await browser.newContext({ viewport: opts.viewport ?? { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => { const t = m.text(); if (!/^(min_y|GETNODES|Filtering|Reducing|Adding|Went|REDUC|Min_y|length of|Found cached|\{)/.test(t)) logs.push(m.type()+': '+t.slice(0,300)); });
  page.on('pageerror', e => logs.push('PAGEERROR: '+e.message.slice(0,400)));
  page.on('dialog', d => { logs.push('DIALOG: '+d.message().slice(0,200)); d.dismiss(); });
  return { browser, ctx, page, logs };
}
