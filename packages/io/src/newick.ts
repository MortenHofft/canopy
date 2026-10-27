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
import type { ParserWarning, RawTree } from './tree.ts';

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
  if (quoted && text.charCodeAt(p + 1) === 38 && text.charCodeAt(p + 2) !== 38) return skipAnnotation(text, p, n); // not NHX: its values have no quotes
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
  /** Throw a NewickError on the first recoverable issue (missing trailing ';', non-numeric branch length, empty tip from a
   *  stray comma, extra-paren root edge, missing #NEXUS header for parseNexus). Default false: the parse succeeds and the
   *  issues are collected on `tree.warnings` for the UI to surface. Structurally broken input (unmatched parens, unterminated
   *  quote/comment, double colon, double quotes, quote mid-token) is always a NewickError regardless of this flag. */
  strict?: boolean;
}

export function parseNewick(text: string, o: ParseOptions = {}): TreeModel {
  const annot = o.annotations === true;
  const strict = o.strict === true;
  const warnings: ParserWarning[] = [];
  /** Record a recoverable issue (in default mode) or throw it (in strict mode). */
  const warn = (code: string, message: string, position: number): void => {
    if (strict) throw new NewickError(`[${code}] ${message}`, position);
    warnings.push({ code, message, position });
  };
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
  let lastComma = -1; // the ',' that produced the current `expect`; -1 if none, used to blame
  //    the trailing-comma case ('(A,B,);') on the comma rather than the ')'

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
    if (q === 34) {
      // double-quoted labels are non-standard Newick (phylio and DendroPy reject; patristic
      // alone implements its own doubled-double-quote escape). We reject in both modes because
      // the intent is ambivalent: use single quotes for labels with special characters.
      throw new NewickError('double-quoted label (use single quotes)', p);
    }
    const s = p;
    while (p < n) {
      const c = text.charCodeAt(p);
      if (c === 40 || c === 41 || c === 44 || c === 58 || c === 59 || c === 91) break;
      if (c === 39 || c === 34) {
        // A quote mid-token is ambivalent: forgotten opening quote? Suffix quote? Fail hard.
        throw new NewickError(`unexpected ${c === 39 ? "'" : '"'} inside unquoted label`, p);
      }
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
      if (expect) {
        // A ',' where a node was expected means an unnamed empty tip. Legal (the Newick spec
        // reads '(,,,);' as four unnamed tips), but worth surfacing on real-world input.
        newLeaf('');
        warn('empty-tip', 'unnamed empty tip from a stray comma', p);
      }
      expect = true;
      lastComma = p;
      cur = -1;
      closed = -1;
      afterColon = false;
      p++;
    } else if (c === 41) {
      if (sp === 0) throw new NewickError("unbalanced ')'", p);
      if (expect) {
        // Trailing comma inside this parens, e.g. '(A,B,);'. Blame the stray ',' not the ')'
        // (keeps the position consistent with the middle- and leading-comma cases).
        newLeaf('');
        warn('empty-tip', 'unnamed empty tip before closing parenthesis (trailing comma?)', lastComma >= 0 ? lastComma : p);
      }
      const i = stack[--sp];
      subtreeEnd[i] = count;
      leafEnd[i] = tips;
      cur = i;
      closed = i;
      afterColon = false;
      expect = false;
      lastComma = -1;
      p++;
    } else if (c === 59) {
      break scan;
    } else if (c === 58) {
      // Double colon: 'A:1:2' is non-standard but appears in the wild (viewer test generators
      // and some BEAST-like extensions use it as a shortcut). We keep the lenient "last colon
      // wins" semantics for parse-time stability and surface a warning so the publisher knows.
      const colonAt = p;
      if (cur >= 0 && !Number.isNaN(length[cur])) {
        warn('double-colon', `extra ':' overwrites the earlier branch length`, p);
      }
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
        // Stop at ':' too so a double colon ('A:1:2') hits the next loop iteration and is caught
        // as a hard error rather than being swallowed into one length token.
        if (d === 40 || d === 41 || d === 44 || d === 58 || d === 59 || d === 91 || isWs(d)) break;
        p++;
      }
      if (cur >= 0) {
        if (s === p) {
          // 'A:,' or 'A:)' or 'A:;' — dangling colon, no number after it.
          warn('dangling-colon', `missing branch length after ':'`, colonAt);
          length[cur] = NaN;
        } else {
          const str = text.slice(s, p);
          const v = Number(str);
          if (Number.isNaN(v)) {
            // 'A:xyz' — a token where a number should be. Intent is "no length"; carry on.
            warn('non-numeric-length', `branch length ${JSON.stringify(str)} is not a number`, s);
            length[cur] = NaN;
          } else length[cur] = v;
        }
      }
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

  // Missing trailing ';': we exited the scan loop without seeing ';', so p is at the end of the
  // input (or past the last comment). Standard Newick requires ';'. The viewer tolerates it;
  // publishers should fix it. Walk back to the last non-whitespace so the warning points at the
  // end of the tree rather than at trailing newlines.
  if (p === n || text.charCodeAt(p) !== 59) {
    let eot = p - 1;
    while (eot > 0 && isWs(text.charCodeAt(eot))) eot--;
    warn('missing-trailing-semicolon', `tree is not terminated with ';'`, Math.max(0, eot));
  }

  // ape-style extra-paren root edge: '((A,B):10);' parses as a root with a single internal child
  // carrying the "root edge" length. We keep the structure (do not rewrite) but surface it so the
  // publisher knows the file is non-standard; ape does the same.
  // Guard against false positives on '((A));' or '((Clade));' (single tip wrapped) — those are
  // unary chains, not an extra-root-paren case; require the unary child to itself have ≥2 kids.
  if (count >= 2 && parent[1] === 0) {
    let rootKids = 0;
    for (let i = 1; i < count && rootKids < 2; i++) if (parent[i] === 0) rootKids++;
    if (rootKids === 1 && labels[1] === '') {
      let innerKids = 0;
      for (let i = 2; i < count && innerKids < 2; i++) if (parent[i] === 1) innerKids++;
      if (innerKids >= 2) {
        // Point at the inner '(' (the extra one), not the root paren.
        const innerParenAt = text.indexOf('(', text.indexOf('(') + 1);
        warn('extra-paren-root', 'root has a single unlabeled internal child (extra parentheses?)', innerParenAt >= 0 ? innerParenAt : 0);
      }
    }
  }

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
    warnings,
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
  let warned = false;
  const skipped = (what: string): void => {
    if (!warned) console.warn(`gbif-phylo io: annotations not written: ${what} (further skipped entries are not reported)`);
    warned = true;
  };
  const nodeNote = (i: number): string => (ann ? writeAnnotations(ann.node.get(i), skipped) : '');
  // ':' + edge annotations + length; an edge with only annotations is written as ':[&...]'
  const edge = (i: number): string => {
    const l = t.length[i];
    const e = ann ? writeAnnotations(ann.edge.get(i), skipped) : '';
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

/** Something in a NEXUS file that was not read, or is not connected to the tree that was returned. Not a problem with the
 *  tree, so it is not in `tree.warnings` and strict mode does not throw for it. */
export interface NexusNote extends ParserWarning {
  /** Lower-case name of the block it concerns ('' for the file as a whole). */
  block: string;
}

export interface NexusResult {
  tree: TreeModel;
  treeName: string;
  /** Number of trees seen up to and including the requested one (the file may hold more). */
  treesSeen: number;
  /** Trees in the whole file. */
  treeCount: number;
  /** Entries in the TRANSLATE table (0 if none). */
  translateEntries: number;
  /** What the parser skipped or could not connect to the tree (empty for a file that holds nothing but the trees and
   *  the taxa they use). Codes: nexus-ignored-block, nexus-block-unreadable, nexus-scan-stopped, nexus-other-trees,
   *  nexus-taxa-unused, nexus-taxa-ambiguous, nexus-taxa-link-unresolved, nexus-taxa-mismatch, nexus-numeric-tips,
   *  nexus-sequences-ignored, nexus-sequences-unlinked. */
  ignored: NexusNote[];
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

interface NexusBlock {
  name: string;
  at: number;
  /** Statements in it other than BEGIN and END. */
  statements: number;
  title: string;
  /** The title of the TAXA block named by `LINK TAXA=`, '' if none. */
  link: string;
  /** TAXLABELS of a TAXA block. */
  labels: string[];
  ntax: number;
  nchar: number;
  /** Distinct first words of the MATRIX lines of a CHARACTERS or DATA block, with '_' read as a space. */
  rows: Set<string>;
  unreadable: boolean;
}

/** The first word of a line, 'quoted' words unquoted. */
function firstWord(line: string): string {
  if (line.charCodeAt(0) !== 39) {
    let e = 0;
    while (e < line.length && !isWs(line.charCodeAt(e))) e++;
    return line.slice(0, e);
  }
  let t = '';
  let p = 1;
  for (;;) {
    const e = line.indexOf("'", p);
    if (e < 0) return t + line.slice(p);
    t += line.slice(p, e);
    if (line.charCodeAt(e + 1) === 39) {
      t += "'";
      p = e + 2;
    } else return t;
  }
}

/** `TITLE x` / `LINK TAXA = x` values: one word, or a 'quoted' one. */
const linkValue = (head: string, key: RegExp): string => {
  const m = key.exec(head);
  return m ? firstWord(m[1].trim()).toLowerCase() : '';
};

/** NEXUS reads an unquoted '_' as a space, so t2_the_name and 't2 the name' are one taxon: names are compared this way. */
const nameKey = (l: string): string => l.replace(/_/g, ' ');

const sample = (xs: string[]): string => xs.slice(0, 3).join(', ') + (xs.length > 3 ? `, … (${xs.length} in all)` : '');

/** Read tree number `treeIndex` (0-based) from a NEXUS document, applying its TRANSLATE table. The rest of the file is
 *  scanned too, and what is not read or not connected to the tree is listed in `ignored`. */
export function parseNexus(text: string, treeIndex?: number, o?: ParseOptions): NexusResult;
export function parseNexus(text: string, o: ParseOptions & { treeIndex?: number }): NexusResult;
export function parseNexus(text: string, a: number | (ParseOptions & { treeIndex?: number }) = 0, b: ParseOptions = {}): NexusResult {
  const obj = typeof a === 'object' && a !== null ? a : null; // null and undefined read as the defaults
  const opts: ParseOptions = obj ?? b ?? {};
  const treeIndex = typeof a === 'number' ? a : (obj?.treeIndex ?? 0);
  const strict = opts.strict === true;
  // Standard NEXUS files start with '#NEXUS'. Many real files lack the header; we accept them
  // but surface the issue so publishers can fix. In strict mode the parse throws.
  const headerWarn: ParserWarning | null = /^\s*#nexus\b/i.test(text)
    ? null
    : { code: 'missing-nexus-header', message: 'NEXUS file does not start with #NEXUS', position: 0 };
  if (headerWarn && strict) throw new NewickError(`[${headerWarn.code}] ${headerWarn.message}`, headerWarn.position);
  let p = 0;
  let cur: NexusBlock | null = null;
  const blocks: NexusBlock[] = [];
  const notes: NexusNote[] = [];
  const note = (code: string, block: string, message: string, position: number): void => {
    notes.push({ code, block, message, position });
  };
  const translate = new Map<string, string>();
  let total = 0;
  let found: { tree: TreeModel; name: string; seen: number; block: NexusBlock | null } | null = null;
  const tokens = (s: string): string[] => {
    try {
      return nexusTokens(s);
    } catch {
      if (cur) cur.unreadable = true;
      return [];
    }
  };
  try {
    for (;;) {
      const from = p;
      const st = nexusStatement(text, p, opts.annotations === true);
      if (!st) break;
      p = st.end;
      const head = stripComments(st.stmt).replace(/^\s*#nexus\b/i, '');
      const m = /^\s*(\*?\s*\w+)/.exec(head);
      if (!m) continue;
      const at = from + (st.stmt.length - st.stmt.trimStart().length);
      const kw = m[1].replace(/[\s*]/g, '').toLowerCase();
      if (kw === 'begin') {
        cur = {
          name: (/^\s*begin\s+(\w+)/i.exec(head)?.[1] ?? '').toLowerCase(),
          at,
          statements: 0,
          title: '',
          link: '',
          labels: [],
          ntax: -1,
          nchar: -1,
          rows: new Set(),
          unreadable: false,
        };
        blocks.push(cur);
        continue;
      }
      if (kw === 'end' || kw === 'endblock') {
        cur = null;
        continue;
      }
      if (!cur) continue;
      cur.statements++;
      const block = cur.name;
      if (kw === 'title') cur.title = linkValue(head, /^\s*title\s+(.*)$/is);
      else if (kw === 'link') cur.link = linkValue(head, /\btaxa\s*=\s*(.*)$/is);
      else if (kw === 'dimensions') {
        cur.ntax = Number(/\bntax\s*=\s*(\d+)/i.exec(head)?.[1] ?? -1);
        cur.nchar = Number(/\bnchar\s*=\s*(\d+)/i.exec(head)?.[1] ?? -1);
      } else if (block === 'taxa' && kw === 'taxlabels') {
        cur.labels = tokens(head.replace(/^\s*taxlabels\b/i, '')).filter((t) => t !== ',');
      } else if ((block === 'characters' || block === 'data') && kw === 'matrix') {
        for (const line of head.replace(/^\s*matrix\b/i, '').split(/\r\n|\r|\n/)) {
          const l = line.trim();
          if (l) cur.rows.add(nameKey(firstWord(l)));
        }
      } else if (block === 'trees' && kw === 'translate') {
        const toks = tokens(head.replace(/^\s*translate\b/i, ''));
        for (let i = 0; i + 1 < toks.length; i += 3) translate.set(toks[i], toks[i + 1]);
      } else if (block === 'trees' && (kw === 'tree' || kw === 'utree')) {
        if (total++ !== treeIndex) continue;
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
        if (headerWarn) (tree.warnings as ParserWarning[]).unshift(headerWarn);
        found = { tree, name, seen: total, block: cur };
      }
    }
  } catch (e) {
    // Past the requested tree the file is only being looked through: a stray quote in a block we do not read
    // must not fail a parse that used to succeed.
    if (!found || !(e instanceof NewickError)) throw e;
    note('nexus-scan-stopped', '', `The rest of the file was not looked through: ${e.message}`, p);
  }
  if (!found) throw new NewickError(`no tree number ${treeIndex} in NEXUS (saw ${total})`, text.length);
  const { tree } = found;

  for (const bl of blocks) {
    if (bl.unreadable)
      note('nexus-block-unreadable', bl.name, `Part of the ${bl.name.toUpperCase()} block could not be read (unterminated quote)`, bl.at);
    if (!['taxa', 'trees', 'characters', 'data'].includes(bl.name)) {
      note('nexus-ignored-block', bl.name, `The ${bl.name.toUpperCase()} block (${bl.statements} statements) is not read`, bl.at);
    }
  }
  if (total > 1)
    note(
      'nexus-other-trees',
      'trees',
      `The file holds ${total} trees; only tree ${treeIndex + 1} (${found.name || 'unnamed'}) was read`,
      found.block?.at ?? 0,
    );

  const tips = new Map<string, string>(); // name key -> tip label
  for (let r = 0; r < tree.tipCount; r++) tips.set(nameKey(tree.labels[tree.tipNode[r]]), tree.labels[tree.tipNode[r]]);

  // Which TAXA block the tree's block refers to: the one named by LINK, else the last one before it.
  const taxaBlocks = blocks.filter((bl) => bl.name === 'taxa');
  const tb = found.block;
  let used: NexusBlock | null = null;
  if (tb && taxaBlocks.length) {
    if (tb.link) {
      used = taxaBlocks.find((x) => x.title === tb.link) ?? null;
      if (!used) note('nexus-taxa-link-unresolved', 'trees', `The TREES block links to TAXA "${tb.link}", but no TAXA block has that TITLE`, tb.at);
    } else {
      const before = taxaBlocks.filter((x) => x.at < tb.at);
      used = before.length ? before[before.length - 1] : null;
      if (taxaBlocks.length > 1) {
        note(
          'nexus-taxa-ambiguous',
          'trees',
          `The file has ${taxaBlocks.length} TAXA blocks and the TREES block has no LINK; ${used ? 'the last one before it was assumed' : 'none comes before it, so none was used'}`,
          tb.at,
        );
      }
    }
  }
  for (const x of taxaBlocks) {
    if (x !== used)
      note(
        'nexus-taxa-unused',
        'taxa',
        `The TAXA block${x.title ? ` "${x.title}"` : ''} (${x.labels.length} taxa) is not connected to the tree that was read`,
        x.at,
      );
  }
  if (used) {
    const names = new Set(used.labels.map(nameKey));
    const noTaxon = [...tips].filter(([k]) => !names.has(k)).map(([, l]) => l);
    const noTip = used.labels.filter((l) => !tips.has(nameKey(l)));
    if (!translate.size && tips.size && noTaxon.length === tips.size && noTaxon.every((l) => /^[1-9]\d*$/.test(l))) {
      note(
        'nexus-numeric-tips',
        'trees',
        'The tips are numbers and there is no TRANSLATE table; they may be positions in the TAXA block, but are kept as numbers',
        tb?.at ?? 0,
      );
    } else if (noTaxon.length || noTip.length) {
      note(
        'nexus-taxa-mismatch',
        'taxa',
        `The tree has ${noTaxon.length} tips that are not in the TAXA block (${sample(noTaxon)}), and the TAXA block has ${noTip.length} taxa with no tip (${sample(noTip)})`,
        used.at,
      );
    }
  }

  for (const bl of blocks) {
    if (bl.name !== 'characters' && bl.name !== 'data') continue;
    const what = `The ${bl.name.toUpperCase()} block (${bl.rows.size} sequences${bl.nchar >= 0 ? `, ${bl.nchar} characters` : ''}) is not read`;
    if (bl.ntax >= 0 && bl.rows.size > bl.ntax) {
      note(
        'nexus-sequences-unlinked',
        bl.name,
        `${what}; its rows could not be told apart from wrapped lines, so they were not compared with the tips`,
        bl.at,
      );
      continue;
    }
    const noTip = [...bl.rows].filter((l) => !tips.has(l));
    const noRow = [...tips].filter(([k]) => !bl.rows.has(k)).map(([, l]) => l);
    if (noTip.length || noRow.length) {
      note(
        'nexus-sequences-unlinked',
        bl.name,
        `${what}; ${bl.rows.size - noTip.length} rows match a tip by label, ${noTip.length} rows match none (${sample(noTip)}), ${noRow.length} tips have no row (${sample(noRow)})`,
        bl.at,
      );
    } else {
      note('nexus-sequences-ignored', bl.name, `${what}; every row matches a tip by label`, bl.at);
    }
  }
  notes.sort((x, y) => x.position - y.position);
  return { tree, treeName: found.name, treesSeen: found.seen, treeCount: total, translateEntries: translate.size, ignored: notes };
}
