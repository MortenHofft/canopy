// The small NEXUS fixtures taken from other libraries' tests (tests/bench/parsers/fixtures/edge/nexus-*.json; sources and
// licences in each fixture and in NOTICE-nexus.md there). What parseNexus must do with each: the fixture's own expectation,
// or `ours` where we differ on purpose (`oursWhy`). The comparison with DendroPy is tests/bench/parsers/src/nexus-edge-compare.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNexus } from '../src/newick.ts';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../tests/bench/parsers/fixtures/edge');
const fixtures = fs
  .readdirSync(DIR)
  .filter((f) => /^nexus-.*\.json$/.test(f))
  .flatMap((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));

test('the NEXUS fixtures have unique ids and say where they come from', () => {
  assert.ok(fixtures.length >= 160);
  assert.equal(new Set(fixtures.map((f) => f.id)).size, fixtures.length);
  for (const f of fixtures) {
    assert.ok(f.source && f.licence && ['verbatim', 'rephrased'].includes(f.copied), f.id);
    assert.ok(f.ours === undefined || f.oursWhy, `${f.id}: a deliberate difference needs a reason`);
  }
});

for (const fx of fixtures) {
  const parses = fx.ours ? fx.ours === 'parses' : fx.wellFormed;
  test(`${fx.id}: ${parses ? 'parses' : 'throws'}`, () => {
    if (!parses) {
      assert.throws(
        () => parseNexus(fx.input),
        (e) => e.name === 'NewickError',
      );
      return;
    }
    const { tree } = parseNexus(fx.input);
    // what we return for the tips: the fixture's own list, or ours where we differ on purpose (then it must be written down)
    const labels = fx.oursTipLabels ?? fx.tipLabels;
    if (fx.ours === 'parses') assert.ok(labels, `${fx.id}: a deliberate difference needs oursTipLabels`);
    if (labels) assert.deepEqual([...tree.tipLabels].sort(), [...labels].sort());
    if (!fx.ours && fx.tipCount != null) assert.equal(tree.tipCount, fx.tipCount);
    for (const code of fx.oursWarns ?? []) {
      assert.ok(
        tree.warnings.some((w) => w.code === code),
        `expected the warning ${code}, got ${tree.warnings.map((w) => w.code)}`,
      );
    }
  });
}
