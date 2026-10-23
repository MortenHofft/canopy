// Fixed inputs of the cut golden test (cut-golden.test.mjs): small deterministic trees, views and options. Data and generators only; the
// goldens themselves (cut-golden.json) were captured by running exactly these cases through the e2897fb code (see the test header).

export const W = 300;
export const H = 200;

let seed = 20240607;
const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;

/** Comb (caterpillar) of n tips; every 9th rung has a short internal branch, so thin clades occur (they used to exercise a width rule, removed in #87). */
function ladder(n) {
  let s = 't0:1';
  for (let i = 1; i < n; i++) s = `(${s}:${i % 9 === 0 ? '0.002' : '0.5'},t${i}:${(1 + (i % 5) * 0.4).toFixed(1)})`;
  return s + ';';
}

/** Comb of n tips with equal short branches: neighbouring tips are well under a pixel apart in both directions, so the pixel-cell dedupe
 *  merges them (the case that keeps a 200k comb from emitting 400k segments). */
function comb(n) {
  let s = 't0:0.01';
  for (let i = 1; i < n; i++) s = `(${s}:0.01,t${i}:0.01)`;
  return s + ';';
}

/** Balanced binary tree of n tips; the tips of the cherries at the bottom have very short branches (thin clades, two rows tall). */
function balanced(n, p = 'b') {
  const tip = (q, thin) => `${q}:${thin ? '0.002' : (1 + rnd()).toFixed(3)}`;
  if (n === 1) return tip(p, false);
  const l = n >> 1;
  const kid = (m, q) => (m === 1 ? tip(q, n === 2) : balanced(m, q));
  return `(${kid(l, p + 'a')},${kid(n - l, p + 'b')}):${(0.2 + rnd() * 0.6).toFixed(3)}`;
}

/** Random binary tree by splitting (deterministic seed); mixed clade sizes and depths, short tips in about every other cherry. */
function random(n, p = 'r') {
  const tip = (q, thin) => `${q}:${thin ? '0.002' : (0.3 + rnd()).toFixed(3)}`;
  if (n === 1) return tip(p, false);
  const l = 1 + Math.floor(rnd() * (n - 1));
  const thin = n === 2 && rnd() < 0.5;
  const kid = (m, q) => (m === 1 ? tip(q, thin) : random(m, q));
  return `(${kid(l, p + 'a')},${kid(n - l, p + 'b')}):${(0.1 + rnd() * 0.9).toFixed(3)}`;
}

/** Polytomies (all at least SLICE_MIN_CHILDREN = 16 children), under a binary backbone:
 *  - a star of 40 tips (one run, or two when the class changes half way);
 *  - a node whose children are, in order, a clade of 20 tips, 19 tips, a clade of 18 tips, 17 tips: each clade's tips form a run, and
 *    the tips after it have another parent, so a run must end where the parent changes;
 *  - a node with 20 tips, a clade of 6 tips, 20 tips, a clade of 6: runs of small siblings between larger children. */
function polytomy() {
  const tips = (m, q) => Array.from({ length: m }, (_, i) => `${q}${i}:${(1 + (i % 3) * 0.5).toFixed(1)}`);
  const clade = (m, q) => `(${tips(m, q).join(',')}):0.8`;
  const star = tips(40, 's').join(',');
  const parents = [clade(20, 'a'), ...tips(19, 'p'), clade(18, 'b'), ...tips(17, 'q')].join(',');
  const mixed = [...tips(20, 'm'), clade(6, 'c'), ...tips(20, 'n'), clade(6, 'd')].join(',');
  return `(${balanced(24, 'x')},(${star}):1.5,(${parents}):1.2,(${mixed}):1,${balanced(16, 'y')});`;
}

/** @typedef {{ nwk: string, stubs: ((i: number, childCount: number) => boolean) | null, classes: ((i: number) => number) | null }} TreeSpec */
export const TREES = {
  ladder: { nwk: ladder(140), stubs: null, classes: null },
  balanced: { nwk: balanced(128), stubs: null, classes: (i) => (i % 5 === 0 ? 1 : 0) },
  random: { nwk: random(160), stubs: null, classes: null },
  comb: { nwk: comb(700), stubs: null, classes: null },
  // more tips than pixel rows: most of the tree is sub-pixel, so the pixel-cell dedupe merges many primitives
  dense: { nwk: random(900), stubs: null, classes: null },
  // preorder ids: the star's tips are 49..88 (class 1 from 69 on: two runs), the tips after the first clade of node 89 are 111..129
  polytomy: { nwk: polytomy(), stubs: null, classes: (i) => (i >= 69 && i < 89 ? 1 : i >= 111 && i < 130 ? 2 : 0) },
  // a snapshot with stubs (clades whose rows are not loaded): every 6th internal row except the root
  stubs: { nwk: random(160), stubs: (i, cc) => i > 0 && cc > 0 && i % 6 === 5, classes: null },
};

const dx = [0, 0.37, 0.5, 0.91];

/** Views as functions of the tip count N. Rectangular: x in tree widths, y in rows. Radial: world units around the root. */
export const VIEWS = {
  rectangular: {
    fit: (N) => ({ x0: -0.03, x1: 1.03, y0: -1, y1: N + 1 }),
    // the right edge cuts the tree: clades whose branch starts inside but whose node lies beyond the clip edge
    rightEdge: (N) => ({ x0: -0.03, x1: 0.55, y0: -1, y1: N + 1 }),
    rightEdge2: (N) => ({ x0: 0.1, x1: 0.38, y0: N * 0.2, y1: N * 0.8 }),
    rightEdge3: (N) => ({ x0: 0, x1: 0.31, y0: -1, y1: N + 1 }),
    rightEdge4: (N) => ({ x0: 0, x1: 0.42, y0: -1, y1: N + 1 }),
    rightEdge5: (N) => ({ x0: 0.05, x1: 0.7, y0: -1, y1: N + 1 }),
    rightEdge6: (N) => ({ x0: 0, x1: 0.8, y0: -1, y1: N + 1 }),
    zoom: (N) => ({ x0: 0.4, x1: 0.6, y0: N * 0.3, y1: N * 0.5 }),
    // sub-pixel pans of the fit view (the cut must not depend on the fractional part of the origin)
    pan1: (N) => ({ x0: -0.03 + dx[1] / 300, x1: 1.03 + dx[1] / 300, y0: -1 + dx[1] / 3, y1: N + 1 + dx[1] / 3 }),
    pan2: (N) => ({ x0: -0.03 + dx[3] / 300, x1: 1.03 + dx[3] / 300, y0: -1 + dx[3] / 3, y1: N + 1 + dx[3] / 3 }),
  },
  radial: {
    fit: () => radial(0, 0, 1),
    zoom4: () => radial(0.75, 0, 4),
    offCentre: () => radial(-0.8, 0.5, 3),
    far: () => radial(0.9, 0.1, 16),
    pan1: () => radial(0.37 / 270, 0.61 / 270, 1),
    pan2: () => radial(0.91 / 270, 0.2 / 270, 1),
  },
};
function radial(cx, cy, z) {
  const k = 100; // px per unit radius at the fit view
  const w = W / k / z,
    h = H / k / z;
  return { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 };
}

/** Cut options: [budget, base minPx]; the small budget forces the threshold up (rule D) so `forced` counts something. */
export const OPTIONS = [
  { budget: 400, base: 3 },
  { budget: 40, base: 3 },
  { budget: 14, base: 3 },
];

export function allCases() {
  const cases = [];
  for (const tree of Object.keys(TREES))
    for (const layout of ['rectangular', 'radial'])
      for (const view of Object.keys(VIEWS[layout]))
        for (let o = 0; o < (['fit', 'zoom', 'zoom4'].includes(view) ? OPTIONS.length : 1); o++)
          cases.push({ id: `${tree}/${layout}/${view}/b${OPTIONS[o].budget}`, tree, layout, view, opts: OPTIONS[o] });
  return cases;
}

/** Cases that pass the real collapse cap (`collapseCap(tipPitch, true, layout === 'rectangular')`, #109 and #113) with the base
 *  `min(cap, 14)`, as the viewer does with the explorer's minCladePx 14: rectangular at rows of 0.9, 1, 2 and 6 px (a view of H / px
 *  rows from the top of the 900-tip tree), the same at 2 px under a budget of 40 (the threshold climbs past the cap), radial at pitches
 *  under 6 px (no cap) and over it. Their goldens are in cut-golden-cap.json. */
export function cappedCases() {
  const rect = (px) => ({ x0: -0.03, x1: 1.03, y0: 0, y1: H / px });
  const cases = [];
  for (const px of [0.9, 1, 2, 6])
    cases.push({ id: `cap/dense/rectangular/${px}px/b20000`, tree: 'dense', layout: 'rectangular', view: rect(px), budget: 20000 });
  cases.push({ id: 'cap/dense/rectangular/2px/b40', tree: 'dense', layout: 'rectangular', view: rect(2), budget: 40 });
  cases.push({ id: 'cap/random/rectangular/6px/b20000', tree: 'random', layout: 'rectangular', view: rect(6), budget: 20000 });
  cases.push({ id: 'cap/balanced/radial/z1/b20000', tree: 'balanced', layout: 'radial', view: radial(0, 0, 1), budget: 20000 });
  cases.push({ id: 'cap/balanced/radial/z2/b20000', tree: 'balanced', layout: 'radial', view: radial(0, 0, 2), budget: 20000 });
  cases.push({ id: 'cap/balanced/radial/z2/b40', tree: 'balanced', layout: 'radial', view: radial(0, 0, 2), budget: 40 });
  return cases;
}
