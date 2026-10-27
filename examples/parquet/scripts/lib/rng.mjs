// A small seeded generator (mulberry32) and a 32-bit hash, so that a dataset is a pure function of its parameters.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash32(x, seed = 0) {
  let h = (x ^ Math.imul(seed, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A standard normal number from two uniforms (Box-Muller). */
export function gauss(rng) {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
}

const SYLLABLES = ['ba', 'ko', 'ri', 'ta', 'mu', 'le', 'si', 'no', 'fa', 've', 'du', 'ha', 'pe', 'zo', 'lu', 'ca'];
const word = (h, n) => {
  let s = '';
  for (let i = 0; i < n; i++, h >>>= 4) s += SYLLABLES[h & 15];
  return s;
};

/** A made-up species name for a tip rank, unique (the rank is in it) and a pure function of (rank, seed): `Bakorita_muleno_1a2b`. */
export function tipLabel(rank, seed) {
  const genus = word(hash32(rank, seed), 3);
  return genus[0].toUpperCase() + genus.slice(1) + '_' + word(hash32(rank, seed + 1), 3) + '_' + rank.toString(36);
}
