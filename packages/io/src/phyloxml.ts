// Iterative phyloXML reader (https://phyloxml.org): a small XML scanner of our own, no DOM and no recursion, so a 1,000,000-deep
// caterpillar parses and the document is never held in memory as a tree. It reads what a tree viewer needs (clade nesting,
// names, branch lengths, support, taxonomy, sequence names, events, colours, properties) and counts the elements it does not
// read. Only elements in the phyloXML namespace (or in none, as some producers write it) are read; elements of other namespaces,
// which phyloXML allows anywhere, are counted as not read under their qualified name. Not handled: custom entities declared in
// a DOCTYPE, XML encodings other than the string it is given.

import { Annotations, type AnnotationRecord, type AnnotationValue } from './annotations.ts';
import { NewickError, type ParseOptions } from './newick.ts';
import { TreeModel, type ParserWarning, type RawTree } from './tree.ts';

export interface PhyloXmlOptions extends ParseOptions {
  /** Which `<phylogeny>` to return (0-based). Default 0. */
  treeIndex?: number;
  /** What names a node. `'name'` (default): the clade's `<name>`, else its taxonomy's scientific name, code or common name, else
   *  its sequence's name or accession. `'scientific_name'`: the scientific name first, which is what GBIF can match. */
  labelBy?: 'name' | 'scientific_name';
}

/** Something in a phyloXML file that was not read. */
export interface PhyloXmlNote extends ParserWarning {
  /** The element path it concerns, e.g. `clade/distribution`. */
  path: string;
}

export interface PhyloXmlResult {
  tree: TreeModel;
  /** The `<name>` of the phylogeny ('' if none). */
  treeName: string;
  /** The `rooted` attribute of the phylogeny, null when it has none. */
  rooted: boolean | null;
  /** The `branch_length_unit` attribute of the phylogeny, '' when it has none. */
  lengthUnit: string;
  /** Number of `<phylogeny>` elements in the file. */
  treeCount: number;
  /** The elements that were not read, one note per element path with the number of times it occurs (code `phyloxml-ignored-element`). */
  ignored: PhyloXmlNote[];
}

const isWs = (c: number): boolean => c === 32 || c === 10 || c === 13 || c === 9;

/** The name of an element or attribute without its namespace prefix. */
const local = (name: string): string => name.slice(name.indexOf(':') + 1);

const PHYLOXML_NS = 'http://www.phyloxml.org';

const ENTITY = /&(?:#x([0-9a-fA-F]+)|#(\d+)|(lt|gt|amp|quot|apos));/g;
const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
function decode(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(ENTITY, (m, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
    if (name) return NAMED[name];
    const cp = hex ? parseInt(hex, 16) : Number(dec);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });
}

function grow<T extends Int32Array | Float64Array>(a: T, n: number): T {
  const b = new (a.constructor as new (n: number) => T)(n);
  b.set(a);
  return b;
}

/** Elements of a clade that are read, by parent element: the text elements are captured, the containers are entered. */
const CAPTURED: Record<string, readonly string[]> = {
  clade: ['name', 'branch_length', 'confidence', 'width', 'node_id', 'property'],
  taxonomy: ['id', 'code', 'scientific_name', 'common_name', 'rank'],
  sequence: ['accession', 'name', 'symbol', 'location'],
  events: ['type', 'duplications', 'speciations', 'losses', 'confidence'],
  color: ['red', 'green', 'blue'],
};
const CONTAINERS: Record<string, readonly string[]> = {
  clade: ['clade', 'taxonomy', 'sequence', 'events', 'color'],
};

/** Read phylogeny number `treeIndex` (0-based) from a phyloXML document. */
export function parsePhyloXml(text: string, treeIndex?: number, o?: PhyloXmlOptions): PhyloXmlResult;
export function parsePhyloXml(text: string, o: PhyloXmlOptions): PhyloXmlResult;
export function parsePhyloXml(text: string, a: number | PhyloXmlOptions = 0, b: PhyloXmlOptions = {}): PhyloXmlResult {
  const obj = typeof a === 'object' && a !== null ? a : null;
  const opts: PhyloXmlOptions = obj ?? b ?? {};
  const want = typeof a === 'number' ? a : (obj?.treeIndex ?? 0);
  const annot = opts.annotations === true;
  const strict = opts.strict === true;
  const bySci = opts.labelBy === 'scientific_name';
  const warnings: ParserWarning[] = [];
  const warn = (code: string, message: string, position: number): void => {
    if (strict) throw new NewickError(`[${code}] ${message}`, position);
    warnings.push({ code, message, position });
  };
  const n = text.length;

  // the tree being built
  let cap = 64;
  let parent = new Int32Array(cap);
  let subtreeEnd = new Int32Array(cap);
  let depth = new Int32Array(cap);
  let length = new Float64Array(cap).fill(NaN);
  let support = new Float64Array(cap).fill(NaN);
  let leafStart = new Int32Array(cap);
  let leafEnd = new Int32Array(cap);
  const names: string[] = []; // <name> of each node
  const sci: string[] = []; // taxonomy scientific name
  const alt: string[] = []; // first of taxonomy code, common name, sequence name, accession
  let stack = new Int32Array(64);
  let sp = 0;
  let count = 0;
  let tips = 0;
  const nodeAnn = new Map<number, AnnotationRecord>();
  const put = (key: string, value: AnnotationValue): void => {
    const i = stack[sp - 1];
    let r = nodeAnn.get(i);
    if (!r) nodeAnn.set(i, (r = {}));
    if (!(key in r)) r[key] = value;
  };

  // the document
  const open: string[] = []; // the open elements: the local name of a phyloXML element, the qualified name of any other
  const ns = new Map<string, string[]>(); // namespace prefix ('' for the default) -> the declarations in scope, innermost last
  const nsAt: (string[] | null)[] = []; // by element depth: the prefixes the element declares
  const decls: string[] = []; // the declarations of the tag being read, prefix and URI in turn
  const roles = new Map<string, string>(); // qualified name -> role, valid until a declaration comes into or goes out of scope
  const ignoredCount = new Map<string, { n: number; at: number }>();
  let ignoreAt = -1; // open.length of the element whose content is skipped (-1: none)
  let quiet = false; // the skipped content is a phylogeny that was not asked for: not counted
  let phylo = -1; // index of the current phylogeny
  let selected = false;
  let seen = 0;
  let treeName = '';
  let rooted: boolean | null = null;
  let lengthUnit = '';
  let sawRoot = false;
  let capKey = ''; // the element whose text is being captured
  let capText = '';
  let capAttr = ''; // the `type` attribute of a confidence
  let capDepth = 0;
  const attrs: string[] = [];

  const skip = (path: string, at: number): void => {
    ignoreAt = open.length;
    if (quiet) return;
    const e = ignoredCount.get(path);
    if (e) e.n++;
    else ignoredCount.set(path, { n: 1, at });
  };
  const number = (s: string, what: string, at: number): number => {
    const v = s.trim() === '' ? NaN : Number(s);
    if (Number.isNaN(v)) warn('non-numeric-length', `${what} "${s.trim().slice(0, 30)}" is not a number`, at);
    return v;
  };
  const attr = (name: string): string | undefined => {
    for (let i = 0; i < attrs.length; i += 2) if (attrs[i] === name) return attrs[i + 1];
    return undefined;
  };

  /** The name an element goes by: its local name when it is phyloXML (its namespace is the phyloXML one, or none is declared),
   *  else `{namespace}local`, which no phyloXML name can equal (the qualified name as written if its prefix is not declared). */
  const roleOf = (qname: string): string => {
    const known = roles.get(qname);
    if (known !== undefined) return known;
    const role = roleUncached(qname);
    roles.set(qname, role);
    return role;
  };
  const roleUncached = (qname: string): string => {
    const c = qname.indexOf(':');
    const uris = ns.get(c < 0 ? '' : qname.slice(0, c));
    const uri = uris?.[uris.length - 1];
    if (c < 0 ? uri === undefined || uri === '' || uri === PHYLOXML_NS : uri === PHYLOXML_NS) return qname.slice(c + 1);
    return uri === undefined ? qname : `{${uri}}${qname.slice(c + 1)}`;
  };
  const popNs = (k: number): void => {
    const pushed = nsAt[k];
    if (!pushed) return;
    for (const prefix of pushed) ns.get(prefix)?.pop();
    nsAt[k] = null;
    roles.clear();
  };

  const openClade = (at: number): void => {
    if (count === cap) {
      cap *= 2;
      parent = grow(parent, cap);
      subtreeEnd = grow(subtreeEnd, cap);
      depth = grow(depth, cap);
      const l = grow(length, cap);
      l.fill(NaN, count);
      length = l;
      const s = grow(support, cap);
      s.fill(NaN, count);
      support = s;
      leafStart = grow(leafStart, cap);
      leafEnd = grow(leafEnd, cap);
    }
    if (sp === 0 && count > 0) throw new NewickError('more than one root clade in the phylogeny', at);
    const i = count++;
    parent[i] = sp > 0 ? stack[sp - 1] : -1;
    depth[i] = sp;
    leafStart[i] = tips;
    names.push('');
    sci.push('');
    alt.push('');
    if (sp === stack.length) stack = grow(stack, sp * 2);
    stack[sp++] = i;
    const bl = attr('branch_length');
    if (bl !== undefined) length[i] = number(bl, 'branch_length', at);
    if (annot) {
      const id = attr('id_source');
      if (id !== undefined) put('id_source', id);
    }
  };
  const closeClade = (): void => {
    const i = stack[--sp];
    subtreeEnd[i] = count;
    if (count === i + 1) tips++; // no clade inside: a tip
    leafEnd[i] = tips;
  };

  const startElement = (name: string, at: number): void => {
    const parentName = open.length ? open[open.length - 1] : '';
    open.push(name);
    if (ignoreAt >= 0) return;
    if (open.length === 1) {
      if (name !== 'phyloxml' && name !== 'phylogeny') throw new NewickError(`not phyloXML: the root element is <${name}>`, at);
      sawRoot = true;
      if (name === 'phylogeny') startPhylogeny();
      return;
    }
    if (parentName === 'phyloxml') {
      if (name === 'phylogeny') startPhylogeny();
      else skip(`phyloxml/${name}`, at);
      return;
    }
    if (!selected) return; // inside an unselected phylogeny (ignoreAt is set at its start)
    const grand = open.length > 2 ? open[open.length - 3] : '';
    if (parentName === 'phylogeny') {
      if (name === 'clade') openClade(at);
      else if (name === 'name') capture('phylogeny/name');
      else skip(`phylogeny/${name}`, at);
    } else if (parentName === 'clade') {
      if (name === 'clade') openClade(at);
      else if (CAPTURED.clade.includes(name)) capture(`clade/${name}`);
      else if (!CONTAINERS.clade.includes(name)) skip(`clade/${name}`, at); // the containers are entered
    } else if (grand === 'clade' && CAPTURED[parentName]?.includes(name)) {
      capture(`${parentName}/${name}`);
    } else if (grand === 'clade' && CAPTURED[parentName]) {
      skip(`${parentName}/${name}`, at); // an element of taxonomy, sequence, events or color that is not read
    }
    // anything else is inside an element that is entered but not captured (the children of a text element)
  };
  const startPhylogeny = (): void => {
    phylo++;
    seen = phylo + 1;
    selected = phylo === want;
    if (!selected) {
      ignoreAt = open.length;
      quiet = true;
      return;
    }
    const r = attr('rooted');
    rooted = r === undefined ? null : r === 'true' || r === '1';
    lengthUnit = attr('branch_length_unit') ?? '';
  };
  const capture = (key: string): void => {
    capKey = key;
    capText = '';
    capDepth = open.length;
    capAttr = key === 'clade/confidence' || key === 'events/confidence' ? (attr('type') ?? '') : key === 'clade/property' ? (attr('ref') ?? '') : '';
  };
  const endCapture = (at: number): void => {
    const key = capKey;
    capKey = '';
    const t = capText.trim();
    if (key === 'phylogeny/name') {
      treeName = t;
      return;
    }
    const i = stack[sp - 1];
    switch (key) {
      case 'clade/name':
        names[i] = t;
        if (annot && t) put('name', t);
        break;
      case 'clade/branch_length':
        if (Number.isNaN(length[i])) length[i] = number(t, 'branch_length', at);
        break;
      case 'clade/confidence': {
        const v = t === '' ? NaN : Number(t);
        if (!Number.isNaN(v)) {
          if (Number.isNaN(support[i])) support[i] = v;
          if (annot) put(`confidence${capAttr ? '.' + capAttr : ''}`, v);
        }
        break;
      }
      case 'clade/width':
        if (annot && t !== '' && !Number.isNaN(Number(t))) put('width', Number(t));
        break;
      case 'clade/node_id':
        if (annot && t) put('node_id', t);
        break;
      case 'clade/property':
        if (annot && capAttr) put(`property.${capAttr}`, t !== '' && !Number.isNaN(Number(t)) ? Number(t) : t);
        break;
      case 'taxonomy/scientific_name':
        if (!sci[i]) sci[i] = t;
        if (annot && t) put('taxonomy.scientific_name', t);
        break;
      case 'taxonomy/code':
      case 'taxonomy/common_name':
      case 'sequence/name':
      case 'sequence/accession':
        if (!alt[i]) alt[i] = t;
        if (annot && t) put(`${key.replace('/', '.')}`, t);
        break;
      case 'taxonomy/id':
      case 'taxonomy/rank':
      case 'sequence/symbol':
      case 'sequence/location':
      case 'events/type':
        if (annot && t) put(key.replace('/', '.'), t);
        break;
      case 'events/confidence': {
        const v = t === '' ? NaN : Number(t);
        if (annot && !Number.isNaN(v)) put(`events.confidence${capAttr ? '.' + capAttr : ''}`, v);
        break;
      }
      case 'events/duplications':
      case 'events/speciations':
      case 'events/losses':
        if (annot && t !== '' && !Number.isNaN(Number(t))) put(key.replace('/', '.'), Number(t));
        break;
      case 'color/red':
      case 'color/green':
      case 'color/blue':
        if (annot && t !== '' && !Number.isNaN(Number(t))) put(`color.${key.slice(6)}`, Number(t));
        break;
    }
  };
  const endElement = (name: string, at: number): void => {
    if (open.length === 0) throw new NewickError(`</${name}> closes nothing`, at);
    const top = open[open.length - 1];
    if (top !== name) throw new NewickError(`</${name}> does not match <${top}>`, at);
    if (ignoreAt >= 0) {
      if (open.length === ignoreAt) {
        ignoreAt = -1;
        quiet = false;
      }
      open.pop();
      return;
    }
    if (capKey && open.length === capDepth) endCapture(at);
    if (name === 'clade' && selected && open.length > 1 && sp > 0) closeClade();
    if (name === 'phylogeny') selected = false;
    open.pop();
  };

  // the scan
  let p = 0;
  while (p < n) {
    const lt = text.indexOf('<', p);
    if (lt < 0) break;
    if (lt > p && capKey && ignoreAt < 0) capText += decode(text.slice(p, lt));
    const c = text.charCodeAt(lt + 1);
    if (c === 33) {
      if (text.startsWith('<!--', lt)) {
        const e = text.indexOf('-->', lt + 4);
        if (e < 0) throw new NewickError('unterminated comment', lt);
        p = e + 3;
      } else if (text.startsWith('<![CDATA[', lt)) {
        const e = text.indexOf(']]>', lt + 9);
        if (e < 0) throw new NewickError('unterminated CDATA section', lt);
        if (capKey && ignoreAt < 0) capText += text.slice(lt + 9, e);
        p = e + 3;
      } else {
        // <!DOCTYPE ...>, with an internal subset in [...] and quoted strings that may hold '>'
        let q = lt + 2;
        let br = 0;
        for (; q < n; q++) {
          const d = text.charCodeAt(q);
          if (d === 34 || d === 39) {
            const e = text.indexOf(text[q], q + 1);
            if (e < 0) throw new NewickError('unterminated quote in DOCTYPE', q);
            q = e;
          } else if (d === 91) br++;
          else if (d === 93) br--;
          else if (d === 62 && br <= 0) break;
        }
        if (q >= n) throw new NewickError('unterminated DOCTYPE', lt);
        p = q + 1;
      }
    } else if (c === 63) {
      const e = text.indexOf('?>', lt + 2);
      if (e < 0) throw new NewickError('unterminated processing instruction', lt);
      p = e + 2;
    } else if (c === 47) {
      const e = text.indexOf('>', lt + 2);
      if (e < 0) throw new NewickError('unterminated end tag', lt);
      const qname = text.slice(lt + 2, e).trim();
      endElement(roleOf(qname), lt);
      popNs(open.length);
      p = e + 1;
    } else {
      let q = lt + 1;
      while (q < n && !isWs(text.charCodeAt(q)) && text.charCodeAt(q) !== 62 && text.charCodeAt(q) !== 47) q++;
      const qname = text.slice(lt + 1, q);
      if (qname === '' || qname === ':') throw new NewickError("'<' with no element name", lt);
      attrs.length = 0;
      decls.length = 0;
      let self = false;
      for (;;) {
        while (q < n && isWs(text.charCodeAt(q))) q++;
        if (q >= n) throw new NewickError(`unterminated <${qname}> tag`, lt);
        const d = text.charCodeAt(q);
        if (d === 62) {
          q++;
          break;
        }
        if (d === 47 && text.charCodeAt(q + 1) === 62) {
          self = true;
          q += 2;
          break;
        }
        const s = q;
        while (q < n && !isWs(text.charCodeAt(q)) && text.charCodeAt(q) !== 61 && text.charCodeAt(q) !== 62 && text.charCodeAt(q) !== 47) q++;
        const rawName = text.slice(s, q);
        const an = local(rawName);
        while (q < n && isWs(text.charCodeAt(q))) q++;
        let value = '';
        if (text.charCodeAt(q) === 61) {
          q++;
          while (q < n && isWs(text.charCodeAt(q))) q++;
          const quote = text.charCodeAt(q);
          if (quote !== 34 && quote !== 39) throw new NewickError(`attribute ${an} of <${qname}> has no quoted value`, q);
          const e = text.indexOf(text[q], q + 1);
          if (e < 0) throw new NewickError(`unterminated attribute value in <${qname}>`, q);
          value = decode(text.slice(q + 1, e));
          q = e + 1;
        }
        if (rawName === 'xmlns') decls.push('', value);
        else if (rawName.startsWith('xmlns:')) decls.push(rawName.slice(6), value);
        else if (an !== '') attrs.push(an, value);
      }
      const k = open.length; // the depth the element gets
      if (decls.length) {
        const pushed: string[] = [];
        for (let d = 0; d < decls.length; d += 2) {
          const prefix = decls[d];
          const uris = ns.get(prefix);
          if (uris) uris.push(decls[d + 1]);
          else ns.set(prefix, [decls[d + 1]]);
          pushed.push(prefix);
        }
        nsAt[k] = pushed;
        roles.clear();
      } else nsAt[k] = null;
      const role = roleOf(qname);
      startElement(role, lt);
      if (self) {
        endElement(role, lt);
        popNs(k);
      }
      p = q;
    }
  }
  if (!sawRoot) throw new NewickError('not phyloXML: no element found', 0);
  if (open.length) throw new NewickError(`<${open[open.length - 1]}> is not closed`, n);
  if (!selected && phylo < want) {
    throw new NewickError(`no phylogeny number ${want} in phyloXML (saw ${seen})`, n);
  }
  if (count === 0) throw new NewickError(`phylogeny number ${want} has no clade`, n);

  const labels: string[] = new Array<string>(count);
  for (let i = 0; i < count; i++) labels[i] = bySci ? sci[i] || names[i] || alt[i] : names[i] || sci[i] || alt[i];
  const slice = <T extends Int32Array | Float64Array>(x: T): T => x.slice(0, count) as T;
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
    annotations: annot ? new Annotations(count, nodeAnn) : undefined,
    warnings,
  };
  const ignored: PhyloXmlNote[] = [];
  for (const [path, e] of ignoredCount) {
    ignored.push({
      code: 'phyloxml-ignored-element',
      path,
      message: `${e.n} <${path.slice(path.lastIndexOf('/') + 1)}> element${e.n === 1 ? '' : 's'} (in <${path.slice(0, path.lastIndexOf('/'))}>) not read`,
      position: e.at,
    });
  }
  ignored.sort((x, y) => x.position - y.position);
  return { tree: new TreeModel(raw), treeName, rooted, lengthUnit, treeCount: seen, ignored };
}
