// Loading shared by the examples that show the repository's trees (the playground and the explorer): the catalogue of trees in data/
// (served at /data/ by the dev server and copied there by the site build), and fetching a file from it (gzip by content, a `remote`
// URL as the fallback), parsing a tree and a FASTA. Not a package: a folder the examples import by relative path.

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
