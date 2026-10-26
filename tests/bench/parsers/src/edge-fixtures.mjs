// Loads the edge-case fixtures and expands sentinel inputs into their real text.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const edgeDir = resolve(here, '..', 'fixtures', 'edge');

function expand(input) {
  if (input === 'DEEP_CATERPILLAR_100') {
    // 101 tips, caterpillar; stresses parsers with per-level recursion.
    let s = 'tip000:0.01';
    for (let i = 1; i <= 100; i++) s = `(${s},tip${String(i).padStart(3, '0')}:0.01):0.01`;
    return s + ';';
  }
  if (input === 'DEEP_CATERPILLAR_10000') {
    let s = 'T0';
    for (let i = 1; i < 10000; i++) s = `(${s},T${i}:1)`;
    return s + ';';
  }
  return input;
}

export function loadEdgeFixtures() {
  const wf = JSON.parse(readFileSync(resolve(edgeDir, 'well-formed.json'), 'utf8'));
  const mf = JSON.parse(readFileSync(resolve(edgeDir, 'malformed.json'), 'utf8'));
  const br = JSON.parse(readFileSync(resolve(edgeDir, 'borrowed.json'), 'utf8'));
  const bw = JSON.parse(readFileSync(resolve(edgeDir, 'borrowed-wider.json'), 'utf8'));
  const all = [...wf, ...mf, ...br, ...bw].map((f) => ({ ...f, input: expand(f.input) }));
  return all;
}
