// Unit tests of the TreeViewer facade (src/viewer.ts), built for real over the fake DOM of viewer-harness.mjs: clade colours, the control
// layer, what the first frame draws and in which order (the opaque and the alpha canvas), the canvas swap when the background changes,
// and setTheme / refreshTheme. Nothing here needs a browser; the frame is read from the recording 2D context.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { makeViewer, destroyAll, alphaOf } = await import('./viewer-harness.mjs');

afterEach(destroyAll);
const { FALLBACK_THEME } = await import('../src/types.ts');

// preorder ids: 0 root, 1 outer, 2 inner, 3 a, 4 b, 5 c, 6 d
const NESTED = '(((a,b)inner,c)outer,d)root;';

/** The colour each tip is painted with, by label ('' for none). Reads the viewer's private class arrays: the colour is not exposed. */
function tipColours(v) {
  const out = {};
  for (const label of ['a', 'b', 'c', 'd']) out[label] = v.colours[v.classOf?.[v.rowOf(v.tipNode(label))] ?? 0];
  return out;
}

// ---------------------------------------------------------------- setClades

test('setClades: the innermost clade wins, in either order', async () => {
  const outer = { node: 1, colour: 'red' };
  const inner = { node: 2, colour: 'blue' };
  for (const order of [
    [outer, inner],
    [inner, outer],
  ]) {
    const { viewer, env, ctx } = await makeViewer(NESTED);
    assert.equal(viewer.getTree().labels[2], 'inner', 'node ids as the test assumes');
    viewer.setClades(order);
    env.flush();
    assert.deepEqual(tipColours(viewer), { a: 'blue', b: 'blue', c: 'red', d: '' }, order.map((c) => c.colour).join(','));
    // and the frame paints with both colours
    const painted = new Set(
      ctx()
        .log.filter((e) => e[0] === 'strokeStyle=' || e[0] === 'fillStyle=')
        .map((e) => e[1]),
    );
    assert.ok(painted.has('blue') && painted.has('red'), 'the frame used the clade colours');
  }
});

test('setClades: for the same node the later entry wins; the same list again is a no-op', async () => {
  const { viewer, env } = await makeViewer(NESTED);
  viewer.setClades([
    { node: 1, colour: 'red' },
    { node: 1, colour: 'green' },
  ]);
  assert.equal(tipColours(viewer).c, 'green');
  viewer.setClades([
    { node: 1, colour: 'green' },
    { node: 1, colour: 'red' },
  ]);
  assert.equal(tipColours(viewer).c, 'red', 'the order decides');
  let n = 0;
  viewer.on('cladeschange', () => n++);
  viewer.setClades([
    { node: 1, colour: 'green' },
    { node: 1, colour: 'red' },
  ]);
  env.flush();
  assert.equal(n, 0, 'identical entries in the same order do nothing');
  viewer.setClades([]);
  assert.deepEqual(tipColours(viewer), { a: '', b: '', c: '', d: '' });
  assert.deepEqual(viewer.getClades(), []);
});

test('setClades: nodes outside the tree are skipped', async () => {
  const { viewer } = await makeViewer(NESTED);
  viewer.setClades([
    { node: 99, colour: 'red' },
    { node: 2, colour: 'blue' },
  ]);
  assert.deepEqual(tipColours(viewer), { a: 'blue', b: 'blue', c: '', d: '' });
});

// ---------------------------------------------------------------- addControl

function control(el, extra = {}) {
  return {
    element: el,
    viewerSeen: undefined,
    setViewer(v) {
      this.viewerSeen = v;
    },
    ...extra,
  };
}

test('addControl: sets pointer-events:auto on the element, keeps one the control set itself', async () => {
  const { viewer, env } = await makeViewer('(a,b)r;');
  const plain = control(env.document.createElement('div'));
  const own = env.document.createElement('div');
  own.style.cssText = 'position:absolute;pointer-events:none';
  const kept = control(own);
  const inline = env.document.createElement('div');
  inline.style.pointerEvents = 'none';
  const kept2 = control(inline);
  viewer.addControl(plain);
  viewer.addControl(kept);
  viewer.addControl(kept2);
  assert.equal(plain.element.style.pointerEvents, 'auto');
  assert.equal(own.style.pointerEvents, 'none', 'a layer over the whole tree lets clicks through');
  assert.equal(inline.style.pointerEvents, 'none');
  assert.equal(plain.viewerSeen, viewer);
  assert.ok(viewer.container.contains(plain.element), 'placed in the control layer');
});

test('addControl: an element with a target is left alone (marked as UI, not given pointer-events)', async () => {
  const { viewer, env } = await makeViewer('(a,b)r;');
  const slot = env.document.createElement('div');
  env.document.body.appendChild(slot);
  const c = control(env.document.createElement('div'), { target: slot });
  viewer.addControl(c);
  assert.equal(c.element.style.pointerEvents, undefined);
  assert.ok('phyloUi' in c.element.dataset);
  assert.equal(c.element.parentNode, slot);
  viewer.removeControl(c);
  assert.equal(c.viewerSeen, null);
  assert.equal(c.element.parentNode, null);
});

// ---------------------------------------------------------------- the frame

test('the frame on an opaque canvas fills the background and never clears', async () => {
  const h = await makeViewer('((a,b),(c,d));');
  assert.deepEqual(h.canvas().contextAttrs, [{ alpha: false, willReadFrequently: false }]);
  assert.equal(h.ctx().log.length, 0, 'nothing is drawn before the first animation frame');
  assert.equal(h.env.pendingFrames(), 1);
  h.env.flush();
  const ctx = h.ctx();
  assert.equal(ctx.indexOf('clearRect'), -1, 'an opaque canvas is overdrawn, not cleared');
  const fill = ctx.indexOf('fillRect');
  assert.deepEqual(ctx.log[fill], ['fillRect', 0, 0, 400, 300]);
  assert.equal(ctx.log[fill - 1][0], 'fillStyle=');
  assert.equal(ctx.log[fill - 1][1], FALLBACK_THEME.background);
});

for (const background of ['transparent', 'rgba(255, 255, 255, 0.5)', '#ffffff80']) {
  test(`the frame on an alpha canvas (background ${background}) clears before it fills`, async () => {
    const h = await makeViewer('((a,b),(c,d));', { theme: { background } });
    assert.deepEqual(h.canvas().contextAttrs, [{ alpha: true, willReadFrequently: false }]);
    h.env.flush();
    const ctx = h.ctx();
    const clear = ctx.indexOf('clearRect');
    const fill = ctx.indexOf('fillRect');
    assert.ok(clear >= 0 && fill >= 0);
    assert.ok(clear < fill, 'clearRect comes first');
    assert.deepEqual(ctx.log[clear], ['clearRect', 0, 0, 400, 300]);
    assert.equal(ctx.log[fill - 1][1], background, 'the background is still painted over the clear');
    // every frame clears again, so the frame before does not show through
    ctx.reset();
    h.viewer.setOptions({ axis: false });
    h.env.flush();
    assert.ok(ctx.indexOf('clearRect') >= 0 && ctx.indexOf('clearRect') < ctx.indexOf('fillRect'));
  });
}

test('the frame follows the size of the target and the device pixel ratio', async () => {
  const h = await makeViewer('((a,b),(c,d));', { size: [200, 100] });
  h.env.flush();
  assert.equal(h.canvas().width, 200);
  globalThis.devicePixelRatio = 2;
  try {
    h.env.resize(h.target, 300, 150);
    h.env.flush();
    assert.equal(h.canvas().width, 600);
    assert.equal(h.canvas().height, 300);
    assert.deepEqual(h.ctx().calls('setTransform').pop(), ['setTransform', 2, 0, 0, 2, 0, 0]);
  } finally {
    globalThis.devicePixelRatio = 1;
  }
});

test('destroy: frames stop, the observer and the scheme listener are removed, the canvases released', async () => {
  const h = await makeViewer('((a,b),(c,d));');
  const main = h.canvas();
  h.env.flush();
  assert.equal(h.env.schemeListenerCount(), 1);
  h.viewer.destroy();
  assert.equal(h.env.schemeListenerCount(), 0);
  assert.ok(h.env.observers[0].disconnected);
  assert.equal(main.width, 0);
  assert.equal(h.env.pendingFrames(), 0);
  assert.equal(h.target.children.length, 0);
});

// ---------------------------------------------------------------- theme change swaps the canvas

test('a background that stops or starts being opaque swaps the main canvas and its context attributes', async () => {
  const h = await makeViewer('((a,b),(c,d));', { options: { softwareCanvas: true } });
  h.env.flush();
  const first = h.canvas();
  assert.equal(first.width, 400);

  // opaque -> opaque: same canvas
  h.viewer.setTheme({ background: '#101010' });
  assert.equal(h.canvas(), first);
  assert.equal(first.contextAttrs.length, 1);

  // opaque -> transparent: a new canvas, alpha on, same place, size and style; the old one is released
  h.viewer.setTheme({ background: 'transparent' });
  const second = h.canvas();
  assert.notEqual(second, first);
  assert.equal(h.viewer.root.children[0], second, 'in the old canvas place, under the overlay canvas');
  assert.equal(h.viewer.root.children.filter((c) => c === first).length, 0);
  assert.deepEqual(second.contextAttrs, [{ alpha: true, willReadFrequently: true }], 'softwareCanvas is kept');
  assert.equal(second.width, 400);
  assert.equal(second.height, 300);
  assert.equal(second.style.cssText, first.style.cssText);
  assert.equal(second.getAttribute('aria-hidden'), 'true');
  assert.equal(first.width, 0);
  assert.equal(first.height, 0);

  // the next frame goes to the new context: cleared, then filled with the (transparent) background
  h.env.flush();
  const ctx = h.ctx();
  assert.ok(ctx.indexOf('clearRect') >= 0 && ctx.indexOf('clearRect') < ctx.indexOf('fillRect'));
  assert.equal(first.ctx.calls('fillRect').length > 0, true, 'the old context has only its earlier frame');
  const oldCalls = first.ctx.log.length;

  // transparent -> translucent: still alpha, no swap
  h.viewer.setTheme({ background: 'rgba(0, 0, 0, 0.2)' });
  assert.equal(h.canvas(), second);

  // back to opaque: a third canvas without alpha
  h.viewer.setTheme({ background: '#ffffff' });
  const third = h.canvas();
  assert.notEqual(third, second);
  assert.deepEqual(third.contextAttrs, [{ alpha: false, willReadFrequently: true }]);
  h.env.flush();
  assert.equal(h.ctx().indexOf('clearRect'), -1);
  assert.equal(first.ctx.log.length, oldCalls, 'the released canvas is not drawn on again');
});

test('a theme change draws a new frame and bumps nothing when the theme is equal', async () => {
  const h = await makeViewer('((a,b),(c,d));');
  h.env.flush();
  let changes = 0;
  h.viewer.on('themechange', () => changes++);
  h.viewer.setTheme({});
  assert.equal(changes, 0);
  assert.equal(h.env.pendingFrames(), 0, 'no change, no frame');
  h.viewer.setTheme({ branch: '#ff0000' });
  assert.equal(changes, 1);
  assert.equal(h.env.pendingFrames(), 1);
});

// ---------------------------------------------------------------- setTheme / refreshTheme

test('setTheme: overrides over the fallback; a later call replaces the earlier overrides; undefined means not set', async () => {
  const h = await makeViewer('((a,b),(c,d));', { theme: { branch: '#111111' } });
  const { viewer } = h;
  assert.equal(viewer.getTheme().branch, '#111111');
  assert.equal(viewer.getTheme().background, FALLBACK_THEME.background);
  const seen = [];
  viewer.on('themechange', (t) => seen.push(t));
  viewer.setTheme({ foreground: '#222222' });
  assert.equal(viewer.getTheme().foreground, '#222222');
  assert.equal(viewer.getTheme().branch, FALLBACK_THEME.branch, 'not merged with the earlier call');
  viewer.setTheme({ foreground: '#222222', branch: undefined });
  assert.equal(seen.length, 1, 'the same resulting theme is a no-op');
  viewer.setTheme({ categorical: ['#000000', '#ffffff'] });
  viewer.setTheme({ categorical: ['#000000', '#ffffff'] });
  assert.equal(seen.length, 2, 'categorical compared element-wise');
  assert.equal(seen[1], viewer.getTheme());
});

test('updateTheme merges into the overrides; undefined drops a field; setTheme still replaces', async () => {
  const h = await makeViewer('((a,b),(c,d));');
  const { viewer } = h;
  const seen = [];
  viewer.on('themechange', (t) => seen.push(t));
  viewer.updateTheme({ branch: '#111111' });
  viewer.updateTheme({ foreground: '#222222' });
  assert.equal(viewer.getTheme().branch, '#111111', 'the first call survives the second');
  assert.equal(viewer.getTheme().foreground, '#222222');
  assert.equal(seen.length, 2);
  viewer.updateTheme({ foreground: '#222222' });
  assert.equal(seen.length, 2, 'the same resulting theme is a no-op');
  viewer.updateTheme({ branch: undefined });
  assert.equal(viewer.getTheme().branch, FALLBACK_THEME.branch, 'undefined goes back to the CSS or fallback value');
  assert.equal(viewer.getTheme().foreground, '#222222');
  viewer.setTheme({ highlight: '#333333' });
  assert.equal(viewer.getTheme().foreground, FALLBACK_THEME.foreground, 'setTheme replaces what updateTheme built');
  viewer.updateTheme({ branch: '#444444' });
  assert.equal(viewer.getTheme().highlight, '#333333', 'updateTheme after setTheme merges into the new overrides');
});

test('setTheme puts colours and font on the container as custom properties', async () => {
  const h = await makeViewer('((a,b),(c,d));');
  h.viewer.setTheme({ background: '#123456', foreground: '#abcdef', fontFamily: 'Rubik' });
  const s = h.viewer.container.style;
  assert.equal(s['--phylo-background'], '#123456');
  assert.equal(s['--phylo-foreground'], '#abcdef');
  assert.equal(s['--phylo-font-family'], 'Rubik');
});

test('labelFontStyle: the canvas label font is italic or not by the theme; the container property follows setTheme', async () => {
  const h = await makeViewer('((a,b),(c,d));');
  h.env.flush();
  const fonts = () =>
    h
      .ctx()
      .calls('font=')
      .map((e) => e[1]);
  assert.ok(
    fonts().some((f) => /^italic /.test(f)),
    'italic by default',
  );
  assert.equal(h.viewer.container.style['--phylo-label-font-style'], 'italic');
  h.ctx().reset();
  h.viewer.setTheme({ labelFontStyle: 'normal' });
  h.env.flush();
  assert.ok(
    fonts().some((f) => /px /.test(f)),
    'labels were drawn again',
  );
  assert.ok(!fonts().some((f) => /italic/.test(f)), 'no italic in any font of the frame');
  assert.equal(h.viewer.container.style['--phylo-label-font-style'], 'normal');
});

test('viewer.css: DOM tip labels take their style from --phylo-label-font-style', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../css/viewer.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /font-style:\s*italic/, 'no hard-coded italic');
  assert.equal(css.match(/font-style:\s*var\(--phylo-label-font-style, italic\)/g)?.length, 2);
});

test('refreshTheme re-reads the CSS custom properties of the target; overrides still win', async () => {
  const h = await makeViewer('((a,b),(c,d));', {
    cssVars: { '--phylo-background': '#0f172a', '--phylo-branch': '#94a3b8' },
    theme: { highlight: '#ff00ff' },
  });
  const { viewer, env, target } = h;
  assert.equal(viewer.getTheme().background, '#0f172a', 'read at construction');
  assert.equal(viewer.getTheme().dark, true, 'dark follows the background');
  assert.equal(viewer.getTheme().highlight, '#ff00ff');
  let changes = 0;
  viewer.on('themechange', () => changes++);

  viewer.refreshTheme();
  assert.equal(changes, 0, 'nothing changed');

  env.setCssVars(target, { '--phylo-background': '#ffffff', '--phylo-branch': '#334155', '--phylo-highlight': '#00ff00' });
  assert.equal(viewer.getTheme().background, '#0f172a', 'the viewer does not watch the stylesheet');
  viewer.refreshTheme();
  assert.equal(changes, 1);
  assert.equal(viewer.getTheme().background, '#ffffff');
  assert.equal(viewer.getTheme().branch, '#334155');
  assert.equal(viewer.getTheme().dark, false);
  assert.equal(viewer.getTheme().highlight, '#ff00ff', 'the override beats the CSS value');

  // a property dropped from the CSS is back to the fallback; a later setTheme keeps the CSS values it does not override
  env.setCssVars(target, { '--phylo-branch': '#334155' });
  viewer.refreshTheme();
  assert.equal(viewer.getTheme().background, FALLBACK_THEME.background);
  viewer.setTheme({ foreground: '#010101' });
  assert.equal(viewer.getTheme().branch, '#334155');
  assert.equal(viewer.getTheme().highlight, FALLBACK_THEME.highlight, 'setTheme replaced the earlier overrides');
});

test('a colour scheme change refreshes the theme; after destroy it does not', async () => {
  const h = await makeViewer('((a,b),(c,d));', { cssVars: { '--phylo-background': '#ffffff' } });
  const { viewer, env, target } = h;
  env.setCssVars(target, { '--phylo-background': '#000000' });
  env.setDark(true);
  assert.equal(viewer.getTheme().background, '#000000');
  env.setCssVars(target, { '--phylo-background': '#222222' });
  viewer.destroy();
  env.setDark(false);
  assert.equal(viewer.getTheme().background, '#000000', 'destroyed: no more refresh');
  viewer.refreshTheme(); // a no-op, not an error
  assert.equal(viewer.getTheme().background, '#000000');
});

test('refreshTheme swaps the canvas when the CSS background turns transparent', async () => {
  const h = await makeViewer('((a,b),(c,d));', { cssVars: { '--phylo-background': '#ffffff' } });
  const first = h.canvas();
  h.env.setCssVars(h.target, { '--phylo-background': 'transparent' });
  h.viewer.refreshTheme();
  assert.notEqual(h.canvas(), first);
  assert.equal(h.canvas().contextAttrs[0].alpha, true);
});

// ---------------------------------------------------------------- the harness itself

test('alphaOf: the colour syntaxes a browser reads, and a throw for what it cannot', () => {
  for (const c of ['transparent', 'rgba(0,0,0,0)', 'rgb(0 0 0 / 0)', 'hsl(0 0% 0% / 0%)', '#0000', '#00000000']) assert.equal(alphaOf(c), 0, c);
  for (const c of ['rgb(0 0 0 / 0.5)', 'rgba(0,0,0,50%)', 'hsl(0 0% 0% / .5)', 'hsla(0,0%,0%,.5)', '#ffffff80', '#fff8'])
    assert.ok(alphaOf(c) > 100 && alphaOf(c) < 140, c);
  for (const c of ['#fff', '#112233', 'white', 'rgb(1, 2, 3)', 'rgb(1 2 3)', 'hsl(0 0% 0%)', 'rgba(0,0,0,1)', 'rgb(0 0 0 / 100%)'])
    assert.equal(alphaOf(c), 255, c);
  assert.throws(() => alphaOf('color-mix(in srgb, red, transparent)'), /cannot tell/);
});

test('the fake style keeps one property map and a canvas resize resets its context state', async () => {
  const h = await makeViewer('(a,b)r;');
  const el = h.env.document.createElement('div');
  el.style.pointerEvents = 'none';
  assert.equal(el.style.cssText, 'pointer-events:none;');
  el.style.cssText = 'left:0';
  assert.equal(el.style.pointerEvents, undefined, 'assigning cssText replaces the earlier properties');
  el.style.setProperty('--x', '1');
  assert.equal(el.style.removeProperty('--x'), '1');
  assert.equal(el.style.getPropertyValue('--x'), '');
  // inline custom properties on the target are read by getComputedStyle
  h.target.style.setProperty('--phylo-background', '#000000');
  h.viewer.refreshTheme();
  assert.equal(h.viewer.getTheme().background, '#000000');
  const c = h.canvas();
  c.ctx.fillStyle = 'red';
  c.width = 10;
  assert.equal(c.ctx.fillStyle, '#000000');
});

// ---------------------------------------------------------------- clade names

test('the keyboard announcement names a clade as the legend does: name and locale-formatted count, or "Clade of N tips"', async () => {
  const { viewer, env } = await makeViewer("((a,b)'95:Chelodina_ott1',(c,d)97,e)root;");
  env.flush();
  const t = viewer.getTree();
  const say = (label) => {
    viewer.setActive(t.labels.indexOf(label));
    return viewer.overlay.live.textContent;
  };
  assert.equal(say('95:Chelodina_ott1'), 'Chelodina ott1, 2 tips');
  assert.equal(say('97'), 'Clade of 2 tips');
  viewer.setOptions({ cladeLabel: (node) => (node === t.labels.indexOf('97') ? 'Hidden' : null) });
  assert.equal(say('97'), 'Hidden, 2 tips');
  assert.equal(say('95:Chelodina_ott1'), 'Clade of 2 tips', 'null from cladeLabel: no name');
  assert.equal(say('e'), 'e');
});

// ---------------------------------------------------------------- themeObserver

test('theme array tokens are copied: a mutated caller array is not the live theme, and updateTheme sees the change', async () => {
  const h = await makeViewer('((a,b),(c,d));');
  const { viewer } = h;
  const cat = ['#000000', '#ffffff'];
  viewer.updateTheme({ categorical: cat });
  cat[0] = '#123456';
  assert.equal(viewer.getTheme().categorical[0], '#000000', 'the live theme is not the caller array');
  viewer.updateTheme({ categorical: cat });
  assert.equal(viewer.getTheme().categorical[0], '#123456', 'the mutated array counts as a change');
  cat[1] = '#654321';
  viewer.setTheme({ categorical: cat });
  cat[1] = '#000001';
  assert.equal(viewer.getTheme().categorical[1], '#654321');
});

test('themeObserver: media (default) only listens to the colour scheme; document also watches class and data-theme; none nothing', async () => {
  const media = await makeViewer('((a,b),(c,d));');
  assert.equal(media.env.schemeListenerCount(), 1);
  assert.equal(media.env.mutationObservers().length, 0);

  const doc = await makeViewer('((a,b),(c,d));', { options: { themeObserver: 'document' }, cssVars: { '--phylo-background': '#ffffff' } });
  assert.equal(doc.env.schemeListenerCount(), 1);
  const obs = doc.env.mutationObservers();
  assert.equal(obs.length, 1);
  assert.equal(obs[0].el, doc.env.document.documentElement);
  assert.deepEqual(obs[0].options.attributeFilter, ['class', 'data-theme']);
  doc.env.setCssVars(doc.target, { '--phylo-background': '#000000' });
  doc.env.mutate(); // the page flipped data-theme
  assert.equal(doc.viewer.getTheme().background, '#ffffff', 'coalesced into the next frame');
  doc.env.flush();
  assert.equal(doc.viewer.getTheme().background, '#000000', 'a mutation of <html> re-reads the CSS theme');
  doc.viewer.destroy();
  assert.equal(doc.env.mutationObservers().length, 0, 'disconnected by destroy');
  assert.equal(doc.env.schemeListenerCount(), 0);

  const none = await makeViewer('((a,b),(c,d));', { options: { themeObserver: 'none' } });
  assert.equal(none.env.schemeListenerCount(), 0);
  assert.equal(none.env.mutationObservers().length, 0);
});

test('themeObserver can change with setOptions; only one watcher is ever live', async () => {
  const h = await makeViewer('((a,b),(c,d));', { cssVars: { '--phylo-background': '#ffffff' } });
  h.viewer.setOptions({ themeObserver: 'document' });
  assert.equal(h.env.mutationObservers().length, 1);
  assert.equal(h.env.schemeListenerCount(), 1);
  h.viewer.setOptions({ themeObserver: 'none' });
  assert.equal(h.env.mutationObservers().length, 0);
  assert.equal(h.env.schemeListenerCount(), 0);
  h.env.setCssVars(h.target, { '--phylo-background': '#000000' });
  h.env.setDark(true);
  h.env.mutate();
  h.env.flush();
  assert.equal(h.viewer.getTheme().background, '#ffffff', 'nothing re-reads with none');
  h.viewer.setOptions({ themeObserver: 'media' });
  assert.equal(h.viewer.getTheme().background, '#000000', 'back from none it refreshes at once');
  assert.throws(() => h.viewer.setOptions({ themeObserver: 'dcoument' }), RangeError);
  assert.equal(h.viewer.options.themeObserver, 'media', 'a typo changes nothing');
});

// ---------------------------------------------------------------- fitViewport

test('fitViewport: the window fit() goes to, without moving', async () => {
  const h = await makeViewer('((a,b),(c,d));');
  const { viewer } = h;
  h.env.flush();
  viewer.setViewport({ x0: 0.2, x1: 0.6, y0: 0.5, y1: 2 });
  const before = viewer.getViewport();
  const f = viewer.fitViewport();
  assert.deepEqual(viewer.getViewport(), before, 'the view did not move');
  viewer.fit(false);
  assert.deepEqual(viewer.getViewport(), f, 'it is where fit() goes');
  f.x0 = 99;
  assert.notEqual(viewer.fitViewport().x0, 99, 'a copy');
});

// ---------------------------------------------------------------- toBlob

/** Record the canvases the viewer creates from here on (the offscreen ones of toBlob). */
function spyCanvases(env) {
  const made = [];
  const create = env.document.createElement;
  env.document.createElement = (t) => {
    const el = create(t);
    if (t === 'canvas') made.push(el);
    return el;
  };
  return made;
}

test('toBlob: an offscreen canvas at the chosen scale, the theme background by default, the visible canvas untouched', async () => {
  const h = await makeViewer('((a,b),(c,d));', { theme: { background: '#102030' } });
  h.env.flush();
  const made = spyCanvases(h.env);
  const mainLog = h.ctx().log.length;
  const blob = await h.viewer.toBlob({ scale: 3 });
  assert.equal(blob.type, 'image/png');
  assert.equal(made.length, 1);
  const c = made[0];
  assert.deepEqual(c.blobs, [{ type: 'image/png', width: 1200, height: 900 }], 'twice the dpr 1 size of 400 x 300, at scale 3');
  const log = c.ctx.log;
  assert.deepEqual(
    log.find((e) => e[0] === 'setTransform'),
    ['setTransform', 3, 0, 0, 3, 0, 0],
  );
  const fill = log.findIndex((e) => e[0] === 'fillStyle=' && e[1] === '#102030');
  assert.ok(
    fill >= 0 && log[fill + 1][0] === 'fillRect' && log[fill + 1].slice(1).join() === '0,0,400,300',
    'the theme background over the whole image',
  );
  assert.ok(
    log.some((e) => e[0] === 'stroke' || e[0] === 'fillText'),
    'the tree was drawn on it',
  );
  assert.equal(h.ctx().log.length, mainLog, 'the visible canvas was neither drawn on nor read');
  assert.ok(!h.ctx().calls('drawImage').length && !log.some((e) => e[0] === 'drawImage'));
});

test('toBlob: background null draws no fill; a colour is used as given; type is passed on; default scale is the canvas scale', async () => {
  const h = await makeViewer('((a,b),(c,d));');
  h.env.flush();
  globalThis.devicePixelRatio = 2;
  try {
    const made = spyCanvases(h.env);
    const none = await h.viewer.toBlob({ background: null, type: 'image/webp' });
    assert.equal(none.type, 'image/webp');
    assert.equal(made[0].blobs[0].type, 'image/webp');
    assert.equal(made[0].blobs[0].width, 800, 'the canvas scale: dpr 2 within dprCap 2');
    assert.ok(!made[0].ctx.log.some((e) => e[0] === 'fillRect' && e.slice(1).join() === '0,0,400,300'), 'no background fill');
    await h.viewer.toBlob({ background: '#ff0000', scale: 1 });
    const log = made[1].ctx.log;
    assert.ok(log.some((e) => e[0] === 'fillStyle=' && e[1] === '#ff0000'));
    assert.equal(made[1].width, 0, 'the offscreen canvas is released after encoding');
  } finally {
    globalThis.devicePixelRatio = 1;
  }
});

test('toBlob: the export canvas is opaque exactly when its background is, like the screen (Chromium antialiases text by it)', async () => {
  const alphaOf = async (h, o) => {
    const made = spyCanvases(h.env);
    await h.viewer.toBlob(o);
    return made[0].contextAttrs[0]?.alpha;
  };
  const opaque = await makeViewer('((a,b),(c,d));');
  opaque.env.flush();
  assert.equal(await alphaOf(opaque), false, 'the default theme background is opaque');
  assert.equal(await alphaOf(opaque, { background: null }), true, 'background null: a transparent image');
  assert.equal(await alphaOf(opaque, { background: 'transparent' }), true, 'a transparent background');
  const clear = await makeViewer('((a,b),(c,d));', { theme: { background: 'transparent' } });
  clear.env.flush();
  assert.equal(await alphaOf(clear), true, 'a transparent theme');
  assert.equal(await alphaOf(clear, { background: '#ff0000' }), false, 'an opaque background over a transparent theme');
});

test('toBlob: a bad scale or a size over the limit rejects; a destroyed viewer rejects', async () => {
  const h = await makeViewer('((a,b),(c,d));');
  await assert.rejects(h.viewer.toBlob({ scale: 0 }), RangeError);
  await assert.rejects(h.viewer.toBlob({ scale: NaN }), RangeError);
  await assert.rejects(h.viewer.toBlob({ scale: 100 }), RangeError);
  await assert.rejects(h.viewer.toBlob({ scale: 25 }), RangeError, 'area: 10000 x 7500 is over 2^26');
  h.viewer.destroy();
  await assert.rejects(h.viewer.toBlob(), /destroyed/);
});
