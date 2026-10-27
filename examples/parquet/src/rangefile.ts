// RangeFile: a remote file read with HTTP range requests, as hyparquet's AsyncBuffer ({ byteLength, slice }). On top of fetch it keeps what
// it has downloaded (a later slice inside it costs nothing), shares a request in flight between callers, and merges requests that arrive in
// the same tick and lie less than `gap` bytes apart into one. No suffix ranges (not CORS-safelisted) and no HEAD: the byte length comes from
// the manifest.
//
// The requests are made with cache: 'no-store'. With the default cache mode Chromium takes a lock on the HTTP cache entry of a URL, and every
// range of one Parquet file has the same URL, so the requests of one file run one after the other, however many are in flight (measured:
// 24 range requests of one file finished 155 ms apart on a 150 ms link; with 'no-store' or 'reload' they ran six at a time, see
// docs/design/parquet-sidecar-benchmark.md). This reader keeps what it fetched in memory, so it does not need the browser's cache for that.

export interface RequestStats {
  requests: number;
  bytes: number; // bytes received
  useful: number; // bytes asked for by the reader
  /** One entry per HTTP request: file, first byte, end byte (exclusive), bytes received, milliseconds from send to the last byte. */
  log: Array<[string, number, number, number, number]>;
}
export const newStats = (): RequestStats => ({ requests: 0, bytes: 0, useful: 0, log: [] });

interface Block {
  s: number;
  e: number;
  buf: ArrayBuffer;
}
interface Waiting {
  s: number;
  e: number;
  resolve: (b: ArrayBuffer) => void;
  reject: (e: unknown) => void;
}
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export class RangeFile {
  private blocks: Block[] = [];
  private inflight: Array<{ s: number; e: number; p: Promise<Block> }> = [];
  private queue: Waiting[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private whole: ArrayBuffer | null = null;

  constructor(
    readonly url: string,
    readonly byteLength: number,
    private readonly gap: number,
    private readonly fetchImpl: Fetch,
    readonly stats: RequestStats,
    private readonly cache: RequestCache = 'no-store',
  ) {}

  private find(s: number, e: number): Block | null {
    for (const b of this.blocks) if (b.s <= s && e <= b.e) return b;
    return null;
  }
  private cut(b: Block, s: number, e: number): ArrayBuffer {
    return b.buf.slice(s - b.s, e - b.s);
  }

  slice(s: number, e: number = this.byteLength): Promise<ArrayBuffer> {
    if (s < 0) s = this.byteLength + s;
    e = Math.min(e, this.byteLength);
    this.stats.useful += e - s;
    const b = this.find(s, e);
    if (b) return Promise.resolve(this.cut(b, s, e));
    return new Promise((resolve, reject) => {
      this.queue.push({ s, e, resolve, reject });
      if (!this.timer) this.timer = setTimeout(() => this.flush(), 0);
    });
  }

  /** Fetch [s, e) now (one request) and keep it. */
  prefetch(s: number, e: number): Promise<void> {
    return this.slice(s, e).then(() => undefined);
  }

  private flush(): void {
    this.timer = null;
    const q = this.queue;
    this.queue = [];
    const need: Waiting[] = [];
    for (const r of q) {
      const b = this.find(r.s, r.e);
      if (b) {
        r.resolve(this.cut(b, r.s, r.e));
        continue;
      }
      const f = this.inflight.find((x) => x.s <= r.s && r.e <= x.e);
      if (f) {
        f.p.then((blk) => r.resolve(this.cut(blk, r.s, r.e)), r.reject);
        continue;
      }
      need.push(r);
    }
    if (!need.length) return;
    need.sort((a, b) => a.s - b.s || a.e - b.e);
    const groups: Array<{ s: number; e: number; reqs: Waiting[] }> = [];
    for (const r of need) {
      const g = groups[groups.length - 1];
      if (g && r.s - g.e <= this.gap) {
        g.e = Math.max(g.e, r.e);
        g.reqs.push(r);
      } else groups.push({ s: r.s, e: r.e, reqs: [r] });
    }
    for (const g of groups) {
      const p = this.get(g.s, g.e);
      const entry = { s: g.s, e: g.e, p };
      this.inflight.push(entry);
      const done = () => (this.inflight = this.inflight.filter((x) => x !== entry));
      p.then(
        (blk) => {
          done();
          for (const r of g.reqs) r.resolve(this.cut(blk, r.s, r.e));
        },
        (err) => {
          done();
          for (const r of g.reqs) r.reject(err);
        },
      );
    }
  }

  private async get(s: number, e: number): Promise<Block> {
    if (this.whole) return { s: 0, e: this.byteLength, buf: this.whole };
    this.stats.requests++;
    const t0 = performance.now();
    const res = await this.fetchImpl(this.url, { headers: { Range: `bytes=${s}-${e - 1}` }, cache: this.cache });
    if (res.status === 200) {
      // the server ignored Range: keep the whole object
      const buf = await res.arrayBuffer();
      this.stats.bytes += buf.byteLength;
      this.stats.log.push([this.url.split('/').pop()!, 0, buf.byteLength, buf.byteLength, performance.now() - t0]);
      this.whole = buf;
      const blk = { s: 0, e: buf.byteLength, buf };
      this.blocks.push(blk);
      return blk;
    }
    if (res.status !== 206) throw new Error(`range fetch ${this.url} ${s}-${e}: HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    this.stats.bytes += buf.byteLength;
    this.stats.log.push([this.url.split('/').pop()!, s, e, buf.byteLength, performance.now() - t0]);
    const blk = { s, e: s + buf.byteLength, buf };
    this.blocks.push(blk);
    return blk;
  }
}
