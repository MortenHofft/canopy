// Real/synthetic fixture list for the timing bench. Paths resolve from the repo root.
// Shape: { id, path, kind, gzipped, description }
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '..', '..', '..', '..');

export const BENCH_FIXTURES = [
  // Small, well-formed Newick, variety of flavors
  { id: 'synth-balanced-200',    path: 'data/synthetic/newick/balanced_200.nwk',               kind: 'newick' },
  { id: 'synth-caterpillar-200', path: 'data/synthetic/newick/caterpillar_200.nwk',            kind: 'newick' },
  { id: 'synth-bushy-200',       path: 'data/synthetic/newick/bushy_200.nwk',                  kind: 'newick' },

  // 1k synthetic, 4 shapes
  { id: 'synth-balanced-1000',    path: 'data/synthetic/newick/balanced_1000.nwk',             kind: 'newick' },
  { id: 'synth-caterpillar-1000', path: 'data/synthetic/newick/caterpillar_1000.nwk',          kind: 'newick' },
  { id: 'synth-bushy-1000',       path: 'data/synthetic/newick/bushy_1000.nwk',                kind: 'newick' },
  { id: 'synth-yule-1000',        path: 'data/synthetic/newick/yule_1000.nwk',                 kind: 'newick' },

  // Real trees of varied sizes
  { id: 'real-butterflies-496',  path: 'data/rich/butterflies-europe-496/Butterflies_Europe_phylogeny_dated.nwk.txt', kind: 'newick' },
  { id: 'real-mammals-4071',     path: 'data/rich/mammals-4071/mammals.tree',                  kind: 'newick' },

  // 10k synthetic, two shapes
  { id: 'synth-balanced-10000',    path: 'data/synthetic/newick/balanced_10000.nwk.gz',        kind: 'newick', gzipped: true },
  { id: 'synth-caterpillar-10000', path: 'data/synthetic/newick/caterpillar_10000.nwk.gz',     kind: 'newick', gzipped: true },

  // Large real trees (OpenTree)
  { id: 'real-otol-mammalia',    path: 'data/rich/otol-mammalia/mammalia.nwk.gz',              kind: 'newick', gzipped: true },
  { id: 'real-otol-aves',        path: 'data/rich/otol-aves/aves.nwk.gz',                      kind: 'newick', gzipped: true },

  // NEXUS
  { id: 'synth-nexus-yule-200',       path: 'data/synthetic/nexus/yule_200.nex',               kind: 'nexus' },
  { id: 'synth-nexus-multi-200x10',   path: 'data/synthetic/nexus/multi_yule_200_x10.nex',     kind: 'nexus' },
  { id: 'real-nexus-beast-fluA',      path: 'data/rich/beast-fluA-h3-swine/MCC_FluA_H3.tree',  kind: 'nexus' },
];

export function loadFixture(f) {
  const abs = resolve(REPO_ROOT, f.path);
  const bytes = readFileSync(abs);
  const text = f.gzipped ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8');
  return text;
}
