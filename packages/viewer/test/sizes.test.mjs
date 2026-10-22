import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { resolveSize, resolveTreeWidth, labelMinPx, scaledPx, AUTO_EM } = await import(path.join(root, 'packages/viewer/src/sizes.ts'));

test('resolveSize: px, em and auto follow the label size; a bad string is NaN', () => {
  assert.equal(resolveSize(24, 13), 24);
  assert.equal(resolveSize('2em', 13), 26);
  assert.equal(resolveSize('1.5em', 20), 30);
  assert.equal(resolveSize('auto', 13), 24, 'exactly 24 px at the default size');
  assert.equal(resolveSize('auto', 20), 37);
  assert.equal(resolveSize('1.5em', 13), 20, 'em values are whole px');
  assert.equal(resolveSize('auto', 10), Math.round(AUTO_EM * 10));
  assert.ok(Number.isNaN(resolveSize('big', 13)));
});

test('label thresholds and focus row are the old constants at the default label size, and scale with it', () => {
  assert.equal(labelMinPx('sparse', 13), 16);
  assert.equal(labelMinPx('normal', 13), 11);
  assert.equal(labelMinPx('dense', 13), 8);
  assert.equal(scaledPx(26, 13), 26);
  assert.equal(labelMinPx('normal', 26), 22);
  assert.equal(labelMinPx('dense', 11), 8, 'never under the 8 px label font');
  assert.equal(labelMinPx('normal', 8), 8);
});

test('resolveTreeWidth: auto and bad values are null, px and % resolve', () => {
  assert.equal(resolveTreeWidth('auto', 800), null);
  assert.equal(resolveTreeWidth(300, 800), 300);
  assert.equal(resolveTreeWidth('25%', 800), 200);
  assert.equal(resolveTreeWidth('x%', 800), null);
  assert.equal(resolveTreeWidth(0, 800), null);
});
