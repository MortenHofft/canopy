// The trees this example can show (?tree=<id>): every tree of the catalogue the playground uses (examples/shared/catalogue.json, shared
// so the two examples cannot drift apart) plus this example's own, in trees.json: `extras` (more trees, by group) and `overrides` (a
// field of a catalogue tree this example sets, e.g. the Carangaria `supportKey`). Files come from the repository's data/ folder (served
// at /data/ by the dev server, copied there by the site build, which reads both JSON files); a tree too large for main falls back to
// its `remote` URL. Gzipped files are inflated by content, whatever the host does (data.ts).

import { parseNewick, parseNexus, supportFrom, type TreeModel } from '@gbif-phylo/io';
import own from './trees.json';
import { GROUPS as CATALOGUE, fetchText, parseFasta, type Entry as CatalogueEntry } from '../../shared/data.ts';

export interface Entry extends CatalogueEntry {
  /** The node annotation that holds the support (a BEAST tree: 'posterior'); copied into `tree.support` when the labels give none. */
  supportKey?: string;
}

/** The picker's groups (as the playground's <optgroup>s) of entries by id: the catalogue's, then this example's extras. */
export const GROUPS: Record<string, Record<string, Entry>> = {};
const extras = own.extras as Record<string, Record<string, Entry>>;
const overrides = own.overrides as Record<string, Partial<Entry>>;
for (const group of new Set([...Object.keys(CATALOGUE), ...Object.keys(extras)])) {
  const entries: Record<string, Entry> = { ...CATALOGUE[group], ...extras[group] };
  GROUPS[group] = Object.fromEntries(Object.entries(entries).map(([id, e]) => [id, { ...e, ...overrides[id] }]));
}
export const TREES: Record<string, Entry> = Object.assign({}, ...Object.values(GROUPS));

export { parseFasta };

export async function loadTree(id: string): Promise<{ tree: TreeModel; fasta: Record<string, string> | null; bytes: number }> {
  const t = TREES[id];
  if (!t) throw new Error(`unknown tree ${JSON.stringify(id)}; known: ${Object.keys(TREES).join(', ')}`);
  const [src, fa] = await Promise.all([fetchText(t.path, t.remote), t.fasta ? fetchText(t.fasta) : Promise.resolve(null)]);
  const o = { annotations: t.supportKey !== undefined };
  const tree = t.format === 'nexus' ? parseNexus(src.text, o).tree : parseNewick(src.text, o);
  // a BEAST MCC tree keeps its support as [&posterior=0.98], not as an internal label: copy it to where tree.support is read (the
  // bootstrap labels, the inspector, collapse by support), as supportFrom's documentation says
  if (t.supportKey && !tree.support.some((v) => !Number.isNaN(v))) tree.support.set(supportFrom(tree, t.supportKey));
  return { tree, fasta: fa === null ? null : parseFasta(fa.text), bytes: src.bytes };
}
