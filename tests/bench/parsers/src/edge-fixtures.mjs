// Loads the edge-case fixtures and expands sentinel inputs into their real text.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const edgeDir = resolve(here, '..', 'fixtures', 'edge');

function expand(input) {
  if (input !== 'DEEP_CATERPILLAR_100') return input;
  // 101 tips, caterpillar, non-trivial branch lengths. Not deep enough to stress recursion limits
  // on paper, but it does crash parsers that use native recursion with small stacks.
  let s = 'tip000:0.01';
  for (let i = 1; i <= 100; i++) s = `(${s},tip${String(i).padStart(3, '0')}:0.01):0.01`;
  return s + ';';
}

export function loadEdgeFixtures() {
  const wf = JSON.parse(readFileSync(resolve(edgeDir, 'well-formed.json'), 'utf8'));
  const mf = JSON.parse(readFileSync(resolve(edgeDir, 'malformed.json'), 'utf8'));
  const all = [...wf, ...mf].map((f) => ({ ...f, input: expand(f.input) }));
  return all;
}
