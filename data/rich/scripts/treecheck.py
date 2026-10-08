#!/usr/bin/env python3
"""Parse a tree file and report tips, internal labels and branch-length statistics.
Pure stdlib, iterative (no recursion), safe for caterpillar trees. Run with `python3 -I`.

Usage: treecheck.py <file> [more files]   (.gz is transparently read)
       treecheck.py --tips <file>          (print tip names of the first tree, one per line)
Formats by extension / sniffing: Newick (.nwk .nh .tre .tree), NHX, Nexus (.nex .nexus .trees; TRANSLATE
and [&R]/[&U] handled, every tree reported), phyloXML (.xml/.phyloxml), Auspice v2 JSON (.json).
Prints one JSON object per tree on stdout.

Branch length statistics: n_with (edges with a length), n_missing (non-root nodes without), min/max/median,
n_zero, n_negative, max_over_median, ultrametric (True when root-to-tip distance spread < 1e-4 relative
to the mean, when all lengths present).
"""
import gzip
import json
import re
import statistics
import sys
import xml.etree.ElementTree as ET


def read_text(path):
    op = gzip.open if path.endswith('.gz') else open
    with op(path, 'rb') as f:
        return f.read().decode('utf-8', errors='replace')


# ---------------------------------------------------------------- newick
def parse_newick(s):
    """Return (nodes) as list of dict(name, length, parent, nchild). Iterative stack parser.
    Comments [..] are skipped (their text kept in 'comment'). Quoted labels use '' escape."""
    nodes = []
    stack = []
    cur = None
    i, n = 0, len(s)

    def new(parent):
        d = {'name': '', 'length': None, 'parent': parent, 'nchild': 0, 'comment': ''}
        nodes.append(d)
        if parent is not None:
            nodes[parent]['nchild'] += 1
        return len(nodes) - 1

    cur = new(None)
    expect_len = False
    while i < n:
        c = s[i]
        if c == '(':
            stack.append(cur)
            cur = new(cur)
            expect_len = False
            i += 1
        elif c == ',':
            cur = new(stack[-1])
            expect_len = False
            i += 1
        elif c == ')':
            cur = stack.pop()
            expect_len = False
            i += 1
        elif c == ';':
            break
        elif c == '[':
            j = s.find(']', i)
            if j < 0:
                raise ValueError('unterminated comment')
            nodes[cur]['comment'] += s[i + 1:j]
            i = j + 1
        elif c == ':':
            expect_len = True
            i += 1
        elif c.isspace():
            i += 1
        else:
            if c == "'":
                j = i + 1
                buf = []
                while True:
                    k = s.find("'", j)
                    if k < 0:
                        raise ValueError('unterminated quote')
                    buf.append(s[j:k])
                    if k + 1 < n and s[k + 1] == "'":
                        buf.append("'")
                        j = k + 2
                    else:
                        j = k + 1
                        break
                tok = ''.join(buf)
                i = j
            else:
                j = i
                while j < n and s[j] not in '(),:;[ \t\r\n':
                    j += 1
                tok = s[i:j]
                i = j
            if expect_len:
                try:
                    nodes[cur]['length'] = float(tok)
                except ValueError:
                    raise ValueError('bad length %r' % tok)
                expect_len = False
            else:
                nodes[cur]['name'] = tok
    if stack:
        raise ValueError('unbalanced parentheses')
    return nodes


LAST_NODES = []


def stats_from_nodes(nodes, rooted_hint=None):
    LAST_NODES.append(nodes)
    n = len(nodes)
    tips = [k for k, d in enumerate(nodes) if d['nchild'] == 0]
    internal = [k for k, d in enumerate(nodes) if d['nchild'] > 0]
    nonroot = [k for k in range(n) if nodes[k]['parent'] is not None]
    lens = [nodes[k]['length'] for k in nonroot if nodes[k]['length'] is not None]
    out = {
        'tips': len(tips), 'internal_nodes': len(internal), 'nodes': n,
        'internal_labelled': sum(1 for k in internal if nodes[k]['name']),
        'root_children': nodes[0]['nchild'],
        'max_children': max(d['nchild'] for d in nodes),
        'polytomies': sum(1 for k in internal if nodes[k]['nchild'] > 2 and nodes[k]['parent'] is not None),
        'duplicate_tip_names': len([k for k in tips]) - len({nodes[k]['name'] for k in tips}),
        'tip_names_with_space': sum(1 for k in tips if ' ' in nodes[k]['name']),
        'tip_names_with_underscore': sum(1 for k in tips if '_' in nodes[k]['name']),
    }
    out['branch_lengths'] = length_stats(lens, len(nonroot), nodes, tips)
    return out


def length_stats(lens, n_edges, nodes, tips):
    if not lens:
        return {'present': False, 'n_with': 0, 'n_missing': n_edges}
    med = statistics.median(lens)
    r = {
        'present': True, 'n_with': len(lens), 'n_missing': n_edges - len(lens),
        'min': min(lens), 'max': max(lens), 'median': med,
        'n_zero': sum(1 for x in lens if x == 0), 'n_negative': sum(1 for x in lens if x < 0),
        'max_over_median': (max(lens) / med) if med > 0 else None,
    }
    if r['n_missing'] == 0 and nodes is not None:
        # root-to-tip distance via parent chain walk, memoised iteratively
        dist = [None] * len(nodes)
        dist[0] = 0.0
        order = []
        # nodes are created in preorder, so parents precede children
        for k in range(1, len(nodes)):
            dist[k] = dist[nodes[k]['parent']] + (nodes[k]['length'] or 0.0)
        td = [dist[k] for k in tips]
        mean = sum(td) / len(td)
        spread = max(td) - min(td)
        r['root_to_tip_min'] = min(td)
        r['root_to_tip_max'] = max(td)
        r['ultrametric'] = bool(mean > 0 and spread / mean < 1e-4)
        r['root_to_tip_spread_rel'] = (spread / mean) if mean else None
    return r


# ---------------------------------------------------------------- nexus
def nexus_trees(text):
    """Yield (name, rooted_flag, newick_string_with_translated_labels, info)."""
    # strip top-level [comments] outside of tree statements is hard; scan blocks case-insensitively
    blocks = re.finditer(r'begin\s+(\w+)\s*;(.*?)\bend\s*;', text, flags=re.S | re.I)
    translate = {}
    info = {'blocks': []}
    for m in blocks:
        kind = m.group(1).lower()
        body = m.group(2)
        info['blocks'].append(kind)
        if kind == 'trees':
            tm = re.search(r'translate\s(.*?);', body, flags=re.S | re.I)
            if tm:
                for part in split_top(tm.group(1)):
                    part = part.strip()
                    if not part:
                        continue
                    k, v = part.split(None, 1)
                    v = v.strip()
                    if v.startswith("'") and v.endswith("'"):
                        v = v[1:-1].replace("''", "'")
                    translate[k] = v
            for tmatch in re.finditer(r'\btree\s+(\*?\s*(?:\'[^\']*\'|[^\s=]+))\s*=\s*((?:\[&[RU]\])?)\s*(.*?;)', body, flags=re.S | re.I):
                name = tmatch.group(1).strip()
                flag = tmatch.group(2)
                yield name, flag, tmatch.group(3), translate, dict(info)


def split_top(s):
    out, buf, q = [], [], False
    for ch in s:
        if ch == "'":
            q = not q
        if ch == ',' and not q:
            out.append(''.join(buf))
            buf = []
        else:
            buf.append(ch)
    out.append(''.join(buf))
    return out


# ---------------------------------------------------------------- phyloxml
def strip_ns(t):
    return t.rsplit('}', 1)[-1]


def parse_phyloxml(text):
    """Iterative: returns list of trees; each a list of node dicts (preorder)."""
    root = ET.fromstring(text)
    trees = []
    for phy in [e for e in root if strip_ns(e.tag) == 'phylogeny']:
        nodes = []
        stack = []
        first = [e for e in phy if strip_ns(e.tag) == 'clade']
        if not first:
            continue
        work = [(first[0], None)]
        while work:
            el, parent = work.pop()
            d = {'name': '', 'length': None, 'parent': parent, 'nchild': 0, 'comment': '', 'extra': set()}
            idx = len(nodes)
            nodes.append(d)
            if parent is not None:
                nodes[parent]['nchild'] += 1
            kids = []
            bl = el.get('branch_length')
            for ch in el:
                t = strip_ns(ch.tag)
                if t == 'clade':
                    kids.append(ch)
                elif t == 'name':
                    d['name'] = (ch.text or '').strip()
                elif t == 'branch_length':
                    bl = (ch.text or '').strip()
                else:
                    d['extra'].add(t)
            if bl not in (None, ''):
                d['length'] = float(bl)
            for ch in reversed(kids):
                work.append((ch, idx))
        trees.append((phy.get('rooted'), phy.get('type'), nodes))
    return trees


# ---------------------------------------------------------------- auspice
def parse_auspice(obj):
    nodes = []
    work = [(obj['tree'], None)]
    attrs = set()
    while work:
        el, parent = work.pop()
        idx = len(nodes)
        div = (el.get('node_attrs') or {}).get('div')
        ba = el.get('branch_attrs') or {}
        attrs.update((el.get('node_attrs') or {}).keys())
        d = {'name': el.get('name', ''), 'length': None, 'parent': parent, 'nchild': 0, 'comment': '', 'div': div}
        nodes.append(d)
        if parent is not None:
            nodes[parent]['nchild'] += 1
        for ch in reversed(el.get('children') or []):
            work.append((ch, idx))
    # Auspice stores cumulative divergence in node_attrs.div; convert to per-branch length
    for k in range(1, len(nodes)):
        a, b = nodes[k]['div'], nodes[nodes[k]['parent']]['div']
        if a is not None and b is not None:
            nodes[k]['length'] = a - b
    return nodes, attrs


# ---------------------------------------------------------------- driver
def report(path):
    text = read_text(path)
    p = path[:-3] if path.endswith('.gz') else path
    head = text.lstrip()[:200].lower()
    results = []
    if head.startswith('#nexus'):
        for name, flag, nw, translate, info in nexus_trees(text):
            nodes = parse_newick(nw)
            if translate:
                for d in nodes:
                    if d['nchild'] == 0 and d['name'] in translate:
                        d['name'] = translate[d['name']]
            r = stats_from_nodes(nodes)
            ck = set(re.findall(r'([A-Za-z_][\w.%]*)=', ' '.join(d['comment'] for d in nodes)))
            r.update({'comment_keys': sorted(ck)[:40], 'format': 'nexus', 'tree_name': name, 'rooted_flag': flag or None,
                      'translate_entries': len(translate)})
            results.append(r)
    elif head.startswith('<?xml') or head.startswith('<phyloxml'):
        for rooted, typ, nodes in parse_phyloxml(text):
            r = stats_from_nodes(nodes)
            ex = set()
            for d in nodes:
                ex |= d['extra']
            r.update({'format': 'phyloxml', 'rooted_attr': rooted, 'type_attr': typ,
                      'clade_elements': sorted(ex)})
            results.append(r)
    elif head.startswith('{'):
        obj = json.loads(text)
        nodes, attrs = parse_auspice(obj)
        r = stats_from_nodes(nodes)
        r.update({'format': 'auspice-json', 'version': obj.get('version'), 'node_attrs': sorted(attrs),
                  'colorings': [c.get('key') for c in obj.get('meta', {}).get('colorings', [])]})
        results.append(r)
    else:
        # newick (possibly several lines/trees)
        for chunk in re.findall(r'[^;]+;', text, flags=re.S):
            chunk = chunk.strip()
            if not chunk:
                continue
            nodes = parse_newick(chunk)
            r = stats_from_nodes(nodes)
            r['format'] = 'newick'
            r['nhx_tags'] = sorted(set(re.findall(r'[:\[](\w+)=', ''.join(d['comment'] for d in nodes))))
            bt = set(re.findall(r'(\w[\w%]*)=', ''.join(d['comment'] for d in nodes)))
            if bt:
                r['comment_keys'] = sorted(bt)[:40]
            results.append(r)
    return results


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--tips':
        # print tip names of the first tree, one per line
        report(sys.argv[2])
        nd = LAST_NODES[0]
        for d in nd:
            if d['nchild'] == 0:
                print(d['name'])
        sys.exit(0)
    for f in sys.argv[1:]:
        res = report(f)
        for i, r in enumerate(res):
            r['file'] = f
            r['tree_index'] = i
            if len(res) > 20 and i >= 3:
                continue
            print(json.dumps(r, sort_keys=True))
        if len(res) > 20:
            print(json.dumps({'file': f, 'trees_total': len(res), 'note': 'only first 3 printed'}))
