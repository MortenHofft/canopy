// The adaptive budget's controller (budget.ts): pure functions over a state object, driven here by a fake clock (frame times are given,
// nothing is measured). A step is taken the way the viewer takes it, on a settled frame, after MIN_SAMPLES measurements.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const B = await import(path.join(root, 'packages/viewer/src/budget.ts'));
const { TARGET_MS, newBudgetState, observeFrame, observeInterval, stepBudget } = B;

const LIM = { floor: 500, ceiling: 200000, saturated: false };

/** Measure `ms` for MIN_SAMPLES full frames, then step; returns whether the budget changed. */
function settle(s, ms, lim = LIM, iv = 0) {
  for (let k = 0; k < B.MIN_SAMPLES; k++) observeFrame(s, ms);
  if (iv) observeInterval(s, iv);
  return stepBudget(s, lim);
}

test('constants: 25 ms target, today starts, floors 500 / 100, ceiling 200,000, 4 degrees, 1 CSS px', () => {
  assert.equal(TARGET_MS, 25);
  assert.equal(B.START_RECT, 20000);
  assert.equal(B.START_RADIAL, 2000);
  assert.equal(B.FLOOR_RECT, 500);
  assert.equal(B.FLOOR_RADIAL, 100);
  assert.equal(B.CEILING, 200000);
  assert.equal(B.MAX_WEDGE_DEG, 4);
  assert.equal(B.MIN_THRESHOLD_PX, 1);
});

test('a frame at twice the target halves the budget; at four times, still only halved', () => {
  let s = newBudgetState(20000);
  assert.ok(settle(s, 2 * TARGET_MS));
  assert.equal(s.budget, 10000);
  s = newBudgetState(20000);
  settle(s, 4 * TARGET_MS);
  assert.equal(s.budget, 10000, 'at most halved per step');
});

test('a slightly slow frame lowers the budget a little: 30 ms is about a sixth', () => {
  const s = newBudgetState(20000);
  settle(s, 30);
  assert.equal(s.budget, Math.round((20000 * 25) / 30));
  assert.ok(s.budget > 16000 && s.budget < 17000);
});

test('a frame on the target, or just under it, changes nothing: no bouncing around 25 ms', () => {
  for (const ms of [25, 22, 18, 15.5]) {
    const s = newBudgetState(20000);
    assert.equal(settle(s, ms), false, `${ms} ms`);
    assert.equal(s.budget, 20000);
  }
});

test('a fast frame raises the budget, at most doubled per step, in proportion below that', () => {
  let s = newBudgetState(2000);
  settle(s, 1);
  assert.equal(s.budget, 4000, '1 ms: doubled at most');
  s = newBudgetState(2000);
  settle(s, 12); // 12 ms is under 60% of 25 (15): aims at 85% of the target
  assert.equal(s.budget, Math.round((2000 * 0.85 * 25) / 12));
  assert.ok(s.budget > 2000 && s.budget < 4000);
});

test('limits: never below the floor, never above the ceiling', () => {
  const s = newBudgetState(600);
  settle(s, 100);
  assert.equal(s.budget, 500, 'floor 500');
  settle(s, 100);
  assert.equal(s.budget, 500);
  const r = newBudgetState(150);
  settle(r, 100, { ...LIM, floor: 100 });
  assert.equal(r.budget, 100, 'floor 100 (radial)');
  const c = newBudgetState(150000);
  settle(c, 1);
  assert.equal(c.budget, 200000, 'ceiling 200,000');
  const d = newBudgetState(50000);
  settle(d, 1, { ...LIM, ceiling: 60000 });
  assert.equal(d.budget, 60000, 'a lower ceiling (a fixed drawBudget beside radialMaxNodes auto)');
  const e = newBudgetState(90000);
  stepBudget(e, { ...LIM, ceiling: 60000 });
  assert.equal(e.budget, 60000, 'a budget above a lowered ceiling comes down to it');
});

test('a step needs MIN_SAMPLES measurements and starts the next measurement', () => {
  const s = newBudgetState(20000);
  observeFrame(s, 100);
  assert.equal(stepBudget(s, LIM), false, 'one measurement is not enough');
  assert.equal(s.n, 1, 'and it is kept');
  observeFrame(s, 100);
  assert.equal(stepBudget(s, LIM), true);
  assert.equal(s.n, 0);
  assert.equal(s.ms, 0);
  assert.equal(stepBudget(s, LIM), false, 'nothing measured since: nothing to do');
});

test('measurements are smoothed: one slow frame among fast ones does not halve the budget', () => {
  const s = newBudgetState(20000);
  for (const ms of [5, 5, 5, 5, 40]) observeFrame(s, ms);
  assert.ok(s.ms < TARGET_MS, `smoothed ${s.ms}`);
  stepBudget(s, LIM);
  assert.ok(s.budget >= 20000, 'not lowered');
});

test('the budget is applied on settled frames only: observing never changes it', () => {
  const s = newBudgetState(20000);
  for (let k = 0; k < 50; k++) {
    observeFrame(s, 200);
    observeInterval(s, 80);
  }
  assert.equal(s.budget, 20000, 'moving frames only measure');
  stepBudget(s, LIM);
  assert.equal(s.budget, 10000, 'the settled frame applies it');
});

test('the time between animation frames can lower the budget, never raise it', () => {
  // JS time is fast, but the frames reach the screen every 50 ms: drawing the pixels dominates
  let s = newBudgetState(20000);
  settle(s, 3, LIM, 50);
  assert.equal(s.budget, 10000, '50 ms between frames: halved');
  s = newBudgetState(20000);
  settle(s, 3, LIM, 30);
  assert.equal(s.budget, Math.round((20000 * 25) / 30), '30 ms between frames: lowered a little');
  // 60 Hz is 16.7 ms between frames: a fast machine at its display's rate is not slow, and the interval does not hold a raise back
  s = newBudgetState(2000);
  settle(s, 3, LIM, 16.7);
  assert.equal(s.budget, 4000);
  // a pause is not a frame time
  s = newBudgetState(20000);
  settle(s, 3, LIM, 5000);
  assert.equal(s.budget, 40000, 'ignored: raised on the JS time');
});

test('stops raising once the last cut was not limited by the budget (no overflow, forced 0)', () => {
  const s = newBudgetState(20000);
  assert.equal(settle(s, 1, { ...LIM, saturated: true }), false);
  assert.equal(s.budget, 20000, 'fast frames, nothing to gain: level');
  // but frames that turn slow still lower it
  settle(s, 60, { ...LIM, saturated: true });
  assert.ok(s.budget < 20000);
  // and a budget-limited cut raises it again
  const before = s.budget;
  settle(s, 1, LIM);
  assert.ok(s.budget > before);
});

test('it converges: against a machine that takes 1 ms per 400 primitives the budget settles near the target, inside the limits', () => {
  const s = newBudgetState(2000);
  const frameMs = (b) => b / 400;
  const seen = [];
  for (let k = 0; k < 60; k++) {
    settle(s, frameMs(s.budget));
    seen.push(s.budget);
  }
  const last = seen.at(-1);
  assert.ok(frameMs(last) <= TARGET_MS, `${frameMs(last)} ms`);
  assert.ok(frameMs(last) >= 0.6 * TARGET_MS, 'and not far under it');
  assert.equal(seen[59], seen[40], 'level');
  // a machine ten times slower ends lower, one ten times faster at the ceiling
  const slow = newBudgetState(20000);
  for (let k = 0; k < 60; k++) settle(slow, slow.budget / 40);
  assert.ok(slow.budget < 2000 && slow.budget >= 500);
  const fast = newBudgetState(20000);
  for (let k = 0; k < 60; k++) settle(fast, fast.budget / 40000);
  assert.equal(fast.budget, 200000);
});

test('pressed: set when a step lowers the budget, cleared when frames are fast again (the wedge limit gives way meanwhile)', () => {
  const s = newBudgetState(20000);
  assert.equal(s.pressed, false);
  settle(s, 60);
  assert.equal(s.pressed, true);
  settle(s, 20); // between 60% and 100% of the target: neither
  assert.equal(s.pressed, true);
  settle(s, 5);
  assert.equal(s.pressed, false);
});

test('wedgeLimitPx: 4 degrees of arc at the outermost ring', () => {
  assert.ok(Math.abs(B.wedgeLimitPx(240) - 16.755) < 1e-3, 'the explorer: radius 240 px, about 17 px');
  assert.equal(B.wedgeLimitPx(0), 0);
});

test('wantsStep: a single measurement outside the dead zone asks for another frame; one inside does not', () => {
  const s = newBudgetState(20000);
  assert.equal(B.wantsStep(s, false), false, 'nothing measured');
  observeFrame(s, 60);
  assert.equal(B.wantsStep(s, false), true, 'slow');
  assert.equal(B.wantsStep(s, true), true, 'slow, even when saturated');
  const f = newBudgetState(20000);
  observeFrame(f, 2);
  assert.equal(B.wantsStep(f, false), true, 'fast, and the budget limits the cut');
  assert.equal(B.wantsStep(f, true), false, 'fast, and nothing more to show');
  const m = newBudgetState(20000);
  observeFrame(m, 20);
  assert.equal(B.wantsStep(m, false), false, 'on target');
});
