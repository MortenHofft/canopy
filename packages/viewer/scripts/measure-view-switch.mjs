// Measures the view kept across a switch of layout or branch lengths (#56; docs/design/view-switch.md) on three trees in the fake DOM of
// test/viewer-harness.mjs, 1000 x 700 px: for 15 zoomed clades of 6 to 40 tips each (zoomToNode), the share of the tips in view that stay
// in view, whether the whole clade does, and the tip pitch after / before, for three approaches: 'fit' (the whole tree, as before #56),
// 'anchor' (the same pitch, centred on the tip at the centre of the window) and 'keep' (the option's default: the tips in view at the same
// pitch). Then the branch-length switch with 'keep'. Prints Markdown tables.
//   node --experimental-transform-types --conditions=@canopy/source scripts/measure-view-switch.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { makeViewer, destroyAll } from '../test/viewer-harness.mjs';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { parseNewick, parseNexus } = await import(path.join(root, 'packages/io/src/index.ts'));
const D = path.join(root, 'data') + '/';
const read = (p) => (p.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(D + p)).toString('utf8') : fs.readFileSync(D + p, 'utf8'));
const TREES = [
  ['Carangaria MCC, 135 tips (dated)', () => parseNexus(read('rich/fish-carangaria-mcc/Carangaria-MCC.tre')).tree],
  ['Fishes, Rabosky, 1,057 tips (dated)', () => parseNewick(read('rich/fish-rabosky-1057/Rabosky1057.tre'))],
  ['Open Tree, Amphibia, 10k tips', () => parseNewick(read('real-ladder/trees/otl-10k-amphibia.nwk.gz'))],
];
const SIZE = [1000, 700];
function inView(v) {
  const t = v.getTree();
  const ranks = new Set(),
    radii = [];
  for (let r = 0; r < t.tipCount; r++)
    if (v.nodePosition(t.tipNode[r])) {
      ranks.add(r);
      radii.push(v.layout.X[t.tipNode[r]]);
    }
  radii.sort((a, b) => a - b);
  const T = v.T;
  return { ranks, pitch: T.kind === 'rectangular' ? T.ky : T.k * T.da * (radii[radii.length >> 1] ?? 0) };
}
function anchorView(v, from) {
  // approach 2/3: the tip at the centre of the old window, at the same pitch, centred
  const t = v.getTree(),
    L = v.layout,
    vp = v.getViewport(),
    a0 = v.vs.area;
  let node, pitch;
  if (from === 'rectangular') {
    const row = Math.max(0, Math.min(L.rows - 1, Math.floor((vp.y0 + vp.y1) / 2)));
    node = t.tipNode[row];
    pitch = a0.ah / (vp.y1 - vp.y0);
  } else {
    const cx = (vp.x0 + vp.x1) / 2,
      cy = (vp.y0 + vp.y1) / 2;
    const da = L.fan.span / L.rows;
    let best = Infinity;
    for (let r = 0; r < t.tipCount; r++) {
      const n = t.tipNode[r],
        ang = L.fan.start + (r + 0.5) * da;
      const d = Math.hypot(L.X[n] * Math.cos(ang) - cx, L.X[n] * Math.sin(ang) - cy);
      if (d < best) {
        best = d;
        node = n;
      }
    }
    pitch = (a0.aw / (vp.x1 - vp.x0)) * da * L.X[node];
  }
  return { node, pitch, kx: a0.aw / (vp.x1 - vp.x0) };
}
const out = [];
for (const [name, load] of TREES) {
  const tree = load();
  const rows = { fit: [], anchor: [], keep: [] };
  for (const from of ['rectangular', 'radial']) {
    const to = from === 'radial' ? 'rectangular' : 'radial';
    for (const how of ['fit', 'anchor', 'keep']) {
      const { viewer: v, env } = await makeViewer(tree, { size: SIZE, options: { layout: from, switchView: how === 'fit' ? 'fit' : 'keep' } });
      env.flush();
      const t = v.getTree();
      const clades = [];
      for (let i = 1; i < t.nodeCount; i++) {
        const n = t.leafEnd[i] - t.leafStart[i];
        if (t.childCount[i] > 0 && n >= 6 && n <= 40) clades.push(i);
      }
      const step = Math.max(1, Math.floor(clades.length / 15));
      for (let c = 0; c < clades.length && c / step < 15; c += step) {
        const node = clades[c];
        v.fit(false);
        v.zoomToNode(node);
        env.flush();
        const a = inView(v);
        if (how === 'anchor') {
          const an = anchorView(v, from);
          v.setOptions({ switchView: 'fit', layout: to });
          env.flush();
          v.vs.computeArea();
          const L = v.layout,
            ar = v.vs.area,
            rows0 = L.rows,
            da = L.fan.span / rows0;
          const row = t.tipRank[an.node];
          if (to === 'radial') {
            const r = L.X[an.node],
              ang = L.fan.start + (row + 0.5) * da,
              k = an.pitch / (da * r);
            const x = r * Math.cos(ang),
              y = r * Math.sin(ang);
            v.setViewport({ x0: x - ar.aw / 2 / k, x1: x + ar.aw / 2 / k, y0: y - ar.ah / 2 / k, y1: y + ar.ah / 2 / k });
          } else {
            const h = ar.ah / an.pitch,
              w = ar.aw / an.kx,
              x1 = L.X[an.node] + 0.05 * w;
            v.setViewport({ x0: x1 - w, x1, y0: row + 0.5 - h / 2, y1: row + 0.5 + h / 2 });
          }
          env.flush();
          v.setOptions({ switchView: 'keep' });
        } else {
          v.setOptions({ layout: to });
          env.flush();
        }
        const b = inView(v);
        let kept = 0,
          cl = 0;
        for (const r of a.ranks) if (b.ranks.has(r)) kept++;
        for (let r = t.leafStart[node]; r < t.leafEnd[node]; r++) if (b.ranks.has(r)) cl++;
        rows[how].push({
          from,
          kept: kept / a.ranks.size,
          pitch: b.pitch / a.pitch,
          clade: cl / (t.leafEnd[node] - t.leafStart[node]),
          n0: a.ranks.size,
          n1: b.ranks.size,
        });
        v.setOptions({ layout: from });
        env.flush();
      }
      destroyAll();
    }
  }
  const med = (xs) => {
    const s = [...xs].sort((p, q) => p - q);
    return s[s.length >> 1];
  };
  for (const how of ['fit', 'anchor', 'keep'])
    for (const from of ['rectangular', 'radial']) {
      const r = rows[how].filter((x) => x.from === from);
      out.push(
        `| ${name} | ${from} -> ${from === 'radial' ? 'rectangular' : 'radial'} | ${how} | ${r.length} | ${(100 * med(r.map((x) => x.kept))).toFixed(0)}% | ${(100 * Math.min(...r.map((x) => x.kept))).toFixed(0)}% | ${((100 * r.filter((x) => x.clade === 1).length) / r.length).toFixed(0)}% | ${med(r.map((x) => x.pitch)).toFixed(2)} | ${Math.min(...r.map((x) => x.pitch)).toFixed(2)}-${Math.max(...r.map((x) => x.pitch)).toFixed(2)} | ${med(r.map((x) => x.n0))} -> ${med(r.map((x) => x.n1))} |`,
      );
    }
}
console.log(
  '| Tree | Switch | Approach | Clades | Tips kept (median) | Tips kept (worst) | Whole clade in view | Pitch after / before (median) | Pitch range | Tips in view (median) |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
console.log(out.join('\n'));

console.log('');
console.log(
  '| Tree | Switch | Clades x 2 | Tips kept (median) | Tips kept (worst) | Whole clade in view | Pitch after / before (median) | Pitch range |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const [name, load] of TREES.slice(0, 2)) {
  const tree = load();
  for (const layout of ['rectangular', 'radial']) {
    const res = [];
    const { viewer: v, env } = await makeViewer(tree, { size: SIZE, options: { layout } });
    env.flush();
    const t = v.getTree();
    const clades = [];
    for (let i = 1; i < t.nodeCount; i++) {
      const n = t.leafEnd[i] - t.leafStart[i];
      if (t.childCount[i] > 0 && n >= 6 && n <= 40) clades.push(i);
    }
    const step = Math.max(1, Math.floor(clades.length / 15));
    for (let c = 0; c < clades.length && c / step < 15; c += step) {
      const node = clades[c];
      for (const lengths of [true, false]) {
        v.setOptions({ branchLengths: lengths });
        v.fit(false);
        v.zoomToNode(node);
        env.flush();
        const a = inView(v);
        v.setOptions({ branchLengths: !lengths });
        env.flush();
        const b = inView(v);
        let kept = 0,
          cl = 0;
        for (const r of a.ranks) if (b.ranks.has(r)) kept++;
        for (let r = t.leafStart[node]; r < t.leafEnd[node]; r++) if (b.ranks.has(r)) cl++;
        res.push({ kept: kept / a.ranks.size, pitch: b.pitch / a.pitch, clade: cl / (t.leafEnd[node] - t.leafStart[node]) });
      }
    }
    destroyAll();
    const med = (xs) => {
      const s = [...xs].sort((p, q) => p - q);
      return s[s.length >> 1];
    };
    console.log(
      `| ${name} | ${layout}, phylogram <-> cladogram | ${res.length} | ${(100 * med(res.map((x) => x.kept))).toFixed(0)}% | ${(100 * Math.min(...res.map((x) => x.kept))).toFixed(0)}% | ${((100 * res.filter((x) => x.clade === 1).length) / res.length).toFixed(0)}% | ${med(res.map((x) => x.pitch)).toFixed(2)} | ${Math.min(...res.map((x) => x.pitch)).toFixed(2)}-${Math.max(...res.map((x) => x.pitch)).toFixed(2)} |`,
    );
  }
}

// the cost of the mapping (viewContent + placeContent), once per switch, on OTL 100k when it is there (git-ignored, fetched by script)
const big = path.join(D, 'real-ladder/trees/otl-100k-vertebrata.nwk.gz');
if (fs.existsSync(big)) {
  const { viewContent, placeContent } = await import('../src/view-carry.ts');
  const tree = parseNewick(zlib.gunzipSync(fs.readFileSync(big)).toString('utf8'));
  const { viewer: v, env } = await makeViewer(tree, { size: SIZE });
  env.flush();
  const t = v.getTree();
  console.log('');
  for (const [what, layout, view] of [
    ['rectangular, 30 rows', 'rectangular', () => ({ x0: 0.8, x1: 1.05, y0: t.tipCount / 2, y1: t.tipCount / 2 + 30 })],
    ['rectangular, half the tree', 'rectangular', () => ({ x0: 0, x1: 1, y0: 0, y1: t.tipCount / 2 })],
    [
      'radial, zoomed in at the rim',
      'radial',
      (f) => ({ x0: -1 - (f.x1 - f.x0) / 800, x1: -1 + (f.x1 - f.x0) / 800, y0: -(f.y1 - f.y0) / 800, y1: (f.y1 - f.y0) / 800 }),
    ],
    ['radial, the root in the window', 'radial', (f) => ({ x0: f.x0 / 3, x1: f.x1 / 3, y0: f.y0 / 3, y1: f.y1 / 3 })],
  ]) {
    v.setOptions({ layout });
    env.flush();
    v.vs.computeArea();
    const vp = view(v.fitViewport());
    const area = { ...v.vs.area };
    const ms = [];
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now();
      const c = viewContent(layout, vp, area, v.layout, t);
      if (c)
        placeContent(c, { kind: layout === 'radial' ? 'rectangular' : 'radial', L: v.layout, tree: t, area, fit: v.fitViewport(), readable: 11 });
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    console.log(`${t.tipCount} tips, ${what}: ${ms[3].toFixed(2)} ms (median of 7)`);
  }
  destroyAll();
}
