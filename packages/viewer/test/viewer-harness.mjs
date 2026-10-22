// Test harness that builds a real `TreeViewer` in Node: a fake DOM (fake-dom.mjs) plus the browser APIs the viewer calls at construction
// and in its frame loop, all under the test's control:
//   - canvases whose 2D context records every call and property write (`ctx.log`), and the attributes `getContext` was given
//     (`canvas.contextAttrs`); `getImageData` answers from the last fill colour, so the opaque-background probe works;
//   - requestAnimationFrame as a queue: nothing is drawn until `env.flush()` (or `env.frame()` for one round);
//   - ResizeObserver (`env.resize(w, h)` sets the target's size and notifies), matchMedia for prefers-color-scheme
//     (`env.setDark(on)` fires its change listeners) and getComputedStyle over `env.setCssVars({...})` of the target.
//
//   const { viewer, env, target } = await makeViewer('((a,b)x,(c,d)y)r;', { options: { layout: 'rectangular' } });
//   env.flush();                                  // draw the first frame
//   const ctx = env.mainContext();                // the recording context of the main canvas
//   ctx.indexOf('clearRect');                     // position of the first clearRect in ctx.log
//
// The globals are installed once per `makeViewer` call (a fresh document, queue and observers each time) and left in place, so a test file
// can build several viewers one after another. Later tests (setTree, dim mode, labels) build on `makeViewer` and read `ctx.log`.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeElement, installFakeDom } from './fake-dom.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));

const DEFAULTS = {
  fillStyle: '#000000',
  strokeStyle: '#000000',
  font: '10px sans-serif',
  globalAlpha: 1,
  lineWidth: 1,
  textAlign: 'start',
  textBaseline: 'alphabetic',
};

/** Alpha (0-255) of a CSS colour as a browser reads it: transparent, #rgba / #rrggbbaa, and rgb / rgba / hsl / hsla in the comma and the
 *  space-slash syntax, with the alpha as a number or a percentage. Opaque forms (#rgb, #rrggbb, names, rgb without alpha) give 255. Anything
 *  else (color-mix, calc, var, ...) throws: a test should pick a colour this harness understands rather than get a silent 255. */
export function alphaOf(c) {
  const s = String(c).trim().toLowerCase();
  if (s === 'transparent') return 0;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(s) || /^[a-z]+$/.test(s)) return 255;
  let m = /^#([0-9a-f]{8}|[0-9a-f]{4})$/.exec(s);
  if (m) return m[1].length === 8 ? parseInt(m[1].slice(6), 16) : parseInt(m[1][3] + m[1][3], 16);
  m = /^(?:rgb|rgba|hsl|hsla)\(([^()]*)\)$/.exec(s);
  if (m) {
    const body = m[1];
    let alpha;
    if (body.includes('/')) alpha = body.split('/')[1].trim();
    else if (body.includes(',')) alpha = body.split(',').length === 4 ? body.split(',')[3].trim() : undefined;
    else alpha = undefined;
    if (alpha === undefined) return 255;
    const n = /^([\d.]+)(%?)$/.exec(alpha);
    if (!n) throw new Error('alphaOf: cannot read the alpha of ' + c);
    const v = n[2] ? parseFloat(n[1]) / 100 : parseFloat(n[1]);
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  }
  throw new Error('alphaOf: the harness cannot tell whether ' + c + ' is opaque; use a colour it parses');
}

const NAMED = { red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255], black: [0, 0, 0], white: [255, 255, 255], rebeccapurple: [102, 51, 153] };

/** The rgb a canvas would fill `c` with, for the syntaxes this harness knows (#rgb, #rrggbb, #rrggbbaa, rgb()/rgba() with commas, a few
 *  names, transparent); null for anything else, which a browser would also not take as a fillStyle if it is not a colour. */
export function rgbOf(c) {
  const s = String(c).trim().toLowerCase();
  if (s === 'transparent') return [0, 0, 0];
  if (NAMED[s]) return NAMED[s];
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (m) {
    const h = m[1].length <= 4 ? [...m[1]].map((x) => x + x).join('') : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,[^()]*)?\)$/.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

/** A 2D context that records. `log` holds `[name, ...args]` for every method call and `['fillStyle=', value]` for every property
 *  write. Unknown methods are accepted and recorded; `measureText` is 6 px per character. */
export function recordingContext(canvas) {
  const log = [];
  const props = { ...DEFAULTS, canvas };
  const api = {
    log,
    reset: () => void (log.length = 0),
    /** What a canvas does when its width or height is set: the drawing state goes back to the defaults. */
    resetState: () => void Object.assign(props, DEFAULTS),
    /** Index in `log` of the first entry named `name` (a call, or `prop=` for a write) at or after `from`; -1 when absent. */
    indexOf: (name, from = 0) => log.findIndex((e, i) => i >= from && e[0] === name),
    /** All entries named `name`. */
    calls: (name) => log.filter((e) => e[0] === name),
  };
  const methods = {
    measureText: (s) => ({ width: String(s).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: () => ({ data: new Uint8ClampedArray([...(rgbOf(props.fillStyle) ?? [0, 0, 0]), alphaOf(props.fillStyle)]) }),
  };
  return new Proxy(api, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k !== 'string') return undefined;
      if (k in props) return props[k];
      return (...args) => {
        log.push([k, ...args]);
        return methods[k]?.(...args);
      };
    },
    set(_t, k, v) {
      // like a browser, a fillStyle that is not a colour is ignored (the previous one stays); rgbOf knows the harness's syntaxes, and
      // other plain names and functions (hsl(), ...) are accepted as before
      const ignored = k === 'fillStyle' && !/^[a-z]+$/i.test(String(v)) && rgbOf(v) === null && !/^(hsla?|oklch|color-mix)\(/i.test(String(v));
      if (!ignored) props[k] = v;
      log.push([k + '=', v]);
      return true;
    },
  });
}

export class FakeCanvas extends FakeElement {
  constructor(tag = 'canvas') {
    super(tag);
    this._w = 300;
    this._h = 150;
    /** Attributes of each `getContext` call, in order. */
    this.contextAttrs = [];
    this.ctx = null;
  }
  get width() {
    return this._w;
  }
  set width(v) {
    this._w = v;
    this.ctx?.resetState();
  }
  get height() {
    return this._h;
  }
  set height(v) {
    this._h = v;
    this.ctx?.resetState();
  }
  getContext(type, attrs) {
    if (type !== '2d') return null;
    this.contextAttrs.push(attrs);
    // like a browser: the first call decides the attributes, later calls return the same context
    return (this.ctx ??= recordingContext(this));
  }
}

/** Install the browser globals and return the handles to drive them. */
export function installEnv() {
  const document = installFakeDom();
  const createElement = document.createElement;
  document.createElement = (t) => (t === 'canvas' ? new FakeCanvas() : createElement(t));
  const g = globalThis;
  g.window = g;
  g.devicePixelRatio = 1;

  // requestAnimationFrame: a queue run by flush()/frame()
  let queue = [];
  let nextId = 1;
  let clock = 0;
  g.requestAnimationFrame = (cb) => {
    const id = nextId++;
    queue.push({ id, cb });
    return id;
  };
  g.cancelAnimationFrame = (id) => {
    queue = queue.filter((q) => q.id !== id);
  };

  const observers = [];
  g.ResizeObserver = class {
    constructor(cb) {
      this.cb = cb;
      this.targets = [];
      this.disconnected = false;
      observers.push(this);
    }
    observe(el) {
      this.targets.push(el);
    }
    unobserve(el) {
      this.targets = this.targets.filter((t) => t !== el);
    }
    disconnect() {
      this.targets = [];
      this.disconnected = true;
    }
  };

  const schemeListeners = new Set();
  const scheme = { dark: false };
  g.matchMedia = (q) => ({
    media: q,
    get matches() {
      return /dark/.test(q) && scheme.dark;
    },
    addEventListener: (_t, f) => schemeListeners.add(f),
    removeEventListener: (_t, f) => schemeListeners.delete(f),
  });

  // getComputedStyle: custom properties from `cssVars` of the element or its nearest ancestor that has the property
  g.getComputedStyle = (el) => ({
    getPropertyValue: (k) => {
      for (let n = el; n; n = n.parentNode) {
        if (n.cssVars && k in n.cssVars) return n.cssVars[k];
        const inline = n.style?.getPropertyValue(k);
        if (inline) return inline;
      }
      return '';
    },
  });

  const env = {
    document,
    observers,
    /** Run one round of queued animation frames (those queued meanwhile wait for the next round). Returns how many ran. */
    frame() {
      const q = queue;
      queue = [];
      clock += 16;
      for (const { cb } of q) cb(clock);
      return q.length;
    },
    /** Run frames until none is queued (`max` rounds at most: a running animation would never end). */
    flush(max = 50) {
      let n = 0;
      while (queue.length && n++ < max) env.frame();
    },
    pendingFrames: () => queue.length,
    /** Resize the observed element and notify the ResizeObserver, as a layout change would. */
    resize(target, w, h) {
      target.w = w;
      target.h = h;
      for (const o of observers) if (o.targets.includes(target) && !o.disconnected) o.cb([{ target }]);
    },
    /** Switch prefers-color-scheme and notify the listeners. */
    setDark(on) {
      scheme.dark = on;
      for (const f of [...schemeListeners]) f({ matches: on });
    },
    schemeListenerCount: () => schemeListeners.size,
    /** Set the `--phylo-*` custom properties of an element (what a stylesheet would); they are read by the next refreshTheme. */
    setCssVars(el, vars) {
      el.cssVars = { ...vars };
    },
  };
  return env;
}

/**
 * Build a real `TreeViewer` over a fake DOM.
 * @param tree a Newick string, or a `TreeData`
 * @param init `options`, `theme`, `columns`, `controls` as `TreeViewerInit`; plus `size` ([w, h], default [400, 300]) and `cssVars` (custom
 *   properties on the target, read at construction)
 * @returns `{ viewer, env, target, ctx }`: `ctx()` is the recording context of the viewer's current main canvas, `top()` of the overlay
 *   canvas, `canvas()` the main canvas element. The first frame is queued, not drawn: call `env.flush()`.
 */
const made = [];

/** Destroy every viewer `makeViewer` built (call it in `afterEach`), so no frame queue or listener outlives its test. */
export function destroyAll() {
  for (const v of made.splice(0)) v.destroy();
}

export async function makeViewer(tree, init = {}) {
  const env = installEnv();
  const { TreeViewer } = await import(path.join(root, 'packages/viewer/src/viewer.ts'));
  const { size = [400, 300], cssVars, ...rest } = init;
  const target = env.document.createElement('div');
  target.w = size[0];
  target.h = size[1];
  if (cssVars) env.setCssVars(target, cssVars);
  env.document.body.appendChild(target);
  const data = typeof tree === 'string' ? parseNewick(tree) : tree;
  const viewer = new TreeViewer({ ...rest, target, tree: data });
  made.push(viewer);
  const canvases = () => viewer.root.children.filter((c) => c instanceof FakeCanvas);
  return {
    viewer,
    env,
    target,
    /** The main canvas element (it is replaced when the background changes between opaque and not). */
    canvas: () => canvases()[0],
    /** The overlay canvas element (hover and focus rings). */
    topCanvas: () => canvases()[1],
    /** The recording context of the current main canvas. */
    ctx: () => canvases()[0].ctx,
    /** The recording context of the overlay canvas. */
    top: () => canvases()[1].ctx,
  };
}
