// More unit tests of the input controller (src/core/input.ts), next to input.test.mjs: wheel to zoom factors, drag, click and the click a drag
// swallows, pinch, the window listeners that follow a gesture, and the keys. A fake root element and a fake `window` record the listeners; the
// host records what the controller asks of the renderer. No DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { parseNewick } = await import(path.join(root, 'spikes/shared/newick.ts'));
const { InMemorySource } = await import(path.join(root, 'spikes/custom/src/core/source.ts'));
const { InputController } = await import(path.join(root, 'spikes/custom/src/core/input.ts'));
const { WHEEL_ZOOM_RATE, DRAG_START_PX } = await import(path.join(root, 'spikes/custom/src/core/constants.ts'));

const tree = new InMemorySource(parseNewick('((A:1,B:2)AB:1,(C:1,(D:2,E:3)DE:1)CDE:2,F:4)root;')).snapshot();
const tip = (l) => tree.tipIndex(l);

// the controller binds pointermove / pointerup / pointercancel on `window` while a gesture is on
const winListeners = {};
globalThis.window = {
  addEventListener: (t, fn) => (winListeners[t] = fn),
  removeEventListener: (t, fn) => {
    if (winListeners[t] === fn) delete winListeners[t];
  },
};
const bound = () => Object.keys(winListeners).sort();

function setup({ layout = 'rectangular', hit = null, activeNode = -1, hovering = false } = {}) {
  const handlers = {};
  const capture = {};
  const fakeRoot = {
    addEventListener: (type, fn, opts) => ((opts === true ? capture : handlers)[type] = fn),
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
  };
  const calls = [];
  const rec =
    (name) =>
    (...a) =>
      calls.push([name, ...a]);
  const host = {
    layout,
    area: { ax: 0, ay: 0, aw: 100, ah: 100, clipL: 0, clipT: 0, clipR: 100, clipB: 100 },
    view: layout === 'rectangular' ? { x0: 0, x1: 1, y0: 0, y1: 6 } : { x0: -1, x1: 1, y0: -1, y1: 1 },
    tree,
    activeNode,
    hovering,
    noteInput: rec('noteInput'),
    cancelAnim: rec('cancelAnim'),
    setViewport: rec('setViewport'),
    zoomBy: rec('zoomBy'),
    fit: rec('fit'),
    zoomToRow: rec('zoomToRow'),
    setCursor: rec('setCursor'),
    pick: (x, y) => {
      calls.push(['pick', x, y]);
      return hit;
    },
    click: rec('click'),
    hover: rec('hover'),
    dropHover: rec('dropHover'),
    setActive: rec('setActive'),
    activate: rec('activate'),
  };
  const input = new InputController(fakeRoot, host);
  const take = () => calls.splice(0);
  return { handlers, capture, host, calls, input, take };
}
const ptr = (o) => ({
  pointerId: 1,
  pointerType: 'mouse',
  button: 0,
  clientX: 0,
  clientY: 0,
  target: { closest: () => null },
  type: 'pointermove',
  ...o,
});
const wheel = (o) => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  clientX: 10,
  clientY: 20,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  preventDefault() {},
  ...o,
});
const names = (calls) => calls.map((c) => c[0]);
const closeTo = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-12, `${m}: ${a} vs ${b}`);

test('the controller registers its listeners on the root: wheel (not passive), pointer, click in the capture phase, key, double-click', () => {
  const types = [];
  new InputController({ addEventListener: (t, _f, o) => types.push([t, o]), getBoundingClientRect: () => ({ left: 0, top: 0 }) }, setup().host);
  assert.deepEqual(types.map((t) => t[0]).sort(), ['click', 'dblclick', 'keydown', 'pointerdown', 'pointerleave', 'pointermove', 'wheel']);
  assert.deepEqual(types.find((t) => t[0] === 'wheel')[1], { passive: false });
  assert.equal(types.find((t) => t[0] === 'click')[1], true);
});

// ---- wheel

test('wheel, rectangular: plain = zoom rows about the pointer; shift or ctrl = zoom the x axis; alt = both', () => {
  const s = setup();
  let prevented = 0;
  const w = (o) => s.handlers.wheel(wheel({ preventDefault: () => prevented++, clientX: 40, clientY: 50, ...o }));
  w({ deltaY: -100 });
  const f = Math.exp(100 * WHEEL_ZOOM_RATE);
  let c = s.take();
  assert.deepEqual(names(c), ['noteInput', 'zoomBy']);
  assert.deepEqual(c[1].slice(1, 3), [1, f]);
  assert.deepEqual(c[1].slice(3), [30, 30], 'the pointer in container px: client minus the root rect');
  w({ deltaY: 100, shiftKey: true });
  c = s.take();
  assert.deepEqual(c[1].slice(1, 3), [Math.exp(-100 * WHEEL_ZOOM_RATE), 1]);
  w({ deltaY: 100, ctrlKey: true });
  assert.deepEqual(s.take()[1].slice(1, 3), [Math.exp(-100 * WHEEL_ZOOM_RATE), 1]);
  w({ deltaY: -100, altKey: true });
  c = s.take();
  assert.deepEqual(c[1].slice(1, 3), [f, f]);
  assert.equal(prevented, 4, 'the page does not scroll');
});

test('wheel: line and page deltas are converted to pixels (33 and 400)', () => {
  const s = setup();
  s.handlers.wheel(wheel({ deltaY: -3, deltaMode: 1 }));
  closeTo(s.take()[1][2], Math.exp(3 * 33 * WHEEL_ZOOM_RATE), 'lines');
  s.handlers.wheel(wheel({ deltaY: -1, deltaMode: 2 }));
  closeTo(s.take()[1][2], Math.exp(400 * WHEEL_ZOOM_RATE), 'pages');
});

test('wheel, rectangular: a mostly horizontal gesture pans x by the share of the window; a zero deltaY uses deltaX as the zoom amount', () => {
  const s = setup();
  s.handlers.wheel(wheel({ deltaX: 20, deltaY: 5 }));
  let c = s.take();
  assert.deepEqual(names(c), ['noteInput', 'setViewport']);
  assert.deepEqual(c[1][1], { x0: 0.2, x1: 1.2, y0: 0, y1: 6 }, '20 px of 100 is 20% of the 1.0 wide window');
  s.handlers.wheel(wheel({ deltaX: 20, deltaY: 0, shiftKey: true }));
  c = s.take();
  assert.deepEqual(names(c), ['noteInput', 'zoomBy'], 'with shift the horizontal delta is a zoom');
  closeTo(c[1][1], Math.exp(-20 * WHEEL_ZOOM_RATE), 'x factor');
});

test('wheel, radial: one factor for both axes, from deltaY or else deltaX, whatever the modifiers', () => {
  const s = setup({ layout: 'radial' });
  s.handlers.wheel(wheel({ deltaY: -100, shiftKey: true, clientX: 60, clientY: 70 }));
  const c = s.take();
  const f = Math.exp(100 * WHEEL_ZOOM_RATE);
  assert.deepEqual(c[1].slice(1), [f, f, 50, 50]);
  s.handlers.wheel(wheel({ deltaX: 50 }));
  const g = s.take()[1];
  assert.equal(g[1], g[2]);
  closeTo(g[1], Math.exp(-50 * WHEEL_ZOOM_RATE), 'deltaX');
});

// ---- drag and click

test('a press takes over a running animation and starts listening on the window; a left button only', () => {
  const s = setup();
  s.handlers.pointerdown(ptr({ clientX: 20, clientY: 30 }));
  assert.deepEqual(names(s.take()), ['cancelAnim']);
  assert.deepEqual(bound(), ['pointercancel', 'pointermove', 'pointerup']);
  s.input.destroy();
  assert.deepEqual(bound(), [], 'destroy removes the window listeners');
  const r = setup();
  r.handlers.pointerdown(ptr({ button: 2 }));
  assert.deepEqual(bound(), [], 'a right-button press starts no drag');
  r.input.destroy();
  const t = setup();
  t.handlers.pointerdown(ptr({ button: 0, pointerType: 'touch', pointerId: 5 }));
  assert.deepEqual(bound(), ['pointercancel', 'pointermove', 'pointerup'], 'touch starts a drag');
  t.input.destroy();
});

test('a press on the overview strip ([data-ov]) is not ours', () => {
  const s = setup();
  s.handlers.pointerdown(ptr({ target: { closest: (sel) => (sel === '[data-ov]' ? {} : null) } }));
  assert.deepEqual(s.take(), []);
  assert.deepEqual(bound(), []);
});

test('a drag pans by the pointer distance as a share of the window; it starts only past the threshold', () => {
  const s = setup();
  s.handlers.pointerdown(ptr({ clientX: 30, clientY: 40 })); // container (20, 20)
  s.take();
  winListeners.pointermove(ptr({ clientX: 30 + DRAG_START_PX, clientY: 40 }));
  assert.deepEqual(s.take(), [], 'exactly the threshold: still a press');
  assert.equal(s.input.gesturing, false);
  winListeners.pointermove(ptr({ clientX: 50, clientY: 70 })); // +20, +30
  let c = s.take();
  assert.deepEqual(names(c), ['setCursor', 'dropHover', 'noteInput', 'setViewport']);
  assert.equal(c[0][1], 'grabbing');
  closeTo(c[3][1].x0, -0.2, 'x0');
  closeTo(c[3][1].x1, 0.8, 'x1');
  closeTo(c[3][1].y0, -1.8, 'y0');
  closeTo(c[3][1].y1, 4.2, 'y1');
  assert.equal(s.input.gesturing, true);
  winListeners.pointermove(ptr({ clientX: 40, clientY: 40 })); // back: relative to the start of the drag, not the last move
  c = s.take();
  assert.deepEqual(names(c), ['noteInput', 'setViewport']);
  closeTo(c[1][1].x0, -0.1, 'x0 from the drag start');
  closeTo(c[1][1].y0, 0, 'y0');
  winListeners.pointermove(ptr({ pointerId: 9, clientX: 99, clientY: 99 }));
  assert.deepEqual(s.take(), [], 'another pointer is not this drag');
  winListeners.pointerup(ptr({ clientX: 40, clientY: 40, type: 'pointerup' }));
  c = s.take();
  assert.deepEqual(c, [['setCursor', 'grab']], 'a drag ends without a click, with the grab cursor');
  assert.equal(s.input.gesturing, false);
  assert.deepEqual(bound(), []);
});

test('after a drag the cursor is the pointer when something is hovered', () => {
  const s = setup({ hovering: true });
  s.handlers.pointerdown(ptr({ clientX: 30, clientY: 40 }));
  winListeners.pointermove(ptr({ clientX: 60, clientY: 40 }));
  s.take();
  winListeners.pointerup(ptr({ clientX: 60, clientY: 40, type: 'pointerup' }));
  assert.deepEqual(s.take(), [['setCursor', 'pointer']]);
});

test('a press and release without moving is a click: picks at the container point and reports the hit with client coordinates', () => {
  const hit = { node: tip('C'), kind: 'tip' };
  const s = setup({ hit });
  s.handlers.pointerdown(ptr({ clientX: 30, clientY: 45 }));
  s.take();
  winListeners.pointerup(ptr({ clientX: 31, clientY: 46, type: 'pointerup' }));
  const c = s.take();
  assert.deepEqual(c, [
    ['setCursor', 'grab'],
    ['pick', 21, 26],
    ['click', hit, 31, 46],
  ]);
  const miss = setup({ hit: null });
  miss.handlers.pointerdown(ptr({ clientX: 30, clientY: 45 }));
  winListeners.pointerup(ptr({ clientX: 30, clientY: 45, type: 'pointerup' }));
  assert.deepEqual(names(miss.take()), ['cancelAnim', 'setCursor', 'pick'], 'nothing under the pointer: no click');
});

test('a cancelled pointer (pointercancel) ends the gesture without a click', () => {
  const s = setup({ hit: { node: 1, kind: 'node' } });
  s.handlers.pointerdown(ptr({ clientX: 30, clientY: 45 }));
  s.take();
  winListeners.pointercancel(ptr({ clientX: 30, clientY: 45, type: 'pointercancel' }));
  assert.deepEqual(names(s.take()), ['setCursor']);
  assert.deepEqual(bound(), []);
});

test('the click event that follows a drag is swallowed once; one after a plain click goes through', () => {
  const s = setup({ hit: { node: 1, kind: 'node' } });
  const ev = () => {
    const e = { prevented: 0, stopped: 0, preventDefault: () => e.prevented++, stopPropagation: () => e.stopped++ };
    return e;
  };
  s.handlers.pointerdown(ptr({ clientX: 30, clientY: 40 }));
  winListeners.pointermove(ptr({ clientX: 60, clientY: 40 }));
  winListeners.pointerup(ptr({ clientX: 60, clientY: 40, type: 'pointerup' }));
  const swallowed = ev();
  s.capture.click(swallowed);
  assert.deepEqual([swallowed.prevented, swallowed.stopped], [1, 1], 'the tip link under the pointer is not followed');
  const next = ev();
  s.capture.click(next);
  assert.deepEqual([next.prevented, next.stopped], [0, 0], 'only once');
  s.handlers.pointerdown(ptr({ clientX: 30, clientY: 40 }));
  winListeners.pointerup(ptr({ clientX: 30, clientY: 40, type: 'pointerup' }));
  const plain = ev();
  s.capture.click(plain);
  assert.deepEqual([plain.prevented, plain.stopped], [0, 0]);
});

// ---- hover

test('hover follows the mouse over the root, not a touch, not a drag; leaving drops it', () => {
  const s = setup();
  s.handlers.pointermove(ptr({ clientX: 25, clientY: 35 }));
  assert.deepEqual(s.take(), [['hover', { x: 15, y: 15 }]]);
  s.handlers.pointermove(ptr({ pointerType: 'touch' }));
  assert.deepEqual(s.take(), []);
  s.handlers.pointerdown(ptr({ clientX: 30, clientY: 40 }));
  winListeners.pointermove(ptr({ clientX: 60, clientY: 40 }));
  s.take();
  s.handlers.pointermove(ptr({ clientX: 25, clientY: 35 }));
  assert.deepEqual(s.take(), [], 'no hover lookup during a drag');
  winListeners.pointerup(ptr({ clientX: 60, clientY: 40, type: 'pointerup' }));
  s.take();
  s.handlers.pointerleave();
  assert.deepEqual(s.take(), [['hover', null]]);
});

// ---- pinch

test('pinch: two pointers scale each axis by its finger distance and keep the midpoint content under the fingers', () => {
  const s = setup();
  s.handlers.pointerdown(ptr({ pointerId: 1, pointerType: 'touch', clientX: 30, clientY: 70 })); // (20, 50)
  s.handlers.pointerdown(ptr({ pointerId: 2, pointerType: 'touch', clientX: 90, clientY: 70 })); // (80, 50)
  assert.equal(s.input.gesturing, true, 'a pinch counts as a gesture');
  s.take();
  winListeners.pointermove(ptr({ pointerId: 2, pointerType: 'touch', clientX: 150, clientY: 70 })); // (140, 50)
  const c = s.take();
  assert.deepEqual(names(c), ['noteInput', 'setViewport']);
  const v = c[1][1];
  closeTo(v.x1 - v.x0, 0.5, 'x window halves');
  closeTo(v.y1 - v.y0, 3, 'y window halves: the fingers were less than 30 px apart on y, so it follows the pinch distance');
  closeTo(v.x0, 0.1, 'x0');
  closeTo(v.y0, 1.5, 'y0');
  // lifting a finger ends the pinch; the window listeners stay until the last pointer is up
  winListeners.pointerup(ptr({ pointerId: 2, pointerType: 'touch', type: 'pointerup' }));
  assert.equal(s.input.gesturing, false);
  assert.deepEqual(bound(), ['pointercancel', 'pointermove', 'pointerup']);
  winListeners.pointerup(ptr({ pointerId: 1, pointerType: 'touch', type: 'pointerup' }));
  assert.deepEqual(bound(), []);
  assert.deepEqual(names(s.take()).includes('click'), false, 'a pinch never clicks');
});

test('pinch, radial: both axes follow the distance between the fingers; hover is off while pinching', () => {
  const s = setup({ layout: 'radial' });
  s.handlers.pointerdown(ptr({ pointerId: 1, pointerType: 'touch', clientX: 40, clientY: 70 })); // (30, 50)
  s.handlers.pointerdown(ptr({ pointerId: 2, pointerType: 'touch', clientX: 60, clientY: 70 })); // (50, 50)
  s.take();
  winListeners.pointermove(ptr({ pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 70 })); // distance 20 -> 60
  const v = s.take()[1][1];
  closeTo(v.x1 - v.x0, 2 / 3, 'zoomed in 3x: the 2.0 window becomes 2/3');
  closeTo(v.y1 - v.y0, 2 / 3, 'y too');
  s.handlers.pointermove(ptr({ clientX: 70, clientY: 70 }));
  assert.deepEqual(s.take(), [], 'no hover during a pinch');
  winListeners.pointerup(ptr({ pointerId: 1, type: 'pointerup' }));
  winListeners.pointerup(ptr({ pointerId: 2, type: 'pointerup' }));
  assert.deepEqual(bound(), []);
});

// ---- keys

const key = (k, o = {}) => ({
  key: k,
  altKey: false,
  metaKey: false,
  prevented: false,
  preventDefault() {
    this.prevented = true;
  },
  ...o,
});

test('navigation keys move the keyboard cursor from the active node and are consumed', () => {
  const s = setup({ activeNode: tip('A') });
  const e = key('ArrowDown');
  s.handlers.keydown(e);
  assert.deepEqual(s.take(), [['setActive', tip('B')]]);
  assert.equal(e.prevented, true);
  const left = key('ArrowLeft');
  s.handlers.keydown(left);
  assert.deepEqual(s.take(), [['setActive', tree.parent[tip('A')]]]);
  const edge = key('ArrowUp');
  s.handlers.keydown(edge);
  assert.deepEqual(s.take(), [['setActive', tip('A')]], 'clamped at the first tip: the cursor stays but is re-announced');
  assert.equal(edge.prevented, true);
});

test('without an active node the cursor starts at the tip at the view centre; PageDown uses the rows in view', () => {
  const s = setup();
  s.handlers.keydown(key('Home'));
  assert.deepEqual(s.take(), [['setActive', tip('A')]]);
  s.handlers.keydown(key('ArrowDown'));
  assert.deepEqual(s.take(), [['setActive', tip('E')]], 'the view centre is row 3 = D, one down is E');
  const small = setup({ activeNode: tip('A') });
  small.host.view = { x0: 0, x1: 1, y0: 0, y1: 2 };
  small.handlers.keydown(key('PageDown'));
  assert.deepEqual(small.take(), [['setActive', tip('C')]], 'a window of 2 rows: 2 tips on');
});

test('Enter and Space activate the cursor node; + - 0 zoom and fit; alt/meta combinations and other keys are left to the browser', () => {
  const s = setup({ activeNode: tip('C') });
  for (const k of ['Enter', ' ']) {
    const e = key(k);
    s.handlers.keydown(e);
    assert.deepEqual(s.take(), [['activate', tip('C')]]);
    assert.equal(e.prevented, true);
  }
  for (const k of ['+', '=']) {
    s.handlers.keydown(key(k));
    assert.deepEqual(s.take(), [['zoomBy', 1, 1.4, 50, 50]], 'about the centre of the plotting area');
  }
  for (const k of ['-', '_']) {
    s.handlers.keydown(key(k));
    assert.deepEqual(s.take(), [['zoomBy', 1, 1 / 1.4, 50, 50]]);
  }
  s.handlers.keydown(key('0'));
  assert.deepEqual(s.take(), [['fit', true]]);
  for (const e of [key('ArrowDown', { altKey: true }), key('Enter', { metaKey: true }), key('q'), key('Tab')]) {
    s.handlers.keydown(e);
    assert.deepEqual(s.take(), [], e.key);
    assert.equal(e.prevented, false, `${e.key} is not consumed`);
  }
});

test('keys on a partial tree whose centre tip is not loaded start from the root row', () => {
  const s = setup();
  s.host.tree = { ...tree, tipNode: new Int32Array(tree.tipCount).fill(-1) };
  s.handlers.keydown(key('Enter'));
  assert.deepEqual(s.take(), [['activate', 0]]);
});
