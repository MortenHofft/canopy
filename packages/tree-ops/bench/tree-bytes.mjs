// Memory of a tree, measured in Node (same V8 as Chromium, but without pointer compression: plain arrays cost 8 bytes per element here,
// 4 in Chrome), against the estimate of treeBytes. Per node:
//   parsed  the heap a TreeModel from parseNewick keeps once the file text is dropped (labels included);
//   step    the heap each further tree keeps (ladderise, wrapped in a TreeModel, three kept), which is what an Undo step costs;
//   estimate treeBytes of that TreeModel.
//   npm run bench:bytes -- file.nwk[.gz] ...   (from packages/tree-ops; needs --expose-gc, which the npm script passes)
// Each file is measured in a process of its own: what one tree leaves behind skews the heap figures of the next.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ladderise, treeBytes } from '../src/index.ts';
import { parseNewick, TreeModel } from '@canopy/io'; // fixture: text -> TreeModel

const gc = globalThis.gc;
if (typeof gc !== 'function') throw new Error('run with --expose-gc (npm run bench:bytes)');
const heap = () => {
  gc();
  gc();
  const m = process.memoryUsage();
  return m.heapUsed + m.arrayBuffers;
};
const STEPS = 3;

const files = process.argv.slice(2);
if (files.length > 1) {
  for (const f of files) process.stdout.write(execFileSync(process.execPath, [...process.execArgv, process.argv[1], f]));
} else {
  const f = files[0];
  const buf = fs.readFileSync(f);
  let text = (f.endsWith('.gz') ? zlib.gunzipSync(buf) : buf).toString('utf8');
  const textChars = text.length;
  const before = heap() - textChars; // the text is a one-byte string: about one byte per character
  const tree = parseNewick(text);
  text = null; // the labels are slices of it, so what they keep of it counts as the tree's
  const parsed = heap();
  const steps = [];
  for (let i = 0; i < STEPS; i++) {
    const from = steps.length ? steps[steps.length - 1] : tree;
    steps.push(new TreeModel(ladderise(from, { order: i % 2 ? 'decreasing' : 'increasing' }).tree));
  }
  const after = heap();
  const n = tree.nodeCount;
  const perNode = (b) => +(b / n).toFixed(1);
  console.log(
    JSON.stringify({
      tree: path.basename(f),
      nodes: n,
      tips: tree.tipCount,
      textMB: +(textChars / 1e6).toFixed(1),
      parsedPerNode: perNode(parsed - before),
      stepPerNode: perNode((after - parsed) / STEPS),
      estimatePerNode: perNode(treeBytes(steps[0])),
      estimateMB: +(treeBytes(steps[0]) / 1e6).toFixed(1),
    }),
  );
}
