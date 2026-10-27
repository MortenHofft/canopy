// interactionLOD: frames drawn while the view moves are reduced always (true), never (false), or only once the full-quality frames are
// slow ('auto', the default). The frame time is the viewer's own JS time (performance.now), stubbed here so that each frame takes `cost`
// ms however often render() reads the clock: the first read of a frame gives its start, every later read the start plus `cost`. The
// start is the harness's frame clock, which an animation also reads (its start time comes from performance.now).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeViewer, destroyAll } from './viewer-harness.mjs';

afterEach(destroyAll);

const realNow = performance.now.bind(performance);
afterEach(() => {
  performance.now = realNow;
});

const NEWICK = '(((a,b)ab,(c,d)cd)abcd,((e,f)ef,(g,h)gh)efgh)r;';

/** A viewer whose frames each take `clock.cost` ms. `frame()` runs one frame round; `frames` collects `reduced` of each frame drawn. */
async function setup(options) {
  const { viewer, env } = await makeViewer(NEWICK, { options: { refineMs: 0, ...options } });
  const clock = { cost: 0.1, start: 0, first: true };
  performance.now = () => {
    if (!clock.first) return clock.start + clock.cost;
    clock.first = false;
    return clock.start;
  };
  const frame = () => {
    clock.start = env.now();
    clock.first = true;
    env.frame();
  };
  /** Start an animated move to tip `label` (an animation step counts as input, as a drag or wheel would). */
  const gesture = (label) => {
    clock.start = env.now();
    clock.first = true;
    viewer.zoomToNode(viewer.getTree().tipIndex(label), true);
  };
  const frames = [];
  viewer.on('frame', (s) => frames.push(s.reduced));
  return { viewer, frame, gesture, frames, clock };
}

/** Run `n` frame rounds, reading the clock fresh for each. */
function run(frame, n) {
  for (let k = 0; k < n; k++) frame();
}

const refine = () => new Promise((r) => setTimeout(r, 5)); // the refine timer (refineMs 0) fires

/** Draw full frames at `cost`, then animate to a tip and return `reduced` of each frame drawn while the animation runs. */
async function moving(options, cost) {
  const { viewer, frame, gesture, frames, clock } = await setup(options);
  clock.cost = cost;
  run(frame, 1); // the first full frame (not measured)
  viewer.invalidate();
  run(frame, 1); // the second, measured
  frames.length = 0;
  gesture('a');
  run(frame, 5);
  return frames;
}

test("'auto' is the default", async () => {
  const { DEFAULT_OPTIONS } = await import('../src/types.ts');
  assert.equal(DEFAULT_OPTIONS.interactionLOD, 'auto');
});

test("'auto' keeps full quality while moving when full frames are fast", async () => {
  const seen = await moving({}, 0.1);
  assert.ok(seen.length > 0 && seen.every((r) => !r), `no reduced frame: ${seen}`);
});

test("'auto' reduces while moving once full frames are slow", async () => {
  const seen = await moving({}, 30);
  assert.ok(seen.length > 0 && seen.every((r) => r), `every frame reduced: ${seen}`);
});

test("'auto' does not count the first full frame: a slow first frame alone does not reduce", async () => {
  const { frame, gesture, frames, clock } = await setup({});
  clock.cost = 500;
  run(frame, 1);
  clock.cost = 0.1;
  frames.length = 0;
  gesture('a');
  run(frame, 3);
  assert.ok(frames.length > 0 && frames.every((r) => !r), `no reduced frame: ${frames}`);
});

test("'auto' recovers: the full frame after a gesture measures again, and the next gesture is full quality when it is fast", async () => {
  const { viewer, frame, gesture, frames, clock } = await setup({});
  clock.cost = 30;
  run(frame, 1);
  viewer.invalidate();
  run(frame, 1);
  frames.length = 0;
  gesture('a');
  run(frame, 3);
  assert.ok(frames.length > 0 && frames.every((r) => r), `slow: the gesture is reduced (${frames})`);
  // the tree got cheap (zoomed in, say): the full frames after the gesture bring the average down
  clock.cost = 0.1;
  run(frame, 60); // the animation ends
  assert.ok(frames[frames.length - 1], 'the last animation frame is still reduced: the gesture has not re-measured');
  await refine();
  run(frame, 1); // the refine frame, full quality, measures 0.1 ms
  assert.equal(frames[frames.length - 1], false, 'the frame after the gesture is full quality');
  for (let k = 0; k < 3; k++) {
    viewer.invalidate();
    run(frame, 1); // more full frames bring the average under the threshold
  }
  frames.length = 0;
  gesture('h');
  run(frame, 3);
  assert.ok(frames.length > 0 && frames.every((r) => !r), `fast again: the next gesture is full quality (${frames})`);
});

test('true reduces while moving, even when full frames are fast', async () => {
  const seen = await moving({ interactionLOD: true }, 0.1);
  assert.ok(seen.length > 0 && seen.every((r) => r), `every frame reduced: ${seen}`);
});

test('false never reduces, even when full frames are slow', async () => {
  const seen = await moving({ interactionLOD: false }, 30);
  assert.ok(seen.length > 0 && seen.every((r) => !r), `no reduced frame: ${seen}`);
});

test('reduced frames start their threshold search from the last reduced frame, not from the bottom of the ladder (#93)', async () => {
  // an equal-branch comb of 20k tips, radial, zoomed in step by step while moving: a cold search climbs 35 to 60 rungs per frame
  let nwk = 't0:1';
  for (let i = 1; i < 20000; i++) nwk = `(${nwk},t${i}:1):1`;
  const options = { layout: 'radial', minCladePx: 14, drawBudget: 2000, radialMaxNodes: 2000, interactionLOD: true, refineMs: 1e5 };
  const { viewer, env } = await makeViewer(nwk + ';', { options, size: [800, 600] });
  env.flush();
  const frames = [];
  viewer.on('frame', (s) => frames.push({ reduced: s.reduced, passes: s.budgetRetries + 1, drawn: s.drawn, budget: s.budget }));
  for (const f of [2, 2, 2, 2, 2, 2, 1.02, 1.02]) {
    viewer.noteInput(); // the view moves, as on a wheel or drag
    viewer.zoomBy(f, f, 400, 300);
    env.flush();
  }
  assert.equal(frames.length, 8);
  assert.ok(
    frames.every((f) => f.reduced && f.budget === 500 && f.drawn <= 500),
    JSON.stringify(frames),
  );
  assert.ok(frames[0].passes > 20, `the first reduced frame has no hint: ${frames[0].passes} passes`);
  for (const f of frames.slice(1)) assert.ok(f.passes <= 15, `a later reduced frame: ${f.passes} passes`);
});
