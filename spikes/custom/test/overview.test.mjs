// Unit tests of the overview geometry (src/core/overview.ts): where the strip / disc is, where the window box sits, which window a
// pointer position means. The DOM and canvas parts are covered by scripts/check-radial-ui.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { overviewGeom, overviewBox, overviewTarget } = await import(path.join(root, 'spikes/custom/src/core/overview.ts'));
const K = await import(path.join(root, 'spikes/custom/src/core/constants.ts'));

const area = { ax: 10, ay: 8, aw: 500, ah: 400, clipL: 0, clipT: 8, clipR: 700, clipB: 408 };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('geometry: off, a strip along the right edge, a disc bottom left', () => {
  assert.equal(overviewGeom('rectangular', false, 800, 600, area), null);
  assert.deepEqual(overviewGeom('rectangular', true, 800, 600, area), { x: 800 - K.OVERVIEW_STRIP_W_PX - 4, y: 8, w: K.OVERVIEW_STRIP_W_PX, h: 400 });
  assert.deepEqual(overviewGeom('radial', true, 800, 600, area), {
    x: 10,
    y: 600 - K.OVERVIEW_DISC_PX - 34,
    w: K.OVERVIEW_DISC_PX,
    h: K.OVERVIEW_DISC_PX,
  });
});

test('box, rectangular: rows map to the strip height, x to its width, with minimum sizes and clipping', () => {
  const g = { x: 0, y: 0, w: 56, h: 400 };
  const b = overviewBox('rectangular', g, { x0: 0, x1: 1, y0: 100, y1: 200 }, 1000);
  near(b.y, 40);
  near(b.h, 40);
  near(b.x, 2);
  near(b.w, 52);
  const tiny = overviewBox('rectangular', g, { x0: 0.5, x1: 0.5001, y0: 500, y1: 500.1 }, 1000);
  assert.equal(tiny.w, 4);
  assert.equal(tiny.h, 3);
  const over = overviewBox('rectangular', g, { x0: -1, x1: 2, y0: -50, y1: 5000 }, 1000);
  near(over.y, 0);
  near(over.h, 400);
});

test('box, radial: the world square maps onto the disc, clipped to it, at least 4 px', () => {
  const g = { x: 0, y: 0, w: 104, h: 104 };
  const whole = overviewBox(
    'radial',
    g,
    { x0: -K.OVERVIEW_WORLD_HALF, x1: K.OVERVIEW_WORLD_HALF, y0: -K.OVERVIEW_WORLD_HALF, y1: K.OVERVIEW_WORLD_HALF },
    100,
  );
  near(whole.x, 0);
  near(whole.w, 104);
  const small = overviewBox('radial', g, { x0: 0, x1: 0.001, y0: 0, y1: 0.001 }, 100);
  assert.equal(small.w, 4);
  assert.equal(small.h, 4);
  near(small.x, 52);
});

test('target, rectangular: the pointer sets the window centre; a window spanning the whole tree in x keeps its x range', () => {
  const g = { x: 0, y: 0, w: 56, h: 400 };
  const v = { x0: 0.2, x1: 0.4, y0: 100, y1: 140 };
  const t = overviewTarget('rectangular', g, 29, 200, v, 1000);
  near((t.y0 + t.y1) / 2, 500);
  near(t.y1 - t.y0, 40);
  near((t.x0 + t.x1) / 2, (29 - 2) / 52);
  near(t.x1 - t.x0, 0.2);
  const full = overviewTarget('rectangular', g, 10, 0, { x0: -0.3, x1: 1.3, y0: 0, y1: 1000 }, 1000);
  near(full.x0, -0.3);
  near(full.x1, 1.3);
});

test('target, radial: pointer position -> world coordinates, inverse of the box mapping', () => {
  const g = { x: 0, y: 0, w: 104, h: 104 };
  const v = { x0: -0.2, x1: 0.2, y0: -0.1, y1: 0.1 };
  const box = overviewBox('radial', g, v, 100);
  const t = overviewTarget('radial', g, box.x + box.w / 2, box.y + box.h / 2, v, 100);
  near(t.x0, v.x0);
  near(t.x1, v.x1);
  near(t.y0, v.y0);
  near(t.y1, v.y1);
});
