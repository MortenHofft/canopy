// The trees this example can show (?tree=<id>): every tree of the catalogue the playground uses (examples/shared/catalogue.json, shared
// so the two examples cannot drift apart) plus this example's own, in trees.json: `extras` (more trees, by group) and `overrides` (a
// field of a catalogue tree this example sets, e.g. the Carangaria `supportKey`). Files come from the repository's data/ folder (served
// at /data/ by the dev server, copied there by the site build, which reads both JSON files); a tree too large for main falls back to
// its `remote` URL. Gzipped files are inflated by content, whatever the host does (in the parse worker, or data.ts for the FASTA).

import { supportFrom, type TreeModel } from '@canopy/io';
import { parseInWorker, type ParseProgress } from '@canopy/io/worker';
import own from './trees.json';
import { GROUPS as CATALOGUE, fetchBytes, fetchText, parseFasta, type Entry as CatalogueEntry } from '../../shared/data.ts';

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

/** How far a load is: the fetch here, then the steps of the parse in the worker (`@canopy/io/worker`). */
export type LoadProgress = { phase: 'fetch' } | ParseProgress;
export interface LoadOptions {
  signal?: AbortSignal;
  onProgress?: (p: LoadProgress) => void;
}
export type Loaded = { tree: TreeModel; fasta: Record<string, string> | null; bytes: number };

/** A tree of the list, fetched here and parsed in a worker, so the page stays responsive while a large one loads. */
export async function loadTree(id: string, o: LoadOptions = {}): Promise<Loaded> {
  const t = TREES[id];
  if (!t) throw new Error(`unknown tree ${JSON.stringify(id)}; known: ${Object.keys(TREES).join(', ')}`);
  o.onProgress?.({ phase: 'fetch' });
  const [src, fa] = await Promise.all([fetchBytes(t.path, t.remote, o.signal), t.fasta ? fetchText(t.fasta) : Promise.resolve(null)]);
  const bytes = src.length; // before the bytes are transferred to the worker
  const { tree } = await parseInWorker(src, { format: t.format, annotations: t.supportKey !== undefined, ...o });
  // a BEAST MCC tree keeps its support as [&posterior=0.98], not as an internal label: copy it to where tree.support is read (the
  // bootstrap labels, the inspector, collapse by support), as supportFrom's documentation says
  if (t.supportKey && !tree.support.some((v) => !Number.isNaN(v))) tree.support.set(supportFrom(tree, t.supportKey));
  return { tree, fasta: fa === null ? null : parseFasta(fa.text), bytes };
}

/** A tree file of one's own (Newick or NEXUS by content, gzipped or not), parsed in a worker. */
export async function loadFile(file: File, o: LoadOptions = {}): Promise<Loaded> {
  const { tree } = await parseInWorker(file, o);
  return { tree, fasta: null, bytes: file.size };
}
