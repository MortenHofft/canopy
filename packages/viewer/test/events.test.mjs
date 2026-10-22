// Unit tests of the event emitter (src/events.ts) and of the event object listeners receive (toTreeEvent in src/node-event.ts):
// order, removal (also during an emit), once, default actions and preventDefault, error isolation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNewick } from '@gbif-phylo/io';

const { Emitter } = await import('../src/events.ts');
const { makeNodeEvent, toTreeEvent } = await import('../src/node-event.ts');
const { InMemorySource } = await import('../src/source.ts');

test('listeners run in the order they were added; the returned function removes one', () => {
  const em = new Emitter();
  const seen = [];
  const offA = em.on('viewchange', (v) => seen.push(['a', v.x0]));
  em.on('viewchange', (v) => seen.push(['b', v.x0]));
  em.emit('viewchange', { x0: 1, x1: 2, y0: 0, y1: 1 });
  offA();
  em.emit('viewchange', { x0: 3, x1: 4, y0: 0, y1: 1 });
  assert.deepEqual(seen, [
    ['a', 1],
    ['b', 1],
    ['b', 3],
  ]);
});

test('off by function, has, once, clear', () => {
  const em = new Emitter();
  let n = 0;
  const f = () => n++;
  em.on('resize', f);
  assert.ok(em.has('resize'));
  em.off('resize', f);
  assert.ok(!em.has('resize'));
  em.on('resize', f, { once: true });
  em.emit('resize', { width: 1, height: 1 });
  em.emit('resize', { width: 1, height: 1 });
  assert.equal(n, 1);
  assert.ok(!em.has('resize'), 'a once listener is gone after its call');
  em.on('resize', f);
  em.clear();
  em.emit('resize', { width: 1, height: 1 });
  assert.equal(n, 1);
});

test('a listener removed during an emit is not called by it (also a default action, also by clear)', () => {
  const em = new Emitter();
  const seen = [];
  let offLater = () => {};
  let offDefault = () => {};
  em.on('click', () => {
    seen.push('first');
    offLater();
    offDefault();
  });
  offLater = em.on('click', () => seen.push('later'));
  offDefault = em.on('click', () => seen.push('default'), { asDefault: true });
  em.emit('click', { defaultPrevented: false });
  assert.deepEqual(seen, ['first']);
  seen.length = 0;
  em.on('resize', () => {
    seen.push('a');
    em.clear(); // what destroy() does from inside a listener
  });
  em.on('resize', () => seen.push('b'));
  em.emit('resize', { width: 1, height: 1 });
  assert.deepEqual(seen, ['a']);
});

test('a listener added during an emit is first called by the next one', () => {
  const em = new Emitter();
  const seen = [];
  let offB = () => {};
  em.on('resize', () => {
    seen.push('a');
    offB();
    em.on('resize', () => seen.push('late'));
  });
  offB = em.on('resize', () => seen.push('b'));
  em.emit('resize', { width: 1, height: 1 });
  assert.deepEqual(seen, ['a'], 'b was removed before its turn; late was added during the emit');
  seen.length = 0;
  em.emit('resize', { width: 1, height: 1 });
  assert.deepEqual(seen, ['a', 'late']);
});

const tree = parseNewick('((A:1,B:2)AB:1,(C:1,D:1)CD:2)root;');
const source = new InMemorySource(tree);
const snap = source.snapshot();
const ev = (node) => toTreeEvent(makeNodeEvent(snap, node, snap.childCount[node] ? 'node' : 'tip', 'pointer', 10, 20), source);

test('default actions run after the ordinary listeners, whatever the order they were added in, and preventDefault skips them', () => {
  const em = new Emitter();
  const seen = [];
  em.on('click', () => seen.push('default'), { asDefault: true });
  em.on('click', () => seen.push('app'));
  em.emit('click', ev(1));
  assert.deepEqual(seen, ['app', 'default']);
  seen.length = 0;
  const stop = em.on('click', (e) => e.preventDefault());
  const e = ev(1);
  em.emit('click', e);
  assert.deepEqual(seen, ['app']);
  assert.equal(e.defaultPrevented, true);
  stop();
  em.emit('click', ev(1));
  assert.deepEqual(seen, ['app', 'app', 'default']);
});

test('a throwing listener does not stop the others', async () => {
  const em = new Emitter();
  const seen = [];
  const reported = [];
  const orig = globalThis.reportError;
  globalThis.reportError = (err) => reported.push(err.message);
  try {
    em.on('resize', () => {
      throw new Error('boom');
    });
    em.on('resize', () => seen.push('after'));
    em.emit('resize', { width: 1, height: 1 });
  } finally {
    globalThis.reportError = orig;
  }
  assert.deepEqual(seen, ['after']);
  assert.deepEqual(reported, ['boom']);
});

test('TreeEvent: ids, tip count, tip helpers, defaultPrevented', async () => {
  const e = ev(1);
  assert.equal(e.node, 1);
  assert.ok(!('nodeId' in e), 'no string form of the node id (#30)');
  assert.equal(e.isTip, false);
  assert.equal(e.tipCount, 2);
  assert.deepEqual(e.tipIds(), ['A', 'B']);
  assert.deepEqual(await e.tipLabels(), ['A', 'B']);
  assert.equal(e.clientX, 10);
  assert.equal(e.defaultPrevented, false);
  e.preventDefault();
  assert.equal(e.defaultPrevented, true);
  const tip = ev(tree.tipIndex('C'));
  assert.equal(tip.isTip, true);
  assert.equal(tip.tipId, 'C');
  assert.deepEqual(tip.tipIds(), ['C']);
});
