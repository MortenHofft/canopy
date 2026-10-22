// The wheel over the overview, end to end with a fake host: a wheel event on the wrap -> overviewWorldPoint -> host.zoomAtWorld, and the
// events it leaves alone (a horizontal swipe goes on to the control layer). The zoom arithmetic itself is in view-state.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, FakeElement } from './fake-dom.mjs';

installFakeDom();
FakeElement.prototype.getContext = () => ({}); // the canvas is never drawn here
const { Overview, overviewWorldPoint } = await import('../src/overview.ts');

function setup(layout = 'rectangular') {
  const calls = [];
  const area = { ax: 10, ay: 8, aw: 500, ah: 400, clipL: 0, clipT: 8, clipR: 700, clipB: 408 };
  const host = {
    layout,
    enabled: true,
    W: 800,
    H: 600,
    dpr: 1,
    view: { x0: 0, x1: 1, y0: 450, y1: 550 },
    area,
    tree: { tipCount: 1000 },
    L: { rows: 1000 },
    noteInput: () => calls.push(['noteInput']),
    cancelAnim() {},
    setViewport() {},
    zoomAtWorld: (...a) => calls.push(['zoomAtWorld', ...a]),
  };
  const wrap = new FakeElement('div');
  const ov = new Overview(host, false, wrap);
  wrap.getBoundingClientRect = () => ({ left: 700, top: 8, width: 56, height: 400 });
  const wheel = (init) => {
    const e = { type: 'wheel', deltaMode: 0, deltaX: 0, deltaY: 0, clientX: 728, clientY: 108, prevented: 0, stopped: 0, ...init };
    e.preventDefault = () => e.prevented++;
    e.stopPropagation = () => e.stopped++;
    for (const f of wrap.listeners.wheel ?? []) f(e);
    return e;
  };
  return { calls, host, wheel, ov, wrap };
}

test('wheel over the overview: zoom about the world point under the pointer, and the control layer does not get the event', () => {
  const { calls, wheel, host } = setup();
  const e = wheel({ deltaY: -100 });
  assert.equal(e.prevented, 1);
  assert.equal(e.stopped, 1);
  const g = { x: 0, y: 0, w: 56, h: 400 };
  const p = overviewWorldPoint('rectangular', g, 28, 100, 1000);
  assert.deepEqual(
    calls.map((c) => c[0]),
    ['noteInput', 'zoomAtWorld'],
  );
  const [, fx, fy, wx, wy] = calls[1];
  assert.equal(fx, 1);
  assert.ok(fy > 1);
  assert.equal(wx, p.x);
  assert.equal(wy, p.y);
  assert.equal(wy, 250);
  calls.length = 0;
  wheel({ deltaY: -100, ctrlKey: true });
  assert.ok(calls[1][1] > 1 && calls[1][2] === 1, 'ctrl: along x only, as over the tree');
  assert.equal(host.view.y0, 450);
});

test('wheel over the radial overview: both axes, at the layout point of the pointer', () => {
  const { calls, wheel } = setup('radial');
  wheel({ deltaY: 100, clientX: 700 + 10, clientY: 8 + 20 });
  const [, fx, fy] = calls[1];
  assert.ok(fx < 1 && fx === fy);
});

test('a mostly horizontal swipe over the rectangular strip is left to the control layer (a pan)', () => {
  const { calls, wheel } = setup();
  const e = wheel({ deltaX: 100, deltaY: 5 });
  assert.equal(e.prevented, 0);
  assert.equal(e.stopped, 0);
  assert.deepEqual(calls, []);
});
