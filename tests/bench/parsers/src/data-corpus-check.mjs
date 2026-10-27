// Run every real/synthetic tree in data/ through our parser and report:
//   - how many trees are "clean" (parseable with no warnings; strict mode also succeeds)
//   - how many warn (parseable in default mode, strict mode would throw)
//   - how many hard-error (don't parse at all)
//
// Every tree is parsed twice (default + strict) and the two outcomes must agree on cleanliness.
// If a tree has zero warnings in default mode but strict throws, that's a bug in our implementation
// and the script fails loudly.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNewick, parseNexus, parsePhyloXml, NewickError } from '@gbif-phylo/io';

const here = resolve(fileURLToPath(import.meta.url), '..');
const DATA = resolve(here, '..', '..', '..', '..', 'data');

function listTreeFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      listTreeFiles(p, out);
      continue;
    }
    const stripGz = entry.replace(/\.gz$/, '');
    if (stripGz.endsWith('.xml') || stripGz.endsWith('.phyloxml')) {
      // XML: phyloXML when it says so (other XML in data/, such as NeXML, is not read)
      if (/<(\w+:)?phyloxml[\s>]/.test(loadText({ path: p }).slice(0, 2000))) out.push({ path: p, kind: 'phyloxml' });
      continue;
    }
    if (stripGz.endsWith('.nwk') || stripGz.endsWith('.nwk.txt')) {
      out.push({ path: p, kind: 'newick' });
    } else if (stripGz.endsWith('.nex') || stripGz.endsWith('.nexus') || stripGz.endsWith('.tree')) {
      out.push({ path: p, kind: 'nexus-or-newick' });
    } else if (stripGz.endsWith('.nhx')) {
      out.push({ path: p, kind: 'newick' });
    }
  }
  return out;
}

function loadText(f) {
  const bytes = readFileSync(f.path);
  return f.path.endsWith('.gz') ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8');
}

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function fmtPath(p) {
  const rel = p.replace(resolve(DATA, '..') + '/', '');
  return rel;
}

function parseOne(f, text) {
  // For .tree files we try NEXUS first then Newick.
  const kinds = f.kind === 'nexus-or-newick' ? ['nexus', 'newick'] : [f.kind];
  let lastErr = null;
  for (const kind of kinds) {
    try {
      const tree = kind === 'nexus' ? parseNexus(text).tree : kind === 'phyloxml' ? parsePhyloXml(text).tree : parseNewick(text);
      return { tree, kind };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function parseStrict(f, text) {
  const kinds = f.kind === 'nexus-or-newick' ? ['nexus', 'newick'] : [f.kind];
  let lastErr = null;
  for (const kind of kinds) {
    try {
      const tree =
        kind === 'nexus'
          ? parseNexus(text, { strict: true }).tree
          : kind === 'phyloxml'
            ? parsePhyloXml(text, { strict: true }).tree
            : parseNewick(text, { strict: true });
      return { tree, kind };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function main() {
  const files = listTreeFiles(DATA);
  console.log(`${C.cyan}Checking ${files.length} tree files in data/ against the new parser rules${C.reset}\n`);

  const clean = [];
  const warn = []; // parsed, has warnings
  const error = []; // doesn't parse

  const strictBugs = []; // default clean but strict throws, or vice versa
  for (const f of files) {
    let text;
    try {
      text = loadText(f);
    } catch (e) {
      error.push({ f, msg: `load failed: ${e.message}` });
      continue;
    }
    try {
      const { tree, kind } = parseOne(f, text);
      // Cross-check: a file with zero warnings in default mode must also parse under strict,
      // and a file with warnings in default mode must throw under strict.
      let strictOk = false;
      try {
        parseStrict(f, text);
        strictOk = true;
      } catch {
        strictOk = false;
      }
      if (tree.warnings.length === 0) {
        clean.push({ f, kind, tipCount: tree.tipCount });
        if (!strictOk) strictBugs.push({ f, note: 'default clean but strict threw' });
      } else {
        warn.push({ f, kind, tipCount: tree.tipCount, warnings: [...tree.warnings] });
        if (strictOk) strictBugs.push({ f, note: `default had warnings but strict passed (codes: ${tree.warnings.map((w) => w.code).join(', ')})` });
      }
    } catch (e) {
      error.push({ f, msg: e instanceof NewickError ? e.message : String(e) });
    }
  }

  // Summary
  console.log(`${C.green}clean (parses, no warnings):${C.reset} ${clean.length}`);
  console.log(`${C.yellow}warn (parses in default, strict would throw):${C.reset} ${warn.length}`);
  console.log(`${C.red}error (fails default parse):${C.reset} ${error.length}`);
  console.log('');

  if (warn.length) {
    console.log(`${C.yellow}Trees with warnings:${C.reset}`);
    // Group by warning-code set
    const byCodes = new Map();
    for (const w of warn) {
      const key = [...new Set(w.warnings.map((x) => x.code))].sort().join(', ');
      if (!byCodes.has(key)) byCodes.set(key, []);
      byCodes.get(key).push(w);
    }
    for (const [codes, group] of [...byCodes.entries()].sort()) {
      console.log(`\n  ${C.cyan}${codes}${C.reset}  (${group.length} file${group.length === 1 ? '' : 's'})`);
      for (const w of group.slice(0, 8)) {
        const sampleWarn = w.warnings[0];
        console.log(`    ${fmtPath(w.f.path).padEnd(70)}  ${w.tipCount}t  ${C.dim}"${sampleWarn.message}" @ ${sampleWarn.position}${C.reset}`);
      }
      if (group.length > 8) console.log(`    ${C.dim}... and ${group.length - 8} more${C.reset}`);
    }
  }

  if (error.length) {
    console.log('');
    console.log(`${C.red}Trees that don't parse at all:${C.reset}`);
    for (const e of error) {
      console.log(`  ${fmtPath(e.f.path).padEnd(70)}  ${C.dim}${e.msg.slice(0, 100)}${C.reset}`);
    }
  }

  if (strictBugs.length) {
    console.log('');
    console.log(`${C.red}Strict/default mode disagreement — bug in the parser:${C.reset}`);
    for (const b of strictBugs) console.log(`  ${fmtPath(b.f.path)}  ${b.note}`);
  }

  console.log('');
  console.log(`${C.cyan}Verdict${C.reset}`);
  if (error.length === 0 && warn.length === 0 && strictBugs.length === 0) {
    console.log('All data/ trees parse cleanly in strict mode.');
  } else if (error.length === 0 && strictBugs.length === 0) {
    console.log(`All data/ trees parse in default mode. ${warn.length} would need fixing to pass strict.`);
  } else if (strictBugs.length) {
    console.log(`${strictBugs.length} strict/default disagreement(s) — investigate.`);
    process.exit(1);
  } else {
    console.log(`${error.length} tree(s) don't parse. Investigate before shipping strict mode as default.`);
  }
}

main();
