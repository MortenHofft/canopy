// Unit tests of the input controller (src/core/input.ts) with a fake root element and a recording host: no DOM needed, the controller
// only registers listeners on the root and reads its bounding rect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));
const { InMemorySource } = await import(path.join(root, 'packages/viewer/src/source.ts'));
const { InputController } = await import(path.join(root, 'packages/viewer/src/input.ts'));

// A snapshot as a partial source gives it: rows are not the node ids of the full tree (here the rows are the full tree's ids minus 100).
const full = new InMemorySource(parseNewick('((A:1,B:2)AB:1,(C:1,(D:2,E:3)DE:1)CDE:2,F:4)root;')).snapshot();
const partial = { ...full, globalId: Int32Array.from({ length: full.nodeCount }, (_, i) => i + 100), toLocal: (id) => id - 100 };

function setup(hit) {
  const handlers = {};
  const fakeRoot = { addEventListener: (type, fn) => (handlers[type] = fn), getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const calls = [];
  const host = {
    layout: 'rectangular',
    area: { ax: 0, ay: 0, aw: 100, ah: 100, clipL: 0, clipT: 0, clipR: 100, clipB: 100 },
    view: { x0: 0, x1: 1, y0: 0, y1: 6 },
    tree: partial,
    activeNode: -1,
    hovering: false,
    noteInput() {},
    cancelAnim() {},
    setViewport() {},
    zoomBy() {},
    fit: (animate) => calls.push(['fit', animate]),
    zoomToRow: (row, animate) => calls.push(['zoomToRow', row, animate]),
    setCursor() {},
    pick: () => hit,
    click() {},
    hover: (p) => calls.push(['hover', p]),
    dropHover: () => calls.push(['dropHover']),
    setActive() {},
    activate() {},
  };
  new InputController(fakeRoot, host);
  return { handlers, calls };
}

test("double-click on a clade passes the hit row through unconverted (the id conversion is the facade's, covered by the browser check)", () => {
  const de = full.parent[full.tipIndex('D')];
  const { handlers, calls } = setup({ node: de, kind: 'node' });
  handlers.dblclick({ clientX: 5, clientY: 5 });
  assert.deepEqual(calls, [['zoomToRow', de, true]]);
});

test('double-click on a tip does nothing, on empty space fits', () => {
  let s = setup({ node: full.tipIndex('A'), kind: 'tip' });
  s.handlers.dblclick({ clientX: 5, clientY: 5 });
  assert.deepEqual(s.calls, []);
  s = setup(null);
  s.handlers.dblclick({ clientX: 5, clientY: 5 });
  assert.deepEqual(s.calls, [['fit', true]]);
});

test('the pointer leaving tells the host to drop the pending hover and the hover state', () => {
  const { handlers, calls } = setup(null);
  handlers.pointerleave();
  assert.deepEqual(calls, [['hover', null]]);
});
