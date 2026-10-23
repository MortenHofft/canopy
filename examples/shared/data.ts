// Loading shared by the examples that show the repository's trees (the playground, the explorer, the table view and the unrooted page):
// the catalogue of trees in data/ (served at /data/ by the dev server and copied there by the site build), fetching a file from it (gzip
// by content, a `remote` URL as the fallback), reading a tree file of the user's own, parsing a tree and a FASTA. The tree picker that
// offers both is picker.ts. Not a package: a folder the examples import by relative path.

import { parseNewick, parseNexus, type TreeModel } from '@gbif-phylo/io';
import catalogue from './catalogue.json';

export interface Entry {
  label: string;
  path: string; // under data/
  format: 'newick' | 'nexus';
  meta?: string; // TSV: first column the tip label, the others per-tip values
  fasta?: string;
  /** Where the file lives when it is too large for main (the data/otl-large branch): used when /data/<path> is not there. */
  remote?: string;
  /** Node count (tips and internal nodes) of the tree, for a page that cannot draw every tree (the unrooted page's node limit). */
  nodes?: number;
}

/** Catalogue groups (shown as <optgroup>) of entries by id. In JSON so the site build can copy exactly these files. */
export const GROUPS = catalogue as Record<string, Record<string, Entry>>;
export const ENTRIES: Record<string, Entry> = Object.assign({}, ...Object.values(GROUPS));

export async function fetchText(path: string, remote?: string): Promise<{ text: string; bytes: number }> {
  let r = await fetch(`/data/${path}`);
  if (r.status === 404 && remote) r = await fetch(remote);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return decode(new Uint8Array(await r.arrayBuffer()));
}

/** Text from bytes, inflating gzip by its magic number (a host may already have inflated a .gz sent with Content-Encoding). */
export async function decode(bytes: Uint8Array<ArrayBuffer>): Promise<{ text: string; bytes: number }> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return { text: new TextDecoder().decode(bytes), bytes: bytes.length };
  const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return { text, bytes: bytes.length };
}

/** What the file inputs offer (any file can still be picked): Newick, NEXUS, optionally gzipped. */
export const TREE_FILE_ACCEPT = '.nwk,.newick,.tre,.tree,.nex,.nexus,.txt,.gz';

/** A tree file the user picked: Newick or NEXUS (by content), optionally gzipped. */
export async function loadTreeFile(file: File): Promise<{ tree: TreeModel; bytes: number; parseMs: number }> {
  const src = await decode(new Uint8Array(await file.arrayBuffer()));
  const t0 = performance.now();
  const tree = parseTree(src.text);
  return { tree, bytes: src.bytes, parseMs: performance.now() - t0 };
}

/** A page's own trees (by group) first, then the catalogue's groups, without the catalogue trees that are the same file as one of the
 *  page's own (the page's entry has more, e.g. its data columns). `resolve` maps an id of either list to the id of the entry shown, so a
 *  link with a catalogue id of such a tree still opens it. */
export function withCatalogue<E extends { path: string }>(
  own: Record<string, Record<string, E>>,
): { groups: Record<string, Record<string, E | Entry>>; entries: Record<string, E | Entry>; resolve(id: string): string | null } {
  const ownById: Record<string, E> = Object.assign({}, ...Object.values(own));
  const byPath = new Map(Object.entries(ownById).map(([id, e]) => [e.path, id]));
  const groups: Record<string, Record<string, E | Entry>> = { ...own };
  for (const [group, entries] of Object.entries(GROUPS)) {
    const left = Object.entries(entries).filter(([, e]) => !byPath.has(e.path));
    if (left.length) groups[group] = { ...groups[group], ...Object.fromEntries(left) };
  }
  const all: Record<string, E | Entry> = Object.assign({}, ...Object.values(groups));
  const resolve = (id: string) => (all[id] ? id : ENTRIES[id] ? (byPath.get(ENTRIES[id].path) ?? null) : null);
  return { groups, entries: all, resolve };
}

/** NEXUS when the text says so, otherwise Newick. */
export function parseTree(text: string, format?: 'newick' | 'nexus'): TreeModel {
  const nexus = format ? format === 'nexus' : /^\s*#NEXUS/i.test(text);
  return nexus ? parseNexus(text).tree : parseNewick(text);
}

export function parseFasta(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  let id = '';
  let seq: string[] = [];
  for (const line of src.split(/\r?\n/)) {
    if (line.startsWith('>')) {
      if (id) out[id] = seq.join('');
      id = line.slice(1).trim().split(/\s+/)[0];
      seq = [];
    } else if (id) seq.push(line.trim());
  }
  if (id) out[id] = seq.join('');
  return out;
}
