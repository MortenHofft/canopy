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
  // Validate NHX syntax even when annotations are off: '[&&NHX:name=value:...]'. Each ':'-
  // separated entry (after the leading 'NHX') must contain '='. A missing '=' is a well-known
  // ete-side mistake and worth telling the publisher.
  const checkNhxAt = (from: number, to: number): void => {
    if (text.charCodeAt(from + 1) !== 38 || text.charCodeAt(from + 2) !== 38) return;
    const inner = text.slice(from + 3, to - 1);
    if (!inner.startsWith('NHX')) return;
    const parts = inner.slice(3).split(':');
    for (const part of parts) {
      const t = part.trim();
      if (t === '') continue;
      if (!t.includes('=')) {
        warn('invalid-nhx-syntax', `NHX entry ${JSON.stringify(t)} is missing '='`, from);
        return;
      }
    }
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
      checkNhxAt(p, e);
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
          checkNhxAt(p, e);
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
    if (!warned) console.warn(`canopy io: annotations not written: ${what} (further skipped entries are not reported)`);
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
   *  nexus-taxa-unused, nexus-taxa-ambiguous, nexus-taxa-link-unresolved, nexus-taxa-mismatch, nexus-ntax-mismatch, nexus-taxon-numbers,
   *  nexus-sequences-ignored, nexus-sequences-unlinked. */
  ignored: NexusNote[];
}

/** A reader of the ';'-terminated statements of a NEXUS text, respecting 'quotes' and [comments]: `next(p)` gives the statement
 *  that starts at p and `end`, the position after its ';'. It jumps between the next ';', '[' and quote with indexOf and keeps
 *  where they are, so a long MATRIX costs little. */
function nexusStatements(text: string, quoted: boolean): (p: number) => { stmt: string; end: number; terminated: boolean } | null {
  const n = text.length;
  let ns = -2; // next ';', '[' and "'" at or after the last position asked for: -2 not looked for yet, -1 none
  let nb = -2;
  let nq = -2;
  return (s) => {
    let p = s;
    for (;;) {
      if (ns !== -1 && ns < p) ns = text.indexOf(';', p);
      if (nb !== -1 && nb < p) nb = text.indexOf('[', p);
      if (nq !== -1 && nq < p) nq = text.indexOf("'", p);
      const inside = (i: number): boolean => i >= 0 && (ns < 0 || i < ns); // before the ';'
      if (inside(nb) && (!inside(nq) || nb < nq)) p = skipComment(text, nb, quoted);
      else if (inside(nq)) {
        p = nq + 1;
        for (;;) {
          const e = text.indexOf("'", p);
          if (e < 0) throw new NewickError('unterminated quote in NEXUS', p);
          if (text.charCodeAt(e + 1) === 39) p = e + 2;
          else {
            p = e + 1;
            break;
          }
        }
      } else if (ns >= 0) return { stmt: text.slice(s, ns), end: ns + 1, terminated: true };
      else {
        const rest = text.slice(s).trimEnd(); // the offsets of the statement stay those of the text
        return rest.trim() ? { stmt: rest, end: n, terminated: false } : null;
      }
    }
  };
}

/** `s` without its [comments]; a 'quoted' name keeps any brackets it holds. Jumps between the brackets and quotes with indexOf. */
function stripComments(s: string): string {
  let out = '';
  let from = 0;
  let nb = s.indexOf('[');
  let nq = s.indexOf("'");
  while (nb >= 0 || nq >= 0) {
    let p: number;
    if (nb >= 0 && (nq < 0 || nb < nq)) {
      out += s.slice(from, nb);
      p = skipComment(s, nb);
      from = p;
    } else {
      p = nq + 1;
      for (;;) {
        const e = s.indexOf("'", p);
        if (e < 0) {
          p = s.length;
          break;
        }
        if (s.charCodeAt(e + 1) === 39) p = e + 2;
        else {
          p = e + 1;
          break;
        }
      }
    }
    if (nb >= 0 && nb < p) nb = s.indexOf('[', p);
    if (nq >= 0 && nq < p) nq = s.indexOf("'", p);
  }
  return out + s.slice(from);
}

/** Where an END or ENDBLOCK word starts that was read into a TREE command because its ';' is missing, else -1: the last word of
 *  the command, set off by whitespace (comments count as whitespace), after the tree's closing parenthesis. */
function swallowedEnd(body: string): number {
  let depth = 0;
  let closed = false;
  let ws = true;
  let start = -1;
  let stop = -1;
  let depthAtStart = 0;
  let closedAtStart = false;
  for (let p = 0; p < body.length; p++) {
    const c = body.charCodeAt(p);
    if (c === 91) {
      p = skipComment(body, p) - 1;
      ws = true;
      continue;
    }
    if (isWs(c)) {
      ws = true;
      continue;
    }
    if (ws) {
      start = p;
      depthAtStart = depth;
      closedAtStart = closed;
    }
    ws = false;
    if (c === 39) {
      for (p++; p < body.length; p++) {
        if (body.charCodeAt(p) === 39 && body.charCodeAt(p + 1) !== 39) break;
        if (body.charCodeAt(p) === 39) p++;
      }
    } else if (c === 40) depth++;
    else if (c === 41) {
      depth--;
      closed = true;
    }
    stop = p + 1;
  }
  if (start < 0 || depthAtStart !== 0 || !closedAtStart) return -1;
  return /^(?:end|endblock)$/i.test(body.slice(start, stop)) ? start : -1;
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

/** What a NEXUS file says about one of its trees, found without parsing the tree. */
export interface NexusTreeInfo {
  /** Position of the tree in the file, over all its TREES blocks (0-based). */
  index: number;
  /** The name as written, unquoted. */
  name: string;
  /** Offsets of the TREE command in the text (JavaScript string indices, UTF-16 code units, not bytes): from the keyword to the
   *  end of the tree, without the ';' and without an END that is read into the command when its ';' is missing. */
  start: number;
  end: number;
  /** `TREE * name`: the tree the file marks as its default. */
  isDefault: boolean;
  /** `[&R]` true, `[&U]` false, null when the tree has neither. */
  rooted: boolean | null;
  /** `[&W n]` or `[&W n/m]`, null when the tree has none or it is not a finite number. */
  weight: number | null;
  /** The MCMC state when the name is `STATE_n` (BEAST) or `gen.n` (MrBayes), else null. */
  state: number | null;
}

/** One tree read through a NexusIndex. `ignored` holds the notes that depend on this tree's tips (nexus-taxa-mismatch,
 *  nexus-taxon-numbers, nexus-sequences-*); the notes about the file are on the index. */
export interface NexusTreeResult {
  tree: TreeModel;
  info: NexusTreeInfo;
  /** Entries in the TRANSLATE table of the tree's TREES block (0 if none). */
  translateEntries: number;
  ignored: NexusNote[];
}

/** The trees of a NEXUS file, found in one fast pass that parses none of them. */
export interface NexusIndex {
  trees: readonly NexusTreeInfo[];
  /** What the file holds besides the trees, and what is not connected: the codes of NexusResult.ignored that do not depend on
   *  one tree (nexus-ignored-block, nexus-block-unreadable, nexus-scan-stopped, nexus-taxa-unused, nexus-taxa-ambiguous,
   *  nexus-taxa-link-unresolved, nexus-ntax-mismatch, nexus-translate-malformed). */
  ignored: readonly NexusNote[];
  /** Parse tree `i` alone, with the TRANSLATE table and TAXA block that apply to it: the time does not depend on i. */
  parse(i: number): NexusTreeResult;
}

interface TreeEntry {
  info: NexusTreeInfo;
  block: NexusBlock;
  /** Start of the statement in the text (its leading whitespace included), and the offset of its '=' in it (-1: none). */
  from: number;
  /** End of the statement in the text, a swallowed END included (`info.end` leaves it out). */
  to: number;
  eq: number;
  /** Where in the tree text a swallowed END starts (a missing ';'), or -1. */
  endAt: number;
  terminated: boolean;
  error: string | null;
}

interface IndexImpl extends NexusIndex {
  blocks: NexusBlock[];
  taxaOf(tb: NexusBlock | null): NexusBlock | null;
  blockOf(i: number): NexusBlock;
}

/** The offset of the first '=' outside [comments] and 'quoted names', or -1. */
function treeEq(stmt: string): number {
  let b = 0;
  for (let i = 0; i < stmt.length; i++) {
    const c = stmt.charCodeAt(i);
    if (c === 39 && b === 0) {
      i++;
      for (;;) {
        const e = stmt.indexOf("'", i);
        if (e < 0) {
          i = stmt.length;
          break;
        }
        i = e + 1;
        if (stmt.charCodeAt(i) !== 39) break;
        i++;
      }
      i--;
    } else if (c === 91) b++;
    else if (c === 93) b--;
    else if (c === 61 && b === 0) return i;
  }
  return -1;
}

/** The rooted flag and the weight in the comments that stand between the '=' and the tree (`[&R]`, `[&U]`, `[&W 1/2]`, or
 *  both in one comment). Other comments, such as `[&lnP=-12.5]`, are left to the Newick parser. */
function treeFlags(stmt: string, p: number): { rooted: boolean | null; weight: number | null } {
  let rooted: boolean | null = null;
  let weight: number | null = null;
  for (;;) {
    while (p < stmt.length && isWs(stmt.charCodeAt(p))) p++;
    if (stmt.charCodeAt(p) !== 91) break;
    const e = skipComment(stmt, p);
    const c = stmt.slice(p + 1, e - 1).trim();
    if (c.charCodeAt(0) === 38 && !c.includes('=')) {
      const r = /(?:^|[\s&])([RrUu])(?=[\s&]|$)/.exec(c);
      if (r) rooted = r[1] === 'R' || r[1] === 'r';
      const w = /(?:^|[\s&])[Ww]\s*([0-9.eE+-]+)(?:\s*\/\s*([0-9.eE+-]+))?(?=[\s&]|$)/.exec(c);
      if (w) {
        const v = Number(w[1]) / (w[2] ? Number(w[2]) : 1);
        if (Number.isFinite(v)) weight = v;
      }
    }
    p = e;
  }
  return { rooted, weight };
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
  /** Distinct first words of the MATRIX lines of a CHARACTERS or DATA block: name key (see nameKey) to the name as written. */
  rows: Map<string, string>;
  unreadable: boolean;
  /** TRANSLATE table of a TREES block: a table belongs to its own block. */
  translate: Map<string, string>;
  /** The last TAXA block before this block, which a TREES block without LINK refers to. */
  taxaBefore: NexusBlock | null;
  /** The name keys of the labels of a TAXA block, made when first needed. */
  keys?: Set<string>;
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
  return m ? nameKey(firstWord(m[1].trim())) : '';
};

/** NEXUS reads an unquoted '_' as a space and does not tell cases apart, so t2_the_name and 'T2 the name' are one taxon: names are compared this way. */
const nameKey = (l: string): string => l.replace(/_/g, ' ').toLowerCase();

const sample = (xs: string[]): string => xs.slice(0, 3).join(', ') + (xs.length > 3 ? `, … (${xs.length} in all)` : '');

/** Scan a NEXUS text: its blocks, its TRANSLATE tables and the place of every tree, without parsing a tree. */
function buildIndex(text: string, opts: ParseOptions): IndexImpl {
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
  const entries: TreeEntry[] = [];
  let scanError: NewickError | null = null;
  /** The TAXA block a TREES block refers to: the one named by its LINK, else the last one before it. */
  let lastTaxa: NexusBlock | null = null;
  let titles: Map<string, NexusBlock> | null = null; // made when the first LINK is looked up, after the scan
  const taxaOf = (tb: NexusBlock | null): NexusBlock | null => {
    if (!tb) return null;
    if (!tb.link) return tb.taxaBefore;
    if (!titles) {
      titles = new Map();
      for (const x of blocks) if (x.name === 'taxa' && x.title && !titles.has(x.title)) titles.set(x.title, x);
    }
    return titles.get(tb.link) ?? null;
  };
  const nextStatement = nexusStatements(text, opts.annotations === true);
  const tokens = (s: string): string[] => {
    try {
      return nexusTokens(s);
    } catch {
      if (cur) cur.unreadable = true;
      return [];
    }
  };
  /** Record a TREE command. True when its ';' is missing and the END of the block was read into it. */
  const addTree = (st: { stmt: string; terminated: boolean }, from: number, block: NexusBlock): boolean => {
    const stmt = st.stmt;
    const eq = treeEq(stmt);
    const info: NexusTreeInfo = {
      index: entries.length,
      name: '',
      start: from + keywordAt(stmt),
      end: from + stmt.length,
      isDefault: false,
      rooted: null,
      weight: null,
      state: null,
    };
    const e: TreeEntry = {
      info,
      block,
      from,
      to: from + stmt.length,
      eq,
      endAt: -1,
      terminated: st.terminated,
      error: eq < 0 ? 'TREE statement without "="' : null,
    };
    entries.push(e);
    if (eq < 0) return false;
    const before = stripComments(stmt.slice(0, eq));
    const star = /^\s*(\*?)\s*u?tree\s+(\*?)/i.exec(before);
    info.isDefault = !!(star && (star[1] || star[2]));
    info.name = before
      .replace(/^\s*\*?\s*u?tree\s+\*?\s*/i, '')
      .trim()
      .replace(/^'(.*)'$/s, (_, q: string) => q.replace(/''/g, "'"));
    const flags = treeFlags(stmt, eq + 1);
    info.rooted = flags.rooted;
    info.weight = flags.weight;
    const state = /^(?:STATE_|gen\.)(\d+)$/i.exec(info.name);
    if (state) info.state = Number(state[1]);
    // No ';' after the tree: the END of the block was read into the statement. Only a statement that ends with the word END or
    // with a comment is looked at closely (a comment may follow the END).
    const tail = stmt.slice(-200);
    if (/\bend(?:block)?\s*$/i.test(tail) || /\]\s*$/.test(tail)) e.endAt = swallowedEnd(stmt.slice(eq + 1));
    if (e.endAt >= 0) {
      let k = eq + 1 + e.endAt;
      while (k > 0 && isWs(stmt.charCodeAt(k - 1))) k--;
      info.end = from + k;
    }
    return e.endAt >= 0;
  };
  try {
    for (;;) {
      const from = p;
      const st = nextStatement(p);
      if (!st) break;
      p = st.end;
      if (cur?.name === 'trees' && /^\s*u?tree\b/i.test(st.stmt)) {
        if (addTree(st, from, cur)) cur = null; // the END was part of this statement
        continue;
      }
      const head = stripComments(st.stmt).replace(/^\s*#nexus\b/i, '');
      const m = /^\s*(\*?\s*\w+)/.exec(head);
      if (!m) continue;
      const at = from + (/^\s*(?:#nexus\b\s*)?/i.exec(st.stmt)?.[0].length ?? 0);
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
          rows: new Map(),
          unreadable: false,
          translate: new Map(),
          taxaBefore: lastTaxa,
        };
        blocks.push(cur);
        if (cur.name === 'taxa') lastTaxa = cur;
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
          if (l) {
            const w = firstWord(l);
            cur.rows.set(nameKey(w), w);
          }
        }
      } else if (block === 'trees' && kw === 'translate') {
        const toks = tokens(head.replace(/^\s*translate\b/i, ''));
        // entries are a token and a name; the comma between them is optional, and with commas an entry that is not a pair is skipped
        const bad: string[] = [];
        if (toks.includes(',')) {
          let entry: string[] = [];
          for (const t of [...toks, ',']) {
            if (t !== ',') entry.push(t);
            else {
              if (entry.length === 2) cur.translate.set(entry[0], entry[1]);
              else if (entry.length) bad.push(entry.join(' '));
              entry = [];
            }
          }
        } else {
          for (let i = 0; i + 1 < toks.length; i += 2) cur.translate.set(toks[i], toks[i + 1]);
          if (toks.length % 2) bad.push(toks[toks.length - 1]);
        }
        if (bad.length) {
          note(
            'nexus-translate-malformed',
            'trees',
            `${bad.length} TRANSLATE entries are not a token and a name (a name with spaces needs quotes) and were skipped (${sample(bad)})`,
            cur.at,
          );
        }
      } else if (block === 'trees' && (kw === 'tree' || kw === 'utree')) {
        if (addTree(st, from, cur)) cur = null;
      }
    }
  } catch (e) {
    // The scan stops at what it cannot read; the trees found before that stay readable
    if (!(e instanceof NewickError)) throw e;
    scanError = e;
    note('nexus-scan-stopped', '', `The rest of the file was not looked through: ${e.message}`, p);
  }

  for (const bl of blocks) {
    if (bl.unreadable)
      note('nexus-block-unreadable', bl.name, `Part of the ${bl.name.toUpperCase()} block could not be read (unterminated quote)`, bl.at);
    if (!['taxa', 'trees', 'characters', 'data'].includes(bl.name)) {
      note('nexus-ignored-block', bl.name, `The ${bl.name.toUpperCase()} block (${bl.statements} statements) is not read`, bl.at);
    }
  }
  // The links: which TAXA block each TREES block uses, and which TAXA blocks nothing uses
  const taxaBlocks = blocks.filter((bl) => bl.name === 'taxa');
  const usedTaxa = new Set<NexusBlock>();
  for (const tb of blocks.filter((bl) => bl.name === 'trees')) {
    const used = taxaOf(tb);
    if (used) usedTaxa.add(used);
    if (!taxaBlocks.length) continue;
    if (tb.link) {
      if (!used) note('nexus-taxa-link-unresolved', 'trees', `The TREES block links to TAXA "${tb.link}", but no TAXA block has that TITLE`, tb.at);
    } else if (taxaBlocks.length > 1) {
      note(
        'nexus-taxa-ambiguous',
        'trees',
        `The file has ${taxaBlocks.length} TAXA blocks and the TREES block has no LINK; ${used ? 'the last one before it was assumed' : 'none comes before it, so none was used'}`,
        tb.at,
      );
    }
  }
  for (const x of taxaBlocks) {
    if (!usedTaxa.has(x)) {
      note(
        'nexus-taxa-unused',
        'taxa',
        `The TAXA block${x.title ? ` "${x.title}"` : ''} (${x.labels.length} taxa) is not used by any TREES block`,
        x.at,
      );
    } else if (x.ntax >= 0 && x.ntax !== x.labels.length) {
      note('nexus-ntax-mismatch', 'taxa', `The TAXA block says NTAX=${x.ntax} but lists ${x.labels.length} taxa`, x.at);
    }
  }
  notes.sort((x, y) => x.position - y.position);

  const hasSequences = blocks.some((bl) => bl.name === 'characters' || bl.name === 'data');
  const parse = (i: number): NexusTreeResult => {
    const e = entries[i];
    if (!e) {
      if (scanError) throw scanError;
      throw new NewickError(
        `no tree number ${i} in NEXUS (saw ${entries.length}; blocks: ${blocks.length ? blocks.map((b) => b.name).join(', ') : 'none'})`,
        text.length,
      );
    }
    if (e.error) throw new NewickError(e.error, e.info.end);
    // body: [comment] newick, with comments still in place (parseNewick skips them)
    let body = text.slice(e.from, e.to).slice(e.eq + 1);
    if (e.endAt >= 0) body = body.slice(0, e.endAt);
    const noSemicolon = e.endAt >= 0 || !e.terminated;
    if (noSemicolon && strict) {
      throw new NewickError('[missing-trailing-semicolon] the TREE command has no ";" after the tree', e.info.end);
    }
    const tree = parseNewick(body + ';', opts);
    // A tip is named by its TRANSLATE token, else by a taxon label, else by a taxon number (its 1-based position in the
    // TAXA block): the order of the NEXUS standard, and DendroPy's. Numbers count only when every tip the table does not
    // name is an in-range number that is no taxon label (as in forester): a tree that mixes names and numbers has numbers
    // that are names (an accession such as 92829), and renaming one of them would be wrong without a word.
    const translate = e.block.translate;
    const used = taxaOf(e.block);
    const labels = used?.labels ?? [];
    const known = used ? taxaKeys(used) : new Set<string>();
    const rest = tree.tipLabels.filter((l) => !translate.has(l));
    const numbered = rest.length > 0 && rest.every((l) => /^[1-9]\d*$/.test(l) && Number(l) <= labels.length && !known.has(nameKey(l)));
    let byNumber = 0;
    // Tip labels that look like TRANSLATE ids (bare integers) but have no entry in the table and
    // no TAXA fallback are references to a missing translation. We keep the label (the viewer
    // still shows something) and surface a tree-level warning; strict mode throws.
    const missingTranslate: string[] = [];
    if (translate.size || labels.length) {
      tree.relabelTips((l) => {
        const t = translate.get(l);
        if (t !== undefined) return t;
        if (numbered) {
          byNumber++;
          return labels[Number(l) - 1];
        }
        if (translate.size && /^[1-9]\d*$/.test(l)) missingTranslate.push(l);
        return undefined;
      });
    }
    if (missingTranslate.length) {
      const w: ParserWarning = {
        code: 'unknown-translate-id',
        message: `tree references ${missingTranslate.length} TRANSLATE id${missingTranslate.length === 1 ? '' : 's'} not in the table: ${missingTranslate.slice(0, 5).join(', ')}${missingTranslate.length > 5 ? ', ...' : ''}`,
        position: e.block.at,
      };
      if (strict) throw new NewickError(`[${w.code}] ${w.message}`, w.position);
      (tree.warnings as ParserWarning[]).push(w);
    }
    if (headerWarn) (tree.warnings as ParserWarning[]).unshift({ ...headerWarn });
    if (noSemicolon) {
      (tree.warnings as ParserWarning[]).push({
        code: 'missing-trailing-semicolon',
        message: `The TREE command has no ";" after the tree (${e.endAt >= 0 ? 'END follows it' : 'the file ends'})`,
        position: e.info.end,
      });
    }
    // what depends on this tree's tips
    const own: NexusNote[] = [];
    if (used || hasSequences) {
      const tips = tipKeys(tree);
      if (used) {
        if (byNumber) {
          own.push({
            code: 'nexus-taxon-numbers',
            block: 'trees',
            message: `${byNumber} tips were taxon numbers and were replaced by the label at that position in the TAXA block`,
            position: e.block.at,
          });
        }
        const names = taxaKeys(used);
        const noTaxon = [...tips].filter(([k]) => !names.has(k)).map(([, l]) => l);
        // the taxa that have no tip are listed only when there are some: all taxa have one when the tips cover the names
        if (noTaxon.length || names.size > tips.size - noTaxon.length) {
          const noTip = used.labels.filter((l) => !tips.has(nameKey(l)));
          own.push({
            code: 'nexus-taxa-mismatch',
            block: 'taxa',
            message: `The tree has ${noTaxon.length} tips that are not in the TAXA block (${sample(noTaxon)}), and the TAXA block has ${noTip.length} taxa with no tip (${sample(noTip)})`,
            position: used.at,
          });
        }
      }
      if (hasSequences) own.push(...sequenceNotes(blocks, used, tips));
    }
    return { tree, info: e.info, translateEntries: translate.size, ignored: own };
  };
  for (const e of entries) Object.freeze(e.info);
  Object.freeze(notes);
  return { trees: entries.map((e) => e.info), ignored: notes, parse, blocks, taxaOf, blockOf: (i) => entries[i].block };
}

/** Where the TREE keyword starts in a statement: after its whitespace and comments. */
function keywordAt(stmt: string): number {
  let p = 0;
  for (;;) {
    while (p < stmt.length && isWs(stmt.charCodeAt(p))) p++;
    if (stmt.charCodeAt(p) !== 91) return p;
    p = skipComment(stmt, p);
  }
}

/** The name keys of the labels of a TAXA block, kept on the block. */
function taxaKeys(bl: NexusBlock): Set<string> {
  return (bl.keys ??= new Set(bl.labels.map(nameKey)));
}

/** Name key to tip label of a tree. */
function tipKeys(tree: TreeModel): Map<string, string> {
  const tips = new Map<string, string>();
  for (let r = 0; r < tree.tipCount; r++) tips.set(nameKey(tree.labels[tree.tipNode[r]]), tree.labels[tree.tipNode[r]]);
  return tips;
}

/** Notes on the CHARACTERS and DATA blocks: the sequences are not read; do their rows line up with the tips of the tree? */
function sequenceNotes(blocks: NexusBlock[], used: NexusBlock | null, tips: Map<string, string>): NexusNote[] {
  const out: NexusNote[] = [];
  const note = (code: string, block: string, message: string, position: number): void => {
    out.push({ code, block, message, position });
  };
  for (const bl of blocks) {
    if (bl.name !== 'characters' && bl.name !== 'data') continue;
    const what = `The ${bl.name.toUpperCase()} block (${bl.rows.size} sequences${bl.nchar >= 0 ? `, ${bl.nchar} characters` : ''}) is not read`;
    if (bl.link && used && bl.link !== used.title) {
      note(
        'nexus-sequences-unlinked',
        bl.name,
        `${what}; it links to the TAXA block "${bl.link}", not the one the tree uses, so it was not compared with the tips`,
        bl.at,
      );
      continue;
    }
    const expected = bl.ntax >= 0 ? bl.ntax : bl.name === 'characters' && used ? used.labels.length : -1;
    if (expected >= 0 && bl.rows.size > expected) {
      note(
        'nexus-sequences-unlinked',
        bl.name,
        `${what}; its rows could not be told apart from wrapped lines, so they were not compared with the tips`,
        bl.at,
      );
      continue;
    }
    const noTip = [...bl.rows].filter(([k]) => !tips.has(k)).map(([, l]) => l);
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
  return out;
}

/** The trees of a NEXUS file, found in one pass that parses none of them. `index.parse(i)` reads tree i alone, so the
 *  trees of a file of thousands can be read one by one (or all in turn with nexusTrees) without a rescan. */
export function nexusIndex(text: string, o: ParseOptions = {}): NexusIndex {
  const { trees, ignored, parse } = buildIndex(text, o);
  return { trees, ignored, parse };
}

/** Every tree of a NEXUS file in turn, each parsed when it is asked for. */
export function* nexusTrees(text: string, o: ParseOptions = {}): Generator<NexusTreeResult> {
  const index = nexusIndex(text, o);
  for (let i = 0; i < index.trees.length; i++) yield index.parse(i);
}

/** Read tree number `treeIndex` (0-based) from a NEXUS document, applying its TRANSLATE table. The rest of the file is
 *  scanned too, and what is not read or not connected to the tree is listed in `ignored`. */
export function parseNexus(text: string, treeIndex?: number, o?: ParseOptions): NexusResult;
export function parseNexus(text: string, o: ParseOptions & { treeIndex?: number }): NexusResult;
export function parseNexus(text: string, a: number | (ParseOptions & { treeIndex?: number }) = 0, b: ParseOptions = {}): NexusResult {
  const obj = typeof a === 'object' && a !== null ? a : null; // null and undefined read as the defaults
  const opts: ParseOptions = obj ?? b ?? {};
  const treeIndex = typeof a === 'number' ? a : (obj?.treeIndex ?? 0);
  const idx = buildIndex(text, opts);
  const r = idx.parse(treeIndex);
  const block = idx.blockOf(treeIndex);
  const used = idx.taxaOf(block);
  // The notes about the file that concern this tree: the links of its own TREES block and the TAXA block it uses
  const notes = idx.ignored.filter((n) => {
    if (n.code === 'nexus-taxa-unused') return false; // said below, of the tree that was read
    if (n.code === 'nexus-taxa-link-unresolved' || n.code === 'nexus-taxa-ambiguous') return n.position === block.at;
    if (n.code === 'nexus-ntax-mismatch') return used !== null && n.position === used.at;
    return true;
  });
  for (const x of idx.blocks) {
    if (x.name === 'taxa' && x !== used) {
      notes.push({
        code: 'nexus-taxa-unused',
        block: 'taxa',
        message: `The TAXA block${x.title ? ` "${x.title}"` : ''} (${x.labels.length} taxa) is not connected to the tree that was read`,
        position: x.at,
      });
    }
  }
  notes.push(...r.ignored);
  if (idx.trees.length > 1) {
    notes.push({
      code: 'nexus-other-trees',
      block: 'trees',
      message: `The file holds ${idx.trees.length} trees; only tree ${treeIndex + 1} (${r.info.name || 'unnamed'}) was read`,
      position: block.at,
    });
  }
  notes.sort((x, y) => x.position - y.position);
  return {
    tree: r.tree,
    treeName: r.info.name,
    treesSeen: treeIndex + 1,
    treeCount: idx.trees.length,
    translateEntries: r.translateEntries,
    ignored: notes,
  };
}
