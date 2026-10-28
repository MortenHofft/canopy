// The parse worker's pure parts (#4): packing a TreeModel for transfer and back, the worker's job (runParse) and parseInWorker driven
// through a fake worker that runs the job in this thread with structuredClone, as postMessage would.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseNewick, parseNexus, NewickError } from '../src/newick.ts';
import { packTree, unpackTree, runParse } from '../src/transfer.ts';
import { parseInWorker } from '../src/worker.ts';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data');
const gz = fs.readFileSync(path.join(DATA, 'synthetic/newick/yule_10000_support.nwk.gz'));
const YULE = zlib.gunzipSync(gz).toString('utf8');
const NEXUS = fs.readFileSync(path.join(DATA, 'synthetic/nexus/mixed_1000.nex'), 'utf8');
const BEAST = "((a:1[&posterior=0.9,rate=1.5],'b é':2)[&posterior=0.75]:0.5,c:1)root;";

const FIELDS = ['nodeCount', 'tipCount', 'hasLengths', 'maxDepth', 'maxCumLength'];
const ARRAYS = [
  'parent',
  'firstChild',
  'nextSibling',
  'childCount',
  'subtreeEnd',
  'depth',
  'length',
  'cumLength',
  'support',
  'leafStart',
  'leafEnd',
  'tipNode',
  'tipRank',
];
/** Every field of `b` equals `a`'s (a is used before it is packed: pass a fresh parse). */
function assertSame(a, b) {
  for (const k of FIELDS) assert.equal(b[k], a[k], k);
  for (const k of ARRAYS) {
    assert.equal(b[k].constructor, a[k].constructor, k);
    assert.deepEqual(b[k], a[k], k);
  }
  assert.deepEqual(b.labels, a.labels);
  assert.deepEqual(b.tipLabels, a.tipLabels);
  assert.deepEqual(b.heights(), a.heights());
  assert.deepEqual(b.warnings, a.warnings);
  assert.deepEqual(b.annotations?.node, a.annotations?.node);
  assert.deepEqual(b.annotations?.edge, a.annotations?.edge);
}
/** What postMessage does: a structured clone, the listed buffers moved. */
const post = (m, transfer = []) => structuredClone(m, { transfer });

/** What the page does with the worker's messages: pack, post (clone and move), join the label chunks, unpack. */
const roundTrip = (tree, chunk) => {
  const { packed, transfer, labels } = packTree(tree, chunk);
  return unpackTree(post(packed, transfer), post(labels).flat());
};

test('packTree / unpackTree: the same model, buffers moved once each, labels in chunks', () => {
  const tree = parseNewick(YULE);
  const { packed, transfer, labels } = packTree(tree, 5000);
  assert.equal(new Set(transfer).size, transfer.length, 'no buffer listed twice');
  assert.ok(transfer.includes(tree.parent.buffer) && transfer.includes(tree.cumLength.buffer) && transfer.includes(tree.heights().buffer));
  assert.deepEqual(
    labels.map((c) => c.length),
    [5000, 5000, 5000, 4999],
  );
  const back = unpackTree(post(packed, transfer), labels.flat());
  assert.equal(tree.parent.length, 0, 'the packed arrays are detached after the transfer');
  assertSame(parseNewick(YULE), back);
  assert.equal(back.tipIndex(back.tipLabels[17]), back.tipNode[17]);
  assert.throws(() => unpackTree(packed, []), /0 labels for a tree of 19999 nodes/);
});

test('packTree / unpackTree: annotations, warnings, empty and non-ASCII labels', () => {
  const back = roundTrip(parseNewick(BEAST, { annotations: true }));
  assertSame(parseNewick(BEAST, { annotations: true }), back);
  assert.equal(back.annotations.node.get(1).posterior, 0.75);
  assert.equal(Object.getPrototypeOf(back.annotations.node.get(1)), null, 'records keep the null prototype of the parser');
  assert.equal(back.labels[3], 'b é');
  const warned = '((a,b),c)'; // no trailing ';': a warning
  const w = roundTrip(parseNewick(warned), 2);
  assert.equal(w.warnings[0].code, parseNewick(warned).warnings[0].code);
  assert.equal(w.labels[0], '');
});

test('runParse: text, gzipped bytes, a Blob, NEXUS; progress first', async () => {
  const run = async (req) => {
    const msgs = [];
    await runParse(req, (m, transfer) => msgs.push(post(m, transfer)));
    return msgs;
  };
  const text = await run({ input: YULE });
  assert.deepEqual(
    text.map((m) => m.phase ?? m.type),
    ['parse', 'pack', 'labels', 'done'],
  );
  assert.deepEqual(text[2], { type: 'labels', from: 0, total: 19999, labels: parseNewick(YULE).labels }, 'the labels of 19,999 nodes in one chunk');
  assertSame(parseNewick(YULE), unpackTree(text.at(-1).tree, text[2].labels));
  const bytes = await run({ input: new Uint8Array(gz) });
  assert.deepEqual(
    bytes.map((m) => m.phase ?? m.type),
    ['read', 'inflate', 'parse', 'pack', 'labels', 'done'],
  );
  assert.equal(bytes.at(-1).tree.tipCount, 10000);
  const blob = await run({ input: new Blob([BEAST]), options: { annotations: true } });
  assert.deepEqual(
    blob.map((m) => m.phase ?? m.type),
    ['read', 'decode', 'parse', 'pack', 'labels', 'done'],
  );
  assert.equal(unpackTree(blob.at(-1).tree, blob.at(-2).labels).annotations.node.get(1).posterior, 0.75);
  const msgs = await run({ input: NEXUS });
  const { tree, ...info } = parseNexus(NEXUS);
  assert.deepEqual(msgs.at(-1).nexus, info);
  assertSame(tree, unpackTree(msgs.at(-1).tree, msgs.at(-2).labels));
  assert.equal((await run({ input: YULE, format: 'nexus' })).at(-1).type, 'error', 'a format given is not second-guessed');
});

test('runParse: a parse error is a message with the name and position', async () => {
  const msgs = [];
  await runParse({ input: '((a,b);' }, (m) => msgs.push(m));
  const e = msgs.at(-1);
  assert.equal(e.type, 'error');
  assert.equal(e.name, 'NewickError');
  assert.equal(typeof e.position, 'number');
});

/** A Worker running runParse in this thread: messages cloned (and buffers moved) both ways, a macrotask apart. */
function fakeWorker(log) {
  const w = {
    onmessage: null,
    onerror: null,
    terminated: false,
    postMessage(req, transfer) {
      const r = post(req, transfer);
      log.push(r);
      setTimeout(() =>
        runParse(r, (m, t) => {
          const data = post(m, t);
          setTimeout(() => !w.terminated && w.onmessage({ data }));
        }),
      );
    },
    terminate() {
      w.terminated = true;
    },
  };
  return w;
}

test('parseInWorker: the tree, the bytes transferred, the worker terminated, progress through to the labels', async () => {
  const log = [];
  let worker;
  const phases = [];
  const bytes = new Uint8Array(gz);
  const { tree, nexus } = await parseInWorker(bytes, {
    worker: () => (worker = fakeWorker(log)),
    onProgress: (p) => phases.at(-1) !== p.phase && phases.push(p.phase) && p.phase === 'labels' && phases.push(`${p.done}/${p.total}`),
  });
  assert.equal(bytes.length, 0, 'the input bytes were transferred');
  assert.ok(worker.terminated);
  assert.equal(nexus, null);
  assertSame(parseNewick(YULE), tree);
  assert.deepEqual(phases, ['read', 'inflate', 'parse', 'pack', 'labels', '19999/19999']);
  const nex = await parseInWorker(NEXUS, { worker: () => fakeWorker([]), treeIndex: 0, strict: false });
  assert.equal(nex.nexus.treeCount, 1);
});

test('parseInWorker: options reach the parser, a parse error is a NewickError', async () => {
  const log = [];
  const t = await parseInWorker(BEAST, { worker: () => fakeWorker(log), annotations: true });
  assert.equal(log[0].options.annotations, true);
  assert.equal(t.tree.annotations.node.get(1).posterior, 0.75);
  const e = await parseInWorker('((a,b);', { worker: () => fakeWorker([]) }).catch((x) => x);
  let expected;
  try {
    parseNewick('((a,b);');
  } catch (x) {
    expected = x;
  }
  assert.ok(e instanceof NewickError);
  assert.equal(e.message, expected.message);
  assert.equal(e.position, expected.position);
  await assert.rejects(parseInWorker('((a,b),c)', { worker: () => fakeWorker([]), strict: true }), NewickError, 'strict reaches the parser');
});

test('parseInWorker: abort terminates the worker and rejects with the reason', async () => {
  let worker;
  const ac = new AbortController();
  const p = parseInWorker(YULE, { worker: () => (worker = fakeWorker([])), signal: ac.signal, onProgress: (x) => x.phase === 'parse' && ac.abort() });
  await assert.rejects(p, (e) => e.name === 'AbortError');
  assert.ok(worker.terminated);
  const done = new AbortController();
  done.abort();
  let made = false;
  await assert.rejects(parseInWorker(YULE, { worker: () => ((made = true), fakeWorker([])), signal: done.signal }), (e) => e.name === 'AbortError');
  assert.equal(made, false, 'an aborted signal starts no worker');
});
