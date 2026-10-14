// Ground truth: parse the catalogue trees on disk with shared/newick.ts (independent of the page and the candidate).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA_DIR, SPIKES_DIR } from './util.mjs';

// Node prints an ExperimentalWarning when it strips TypeScript types; keep the run log clean.
const origEmit = process.emitWarning;
process.emitWarning = (w, ...a) => (String(w).includes('Type Stripping') ? undefined : origEmit.call(process, w, ...a));

const { parseNewick, parseNexus } = await import(path.join(SPIKES_DIR, 'shared/newick.ts'));
const data = await import(path.join(SPIKES_DIR, 'shared/data.ts'));

export const catalogue = data.catalogue;
export const getEntry = data.getEntry;
export const treesInGroup = data.treesInGroup;

export function readData(rel) {
  const b = fs.readFileSync(path.join(DATA_DIR, rel));
  return (rel.endsWith('.gz') ? zlib.gunzipSync(b) : b).toString('utf8');
}

export function dataExists(rel) {
  return fs.existsSync(path.join(DATA_DIR, rel));
}

const cache = new Map();
/** Parse a catalogue entry. Keeps only the most recent few trees in memory. */
export function truthTree(entry) {
  if (cache.has(entry.id)) return cache.get(entry.id);
  const text = readData(entry.path);
  const tree = entry.format === 'nexus' ? parseNexus(text, entry.treeIndex ?? 0).tree : parseNewick(text);
  if (cache.size >= 3) cache.delete(cache.keys().next().value);
  cache.set(entry.id, tree);
  return tree;
}

/** ColumnSpec[] for an entry, built in Node from the files (same code as the page uses). */
export function truthColumns(entry, tree) {
  if (!entry.columns) return { columns: [], tsvStats: null, fastaStats: null, rowByTip: {} };
  return data.buildColumns(entry, tree, entry.meta ? readData(entry.meta) : null, entry.align ? readData(entry.align) : null);
}

export { parseNewick, parseNexus };
