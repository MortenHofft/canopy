// Thin adapters that normalize each library's parser to a common shape.
//
// Each `parse(text, kind)` either:
//   - returns { tipCount, nodeCount, tipLabels, hasLengths, raw } on success,
//   - throws Error on a clean parse failure.
// A thrown non-Error (lib crashed with a weird value) is caught by callers and reported as 'crash'.
//
// `kind` is 'newick' or 'nexus'. A lib that doesn't support `kind` throws Error('unsupported').

import * as ours from '@gbif-phylo/io';
import * as phylio from '@vibbioinfocore/phylio';
import * as newickJs from 'newick-js';
import * as patristic from 'patristic';

export const PARSERS = {
  ours: {
    name: 'gbif-phylo/io',
    newick: true,
    nexus: true,
    parse(text, kind) {
      if (kind === 'nexus') {
        const r = ours.parseNexus(text);
        const t = r.tree;
        if (!t) throw new Error('no tree in NEXUS');
        return out(t.tipCount, t.nodeCount, t.tipLabels, t.hasLengths, t);
      }
      const t = ours.parseNewick(text);
      return out(t.tipCount, t.nodeCount, t.tipLabels, t.hasLengths, t);
    },
  },

  phylio: {
    name: 'phylio',
    newick: true,
    nexus: true,
    parse(text) {
      const p = phylio.parse(text);
      if (!p || !Array.isArray(p.nodes)) throw new Error('empty phylio result');
      const degree = new Map();
      for (const e of p.edges) degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      const tips = p.nodes.filter((n) => !degree.has(n.ref));
      const labels = tips.map((n) => n.name ?? '').sort();
      const anyLen = p.nodes.some((n) => Number.isFinite(n.branchLength) && n.branchLength !== 0);
      return out(tips.length, p.nodes.length, labels, anyLen, p);
    },
  },

  newickJs: {
    name: 'newick-js',
    newick: true,
    nexus: false,
    parse(text, kind) {
      if (kind !== 'newick') throw new Error('unsupported');
      const r = newickJs.parse(text);
      const vs = r.graph[0];
      const es = r.graph[1];
      const degree = new Map();
      for (const e of es) {
        const parent = e[0];
        degree.set(parent, (degree.get(parent) ?? 0) + 1);
      }
      const tips = [];
      for (const v of vs) if (!degree.has(v)) tips.push(v.label ?? '');
      tips.sort();
      let anyLen = false;
      for (const e of es) if (Number.isFinite(e[2]) && e[2] !== 0) { anyLen = true; break; }
      return out(tips.length, vs.size, tips, anyLen, r);
    },
  },

  patristic: {
    name: 'patristic',
    newick: true,
    nexus: false,
    parse(text, kind) {
      if (kind !== 'newick') throw new Error('unsupported');
      const root = patristic.parseNewick(text);
      let nodeCount = 0;
      let anyLen = false;
      const labels = [];
      const walk = (b) => {
        nodeCount++;
        if (Number.isFinite(b.length) && b.length !== 0) anyLen = true;
        if (!b.children || b.children.length === 0) labels.push(b.id ?? '');
        else for (const c of b.children) walk(c);
      };
      walk(root);
      labels.sort();
      return out(labels.length, nodeCount, labels, anyLen, root);
    },
  },
};

function out(tipCount, nodeCount, tipLabels, hasLengths, raw) {
  return { tipCount, nodeCount, tipLabels, hasLengths, raw };
}

export const PARSER_IDS = Object.keys(PARSERS);
