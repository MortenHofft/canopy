// Check and measurement of the static level of detail (src/core/static-lod.ts) against the current cut (lod.ts). Plain Node, no browser:
//   node --experimental-transform-types spikes/custom/scripts/check-static-lod.mjs [--big] [--quick] [--ladder 1.1892] [--only <part of a tree name>]
// Radial layout only (the static cuts do not implement rectangular; the renderer falls back to the current cut there).
// Trees: the committed OTL 91k vertebrata tree, the mixed polytomy (22,800 tips), a star of 10,000 tips, the committed 10,000-tip
// caterpillar and, with --big, the 2.39M-tip OTL tree (read from the main checkout's data/real-ladder/fetched, git-ignored).
// For each of current, static-global and static-tiles it measures
//   a  pan invariance: a tip covered in two views at the same zoom (any pan) is covered by the same entry in both
//   b  zoom monotonicity: along a 3% zoom-in path a tip covered in two consecutive frames is covered by an entry that is the same or
//      SMALLER (a split) in the later one, never a bigger clade (a merge, or an expanded clade collapsed again)
//   c  churn: fraction of entries changing per 2% zoom step, and how often the detail level changes along the path
//   d  budget: never above it, mean share used, effective smallest clade (px), over many views at budgets 500, 2000 and 20000
//   e  tip accounting (every visible tip covered, no tip covered twice) and hit-testing of summaries and runs
//   f  polytomies: star and mixed polytomy: bounded primitives, large children keep their entries, no budget stolen by the polytomy
// Tips are sampled (every k-th rank) on the big tree; coverage is looked up in the entries sorted by tip range, so a view costs
// O(entries), not O(tips). Exit code 1 when a guarantee that the static cuts claim fails (printed as FAIL); the figures of the current
// cut and of the tiles' budget are informative (the tiles are not budget-safe, see docs/results/static-lod-spike.md).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const mainCheckout = '/home/user/gbif-phylo';
const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const BIG = flag('big');
const QUICK = flag('quick');
const LADDER = Number(opt('ladder', '1.1892'));
const ONLY = opt('only', '');

const { parseNewick } = await import(path.join(root, 'spikes/shared/newick.ts'));
const { computeLayout, ensureTrig } = await import(path.join(root, 'spikes/custom/src/core/layout.ts'));
const { makeTransform } = await import(path.join(root, 'spikes/custom/src/core/geom.ts'));
const { DrawList, Seen, searchCut, K_NODE, K_TIP, K_SUMMARY } = await import(path.join(root, 'spikes/custom/src/core/lod.ts'));
const { StaticLod } = await import(path.join(root, 'spikes/custom/src/core/static-lod.ts'));
const { HitIndex } = await import(path.join(root, 'spikes/custom/src/core/hit.ts'));

let failures = 0;
const fail = (m) => { failures++; console.log('  FAIL ' + m); };
const ok = (c, m) => { if (!c) fail(m); };
const pct = (x) => (100 * x).toFixed(1) + '%';

// ---- trees
const gz = (f) => execFileSync('gzip', ['-dc', f], { maxBuffer: 1 << 30 }).toString('utf8');
const bal = (n, p) => (n === 1 ? `${p}:1` : `(${bal(n >> 1, p + 'l')},${bal(n - (n >> 1), p + 'r')}):1`);
function mixedPolytomy() {
  let rng = 12345;
  const rnd = () => { rng = (Math.imul(rng, 1103515245) + 12345) >>> 0; return rng / 4294967296; };
  const small = [];
  for (let j = 0; j < 1000; j++) small.push(`t${j}:1`);
  for (let j = 0; j < 6900; j++) small.push(`(p${j}a:1,p${j}b:1):1`);
  for (let j = small.length - 1; j > 0; j--) { const q = Math.floor(rnd() * (j + 1)); [small[j], small[q]] = [small[q], small[j]]; }
  const kids = [];
  for (let b = 0; b < 100; b++) { for (let j = 0; j < 79; j++) kids.push(small[b * 79 + j]); kids.push(bal(60, `L${b}_`)); }
  return `(${bal(1000, 'a')},${bal(1000, 'b')},(${kids.join(',')}):10);`;
}
const trees = [];
const addTree = (name, nwk) => {
  const tr = parseNewick(nwk);
  const L = computeLayout(tr, true);
  ensureTrig(L);
  trees.push({ name, tr, L, N: tr.tipCount, S: null });
};
const otlFile = path.join(root, 'data/real-ladder/trees/otl-100k-vertebrata.nwk.gz');
if (fs.existsSync(otlFile) && (!ONLY || 'otl-100k'.includes(ONLY))) addTree('otl-100k', gz(otlFile));
const polyFile = path.join(root, 'data/synthetic/newick/polytomy_mixed_22800.nwk.gz');
if (!ONLY || 'syn-polytomy-mixed-22800'.includes(ONLY)) addTree('syn-polytomy-mixed-22800', fs.existsSync(polyFile) ? gz(polyFile) : mixedPolytomy());
if (!ONLY || 'star-10000'.includes(ONLY)) addTree('star-10000', `(${bal(1000, 'a')},${bal(1000, 'b')},(${Array.from({ length: 10000 }, (_, j) => `s${j}:1`).join(',')}):10);`);
const catFile = path.join(root, 'data/synthetic/newick/caterpillar_10000.nwk.gz');
if (fs.existsSync(catFile) && (!ONLY || 'caterpillar-10000'.includes(ONLY))) addTree('caterpillar-10000', gz(catFile));
const bigFile = path.join(mainCheckout, 'data/real-ladder/fetched/otl-2m-full.nwk.gz');
if (BIG && fs.existsSync(bigFile) && (!ONLY || 'otl-2m'.includes(ONLY))) addTree('otl-2m', gz(bigFile));
else if (BIG) console.log('(otl-2m-full not found or filtered out, skipped)');

// ---- viewport machinery, as the renderer's fit and zoom
const W = 1100, H = 640;
const area = { ax: 0, ay: 0, aw: W, ah: H, clipL: 0, clipT: 0, clipR: W, clipB: H };
const kfit = Math.max(20, Math.min(W, H) / 2 - 28);
const zoomView = (z, cx, cy) => { const w = W / kfit / z, h = H / kfit / z; return { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 }; };
let seed = 987654321;
const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
const anchorOf = (L, tree, node) => { const a = L.ROW[node] * ((2 * Math.PI) / tree.tipCount); return [L.X[node] * Math.cos(a), L.X[node] * Math.sin(a)]; };
/** a random point of the tree: the anchor of a random tip (so that views have content) */
const randPoint = (t) => anchorOf(t.L, t.tr, t.tr.tipNode[Math.floor(rnd() * t.N)]);

// ---- the three cuts behind one function
const methods = ['current', 'static-global', 'static-tiles'];
const list = new DrawList(), seen = new Seen();
function makeCutter(t) {
  t.S = t.S ?? new StaticLod(t.tr, t.L);
  return (method, T, budget, hint = 0) => {
    if (method === 'current') {
      const r = searchCut(false, t.tr, t.L, T, null, list, seen, { lod: true, base: 3, budget, summaries: true, hint });
      return { overflow: r.res.overflow, forced: r.res.forced, minPx: r.minPx, minPxFine: r.minPx, level: 0, levelMax: 0, zoomIndex: 0, mergedTips: r.res.mergedTips };
    }
    return { ...t.S.cut(T, { method, ladder: LADDER, base: 3, budget, summaries: true }, null, list), mergedTips: 0 };
  };
}

/** The tips covered by the draw list, as entries sorted by first tip rank (K_NODE entries cover nothing): lookup of the entry covering
 *  a rank by bisection. `doubles` counts entries that overlap their predecessor (a tip covered twice). */
function cover(tree) {
  const idx = [];
  const st = [], en = [];
  for (let e = 0; e < list.count; e++) {
    const kd = list.kind[e];
    if (kd === K_NODE) continue;
    const i = list.node[e], lm = list.last[e];
    const a = kd === K_TIP ? tree.tipRank[i] : tree.leafStart[i];
    st.push(a); en.push(kd === K_TIP ? a + 1 : lm >= 0 ? tree.leafEnd[lm] : tree.leafEnd[i]); idx.push(e);
  }
  const order = idx.map((_, k) => k).sort((p, q) => st[p] - st[q]);
  const c = { n: order.length, st: new Int32Array(order.length), en: new Int32Array(order.length), nd: new Int32Array(order.length), lm: new Int32Array(order.length), kd: new Uint8Array(order.length), doubles: 0 };
  order.forEach((k, j) => { c.st[j] = st[k]; c.en[j] = en[k]; c.nd[j] = list.node[idx[k]]; c.lm[j] = list.last[idx[k]]; c.kd[j] = list.kind[idx[k]]; if (j > 0 && c.st[j] < c.en[j - 1]) c.doubles++; });
  return c;
}
/** index of the entry covering tip rank r, or -1 */
function find(c, r) {
  let lo = 0, hi = c.n - 1, at = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (c.st[m] <= r) { at = m; lo = m + 1; } else hi = m - 1; }
  return at >= 0 && r < c.en[at] ? at : -1;
}
const snapshotEntries = () => { const s = new Set(); for (let e = 0; e < list.count; e++) s.add(list.node[e] * 8 + list.kind[e] + (list.last[e] >= 0 ? 4 : 0) + list.last[e] * 1e9); return s; };
const sampleRanks = (N) => { const step = Math.max(1, Math.floor(N / 60000)); const a = []; for (let r = 0; r < N; r += step) a.push(r); return a; };

for (const t of trees) {
  const cutter = makeCutter(t);
  const { tr, L, N } = t;
  const big = N > 500000;
  const ranks = sampleRanks(N);
  console.log(`\n=== ${t.name}: ${N} tips, ${tr.nodeCount} nodes (ladder ${LADDER})`);
  t.S = new StaticLod(tr, L);
  console.log(`static tables: critical zoom pass ${t.S.buildMs.toFixed(1)} ms, ${(t.S.crit.byteLength / 1e6).toFixed(1)} MB (4 bytes per node), ${t.S.fixups} nodes raised to their parent's critical zoom`);
  const zoomsPan = QUICK || big ? [1, 8] : [1, 4, 16, 64];

  // ------------------------------------------------------------------ a pan invariance
  for (const budget of [500, 2000]) {
    const row = {};
    for (const method of methods) {
      let compared = 0, mism = 0;
      for (const z of zoomsPan) {
        const reps = z === 1 ? 4 : big ? 6 : QUICK ? 8 : 24;
        for (let rep = 0; rep < reps; rep++) {
          const [px, py] = z === 1 ? [0, 0] : randPoint(t);
          const winW = W / kfit / z, winH = H / kfit / z;
          // second view: any pan, up to 0.8 of a window away (the views overlap), arbitrary (not whole-pixel) offsets
          const dx = (rnd() - 0.5) * 1.6 * winW, dy = (rnd() - 0.5) * 1.6 * winH;
          cutter(method, makeTransform('radial', W, H, zoomView(z, px, py), area, N), budget);
          const c1 = cover(tr);
          cutter(method, makeTransform('radial', W, H, zoomView(z, px + dx, py + dy), area, N), budget);
          const c2 = cover(tr);
          for (const r of ranks) {
            const a = find(c1, r), b = find(c2, r);
            if (a < 0 || b < 0) continue;
            compared++;
            if (c1.nd[a] !== c2.nd[b] || c1.lm[a] !== c2.lm[b] || c1.kd[a] !== c2.kd[b]) mism++;
          }
        }
      }
      row[method] = { compared, mism };
      if (method !== 'current') ok(mism === 0, `a pan ${t.name} ${method} budget ${budget}: ${mism} of ${compared} tips covered by a different entry after a pan`);
    }
    console.log(`a pan invariance, budget ${budget}: sampled tips covered in both views by a different entry: ` + methods.map((m) => `${m} ${row[m].mism}/${row[m].compared} (${pct(row[m].mism / Math.max(1, row[m].compared))})`).join(' | '));
  }

  // ------------------------------------------------------------------ b zoom monotonicity and c churn along zoom-in paths
  // b: 3% steps (about a wheel notch); c: 2% steps (the figure the current cut is judged by: about 5% natural, 13% before the dedupe fix)
  const paths = QUICK || big ? 2 : 5;
  for (const budget of [500, 2000]) {
    const row = {};
    for (const method of methods) {
      const R = { compared: 0, merged: 0, changed: 0, size: 0, steps: 0, worst: 0, lc: 0, changed2: 0, size2: 0, steps2: 0, worst2: 0, lc2: 0 };
      for (const [factor, two] of [[1.03, false], [1.02, true]]) {
        seed = 4242;
        for (let pth = 0; pth < paths; pth++) {
          const [px, py] = pth === 0 ? anchorOf(L, tr, tr.tipNode[Math.floor(N / 2)]) : randPoint(t);
          let prevCov = null, prev = null, hint = 0, prevKey = null;
          for (let z = 1.5; z <= (QUICK || big ? 40 : 120); z *= factor) {
            const r = cutter(method, makeTransform('radial', W, H, zoomView(z, px, py), area, N), budget, hint);
            if (method === 'current') hint = r.minPx;
            const cur = snapshotEntries();
            const key = method === 'current' ? r.minPx.toFixed(2) : `${r.level}/${r.levelMax}/${r.zoomIndex}`;
            if (prev) {
              let d = 0;
              for (const x of cur) if (!prev.has(x)) d++;
              for (const x of prev) if (!cur.has(x)) d++;
              const frac = d / Math.max(1, cur.size), lc = key !== prevKey ? 1 : 0;
              if (!two) { R.changed += d; R.size += cur.size; R.steps++; R.lc += lc; if (frac > R.worst) R.worst = frac; }
              else { R.changed2 += d; R.size2 += cur.size; R.steps2++; R.lc2 += lc; if (frac > R.worst2) R.worst2 = frac; }
            }
            if (!two) {
              const cov = cover(tr);
              if (prevCov) {
                for (const q of ranks) {
                  const a = find(prevCov, q), b = find(cov, q);
                  if (a < 0 || b < 0) continue;
                  R.compared++;
                  // the later entry must lie inside the earlier one (the same, or a split)
                  if (cov.st[b] < prevCov.st[a] || cov.en[b] > prevCov.en[a]) R.merged++;
                }
              }
              prevCov = cov;
            }
            prev = cur; prevKey = key;
          }
        }
      }
      row[method] = R;
      // strict monotonicity is the claim of the global level on any ladder, and of the tiles on powers of two (nested tiles)
      if (method === 'static-global' || (method === 'static-tiles' && LADDER === 2)) ok(R.merged === 0, `b zoom ${t.name} ${method} budget ${budget}: ${R.merged} of ${R.compared} tip observations were merged into a bigger entry while zooming in`);
    }
    console.log(`b/c zoom-in paths (${paths} paths), budget ${budget}:`);
    for (const m of methods) {
      const R = row[m];
      console.log(`   ${m.padEnd(14)} b: sampled tips under a BIGGER entry in the next 3% frame ${R.merged}/${R.compared} (${pct(R.merged / Math.max(1, R.compared))}) | c: entries changing per 2% step ${pct(R.changed2 / Math.max(1, R.size2))} (worst step ${pct(R.worst2)}), per 3% step ${pct(R.changed / Math.max(1, R.size))} | ${m === 'current' ? 'threshold changes' : 'level or zoom-step changes'} per 100 steps: 2% ${(100 * R.lc2 / Math.max(1, R.steps2)).toFixed(0)}, 3% ${(100 * R.lc / Math.max(1, R.steps)).toFixed(0)}`);
    }
  }

  // ------------------------------------------------------------------ d budget, e accounting
  for (const budget of [500, 2000, 20000]) {
    const row = {};
    for (const method of methods) {
      let views = 0, over = 0, used = 0, mSum = 0, mFine = 0, maxUsed = 0, doubles = 0, uncovered = 0, visibleTips = 0, truncated = 0;
      seed = 777;
      const zs = QUICK ? [1, 4, 16] : big ? [1, 4, 16, 64, 256] : [1, 2, 4, 8, 16, 32, 64, 128];
      for (const z of zs) {
        const reps = z === 1 ? 1 : QUICK ? 4 : big ? 6 : 12;
        for (let rep = 0; rep < reps; rep++) {
          const [px, py] = z === 1 ? [0, 0] : randPoint(t);
          const T = makeTransform('radial', W, H, zoomView(z, px, py), area, N);
          const r = cutter(method, T, budget);
          views++;
          if (list.count > budget) over++;
          if (r.overflow) truncated++;
          used += list.count / budget; if (list.count > maxUsed) maxUsed = list.count;
          mSum += r.minPx; mFine += r.minPxFine;
          const cov = cover(tr);
          doubles += cov.doubles;
          const k = T.k;
          for (const rr of ranks) {
            const nd = tr.tipNode[rr];
            const x = T.cx + L.X[nd] * k * L.COS[nd], y = T.cy + L.X[nd] * k * L.SIN[nd];
            if (x >= 0 && x <= W && y >= 0 && y <= H) { visibleTips++; if (find(cov, rr) < 0 && !(method === 'current' && r.mergedTips > 0)) uncovered++; }
          }
        }
      }
      row[method] = { views, over, used: used / views, m: mSum / views, mFine: mFine / views, maxUsed, doubles, uncovered, truncated, visibleTips };
      if (method === 'static-global') ok(truncated === 0 && over === 0, `d budget ${t.name} ${method} ${budget}: ${over} of ${views} views above the budget (max ${maxUsed}), ${truncated} truncated`);
      if (method !== 'current') {
        ok(doubles === 0, `e accounting ${t.name} ${method} ${budget}: ${doubles} tips covered twice`);
        // a truncated list (tiles can overflow) drops tips by construction, so it is not counted twice as a failure
        if (truncated === 0) ok(uncovered === 0, `e accounting ${t.name} ${method} ${budget}: ${uncovered} of ${visibleTips} sampled visible tips are not covered by any entry`);
      }
    }
    console.log(`d budget ${budget}: ` + methods.map((m) => { const x = row[m]; return `${m}: over ${x.over}/${x.views}${x.truncated ? ` (truncated ${x.truncated})` : ''}, max ${x.maxUsed}, mean used ${pct(x.used)}, smallest clade ${x.m.toFixed(1)} px${x.mFine !== x.m ? ` (tiles ${x.mFine.toFixed(1)}..${x.m.toFixed(1)})` : ''}, doubles ${x.doubles}, uncovered ${x.uncovered}/${x.visibleTips}`; }).join(' | '));
  }

  // ------------------------------------------------------------------ e hit-testing of summaries and runs
  for (const method of ['static-global', 'static-tiles']) {
    let tried = 0, good = 0, runsTried = 0, runsGood = 0;
    seed = 31337;
    for (const z of [1, 4, 16]) {
      for (let rep = 0; rep < (z === 1 ? 1 : 3); rep++) {
        const [px, py] = z === 1 ? [0, 0] : randPoint(t);
        const T = makeTransform('radial', W, H, zoomView(z, px, py), area, N);
        cutter(method, T, 2000);
        const hit = new HitIndex(tr, L);
        hit.build(list, T);
        for (let e = 0; e < list.count && tried < 400; e++) {
          if (list.kind[e] !== K_SUMMARY) continue;
          const i = list.node[e], lm = list.last[e];
          const P = lm >= 0 ? tr.parent[i] : i;
          const ls = tr.leafStart[i], le = lm >= 0 ? tr.leafEnd[lm] : tr.leafEnd[i];
          const r1 = (lm >= 0 ? list.xmax[e] : L.XMAX[i]) * T.k, r0 = (lm >= 0 ? L.X[P] : L.X[i]) * T.k;
          if ((le - ls) * T.da * r1 < 6 || r1 - r0 < 8) continue;
          const a = ((ls + le) / 2) * T.da;
          const x = T.cx + (r1 - 3) * Math.cos(a), y = T.cy + (r1 - 3) * Math.sin(a);
          if (x < 2 || y < 2 || x > W - 2 || y > H - 2) continue;
          const h = hit.query(x, y, T);
          if (lm >= 0) { runsTried++; if (h && h.kind === 'summary' && h.node === P && h.run && h.run.first === i && h.run.last === lm) runsGood++; }
          else { tried++; if (h && h.kind === 'summary' && h.node === i) good++; }
        }
      }
    }
    console.log(`e hit-test ${method}: summaries ${good}/${tried}, runs ${runsGood}/${runsTried} (a click reports the parent and exactly the tips of the run)`);
    ok(good === tried, `e hit ${t.name} ${method}: summaries ${good}/${tried}`);
    ok(runsGood === runsTried, `e hit ${t.name} ${method}: runs ${runsGood}/${runsTried}`);
  }

  // ------------------------------------------------------------------ g the argument behind the global level, checked numerically
  // For a fixed world-space threshold a smaller window cannot hold more entries than a larger one, so the finest level that fits can
  // only get finer while zooming in. The chain takes the max with the previous level anyway; this counts the zoom steps at which the
  // previous level did NOT pass the (binned, conservative) test at the next, smaller window, i.e. where the estimator breaks the argument.
  for (const budget of [500, 2000]) {
    const S = new StaticLod(tr, L);
    S.checkMonotone = true;
    for (let z = 1; z <= (big ? 64 : 512); z *= 1.07) S.cut(makeTransform('radial', W, H, zoomView(z, 0.3, 0.2), area, N), { method: 'static-global', ladder: LADDER, base: 3, budget, summaries: true }, null, list);
    console.log(`g global level, budget ${budget}: the previous level failed the test at the next (smaller) window ${S.monotoneBreaks} of ${S.monotoneTests} zoom steps`);
  }

  // ------------------------------------------------------------------ cost on the big tree: tables, first frames, memory
  if (big) {
    const heap0 = process.memoryUsage().heapUsed;
    const S2 = new StaticLod(tr, L);
    console.log(`big tree cost: critical zoom pass ${S2.buildMs.toFixed(0)} ms, ${(S2.crit.byteLength / 1e6).toFixed(1)} MB`);
    for (const method of ['static-global', 'static-tiles']) {
      const S = new StaticLod(tr, L);
      const [px, py] = anchorOf(L, tr, tr.tipNode[Math.floor(N * 0.37)]);
      const lad = method === 'static-tiles' ? 2 : LADDER;
      const line = [];
      for (const z of [1, 4, 16, 64, 256, 1024, 4096]) {
        const T = makeTransform('radial', W, H, zoomView(z, z === 1 ? 0 : px, z === 1 ? 0 : py), area, N);
        const t0 = performance.now();
        S.cut(T, { method, ladder: lad, base: 3, budget: 2000, summaries: true }, null, list);
        const ms = performance.now() - t0;
        const t1 = performance.now();
        S.cut(T, { method, ladder: lad, base: 3, budget: 2000, summaries: true }, null, list);
        line.push(`${z}x first ${ms.toFixed(0)} ms then ${(performance.now() - t1).toFixed(1)} ms`);
      }
      console.log(`big tree ${method} (ladder ${lad.toFixed(2)}): ${line.join('; ')}; ${S.enumCount} cut enumerations (${S.enumMs.toFixed(0)} ms), ${S.probes} verification windows; heap +${((process.memoryUsage().heapUsed - heap0) / 1e6).toFixed(0)} MB`);
    }
  }
}

// ------------------------------------------------------------------ f polytomies: a star and the mixed polytomy (issue 13)
// Zoomed on the polytomy where its children are about a pixel apart: a bounded number of primitives, the large children keep their own
// entries (when the detail is not budget-limited), runs are formed, and at budget 2000 the polytomy does not push the detail level up.
for (const name of ['star-10000', 'syn-polytomy-mixed-22800']) {
  const t = trees.find((x) => x.name === name);
  if (!t) continue;
  const { tr, L, N } = t;
  const cutter = makeCutter(t);
  let P = -1;
  for (let i = 0; i < tr.nodeCount; i++) if (tr.childCount[i] >= 8000) P = i;
  const large = [];
  for (let c = tr.firstChild[P]; c < tr.subtreeEnd[P]; c = tr.subtreeEnd[c]) if (tr.leafEnd[c] - tr.leafStart[c] >= 60) large.push(c);
  const mid = tr.tipNode[(tr.leafStart[P] + tr.leafEnd[P]) >> 1];
  const [px, py] = anchorOf(L, tr, mid);
  console.log(`\n=== polytomy ${name}: node ${P} with ${tr.childCount[P]} children, ${large.length} children of 60+ tips`);
  for (const budget of [500, 2000]) {
    for (const z of [4, 8, 16, 32]) {
      const T = makeTransform('radial', W, H, zoomView(z, px, py), area, N);
      const pitch = ((2 * Math.PI) / N) * L.XMAX[mid] * T.k;
      const row = [];
      for (const method of methods) {
        const r = cutter(method, T, budget);
        let direct = 0, runs = 0, own = 0, visLarge = 0;
        const ids = new Set();
        for (let e = 0; e < list.count; e++) {
          const i = list.node[e], lm = list.last[e];
          ids.add(i);
          if (tr.parent[i] === P) direct++;
          if (lm >= 0) { runs++; if (method !== 'current') ok(tr.parent[lm] === P && lm >= i, `f ${name} ${method}: run ${i}..${lm} is not a set of children of the polytomy`); }
        }
        for (const c of large) {
          const nd = tr.tipNode[(tr.leafStart[c] + tr.leafEnd[c]) >> 1];
          const x = T.cx + L.X[nd] * T.k * L.COS[nd], y = T.cy + L.X[nd] * T.k * L.SIN[nd];
          if (x > 0 && x < W && y > 0 && y < H) { visLarge++; if (ids.has(c)) own++; }
        }
        row.push(`${method}: drawn ${list.count} (polytomy entries ${direct}, runs ${runs}, large in view ${visLarge} own ${own}) m ${r.minPx.toFixed(1)} forced ${r.forced}`);
        if (method !== 'current' && 2 * pitch < 3) {
          ok(list.count <= budget && !r.overflow, `f ${name} ${method} ${budget} ${z}x: ${list.count} entries over the budget`);
          if (r.forced === 0) ok(own === visLarge, `f ${name} ${method} ${budget} ${z}x: ${visLarge - own} of ${visLarge} large children in view lost their own entry although the detail level is not budget-limited`);
          ok(direct < 3 * visLarge + 300, `f ${name} ${method} ${budget} ${z}x: ${direct} polytomy entries for ${visLarge} large children`);
          // at 500 the two 1,000-tip clades elsewhere raise the global level and the per-tile share is tiny: informational
          if (budget >= 2000) ok(r.forced === 0, `f ${name} ${method} ${budget} ${z}x: ${r.forced} clades collapsed below the base threshold (detail raised to ${r.minPx.toFixed(2)} px)`);
        }
      }
      console.log(`f budget ${budget}, ${z}x (tip pitch ${pitch.toFixed(2)} px): ` + row.join(' | '));
    }
  }
}

console.log(failures ? `\nFAILED (${failures})` : '\nOK');
process.exit(failures ? 1 : 0);
