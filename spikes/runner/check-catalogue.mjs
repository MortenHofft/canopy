#!/usr/bin/env node
// Verifies shared/trees.json against the files in data/: every file exists, parses, tip count and hasLengths match.
import { catalogue, truthTree, dataExists, readData } from './lib/truth.mjs';
let bad = 0;
for (const e of catalogue) {
  if (!dataExists(e.path)) {
    console.log(`${e.optional ? 'optional' : 'MISSING '}  ${e.id}  ${e.path}${e.notes ? '  (' + e.notes.slice(0, 60) + ')' : ''}`);
    if (!e.optional) bad++;
    continue;
  }
  try {
    const t = truthTree(e);
    const ok = t.tipCount === e.tips && t.hasLengths === e.hasLengths && new Set(t.tipLabels).size === t.tipCount;
    console.log(`${ok ? 'ok      ' : 'MISMATCH'}  ${e.id.padEnd(26)} tips ${t.tipCount} (catalogue ${e.tips}) lengths ${t.hasLengths} (catalogue ${e.hasLengths})`);
    if (!ok) bad++;
    for (const f of [e.meta, e.align]) if (f && !dataExists(f)) { console.log(`MISSING  ${e.id} meta ${f}`); bad++; }
  } catch (err) {
    console.log(`ERROR    ${e.id}: ${err.message}`);
    bad++;
  }
}
console.log(bad ? `${bad} problem(s)` : `all ${catalogue.length} catalogue entries match the data files`);
process.exit(bad ? 1 : 0);
