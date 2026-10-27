// The sidecar of a synthetic tree: per-tip columns and a made-up sequence, generated in tree order in ONE pass over the nodes so that
// nothing per tip is kept (only the path from the root: a value per depth). Columns follow the tree, as real ones do: a category is
// inherited from the parent with probability `keep` and drawn anew otherwise (skewed, so a few values are common), a number is a random
// walk down the tree, and a sequence is the parent's sequence with a few mutations per unit of branch length. So the clades of a tree have
// a dominant country and neighbouring tips have similar sequences (which is what lets a codec compress them).

import { gauss, mulberry32 } from './rng.mjs';

const ISO = (
  'US DE GB FR ES IT NL BE CH AT SE NO DK FI PL CZ PT IE GR HU RO BG HR SK SI LT LV EE LU MT CY IS CA MX BR AR CL CO PE VE EC UY PY BO CR PA ' +
  'GT HN SV NI CU DO JM TT HT CN JP KR IN ID TH VN MY PH SG TW HK PK BD LK NP MM KH LA MN KZ UZ IR IQ IL JO LB SA AE QA KW OM YE TR GE AM AZ ' +
  'AU NZ PG FJ ZA NG KE ET TZ UG GH CI SN CM AO MZ ZW ZM MG MA DZ TN EG LY SD RU UA BY MD RS BA MK AL ME XK'
).split(' ');

/** A name for value `k` of category column number `c` (0 = country, 1 = host, then cat_3, cat_4...). */
export function categoryValue(c, k) {
  if (c === 0) return k < ISO.length ? ISO[k] : 'X' + k;
  if (c === 1) return 'Host_' + k;
  return `v${c + 1}_${k}`;
}
export const categoryName = (c) => (c === 0 ? 'country' : c === 1 ? 'host' : `cat_${c + 1}`);
export const numberName = (c) => (c === 0 ? 'year' : c === 1 ? 'lat' : c === 2 ? 'lon' : `num_${c + 1}`);
const NUMBER_SPEC = [
  { base: 2012, sigma: 2.5, lo: 1990, hi: 2025, int: true },
  { base: 0, sigma: 20, lo: -90, hi: 90, int: false },
  { base: 0, sigma: 40, lo: -180, hi: 180, int: false },
];

/**
 * @param {object} tree  from makeTree
 * @param {object} spec
 * @param {number} spec.seed
 * @param {number} spec.categories  number of category columns (country, host, ...)
 * @param {number} spec.cardinality distinct values of the first category (the others: 5 times as many, capped at 5000)
 * @param {number} spec.keep        probability that a node keeps its parent's category (clustering)
 * @param {number} spec.numeric     number of numeric columns (year, lat, lon, ...)
 * @param {number} spec.seqLength   sequence length, 0 for none
 * @param {number} spec.seqRate     mutations per site per unit branch length
 * @param {(rank: number) => string} label
 * @param {number} tipRows          rows per row group of the small columns
 * @param {number} seqRows          rows per row group of the sequences
 * @param {{ small(g: object): void, seq(g: object): void }} sink  called with a group of rows each time one is full (and the last, partial one)
 */
export function streamSidecar(tree, spec, label, tipRows, seqRows, sink) {
  const { n, depth, end, len, tips } = tree;
  const D = tree.maxDepthAll + 2;
  const nc = spec.categories;
  const cardinalities = Array.from({ length: nc }, (_, c) => (c === 0 ? spec.cardinality : Math.min(5000, spec.cardinality * 5)));
  const crng = Array.from({ length: nc }, (_, c) => mulberry32(spec.seed * 31 + 100 + c));
  const cpath = Array.from({ length: nc }, () => new Int32Array(D));
  const counts = cardinalities.map((k) => new Float64Array(k));
  const nn = spec.numeric;
  const nrng = Array.from({ length: nn }, (_, c) => mulberry32(spec.seed * 31 + 200 + c));
  const npath = Array.from({ length: nn }, (_, c) => new Float64Array(D).fill((NUMBER_SPEC[c] ?? { base: 0 }).base));
  const L = spec.seqLength;
  const srng = mulberry32(spec.seed * 31 + 300);
  const spath = [];
  const draw = (rng, k) => Math.min(k - 1, Math.floor(k * Math.pow(rng(), 1.6))); // skewed towards 0: a few common values

  // buffers of the current row groups
  let rank = 0;
  let sc = 0;
  let sq = 0;
  const mkSmall = (m) => ({
    labels: new Array(m),
    cats: Array.from({ length: nc }, () => new Int32Array(m)),
    nums: Array.from({ length: nn }, () => new Float64Array(m)),
    node: new Int32Array(m),
  });
  let small = mkSmall(Math.min(tipRows, tips));
  let seqs = L > 0 ? new Array(Math.min(seqRows, tips)) : null;
  const ALPHABET = 'ACGT';
  for (let i = 0; i < n; i++) {
    const d = depth[i];
    for (let c = 0; c < nc; c++) {
      const v = i === 0 || crng[c]() >= spec.keep ? draw(crng[c], cardinalities[c]) : cpath[c][d - 1];
      cpath[c][d] = v;
    }
    const step = Math.sqrt(len[i] > 0 ? len[i] : 0.1);
    for (let c = 0; c < nn; c++) {
      const s = NUMBER_SPEC[c] ?? { sigma: 1, lo: -1e9, hi: 1e9, int: false };
      npath[c][d] = i === 0 ? npath[c][0] : Math.min(s.hi ?? 1e9, Math.max(s.lo ?? -1e9, npath[c][d - 1] + gauss(nrng[c]) * s.sigma * step));
    }
    if (L > 0) {
      if (!spath[d]) spath[d] = new Uint8Array(L);
      const cur = spath[d];
      if (i === 0) for (let j = 0; j < L; j++) cur[j] = (srng() * 4) | 0;
      else {
        cur.set(spath[d - 1]);
        const m = Math.floor((len[i] > 0 ? len[i] : 0.1) * spec.seqRate * L + srng());
        for (let k = 0; k < m; k++) cur[(srng() * L) | 0] = (srng() * 4) | 0;
      }
    }
    if (end[i] !== i + 1) continue; // internal node: nothing to emit
    for (let c = 0; c < nc; c++) {
      small.cats[c][sc] = cpath[c][d];
      counts[c][cpath[c][d]]++;
    }
    for (let c = 0; c < nn; c++) small.nums[c][sc] = NUMBER_SPEC[c]?.int ? Math.round(npath[c][d]) : npath[c][d];
    small.labels[sc] = label(rank);
    small.node[sc] = i;
    sc++;
    if (L > 0) {
      const b = Buffer.allocUnsafe(L);
      const cur = spath[d];
      for (let j = 0; j < L; j++) b[j] = ALPHABET.charCodeAt(cur[j]);
      seqs[sq++] = b.toString('latin1');
    }
    rank++;
    if (sc === small.labels.length) {
      sink.small(small);
      sc = 0;
      small = mkSmall(Math.min(tipRows, tips - rank));
    }
    if (L > 0 && sq === seqs.length) {
      sink.seq(seqs);
      sq = 0;
      seqs = new Array(Math.min(seqRows, tips - rank));
    }
  }
  return { cardinalities, counts: counts.map((a) => Array.from(a)) };
}
