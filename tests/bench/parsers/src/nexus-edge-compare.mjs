// Small NEXUS fixtures (fixtures/edge/nexus-*.json, the shape of well-formed.json) against what the fixture expects, what our
// parseNexus does and what DendroPy does.
//   node --experimental-transform-types --no-warnings src/nexus-edge-compare.mjs [fixtures.json ...] [--all] [--json out.json]
// With no file: every fixtures/edge/nexus-*.json. Needs `pip install dendropy`. Imports the parser from the sources.
//
// A fixture has { id, input, wellFormed, tipCount, tipLabels, source, licence, copied, note }; tipCount and tipLabels
// (of the first tree, sorted) may be null for "not asserted". `ours` ("parses" or "throws") with `oursWhy` records a deliberate
// difference from the source library's expectation; `oursWarns` lists warning codes we must raise. Per fixture, three results are compared:
//   expected    what the fixture says: parses with these tips, or is malformed
//   ours        parseNexus, tree 0
//   dendropy    TreeList (DataSet when there are several TAXA blocks), preserve_underscores, tree 0
// Only the fixtures where something disagrees are listed, unless --all.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signature } from './nexus-shape.mjs';
import { parseNexus } from '../../../../packages/io/src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const all = argv.includes('--all');
const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
let files = argv.filter((a) => a.endsWith('.json') && a !== jsonOut);
if (!files.length) {
  const dir = resolve(here, '..', 'fixtures', 'edge');
  files = readdirSync(dir)
    .filter((f) => /^nexus-.*\.json$/.test(f))
    .map((f) => join(dir, f));
}
const fixtures = files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')));

const tmp = mkdtempSync(join(tmpdir(), 'nexus-edge-'));
const paths = fixtures.map((fx, i) => {
  const p = join(tmp, `${i}.nex`);
  writeFileSync(p, fx.input, 'utf8');
  return p;
});
const py = spawnSync('python3', [resolve(here, 'dendropy-nexus-summary.py'), ...paths], { encoding: 'utf8', maxBuffer: 1 << 28 });
rmSync(tmp, { recursive: true, force: true });
if (py.status !== 0) {
  console.error(py.stderr.slice(0, 500));
  process.exit(1);
}
const dp = py.stdout
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));

const sameLabels = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
/** 'ok' parsed and matches the expectation, 'wrong' parsed but not as expected, 'error' threw. */
function judge(fx, r, wellFormed = fx.wellFormed) {
  if (r.error) return wellFormed ? 'error' : 'ok';
  if (!wellFormed) return 'wrong';
  if (fx.tipCount != null && r.tips !== fx.tipCount) return 'wrong';
  if (fx.tipLabels != null && !sameLabels(r.labels, fx.tipLabels)) return 'wrong';
  return 'ok';
}

const rows = fixtures.map((fx, i) => {
  let o;
  try {
    const t = parseNexus(fx.input).tree;
    o = { tips: t.tipCount, labels: [...t.tipLabels], sig: signature(t) };
  } catch (e) {
    o = { error: e.message.slice(0, 100) };
  }
  const d0 = dp[i];
  let d;
  if (d0.error) d = { error: d0.error.slice(0, 100) };
  else if (!d0.trees || !d0.trees['0']) d = { error: 'no trees' };
  else d = { tips: d0.trees['0'].tips, labels: d0.trees['0'].labels, sig: d0.trees['0'].sig };
  // `ours` on a fixture says what we do on purpose where that is not what the fixture's source expects (see oursWhy)
  const ours = judge(fx, o, fx.ours ? fx.ours === 'parses' : fx.wellFormed);
  const dendropy = judge(fx, d);
  const agree = o.error || d.error ? !!o.error === !!d.error : o.tips === d.tips && sameLabels(o.labels, d.labels) && o.sig === d.sig;
  return { id: fx.id, wellFormed: fx.wellFormed, ours, dendropy, agree, o, d, fx };
});

const bad = rows.filter((r) => r.ours !== 'ok' || !r.agree);
for (const r of all ? rows : bad) {
  const show = (x) => (x.error ? `throws "${x.error}"` : `${x.tips} tips ${JSON.stringify(x.labels).slice(0, 90)}`);
  console.log(
    `${r.id}  [expected ${r.wellFormed ? 'parses' : 'malformed'}; ours ${r.ours}, dendropy ${r.dendropy}${r.agree ? '' : ', they differ'}]`,
  );
  console.log(`    ours: ${show(r.o)}\n    dendropy: ${show(r.d)}\n    ${r.fx.source} | ${r.fx.note ?? ''}`.slice(0, 700));
}
const n = (f) => rows.filter(f).length;
console.log(
  `\n${rows.length} fixtures: ours ok ${n((r) => r.ours === 'ok')}, dendropy ok ${n((r) => r.dendropy === 'ok')}, ours and dendropy agree ${n((r) => r.agree)}`,
);
if (jsonOut)
  writeFileSync(
    jsonOut,
    JSON.stringify(
      rows.map(({ fx: _fx, ...r }) => r),
      null,
      1,
    ),
  );
