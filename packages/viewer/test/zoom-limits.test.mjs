// Viewer-level tests of the zoom limits and the font-relative sizes (#38): the limits follow options and the theme's labelSize after
// the fact, and the label thresholds read the theme's labelSize.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { makeViewer, destroyAll } = await import('./viewer-harness.mjs');

afterEach(destroyAll);

function ladder(n) {
  let s = 't0:1';
  for (let i = 1; i < n; i++) s = `(${s},t${i}:${1 + (i % 3)}):1`;
  return s + ';';
}
const rowPx = (m) => {
  const v = m.viewer.getViewport();
  return m.viewer.vs.area.ah / (v.y1 - v.y0);
};

test('a new maxTipSpacing clamps a zoomed view at once', async () => {
  const m = await makeViewer(ladder(100), { options: { maxTipSpacing: Infinity }, size: [500, 400] });
  m.env.flush();
  m.viewer.setViewport({ x0: 0, x1: 1, y0: 10, y1: 12 });
  assert.ok(rowPx(m) > 100, 'no cap: deep zoom allowed');
  m.viewer.setOptions({ maxTipSpacing: 20 });
  assert.ok(Math.abs(rowPx(m) - 20) < 1e-9, `clamped to the new cap (${rowPx(m)})`);
});

test('a change of labelSize moves the font-relative cap and clamps a zoomed view', async () => {
  const m = await makeViewer(ladder(100), { options: { maxTipSpacing: '2em' }, theme: { labelSize: 26 }, size: [500, 400] });
  m.env.flush();
  m.viewer.setViewport({ x0: 0, x1: 1, y0: 10, y1: 12 });
  assert.ok(Math.abs(rowPx(m) - 52) < 1e-9, `2 em at 26 px (${rowPx(m)})`);
  m.viewer.updateTheme({ labelSize: 13 });
  assert.ok(Math.abs(rowPx(m) - 26) < 1e-9, `2 em at 13 px (${rowPx(m)})`);
});

test('a fitted view stays fitted when the cap changes', async () => {
  const m = await makeViewer(ladder(100), { size: [500, 400] });
  m.env.flush();
  const fit = m.viewer.getViewport();
  m.viewer.setOptions({ maxTipSpacing: 5 });
  assert.deepEqual(m.viewer.getViewport(), fit);
});

test('a maxTipSpacing that is not a size warns once and applies no cap', async () => {
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    const m = await makeViewer(ladder(100), { options: { maxTipSpacing: '30px' }, size: [500, 400] });
    m.env.flush();
    m.viewer.setViewport({ x0: 0, x1: 1, y0: 10, y1: 12 });
    assert.ok(rowPx(m) > 100, 'no cap');
    m.viewer.setViewport({ x0: 0, x1: 1, y0: 10, y1: 11.9 });
    assert.equal(warns.length, 1);
  } finally {
    console.warn = orig;
  }
});

test('labels need rows scaled with the theme labelSize', async () => {
  const labels = (m) =>
    m
      .ctx()
      .calls('fillText')
      .filter((e) => /^[a-d]$/.test(e[1])).length;
  const small = await makeViewer('((a:1,b:1):1,(c:1,d:1):1);', { theme: { labelSize: 13 }, size: [400, 200] });
  small.env.flush();
  assert.equal(labels(small), 4, 'rows of about 35 px carry labels at 13 px');
  const big = await makeViewer('((a:1,b:1):1,(c:1,d:1):1);', { theme: { labelSize: 60 }, size: [400, 200] });
  big.env.flush();
  assert.equal(labels(big), 0, 'the same rows are too narrow for 60 px labels (the threshold is 11 * 60 / 13 = 50.8 px)');
});
