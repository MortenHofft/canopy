// Unit tests of the radial branch width: dense frames draw branches one device pixel wide (Skia's hairline path), sparse ones at the theme's
// branchWidth, and between 500 and 900 primitives the width fades from one to the other, so zooming across the band changes it gradually.
// Rectangular branches keep branchWidth however many primitives there are.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeViewer, destroyAll } from './viewer-harness.mjs';

afterEach(destroyAll);

/** A comb of n tips: 2n - 1 primitives with lod off. */
function comb(n) {
  let s = 't0:1';
  for (let i = 1; i < n; i++) s = `(${s},t${i}:1):1`;
  return s + ';';
}

/** The primitives drawn and the line width of the branches (the first width set in the frame) for a comb of n tips. */
async function branchWidth(n, layout = 'radial') {
  const { viewer, env, ctx } = await makeViewer(comb(n), { size: [600, 400], options: { layout, lod: false } });
  env.flush();
  return { drawn: viewer.getStats().drawn, width: ctx().calls('lineWidth=')[0][1] };
}

test('radial: branchWidth under 500 primitives, one device pixel from 900, faded in between', async () => {
  const sparse = await branchWidth(200);
  assert.ok(sparse.drawn < 500, `${sparse.drawn} primitives`);
  assert.equal(sparse.width, 1.3, 'the theme width');

  const dense = await branchWidth(500);
  assert.ok(dense.drawn >= 900, `${dense.drawn} primitives`);
  assert.equal(dense.width, 1, 'one device pixel (dpr 1)');

  const widths = [];
  for (const n of [280, 330, 380, 430]) {
    const { drawn, width } = await branchWidth(n);
    assert.ok(drawn > 500 && drawn < 900, `${drawn} primitives`);
    assert.ok(width < 1.3 && width > 1, `${drawn} primitives: ${width} is between the two`);
    widths.push(width);
  }
  for (let i = 1; i < widths.length; i++) assert.ok(widths[i] < widths[i - 1], `thinner with more primitives: ${widths}`);
});

test('rectangular: branchWidth however many primitives', async () => {
  const { drawn, width } = await branchWidth(500, 'rectangular');
  assert.ok(drawn >= 900, `${drawn} primitives`);
  assert.equal(width, 1.3);
});
