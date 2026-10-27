// Dataset: a tree and its sidecar as Parquet files (see scripts/generate.mjs for how they are written), read over HTTP range requests with
// hyparquet. It knows the layout, not the viewer: the overview pyramid, a range of node rows, tip labels, one column of the sidecar for
// all tips, one row of the sidecar for one tip, and a tip's sequence. ParquetSource and the page are built on it.
//
// What a request costs is decided by the layout: hyparquet reads whole column chunks of the row groups that hold the rows asked for
// (without a page index), so the row group size of a file is the unit of what is fetched and decoded.

import { parquetMetadataAsync, parquetRead, type ColumnData, type FileMetaData } from 'hyparquet';
import { decompress as zstd } from 'fzstd';
import { snappyUncompressor } from 'hysnappy';
import { RangeFile, newStats, type RequestStats } from './rangefile.ts';

export type Col = Int32Array | Float32Array | Float64Array | Uint8Array | BigInt64Array | unknown[];
export type Columns = Record<string, Col>;

export interface SidecarColumn {
  name: string;
  kind: 'category' | 'int' | 'float';
  file: string;
  encoding?: 'code' | 'string';
  /** Category columns: the value of each code. */
  values?: string[];
  /** Category columns: the tips that have each value. */
  counts?: number[];
}

export interface Manifest {
  version: number;
  nodes: number;
  tips: number;
  has_lengths: boolean;
  max_depth: number;
  max_cum: number;
  codec: string;
  rg_rows: number;
  rg_node_start: number[];
  tip_rg_rows: number;
  label_rg_rows: number;
  overview: { row_budgets: number[]; level_rows: number[]; level_min_tips: number[]; tail_start: number };
  files: Record<string, { bytes: number; footer: number; row_groups: number }>;
  sidecar: {
    rows: number;
    layout: 'single' | 'columns';
    columns: SidecarColumn[];
    /** The sequences by tip rank, in one file or in shards of `shard_rows` tips each (the last may hold fewer). */
    sequence: {
      column: string;
      length: number;
      alphabet: string;
      rg_rows: number;
      shard_rows: number;
      files: Array<{ file: string; rows: number }>;
    } | null;
  } | null;
}

export interface DatasetOptions {
  fetch?: typeof fetch;
  /** Requests for ranges that arrive in the same tick and lie less than this many bytes apart become one request. Default 65536. */
  gap?: number;
  /** Before decoding, ask for the byte ranges of all the column chunks a read needs in one go, so that the range file can merge the ones
   *  that lie less than `gap` bytes apart (hyparquet asks for one row group after the other). Default true. */
  plan?: boolean;
  /** The `cache` option of fetch for the range requests. Default 'no-store': see rangefile.ts for why the default mode serialises them. */
  cache?: RequestCache;
}

const compressors = { SNAPPY: snappyUncompressor(), ZSTD: (input: Uint8Array) => zstd(input) };

function newLike(chunk: unknown, n: number): Col {
  const C = (chunk as { constructor: new (n: number) => Col }).constructor;
  return C === Array ? new Array(n) : new C(n);
}

export class Dataset {
  readonly stats: RequestStats = newStats();
  /** One entry per read: file, columns, first row, end row, milliseconds from the call to the decoded rows (network included). */
  readonly reads: Array<[string, string, number, number, number]> = [];
  manifestMs = 0;
  private files = new Map<string, RangeFile>();
  private meta = new Map<string, Promise<FileMetaData>>();
  private overviews = new Map<number, Promise<Columns>>();
  private overviewPrimed: Promise<void> | null = null;
  private readonly fetchImpl: typeof fetch;

  private constructor(
    readonly base: string,
    readonly man: Manifest,
    private readonly opts: DatasetOptions,
  ) {
    this.fetchImpl = opts.fetch ?? ((...a) => globalThis.fetch(...a));
  }

  static async open(base: string, opts: DatasetOptions = {}): Promise<Dataset> {
    base = base.replace(/\/+$/, '');
    const f = opts.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
    const t0 = performance.now();
    const res = await f(`${base}/manifest.json`);
    if (!res.ok) throw new Error(`${base}/manifest.json: HTTP ${res.status}`);
    const text = await res.text();
    const man = JSON.parse(text) as Manifest;
    if (man.version !== 2) throw new Error(`manifest version ${man.version}, expected 2`);
    const d = new Dataset(base, man, opts);
    d.manifestMs = performance.now() - t0;
    d.stats.requests++;
    d.stats.bytes += text.length;
    d.stats.useful += text.length;
    d.stats.log.push(['manifest.json', 0, text.length, text.length, d.manifestMs]);
    return d;
  }

  private file(name: string): RangeFile {
    let f = this.files.get(name);
    if (!f) {
      const info = this.man.files[name];
      if (!info) throw new Error(`the manifest has no file ${name}`);
      f = new RangeFile(`${this.base}/${name}`, info.bytes, this.opts.gap ?? 65536, this.fetchImpl, this.stats, this.opts.cache);
      this.files.set(name, f);
    }
    return f;
  }

  private metadata(name: string): Promise<FileMetaData> {
    let m = this.meta.get(name);
    if (!m) {
      m = parquetMetadataAsync(this.file(name), { initialFetchSize: this.man.files[name].footer });
      this.meta.set(name, m);
    }
    return m;
  }

  /** Ask for the byte range of every column chunk that rows [rowStart, rowEnd) of `columns` need, all in the same tick. */
  private async prefetchChunks(file: RangeFile, md: FileMetaData, columns: string[] | undefined, rowStart: number, rowEnd: number): Promise<void> {
    const asks: Promise<void>[] = [];
    let start = 0;
    for (const rg of md.row_groups) {
      const n = Number(rg.num_rows);
      if (start + n > rowStart && start < rowEnd) {
        for (const c of rg.columns) {
          const m = c.meta_data!;
          if (columns && !columns.includes(m.path_in_schema[0])) continue;
          const s = Number(m.dictionary_page_offset || m.data_page_offset);
          asks.push(file.prefetch(s, s + Number(m.total_compressed_size)));
        }
      }
      start += n;
    }
    await Promise.all(asks);
  }

  /** Rows [rowStart, rowEnd) of `columns` of a file as one array per column. */
  private async read(name: string, columns: string[] | undefined, rowStart: number, rowEnd: number): Promise<Columns> {
    const t0 = performance.now();
    const file = this.file(name);
    const metadata = await this.metadata(name);
    if (this.opts.plan !== false) await this.prefetchChunks(file, metadata, columns, rowStart, rowEnd);
    const chunks: ColumnData[] = [];
    await parquetRead({ file, metadata, compressors, columns, rowStart, rowEnd, onChunk: (c) => chunks.push(c) });
    const n = rowEnd - rowStart;
    const out: Columns = {};
    for (const c of chunks) {
      const lo = Math.max(c.rowStart, rowStart);
      const hi = Math.min(c.rowEnd, rowEnd);
      if (hi <= lo) continue;
      const a = (out[c.columnName] ??= newLike(c.columnData, n));
      const src = c.columnData as ArrayLike<unknown> & { subarray?: (a: number, b: number) => ArrayLike<unknown> };
      if (src.subarray && (a as { set?: unknown }).set)
        (a as Int32Array).set(src.subarray(lo - c.rowStart, hi - c.rowStart) as ArrayLike<number>, lo - rowStart);
      else for (let i = lo; i < hi; i++) (a as unknown[])[i - rowStart] = src[i - c.rowStart];
    }
    this.reads.push([name, columns ? columns.join(',') : '*', rowStart, rowEnd, performance.now() - t0]);
    return out;
  }

  // ------------------------------------------------------------------ the tree

  /** Overview rows of levels 0..level as arrays (the rows of the levels one after the other, level 0 first). Level 0 plus the footer is one request. */
  overview(level = 0): Promise<Columns & { levelRows?: never }> {
    const ov = this.man.overview;
    const nl = ov.level_rows.length;
    level = Math.min(level, nl - 1);
    let p = this.overviews.get(level);
    if (!p) {
      p = (async () => {
        const file = this.file('overview.parquet');
        this.overviewPrimed ??= file.prefetch(ov.tail_start, file.byteLength);
        await this.overviewPrimed;
        const parts: Promise<Columns>[] = [];
        for (let l = 0; l <= level; l++) {
          let start = 0; // the file holds the deepest level first
          for (let k = l + 1; k < nl; k++) start += ov.level_rows[k];
          parts.push(this.read('overview.parquet', undefined, start, start + ov.level_rows[l]));
        }
        const got = await Promise.all(parts);
        const total = got.reduce((a, g) => a + (g.node as Int32Array).length, 0);
        const res: Columns = {};
        for (const name of Object.keys(got[0])) {
          const A = newLike(got[0][name], total) as unknown as { set?: (x: unknown, o: number) => void } & unknown[];
          let o = 0;
          for (const g of got) {
            if (A.set) A.set(g[name], o);
            else (g[name] as unknown[]).forEach((v, i) => (A[o + i] = v));
            o += (g[name] as ArrayLike<unknown>).length;
          }
          res[name] = A as unknown as Col;
        }
        return res;
      })();
      this.overviews.set(level, p);
    }
    return p as Promise<Columns & { levelRows?: never }>;
  }

  /** Node rows [lo, hi) of the preorder table: a clade is [i, subtree_end[i]). */
  nodes(lo: number, hi: number): Promise<Columns> {
    return this.read(
      'nodes.parquet',
      ['parent', 'subtree_end', 'leaf_start', 'tip_count', 'len', 'cum_len', 'max_cum', 'depth', 'max_depth'],
      lo,
      hi,
    );
  }

  /** Labels of the tips of rank [r0, r1). */
  async tipLabels(r0: number, r1: number): Promise<string[]> {
    const c = await this.read('tips.parquet', ['tip_label'], r0, r1);
    return Array.from(c.tip_label as string[]);
  }

  // ------------------------------------------------------------------ the sidecar

  get sidecarColumns(): SidecarColumn[] {
    return this.man.sidecar?.columns ?? [];
  }
  private column(name: string): SidecarColumn {
    const c = this.sidecarColumns.find((x) => x.name === name);
    if (!c) throw new Error(`the sidecar has no column ${name}`);
    return c;
  }

  /** One category column for the tips [r0, r1) (default all) as codes: an index into the column's `values`. */
  async categoryColumn(name: string, r0 = 0, r1 = this.man.tips): Promise<Int32Array> {
    const c = this.column(name);
    if (c.kind !== 'category') throw new Error(`${name} is not a category column`);
    const raw = (await this.read(c.file, [name], r0, r1))[name];
    if (c.encoding !== 'string') return raw as Int32Array;
    const code = new Map(c.values!.map((v, i) => [v, i]));
    const strings = raw as string[];
    const out = new Int32Array(strings.length);
    for (let i = 0; i < out.length; i++) out[i] = code.get(strings[i]) ?? -1;
    return out;
  }

  /** One numeric column for the tips [r0, r1) (default all). */
  async numberColumn(name: string, r0 = 0, r1 = this.man.tips): Promise<Int32Array | Float32Array> {
    const c = this.column(name);
    if (c.kind === 'category') throw new Error(`${name} is a category column`);
    return (await this.read(c.file, [name], r0, r1))[name] as Int32Array | Float32Array;
  }

  /** All the small columns of one tip: category values as text, numbers as numbers. Reads the row group of the tip (of each file the columns are in). */
  async sidecarRow(rank: number): Promise<Record<string, string | number>> {
    const sc = this.man.sidecar;
    if (!sc) return {};
    const g = this.man.tip_rg_rows;
    const r0 = Math.floor(rank / g) * g;
    const r1 = Math.min(this.man.tips, r0 + g);
    const byFile = new Map<string, string[]>();
    for (const c of sc.columns) byFile.set(c.file, [...(byFile.get(c.file) ?? []), c.name]);
    const parts = await Promise.all([...byFile].map(([file, names]) => this.read(file, names, r0, r1)));
    const cols = Object.assign({}, ...parts) as Columns;
    const out: Record<string, string | number> = {};
    for (const c of sc.columns) {
      const v = (cols[c.name] as ArrayLike<unknown>)[rank - r0];
      out[c.name] = c.kind === 'category' && c.encoding !== 'string' ? c.values![v as number] : (v as string | number);
    }
    return out;
  }

  /** The sequence of one tip, or null when the dataset has none. Reads the row group of the sequence file (shard) that holds it. */
  async sequence(rank: number): Promise<string | null> {
    const s = this.man.sidecar?.sequence;
    if (!s) return null;
    const shard = Math.floor(rank / s.shard_rows);
    const f = s.files[shard];
    const local = rank - shard * s.shard_rows;
    const r0 = Math.floor(local / s.rg_rows) * s.rg_rows;
    const r1 = Math.min(f.rows, r0 + s.rg_rows);
    return (await this.read(f.file, [s.column], r0, r1))[s.column][local - r0] as string;
  }
}
