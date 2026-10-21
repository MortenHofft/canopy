// Types for the Parquet reader of the experiment (spikes/parquet-experiment/web/reader.js, plain JS), only what ParquetSource uses.
declare module '*/parquet-experiment/web/reader.js' {
  export interface ReaderStats {
    requests: number;
    bytes: number;
    useful: number;
    log: Array<[string, number, number]>;
  }
  export interface Manifest {
    nodes: number;
    tips: number;
    has_lengths: boolean;
    max_depth: number;
    max_cum: number;
    overview: { level_rows: number[]; row_budgets: number[]; tail_start: number };
    rg_node_start: number[];
  }
  export type Cols = Record<string, Int32Array | Float32Array | Float64Array | Uint8Array | BigInt64Array | string[]>;
  export class ParquetTreeSource {
    static open(base: string, opts?: { gap?: number; fetch?: typeof fetch }): Promise<ParquetTreeSource>;
    readonly man: Manifest;
    readonly stats: ReaderStats;
    getOverview(level?: number): Promise<Cols & { levelRows: number[] }>;
    getRange(lo: number, hi: number, columns?: string[]): Promise<Cols>;
    getTips(r0: number, r1: number, columns?: string[]): Promise<Cols>;
  }
}
