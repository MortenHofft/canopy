// Moving a TreeModel from a worker to the page (#4), and the job the parse worker runs (parse-worker.ts, used through worker.ts).
//
// packTree hands the model's typed arrays over as transferable buffers (no copy) and its labels in chunks, which the worker posts as
// messages of their own: a message is read (deserialized) on the page in one task, and millions of labels in one message took 0.4 to
// 0.9 s there (headless Chromium, 4.7M labels; one joined string of them was as slow once it held a character beyond Latin-1), while a
// chunk of 32,768 takes a few milliseconds. unpackTree builds the TreeModel from the arrays and the labels without deriving anything
// again. runParse is the worker's side: read the input (bytes, gzip by content, text), parse it, post the labels and the packed tree.
// Everything here also runs in Node, so the protocol is tested without a worker.

import { Annotations, type AnnotationRecord } from './annotations.ts';
import { parseNewick, parseNexus, type NexusResult, type ParseOptions } from './newick.ts';
import { TreeModel, type ParserWarning } from './tree.ts';

/** A tree file to parse: its text, its bytes (UTF-8, gzipped or not: told by content) or a Blob / File. */
export type ParseInput = string | ArrayBuffer | Uint8Array | Blob;

/** Newick or NEXUS. Left out: NEXUS when the text starts with `#NEXUS`, otherwise Newick. */
export type TreeFormat = 'newick' | 'nexus';

/** What a NEXUS parse says besides the tree (`NexusResult` without `tree`). */
export type NexusInfo = Omit<NexusResult, 'tree'>;

/** A step of a parse in a worker. `labels` is the last one, with how many of `total` labels have reached the page. */
export type ParsePhase = 'read' | 'inflate' | 'decode' | 'parse' | 'pack' | 'labels';
export interface ParseProgress {
  phase: ParsePhase;
  done?: number;
  total?: number;
}

/** What the page sends the worker. */
export interface ParseRequest {
  input: ParseInput;
  format?: TreeFormat;
  options?: ParseOptions & { treeIndex?: number };
}

/** A TreeModel as it crosses threads. The typed arrays are moved, not copied: the packed model's arrays are detached once posted. */
export interface PackedTree {
  nodeCount: number;
  tipCount: number;
  int32: Record<(typeof INT32)[number], Int32Array>;
  float64: Record<(typeof FLOAT64)[number], Float64Array>;
  hasLengths: boolean;
  maxDepth: number;
  maxCumLength: number;
  warnings: ParserWarning[];
  annotations: { nodeCount: number; node: Map<number, AnnotationRecord>; edge: Map<number, AnnotationRecord> } | null;
}

/** What the worker sends back: progress, the labels in preorder from node `from` on (of `total`), then the tree; or the error. */
export type WorkerMessage =
  | { type: 'progress'; phase: Exclude<ParsePhase, 'labels'> }
  | { type: 'labels'; from: number; total: number; labels: string[] }
  | { type: 'done'; tree: PackedTree; nexus: NexusInfo | null }
  | { type: 'error'; name: string; message: string; position?: number };

const INT32 = [
  'parent',
  'subtreeEnd',
  'depth',
  'leafStart',
  'leafEnd',
  'firstChild',
  'nextSibling',
  'childCount',
  'tipNode',
  'tipRank',
  'heights',
] as const;
const FLOAT64 = ['length', 'support', 'cumLength'] as const;

/** Labels per message (see the header). */
export const LABEL_CHUNK = 32768;

/** The model as a message, the buffers to transfer with it (each once, also when arrays share one) and its labels in chunks of
 *  `chunk`, for messages of their own. Computes `heights()` first, so the page does not. The model must not be used after the
 *  message is posted with these buffers. */
export function packTree(tree: TreeModel, chunk = LABEL_CHUNK): { packed: PackedTree; transfer: ArrayBuffer[]; labels: string[][] } {
  const int32 = {} as PackedTree['int32'];
  const float64 = {} as PackedTree['float64'];
  const buffers = new Set<ArrayBuffer>();
  for (const k of INT32) {
    const a = k === 'heights' ? tree.heights() : tree[k];
    int32[k] = a;
    buffers.add(a.buffer as ArrayBuffer);
  }
  for (const k of FLOAT64) {
    float64[k] = tree[k];
    buffers.add(tree[k].buffer as ArrayBuffer);
  }
  const labels: string[][] = [];
  for (let i = 0; i < tree.nodeCount; i += chunk) labels.push(tree.labels.slice(i, i + chunk));
  const a = tree.annotations;
  const packed: PackedTree = {
    nodeCount: tree.nodeCount,
    tipCount: tree.tipCount,
    int32,
    float64,
    hasLengths: tree.hasLengths,
    maxDepth: tree.maxDepth,
    maxCumLength: tree.maxCumLength,
    warnings: [...tree.warnings],
    annotations: a ? { nodeCount: a.nodeCount, node: a.node, edge: a.edge } : null,
  };
  return { packed, transfer: [...buffers], labels };
}

/** The TreeModel of a packed tree and its labels (all of them, in preorder). */
export function unpackTree(p: PackedTree, labels: string[]): TreeModel {
  if (labels.length !== p.nodeCount) throw new Error(`${labels.length} labels for a tree of ${p.nodeCount} nodes`);
  const { int32, float64 } = p;
  const tipLabels: string[] = new Array(p.tipCount);
  for (let r = 0; r < p.tipCount; r++) tipLabels[r] = labels[int32.tipNode[r]];
  const a = p.annotations;
  return new TreeModel(
    {
      nodeCount: p.nodeCount,
      tipCount: p.tipCount,
      parent: int32.parent,
      subtreeEnd: int32.subtreeEnd,
      depth: int32.depth,
      length: float64.length,
      support: float64.support,
      leafStart: int32.leafStart,
      leafEnd: int32.leafEnd,
      labels,
      annotations: a ? new Annotations(a.nodeCount, bare(a.node), bare(a.edge)) : undefined,
      warnings: p.warnings,
    },
    {
      firstChild: int32.firstChild,
      nextSibling: int32.nextSibling,
      childCount: int32.childCount,
      cumLength: float64.cumLength,
      hasLengths: p.hasLengths,
      maxCumLength: p.maxCumLength,
      maxDepth: p.maxDepth,
      tipNode: int32.tipNode,
      tipRank: int32.tipRank,
      tipLabels,
      heights: int32.heights,
    },
  );
}

/** The records with the null prototype the parser gives them (a structured clone makes them plain objects). */
function bare(m: Map<number, AnnotationRecord>): Map<number, AnnotationRecord> {
  for (const [k, r] of m) m.set(k, Object.assign(Object.create(null) as AnnotationRecord, r));
  return m;
}

/** Text of a tree file, inflating gzip by its magic number. */
async function readText(input: ParseInput, progress: (phase: 'read' | 'inflate' | 'decode') => void): Promise<string> {
  if (typeof input === 'string') return input;
  progress('read');
  const bytes = input instanceof Blob ? new Uint8Array(await input.arrayBuffer()) : input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    progress('inflate');
    return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }
  progress('decode');
  return new TextDecoder().decode(bytes);
}

/** The worker's job: read, parse and post the packed tree (or the error) through `post`. Never throws. */
export async function runParse(req: ParseRequest, post: (m: WorkerMessage, transfer?: ArrayBuffer[]) => void): Promise<void> {
  try {
    const text = await readText(req.input, (phase) => post({ type: 'progress', phase }));
    post({ type: 'progress', phase: 'parse' });
    const nexus = req.format ? req.format === 'nexus' : /^\s*#NEXUS/i.test(text);
    let tree: TreeModel;
    let info: NexusInfo | null = null;
    if (nexus) {
      const { tree: t, ...rest } = parseNexus(text, req.options ?? {});
      tree = t;
      info = rest;
    } else tree = parseNewick(text, req.options);
    post({ type: 'progress', phase: 'pack' });
    const { packed, transfer, labels } = packTree(tree);
    for (let k = 0; k < labels.length; k++) post({ type: 'labels', from: k * LABEL_CHUNK, total: tree.nodeCount, labels: labels[k] });
    post({ type: 'done', tree: packed, nexus: info }, transfer);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const position = (err as { position?: unknown }).position;
    post({ type: 'error', name: err.name, message: err.message, position: typeof position === 'number' ? position : undefined });
  }
}
