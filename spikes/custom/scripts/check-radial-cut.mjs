// Regression check of the radial cut (level of detail, budget, culling, summaries, hit-testing). Plain Node, no browser:
//   node --experimental-transform-types spikes/custom/scripts/check-radial-cut.mjs [--tips 10000] [--budget 2000]
// Run with: node --experimental-transform-types spikes/custom/scripts/check-radial-cut.mjs (Node >= 22.7; the core is TypeScript).
// Runs the real core modules on the committed 10,000-tip Yule tree (data/synthetic/newick/yule_10000.nwk.gz; other sizes are
// generated with data/synthetic/generate.py into a temp dir) laid out radially in a 1100 x 640 container, and checks, at the fit view and at 4x and 16x zoom:
//   1. drawn primitives <= the budget (tolerance 0 above the budget; when the cut is active the list is at least 75% of the budget)
//   2. tips drawn + tips inside summaries + tips merged on the same pixel cells == tips of the tree (fit view: everything is visible)
//   3. every summary's tip count (leafEnd - leafStart) equals a brute-force count of the tips in its subtree
//   4. culling never drops a visible tip: with LOD off, every tip whose screen position is inside the window is in the list;
//      and in the LOD cut every visible tip is a drawn tip, inside a drawn summary, or counted as merged
//   5. zooming in reveals detail: at 16x the collapse threshold is back at the base value and no summary is forced
//   6. hit-testing: a point inside a drawn summary hits that summary (kind 'summary') with the right tip range
//   7. a deep zoom visits a small part of the tree (the cull is a sector test, not a bounding box of the whole tree)
//   9. a polytomy of thousands of tips (issue 13) is drawn as one slice and does not push the collapse threshold up: at a zoom
//      where its children are about a pixel apart, no child is drawn individually, nothing is forced, and a click on it hits it
//  10. a mixed polytomy (issue 13: 8,000 children, 1,000 tips, 6,900 pairs, 100 clades of 60 tips, spread through the order) is
//      drawn as runs of small siblings plus its large children as their own entries, in radial and rectangular layout: a bounded
//      number of primitives, threshold not raised, no tip covered twice, tips add up at the fit view, a click in a run reports
//      exactly the run's tip range
//  11. zooming in smoothly changes few entries per step: on the real OTL 91k tree, radial, a 2% zoom step changes at most 8% of
//      the draw list (it was about 13% when the pixel-cell dedupe grid moved with the scale; about 5% is the natural change)
//  12. the collapse threshold is stable while zooming in: along a smooth 3% zoom path on the real OTL 91k tree (radial, budgets
//      500 and 2,000) it rises at most once (the old bisecting search made it rise 11 times in 111 steps at budget 500)
//   8. panning by a fraction of a pixel does not change the cut: with the whole tree in view the set of collapsed clades is
//      identical at every sub-pixel offset, in radial and rectangular layout, at budgets 500 and 2,000 (issue 1)
// Exit code 1 on any failure.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const TIPS = Number(args.tips || 10000);
const BUDGET = Number(args.budget || 2000);

const { parseNewick } = await import(path.join(root, 'spikes/shared/newick.ts'));
const { computeLayout, ensureTrig } = await import(path.join(root, 'spikes/custom/src/core/layout.ts'));
const { makeTransform } = await import(path.join(root, 'spikes/custom/src/core/geom.ts'));
const { DrawList, Seen, searchCut, K_TIP, K_SUMMARY, isSlice, SLICE_MIN_CHILDREN } = await import(path.join(root, 'spikes/custom/src/core/lod.ts'));
const { HitIndex } = await import(path.join(root, 'spikes/custom/src/core/hit.ts'));

// ---- the tree: committed 10k file when TIPS is 10000, otherwise generated with the repo's generator
function loadNewick() {
  const committed = path.join(root, 'data/synthetic/newick/yule_10000.nwk.gz');
  if (TIPS === 10000 && fs.existsSync(committed)) return execFileSync('gzip', ['-dc', committed], { maxBuffer: 1 << 28 }).toString('utf8');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'radial-cut-'));
  execFileSync('python3', ['-I', path.join(root, 'data/synthetic/generate.py'), '--out', tmp, '--sizes', String(TIPS), '--shapes', 'yule'], {
    stdio: 'ignore',
  });
  return fs.readFileSync(path.join(tmp, 'newick', `yule_${TIPS}.nwk`), 'utf8');
}
const tree = parseNewick(loadNewick());
const L = computeLayout(tree, true);
ensureTrig(L);
const N = tree.tipCount;
console.log(`tree: ${N} tips, ${tree.nodeCount} nodes; budget ${BUDGET}`);

// ---- the viewport, as the renderer's fit and zoom
const W = 1100,
  H = 640;
const area = { ax: 0, ay: 0, aw: W, ah: H, clipL: 0, clipT: 0, clipR: W, clipB: H };
const kfit = Math.max(20, Math.min(W, H) / 2 - 28);
const fitView = { x0: -W / 2 / kfit, x1: W / 2 / kfit, y0: -H / 2 / kfit, y1: H / 2 / kfit };
const zoomView = (z, cx, cy) => {
  const w = (fitView.x1 - fitView.x0) / z,
    h = (fitView.y1 - fitView.y0) / z;
  return { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 };
};
const views = [
  ['fit', fitView],
  ['4x at (0.75, 0)', zoomView(4, 0.75, 0)],
  ['4x at 200 deg, r 0.8', zoomView(4, 0.8 * Math.cos((200 * Math.PI) / 180), 0.8 * Math.sin((200 * Math.PI) / 180))],
  ['16x at (0.9, 0.1)', zoomView(16, 0.9, 0.1)],
];

let failures = 0;
const fail = (m) => {
  failures++;
  console.log('  FAIL ' + m);
};
const ok = (c, m) => {
  if (!c) fail(m);
};

const list = new DrawList(),
  seen = new Seen();
const lo = new DrawList(),
  seen2 = new Seen();
let prev = null;
for (const [name, vp] of views) {
  const T = makeTransform('radial', W, H, vp, area, N);
  const { res, minPx, retries } = searchCut(false, tree, L, T, null, list, seen, { lod: true, base: 3, budget: BUDGET, summaries: true, hint: 0 });
  console.log(
    `${name}: drawn ${list.count} (tips ${res.tips}, summaries ${res.summaries}, forced ${res.forced}), minPx ${minPx.toFixed(2)}, passes ${retries + 1}, visited ${res.visited}, merged tips ${res.mergedTips}`,
  );
  // 1 budget
  ok(!res.overflow, `${name}: list overflowed the budget (truncated)`);
  ok(list.count <= BUDGET, `${name}: drawn ${list.count} > budget ${BUDGET}`);
  if (res.forced > 0)
    ok(
      list.count >= 0.75 * BUDGET,
      `${name}: the cut is active but drew only ${list.count} of ${BUDGET} (tolerance 25% below the budget: clades of equal size collapse together, so the count moves in steps)`,
    );
  // 3 summary tip counts (brute force over the subtree range)
  let sumTips = 0,
    tipsDrawn = 0,
    bad = 0;
  const covered = new Uint8Array(N);
  for (let e = 0; e < list.count; e++) {
    const i = list.node[e];
    if (list.kind[e] === K_SUMMARY) {
      let c = 0;
      for (let j = i; j < tree.subtreeEnd[i]; j++) if (tree.childCount[j] === 0) c++;
      if (c !== tree.leafEnd[i] - tree.leafStart[i]) bad++;
      sumTips += c;
      covered.fill(1, tree.leafStart[i], tree.leafEnd[i]);
    } else if (list.kind[e] === K_TIP) {
      tipsDrawn++;
      covered[tree.tipRank[i]] = 1;
    }
  }
  ok(bad === 0, `${name}: ${bad} summaries with a wrong tip count`);
  ok(sumTips === res.summaryTips, `${name}: summaryTips ${res.summaryTips} != brute force ${sumTips}`);
  // 2 accounting (fit view shows everything)
  const total = tipsDrawn + sumTips + res.mergedTips;
  if (name === 'fit') {
    ok(total === N, `fit: tips drawn ${tipsDrawn} + summarised ${sumTips} + merged ${res.mergedTips} = ${total} != ${N}`);
    ok(res.mergedTips <= 0.02 * N, `fit: merged tips ${res.mergedTips} above 2% of the tree`);
    console.log(`  tips drawn ${tipsDrawn} + in summaries ${sumTips} + merged ${res.mergedTips} = ${total} (tree ${N})`);
  }
  // 4 culling: ground truth by position
  const k = T.k;
  const inWin = (r) => {
    const nd = tree.tipNode[r];
    const x = T.cx + L.X[nd] * k * L.COS[nd],
      y = T.cy + L.X[nd] * k * L.SIN[nd];
    return x >= 0 && x <= W && y >= 0 && y <= H;
  };
  const visibleTips = [];
  for (let r = 0; r < N; r++) if (inWin(r)) visibleTips.push(r);
  let uncovered = 0;
  for (const r of visibleTips) if (!covered[r]) uncovered++;
  ok(uncovered <= res.mergedTips, `${name}: ${uncovered} visible tips are neither drawn nor summarised (merged ${res.mergedTips})`);
  const { res: r0 } = searchCut(false, tree, L, T, null, lo, seen2, { lod: false, base: 3, budget: 1e7, summaries: true, hint: 0 });
  const have = new Uint8Array(N);
  for (let e = 0; e < lo.count; e++) if (lo.kind[e] === K_TIP) have[tree.tipRank[lo.node[e]]] = 1;
  let missing = 0;
  for (const r of visibleTips) if (!have[r]) missing++;
  ok(missing === 0, `${name}: the cull dropped ${missing} of ${visibleTips.length} visible tips (LOD off)`);
  console.log(`  visible tips ${visibleTips.length}; LOD off would draw ${lo.count} (visited ${r0.visited}); cull misses ${missing}`);
  // 5 progressive detail
  if (prev && name.startsWith('16x')) {
    ok(minPx <= prev.minPx + 1e-9 && res.forced === 0, `${name}: threshold ${minPx} (fit ${prev.minPx}), forced ${res.forced}`);
  }
  if (name === 'fit') prev = { minPx, forced: res.forced };
  // 7 deep zoom visits little
  if (name.startsWith('16x')) ok(res.visited < 0.05 * tree.nodeCount, `${name}: visited ${res.visited} of ${tree.nodeCount} nodes`);
  // 6 hit-testing on summaries
  const hit = new HitIndex(tree, L);
  hit.build(list, T);
  let tried = 0,
    hitOk = 0;
  for (let e = 0; e < list.count && tried < 200; e++) {
    if (list.kind[e] !== K_SUMMARY) continue;
    const i = list.node[e];
    const r1 = L.XMAX[i] * k,
      r0n = L.X[i] * k,
      arc = (tree.leafEnd[i] - tree.leafStart[i]) * T.da * r1;
    if (arc < 1.5 || r1 - r0n < 4) continue;
    const a = ((tree.leafStart[i] + tree.leafEnd[i]) / 2) * T.da;
    const rr = r1 - 2;
    const x = T.cx + rr * Math.cos(a),
      y = T.cy + rr * Math.sin(a);
    if (x < 2 || y < 2 || x > W - 2 || y > H - 2) continue;
    tried++;
    const h = hit.query(x, y, T);
    if (h && h.kind === 'summary' && h.node === i) hitOk++;
  }
  console.log(`  hit-test: ${hitOk}/${tried} summary centres hit their own summary`);
  ok(tried === 0 || hitOk === tried, `${name}: hit-test ${hitOk}/${tried}`);
}

// budgets 500..20000 at fit: never above the budget
for (const b of [500, 1000, 2000, 5000, 20000]) {
  const T = makeTransform('radial', W, H, fitView, area, N);
  const { res } = searchCut(false, tree, L, T, null, list, seen, { lod: true, base: 3, budget: b, summaries: true, hint: 0 });
  console.log(`budget ${b}: drawn ${list.count}${res.overflow ? ' TRUNCATED' : ''}`);
  ok(!res.overflow && list.count <= b, `budget ${b}: drawn ${list.count}`);
}
// 8 pan stability: the dedupe cells must not depend on the sub-pixel position of the tree. Run on the synthetic tree and on the
// committed real OTL 91k tree (the Yule tree alone did not expose the bug).
function panCheck(label, tr, Lr, Nr) {
  const summarySet = (l) => {
    const set = new Set();
    for (let e = 0; e < l.count; e++) if (l.kind[e] === K_SUMMARY) set.add(l.node[e]);
    return set;
  };
  const rectView = (dx, dy) => {
    const x0 = -0.03,
      x1 = 1.03,
      y0 = -1,
      y1 = Nr + 1;
    const kx = W / (x1 - x0),
      ky = H / (y1 - y0);
    return { x0: x0 + dx / kx, x1: x1 + dx / kx, y0: y0 + dy / ky, y1: y1 + dy / ky };
  };
  const radialView = (dx, dy) => ({ x0: fitView.x0 + dx / kfit, x1: fitView.x1 + dx / kfit, y0: fitView.y0 + dy / kfit, y1: fitView.y1 + dy / kfit });
  for (const [kind, rect, mk] of [
    ['radial', false, radialView],
    ['rectangular', true, rectView],
  ]) {
    for (const b of [500, 2000]) {
      let ref = null,
        worst = 0;
      for (const [dx, dy] of [
        [0, 0],
        [0.1, 0],
        [0.37, 0.61],
        [0.5, 0.5],
        [0.9, 0.2],
        [1.5, 0.3],
        [4.25, 2.75],
        [9.3, 0],
      ]) {
        const T = makeTransform(kind, W, H, mk(dx, dy), area, Nr);
        searchCut(rect, tr, Lr, T, null, list, seen, { lod: true, base: 3, budget: b, summaries: true, hint: 0 });
        const cur = summarySet(list);
        if (!ref) {
          ref = cur;
          continue;
        }
        let d = 0;
        for (const x of cur) if (!ref.has(x)) d++;
        for (const x of ref) if (!cur.has(x)) d++;
        worst = Math.max(worst, d);
      }
      console.log(`pan stability ${label} ${kind}, budget ${b}: ${ref.size} summaries, worst difference over sub-pixel pans ${worst}`);
      ok(worst === 0, `pan stability ${label} ${kind}, budget ${b}: the set of collapsed clades changed by up to ${worst} under a sub-pixel pan`);
    }
  }
}
panCheck('synthetic', tree, L, N);
const otlFile = path.join(root, 'data/real-ladder/trees/otl-100k-vertebrata.nwk.gz');
if (fs.existsSync(otlFile)) {
  const otl = parseNewick(execFileSync('gzip', ['-dc', otlFile], { maxBuffer: 1 << 28 }).toString('utf8'));
  const Lo = computeLayout(otl, true);
  ensureTrig(Lo);
  panCheck('OTL 91k', otl, Lo, otl.tipCount);
}
// 9 a star of 10,000 tips next to two balanced 1,000-tip clades
{
  const bal = (n, p) => (n === 1 ? `${p}:1` : `(${bal(n >> 1, p + 'l')},${bal(n - (n >> 1), p + 'r')}):1`);
  const STAR = 10000;
  const star = Array.from({ length: STAR }, (_, j) => `s${j}:1`).join(',');
  const st = parseNewick(`(${bal(1000, 'a')},${bal(1000, 'b')},(${star}):10);`);
  const Ls = computeLayout(st, true);
  ensureTrig(Ls);
  const Ns = st.tipCount;
  const starNode = (() => {
    for (let i = 0; i < st.nodeCount; i++) if (st.childCount[i] === STAR) return i;
    return -1;
  })();
  ok(starNode >= 0 && isSlice(st, starNode), 'star: the polytomy node is not recognised as a slice');
  const mid = st.tipNode[st.leafStart[starNode] + STAR / 2];
  const rr = Ls.X[mid],
    aa = Ls.ROW[mid] * ((2 * Math.PI) / Ns);
  for (const b of [500, 2000]) {
    for (const z of [3, 8, 20]) {
      const vp = zoomView(z, rr * Math.cos(aa), rr * Math.sin(aa));
      const T = makeTransform('radial', W, H, vp, area, Ns);
      const { res, minPx } = searchCut(false, st, Ls, T, null, list, seen, { lod: true, base: 3, budget: b, summaries: true, hint: 0 });
      let kids = 0,
        sliceDrawn = 0,
        other = 0;
      for (let e = 0; e < list.count; e++) {
        const i = list.node[e];
        if (st.parent[i] === starNode) kids++;
        else if (i === starNode && list.kind[e] === K_SUMMARY) sliceDrawn++;
        else other++;
      }
      const dense = ((2 * Math.PI) / Ns) * Ls.XMAX[mid] * T.k < 3; // children closer than the 3 px base threshold
      console.log(
        `star ${STAR}, budget ${b}, zoom ${z}x: tip pitch ${(((2 * Math.PI) / Ns) * Ls.XMAX[mid] * T.k).toFixed(2)} px, children drawn ${kids}, slice ${sliceDrawn}, other primitives ${other}, minPx ${minPx.toFixed(2)}, forced ${res.forced}`,
      );
      if (dense) {
        ok(kids === 0, `star ${b} ${z}x: ${kids} children of the polytomy drawn individually`);
        ok(
          res.forced === 0 && minPx <= 3 + 1e-9,
          `star ${b} ${z}x: the threshold was raised to ${minPx.toFixed(2)} (forced ${res.forced}) because of the polytomy`,
        );
        ok(sliceDrawn === 1, `star ${b} ${z}x: the polytomy was not drawn as one slice (${sliceDrawn})`);
        const hit = new HitIndex(st, Ls);
        hit.build(list, T);
        const rc = Ls.XMAX[starNode] * T.k - 3; // just inside the outer edge, which is at the centre of the view
        const x = T.cx + rc * Math.cos(aa),
          y = T.cy + rc * Math.sin(aa);
        const h = hit.query(x, y, T);
        ok(h && h.kind === 'summary' && h.node === starNode, `star ${b} ${z}x: click inside the slice returned ${JSON.stringify(h)}`);
      }
    }
  }
}
// 10 a mixed polytomy next to two balanced clades: 1,000 tips, 6,900 pairs and 100 clades of 60 tips, the large ones spread through the order
{
  const bal = (n, p) => (n === 1 ? `${p}:1` : `(${bal(n >> 1, p + 'l')},${bal(n - (n >> 1), p + 'r')}):1`);
  let rng = 12345;
  const rnd = () => {
    rng = (Math.imul(rng, 1103515245) + 12345) >>> 0;
    return rng / 4294967296;
  };
  const small = [];
  for (let j = 0; j < 1000; j++) small.push(`t${j}:1`);
  for (let j = 0; j < 6900; j++) small.push(`(p${j}a:1,p${j}b:1):1`);
  for (let j = small.length - 1; j > 0; j--) {
    const q = Math.floor(rnd() * (j + 1));
    [small[j], small[q]] = [small[q], small[j]];
  }
  const kids = [];
  for (let b = 0; b < 100; b++) {
    for (let j = 0; j < 79; j++) kids.push(small[b * 79 + j]);
    kids.push(bal(60, `L${b}_`));
  }
  const poly = parseNewick(`(${bal(1000, 'a')},${bal(1000, 'b')},(${kids.join(',')}):10);`);
  const Lp = computeLayout(poly, true);
  ensureTrig(Lp);
  const Np = poly.tipCount;
  const P = (() => {
    for (let i = 0; i < poly.nodeCount; i++) if (poly.childCount[i] === kids.length) return i;
    return -1;
  })();
  ok(P >= 0 && kids.length === 8000 && Np === 22800, `polytomy: unexpected shape (node ${P}, ${kids.length} children, ${Np} tips)`);
  const large = [];
  for (let c = poly.firstChild[P]; c < poly.subtreeEnd[P]; c = poly.subtreeEnd[c]) if (poly.leafEnd[c] - poly.leafStart[c] === 60) large.push(c);
  ok(large.length === 100, `polytomy: ${large.length} large children`);
  const midTip = poly.tipNode[(poly.leafStart[P] + poly.leafEnd[P]) >> 1];
  const rows = (c) => (Lp.ROW[poly.firstChild[c]] + Lp.ROW[Lp.LAST[c]]) / 2; // not used for placement, only a stable centre row
  void rows;
  const checkCut = (label, rect, T, b, vis) => {
    const { res, minPx } = searchCut(rect, poly, Lp, T, null, list, seen, { lod: true, base: 3, budget: b, summaries: true, hint: 0 });
    let runs = 0,
      direct = 0,
      tipsDrawn = 0,
      runTips = 0,
      sumTips = 0,
      over = 0;
    const cov = new Uint8Array(Np);
    const cover = (a, z) => {
      for (let r = a; r < z; r++) if (cov[r]++) over++;
    };
    for (let e = 0; e < list.count; e++) {
      const i = list.node[e],
        lm = list.last[e];
      if (poly.parent[i] === P) direct++;
      if (list.kind[e] === K_TIP) {
        tipsDrawn++;
        cover(poly.tipRank[i], poly.tipRank[i] + 1);
      } else if (list.kind[e] === K_SUMMARY) {
        const z = lm >= 0 ? poly.leafEnd[lm] : poly.leafEnd[i];
        if (lm >= 0) {
          runs++;
          runTips += z - poly.leafStart[i];
          ok(poly.parent[lm] === P && lm >= i && lm < poly.subtreeEnd[P], `${label}: run ${i}..${lm} is not a set of children of the polytomy`);
        } else sumTips += z - poly.leafStart[i];
        cover(poly.leafStart[i], z);
      }
    }
    let visLarge = 0,
      ownEntry = 0;
    for (const c of large) {
      if (!vis(c)) continue;
      visLarge++;
      let has = false;
      for (let e = 0; e < list.count && !has; e++) if (list.node[e] === c) has = true;
      if (has) ownEntry++;
    }
    console.log(
      `${label}, budget ${b}: drawn ${list.count}, polytomy entries ${direct} (runs ${runs} of ${runTips} tips), large children in view ${visLarge} (own entry ${ownEntry}), minPx ${minPx.toFixed(2)}, forced ${res.forced}`,
    );
    ok(!res.overflow && list.count <= b, `${label} ${b}: drawn ${list.count} over the budget`);
    ok(over === 0, `${label} ${b}: ${over} tips are covered by more than one entry`);
    ok(sumTips + runTips === res.summaryTips, `${label} ${b}: summaryTips ${res.summaryTips} != ${sumTips + runTips}`);
    ok(tipsDrawn === res.tips, `${label} ${b}: tips ${res.tips} != ${tipsDrawn}`);
    return { res, minPx, direct, runs, visLarge, ownEntry, tipsDrawn, runTips, sumTips };
  };
  // fit view: everything is in view, the tips must add up
  for (const [kind, rect] of [
    ['radial', false],
    ['rectangular', true],
  ]) {
    for (const b of [500, 2000]) {
      const vp = rect ? { x0: -0.03, x1: 1.03, y0: -1, y1: Np + 1 } : fitView;
      const T = makeTransform(kind, W, H, vp, area, Np);
      const r = checkCut(`polytomy ${kind} fit`, rect, T, b, () => true);
      const total = r.tipsDrawn + r.res.summaryTips + r.res.mergedTips;
      ok(
        total === Np,
        `polytomy ${kind} fit ${b}: tips drawn ${r.tipsDrawn} + summarised ${r.res.summaryTips} + merged ${r.res.mergedTips} = ${total} != ${Np}`,
      );
    }
  }
  // zoomed on the polytomy
  const aa = Lp.ROW[midTip] * ((2 * Math.PI) / Np),
    rr = Lp.X[midTip];
  const midRow = Lp.ROW[midTip];
  for (const [kind, rect] of [
    ['radial', false],
    ['rectangular', true],
  ]) {
    for (const b of [500, 2000]) {
      for (const z of rect ? [8, 20, 60] : [4, 8, 16]) {
        let vp;
        if (rect) {
          const h = (Np + 2) / z;
          vp = { x0: -0.03, x1: 1.03, y0: midRow - h / 2, y1: midRow + h / 2 };
        } else vp = zoomView(z, rr * Math.cos(aa), rr * Math.sin(aa));
        const T = makeTransform(kind, W, H, vp, area, Np);
        const pitch = rect ? T.ky : ((2 * Math.PI) / Np) * Lp.XMAX[midTip] * T.k;
        const vis = rect
          ? (c) => {
              const y = T.oy + ((poly.leafStart[c] + poly.leafEnd[c]) / 2) * T.ky;
              return y > 0 && y < H;
            }
          : (c) => {
              const nd = poly.tipNode[(poly.leafStart[c] + poly.leafEnd[c]) >> 1];
              const x = T.cx + Lp.X[nd] * T.k * Lp.COS[nd],
                y = T.cy + Lp.X[nd] * T.k * Lp.SIN[nd];
              return x > 0 && x < W && y > 0 && y < H;
            };
        const r = checkCut(`polytomy ${kind} ${z}x (tip pitch ${pitch.toFixed(2)} px)`, rect, T, b, vis);
        if (2 * pitch < 3 && r.visLarge > 0) {
          ok(
            r.ownEntry === r.visLarge,
            `polytomy ${kind} ${b} ${z}x: ${r.visLarge - r.ownEntry} of ${r.visLarge} large children in view lost their own entry`,
          );
          ok(r.direct < 3 * r.visLarge + 300, `polytomy ${kind} ${b} ${z}x: ${r.direct} polytomy entries for ${r.visLarge} large children`);
          ok(
            r.res.forced === 0 && r.minPx <= 3 + 1e-9,
            `polytomy ${kind} ${b} ${z}x: threshold raised to ${r.minPx.toFixed(2)} (forced ${r.res.forced}) because of the polytomy`,
          );
          ok(r.runs > 0, `polytomy ${kind} ${b} ${z}x: no run was formed`);
          // a click inside a run reports exactly the run
          const hit = new HitIndex(poly, Lp);
          hit.build(list, T);
          let tried = 0,
            good = 0;
          for (let e = 0; e < list.count && tried < 40; e++) {
            const i = list.node[e],
              lm = list.last[e];
            if (lm < 0) continue;
            let x, y;
            if (rect) {
              const x1 = T.ox + list.xmax[e] * T.kx,
                x0 = T.ox + Lp.X[P] * T.kx;
              x = x1 - 3;
              y = T.oy + ((poly.leafStart[i] + poly.leafEnd[lm]) / 2) * T.ky;
              if (x1 - x0 < 8 || (poly.leafEnd[lm] - poly.leafStart[i]) * T.ky < 6) continue;
            } else {
              const a = ((poly.leafStart[i] + poly.leafEnd[lm]) / 2) * T.da,
                r1 = list.xmax[e] * T.k,
                r0 = Lp.X[P] * T.k;
              if (r1 - r0 < 8 || (poly.leafEnd[lm] - poly.leafStart[i]) * T.da * r1 < 6) continue;
              x = T.cx + (r1 - 3) * Math.cos(a);
              y = T.cy + (r1 - 3) * Math.sin(a);
            }
            if (x < 2 || y < 2 || x > W - 2 || y > H - 2) continue;
            tried++;
            const h = hit.query(x, y, T);
            if (h && h.kind === 'summary' && h.node === P && h.run && h.run.first === i && h.run.last === lm) good++;
          }
          console.log(`  hit-test: ${good}/${tried} run centres hit their own run (parent ${P}, tip range of the run only)`);
          ok(tried > 0 && good === tried, `polytomy ${kind} ${b} ${z}x: hit-test on runs ${good}/${tried}`);
        }
      }
    }
  }
  panCheck('polytomy', poly, Lp, Np);
  void SLICE_MIN_CHILDREN;
}
// 11 zoom churn: the entries of the draw list that appear or disappear per 2% zoom step
if (fs.existsSync(otlFile)) {
  const otl2 = parseNewick(execFileSync('gzip', ['-dc', otlFile], { maxBuffer: 1 << 28 }).toString('utf8'));
  const Lz = computeLayout(otl2, true);
  ensureTrig(Lz);
  const Nz = otl2.tipCount;
  for (const b of [500, 2000]) {
    let changed = 0,
      size = 0,
      steps = 0;
    for (const [r, deg] of [
      [0.75, 200],
      [0.9, 20],
      [0.6, 120],
      [0.85, 300],
    ]) {
      const a = (deg * Math.PI) / 180,
        px = r * Math.cos(a),
        py = r * Math.sin(a);
      let prev = null,
        hint = 0;
      for (let z = 2; z <= 30; z *= 1.02) {
        const w = W / kfit / z,
          h = H / kfit / z;
        const T = makeTransform('radial', W, H, { x0: px - w / 2, x1: px + w / 2, y0: py - h / 2, y1: py + h / 2 }, area, Nz);
        const { minPx } = searchCut(false, otl2, Lz, T, null, list, seen, { lod: true, base: 3, budget: b, summaries: true, hint });
        hint = minPx;
        const cur = new Set();
        for (let e = 0; e < list.count; e++) cur.add(list.node[e] * 8 + list.kind[e]);
        if (prev) {
          let d = 0;
          for (const x of cur) if (!prev.has(x)) d++;
          for (const x of prev) if (!cur.has(x)) d++;
          changed += d;
          size += cur.size;
          steps++;
        }
        prev = cur;
      }
    }
    const frac = changed / size;
    console.log(
      `zoom churn OTL 91k radial, budget ${b}: ${(100 * frac).toFixed(1)}% of the entries change per 2% zoom step (${(changed / steps).toFixed(1)} of ${(size / steps).toFixed(0)})`,
    );
    ok(frac <= 0.08, `zoom churn OTL 91k radial, budget ${b}: ${(100 * frac).toFixed(1)}% of the entries change per 2% zoom step (limit 8%)`);
  }
}
// 12 threshold stability along a zoom path
if (fs.existsSync(otlFile)) {
  const otl3 = parseNewick(execFileSync('gzip', ['-dc', otlFile], { maxBuffer: 1 << 28 }).toString('utf8'));
  const L3 = computeLayout(otl3, true);
  ensureTrig(L3);
  const N3 = otl3.tipCount;
  for (const b of [500, 2000]) {
    const a = (200 * Math.PI) / 180,
      px = 0.75 * Math.cos(a),
      py = 0.75 * Math.sin(a);
    let hint = 0,
      prevM = 0,
      rises = 0,
      steps = 0,
      maxM = 0;
    for (let z = 1.5; z <= 40; z *= 1.03) {
      const w = W / kfit / z,
        h = H / kfit / z;
      const T = makeTransform('radial', W, H, { x0: px - w / 2, x1: px + w / 2, y0: py - h / 2, y1: py + h / 2 }, area, N3);
      const { minPx } = searchCut(false, otl3, L3, T, null, list, seen, { lod: true, base: 3, budget: b, summaries: true, hint });
      hint = minPx;
      if (prevM && minPx > prevM * 1.001) rises++;
      prevM = minPx;
      maxM = Math.max(maxM, minPx);
      steps++;
    }
    console.log(`threshold along a zoom path, OTL 91k radial, budget ${b}: ${steps} steps, rises ${rises}, max ${maxM.toFixed(2)} px`);
    ok(rises <= 1, `threshold along a zoom path, OTL 91k radial, budget ${b}: the threshold rose ${rises} times while zooming in (limit 1)`);
  }
}
console.log(failures ? `FAILED (${failures})` : 'OK');
process.exit(failures ? 1 : 0);
