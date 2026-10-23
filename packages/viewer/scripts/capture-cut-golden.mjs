// Writes test/cut-golden.json: the golden draw lists and CutResults of test/cut-golden.test.mjs, from the CURRENT code.
//   node --experimental-transform-types scripts/capture-cut-golden.mjs [out.json]      (default: test/cut-golden.json)
// The committed goldens were captured from commit e2897fb (the cut before it was moved behind the layout projection), the radial ones
// again for issue #41 (the opening of the radial fan); on the current code this script reproduces them byte for byte once formatted
// (`git diff --exit-code test/cut-golden.json` after the Prettier step below). Run it only after a DELIBERATE change of the cut's
// output, and review the diff of the JSON like any other behaviour change. One case per line, so a diff shows which cases moved. The
// radial cases use the default fan of the options (radialOpening, radialRotation); the same cases on the whole circle from 3 o'clock
// (radialFan(0, 0), the angles before the options existed) are kept as hashes in test/cut-golden-circle.json, written next to it.
// The committed cut-golden.json is this output formatted by Prettier: `npx prettier --parser json < out.json`.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const out = path.resolve(process.argv[2] ?? path.join(here, '..', 'test', 'cut-golden.json'));
const core = path.join(root, 'packages/viewer/src');
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));
const { computeLayout, ensureTrig, radialFan, setLayoutFan } = await import(path.join(core, 'layout.ts'));
const { DEFAULT_OPTIONS } = await import(path.join(core, 'types.ts'));
const { makeTransform } = await import(path.join(core, 'geom.ts'));
const { DrawList, Seen, searchCut } = await import(path.join(core, 'lod.ts'));
const { InMemorySource } = await import(path.join(core, 'source.ts'));
const { projectionFor } = await import(path.join(core, 'projection.ts'));
const { W, H, TREES, VIEWS, allCases } = await import(path.join(here, '..', 'test', 'cut-golden-cases.mjs'));
const area = { ax: 0, ay: 0, aw: W, ah: H, clipL: 0, clipT: 0, clipR: W, clipB: H };
const FAN = radialFan(DEFAULT_OPTIONS.radialOpening, DEFAULT_OPTIONS.radialRotation);
const CIRCLE = radialFan(0, 0);

// the same snapshots as the test builds (a stub snapshot has a `stub` array marking rows that stand for clades that are not loaded)
const built = {};
for (const [name, spec] of Object.entries(TREES)) {
  const snap = new InMemorySource(parseNewick(spec.nwk)).snapshot();
  let s = snap;
  if (spec.stubs) {
    const stub = new Uint8Array(snap.nodeCount);
    for (let i = 0; i < snap.nodeCount; i++) if (spec.stubs(i, snap.childCount[i])) stub[i] = 1;
    s = Object.create(snap);
    Object.defineProperty(s, 'stub', { value: stub });
  }
  const L = computeLayout(s, true);
  built[name] = { s, L, classOf: spec.classes ? Uint8Array.from({ length: s.nodeCount }, (_, i) => spec.classes(i)) : null };
}

function capture(c, fan) {
  const { s, L, classOf } = built[c.tree];
  const N = s.tipCount;
  setLayoutFan(L, fan);
  ensureTrig(L);
  const T = makeTransform(c.layout, W, H, VIEWS[c.layout][c.view](N), area, N, fan);
  const list = new DrawList();
  const r = searchCut(projectionFor(s, L, T), classOf, list, new Seen(), {
    lod: true,
    base: c.opts.base,
    budget: c.opts.budget,
    summaries: true,
    hint: 0,
    cap: Infinity,
  });
  const entries = [];
  for (let e = 0; e < list.count; e++) entries.push(list.node[e], list.kind[e], list.cls[e], list.last[e], list.xmax[e]);
  return { res: r.res, minPx: r.minPx, retries: r.retries, entries };
}

const lines = [],
  circle = [];
for (const c of allCases()) {
  lines.push(JSON.stringify(c.id) + ':' + JSON.stringify(capture(c, FAN)));
  if (c.layout === 'radial') circle.push(JSON.stringify(c.id) + ':' + JSON.stringify(goldenHash(capture(c, CIRCLE))));
}
fs.writeFileSync(out, '{\n' + lines.join(',\n') + '\n}\n');
const outCircle = path.join(path.dirname(out), 'cut-golden-circle.json');
fs.writeFileSync(outCircle, '{\n' + circle.join(',\n') + '\n}\n');
console.log(`${lines.length} cases written to ${out}, ${circle.length} hashes to ${outCircle}`);

/** The hash test/cut-golden.test.mjs compares for a case on the whole circle (sha256 of the golden record, 16 hex digits). */
function goldenHash(g) {
  return createHash('sha256').update(JSON.stringify(g)).digest('hex').slice(0, 16);
}
