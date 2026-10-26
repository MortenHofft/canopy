// Child-process worker. Reads { parserId, fixtureId, iterations } from argv[2] as JSON,
// writes the result as a single JSON line to stdout and exits.
//
// A synchronous parse call cannot be interrupted from the parent, so the parent kills us if we
// take too long. The parent then marks the pair as SLOW.

import { performance } from 'node:perf_hooks';
import { PARSERS } from './parsers.mjs';
import { BENCH_FIXTURES, loadFixture } from './fixtures.mjs';

const req = JSON.parse(process.argv[2]);
const parser = PARSERS[req.parserId];
const fixture = BENCH_FIXTURES.find((f) => f.id === req.fixtureId);
if (!parser || !fixture) {
  process.stdout.write(JSON.stringify({ error: 'unknown parser or fixture' }) + '\n');
  process.exit(1);
}

const text = loadFixture(fixture);

// Warmup, untimed
try {
  parser.parse(text, fixture.kind);
} catch (e) {
  process.stdout.write(JSON.stringify({ error: (e instanceof Error ? e.message : String(e)).slice(0, 120) }) + '\n');
  process.exit(0);
}

const times = [];
let tipCount = -1;
for (let i = 0; i < req.iterations; i++) {
  const t0 = performance.now();
  try {
    const r = parser.parse(text, fixture.kind);
    tipCount = r.tipCount;
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: (e instanceof Error ? e.message : String(e)).slice(0, 120) }) + '\n');
    process.exit(0);
  }
  times.push(performance.now() - t0);
}

const mem = process.memoryUsage();
process.stdout.write(JSON.stringify({ times, tipCount, heapUsed: mem.heapUsed, rss: mem.rss }) + '\n');
process.exit(0);
