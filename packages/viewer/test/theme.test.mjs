// Unit tests of the theme from CSS (src/theme.ts): property names, list splitting, luminance, and themeFromCss over a fake
// getComputedStyle (unset and unreadable values are left out; dark follows the background unless --phylo-dark says otherwise).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { THEME_CSS_VARS, themeFromCss, splitList, luminance } = await import('../src/theme.ts');
const { FALLBACK_THEME, themeEquals } = await import('../src/types.ts');

test('every theme field has a --phylo- property in kebab case', () => {
  assert.deepEqual(Object.keys(THEME_CSS_VARS).sort(), Object.keys(FALLBACK_THEME).sort());
  assert.equal(THEME_CSS_VARS.branchWidth, '--phylo-branch-width');
  assert.equal(THEME_CSS_VARS.fontFamily, '--phylo-font-family');
  assert.equal(THEME_CSS_VARS.background, '--phylo-background');
});

test('splitList keeps commas inside parentheses; luminance of hex and rgb', () => {
  assert.deepEqual(splitList(' #fff, rgb(1, 2, 3) ,hsl(0 0% 0%),, '), ['#fff', 'rgb(1, 2, 3)', 'hsl(0 0% 0%)']);
  assert.deepEqual(splitList(''), []);
  assert.equal(luminance('#fff'), 1);
  assert.equal(luminance('#000000'), 0);
  assert.ok(luminance('rgb(15, 23, 42)') < 0.05);
  assert.equal(luminance('oklch(0.5 0.1 200)'), null);
});

function withStyle(props, fn) {
  const had = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({ getPropertyValue: (k) => props[k] ?? '' });
  try {
    return fn();
  } finally {
    globalThis.getComputedStyle = had;
  }
}

test('themeFromCss reads colours, font, the list and numbers; leaves out what is unset or not a number', () => {
  const t = withStyle(
    {
      '--phylo-background': ' #0f172a ',
      '--phylo-branch': 'rgb(148, 163, 184)',
      '--phylo-font-family': "'Rubik', sans-serif",
      '--phylo-categorical': '#684393, #6985bd',
      '--phylo-branch-width': '1.5px',
      '--phylo-summary-opacity': '0.4',
      '--phylo-tip-radius': 'big',
    },
    () => themeFromCss({}),
  );
  assert.deepEqual(t, {
    background: '#0f172a',
    branch: 'rgb(148, 163, 184)',
    fontFamily: "'Rubik', sans-serif",
    categorical: ['#684393', '#6985bd'],
    branchWidth: 1.5,
    summaryOpacity: 0.4,
    dark: true,
  });
  assert.ok(!themeEquals({ ...FALLBACK_THEME, ...t }, FALLBACK_THEME));
  assert.deepEqual(
    withStyle({}, () => themeFromCss({})),
    {},
    'nothing set: nothing read',
  );
  assert.deepEqual(
    withStyle({ '--phylo-background': '#fff', '--phylo-dark': 'true' }, () => themeFromCss({})),
    { background: '#fff', dark: true },
    '--phylo-dark wins over the background',
  );
});

test('themeEquals compares every field, categorical element-wise', () => {
  assert.ok(themeEquals(FALLBACK_THEME, { ...FALLBACK_THEME, categorical: FALLBACK_THEME.categorical.slice() }));
  assert.ok(!themeEquals(FALLBACK_THEME, { ...FALLBACK_THEME, branchWidth: 2 }));
  assert.ok(!themeEquals(FALLBACK_THEME, { ...FALLBACK_THEME, categorical: ['#000'] }));
});
