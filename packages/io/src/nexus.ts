// The NEXUS reader and writer: parseNexus (one tree, with its TRANSLATE table), nexusIndex / nexusTrees (every tree of a file) and
// toNexus. A tree is read by parseNewick and written by the Newick writer (see newick.ts); this module reads the blocks around it.

import { NewickError, isWs, parseNewick, skipComment, writeTree } from './newick.ts';
import type { ParseOptions, WriteOptions } from './newick.ts';
import type { ParserWarning, TreeModel } from './tree.ts';

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
