// The generator, the range server and the reader together: a small dataset is written, served with range requests and read back.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generate } from '../scripts/generate.mjs';
import { startServer } from '../scripts/serve.mjs';
import { makeTree } from '../scripts/lib/tree.mjs';
import { Dataset } from '../src/dataset.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbif-phylo-parquet-'));
const TIPS = 3000;
const base = { tips: TIPS, seed: 7, seqLength: 200, rg: 1024, tipRg: 512, seqRg: 100, firstBudget: 64 };
let server;
before(async () => {
  await generate({ ...base, out: path.join(tmp, 'a') });
  server = await startServer({ roots: [tmp] });
});
after(async () => {
  await server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const open = (name) => Dataset.open(`${server.url}/${name}`);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

test('the same parameters give the same files', async () => {
  await generate({ ...base, out: path.join(tmp, 'b') });
  for (const f of fs.readdirSync(path.join(tmp, 'a'))) assert.equal(sha(path.join(tmp, 'a', f)), sha(path.join(tmp, 'b', f)), f);
});

test('the node table is the tree: preorder, subtree ends, tip counts and rollups agree with the arrays', async () => {
  const d = await open('a');
  const t = makeTree(TIPS, 7);
  assert.equal(d.man.nodes, t.n);
  const c = await d.nodes(0, t.n);
  for (const i of [0, 1, 17, 1000, t.n - 1]) {
    assert.equal(c.subtree_end[i], t.end[i]);
    assert.equal(c.leaf_start[i], t.leafStart[i]);
    assert.equal(c.tip_count[i], t.tipCount[i]);
    assert.equal(c.depth[i], t.depth[i]);
  }
  let tipsSeen = 0;
  for (let i = 0; i < t.n; i++) {
    if (i > 0) assert.ok(c.parent[i] < i);
    if (c.subtree_end[i] === i + 1) tipsSeen++;
  }
  assert.equal(tipsSeen, TIPS);
  assert.equal(c.tip_count[0], TIPS);
});

test('a clade is a range of rows: nodes(lo, hi) of a part equals that part of the whole', async () => {
  const d = await open('a');
  const whole = await d.nodes(0, d.man.nodes);
  const part = await d.nodes(1500, 2100); // crosses a row group (1024 rows)
  for (let j = 0; j < 600; j++) assert.equal(part.parent[j], whole.parent[1500 + j]);
});

test('overview level 0: its stubs and tips tile the tip range exactly once', async () => {
  const d = await open('a');
  const o = await d.overview(0);
  const n = o.node.length;
  assert.equal(n, d.man.overview.level_rows[0]);
  const spans = [];
  for (let i = 0; i < n; i++) {
    const internal = o.subtree_end[i] > o.node[i] + 1;
    if (!internal || o.sel_level[i] > 0) spans.push([o.leaf_start[i], o.leaf_start[i] + o.tip_count[i]]); // a tip, or a stub
  }
  spans.sort((a, b) => a[0] - b[0]);
  let at = 0;
  for (const [s, e] of spans) {
    assert.equal(s, at);
    at = e;
  }
  assert.equal(at, TIPS);
});

test('the first view costs the manifest and one range of the overview, not the tree', async () => {
  const d = await open('a');
  await d.overview(0);
  assert.equal(d.stats.requests, 2);
  assert.ok(d.stats.bytes < fs.statSync(path.join(tmp, 'a', 'nodes.parquet')).size);
});

test('the sidecar: a category column has the manifest counts, a row has its values, a sequence its length', async () => {
  const d = await open('a');
  const country = d.sidecarColumns.find((c) => c.name === 'country');
  const codes = await d.categoryColumn('country');
  assert.equal(codes.length, TIPS);
  const counts = new Array(country.values.length).fill(0);
  for (const v of codes) counts[v]++;
  assert.deepEqual(counts, country.counts);
  const row = await d.sidecarRow(1234);
  assert.equal(row.country, country.values[codes[1234]]);
  assert.equal(typeof row.year, 'number');
  assert.ok(row.lat >= -90 && row.lat <= 90);
  const seq = await d.sequence(1234);
  assert.match(seq, /^[ACGT]{200}$/);
  const labels = await d.tipLabels(1230, 1236);
  assert.equal(labels.length, 6);
});

test('the sidecar follows the tree: neighbours share values and sequences more than strangers do', async () => {
  const d = await open('a');
  const codes = await d.categoryColumn('country');
  let same = 0;
  for (let i = 1; i < TIPS; i++) if (codes[i] === codes[i - 1]) same++;
  assert.ok(same / TIPS > 0.5, `neighbours share a country in ${same} of ${TIPS} pairs`);
  const ham = (a, b) => [...a].filter((ch, i) => ch !== b[i]).length;
  let near = 0;
  let far = 0;
  for (let i = 0; i < 40; i++) {
    near += ham(await d.sequence(i * 70), await d.sequence(i * 70 + 1));
    far += ham(await d.sequence(i * 70), await d.sequence(2999 - i * 70));
  }
  assert.ok(near < far, `neighbours differ at ${near} sites, strangers at ${far}`);
});

test('a column read fetches ranges, not the file; a row read fetches one row group', async () => {
  const d = await open('a');
  await d.sidecarRow(10);
  const side = fs.statSync(path.join(tmp, 'a', 'sidecar.parquet')).size;
  const got = d.stats.log.filter((l) => l[0] === 'sidecar.parquet').reduce((a, l) => a + l[3], 0);
  assert.ok(got < side, `${got} of ${side} bytes`);
  const d2 = await open('a');
  await d2.sequence(5);
  const seqBytes = d2.stats.log.filter((l) => l[0] === 'sequence.parquet').reduce((a, l) => a + l[3], 0);
  assert.ok(seqBytes < fs.statSync(path.join(tmp, 'a', 'sequence.parquet')).size / 5, `${seqBytes} bytes for one sequence`);
});

test('the layouts hold the same data: codes or strings, one sidecar file or one per column', async () => {
  const ref = await (await open('a')).categoryColumn('host');
  for (const [name, o] of [
    ['s', { catEncoding: 'string' }],
    ['c', { sidecarFiles: 'columns' }],
  ]) {
    await generate({ ...base, ...o, out: path.join(tmp, name) });
    const d = await open(name);
    assert.deepEqual([...(await d.categoryColumn('host'))], [...ref], name);
    assert.deepEqual(await d.sidecarRow(777), await (await open('a')).sidecarRow(777), name);
  }
  assert.ok(fs.existsSync(path.join(tmp, 'c', 'sidecar_country.parquet')));
});

test('a sharded sequence file reads the same sequences, and each shard has a small footer', async () => {
  await generate({ ...base, seqShard: 1000, out: path.join(tmp, 'sh') });
  const whole = await open('a');
  const d = await open('sh');
  assert.deepEqual(
    d.man.sidecar.sequence.files.map((f) => f.rows),
    [1000, 1000, 1000],
  );
  for (const r of [0, 99, 100, 999, 1000, 1234, 2999]) assert.equal(await d.sequence(r), await whole.sequence(r), `rank ${r}`);
  assert.ok(fs.existsSync(path.join(tmp, 'sh', 'sequence_0002.parquet')));
  assert.equal(d.man.files['sequence.parquet'], undefined);
  await assert.rejects(generate({ ...base, seqShard: 150, out: path.join(tmp, 'bad') }), /multiple/);
});

test('no sequences, no extra categories: the sidecar is just what was asked for', async () => {
  await generate({ tips: 500, seed: 2, categories: 1, numeric: 0, out: path.join(tmp, 'n') });
  const d = await open('n');
  assert.equal(await d.sequence(3), null);
  assert.deepEqual(
    d.sidecarColumns.map((c) => c.name),
    ['country'],
  );
  assert.equal(d.man.files['sequence.parquet'], undefined);
});
