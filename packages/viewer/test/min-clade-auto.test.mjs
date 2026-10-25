// `minCladePx: 'auto'` (the default, #122): in the radial layout with `radialMaxNodes: 'auto'` the cut starts at 1 px, so nothing whose arc
// at its farthest tip is 1 px or more is folded while the list fits, and only the budget, which follows the frame rate, folds more.
// Elsewhere 'auto' is the 3 px the option had before, and a number is used as it is in either layout.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeViewer, destroyAll } from './viewer-harness.mjs';

afterEach(destroyAll);

// two 30-tip polytomies (runs once their tips are under the threshold) and a few small clades, all tips on the outermost ring
const tips = (q, n) => Array.from({ length: n }, (_, i) => `${q}${i}:1.5`).join(',');
const NWK = `(${tips('p', 30)},(s1:1):0.5,(c0:1,c1:1,c2:1):0.5,${tips('q', 30)},(d0:1,d1:1,d2:1):0.5);`;

function balanced(n) {
  const go = (m, p) => (m === 1 ? `${p}:1` : `(${go(m / 2, p + 'a')},${go(m / 2, p + 'b')}):1`);
  return go(n, 't') + ';';
}

async function stats(nwk, options, size) {
  const { viewer, env } = await makeViewer(nwk, { options: { refineMs: 0, ...options }, size });
  env.flush();
  viewer.invalidate();
  env.flush();
  return { st: viewer.getStats(), pitch: viewer.proj.tipPitch, viewer };
}

test("radial, 'auto' with the adaptive budget: tips 2 to 3 px apart are all drawn, the base threshold is 1 px", async () => {
  const { st, pitch, viewer } = await stats(NWK, { layout: 'radial' }, [100, 100]);
  assert.equal(viewer.options.minCladePx, 'auto');
  assert.equal(viewer.options.radialMaxNodes, 'auto');
  assert.ok(pitch > 1 && pitch < 3, `pitch ${pitch}`);
  assert.equal(st.minPxBase, 1);
  assert.equal(st.minPxUsed, 1);
  assert.equal(st.summaries, 0);
  assert.equal(st.tips, 67);
});

test("radial, 'auto' with a fixed radialMaxNodes, and a number with the adaptive budget: the threshold is 3 px, and the tips fold", async () => {
  for (const options of [{ radialMaxNodes: 2000 }, { minCladePx: 3 }]) {
    const { st, pitch } = await stats(NWK, { layout: 'radial', ...options }, [100, 100]);
    assert.ok(pitch > 1 && pitch < 3, `pitch ${pitch}`);
    assert.equal(st.minPxBase, 3, JSON.stringify(options));
    assert.ok(st.summaries > 0, JSON.stringify(options));
  }
});

test("rectangular, 'auto': the threshold under 1 px rows is 3 px, as before", async () => {
  const { st, pitch } = await stats(balanced(1024), { layout: 'rectangular' }, [400, 300]);
  assert.ok(pitch < 1, `rows of ${pitch} px`);
  assert.equal(st.minPxBase, 3);
  assert.ok(st.summaries > 0);
});

test("radial, 'auto': a list over the budget still folds, from 1 px up", async () => {
  const { st } = await stats(balanced(16384), { layout: 'radial' }, [600, 600]);
  assert.equal(st.minPxBase, 1);
  assert.ok(st.minPxUsed > 1, `minPxUsed ${st.minPxUsed}`);
  assert.ok(st.summaries > 0);
});
