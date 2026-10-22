// Unit tests of the aligned columns (src/core/columns.ts): compiling values by tip label, the bar scale, the cell geometry and what
// drawColumns asks of the canvas. A minimal fake context records the calls; a fake `document` supplies the alignment bitmap. No DOM package.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));
const core = path.join(root, 'packages/viewer/src');
const { InMemorySource } = await import(path.join(core, 'source.ts'));
const { makeTransform } = await import(path.join(core, 'geom.ts'));
const { FALLBACK_THEME } = await import(path.join(core, 'types.ts'));
const { compileColumn, columnSpecEquals, updateColumns, columnsWidth, layoutColumns, barWidth, cellRect, drawColumns, COL_GAP } = await import(
  path.join(core, 'columns.ts')
);
const compileColumns = (t, specs) => specs.map((s) => compileColumn(t, s));

const snap = (nwk) => new InMemorySource(parseNewick(nwk)).snapshot();
// tip ranks: A0 B1 C2 D3 E4 F5
const tree = snap('((A:1,B:2)AB:1,(C:1,(D:2,E:3)DE:1)CDE:2,F:4)root;');

/** A recording stand-in for CanvasRenderingContext2D: every method call is logged with the state that matters when it happens. */
function fakeCtx({ roundRect = false } = {}) {
  const calls = [];
  const ctx = {
    calls,
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    font: '',
    lineWidth: 1,
    textBaseline: '',
    imageSmoothingEnabled: true,
    measureText: (text) => ({ width: text.length * 6 }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData(img) {
      calls.push({ op: 'putImageData', img });
    },
  };
  for (const op of ['save', 'restore', 'beginPath', 'clip', 'stroke', 'fill', 'moveTo', 'lineTo', 'rect', 'drawImage', 'fillText'])
    ctx[op] = (...args) => calls.push({ op, args, fillStyle: ctx.fillStyle, alpha: ctx.globalAlpha, smoothing: ctx.imageSmoothingEnabled });
  ctx.fillRect = (...args) => calls.push({ op: 'fillRect', args, fillStyle: ctx.fillStyle, alpha: ctx.globalAlpha });
  if (roundRect) ctx.roundRect = (...args) => calls.push({ op: 'roundRect', args });
  return ctx;
}
const count = (ctx, op) => ctx.calls.filter((c) => c.op === op);

/** `document.createElement('canvas')` returning an object whose getContext hands out the fake context (or null). */
function fakeDocument({ context = true } = {}) {
  const made = [];
  return {
    made,
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const c = { width: 0, height: 0, ctx: fakeCtx(), getContext: () => (context ? c.ctx : null) };
      made.push(c);
      return c;
    },
  };
}
async function withDocument(doc, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  const old = globalThis.document;
  if (doc === undefined) delete globalThis.document;
  else globalThis.document = doc;
  try {
    return await fn();
  } finally {
    if (had) globalThis.document = old;
    else delete globalThis.document;
  }
}

const bar = (values) => ({ id: 'b', kind: 'bar', header: 'Bar', width: 80, values });
const text = (values) => ({ id: 't', kind: 'text', header: 'Txt', width: 80, values });
const align = (values, width = 80) => ({ id: 'a', kind: 'alignment', header: 'Aln', width, values });

test('compileColumns, bar: values by tip rank, text numbers parsed, NaN and missing tips have no value, max over the values', () => {
  const [c] = compileColumns(tree, [bar({ A: 1, B: '3', C: 'abc', D: 10, F: 0 })]);
  assert.equal(c.txt, null);
  assert.deepEqual([...c.has], [1, 1, 0, 1, 0, 1]);
  assert.equal(c.num[0], 1);
  assert.equal(c.num[1], 3, 'a numeric string is converted');
  assert.ok(Number.isNaN(c.num[2]), 'not a number: NaN, no value');
  assert.ok(Number.isNaN(c.num[4]), 'missing tip: NaN');
  assert.equal(c.num[5], 0);
  assert.equal(c.max, 10);
  assert.equal(c.bitmap, null);
  assert.equal(c.seqLen, 0);
  assert.equal(c.x, 0);
});

test('compileColumns, bar: a column of negative values has max 0 (so every bar is one pixel)', () => {
  const [c] = compileColumns(tree, [bar({ A: -5, B: -1 })]);
  assert.equal(c.max, 0);
  assert.deepEqual([...c.has], [1, 1, 0, 0, 0, 0]);
});

test('compileColumns, text: strings by rank (numbers stringified), seqLen is the longest', () => {
  const [c] = compileColumns(tree, [text({ A: 'alpha', C: 42, F: 'x' })]);
  assert.equal(c.num, null);
  assert.deepEqual([...c.has], [1, 0, 1, 0, 0, 1]);
  assert.equal(c.txt[0], 'alpha');
  assert.equal(c.txt[2], '42');
  assert.equal(c.txt[1], undefined);
  assert.equal(c.seqLen, 5);
  assert.equal(c.bitmap, null, 'a text column has no bitmap');
});

test('compileColumns, alignment: the bitmap is one pixel per residue (width seqLen, height tips), coloured by residue class', async () => {
  const doc = fakeDocument();
  const [c] = await withDocument(doc, () => compileColumns(tree, [align({ A: 'AK-D', B: 'ge', D: 'XXXXXX' })]));
  assert.equal(c.seqLen, 6);
  assert.ok(c.bitmap);
  assert.deepEqual([c.bitmap.width, c.bitmap.height], [6, 6]);
  const puts = count(c.bitmap.ctx, 'putImageData');
  assert.equal(puts.length, 1);
  const px = new Uint32Array(puts[0].img.data.buffer);
  const abgr = (hex) =>
    ((255 << 24) | (parseInt(hex.slice(5, 7), 16) << 16) | (parseInt(hex.slice(3, 5), 16) << 8) | parseInt(hex.slice(1, 3), 16)) >>> 0;
  assert.equal(px[0], abgr('#80a0f0'), 'A: hydrophobic');
  assert.equal(px[1], abgr('#f01505'), 'K: positive');
  assert.equal(px[2], 0, 'a gap is transparent');
  assert.equal(px[3], abgr('#c048c0'), 'D: negative');
  assert.equal(px[4], 0, 'past the end of a shorter sequence: nothing');
  assert.equal(px[6], abgr('#f09048'), 'row 1 (B): lower case g is read as G');
  assert.equal(px[7], abgr('#c048c0'), 'e is read as E');
  assert.equal(px[2 * 6], 0, 'a tip without a sequence is an empty row');
  assert.equal(px[3 * 6], abgr('#e2e2e2'), 'an unknown residue is light grey');
});

test('compileColumns, alignment: no bitmap without a document, without a 2d context, or when the alignment is very large', async () => {
  const none = await withDocument(undefined, () => compileColumns(tree, [align({ A: 'ACGT' })]));
  assert.equal(none[0].bitmap, null, 'no document: falls back to drawing runs');
  assert.equal(none[0].seqLen, 4);
  const noCtx = await withDocument(fakeDocument({ context: false }), () => compileColumns(tree, [align({ A: 'ACGT' })]));
  assert.equal(noCtx[0].bitmap, null, 'getContext returned null');
  const doc = fakeDocument();
  const big = await withDocument(doc, () => compileColumns(tree, [align({ A: 'A'.repeat(1_400_000) })]));
  assert.equal(big[0].bitmap, null, '6 tips x 1.4 M residues is over the 8 M pixel limit');
  assert.equal(doc.made.length, 0, 'the bitmap was not even created');
  const empty = await withDocument(doc, () => compileColumns(tree, [align({})]));
  assert.equal(empty[0].bitmap, null, 'no sequences: nothing to rasterise');
});

test('columnsWidth and layoutColumns: each column takes its width plus the gap, left to right', () => {
  const cols = compileColumns(tree, [bar({ A: 1 }), text({ A: 'a' }), bar({ A: 2 })]);
  cols[0].spec.width = 50;
  cols[1].spec.width = 30;
  cols[2].spec.width = 20;
  assert.equal(columnsWidth(cols), 100 + 3 * COL_GAP);
  layoutColumns(cols, 400);
  assert.deepEqual(
    cols.map((c) => c.x),
    [400, 400 + 50 + COL_GAP, 400 + 80 + 2 * COL_GAP],
  );
  assert.equal(columnsWidth([]), 0);
});

test('barWidth: log scale up to width - 4, at least one pixel', () => {
  assert.equal(barWidth(100, 100, 80), 76, 'the maximum fills the column (less 4 px)');
  const half = barWidth(9, 99, 80);
  assert.ok(Math.abs(half - (Math.log10(10) / Math.log10(100)) * 76) < 1e-12, 'log10(1 + v) / log10(1 + max)');
  assert.ok(half > (9 / 99) * 76, 'a log scale lifts small values above the linear one');
  assert.equal(barWidth(1e-9, 1e6, 80), 1, 'tiny values: the one pixel minimum');
  assert.equal(barWidth(0, 10, 80), 1);
  assert.equal(barWidth(-3, 10, 80), 1);
  assert.equal(barWidth(5, 0, 80), 1, 'no positive maximum');
  assert.equal(barWidth(NaN, 10, 80), 1);
  assert.equal(barWidth(10, 10, 4), 1, 'a column narrower than 5 px');
  assert.ok(barWidth(1000, 10, 80) > 76, 'a value above the maximum is not clamped (the maximum is of the data)');
});

// 6 tips in a 200 px tall area: 30 px per row at the full view, columns start at x = 300
const area = { ax: 0, ay: 0, aw: 500, ah: 180, clipL: 0, clipT: 0, clipR: 500, clipB: 180 };
const rectT = (v = { x0: 0, x1: 1, y0: 0, y1: 6 }) => makeTransform('rectangular', 500, 180, v, area, 6);

test('cellRect: bar cell inside the row at tall rows, the whole row at thin ones; other kinds fill the column', () => {
  const cols = compileColumns(tree, [bar({ A: 10, C: 5 }), text({ B: 'x' })]);
  layoutColumns(cols, 300);
  const T = rectT();
  assert.equal(T.ky, 30);
  const a = cellRect(cols[0], 0, T);
  assert.deepEqual(a, { x: 302, y: 3, width: barWidth(10, 10, 80), height: 24 });
  const c = cellRect(cols[0], 2, T);
  assert.equal(c.y, 60 + 3);
  assert.equal(c.width, barWidth(5, 10, 80));
  const thin = cellRect(cols[0], 0, rectT({ x0: 0, x1: 1, y0: 0, y1: 300 })); // ky = 0.6
  assert.deepEqual(thin, { x: 302, y: 0, width: 76, height: 1 }, 'rows under 1.5 px: the row itself, at least one pixel');
  assert.deepEqual(cellRect(cols[1], 1, T), { x: cols[1].x, y: 30, width: 80, height: 30 });
});

test('cellRect: null without a value, for a bad rank, for the radial layout, and out of view; partly visible is kept', () => {
  const cols = compileColumns(tree, [bar({ A: 10, C: 5 })]);
  layoutColumns(cols, 300);
  const T = rectT();
  assert.equal(cellRect(cols[0], 1, T), null, 'tip B has no value');
  assert.equal(cellRect(cols[0], -1, T), null);
  const radialT = makeTransform('radial', 500, 180, { x0: -1, x1: 1, y0: -1, y1: 1 }, area, 6);
  assert.equal(cellRect(cols[0], 0, radialT), null);
  const scrolled = rectT({ x0: 0, x1: 1, y0: 2, y1: 8 });
  assert.equal(cellRect(cols[0], 0, scrolled), null, 'row 0 ends above the area');
  assert.ok(cellRect(cols[0], 2, scrolled), 'row 2 starts at the top');
  const half = rectT({ x0: 0, x1: 1, y0: 0.5, y1: 6.5 });
  assert.ok(cellRect(cols[0], 0, half), 'row 0 is half out of the top: still a cell');
  assert.equal(cellRect(cols[0], 0, rectT({ x0: 0, x1: 1, y0: 1.5, y1: 7.5 })), null, 'row 0 ends above the area');
});

/** A tree of n tips (a star) for the binned paths. Tip i is t<i>. */
const star = (n) => snap(`(${Array.from({ length: n }, (_, i) => `t${i}:1`).join(',')})root;`);
const theme = FALLBACK_THEME;
// opts.alignRowGap is a theme value now: the helper keeps the old call shape
const draw = (ctx, cols, t, T, opts) =>
  drawColumns(ctx, cols, t, T, opts?.alignRowGap == null ? theme : { ...theme, alignRowGap: opts.alignRowGap }, 12, '#336699', opts);

test('drawColumns, bar rows >= 1.5 px: a header, then one rect per row with a value, inside its row', () => {
  const cols = compileColumns(tree, [bar({ A: 10, B: 3, F: 1 })]);
  layoutColumns(cols, 300);
  const ctx = fakeCtx();
  draw(ctx, cols, tree, rectT());
  const header = count(ctx, 'fillText');
  assert.equal(header.length, 1);
  assert.deepEqual(header[0].args, ['Bar', 300, 12, 80]);
  const rects = count(ctx, 'fillRect');
  assert.equal(rects.length, 3);
  assert.deepEqual(
    rects.map((r) => Math.floor(r.args[1] / 30)),
    [0, 1, 5],
    'one per tip with a value, in its own row',
  );
  for (const r of rects) {
    assert.equal(r.args[0], 302);
    assert.equal(r.fillStyle, '#336699');
    assert.ok(r.args[3] > 0 && r.args[3] <= 30);
  }
  assert.equal(rects[0].args[2], barWidth(10, 10, 80));
  assert.equal(count(ctx, 'save').length, count(ctx, 'restore').length, 'save and restore are balanced');
});

test('drawColumns does nothing for no columns or the radial layout; a view past the tips draws only the header', () => {
  const cols = compileColumns(tree, [bar({ A: 10 })]);
  layoutColumns(cols, 300);
  let ctx = fakeCtx();
  draw(ctx, [], tree, rectT());
  assert.equal(ctx.calls.length, 0);
  ctx = fakeCtx();
  draw(ctx, cols, tree, makeTransform('radial', 500, 180, { x0: -1, x1: 1, y0: -1, y1: 1 }, area, 6));
  assert.equal(ctx.calls.length, 0);
  ctx = fakeCtx();
  draw(ctx, cols, tree, rectT({ x0: 0, x1: 1, y0: 50, y1: 56 }));
  assert.equal(count(ctx, 'fillText').length, 1);
  assert.equal(count(ctx, 'fillRect').length, 0);
});

test('drawColumns, bar rows under 1.5 px: rows are binned per pixel row (mean), one 1 px rect per occupied pixel row', () => {
  const N = 200;
  const t = star(N);
  const values = {};
  for (let i = 0; i < N; i++) values[`t${i}`] = i < 100 ? 10 : i; // the second half varies
  const cols = compileColumns(t, [bar(values)]);
  layoutColumns(cols, 300);
  const ctx = fakeCtx();
  const T = makeTransform('rectangular', 500, 180, { x0: 0, x1: 1, y0: 0, y1: N }, area, N); // ky = 0.9
  assert.equal(T.ky, 0.9);
  draw(ctx, cols, t, T);
  const rects = count(ctx, 'fillRect');
  // the 200 rows span 0..180 px: every pixel row holds at least one row
  assert.equal(rects.length, 180, 'one rect per pixel row, whatever the number of rows');
  for (const r of rects) {
    assert.equal(r.args[3], 1, 'one pixel tall');
    assert.equal(r.args[0], 302);
    assert.equal(r.alpha, 1, 'bars are opaque');
    assert.equal(r.fillStyle, '#336699');
  }
  assert.deepEqual(
    rects.map((r) => r.args[1]),
    Array.from({ length: 180 }, (_, p) => p),
    'in order, one per pixel row',
  );
  assert.equal(rects[0].args[2], barWidth(10, c0max(cols), 80), 'a pixel row of equal values draws that value');
  // the mean of the rows in a pixel row: row r is in pixel row floor(r * 0.9); pick a pixel row whose member rows have different values
  const members = (p) => Array.from({ length: N }, (_, r) => r).filter((r) => Math.floor(r * 0.9) === p);
  const p = 99;
  const vals = members(p).map((r) => values[`t${r}`]);
  assert.ok(vals.length >= 2 && new Set(vals).size === vals.length, `pixel row ${p} holds rows ${members(p)} with distinct values ${vals}`);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  assert.notEqual(barWidth(mean, c0max(cols), 80), barWidth(Math.max(...vals), c0max(cols), 80), 'mean and max would draw differently');
  assert.notEqual(
    barWidth(mean, c0max(cols), 80),
    barWidth(
      vals.reduce((a, b) => a + b, 0),
      c0max(cols),
      80,
    ),
    'so would the sum',
  );
  assert.equal(rects[p].args[2], barWidth(mean, c0max(cols), 80), 'the mean of the rows in the pixel row');
  assert.equal(ctx.globalAlpha, 1, 'alpha is restored');
});
function c0max(cols) {
  return cols[0].max;
}

test('drawColumns, binned text and alignment without a bitmap: translucent full-width marks, only where there are values', () => {
  const N = 200;
  const t = star(N);
  const values = {};
  for (let i = 0; i < 100; i++) values[`t${i}`] = 'ACGT';
  const T = makeTransform('rectangular', 500, 180, { x0: 0, x1: 1, y0: 0, y1: N }, area, N);
  for (const make of [text, align]) {
    const [c] = compileColumns(t, [make(values)]); // no document in this process: an alignment has no bitmap
    c.x = 300;
    const ctx = fakeCtx();
    draw(ctx, [c], t, T);
    const rects = count(ctx, 'fillRect');
    assert.equal(rects.length, 90, `${c.spec.kind}: rows 0..99 cover pixel rows 0..89`);
    for (const r of rects) {
      assert.equal(r.alpha, 0.45);
      assert.equal(r.args[2], 76, 'column width less 4');
    }
    assert.ok(rects[rects.length - 1].args[1] < 91);
  }
});

test('drawColumns, text: labels at rows >= 9 px, tinted bands below that', () => {
  const [c] = compileColumns(tree, [text({ A: 'alpha', C: 'gamma' })]);
  c.x = 300;
  let ctx = fakeCtx();
  draw(ctx, [c], tree, rectT());
  const labels = count(ctx, 'fillText').slice(1);
  assert.deepEqual(
    labels.map((l) => l.args[0]),
    ['alpha', 'gamma'],
  );
  assert.equal(labels[0].args[1], 302);
  assert.equal(labels[0].args[3], 76, 'max width: the column less 4');
  const T = rectT({ x0: 0, x1: 1, y0: 0, y1: 30 }); // ky = 6
  ctx = fakeCtx();
  draw(ctx, [c], tree, T);
  assert.equal(count(ctx, 'fillText').length, 1, 'the header only');
  const bands = count(ctx, 'fillRect');
  assert.equal(bands.length, 2);
  assert.equal(bands[0].alpha, 0.35);
  assert.deepEqual([bands[0].args[1], bands[1].args[1]], [0, 12]);
});

test('drawColumns, alignment bitmap: one blit of the visible rows, one per row with a row gap', async () => {
  const doc = fakeDocument();
  const [c] = await withDocument(doc, () => compileColumns(tree, [align({ A: 'ACGT', B: 'AC-T', F: 'GGGG' })]));
  c.x = 300;
  const ctx = fakeCtx();
  draw(ctx, [c], tree, rectT());
  let blits = count(ctx, 'drawImage');
  assert.equal(blits.length, 1);
  assert.deepEqual(blits[0].args.slice(1), [0, 0, 4, 6, 300, 0, 80, 180], 'the whole bitmap over the whole column');
  assert.equal(blits[0].smoothing, false, 'pixels stay sharp at tall rows');
  const gap = fakeCtx();
  draw(gap, [c], tree, rectT(), { alignStyle: 'residues', alignRowGap: 4 });
  blits = count(gap, 'drawImage');
  assert.equal(blits.length, 6, 'one blit per visible row');
  assert.deepEqual(blits[1].args.slice(1), [0, 1, 4, 1, 300, 30 + 2, 80, 26], 'shorter than the row, centred in it');
  const thin = fakeCtx();
  draw(thin, [c], tree, rectT({ x0: 0, x1: 1, y0: 0, y1: 60 })); // ky = 3
  assert.equal(count(thin, 'drawImage').length, 1);
  const small = fakeCtx();
  draw(small, [c], tree, rectT({ x0: 0, x1: 1, y0: 0, y1: 600 })); // ky = 0.3
  assert.equal(count(small, 'drawImage')[0].smoothing, true, 'rows under 1 px are smoothed');
});

test('drawColumns, alignment blocks style: a line per row, one block per stretch without gaps, geometry inside the column', () => {
  const [c] = compileColumns(tree, [align({ A: 'AAA---CC', B: 'AAAAAAAA', C: '--AA--AA' })]); // no document: no bitmap
  c.x = 300;
  assert.equal(c.seqLen, 8);
  const ctx = fakeCtx();
  draw(ctx, [c], tree, rectT(), { alignStyle: 'blocks', alignRowGap: 0 });
  assert.equal(count(ctx, 'moveTo').length, 3, 'a thin line over the width for each row with a sequence (rows >= 4 px)');
  assert.equal(count(ctx, 'lineTo').length, 3);
  const blocks = count(ctx, 'rect').slice(1); // the first rect is the clip of the column
  assert.equal(blocks.length, 5, 'AAA, CC | AAAAAAAA | AA, AA');
  const cw = 80 / 8;
  assert.deepEqual(
    blocks.map((b) => [b.args[0], b.args[2]]),
    [
      [300, 3 * cw],
      [300 + 6 * cw, 2 * cw],
      [300, 8 * cw],
      [300 + 2 * cw, 2 * cw],
      [300 + 6 * cw, 2 * cw],
    ],
  );
  const ky = 30;
  for (const [k, b] of blocks.entries()) {
    const row = k < 2 ? 0 : k < 3 ? 1 : 2;
    assert.ok(b.args[1] >= row * ky && b.args[1] + b.args[3] <= (row + 1) * ky, `block ${k} lies inside row ${row}`);
    assert.ok(b.args[3] <= ky * 0.75, 'a quarter of the row stays free');
  }
  assert.equal(count(ctx, 'fill').length, 1, 'all blocks are one path');
  assert.deepEqual([...c.runs[0]], [0, 3, 6, 8], 'the gap-free stretches are cached on the column');
  assert.equal(c.runs[3], undefined, 'rows without a sequence are not computed');
  // rounded blocks when the context can and the block is tall enough
  const rr = fakeCtx({ roundRect: true });
  draw(rr, [c], tree, rectT(), { alignStyle: 'blocks', alignRowGap: 0 });
  assert.equal(count(rr, 'roundRect').length, 5);
  // rows under 4 px: no connecting lines
  const thin = fakeCtx();
  draw(thin, [c], tree, rectT({ x0: 0, x1: 1, y0: 0, y1: 60 }), { alignStyle: 'blocks', alignRowGap: 0 });
  assert.equal(count(thin, 'moveTo').length, 0);
  assert.equal(count(thin, 'rect').slice(1).length, 5);
});

test('drawColumns, alignment without a bitmap at tall rows (the large-alignment fallback): runs of one colour per row', () => {
  const [c] = compileColumns(tree, [align({ A: 'AAAK-K' })]);
  c.x = 300;
  const ctx = fakeCtx();
  draw(ctx, [c], tree, rectT());
  const rects = count(ctx, 'fillRect');
  const cw = 80 / 6;
  assert.equal(rects.length, 3, 'AAA, K, K: the gap is not drawn');
  assert.equal(rects[0].fillStyle, 'rgb(128,160,240)', 'hydrophobic');
  assert.equal(rects[1].fillStyle, 'rgb(240,21,5)', 'K: positive');
  assert.equal(rects[1].fillStyle, rects[2].fillStyle);
  assert.equal(rects[0].args[0], 300);
  assert.ok(Math.abs(rects[0].args[2] - (3 * cw + 0.3)) < 1e-9, 'a run is as wide as its cells (plus 0.3 px against seams)');
  assert.equal(rects[1].args[0], 300 + 3 * cw);
  assert.equal(rects[2].args[0], 300 + 5 * cw);
  assert.equal(rects[0].args[3], 29, 'a row less one pixel gap above 3 px');
});

test('columnSpecEquals: id, kind, header, width and the identity of `values` (not its content)', () => {
  const values = { A: 1 };
  const a = bar(values);
  assert.equal(columnSpecEquals(a, a), true);
  assert.equal(columnSpecEquals(a, { ...a }), true, 'a copy of the spec with the same values object');
  assert.equal(columnSpecEquals(a, { ...a, values: { A: 1 } }), false, 'a new values object with equal content is a change: no deep compare');
  for (const patch of [{ id: 'z' }, { kind: 'text' }, { header: 'H' }, { width: 81 }]) assert.equal(columnSpecEquals(a, { ...a, ...patch }), false);
});

test('updateColumns: an unchanged spec keeps its compiled column, new data recompiles, a new header or width keeps the arrays', () => {
  const v1 = { A: 1, B: 2 };
  const first = updateColumns(tree, [], [bar(v1), text({ A: 'x' })]);
  assert.equal(first.same, false);
  assert.equal(first.columns.length, 2);
  const [b, t] = first.columns;
  const again = updateColumns(tree, first.columns, [{ ...b.spec }, t.spec]);
  assert.equal(again.same, true, 'nothing changed');
  assert.equal(again.columns[0], b, 'same spec: the same compiled object');
  assert.equal(again.columns[1], t);
  const moreData = updateColumns(tree, first.columns, [bar({ A: 1, B: 2, C: 9 }), t.spec]);
  assert.equal(moreData.same, false);
  assert.notEqual(moreData.columns[0], b, 'a new values reference: recompiled');
  assert.equal(moreData.columns[0].max, 9);
  assert.equal(moreData.columns[1], t, 'the other column is untouched');
  const retitled = updateColumns(tree, first.columns, [{ ...b.spec, header: 'New', width: 120 }, t.spec]);
  assert.equal(retitled.same, false);
  assert.notEqual(retitled.columns[0], b);
  assert.equal(retitled.columns[0].num, b.num, 'header / width only: the arrays are kept');
  assert.equal(retitled.columns[0].spec.header, 'New');
  assert.equal(retitled.columns[0].spec.width, 120);
  const reordered = updateColumns(tree, first.columns, [t.spec, b.spec]);
  assert.equal(reordered.same, false, 'a different order is a change, though both objects are reused');
  assert.deepEqual(reordered.columns, [t, b]);
  const dropped = updateColumns(tree, first.columns, [b.spec]);
  assert.equal(dropped.same, false);
  assert.equal(dropped.columns.length, 1);
  const kindChanged = updateColumns(tree, first.columns, [{ ...b.spec, kind: 'text' }, t.spec]);
  assert.equal(kindChanged.columns[0].txt !== null && kindChanged.columns[0].num === null, true, 'a new kind is compiled afresh');
});

test('custom column: prepare once per data, has from the values (or hasCell), draw once per frame with the visible rows, clipped', () => {
  const prepared = [];
  const drawn = [];
  const renderer = {
    prepare(src) {
      prepared.push(src.tipCount);
      return Float64Array.from(src.tipLabels, (l) => src.values[l]?.score ?? NaN);
    },
    draw(ctx, f, data) {
      drawn.push({ x: f.x, width: f.width, r0: f.r0, r1: f.r1, oy: f.oy, rowHeight: f.rowHeight, theme: f.theme === theme });
      for (let r = f.r0; r <= f.r1; r++) if (!Number.isNaN(data[r])) ctx.fillRect(f.x, f.oy + r * f.rowHeight, data[r], f.rowHeight);
    },
  };
  const values = { A: { score: 10 }, C: { score: 20 } };
  const spec = { id: 'c', kind: 'custom', header: 'Score', width: 60, values, renderer };
  const [c] = compileColumns(tree, [spec]);
  assert.deepEqual(prepared, [6]);
  assert.deepEqual([...c.has], [1, 0, 1, 0, 0, 0]);
  layoutColumns([c], 300);
  const ctx = fakeCtx();
  draw(ctx, [c], tree, rectT());
  assert.deepEqual(drawn, [{ x: 300, width: 60, r0: 0, r1: 5, oy: 0, rowHeight: 30, theme: true }]);
  assert.deepEqual(
    count(ctx, 'fillRect').map((k) => k.args),
    [
      [300, 0, 10, 30],
      [300, 60, 20, 30],
    ],
  );
  assert.equal(count(ctx, 'clip').length, 1, 'clipped to the column');
  assert.equal(count(ctx, 'fillText')[0].args[0], 'Score', 'the viewer draws the header');
  assert.deepEqual(cellRect(c, 2, rectT()), { x: 300, y: 60, width: 60, height: 30 });
  assert.equal(cellRect(c, 1, rectT()), null);
  // same values and renderer: kept; a new header keeps the data; a new renderer or new values prepare again
  assert.equal(updateColumns(tree, [c], [{ ...spec }]).columns[0], c);
  assert.equal(updateColumns(tree, [c], [{ ...spec, header: 'S' }]).columns[0].data, c.data);
  updateColumns(tree, [c], [{ ...spec, renderer: { ...renderer } }]);
  updateColumns(tree, [c], [{ ...spec, values: { ...values } }]);
  assert.deepEqual(prepared, [6, 6, 6]);
  // hasCell decides when given
  const [h] = compileColumns(tree, [{ ...spec, renderer: { ...renderer, hasCell: (_d, r) => r === 5 } }]);
  assert.deepEqual([...h.has], [0, 0, 0, 0, 0, 1]);
});

test('custom column: a renderer that throws does not break the frame', () => {
  const spec = {
    id: 'bad',
    kind: 'custom',
    header: 'Bad',
    width: 40,
    values: {},
    renderer: {
      prepare: () => null,
      draw() {
        throw new Error('boom');
      },
    },
  };
  const [c] = compileColumns(tree, [spec, bar({ A: 1 })].slice(0, 1));
  const cols = [c, compileColumn(tree, bar({ A: 1 }))];
  layoutColumns(cols, 300);
  const ctx = fakeCtx();
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a[0]);
  try {
    draw(ctx, cols, tree, rectT());
    draw(ctx, cols, tree, rectT());
  } finally {
    console.error = orig;
  }
  assert.equal(errors.length, 1, 'reported once');
  assert.equal(count(ctx, 'fillRect').length, 2, 'the next column is still drawn');
  assert.equal(count(ctx, 'save').length, count(ctx, 'restore').length, 'save and restore stay balanced');
});
