// Browser launch and a Session wrapper: one fresh page per scenario, thin helpers over window.__spike.
import { chromium } from 'playwright-core';
import { sleep, withTimeout, TimeoutError } from './util.mjs';
import { decode } from './pixels.mjs';

export const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export const CHROMIUM_ARGS = [
  '--enable-precise-memory-info',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--no-sandbox',
  '--disable-gpu-rasterization', // not in the brief: 2D/SVG raster on the CPU; GPU rasterisation through SwiftShader was 10x slower than CPU raster (WebGL still uses SwiftShader)
  ...(process.env.EXTRA_CHROMIUM_ARGS ? process.env.EXTRA_CHROMIUM_ARGS.split(' ') : []),
  '--js-flags=--expose-gc', // lets the page call gc() before heap readings (not in the brief; improves heap numbers)
];
export const VIEWPORT = { width: 1440, height: 900 };

export class Browser {
  constructor(url, log) {
    this.url = url;
    this.log = log;
    this.browser = null;
    this.version = '';
  }
  async launch() {
    this.browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true, args: CHROMIUM_ARGS });
    this.version = this.browser.version();
  }
  async restart() {
    this.log('restarting browser');
    try {
      await withTimeout(this.browser.close(), 5000, 'browser.close');
    } catch {
      try {
        this.browser.process()?.kill('SIGKILL');
      } catch {}
    }
    await this.launch();
  }
  async close() {
    try {
      await withTimeout(this.browser.close(), 5000, 'browser.close');
    } catch {
      try {
        this.browser.process()?.kill('SIGKILL');
      } catch {}
    }
  }

  /** Run fn(session) on a fresh page with a hard timeout. A hung or crashed page is killed and the error is thrown. */
  async withSession(name, fn, timeoutMs) {
    const ctx = await this.browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, acceptDownloads: false });
    // the shell links Google Fonts and the GBIF logo; the sandbox has no reliable network, so fail those fast and keep timings clean
    await ctx.route((u) => u.hostname !== '127.0.0.1' && u.hostname !== 'localhost', (r) => r.abort());
    const page = await ctx.newPage();
    const s = new Session(page, ctx, this.url, name);
    try {
      return await withTimeout(
        (async () => {
          await s.open();
          return fn(s);
        })(),
        timeoutMs,
        name,
      );
    } finally {
      let closed = false;
      await Promise.race([ctx.close().then(() => (closed = true)).catch(() => (closed = true)), sleep(6000)]);
      if (!closed) await this.restart();
    }
  }
}

export class Session {
  constructor(page, ctx, url, name) {
    this.page = page;
    this.ctx = ctx;
    this.url = url;
    this.name = name;
    this.errors = [];
    this.popups = [];
    page.on('pageerror', (e) => this.errors.push('pageerror: ' + String(e.message).slice(0, 300)));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) this.errors.push('console.error: ' + m.text().slice(0, 300));
    });
    page.on('crash', () => this.errors.push('PAGE CRASHED'));
    ctx.on('page', (p) => {
      if (p !== page) this.popups.push(p);
    });
  }

  async open() {
    await this.page.goto(this.url, { waitUntil: 'load' });
    await this.page.waitForFunction(() => !!window.__spike && !!window.__spikeData, null, { timeout: 20000 });
    await this.page.evaluate(() => window.__spike.ready);
  }

  // ---- api access (instance 0 = __spike, 1 = __spike2)
  call(method, ...args) {
    return this.page.evaluate(([m, a]) => window.__spike[m](...a), [method, args]);
  }
  call2(method, ...args) {
    return this.page.evaluate(([m, a]) => window.__spike2[m](...a), [method, args]);
  }
  inst(i) {
    return i === 0 ? (m, ...a) => this.call(m, ...a) : (m, ...a) => this.call2(m, ...a);
  }

  /** CSS size of the main tree area. */
  mainSize() {
    return this.page.evaluate(() => {
      const el = document.querySelector('.main');
      return { width: Math.floor(el.clientWidth), height: Math.floor(el.clientHeight) };
    });
  }

  /** Fetch the tree in the page (through /data), mount it, return the MountResult plus fetch timings. */
  async mount(entry, { layout = 'rectangular', branchLengths, size, instance = 0 } = {}) {
    const sz = size ?? (await this.mainSize());
    const bl = branchLengths ?? entry.hasLengths;
    return this.page.evaluate(
      async ({ id, layout, bl, size, instance }) => {
        const api = instance === 0 ? window.__spike : window.__spike2;
        const t = await window.__spikeData.loadTree(id);
        const r = await api.mount({ treeId: id, newick: t.newick, layout, branchLengths: bl, size });
        return { ...r, fetchMs: t.fetchMs, convertMs: t.convertMs, wireBytes: t.bytes };
      },
      { id: entry.id, layout, bl, size: sz, instance },
    );
  }

  async containerRect(i = 0) {
    return this.page.evaluate((i) => {
      const el = document.querySelector(`[data-testid=${i === 0 ? 'tree-container' : 'tree-container-' + i}]`);
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, i);
  }

  async settle(ms = 120) {
    await this.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await sleep(ms);
  }

  /** Poll locate() until two consecutive answers agree (animations finished). */
  async settleLocate(target, i = 0, maxMs = 3000) {
    const f = this.inst(i);
    let prev = null;
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      const p = await f('locate', target);
      if (prev && p && Math.abs(prev.x - p.x) < 0.5 && Math.abs(prev.y - p.y) < 0.5) return p;
      prev = p;
      await sleep(120);
    }
    return prev;
  }

  async events(i = 0) {
    return this.inst(i)('getEvents');
  }

  /** Real mouse click, then wait up to waitMs for a new event. Returns the events recorded by this click. */
  async clickAndWait(p, i = 0, waitMs = 2000) {
    const f = this.inst(i);
    await f('clearEvents');
    await this.page.mouse.move(p.x, p.y);
    await this.page.mouse.click(p.x, p.y);
    const t0 = Date.now();
    let ev = [];
    while (Date.now() - t0 < waitMs) {
      ev = await f('getEvents');
      if (ev.some((e) => e.type.endsWith('Click'))) break;
      await sleep(25);
    }
    await sleep(60); // let React commit
    return ev;
  }

  /** What the React shell currently displays (instance suffix for i > 0). */
  reactState(i = 0) {
    return this.page.evaluate((i) => {
      const sfx = i === 0 ? '' : '-' + i;
      const q = (t) => document.querySelector(`[data-testid="${t}${sfx}"]`);
      const le = q('last-event');
      const mp = q('map-panel');
      const cl = q('clades');
      const hl = q('highlighted');
      const tm = q('tip-meta');
      return {
        lastEvent: le && { text: le.textContent, type: le.dataset.type, nodeId: le.dataset.nodeId, tipCount: le.dataset.tipCount === '' ? null : Number(le.dataset.tipCount), source: le.dataset.source, seq: Number(le.dataset.seq) },
        mapCount: mp ? Number(mp.dataset.count) : null,
        mapNode: mp?.dataset.nodeId ?? null,
        clades: cl ? Array.from(cl.querySelectorAll('[data-node-id]')).map((c) => ({ nodeId: c.dataset.nodeId, colour: c.dataset.colour })) : null,
        highlightedCount: hl ? Number(hl.dataset.count) : null,
        highlightedText: hl?.textContent ?? null,
        tipMeta: tm && { text: tm.textContent, tip: tm.dataset.tip, matched: tm.dataset.matched },
      };
    }, i);
  }

  /** Screenshot a client-space rect (clamped to the viewport). Returns { buf, png, rect } or null if empty. */
  async shot(rect) {
    const vp = this.page.viewportSize();
    const x = Math.max(0, Math.floor(rect.x));
    const y = Math.max(0, Math.floor(rect.y));
    const w = Math.min(vp.width, Math.ceil(rect.x + rect.width)) - x;
    const h = Math.min(vp.height, Math.ceil(rect.y + rect.height)) - y;
    if (w < 2 || h < 2) return null;
    const buf = await this.page.screenshot({ clip: { x, y, width: w, height: h }, animations: 'disabled', caret: 'hide' });
    return { buf, png: decode(buf), rect: { x, y, width: w, height: h } };
  }

  metrics(fn, arg) {
    return this.page.evaluate(fn, arg);
  }
  async pageErrors() {
    let inPage = [];
    try {
      inPage = await withTimeout(this.page.evaluate(() => window.__spikeMetrics?.errors ?? []), 3000, 'collect errors');
    } catch {}
    return [...new Set([...this.errors, ...inPage])].filter((e) => !/Failed to load resource/.test(e));
  }
}

export { TimeoutError };
