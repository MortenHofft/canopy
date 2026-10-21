// Writes test/cut-golden.json: the golden draw lists and CutResults of test/cut-golden.test.mjs, from the CURRENT code.
//   node --experimental-transform-types scripts/capture-cut-golden.mjs [out.json]      (default: test/cut-golden.json)
// The committed goldens were captured from commit e2897fb (the cut before it was moved behind the layout projection); on the current code
// this script reproduces them byte for byte (`git diff --exit-code test/cut-golden.json`). Run it only after a DELIBERATE change of the cut's
// output, and review the diff of the JSON like any other behaviour change. One case per line, so a diff shows which cases moved.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const out = path.resolve(process.argv[2] ?? path.join(here, '..', 'test', 'cut-golden.json'));
const core = path.join(root, 'spikes/custom/src/core');
const { parseNewick } = await import(path.join(root, 'spikes/shared/newick.ts'));
const { computeLayout, ensureTrig } = await import(path.join(core, 'layout.ts'));
const { makeTransform } = await import(path.join(core, 'geom.ts'));
const { DrawList, Seen, searchCut } = await import(path.join(core, 'lod.ts'));
const { InMemorySource } = await import(path.join(core, 'source.ts'));
const { projectionFor } = await import(path.join(core, 'projection.ts'));
const { W, H, TREES, VIEWS, allCases } = await import(path.join(here, '..', 'test', 'cut-golden-cases.mjs'));
const area = { ax: 0, ay: 0, aw: W, ah: H, clipL: 0, clipT: 0, clipR: W, clipB: H };

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
  ensureTrig(L);
  built[name] = { s, L, classOf: spec.classes ? Uint8Array.from({ length: s.nodeCount }, (_, i) => spec.classes(i)) : null };
}

const lines = [];
for (const c of allCases()) {
  const { s, L, classOf } = built[c.tree];
  const N = s.tipCount;
  const T = makeTransform(c.layout, W, H, VIEWS[c.layout][c.view](N), area, N);
  const list = new DrawList();
  const r = searchCut(projectionFor(s, L, T), classOf, list, new Seen(), {
    lod: true,
    base: c.opts.base,
    budget: c.opts.budget,
    summaries: true,
    hint: 0,
  });
  const entries = [];
  for (let e = 0; e < list.count; e++) entries.push(list.node[e], list.kind[e], list.cls[e], list.last[e], list.xmax[e]);
  lines.push(JSON.stringify(c.id) + ':' + JSON.stringify({ res: r.res, minPx: r.minPx, retries: r.retries, entries }));
}
fs.writeFileSync(out, '{\n' + lines.join(',\n') + '\n}\n');
console.log(`${lines.length} cases written to ${out}`);
