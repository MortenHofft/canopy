// Residue colours of alignment columns: two schemes (protein, nucleotide), each a few theme tokens with a light and a dark default.
//
// Why group tokens and not one property per residue: A, C, G and T mean different things in the two alphabets, so a per-letter token
// (--phylo-residue-a) would have to pick one of them. The protein scheme colours physico-chemical groups (twenty letters in seven
// colours), so its tokens are the groups (--phylo-residue-hydrophobic, ...); the nucleotide scheme is four bases, so its tokens are the
// bases (--phylo-residue-a/-c/-g/-t, U shares T). Seven plus four plus "anything else" is a set a stylesheet can reasonably set, and
// every residue letter is still covered.

import { resolveColour, toHex } from './colour.ts';
import type { ResidueTheme } from './types.ts';

export type Alphabet = 'auto' | 'protein' | 'nucleotide';
/** What an alignment column is drawn with: `'auto'` is resolved to one of these (see `detectAlphabet`). */
export type ResolvedAlphabet = 'protein' | 'nucleotide';

type Token = keyof ResidueTheme;

/** Theme fields of the residue colours, in the order of the legend: protein groups, then nucleotide bases, then the rest. */
export const RESIDUE_THEME_KEYS = [
  'residueHydrophobic',
  'residuePositive',
  'residueNegative',
  'residuePolar',
  'residueAromatic',
  'residueGlycine',
  'residueProline',
  'residueA',
  'residueC',
  'residueG',
  'residueT',
  'residueOther',
] as const satisfies readonly Token[];

/** A group of residues drawn in one colour: its legend label, the residue letters and the theme field that colours it. */
export interface ResidueGroup {
  label: string;
  residues: string;
  token: Token;
}

const PROTEIN_GROUPS: readonly ResidueGroup[] = [
  { label: 'Hydrophobic', residues: 'AILMFWVC', token: 'residueHydrophobic' },
  { label: 'Positive', residues: 'KR', token: 'residuePositive' },
  { label: 'Negative', residues: 'ED', token: 'residueNegative' },
  { label: 'Polar', residues: 'NQSTU', token: 'residuePolar' },
  { label: 'Aromatic', residues: 'HY', token: 'residueAromatic' },
  { label: 'Glycine', residues: 'G', token: 'residueGlycine' },
  { label: 'Proline', residues: 'P', token: 'residueProline' },
];
const NUCLEOTIDE_GROUPS: readonly ResidueGroup[] = [
  { label: 'A', residues: 'A', token: 'residueA' },
  { label: 'C', residues: 'C', token: 'residueC' },
  { label: 'G', residues: 'G', token: 'residueG' },
  { label: 'T / U', residues: 'TU', token: 'residueT' },
];

/** The groups of a scheme, for a legend: pair each with `residueColours(theme, alphabet)[group.residues[0]]`. Gaps are not drawn. */
export function residueGroups(alphabet: ResolvedAlphabet): ResidueGroup[] {
  return (alphabet === 'nucleotide' ? NUCLEOTIDE_GROUPS : PROTEIN_GROUPS).map((g) => ({ ...g }));
}

// The defaults. The light protein scheme is the Clustal-like one the viewer always had; the dark one is lighter so that each colour keeps
// at least 3:1 against a dark background (checked in test/residues.test.mjs against #0f172a). The nucleotide colours are the usual
// A green, C blue, G orange, T/U red, four distinct hues.
const LIGHT: Required<ResidueTheme> = {
  residueHydrophobic: '#80a0f0',
  residuePositive: '#f01505',
  residueNegative: '#c048c0',
  residuePolar: '#15c015',
  residueAromatic: '#15a4a4',
  residueGlycine: '#f09048',
  residueProline: '#c0c000',
  residueA: '#2f9e44',
  residueC: '#2f6fd6',
  residueG: '#c27a00',
  residueT: '#d63b3b',
  residueOther: '#e2e2e2',
};
const DARK: Required<ResidueTheme> = {
  residueHydrophobic: '#8fb0ff',
  residuePositive: '#ff7a6e',
  residueNegative: '#e08be0',
  residuePolar: '#4fd34f',
  residueAromatic: '#2fd0d0',
  residueGlycine: '#ffa860',
  residueProline: '#e0d040',
  residueA: '#4ade80',
  residueC: '#60a5fa',
  residueG: '#fbbf24',
  residueT: '#f87171',
  residueOther: '#64748b',
};

/** The default colour of a residue token for a light or a dark theme. */
export function defaultResidueColour(token: Token, dark: boolean): string {
  return (dark ? DARK : LIGHT)[token];
}

const warned = new Set<string>();

/** The colour of each residue letter (A to Z, upper case; lower case is drawn like upper case) in the scheme of `alphabet`, plus `other`
 *  for every character that is not one of them, each as `#rrggbb`. This is the table the alignment column is drawn from, so a legend
 *  built from it matches. Each colour is the theme's `residue*` field, read the way the browser reads a CSS colour (names, hsl(),
 *  oklch() and the rest work; without a canvas only #rgb, #rrggbb and rgb()), with the alpha dropped: the bitmap is opaque. A value
 *  that is not a colour (or is fully transparent) is replaced by the default for a light or a dark theme (`theme.dark`), with one
 *  console warning per value. Gaps (`-` and `.`) are not drawn. */
export function residueColours(theme: ResidueTheme & { dark?: boolean }, alphabet: ResolvedAlphabet): Record<string, string> {
  const dark = theme.dark === true;
  const pick = (token: Token): string => {
    const v = theme[token];
    if (typeof v === 'string' && v.trim()) {
      const c = resolveColour(v);
      if (c && c.a > 0) return toHex(c);
      if (!warned.has(v)) {
        warned.add(v);
        console.warn(`${token}: ${JSON.stringify(v)} is not a colour the alignment can use; the default is drawn instead`);
      }
    }
    return defaultResidueColour(token, dark);
  };
  const other = pick('residueOther');
  const out: Record<string, string> = {};
  for (let c = 65; c < 91; c++) out[String.fromCharCode(c)] = other;
  for (const g of alphabet === 'nucleotide' ? NUCLEOTIDE_GROUPS : PROTEIN_GROUPS) {
    const colour = pick(g.token);
    for (const ch of g.residues) out[ch] = colour;
  }
  out.other = other;
  return out;
}

/** The lookup table of the alignment bitmap: the colour of each character code (0 = transparent, a gap) as ABGR for a little-endian
 *  Uint32 view of ImageData. Built from `residueColours`. */
export function residueTable(theme: ResidueTheme & { dark?: boolean }, alphabet: ResolvedAlphabet): Uint32Array {
  const colours = residueColours(theme, alphabet);
  const abgr = (hex: string) => {
    const n = parseInt(hex.slice(1), 16); // #rrggbb
    return ((255 << 24) | ((n & 255) << 16) | (n & 0xff00) | (n >> 16)) >>> 0;
  };
  const cache: Record<string, number> = {};
  const t = new Uint32Array(256);
  for (let c = 0; c < 256; c++) {
    const ch = String.fromCharCode(c).toUpperCase();
    if (ch === '-' || ch === '.') continue;
    const key = colours[ch] !== undefined && ch.length === 1 && ch >= 'A' && ch <= 'Z' ? ch : 'other';
    t[c] = cache[key] ??= abgr(colours[key]);
  }
  return t;
}

const SAMPLE_PER_SEQUENCE = 400;
const SAMPLE_TOTAL = 2000;
const SCAN_PER_SEQUENCE = 20000; // characters looked at per sequence, so a sequence of gaps costs a bounded scan

/** `'nucleotide'` when more than 90% of a sample of the residues are A, C, G, T, U or N (any case), otherwise `'protein'` (also for no
 *  residues). The sample is the first 400 residues of each sequence (gaps, `-` and `.`, are skipped and not counted; at most 20,000
 *  characters are scanned per sequence), up to 2000 residues in all. */
export function detectAlphabet(sequences: Iterable<string | undefined>): ResolvedAlphabet {
  let nt = 0;
  let all = 0;
  for (const s of sequences) {
    if (s === undefined) continue;
    const end = Math.min(s.length, SCAN_PER_SEQUENCE);
    let taken = 0;
    for (let i = 0; i < end && taken < SAMPLE_PER_SEQUENCE && all < SAMPLE_TOTAL; i++) {
      const raw = s.charCodeAt(i);
      if (raw === 45 || raw === 46) continue;
      const c = raw | 32; // lower case
      taken++;
      all++;
      if (c === 97 || c === 99 || c === 103 || c === 116 || c === 117 || c === 110) nt++; // a c g t u n
    }
    if (all >= SAMPLE_TOTAL) break;
  }
  return all > 0 && nt > all * 0.9 ? 'nucleotide' : 'protein';
}
