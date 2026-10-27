// Writing Parquet files with hyparquet-writer: one file, row group by row group, streamed to disk (a 1 GB file never sits in memory).
// Column helpers fix the encodings the reader wants (REQUIRED columns, so hyparquet returns typed arrays, and the encodings of the
// research experiment: delta for integers that grow, byte-stream-split for floats).

import fs from 'node:fs';
import zlib from 'node:zlib';
import { asyncBufferFromFile, parquetMetadataAsync } from 'hyparquet';
import { ParquetWriter, schemaFromColumnData, fileWriter } from 'hyparquet-writer';

/** The codec to use for `wanted`: zstd needs Node 22.15 (zlib.zstdCompressSync); without it, snappy (built into the writer). */
export function pickCodec(wanted) {
  if (wanted === 'zstd' && typeof zlib.zstdCompressSync !== 'function') return 'snappy';
  return wanted;
}
const CODEC = { zstd: 'ZSTD', snappy: 'SNAPPY', none: 'UNCOMPRESSED' };

/** INT32 column. `delta`: DELTA_BINARY_PACKED (for values close to their neighbours); else PLAIN, which hyparquet returns as an Int32Array. */
export const int32 = (name, data, delta = false) => ({
  name,
  data,
  type: 'INT32',
  nullable: false,
  encoding: delta ? 'DELTA_BINARY_PACKED' : 'PLAIN',
});
/** FLOAT (32 bit) column, BYTE_STREAM_SPLIT. */
export const float32 = (name, data) => ({ name, data: Float32Array.from(data), type: 'FLOAT', nullable: false, encoding: 'BYTE_STREAM_SPLIT' });
/** DOUBLE column, BYTE_STREAM_SPLIT. */
export const float64 = (name, data) => ({ name, data, type: 'DOUBLE', nullable: false, encoding: 'BYTE_STREAM_SPLIT' });
/** STRING column. `dictionary`: let the writer choose a dictionary (good for few distinct values); else PLAIN (labels, sequences). */
export const string = (name, data, dictionary = false) => ({
  name,
  data,
  type: 'STRING',
  nullable: false,
  ...(dictionary ? {} : { encoding: 'PLAIN' }),
});

export class ParquetOut {
  /** @param {string} filename @param {'zstd'|'snappy'|'none'} codec */
  constructor(filename, codec) {
    this.filename = filename;
    this.codec = pickCodec(codec);
    this.fw = fileWriter(filename);
    this.w = null;
    this.rows = 0;
    this.groups = 0;
  }
  /** Write one row group: `columns` is an array of the column helpers above, all of the same length. */
  writeGroup(columns) {
    if (!this.w) {
      const compressors =
        this.codec === 'zstd'
          ? { ZSTD: (input) => new Uint8Array(zlib.zstdCompressSync(input, { params: { [zlib.constants.ZSTD_c_compressionLevel]: 3 } })) }
          : {};
      this.w = new ParquetWriter({
        writer: this.fw,
        schema: schemaFromColumnData({ columnData: columns }),
        codec: CODEC[this.codec],
        compressors,
        statistics: true,
      });
    }
    const n = columns[0].data.length;
    this.w.write({ columnData: columns, rowGroupSize: n });
    this.rows += n;
    this.groups++;
  }
  /** Finish the file and read back what the manifest needs: its size, footer size (with the 8 closing bytes) and row groups. */
  async close() {
    this.w.finish();
    const bytes = fs.statSync(this.filename).size;
    const fd = fs.openSync(this.filename, 'r');
    const tail = Buffer.alloc(8);
    fs.readSync(fd, tail, 0, 8, bytes - 8);
    fs.closeSync(fd);
    const footer = tail.readUInt32LE(0) + 8;
    const md = await parquetMetadataAsync(await asyncBufferFromFile(this.filename));
    return { file: this.filename.split('/').pop(), bytes, footer, row_groups: md.row_groups.length, rows: this.rows, metadata: md };
  }
}
