// Unit tests of the residue colours (src/residues.ts) and of how alignment columns use them: the two schemes, the theme tokens and their
// dark defaults, detection of the alphabet, and that the exported table is the one that is drawn (read from a fake canvas).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { residueColours, residueGroups, detectAlphabet, RESIDUE_THEME_KEYS } = await import('../src/residues.ts');
const { resolveColour, toHex } = await import('../src/colour.ts');
const { luminance, themeFromCss } = await import('../src/theme.ts');
const { FALLBACK_THEME, themeEquals } = await import('../src/types.ts');
const { compileColumn, updateColumns, recolourColumns, columnSpecEquals, drawColumns } = await import('../src/columns.ts');
const { makeTransform } = await import('../src/geom.ts');
const { InMemorySource } = await import('../src/source.ts');
const { parseNewick } = await import('../../io/src/newick.ts');
const { makeViewer, destroyAll } = await import('./viewer-harness.mjs');

afterEach(destroyAll);

const DARK = { ...FALLBACK_THEME, dark: true, background: '#0f172a' };
const LIGHT_LETTERS = 'ACGT';
const tree = new InMemorySource(parseNewick('((A:1,B:2)AB:1,(C:1,D:2)CD:1)root;')).snapshot();
const area = { ax: 0, ay: 0, aw: 500, ah: 180, clipL: 0, clipT: 0, clipR: 500, clipB: 180 };
const abgr = (hex) =>
  ((255 << 24) | (parseInt(hex.slice(5, 7), 16) << 16) | (parseInt(hex.slice(3, 5), 16) << 8) | parseInt(hex.slice(1, 3), 16)) >>> 0;

function fakeCtx() {
  const calls = [];
  const ctx = {
    calls,
    fillStyle: '',
    globalAlpha: 1,
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (img) => calls.push({ op: 'putImageData', img }),
  };
  for (const op of ['save', 'restore', 'beginPath', 'clip', 'rect', 'drawImage', 'fillText', 'stroke', 'moveTo', 'lineTo']) ctx[op] = () => {};
  ctx.fillRect = (...args) => calls.push({ op: 'fillRect', args, fillStyle: ctx.fillStyle });
  return ctx;
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
async function withBitmaps(fn) {
  const old = globalThis.document;
  globalThis.document = {
    createElement: () => {
      const c = { width: 0, height: 0, ctx: fakeCtx(), getContext: () => c.ctx };
      return c;
    },
  };
  try {
    return await fn();
  } finally {
    if (old === undefined) delete globalThis.document;
    else globalThis.document = old;
  }
}
const pixels = (col) => new Uint32Array(col.bitmap.ctx.calls.find((c) => c.op === 'putImageData').img.data.buffer);
const col = (values, alphabet) => ({ id: 'a', kind: 'alignment', header: 'Aln', width: 80, values, ...(alphabet ? { alphabet } : {}) });

test('nucleotide scheme: A, C, G and T are four distinct colours, U is drawn like T, anything else is the other colour', () => {
  for (const theme of [FALLBACK_THEME, DARK]) {
    const c = residueColours(theme, 'nucleotide');
    assert.equal(new Set([c.A, c.C, c.G, c.T]).size, 4);
    assert.equal(c.U, c.T);
    assert.equal(c.N, c.other);
    assert.equal(c.X, c.other);
    assert.ok(![c.A, c.C, c.G, c.T].includes(c.other));
  }
});

test('protein scheme: the groups keep the colours of the old constant table, and nucleotide letters are not special', () => {
  const c = residueColours(FALLBACK_THEME, 'protein');
  assert.equal(c.A, '#80a0f0');
  assert.equal(c.K, '#f01505');
  assert.equal(c.D, '#c048c0');
  assert.equal(c.S, '#15c015');
  assert.equal(c.U, '#15c015');
  assert.equal(c.Y, '#15a4a4');
  assert.equal(c.G, '#f09048');
  assert.equal(c.P, '#c0c000');
  assert.equal(c.X, '#e2e2e2');
  assert.equal(c.A, c.C, 'A and C are both hydrophobic in the protein scheme');
});

test('residueColours covers A to Z and other, and returns a new object each time', () => {
  const c = residueColours(FALLBACK_THEME, 'protein');
  assert.deepEqual(Object.keys(c).sort(), [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].concat('other').sort());
  assert.notEqual(c, residueColours(FALLBACK_THEME, 'protein'));
});

/** Run fn with console.warn collected. */
function warnings(fn) {
  const had = console.warn;
  const seen = [];
  console.warn = (...a) => seen.push(a.join(' '));
  try {
    fn();
  } finally {
    console.warn = had;
  }
  return seen;
}

test('theme tokens override the defaults and come back as #rrggbb; a value that is not a colour falls back to the default, with one warning', () => {
  const seen = warnings(() => {
    const t = { ...FALLBACK_THEME, residueA: '#112233', residueT: ' rgb(1, 2, 3) ', residueC: 'not a colour 1', residueOther: '#abc' };
    const c = residueColours(t, 'nucleotide');
    assert.equal(c.A, '#112233');
    assert.equal(c.T, '#010203');
    assert.equal(c.U, '#010203');
    assert.equal(c.C, residueColours(FALLBACK_THEME, 'nucleotide').C);
    assert.equal(c.N, '#aabbcc');
    residueColours(t, 'nucleotide'); // the same bad value again: no second warning
  });
  assert.equal(seen.length, 1);
  assert.match(seen[0], /residueC/);
  assert.equal(residueColours({ residueHydrophobic: '#010203' }, 'protein').I, '#010203', 'a partial theme without `dark` is light');
  // the protein tokens do not touch the nucleotide scheme and the other way round
  assert.equal(residueColours({ ...FALLBACK_THEME, residueA: '#112233' }, 'protein').A, '#80a0f0');
  assert.equal(residueColours({ ...FALLBACK_THEME, residueHydrophobic: '#010203' }, 'nucleotide').A, residueColours(FALLBACK_THEME, 'nucleotide').A);
});

test('any colour the browser knows is resolved through a probe canvas; alpha is dropped, transparent is not a colour', async () => {
  const h = await makeViewer('(a,b);'); // installs the fake document, whose canvas fills and reads back like a browser's
  void h;
  assert.equal(toHex(resolveColour('red')), '#ff0000', 'a name');
  assert.equal(toHex(resolveColour('#1234')), '#112233', '#rgba');
  assert.equal(Math.round(resolveColour('rgba(0, 0, 255, 0.5)').a * 255), 128);
  assert.equal(resolveColour('not a colour 2'), null);
  assert.equal(resolveColour('  '), null);
  const seen = warnings(() => {
    const c = residueColours(
      { residueA: 'rgba(0, 0, 255, 0.5)', residueC: 'red', residueG: 'transparent', residueT: 'not a colour 3' },
      'nucleotide',
    );
    assert.equal(c.A, '#0000ff', 'the opaque colour that is drawn');
    assert.equal(c.C, '#ff0000');
    assert.equal(c.G, residueColours({}, 'nucleotide').G, 'fully transparent: default');
    assert.equal(c.T, residueColours({}, 'nucleotide').T);
  });
  assert.equal(seen.length, 2);
});

test('without a canvas only #rgb, #rrggbb and rgb()/rgba() are understood, anchored at both ends', async () => {
  await withDocument(undefined, () => {
    assert.deepEqual(resolveColour('#abc'), { r: 170, g: 187, b: 204, a: 1 });
    assert.deepEqual(resolveColour('rgba(1, 2, 3, 0.5)'), { r: 1, g: 2, b: 3, a: 0.5 });
    assert.equal(resolveColour('rgb(1 2 3 / 50%)').a, 0.5);
    assert.equal(resolveColour('red'), null);
    assert.equal(resolveColour('var(--x)'), null);
    assert.equal(resolveColour('#abcxyz'), null);
    assert.equal(resolveColour('#aabbccdd1'), null);
    assert.equal(resolveColour('rgb(1, 2, 3) junk'), null);
  });
});

test('every default has enough contrast against its background (3:1), light and dark, protein and nucleotide', () => {
  const contrast = (a, b) => {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  for (const alphabet of ['protein', 'nucleotide']) {
    const dark = residueColours(DARK, alphabet);
    for (const k of Object.keys(dark)) assert.ok(contrast(dark[k], DARK.background) >= 3, `dark ${alphabet} ${k} ${dark[k]}`);
  }
  const light = residueColours(FALLBACK_THEME, 'nucleotide');
  for (const k of LIGHT_LETTERS) assert.ok(contrast(light[k], '#ffffff') >= 3, `light nucleotide ${k} ${light[k]}`);
  assert.notDeepEqual(residueColours(DARK, 'protein'), residueColours(FALLBACK_THEME, 'protein'), 'dark has its own protein defaults');
});

test('residueGroups: every group has a token and its letters share one colour; the groups are what a legend shows', () => {
  for (const alphabet of ['protein', 'nucleotide']) {
    const colours = residueColours({ ...FALLBACK_THEME, residueGlycine: '#010101' }, alphabet);
    const groups = residueGroups(alphabet);
    assert.ok(groups.length >= 4);
    assert.equal(new Set(groups.map((g) => colours[g.residues[0]])).size, groups.length, 'one distinct colour per group');
    for (const g of groups) {
      assert.ok(RESIDUE_THEME_KEYS.includes(g.token));
      for (const r of g.residues) assert.equal(colours[r], colours[g.residues[0]]);
    }
  }
  assert.deepEqual(
    residueGroups('nucleotide').map((g) => g.label),
    ['A', 'C', 'G', 'T / U'],
  );
});

test('detectAlphabet: more than 90% A, C, G, T, U or N (any case, gaps ignored) is nucleotide; otherwise, or empty, protein', () => {
  assert.equal(detectAlphabet(['ACGTACGTAC', 'acgu--NN..']), 'nucleotide');
  assert.equal(detectAlphabet(['ACGTACGTAK']), 'protein', 'exactly 90% is not more than 90%');
  assert.equal(detectAlphabet(['ACGTACGTACK']), 'nucleotide', '10 of 11');
  assert.equal(detectAlphabet(['MKVLAAGIVG']), 'protein');
  assert.equal(detectAlphabet([undefined, '----', '']), 'protein');
  assert.equal(detectAlphabet([]), 'protein');
});

test('detectAlphabet: leading gaps are not residues, and a sequence of gaps costs a bounded scan', () => {
  assert.equal(detectAlphabet(['-'.repeat(500) + 'ACGTACGT']), 'nucleotide');
  assert.equal(detectAlphabet(['.'.repeat(500) + 'MKVLAAGI']), 'protein');
  assert.equal(detectAlphabet(['-'.repeat(1e6) + 'ACGT']), 'protein', 'gaps past the scan limit: nothing to sample');
});

test('detectAlphabet looks only at a sample: the first 400 residues of each sequence', () => {
  const dna = 'A'.repeat(400) + 'K'.repeat(5000);
  assert.equal(detectAlphabet([dna]), 'nucleotide');
  assert.equal(detectAlphabet(['K'.repeat(400) + 'A'.repeat(5000), dna]), 'protein');
});

test('alignment column: auto picks the scheme from the residues, an explicit alphabet wins', async () => {
  await withBitmaps(() => {
    const dna = { A: 'ACGT', B: 'ACGT', C: 'ACGT', D: 'ACGT' };
    const auto = compileColumn(tree, col(dna));
    assert.equal(auto.alphabet, 'nucleotide');
    const px = pixels(auto);
    assert.equal(new Set([px[0], px[1], px[2], px[3]]).size, 4, 'A, C, G and T are four distinct pixels');
    assert.equal(px[0], abgr(residueColours(FALLBACK_THEME, 'nucleotide').A));
    const forced = compileColumn(tree, col(dna, 'protein'));
    assert.equal(forced.alphabet, 'protein');
    assert.equal(pixels(forced)[0], pixels(forced)[1], 'A and C share the hydrophobic colour in the protein scheme');
    assert.equal(compileColumn(tree, col({ A: 'MKVL', B: 'MKVL' }, 'auto')).alphabet, 'protein');
    assert.equal(compileColumn(tree, { id: 'b', kind: 'bar', header: '', width: 10, values: { A: 1 } }).alphabet, null);
  });
});

test('the exported table equals what is drawn: bitmap pixels, and the runs of the large-alignment fallback', async () => {
  const theme = { ...DARK, residueC: '#336699' };
  const values = { A: 'ACGTUN-X', B: 'MKVLDEST' };
  for (const [alphabet, row] of [
    ['nucleotide', 'ACGTUN-X'],
    ['protein', 'MKVLDEST'],
  ]) {
    const table = residueColours(theme, alphabet);
    await withBitmaps(() => {
      const c = compileColumn(tree, col(values, alphabet), theme);
      const px = pixels(c);
      const o = alphabet === 'nucleotide' ? 0 : 8;
      [...row].forEach((ch, i) => assert.equal(px[o + i], ch === '-' ? 0 : abgr(table[table[ch] ? ch : 'other']), `${alphabet} ${ch}`));
    });
    // no document: no bitmap, the visible rows are drawn as runs of the same table
    const c = await withDocument(undefined, () => compileColumn(tree, col({ A: 'ACGTMKVL' }, alphabet), theme));
    c.x = 300;
    const ctx = fakeCtx();
    drawColumns(ctx, [c], tree, makeTransform('rectangular', 500, 180, { x0: 0, x1: 1, y0: 0, y1: 4 }, area, 4), theme, 12, '#336699');
    const rgb = (hex) => {
      const n = parseInt(hex.slice(1), 16);
      return `rgb(${n >> 16},${(n >> 8) & 255},${n & 255})`;
    };
    const runs = ctx.calls.filter((x) => x.op === 'fillRect').map((x) => x.fillStyle);
    const expected = [];
    for (const ch of 'ACGTMKVL') if (expected[expected.length - 1] !== rgb(table[ch])) expected.push(rgb(table[ch]));
    assert.deepEqual(runs, expected, `${alphabet}: one run per change of colour, in the colour of the exported table`);
    assert.equal(c.table[65], abgr(table.A), 'the column keeps the table it was compiled with');
  }
});

test('changing the theme recompiles the alignment bitmap; other columns and unchanged colours are kept', async () => {
  await withBitmaps(() => {
    const dna = col({ A: 'ACGT', B: 'ACGT' });
    const bar = { id: 'b', kind: 'bar', header: 'B', width: 40, values: { A: 1 } };
    const { columns } = updateColumns(tree, [], [dna, bar], FALLBACK_THEME);
    assert.equal(recolourColumns(tree, columns, { ...FALLBACK_THEME, branch: '#000000' }), columns, 'a theme without new residue colours: same list');
    assert.equal(
      recolourColumns(tree, columns, { ...FALLBACK_THEME, residueHydrophobic: '#000000' }),
      columns,
      'protein tokens do not repaint a nucleotide column',
    );
    columns[0].x = 17;
    const next = recolourColumns(tree, columns, { ...FALLBACK_THEME, residueG: '#010203' });
    assert.notEqual(next, columns);
    assert.equal(next[1], columns[1]);
    assert.equal(next[0].x, 17, 'the screen position is kept');
    assert.equal(pixels(next[0])[2], abgr('#010203'));
    assert.equal(pixels(columns[0])[2], abgr(residueColours(FALLBACK_THEME, 'nucleotide').G), 'the old column is unchanged');
    const dark = recolourColumns(tree, columns, DARK);
    assert.equal(pixels(dark[0])[0], abgr(residueColours(DARK, 'nucleotide').A), 'a dark theme repaints with the dark defaults');
  });
});

test('columnSpecEquals and updateColumns: a new alphabet recompiles, the same one (or auto spelled out) keeps the bitmap', async () => {
  await withBitmaps(() => {
    const values = { A: 'ACGT' };
    assert.equal(columnSpecEquals(col(values), col(values, 'auto')), true);
    assert.equal(columnSpecEquals(col(values), col(values, 'protein')), false);
    const first = updateColumns(tree, [], [col(values)]);
    const same = updateColumns(tree, first.columns, [col(values, 'auto')]);
    assert.equal(same.columns[0].bitmap, first.columns[0].bitmap, 'auto, written out, keeps the compiled column');
    const changed = updateColumns(tree, first.columns, [col(values, 'protein')]);
    assert.notEqual(changed.columns[0].bitmap, first.columns[0].bitmap);
    assert.equal(changed.columns[0].alphabet, 'protein');
  });
});

test('themeFromCss reads the residue tokens; themeEquals compares them', () => {
  const had = globalThis.getComputedStyle;
  const props = { '--phylo-residue-a': ' #112233 ', '--phylo-residue-hydrophobic': 'rgb(1,2,3)', '--phylo-background': '#000' };
  globalThis.getComputedStyle = () => ({ getPropertyValue: (k) => props[k] ?? '' });
  try {
    const t = themeFromCss({});
    assert.equal(t.residueA, '#112233');
    assert.equal(t.residueHydrophobic, 'rgb(1,2,3)');
    assert.equal(t.residueC, undefined);
    assert.equal(t.dark, true);
  } finally {
    globalThis.getComputedStyle = had;
  }
  assert.equal(themeEquals({ ...FALLBACK_THEME, residueA: '#111' }, { ...FALLBACK_THEME, residueA: '#111' }), true);
  assert.equal(themeEquals({ ...FALLBACK_THEME, residueA: '#111' }, FALLBACK_THEME), false);
  assert.equal(themeEquals({ ...FALLBACK_THEME, residueOther: '#111' }, FALLBACK_THEME), false);
});

test('viewer: setTheme repaints the alignment, dropping the override restores it, and CSS tokens are read at construction', async () => {
  const column = col({ a: 'ACGT', b: 'ACGT', c: 'ACGT', d: 'ACGT' });
  // the harness canvases record their calls: the last putImageData of the bitmap is the colours in force
  const latest = (h) => {
    const puts = h.viewer.columns[0].bitmap.ctx.calls('putImageData');
    return new Uint32Array(puts[puts.length - 1][1].data.buffer);
  };
  const defaults = residueColours(FALLBACK_THEME, 'nucleotide');
  const h = await makeViewer('((a,b),(c,d));', { columns: [column] });
  h.env.flush();
  assert.equal(latest(h)[2], abgr(defaults.G));
  h.viewer.setTheme({ residueG: '#0a0b0c' });
  h.env.flush();
  assert.equal(latest(h)[2], abgr('#0a0b0c'));
  assert.equal(latest(h)[0], abgr(defaults.A), 'the other bases keep their colour');
  h.viewer.setTheme({});
  assert.equal(latest(h)[2], abgr(defaults.G));
  h.viewer.setTheme({ background: '#0f172a', dark: true });
  assert.equal(latest(h)[0], abgr(residueColours(DARK, 'nucleotide').A), 'a dark theme gets the dark defaults');

  const css = await makeViewer('((a,b),(c,d));', { columns: [column], cssVars: { '--phylo-residue-t': '#0d0e0f' } });
  assert.equal(latest(css)[3], abgr('#0d0e0f'));
});

test('dark follows the merged background unless --phylo-dark or an override says: setTheme({ background }) gives the dark defaults', async () => {
  const column = col({ a: 'ACGT', b: 'ACGT', c: 'ACGT', d: 'ACGT' });
  const drawnA = (h) => {
    const puts = h.viewer.columns[0].bitmap.ctx.calls('putImageData');
    return new Uint32Array(puts[puts.length - 1][1].data.buffer)[0];
  };
  const h = await makeViewer('((a,b),(c,d));', { columns: [column] });
  assert.equal(h.viewer.getTheme().dark, false);
  h.viewer.setTheme({ background: '#0f172a', foreground: '#e2e8f0' }); // the playground's Dark preset
  assert.equal(h.viewer.getTheme().dark, true);
  assert.equal(drawnA(h), abgr(residueColours(DARK, 'nucleotide').A));
  h.viewer.setTheme({ background: 'rgba(15, 23, 42, 0.5)' });
  assert.equal(h.viewer.getTheme().dark, false, 'a translucent background says nothing: the default applies');
  h.viewer.setTheme({ background: '#0f172a', dark: false });
  assert.equal(h.viewer.getTheme().dark, false, 'an explicit dark wins');
  h.viewer.setTheme({});
  assert.equal(drawnA(h), abgr(residueColours(FALLBACK_THEME, 'nucleotide').A));
  const css = await makeViewer('((a,b),(c,d));', { cssVars: { '--phylo-background': 'transparent', '--phylo-dark': 'true' } });
  assert.equal(css.viewer.getTheme().dark, true);
  css.viewer.setTheme({ background: '#ffffff' });
  assert.equal(css.viewer.getTheme().dark, true, '--phylo-dark is explicit: the background does not override it');
});
