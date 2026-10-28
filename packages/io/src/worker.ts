// @canopy/io/worker: parse a tree file in a Web Worker (#4), so a page stays responsive while a large tree loads. The worker reads the
// input (gzip is inflated there), parses it and builds the TreeModel's arrays; they come back as transferred buffers, the labels in
// messages small enough to be read in a few milliseconds each (transfer.ts). A separate entry point: an app that does not use it does
// not bundle the worker.
//
// Bundling: the worker is started with `new Worker(new URL('./parse-worker.js', import.meta.url), { type: 'module' })`, the pattern
// Vite, webpack 5, Parcel and Rollup with a worker plugin recognise and bundle as a worker of its own. A bundler that does not (esbuild),
// or an app that hosts the file itself, passes `worker`: a function that returns a Worker running `@canopy/io/parse-worker`'s code.

import { NewickError } from './newick.ts';
import {
  unpackTree,
  type NexusInfo,
  type ParseInput,
  type ParseProgress,
  type ParseRequest,
  type TreeFormat,
  type WorkerMessage,
} from './transfer.ts';
import type { ParseOptions } from './newick.ts';
import type { TreeModel } from './tree.ts';

export type { NexusInfo, ParseInput, ParsePhase, ParseProgress, TreeFormat } from './transfer.ts';

export interface WorkerParseOptions extends ParseOptions {
  /** Newick or NEXUS; left out, NEXUS when the text starts with `#NEXUS`. */
  format?: TreeFormat;
  /** NEXUS: which tree of the file (default 0). */
  treeIndex?: number;
  /** Abort: the worker is terminated at once and the promise rejects with the signal's reason. */
  signal?: AbortSignal;
  /** Called at each step: read, inflate or decode, parse, pack (in the worker), then labels with `done` of `total` as they arrive. */
  onProgress?: (p: ParseProgress) => void;
  /** The worker to run the parse in, for a bundler that does not handle `new URL(..., import.meta.url)` workers. One per call; it is
   *  terminated when the parse ends. Default: `createParseWorker`. */
  worker?: () => Worker;
}

export interface WorkerParseResult {
  tree: TreeModel;
  /** What a NEXUS file says besides the tree; null for Newick. */
  nexus: NexusInfo | null;
}

/** A new parse worker, from this package's own file. */
export function createParseWorker(): Worker {
  return new Worker(new URL('./parse-worker.ts', import.meta.url), { type: 'module' });
}

/** Parse `input` in a worker. An ArrayBuffer or Uint8Array is transferred to it: its buffer is detached afterwards. The result is the
 *  TreeModel `parseNewick` / `parseNexus` would give, warnings and annotations included; a parse error rejects with the same error
 *  (a NewickError with its position). */
export function parseInWorker(input: ParseInput, o: WorkerParseOptions = {}): Promise<WorkerParseResult> {
  const { format, treeIndex, signal, onProgress, worker: make = createParseWorker, ...options } = o;
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise<WorkerParseResult>((resolve, reject) => {
    const worker = make();
    const end = () => {
      worker.terminate();
      signal?.removeEventListener('abort', abort);
    };
    const fail = (e: unknown) => {
      end();
      reject(e);
    };
    const abort = () => fail(signal!.reason);
    signal?.addEventListener('abort', abort);
    worker.onerror = (e) => {
      e.preventDefault();
      fail(new Error(`parse worker failed: ${e.message || 'it could not be started'}`));
    };
    let labels: string[] = [];
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      if (m.type === 'progress') onProgress?.({ phase: m.phase });
      else if (m.type === 'labels') {
        for (let k = 0; k < m.labels.length; k++) labels[m.from + k] = m.labels[k];
        onProgress?.({ phase: 'labels', done: m.from + m.labels.length, total: m.total });
      } else if (m.type === 'error') fail(errorOf(m));
      else {
        end();
        try {
          resolve({ tree: unpackTree(m.tree, labels), nexus: m.nexus });
        } catch (x) {
          reject(x);
        }
        labels = [];
      }
    };
    const req: ParseRequest = { input, format, options: { ...options, treeIndex } };
    const buffer = input instanceof ArrayBuffer ? input : input instanceof Uint8Array ? input.buffer : null;
    worker.postMessage(req, buffer ? [buffer as ArrayBuffer] : []);
  });
}

/** The error the worker reported, as the parser threw it: a NewickError keeps its class and position. */
function errorOf(m: Extract<WorkerMessage, { type: 'error' }>): Error {
  const e = m.name === 'NewickError' && m.position !== undefined ? new NewickError('', m.position) : new Error();
  e.message = m.message;
  if (!(e instanceof NewickError)) e.name = m.name;
  return e;
}
