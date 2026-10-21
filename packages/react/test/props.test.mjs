// Unit tests of the identity rules behind <TreeView>'s props (no DOM, no React rendering): the pure helpers of src/react/props.ts, the theme
// comparison and the column reuse of the renderer's setters (updateColumns). The effects themselves are exercised by scripts/check-radial-ui.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { shallowEqualOwn, stripUndefined, changedKeys } = await import(path.join(root, 'packages/react/src/props.ts'));
const { themeEquals, FALLBACK_THEME } = await import(path.join(root, 'packages/viewer/src/types.ts'));
const { updateColumns, columnSpecEquals } = await import(path.join(root, 'packages/viewer/src/columns.ts'));

test('shallowEqualOwn: same own values by Object.is, functions by identity', () => {
  const f = () => 1;
  assert.ok(shallowEqualOwn({ a: 1, b: 'x', f }, { a: 1, b: 'x', f }));
  assert.ok(shallowEqualOwn(undefined, {}));
  assert.ok(shallowEqualOwn(null, undefined));
  assert.ok(!shallowEqualOwn({ a: 1 }, { a: 2 }));
  assert.ok(!shallowEqualOwn({ f: () => 1 }, { f: () => 1 }), 'an inline function is a change');
  assert.ok(!shallowEqualOwn({ a: 1 }, { a: 1, b: undefined }), 'a key present with undefined differs in shape');
  assert.ok(!shallowEqualOwn({ a: 1, b: 2 }, { a: 1, c: 2 }), 'same number of keys, different names');
  assert.ok(shallowEqualOwn({ n: NaN }, { n: NaN }), 'Object.is: NaN equals NaN');
  assert.ok(!shallowEqualOwn({ o: {} }, { o: {} }), 'nested objects by reference');
  assert.ok(shallowEqualOwn({ n: Infinity }, { n: Infinity }));
  // own keys only: an inherited property or an undefined value under another name is not a match
  assert.ok(!shallowEqualOwn({ a: 1, b: undefined }, { a: 1, c: 1 }), 'b: undefined vs c: 1');
  assert.ok(!shallowEqualOwn({ a: 1, b: undefined }, { a: 1, c: undefined }), 'same count, b missing on the other side');
  assert.ok(!shallowEqualOwn({ a: 1 }, Object.create({ a: 1 })), 'inherited a is not an own key');
  assert.ok(!shallowEqualOwn(Object.assign(Object.create({ b: 2 }), { a: 1 }), { a: 1, b: 2 }), 'a prototype key does not stand in for an own one');
});

test('stripUndefined drops only undefined values and does not mutate', () => {
  const src = { a: 1, b: undefined, c: null, d: 0, e: '' };
  const out = stripUndefined(src);
  assert.deepEqual(out, { a: 1, c: null, d: 0, e: '' });
  assert.ok(!('b' in out));
  assert.ok('b' in src);
  assert.deepEqual({ ...{ x: 5, y: 6 }, ...stripUndefined({ x: undefined, y: 7 }) }, { x: 5, y: 7 }, 'spreading over defaults keeps them');
});

test('themeEquals: field by field, categorical element-wise', () => {
  const t = { ...FALLBACK_THEME, categorical: [...FALLBACK_THEME.categorical] };
  assert.ok(themeEquals(t, FALLBACK_THEME));
  assert.ok(!themeEquals({ ...t, branch: '#000' }, FALLBACK_THEME));
  assert.ok(!themeEquals({ ...t, dark: true }, FALLBACK_THEME));
  assert.ok(!themeEquals({ ...t, categorical: t.categorical.slice(1) }, FALLBACK_THEME));
  assert.ok(!themeEquals({ ...t, categorical: [...t.categorical.slice(0, -1), '#123456'] }, FALLBACK_THEME));
});

const tree = { tipCount: 4, tipLabels: ['a', 'b', 'c', 'd'] };
const colSpec = (id, values, extra = {}) => ({ id, kind: 'bar', header: id, width: 40, values, ...extra });

test('columnSpecEquals: values by reference', () => {
  const v = { a: 1 };
  assert.ok(columnSpecEquals(colSpec('x', v), colSpec('x', v)));
  assert.ok(!columnSpecEquals(colSpec('x', v), colSpec('x', { a: 1 })));
  assert.ok(!columnSpecEquals(colSpec('x', v), colSpec('x', v, { width: 41 })));
  assert.ok(!columnSpecEquals(colSpec('x', v), colSpec('x', v, { header: 'h' })));
  assert.ok(!columnSpecEquals(colSpec('x', v), colSpec('x', v, { kind: 'text' })));
});

test('updateColumns: identical list is the same, changed columns only are recompiled', () => {
  const v1 = { a: 1, b: 2 },
    v2 = { c: 5 };
  const first = updateColumns(tree, [], [colSpec('one', v1), colSpec('two', v2)]);
  assert.ok(!first.same);
  assert.equal(first.columns.length, 2);
  assert.equal(first.columns[0].max, 2);

  // a new array of new but equal spec objects: nothing to do, the compiled list is returned unchanged entry for entry
  const again = updateColumns(tree, first.columns, [colSpec('one', v1), colSpec('two', v2)]);
  assert.ok(again.same);
  assert.equal(again.columns[0], first.columns[0]);
  assert.equal(again.columns[1], first.columns[1]);

  // one column gets new data: it is compiled again, the other one is the very same compiled object
  const changed = updateColumns(tree, first.columns, [colSpec('one', { a: 9 }), colSpec('two', v2)]);
  assert.ok(!changed.same);
  assert.notEqual(changed.columns[0], first.columns[0]);
  assert.equal(changed.columns[0].max, 9);
  assert.equal(changed.columns[1], first.columns[1]);

  // only the width changed: the data (arrays) are kept, the spec is the new one
  const wider = updateColumns(tree, first.columns, [colSpec('one', v1, { width: 80 }), colSpec('two', v2)]);
  assert.ok(!wider.same);
  assert.equal(wider.columns[0].num, first.columns[0].num);
  assert.equal(wider.columns[0].spec.width, 80);
  assert.equal(wider.columns[1], first.columns[1]);

  // new data and a new width together: recompiled under the new spec
  const both = updateColumns(tree, first.columns, [colSpec('one', { a: 7 }, { width: 80 }), colSpec('two', v2)]);
  assert.notEqual(both.columns[0], first.columns[0]);
  assert.notEqual(both.columns[0].num, first.columns[0].num);
  assert.equal(both.columns[0].max, 7);
  assert.equal(both.columns[0].spec.width, 80);

  // same `values` object but another kind: the data is of the other kind, so it is compiled afresh (no reuse of the bar arrays)
  const kind = updateColumns(tree, first.columns, [colSpec('one', v1, { kind: 'text' }), colSpec('two', v2)]);
  assert.notEqual(kind.columns[0], first.columns[0]);
  assert.equal(kind.columns[0].num, null);
  assert.deepEqual(kind.columns[0].txt.slice(0, 2), ['1', '2']);
  assert.equal(kind.columns[0].spec.kind, 'text');

  // reorder, removal, addition
  assert.ok(!updateColumns(tree, first.columns, [colSpec('two', v2), colSpec('one', v1)]).same);
  assert.deepEqual(updateColumns(tree, first.columns, [colSpec('two', v2)]).columns, [first.columns[1]]);
  assert.ok(!updateColumns(tree, first.columns, [first.columns[0].spec]).same);
  assert.ok(updateColumns(tree, [], []).same);
});

test('updateColumns: a duplicate id never shares one compiled object', () => {
  const v = { a: 1 };
  const first = updateColumns(tree, [], [colSpec('d', v)]);
  const dup = updateColumns(tree, first.columns, [colSpec('d', v), colSpec('d', v)]);
  assert.notEqual(dup.columns[0], dup.columns[1]);
  assert.ok(!dup.same);
  assert.ok(!updateColumns(tree, dup.columns, [colSpec('d', v), colSpec('d', v)]).same, 'documented: never "same" with a duplicate id');
});

test('changedKeys: the keys whose values differ (Object.is), over the keys of both sets', () => {
  const f = () => 1;
  assert.deepEqual(changedKeys({ layout: 'rectangular', lod: true, f }, { layout: 'rectangular', lod: true, f }), []);
  assert.deepEqual(changedKeys({ layout: 'rectangular', labelDensity: 'normal' }, { layout: 'rectangular', labelDensity: 'dense' }), [
    'labelDensity',
  ]);
  assert.deepEqual(changedKeys({ a: 1 }, { b: 2 }).sort(), ['a', 'b'], 'a key on one side only counts as changed');
  assert.deepEqual(changedKeys({ x: NaN }, { x: NaN }), [], 'NaN equals NaN under Object.is');
});
