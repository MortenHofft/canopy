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
const { DrawList, Seen, searchCut, K_TIP, K_SUMMARY } = await import(path.join(root, 'spikes/custom/src/core/lod.ts'));
const { HitIndex } = await import(path.join(root, 'spikes/custom/src/core/hit.ts'));

// ---- the tree: committed 10k file when TIPS is 10000, otherwise generated with the repo's generator
function loadNewick() {
  const committed = path.join(root, 'data/synthetic/newick/yule_10000.nwk.gz');
  if (TIPS === 10000 && fs.existsSync(committed)) return execFileSync('gzip', ['-dc', committed], { maxBuffer: 1 << 28 }).toString('utf8');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'radial-cut-'));
  execFileSync('python3', ['-I', path.join(root, 'data/synthetic/generate.py'), '--out', tmp, '--sizes', String(TIPS), '--shapes', 'yule'], { stdio: 'ignore' });
  return fs.readFileSync(path.join(tmp, 'newick', `yule_${TIPS}.nwk`), 'utf8');
}
const tree = parseNewick(loadNewick());
const L = computeLayout(tree, true);
ensureTrig(L);
const N = tree.tipCount;
console.log(`tree: ${N} tips, ${tree.nodeCount} nodes; budget ${BUDGET}`);

// ---- the viewport, as the renderer's fit and zoom
const W = 1100, H = 640;
const area = { ax: 0, ay: 0, aw: W, ah: H, clipL: 0, clipT: 0, clipR: W, clipB: H };
const kfit = Math.max(20, Math.min(W, H) / 2 - 28);
const fitView = { x0: -W / 2 / kfit, x1: W / 2 / kfit, y0: -H / 2 / kfit, y1: H / 2 / kfit };
const zoomView = (z, cx, cy) => { const w = (fitView.x1 - fitView.x0) / z, h = (fitView.y1 - fitView.y0) / z; return { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 }; };
const views = [
  ['fit', fitView],
  ['4x at (0.75, 0)', zoomView(4, 0.75, 0)],
  ['4x at 200 deg, r 0.8', zoomView(4, 0.8 * Math.cos((200 * Math.PI) / 180), 0.8 * Math.sin((200 * Math.PI) / 180))],
  ['16x at (0.9, 0.1)', zoomView(16, 0.9, 0.1)],
];

let failures = 0;
const fail = (m) => { failures++; console.log('  FAIL ' + m); };
const ok = (c, m) => { if (!c) fail(m); };

const list = new DrawList(), seen = new Seen();
const lo = new DrawList(), seen2 = new Seen();
let prev = null;
for (const [name, vp] of views) {
  const T = makeTransform('radial', W, H, vp, area, N);
  const { res, minPx, retries } = searchCut(false, tree, L, T, null, list, seen, { lod: true, base: 3, budget: BUDGET, summaries: true, hint: 0 });
  console.log(`${name}: drawn ${list.count} (tips ${res.tips}, summaries ${res.summaries}, forced ${res.forced}), minPx ${minPx.toFixed(2)}, passes ${retries + 1}, visited ${res.visited}, merged tips ${res.mergedTips}`);
  // 1 budget
  ok(!res.overflow, `${name}: list overflowed the budget (truncated)`);
  ok(list.count <= BUDGET, `${name}: drawn ${list.count} > budget ${BUDGET}`);
  if (res.forced > 0) ok(list.count >= 0.75 * BUDGET, `${name}: the cut is active but drew only ${list.count} of ${BUDGET} (tolerance 25% below the budget: clades of equal size collapse together, so the count moves in steps)`);
  // 3 summary tip counts (brute force over the subtree range)
  let sumTips = 0, tipsDrawn = 0, bad = 0;
  const covered = new Uint8Array(N);
  for (let e = 0; e < list.count; e++) {
    const i = list.node[e];
    if (list.kind[e] === K_SUMMARY) {
      let c = 0;
      for (let j = i; j < tree.subtreeEnd[i]; j++) if (tree.childCount[j] === 0) c++;
      if (c !== tree.leafEnd[i] - tree.leafStart[i]) bad++;
      sumTips += c;
      covered.fill(1, tree.leafStart[i], tree.leafEnd[i]);
    } else if (list.kind[e] === K_TIP) { tipsDrawn++; covered[tree.tipRank[i]] = 1; }
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
  const inWin = (r) => { const nd = tree.tipNode[r]; const x = T.cx + L.X[nd] * k * L.COS[nd], y = T.cy + L.X[nd] * k * L.SIN[nd]; return x >= 0 && x <= W && y >= 0 && y <= H; };
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
  let tried = 0, hitOk = 0;
  for (let e = 0; e < list.count && tried < 200; e++) {
    if (list.kind[e] !== K_SUMMARY) continue;
    const i = list.node[e];
    const r1 = L.XMAX[i] * k, r0n = L.X[i] * k, arc = (tree.leafEnd[i] - tree.leafStart[i]) * T.da * r1;
    if (arc < 1.5 || r1 - r0n < 4) continue;
    const a = ((tree.leafStart[i] + tree.leafEnd[i]) / 2) * T.da;
    const rr = r1 - 2;
    const x = T.cx + rr * Math.cos(a), y = T.cy + rr * Math.sin(a);
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
  const summarySet = (l) => { const set = new Set(); for (let e = 0; e < l.count; e++) if (l.kind[e] === K_SUMMARY) set.add(l.node[e]); return set; };
  const rectView = (dx, dy) => { const x0 = -0.03, x1 = 1.03, y0 = -1, y1 = Nr + 1; const kx = W / (x1 - x0), ky = H / (y1 - y0); return { x0: x0 + dx / kx, x1: x1 + dx / kx, y0: y0 + dy / ky, y1: y1 + dy / ky }; };
  const radialView = (dx, dy) => ({ x0: fitView.x0 + dx / kfit, x1: fitView.x1 + dx / kfit, y0: fitView.y0 + dy / kfit, y1: fitView.y1 + dy / kfit });
  for (const [kind, rect, mk] of [['radial', false, radialView], ['rectangular', true, rectView]]) {
    for (const b of [500, 2000]) {
      let ref = null, worst = 0;
      for (const [dx, dy] of [[0, 0], [0.1, 0], [0.37, 0.61], [0.5, 0.5], [0.9, 0.2], [1.5, 0.3], [4.25, 2.75], [9.3, 0]]) {
        const T = makeTransform(kind, W, H, mk(dx, dy), area, Nr);
        searchCut(rect, tr, Lr, T, null, list, seen, { lod: true, base: 3, budget: b, summaries: true, hint: 0 });
        const cur = summarySet(list);
        if (!ref) { ref = cur; continue; }
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
console.log(failures ? `FAILED (${failures})` : 'OK');
process.exit(failures ? 1 : 0);
