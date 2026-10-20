// Parquet tree reader over HTTP range requests (hyparquet + hyparquet-compressors, both MIT).
//
//   const src = await ParquetTreeSource.open(baseUrl, { gap: 65536 });
//   const ov  = await src.getOverview(0);        // typed arrays: node, parent, subtree_end, leaf_start, tip_count, len, cum_len, max_cum, depth, max_depth, occ_sum, sel_level
//   const nd  = await src.getRange(lo, hi);      // node rows [lo, hi): typed arrays, preorder
//   const tp  = await src.getTips(r0, r1, ['tip_label','occurrence_count']);   // tip ranks [r0, r1)
//   const pth = await src.getPath(node);         // root -> node ancestors with rollups, from ONE node row group + the spine
//
// Transport: RangeFile = byte cache + in-flight de-duplication + coalescing of requests that arrive in the same tick
// (adjacent or separated by less than `gap` bytes become one HTTP request). No suffix ranges (they are not CORS-safelisted),
// no HEAD: byte lengths and footer sizes come from manifest.json.
import { parquetMetadataAsync, parquetRead } from 'hyparquet';
// Only snappy and zstd are needed, so use the two decoders hyparquet-compressors itself wraps instead of its whole bundle
// (which also carries brotli with a 79 KB dictionary, gzip, lz4). fzstd 0.1.1 (MIT, pure JS), hysnappy 1.1.1 (MIT, wasm inlined).
import { decompress as zstd } from 'fzstd';
import { snappyUncompressor } from 'hysnappy';
const compressors = { SNAPPY: snappyUncompressor(), ZSTD: (input) => zstd(input) };

export class RangeFile {
  constructor(url, byteLength, opts = {}) {
    this.url = url;
    this.byteLength = byteLength;
    this.gap = opts.gap ?? 65536;
    this.fetchImpl = opts.fetch ?? ((...a) => globalThis.fetch(...a));
    this.stats = opts.stats ?? { requests: 0, bytes: 0, useful: 0, log: [] };
    this.blocks = []; // {s, e, buf}
    this.inflight = []; // {s, e, p}
    this.queue = [];
    this.timer = null;
    this.whole = null;
  }
  _find(s, e) {
    for (const b of this.blocks) if (b.s <= s && e <= b.e) return b;
    return null;
  }
  slice(s, e = this.byteLength) {
    if (s < 0) s = this.byteLength + s;
    e = Math.min(e, this.byteLength);
    this.stats.useful += e - s;
    const b = this._find(s, e);
    if (b) return Promise.resolve(b.buf.slice(s - b.s, e - b.s));
    return new Promise((resolve, reject) => {
      this.queue.push({ s, e, resolve, reject });
      if (!this.timer) this.timer = setTimeout(() => this._flush(), 0);
    });
  }
  /** Fetch [s, e) now (one request) and keep it; later slices inside it cost nothing. */
  prefetch(s, e) {
    return this.slice(s, e).then(() => undefined);
  }
  _flush() {
    this.timer = null;
    const q = this.queue;
    this.queue = [];
    const need = [];
    for (const r of q) {
      const b = this._find(r.s, r.e);
      if (b) { r.resolve(b.buf.slice(r.s - b.s, r.e - b.s)); continue; }
      const f = this.inflight.find((x) => x.s <= r.s && r.e <= x.e);
      if (f) { f.p.then(() => r.resolve(this._find(r.s, r.e).buf.slice(r.s - this._find(r.s, r.e).s, r.e - this._find(r.s, r.e).s)), r.reject); continue; }
      need.push(r);
    }
    if (!need.length) return;
    need.sort((a, b) => a.s - b.s || a.e - b.e);
    const groups = [];
    for (const r of need) {
      const g = groups[groups.length - 1];
      if (g && r.s - g.e <= this.gap) { g.e = Math.max(g.e, r.e); g.reqs.push(r); } else groups.push({ s: r.s, e: r.e, reqs: [r] });
    }
    for (const g of groups) {
      const p = this._get(g.s, g.e);
      this.inflight.push({ s: g.s, e: g.e, p });
      p.then((blk) => {
        this.inflight = this.inflight.filter((x) => x.p !== p);
        for (const r of g.reqs) r.resolve(blk.buf.slice(r.s - blk.s, r.e - blk.s));
      }, (err) => {
        this.inflight = this.inflight.filter((x) => x.p !== p);
        for (const r of g.reqs) r.reject(err);
      });
    }
  }
  async _get(s, e) {
    if (this.whole) { const blk = { s: 0, e: this.byteLength, buf: this.whole }; return blk; }
    this.stats.requests++;
    this.stats.log.push([this.url.split('/').pop(), s, e]);
    const res = await this.fetchImpl(this.url, { headers: { Range: `bytes=${s}-${e - 1}` } });
    if (res.status === 200) { // server ignored Range: keep the whole object
      const buf = await res.arrayBuffer();
      this.stats.bytes += buf.byteLength;
      this.whole = buf;
      const blk = { s: 0, e: buf.byteLength, buf };
      this.blocks.push(blk);
      return blk;
    }
    if (res.status !== 206) throw new Error(`range fetch ${this.url} ${s}-${e}: HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    this.stats.bytes += buf.byteLength;
    const blk = { s, e: s + buf.byteLength, buf };
    this.blocks.push(blk);
    return blk;
  }
}

const NODE_COLS = ['parent', 'subtree_end', 'leaf_start', 'tip_count', 'len', 'cum_len', 'max_cum', 'depth', 'max_depth'];

function newLike(chunk, n) {
  const C = chunk.constructor;
  return C === Array ? new Array(n) : new C(n);
}

/** Layout row (y) of every node of a fully loaded clade [lo, lo+n): tips leaf_start + 0.5, internal nodes the midpoint of the rows of
 *  their first and last child (same rule as custom/src/core/layout.ts). The node table does not store `row`; stubs get it from the overview. */
export function layoutRows(nd, lo) {
  const n = nd.parent.length, row = new Float64Array(n), last = new Int32Array(n).fill(-1);
  for (let j = n - 1; j > 0; j--) { const p = nd.parent[j] - lo; if (p >= 0 && last[p] < 0) last[p] = j; }
  for (let j = n - 1; j >= 0; j--) {
    if (nd.subtree_end[j] === lo + j + 1) row[j] = nd.leaf_start[j] + 0.5;
    else row[j] = (row[j + 1] + row[last[j]]) / 2;
  }
  return row;
}

export class ParquetTreeSource {
  static async open(base, opts = {}) {
    const f = opts.fetch ?? ((...a) => globalThis.fetch(...a));
    const stats = { requests: 0, bytes: 0, useful: 0, log: [] };
    const t0 = performance.now();
    stats.requests++; stats.log.push(['manifest.json', 0, 0]);
    const res = await f(base + '/manifest.json');
    const text = await res.text();
    stats.bytes += text.length;
    const man = JSON.parse(text);
    const s = new ParquetTreeSource(base, man, { ...opts, stats, fetch: f });
    s.manifestMs = performance.now() - t0;
    return s;
  }
  constructor(base, man, opts) {
    this.base = base; this.man = man; this.opts = opts; this.stats = opts.stats;
    this.useOffsetIndex = !!opts.useOffsetIndex;
    this.files = {}; this.meta = {};
    this.ovCache = new Map(); // level -> arrays
    this.rgCache = new Map(); // `${file}:${rg}` -> {cols}
    this.decodeMs = 0;
  }
  _file(name) {
    if (!this.files[name]) {
      const info = this.man.files[name];
      this.files[name] = new RangeFile(`${this.base}/${info.file}`, info.bytes, { gap: this.opts.gap, fetch: this.opts.fetch, stats: this.stats });
    }
    return this.files[name];
  }
  async _meta(name) {
    if (!this.meta[name]) {
      this.meta[name] = (async () => {
        const file = this._file(name);
        const info = this.man.files[name];
        const md = await parquetMetadataAsync(file, { initialFetchSize: info.footer });
        if (this.useOffsetIndex) { // pull the whole page-index region in ONE request so the planner never waits on it
          let lo = Infinity;
          for (const rg of md.row_groups) for (const c of rg.columns) if (c.offset_index_offset) lo = Math.min(lo, Number(c.offset_index_offset));
          if (isFinite(lo)) await file.prefetch(lo, file.byteLength - info.footer);
        }
        return md;
      })();
    }
    return this.meta[name];
  }
  async _read(name, columns, rowStart, rowEnd) {
    const file = this._file(name);
    const metadata = await this._meta(name);
    const chunks = [];
    await parquetRead({ file, metadata, compressors, columns, rowStart, rowEnd, useOffsetIndex: this.useOffsetIndex, onChunk: (c) => chunks.push(c) });
    const t0 = performance.now();
    const n = rowEnd - rowStart;
    const out = {};
    for (const c of chunks) {
      const lo = Math.max(c.rowStart, rowStart), hi = Math.min(c.rowEnd, rowEnd);
      if (hi <= lo) continue;
      const a = out[c.columnName] ?? (out[c.columnName] = newLike(c.columnData, n));
      const src = c.columnData;
      if (src.subarray) a.set(src.subarray(lo - c.rowStart, hi - c.rowStart), lo - rowStart);
      else for (let i = lo; i < hi; i++) a[i - rowStart] = src[i - c.rowStart];
    }
    this.decodeMs += performance.now() - t0; // assembly only; parquetRead decode time is measured by the caller
    return out;
  }

  /** Overview pyramid level 0..L (inclusive), typed arrays concatenated; cached. Level 0 plus footer is ONE request. */
  async getOverview(level = 0) {
    const man = this.man, ov = man.overview, nl = ov.level_rows.length;
    level = Math.min(level, nl - 1);
    const key = level;
    if (this.ovCache.has(key)) return this.ovCache.get(key);
    const p = (async () => {
      const file = this._file('overview');
      if (!this._ovPrimed) {
        this._ovPrimed = file.prefetch(ov.tail_start, file.byteLength); // level 0 + footer in one request
      }
      await this._ovPrimed;
      // file order: deepest level first. rows of level l start at sum(rows[k] for k > l)
      const rows = ov.level_rows;
      const parts = [];
      for (let l = 0; l <= level; l++) {
        let start = 0;
        for (let k = l + 1; k < nl; k++) start += rows[k];
        parts.push(this._read('overview', undefined, start, start + rows[l]));
      }
      const got = await Promise.all(parts);
      const total = got.reduce((a, g) => a + g.node.length, 0);
      const res = {};
      for (const name of Object.keys(got[0])) {
        const A = newLike(got[0][name], total);
        let o = 0;
        for (const g of got) { A.set ? A.set(g[name], o) : g[name].forEach((v, i) => (A[o + i] = v)); o += g[name].length; }
        res[name] = A;
      }
      res.levelRows = rows.slice(0, level + 1);
      return res;
    })();
    this.ovCache.set(key, p);
    return p;
  }

  _nodeGroups(lo, hi) {
    const b = this.man.rg_node_start, out = [];
    for (let g = 0; g < b.length - 1; g++) if (b[g + 1] > lo && b[g] < hi) out.push(g);
    return out;
  }
  /** Node rows [lo, hi) of the preorder table (a clade is [i, subtree_end[i])). */
  async getRange(lo, hi, columns = NODE_COLS) {
    const cols = columns.filter((c) => c !== 'name' || this.man.has_names);
    return this._read('nodes', cols, lo, hi);
  }
  /** Tip rows (rank range) with chosen columns of tips.parquet: node, tip_label, occurrence_count, country. */
  async getTips(r0, r1, columns = ['tip_label']) {
    return this._read('tips', columns, r0, r1);
  }
  /** Ancestors of `node` (root first, node last) with their rollups: reads the node's row group (parent column only)
   *  plus the spine file (ancestors that lie before the row group). One extra request for the spine, cached. */
  async getPath(node) {
    const man = this.man, b = man.rg_node_start;
    let g = 0;
    while (b[g + 1] <= node) g++;
    const lo = b[g], hi = b[g + 1];
    const cols = await this._read('nodes', ['parent', 'subtree_end'], lo, hi);
    const chain = [];
    let i = node;
    while (i >= lo) { chain.push(i); if (i === 0) break; i = cols.parent[i - lo]; }
    // ancestors before the group, from the spine
    if (lo > 0 && man.rg_open[g].length) {
      if (!this._spine) this._spine = this._read('spine', undefined, 0, man.spine_nodes.length);
      const sp = await this._spine;
      const idx = new Map(man.spine_nodes.map((n, k) => [n, k]));
      for (const a of man.rg_open[g].slice().reverse()) {
        // an open ancestor is on the path iff it contains `node` (preorder range)
        if (sp.subtree_end[idx.get(a)] > node) chain.push(a);
      }
    }
    return chain.reverse();
  }
}
