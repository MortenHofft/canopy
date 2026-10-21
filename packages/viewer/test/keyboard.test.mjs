// Unit tests of the keyboard cursor (src/core/keyboard.ts) and of the NodeEvent builder (src/core/node-event.ts) on a tiny tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));
const { InMemorySource } = await import(path.join(root, 'packages/viewer/src/source.ts'));
const { defaultActiveNode, isNavigationKey, navigate, pageRows } = await import(path.join(root, 'packages/viewer/src/keyboard.ts'));
const { makeNodeEvent } = await import(path.join(root, 'packages/viewer/src/node-event.ts'));

// preorder: 0 root, 1 AB, 2 A, 3 B, 4 CDE, 5 C, 6 DE, 7 D, 8 E, 9 F; tip ranks A0 B1 C2 D3 E4 F5
const t = new InMemorySource(parseNewick('((A:1,B:2)AB:1,(C:1,(D:2,E:3)DE:1)CDE:2,F:4)root;')).snapshot();
const tip = (label) => t.tipIndex(label);
const step = (node, key, rows = 3) => navigate(t, node, key, rows);

test('Down / Up walk the tips in tree order and stop at the ends', () => {
  assert.equal(step(tip('A'), 'ArrowDown'), tip('B'));
  assert.equal(step(tip('B'), 'ArrowDown'), tip('C'));
  assert.equal(step(tip('F'), 'ArrowDown'), tip('F'), 'clamped at the last tip');
  assert.equal(step(tip('C'), 'ArrowUp'), tip('B'));
  assert.equal(step(tip('A'), 'ArrowUp'), tip('A'), 'clamped at the first tip');
});

test('Down from a clade skips its tips, Up goes to the tip before it', () => {
  const ab = t.parent[tip('A')];
  const de = t.parent[tip('D')];
  assert.equal(step(ab, 'ArrowDown'), tip('C'));
  assert.equal(step(de, 'ArrowDown'), tip('F'));
  assert.equal(step(de, 'ArrowUp'), tip('C'));
});

test('Page keys move by the given number of tips, Home and End jump to the ends', () => {
  assert.equal(step(tip('A'), 'PageDown', 3), tip('D'));
  assert.equal(step(tip('E'), 'PageDown', 3), tip('F'), 'clamped');
  assert.equal(step(tip('E'), 'PageUp', 3), tip('B'));
  assert.equal(step(tip('D'), 'Home'), tip('A'));
  assert.equal(step(tip('B'), 'End'), tip('F'));
});

test('Left goes to the parent (the root stays), Right to the first child (a tip stays)', () => {
  const ab = t.parent[tip('A')];
  assert.equal(step(tip('A'), 'ArrowLeft'), ab);
  assert.equal(step(ab, 'ArrowLeft'), 0);
  assert.equal(step(0, 'ArrowLeft'), 0);
  assert.equal(step(0, 'ArrowRight'), t.firstChild[0]);
  assert.equal(step(ab, 'ArrowRight'), tip('A'));
  assert.equal(step(tip('A'), 'ArrowRight'), tip('A'));
});

test('other keys are not navigation', () => {
  assert.equal(step(0, 'q'), -1);
  assert.equal(isNavigationKey('q'), false);
  for (const k of ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', 'ArrowLeft', 'ArrowRight']) assert.equal(isNavigationKey(k), true);
});

test('pageRows: the rows in view for the rectangular layout, 10 for the radial one', () => {
  assert.equal(pageRows('rectangular', { x0: 0, x1: 1, y0: 3, y1: 27.5 }), 24);
  assert.equal(pageRows('rectangular', { x0: 0, x1: 1, y0: 3, y1: 3.5 }), 1);
  assert.equal(pageRows('radial', { x0: -1, x1: 1, y0: -1, y1: 1 }), 10);
});

test('defaultActiveNode: the tip row at the view centre (rectangular), the tip at the view centre angle (radial)', () => {
  assert.equal(defaultActiveNode(t, 'rectangular', { x0: 0, x1: 1, y0: 0, y1: 6 }), tip('D'));
  assert.equal(defaultActiveNode(t, 'rectangular', { x0: 0, x1: 1, y0: 100, y1: 200 }), tip('F'), 'clamped to the last row');
  assert.equal(defaultActiveNode(t, 'radial', { x0: -1, x1: 1, y0: -1, y1: 1 }), tip('A'), 'centred on the root: the first tip');
  // centre at angle pi (x < 0, y = 0): half way round = rank 3
  assert.equal(defaultActiveNode(t, 'radial', { x0: -1.5, x1: -0.5, y0: -0.5, y1: 0.5 }), tip('D'));
});

test('makeNodeEvent: a tip, a clade, and a run of siblings', () => {
  const a = tip('A');
  const e = makeNodeEvent(t, a, 'tip', 'keyboard', 10, 20);
  assert.deepEqual(e, { node: a, isTip: true, tipId: 'A', kind: 'tip', tipStart: 0, tipEnd: 1, clientX: 10, clientY: 20, via: 'keyboard' });
  const de = t.parent[tip('D')];
  const c = makeNodeEvent(t, de, 'node', 'pointer', 1, 2);
  assert.equal(c.isTip, false);
  assert.equal(c.tipId, null);
  assert.deepEqual([c.tipStart, c.tipEnd], [3, 5]);
  // a run of the adjacent siblings C and DE
  const run = makeNodeEvent(t, t.parent[tip('C')], 'summary', 'pointer', 0, 0, { first: tip('C'), last: de });
  assert.equal(run.isTip, false);
  assert.deepEqual([run.tipStart, run.tipEnd], [2, 5]);
  assert.deepEqual(run.run, { clades: 1, single: 1 });
  assert.equal(run.node, t.parent[tip('C')], 'reported under the parent');
});
