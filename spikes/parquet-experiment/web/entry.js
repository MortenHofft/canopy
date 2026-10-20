// Bundle entry for the browser harness: window.PQ = { ParquetTreeSource, baseline, M }.
import { ParquetTreeSource } from './reader.js';
import { baseline } from './baseline.ts';
import * as M from './measure.js';
window.PQ = { ParquetTreeSource, baseline, M };
window.ready = true;
