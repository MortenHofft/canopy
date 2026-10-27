// The data sources of this example: for each tree, the tip fields (what the Labels column can show) and the data columns, as column specs
// of @canopy/viewer keyed by tip label. Nothing here is TBrowse's: a source decides its own fields and columns, and another source
// (GBIF occurrences, traits) would plug different ones into the same table frame (main.ts).
//
// What is real and what is made up:
//  - the trees, the alignments (FASTA) and the Ensembl members table (species, gene symbol, location) are files from data/: this page's
//    own four (src/trees.json), then every tree of the catalogue the playground uses, or a file of the user's own. A tree without an
//    alignment or a members table has no MSA or gene location column;
//  - the HCV and Open Tree fields are read out of the tip labels;
//  - the Score and Expression values are SAMPLE DATA, generated here from a hash of the tip label, so they are the same on every load.

import { fetchText, loadTreeFile, parseFasta, parseTree, withCatalogue } from '../../shared/data.ts';
import type { TreeModel } from '@canopy/io';
import type { Column, TreeData } from '@canopy/viewer';
import { heatmapRenderer, locusRenderer, TISSUES, type Locus } from './renderers.ts';
import own from './trees.json';

export interface TreeEntry {
  label: string;
  path: string; // under data/
  format: 'newick' | 'nexus';
  /** Where a catalogue tree too large for main lives (shared/data.ts). */
  remote?: string;
  fasta?: string;
  meta?: string; // TSV, first column the tip label (an Ensembl members table; a catalogue tree's TSV is not read here)
  /** How the tip fields are read: from the Ensembl members table, out of the HCV or Open Tree labels; none: the label itself, or the
   *  Open Tree fields when the labels end in an OTT id. */
  source?: 'ensembl' | 'hcv' | 'otl';
}
/** The picker's groups: this page's own trees first (they have the data columns), then the catalogue the playground uses
 *  (examples/shared/catalogue.json), without the catalogue trees that are one of ours. */
const LIST = withCatalogue<TreeEntry>({ 'with data columns': own.trees as Record<string, TreeEntry> });
export const GROUPS = LIST.groups as Record<string, Record<string, TreeEntry>>;
export const TREES = LIST.entries as Record<string, TreeEntry>;
/** The id of the entry shown for an id of the list or the catalogue (?tree=rich-hcv-19 opens our hcv-19), or null. */
export const resolveTree = LIST.resolve;
export const DEFAULT_TREE = 'ens-protein-54';

/** A field of the tips: one value per tip label. The first visible field is the tree's own label (formatLabel); the others are text
 *  columns placed right after the tree, so the Labels column reads as one column of several fields. */
export interface Field {
  id: string;
  name: string;
  values: Record<string, string>;
  /** Shown when the page opens (the user can change it). */
  on: boolean;
  width: number;
}

/** A data column the source offers: its spec for a width (the width is app state, kept by main.ts). */
export interface DataColumn {
  id: string;
  name: string;
  width: number;
  spec(width: number): Column;
}

export interface TableData {
  tree: TreeData;
  fields: Field[];
  columns: DataColumn[];
}

export async function loadTable(id: string): Promise<TableData> {
  const e = TREES[id];
  if (!e) throw new Error(`unknown tree ${JSON.stringify(id)}; known: ${Object.keys(TREES).join(', ')}`);
  const [src, fa, meta] = await Promise.all([
    fetchText(e.path, e.remote),
    e.fasta ? fetchText(e.fasta) : Promise.resolve(null),
    e.source === 'ensembl' && e.meta ? fetchText(e.meta) : Promise.resolve(null),
  ]);
  return tableOf(parseTree(src.text, e.format), e.source, fa?.text ?? null, meta?.text ?? null);
}

/** A tree file of the user's own: the label fields its labels allow and the sample columns, no alignment or gene location. */
export async function loadTableFile(file: File): Promise<TableData> {
  return tableOf((await loadTreeFile(file)).tree, undefined, null, null);
}

/** The fields and columns of a tree: an alignment when there is a FASTA, the gene location with an Ensembl members table, the sample
 *  columns always. */
function tableOf(tree: TreeModel, source: TreeEntry['source'], fasta: string | null, meta: string | null): TableData {
  const tips = tree.tipLabels as readonly string[];
  const columns: DataColumn[] = [];
  if (fasta !== null) {
    const seqs = parseFasta(fasta);
    columns.push({ id: 'msa', name: 'MSA', width: 260, spec: (width) => ({ id: 'msa', kind: 'alignment', header: '', width, values: seqs }) });
  }
  if (source === 'ensembl' && meta !== null) {
    const loci = ensemblLoci(meta);
    columns.push({
      id: 'locus',
      name: 'Gene location',
      width: 140,
      spec: (width) => ({ id: 'locus', kind: 'custom', header: '', width, values: loci, renderer: locusRenderer }),
    });
  }
  const { score, expression } = sampleData(tips);
  columns.push(
    {
      id: 'expression',
      name: 'Expression',
      width: 180,
      spec: (width) => ({ id: 'expression', kind: 'custom', header: '', width, values: expression, renderer: heatmapRenderer }),
    },
    { id: 'score', name: 'Score', width: 90, spec: (width) => ({ id: 'score', kind: 'bar', header: '', width, values: score }) },
  );
  return { tree, fields: fieldsOf(source, tips, meta ?? ''), columns };
}

// ---------------------------------------------------------------- fields per source

function fieldsOf(source: TreeEntry['source'], tips: readonly string[], meta: string): Field[] {
  if (source === 'ensembl') return ensemblFields(tips, meta);
  if (source === 'hcv') return hcvFields(tips);
  if (source === 'otl' || looksOtt(tips)) return otlFields(tips);
  return [field('label', 'Label', true, 0, tips, (t) => t)];
}

/** Most labels end in an OTT id (an Open Tree tree): checked on up to 200 tips. */
function looksOtt(tips: readonly string[]): boolean {
  const some = tips.slice(0, 200);
  return some.length > 0 && some.filter((t) => /_?ott\d+$/.test(t)).length >= some.length / 2;
}

function tsv(text: string): { head: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return { head: (lines[0] ?? '').split('\t'), rows: lines.slice(1).map((l) => l.split('\t')) };
}

function field(id: string, name: string, on: boolean, width: number, tips: readonly string[], f: (tip: string) => string): Field {
  const values: Record<string, string> = {};
  for (const t of tips) values[t] = f(t);
  return { id, name, values, on, width };
}

/** Ensembl: the protein id (the tip label), and from members.tsv the species (strain) and the gene symbol. */
function ensemblFields(tips: readonly string[], meta: string): Field[] {
  const { head, rows } = tsv(meta);
  const col = (k: string) => head.indexOf(k);
  const by = new Map(rows.map((r) => [r[0], r]));
  const get = (tip: string, k: string) => {
    const v = by.get(tip)?.[col(k)] ?? '';
    return v === 'NULL' ? '' : v;
  };
  const species = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return [
    field('protein', 'Protein', true, 0, tips, (t) => t),
    field('species', 'Species', true, 170, tips, (t) => species(get(t, 'species'))),
    field('gene', 'Gene', false, 80, tips, (t) => get(t, 'gene_symbol') || get(t, 'gene_id')),
  ];
}

export function ensemblLoci(meta: string): Record<string, Locus> {
  const { head, rows } = tsv(meta);
  const [ir, is, ie, id] = ['seq_region', 'start', 'end', 'strand'].map((k) => head.indexOf(k));
  const out: Record<string, Locus> = {};
  for (const r of rows) {
    const start = Number(r[is]),
      end = Number(r[ie]);
    if (Number.isFinite(start) && Number.isFinite(end)) out[r[0]] = { region: r[ir], start, end, strand: r[id] === '-1' ? -1 : 1 };
  }
  return out;
}

/** HCV: labels such as 2k1b_Austria_wg_S1_KY883982_2009 or Rag_2k1b_FR-GEO_wg_M21_FJ821465_2007: the country after the genotype, the
 *  GenBank accession and the year, where the label has them (the labels of this file follow several conventions; empty otherwise). */
function hcvFields(tips: readonly string[]): Field[] {
  const parts = (t: string) => t.split(/[_.]/);
  const country = (t: string) => {
    const p = parts(t);
    const after = p[p.indexOf('2k1b') + 1]?.split('-')[0] ?? '';
    return p.includes('2k1b') && /^[A-Z][A-Za-z]+$/.test(after) && after !== 'Subject' ? after : '';
  };
  return [
    field('name', 'Sequence', true, 0, tips, (t) => t),
    field('country', 'Country', true, 70, tips, country),
    field('accession', 'Accession', false, 90, tips, (t) => parts(t).find((p) => /^[A-Z]{1,2}\d{5,6}$/.test(p)) ?? ''),
    field('year', 'Year', true, 50, tips, (t) => parts(t).find((p) => /^(19|20)\d\d$/.test(p)) ?? ''),
  ];
}

/** Open Tree: labels such as Canis_lupus_pallipes_ott47497: the name, the OTT id, and the rank the name's form suggests. */
function otlFields(tips: readonly string[]): Field[] {
  const split = (t: string) => {
    const m = /^(.*?)_?(ott\d+)$/.exec(t);
    return m ? { name: m[1].replace(/_/g, ' '), ott: m[2] } : { name: t.replace(/_/g, ' '), ott: '' };
  };
  const rank = (name: string) => {
    const n = name.split(' ').length;
    return n === 1 ? 'genus or above' : n === 2 ? 'species' : 'below species';
  };
  return [
    field('name', 'Name', true, 0, tips, (t) => split(t).name),
    field('ott', 'OTT id', true, 90, tips, (t) => split(t).ott),
    field('rank', 'Rank', false, 100, tips, (t) => rank(split(t).name)),
  ];
}

// ---------------------------------------------------------------- sample data

/** Score (0 to 100) and expression per tissue (0 to 10), made up from a hash of the tip label: sample data for the numeric and heatmap
 *  columns, the same on every load. */
function sampleData(tips: readonly string[]): { score: Record<string, number>; expression: Record<string, number[]> } {
  const score: Record<string, number> = {};
  const expression: Record<string, number[]> = {};
  for (const t of tips) {
    const rnd = mulberry32(fnv1a(t));
    score[t] = Math.round(rnd() * 1000) / 10;
    const base = rnd() * 6;
    expression[t] = TISSUES.map(() => Math.round(Math.min(10, Math.max(0, base + (rnd() - 0.4) * 6)) * 10) / 10);
  }
  return { score, expression };
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
