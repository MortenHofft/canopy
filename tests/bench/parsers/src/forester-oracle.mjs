// Cross-check every edge fixture against Forester (Java, GPL-3) and classify disagreements.
//
// Forester is one of the Java libraries the GBIF backend uses for tree validation, so it's a
// relevant reference point. The oracle is a sibling of src/oracle.mjs (which uses DendroPy as
// the Python reference). We never link Forester into Canopy; it runs as an external process
// and we compare verdicts.
//
// Prereq: `javac -cp $FORESTER_JAR -d build src/ForesterOracle.java` (FORESTER_JAR defaults to
//          /home/user/cmzmasek/forester/forester/java/forester.jar) has already produced `build/ForesterOracle.class`.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { PARSERS } from './parsers.mjs';
import { loadEdgeFixtures } from './edge-fixtures.mjs';

const COLORS = { reset: '\x1b[0m', dim: '\x1b[2m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m' };

const FORESTER_JAR = process.env.FORESTER_JAR ?? '/home/user/cmzmasek/forester/forester/java/forester.jar';
const BUILD_DIR = 'build';

function sameLabels(a, b) {
  if (a == null || b == null) return true;
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
}

function runOurs(parser, fixture) {
  if (fixture.kind === 'nexus' && !parser.nexus) return { verdict: 'skip' };
  try {
    const r = parser.parse(fixture.input, fixture.kind);
    if (!r || typeof r.tipCount !== 'number') return { verdict: 'crash', note: 'empty' };
    return { verdict: 'parsed', tipCount: r.tipCount, tipLabels: r.tipLabels };
  } catch (e) {
    if (e instanceof Error) return { verdict: 'error', note: e.message.slice(0, 80) };
    return { verdict: 'crash', note: String(e).slice(0, 80) };
  }
}

async function runForester(fixtures) {
  if (!existsSync(`${BUILD_DIR}/ForesterOracle.class`) || !existsSync(FORESTER_JAR)) {
    throw new Error(`ForesterOracle not compiled or forester.jar missing. Run:\n  javac -cp ${FORESTER_JAR} -d ${BUILD_DIR} src/ForesterOracle.java`);
  }
  return new Promise((resolve, reject) => {
    const child = spawn('java', ['-cp', `${BUILD_DIR}:${FORESTER_JAR}`, 'ForesterOracle'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (b) => {
      out += b.toString();
    });
    child.stderr.on('data', (b) => {
      err += b.toString();
    });
    child.on('close', (code) => {
      if (code !== 0 && !out) return reject(new Error(`forester exited ${code}: ${err.slice(0, 300)}`));
      const results = {};
      for (const line of out.split('\n')) {
        const s = line.trim();
        if (!s || !s.startsWith('{')) continue;
        try {
          const r = JSON.parse(s);
          results[r.id] = r;
        } catch {
          console.error('bad oracle line:', s.slice(0, 80));
        }
      }
      resolve(results);
    });
    for (const f of fixtures) {
      child.stdin.write(JSON.stringify({ id: f.id, kind: f.kind, input: f.input, wellFormed: f.wellFormed }) + '\n');
    }
    child.stdin.end();
  });
}

function verdictOf(fixture, r) {
  if (r.verdict === 'skip') return 'skip';
  if (r.verdict === 'error') return 'error';
  if (r.verdict === 'crash') return 'crash';
  if (!fixture.wellFormed) return 'wrong';
  if (typeof fixture.tipCount === 'number' && r.tipCount !== fixture.tipCount) return 'wrong';
  if (fixture.tipLabels != null && !sameLabels(r.tipLabels, fixture.tipLabels)) return 'wrong';
  return 'ok';
}

const SHORT = { ok: 'ok  ', wrong: 'WRNG', error: 'err ', crash: 'CRSH', skip: 'skip' };
const COLOR_BY_VERDICT = { ok: 'green', wrong: 'yellow', error: 'dim', crash: 'red', skip: 'dim' };
function paint(v) {
  return `${COLORS[COLOR_BY_VERDICT[v]]}${SHORT[v]}${COLORS.reset}`;
}

async function main() {
  const fixtures = loadEdgeFixtures();
  console.log(`${COLORS.cyan}Running Forester (Java) on ${fixtures.length} edge fixtures...${COLORS.reset}`);
  let forester;
  try {
    forester = await runForester(fixtures);
  } catch (e) {
    console.error(`Forester oracle failed: ${e.message}`);
    process.exit(1);
  }

  const idWidth = Math.max(...fixtures.map((f) => f.id.length));
  const colWidth = 15;
  const header =
    'FIXTURE'.padEnd(idWidth) + '  ' + 'Forester'.padStart(colWidth) + '  ' + 'canopy/io'.padStart(colWidth) + '  ' + 'AGREE'.padStart(colWidth);
  console.log(header);
  console.log('-'.repeat(header.length));

  let foresterCorrect = 0;
  let oursCorrect = 0;
  let agree = 0;
  const disagreements = [];

  for (const f of fixtures) {
    const fr = forester[f.id] ?? { verdict: 'crash', note: 'no result' };
    const fv = verdictOf(f, fr);
    const or = runOurs(PARSERS.ours, f);
    const ov = verdictOf(f, or);

    const expected = f.wellFormed ? 'ok' : 'error';
    if (fv === expected) foresterCorrect++;
    if (ov === expected) oursCorrect++;

    // "Same verdict family" = both parse or both reject (regardless of specific tip count match).
    const fam = (v) => (v === 'ok' || v === 'wrong' ? 'parsed' : v === 'skip' ? 'skip' : 'rejected');
    const ag = fam(fv) === fam(ov) || fv === 'skip' || ov === 'skip';
    if (ag) agree++;
    else disagreements.push({ f, fr, or, fv, ov });

    const agreeCol = ag ? COLORS.dim + '  ·' : COLORS.yellow + 'diff';
    console.log(`${f.id.padEnd(idWidth)}  ${paint(fv).padStart(colWidth + 11)}  ${paint(ov).padStart(colWidth + 11)}  ${agreeCol}${COLORS.reset}`);
  }

  console.log('');
  console.log(`${COLORS.cyan}Agreement${COLORS.reset}`);
  console.log(`  Forester-vs-ours same verdict family: ${agree}/${fixtures.length}`);
  console.log('');
  console.log(`${COLORS.cyan}Correctness vs fixture expectations${COLORS.reset}`);
  console.log(`  Forester           ${foresterCorrect}/${fixtures.length}`);
  console.log(`  canopy/io      ${oursCorrect}/${fixtures.length}`);

  console.log('');
  console.log(`${COLORS.cyan}Where Forester and canopy/io disagree${COLORS.reset}`);
  for (const d of disagreements) {
    const frDesc = d.fr.verdict === 'parsed' ? `${d.fr.tipCount}t` : (d.fr.note ?? '').slice(0, 70);
    const orDesc = d.or.verdict === 'parsed' ? `${d.or.tipCount}t` : (d.or.note ?? '').slice(0, 70);
    console.log(`  ${d.f.id.padEnd(idWidth)}  Forester=${d.fv} (${frDesc})  ours=${d.ov} (${orDesc})`);
  }
  if (disagreements.length === 0) console.log(`  ${COLORS.dim}(none — perfect agreement)${COLORS.reset}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
