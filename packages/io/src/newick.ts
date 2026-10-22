// Iterative, quote-aware Newick parser (no recursion: a 1,000,000-deep caterpillar is fine), a small NEXUS
// reader (TRANSLATE, multi-tree) and a Newick writer. Output is a TreeModel (see tree.ts).
//
// Handled: quoted labels with commas, parentheses and '' escapes; [comments] anywhere (BEAST [&...], NHX
// [&&NHX:...]); internal labels (names, support values, 'support:name'); missing, zero and negative lengths;
// multifurcations and unary nodes; unnamed leaves '(,)'; whitespace; a missing final ';'.
// Not handled: double-quoted labels, NEXUS underscore-to-space conversion (underscores are kept so that tip ids
// equal the text in the file).

import { Annotations, parseAnnotationComment, writeAnnotations } from './annotations.ts';
import type { AnnotationRecord } from './annotations.ts';
import { TreeModel, splitInternalLabel } from './tree.ts';
import type { RawTree } from './tree.ts';

export class NewickError extends Error {
  position: number;
  constructor(msg: string, position: number) {
    super(`${msg} (at character ${position})`);
    this.name = 'NewickError';
    this.position = position;
  }
}

const isWs = (c: number) => c === 32 || c === 9 || c === 10 || c === 13;

/** Position just after the comment that starts at `p` (text[p] === '['). Comments may nest. With `quoted` (parsing annotations), a
 *  quoted value in an annotation comment (`[&...]`) may hold brackets: `[&s="a]b"]`. It costs about 30% on a tree full of
 *  annotations, so the default skip does not do it. */
function skipComment(text: string, p: number, quoted = false): number {
  const n = text.length;
  if (quoted && text.charCodeAt(p + 1) === 38) return skipAnnotation(text, p, n);
  let depth = 0;
  for (; p < n; p++) {
    const c = text.charCodeAt(p);
    if (c === 91) depth++;
    else if (c === 93 && --depth === 0) return p + 1;
  }
  throw new NewickError('unterminated [comment]', n);
}

/** A quote opens only at the start of a value, after '=', ',' or '{'. */
function skipAnnotation(text: string, p: number, n: number): number {
  let depth = 0;
  let quote = 0;
  let prev = 0; // last character outside quotes that is not whitespace
  for (; p < n; p++) {
    const c = text.charCodeAt(p);
    if (quote) {
      if (c === quote) quote = 0;
      continue;
    }
    if (c === 91) depth++;
    else if (c === 93 && --depth === 0) return p + 1;
    else if ((c === 34 || c === 39) && (prev === 61 || prev === 44 || prev === 123)) quote = c;
    if (!isWs(c)) prev = c;
  }
  throw new NewickError('unterminated [comment]', n);
}

export interface ParseOptions {
  /** Keep the `[&key=value]` (BEAST) and `[&&NHX:...]` comments in `tree.annotations` instead of skipping them. Default false:
   *  the comments are skipped as before and cost nothing extra. */
  annotations?: boolean;
}

export function parseNewick(text: string, o: ParseOptions = {}): TreeModel {
  const annot = o.annotations === true;
  const nodeAnn = new Map<number, AnnotationRecord>();
  const edgeAnn = new Map<number, AnnotationRecord>();
  let afterColon = false; // the comment is after the ':' of the node, so BEAST means the edge (NHX comments are always the node's)
  const note = (from: number, to: number, edge: boolean): void => {
    if (cur < 0) return;
    const rec = parseAnnotationComment(text, from, to);
    if (!rec) return;
    const into = edge && text.charCodeAt(from + 2) !== 38 ? edgeAnn : nodeAnn;
    const old = into.get(cur);
    into.set(cur, old ? Object.assign(old, rec) : rec);
  };
  const n = text.length;
  let cap = 1;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 40 || c === 44) cap++; // '(' or ',': every non-root node follows one of these
  }
  const parent = new Int32Array(cap);
  const subtreeEnd = new Int32Array(cap);
  const depth = new Int32Array(cap);
  const length = new Float64Array(cap).fill(NaN);
  const support = new Float64Array(cap).fill(NaN);
  const leafStart = new Int32Array(cap);
  const leafEnd = new Int32Array(cap);
  const labels: string[] = [];
  const stack = new Int32Array(cap);
  let sp = 0;
  let count = 0;
  let tips = 0;
  let cur = -1; // node that a following ':length' belongs to
  let closed = -1; // internal node whose ')' was just read (a following label names it)
  let expect = true; // a node (leaf or '(') is expected next
  let p = 0;

  const newLeaf = (label: string): number => {
    const i = count++;
    if (sp === 0 && i > 0) throw new NewickError('more than one root', p);
    parent[i] = sp > 0 ? stack[sp - 1] : -1;
    depth[i] = sp;
    leafStart[i] = tips;
    tips++;
    leafEnd[i] = tips;
    subtreeEnd[i] = count;
    labels.push(label);
    closed = -1;
    afterColon = false;
    return i;
  };

  const readLabel = (): string => {
    const q = text.charCodeAt(p);
    if (q === 39) {
      // quoted label, '' is an escaped quote
      let out = '';
      let from = p + 1;
      for (;;) {
        const e = text.indexOf("'", from);
        if (e < 0) throw new NewickError('unterminated quoted label', p);
        out += text.slice(from, e);
        if (text.charCodeAt(e + 1) === 39) {
          out += "'";
          from = e + 2;
        } else {
          p = e + 1;
          return out;
        }
      }
    }
    const s = p;
    while (p < n) {
      const c = text.charCodeAt(p);
      if (c === 40 || c === 41 || c === 44 || c === 58 || c === 59 || c === 91) break;
      p++;
    }
    return text.slice(s, p).trim();
  };

  scan: while (p < n) {
    const c = text.charCodeAt(p);
    if (isWs(c)) {
      p++;
    } else if (c === 91) {
      const e = skipComment(text, p, annot);
      if (annot && !expect) note(p, e, afterColon);
      p = e;
    } else if (c === 40) {
      if (!expect) throw new NewickError("unexpected '('", p);
      const i = count++;
      if (sp === 0 && i > 0) throw new NewickError('more than one root', p);
      parent[i] = sp > 0 ? stack[sp - 1] : -1;
      depth[i] = sp;
      leafStart[i] = tips;
      labels.push('');
      stack[sp++] = i;
      closed = -1;
      afterColon = false;
      expect = true;
      p++;
    } else if (c === 44) {
      if (sp === 0) throw new NewickError("',' outside parentheses", p);
      if (expect) newLeaf('');
      expect = true;
      cur = -1;
      closed = -1;
      afterColon = false;
      p++;
    } else if (c === 41) {
      if (sp === 0) throw new NewickError("unbalanced ')'", p);
      if (expect) newLeaf('');
      const i = stack[--sp];
      subtreeEnd[i] = count;
      leafEnd[i] = tips;
      cur = i;
      closed = i;
      afterColon = false;
      expect = false;
      p++;
    } else if (c === 59) {
      break scan;
    } else if (c === 58) {
      if (expect) {
        cur = newLeaf('');
        expect = false;
      }
      p++;
      // BEAST puts comments between ':' and the number: '1[&height=..]:[&rate=..]70.5'
      while (p < n && (isWs(text.charCodeAt(p)) || text.charCodeAt(p) === 91)) {
        if (text.charCodeAt(p) === 91) {
          const e = skipComment(text, p, annot);
          if (annot) note(p, e, true);
          p = e;
        } else p++;
      }
      const s = p;
      while (p < n) {
        const d = text.charCodeAt(p);
        if (d === 40 || d === 41 || d === 44 || d === 59 || d === 91 || isWs(d)) break;
        p++;
      }
      if (cur >= 0) length[cur] = s === p ? NaN : Number(text.slice(s, p));
      afterColon = true;
    } else {
      const lab = readLabel();
      if (expect) {
        cur = newLeaf(lab);
        expect = false;
      } else if (closed >= 0 && labels[closed] === '') {
        labels[closed] = lab;
        support[closed] = splitInternalLabel(lab).support;
        closed = -2;
      } else {
        throw new NewickError(`unexpected label ${JSON.stringify(lab)}`, p);
      }
    }
  }
  if (sp !== 0) throw new NewickError(`unbalanced '(' (${sp} still open)`, p);
  if (count === 0) throw new NewickError('empty tree', p);
  if (expect) throw new NewickError('tree ends where a node was expected', p);

  const slice = <T extends Int32Array | Float64Array>(a: T): T => (count > cap * 0.6 ? (a.subarray(0, count) as T) : (a.slice(0, count) as T));
  const raw: RawTree = {
    nodeCount: count,
    tipCount: tips,
    parent: slice(parent),
    subtreeEnd: slice(subtreeEnd),
    depth: slice(depth),
    length: slice(length),
    support: slice(support),
    leafStart: slice(leafStart),
    leafEnd: slice(leafEnd),
    labels,
    annotations: annot ? new Annotations(count, nodeAnn, edgeAnn) : undefined,
  };
  return new TreeModel(raw);
}

// ------------------------------------------------------------------------------------------ writer

const NEEDS_QUOTE = /[()[\]':;,\s]/;
export function quoteLabel(l: string): string {
  return NEEDS_QUOTE.test(l) ? "'" + l.replace(/'/g, "''") + "'" : l;
}

export interface WriteOptions {
  lengths?: boolean; // default true
  internalLabels?: boolean; // default true
  /** Write `tree.annotations` back in BEAST syntax (`name[&k=v]:[&k=v]length`). Default false. Needs a tree parsed with `annotations: true`. */
  annotations?: boolean;
}

/** Serialise to Newick, iteratively. Missing lengths are omitted. */
export function toNewick(t: TreeModel, o: WriteOptions = {}): string {
  return writeTree(t, o, (i) => quoteLabel(t.labels[i]), quoteLabel);
}

/** The Newick writer behind toNewick and toNexus: `tip(i)` writes tip node i, `internal` an internal label. */
function writeTree(t: TreeModel, o: WriteOptions, tip: (i: number) => string, internal: (l: string) => string): string {
  const withLen = o.lengths !== false;
  const withInt = o.internalLabels !== false;
  const ann = o.annotations === true ? t.annotations : null;
  const nodeNote = (i: number): string => (ann ? writeAnnotations(ann.node.get(i)) : '');
  // ':' + edge annotations + length; an edge with only annotations is written as ':[&...]'
  const edge = (i: number): string => {
    const l = t.length[i];
    const e = ann ? writeAnnotations(ann.edge.get(i)) : '';
    const hasLen = withLen && !Number.isNaN(l);
    return hasLen || e ? ':' + e + (hasLen ? l : '') : '';
  };
  const parts: string[] = [];
  const open: number[] = [];
  const suffix = (i: number): string => {
    let s = '';
    if (t.childCount[i] > 0 && withInt && t.labels[i] !== '') s += internal(t.labels[i]);
    return s + nodeNote(i) + edge(i);
  };
  for (let i = 0; i < t.nodeCount; i++) {
    while (open.length && t.subtreeEnd[open[open.length - 1]] <= i) parts.push(')' + suffix(open.pop() as number));
    if (i > 0 && t.firstChild[t.parent[i]] !== i) parts.push(',');
    if (t.childCount[i] > 0) {
      parts.push('(');
      open.push(i);
    } else {
      parts.push(tip(i) + nodeNote(i) + edge(i));
    }
  }
  while (open.length) parts.push(')' + suffix(open.pop() as number));
  return parts.join('') + ';';
}

// ------------------------------------------------------------------------------------------ NEXUS

/** NEXUS punctuation (and whitespace) makes a token need quotes; '_' stays, it reads back as a space in NEXUS as in Newick. */
const NEXUS_NEEDS_QUOTE = /[()[\]{}/\\,;:=*'"`+<>\s-]/;
const nexusQuote = (l: string): string => (l === '' || NEXUS_NEEDS_QUOTE.test(l) ? "'" + l.replace(/'/g, "''") + "'" : l);

export interface NexusWriteOptions extends WriteOptions {
  /** Name of the tree in the TREES block; default 'tree1'. */
  treeName?: string;
  /** Write a TRANSLATE table and numbers in the tree (default true: smaller files with long labels). */
  translate?: boolean;
}

/** Serialise to NEXUS: a TAXA block with the tip labels and a TREES block with the tree (rooted, `[&R]`), by default through a
 *  TRANSLATE table. parseNexus reads it back. */
export function toNexus(t: TreeModel, o: NexusWriteOptions = {}): string {
  const translate = o.translate !== false;
  const out = ['#NEXUS', '', 'BEGIN TAXA;', `  DIMENSIONS NTAX=${t.tipCount};`, '  TAXLABELS'];
  for (let r = 0; r < t.tipCount; r++) out.push('    ' + nexusQuote(t.labels[t.tipNode[r]]));
  out.push('  ;', 'END;', '', 'BEGIN TREES;');
  if (translate) {
    out.push('  TRANSLATE');
    for (let r = 0; r < t.tipCount; r++) out.push(`    ${r + 1} ${nexusQuote(t.labels[t.tipNode[r]])}${r < t.tipCount - 1 ? ',' : ''}`);
    out.push('  ;');
  }
  const tip = translate ? (i: number) => String(t.tipRank[i] + 1) : (i: number) => nexusQuote(t.labels[i]);
  out.push(`  TREE ${nexusQuote(o.treeName ?? 'tree1')} = [&R] ${writeTree(t, o, tip, nexusQuote)}`, 'END;', '');
  return out.join('\n');
}

export interface NexusResult {
  tree: TreeModel;
  treeName: string;
  /** Number of trees seen up to and including the requested one (the file may hold more). */
  treesSeen: number;
  /** Entries in the TRANSLATE table (0 if none). */
  translateEntries: number;
}

/** Next ';'-terminated statement starting at p, respecting 'quotes' and [comments]; end = position after ';'. */
function nexusStatement(text: string, p: number, quoted: boolean): { stmt: string; end: number } | null {
  const n = text.length;
  const s = p;
  while (p < n) {
    const c = text.charCodeAt(p);
    if (c === 91) p = skipComment(text, p, quoted);
    else if (c === 39) {
      p++;
      for (;;) {
        const e = text.indexOf("'", p);
        if (e < 0) throw new NewickError('unterminated quote in NEXUS', p);
        if (text.charCodeAt(e + 1) === 39) p = e + 2;
        else {
          p = e + 1;
          break;
        }
      }
    } else if (c === 59) return { stmt: text.slice(s, p), end: p + 1 };
    else p++;
  }
  const rest = text.slice(s).trim();
  return rest ? { stmt: rest, end: n } : null;
}

function stripComments(s: string): string {
  let out = '';
  let p = 0;
  while (p < s.length) {
    const b = s.indexOf('[', p);
    if (b < 0) return out + s.slice(p);
    out += s.slice(p, b);
    p = skipComment(s, b);
  }
  return out;
}

/** Tokens split on whitespace; 'quoted' tokens unquoted; ',' is its own token. */
function nexusTokens(s: string): string[] {
  const out: string[] = [];
  let p = 0;
  const n = s.length;
  while (p < n) {
    const c = s.charCodeAt(p);
    if (isWs(c)) p++;
    else if (c === 44) {
      out.push(',');
      p++;
    } else if (c === 39) {
      let t = '';
      p++;
      for (;;) {
        const e = s.indexOf("'", p);
        if (e < 0) throw new NewickError('unterminated quote in NEXUS token', p);
        t += s.slice(p, e);
        if (s.charCodeAt(e + 1) === 39) {
          t += "'";
          p = e + 2;
        } else {
          p = e + 1;
          break;
        }
      }
      out.push(t);
    } else {
      const st = p;
      while (p < n && !isWs(s.charCodeAt(p)) && s.charCodeAt(p) !== 44) p++;
      out.push(s.slice(st, p));
    }
  }
  return out;
}

/** Read tree number `treeIndex` (0-based) from a NEXUS document, applying its TRANSLATE table. */
export function parseNexus(text: string, treeIndex?: number, o?: ParseOptions): NexusResult;
export function parseNexus(text: string, o: ParseOptions & { treeIndex?: number }): NexusResult;
export function parseNexus(text: string, a: number | (ParseOptions & { treeIndex?: number }) = 0, b: ParseOptions = {}): NexusResult {
  const obj = typeof a === 'object' && a !== null ? a : null; // null and undefined read as the defaults
  const opts: ParseOptions = obj ?? b ?? {};
  const treeIndex = typeof a === 'number' ? a : (obj?.treeIndex ?? 0);
  let p = 0;
  let block = '';
  const translate = new Map<string, string>();
  let seen = 0;
  for (;;) {
    const st = nexusStatement(text, p, opts.annotations === true);
    if (!st) break;
    p = st.end;
    const head = stripComments(st.stmt).replace(/^\s*#nexus\b/i, '');
    const m = /^\s*(\*?\s*\w+)/.exec(head);
    if (!m) continue;
    const kw = m[1].replace(/[\s*]/g, '').toLowerCase();
    if (kw === 'begin') {
      block = (/^\s*begin\s+(\w+)/i.exec(head)?.[1] ?? '').toLowerCase();
    } else if (kw === 'end' || kw === 'endblock') {
      block = '';
    } else if (block === 'trees' && kw === 'translate') {
      const toks = nexusTokens(head.replace(/^\s*translate\b/i, ''));
      for (let i = 0; i + 1 < toks.length; i += 3) translate.set(toks[i], toks[i + 1]);
    } else if (block === 'trees' && (kw === 'tree' || kw === 'utree')) {
      if (seen++ < treeIndex) continue;
      // body: name = [comment] newick, with comments still in place (parseNewick skips them)
      // '=' inside a quoted tree name is not expected; first '=' outside [] is the separator
      let b = 0;
      let eq = -1;
      for (let i = 0; i < st.stmt.length; i++) {
        const c = st.stmt.charCodeAt(i);
        if (c === 91) b++;
        else if (c === 93) b--;
        else if (c === 61 && b === 0) {
          eq = i;
          break;
        }
      }
      if (eq < 0) throw new NewickError('TREE statement without "="', p);
      const name = stripComments(st.stmt.slice(0, eq))
        .replace(/^\s*\*?\s*u?tree\s+\*?\s*/i, '')
        .trim()
        .replace(/^'(.*)'$/s, '$1');
      const tree = parseNewick(st.stmt.slice(eq + 1) + ';', opts);
      if (translate.size) tree.relabelTips((l) => translate.get(l));
      return { tree, treeName: name, treesSeen: seen, translateEntries: translate.size };
    }
  }
  throw new NewickError(`no tree number ${treeIndex} in NEXUS (saw ${seen})`, text.length);
}
