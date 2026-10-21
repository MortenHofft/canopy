// Unit tests of live() (src/core/live.ts): the object a module reads the renderer's state through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { live } = await import(path.join(root, 'packages/viewer/src/live.ts'));

test('every property is read at access time, so a replaced field is seen and nothing is copied', () => {
  let tree = { id: 1 };
  let n = 5;
  const o = live({ tree: () => tree, n: () => n }, {});
  assert.equal(o.tree, tree);
  tree = { id: 2 };
  n = 6;
  assert.equal(o.tree.id, 2);
  assert.equal(o.n, 6);
  let reads = 0;
  const counted = live({ x: () => ++reads }, {});
  assert.equal(counted.x, 1);
  assert.equal(counted.x, 2, 'the getter runs on every access');
});

test('methods are copied as they are; a method sees the object as its `this`, so it can read the live properties', () => {
  let v = 1;
  const fn = function () {
    return this.v * 10;
  };
  const o = live({ v: () => v }, { go: fn });
  assert.equal(o.go, fn, 'the same function, not a wrapper');
  assert.equal(o.go(), 10);
  v = 4;
  assert.equal(o.go(), 40);
});

test('properties are enumerable getters without a setter: listed and spread, not assignable', () => {
  const o = live({ a: () => 1, b: () => 2 }, { m: () => 3 });
  assert.deepEqual(Object.keys(o).sort(), ['a', 'b', 'm']);
  assert.deepEqual({ ...o }, { a: 1, b: 2, m: o.m });
  const d = Object.getOwnPropertyDescriptor(o, 'a');
  assert.equal(typeof d.get, 'function');
  assert.equal(d.set, undefined);
  assert.equal(d.enumerable, true);
  assert.throws(() => {
    o.a = 5;
  }, TypeError);
  assert.equal(o.a, 1);
});

test('no properties, no methods, and a property that shadows nothing in the methods object', () => {
  assert.deepEqual(Object.keys(live({}, {})), []);
  const methods = { m: () => 'm' };
  const o = live({ p: () => 'p' }, methods);
  assert.notEqual(o, methods, 'a new object; the methods object is not modified');
  assert.deepEqual(Object.keys(methods), ['m']);
  assert.equal(o.m(), 'm');
  assert.equal(o.p, 'p');
});
