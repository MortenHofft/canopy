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

test('setTheme puts colours and font on the container as custom properties', async () => {
  const h = await makeViewer('((a,b),(c,d));');
  h.viewer.setTheme({ background: '#123456', foreground: '#abcdef', fontFamily: 'Rubik' });
  const s = h.viewer.container.style;
  assert.equal(s['--phylo-background'], '#123456');
  assert.equal(s['--phylo-foreground'], '#abcdef');
  assert.equal(s['--phylo-font-family'], 'Rubik');
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
