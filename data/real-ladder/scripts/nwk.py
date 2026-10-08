#!/usr/bin/env python3
"""Minimal iterative Newick toolkit (Python 3 standard library only).

Run as:  python3 -I nwk.py <command> ...
  stats   FILE                      tip/internal counts, depth, branch lengths, labels, sizes (JSON)
  clades  FILE MIN MAX [N]          named internal nodes with MIN..MAX tips (largest first)
  extract FILE LABEL OUT            write the clade rooted at the node with exact label LABEL
  sample  FILE K SEED OUT [LABEL]   keep K tips chosen by sha256(SEED:tiplabel) rank (deterministic,
                                    independent of Python version), optionally within clade LABEL;
                                    unary nodes are collapsed (branch lengths summed)
  check   FILE                      parse and print the tip count only

Nothing here is recursive: parsing, depth, pruning and writing are all loop-based, so a
caterpillar tree of 1M tips is fine. Files are read as text (utf-8, errors=replace); labels are
kept verbatim (quotes included) and never evaluated.
"""
import gzip, hashlib, json, os, re, sys

TOKEN = re.compile(r"""\[[^\]]*\]|'(?:[^']|'')*'|[(),;:]|[^\s(),;:\[\]']+""")


class Tree:
    """Nodes are numbered in pre-order: parent index < child index, a subtree is a contiguous range."""
    __slots__ = ("parent", "label", "length", "nchild")

    def __init__(self):
        self.parent, self.label, self.length, self.nchild = [], [], [], []

    def _new(self, parent):
        i = len(self.parent)
        self.parent.append(parent)
        self.label.append(None)
        self.length.append(None)
        self.nchild.append(0)
        if parent >= 0:
            self.nchild[parent] += 1
        return i

    @classmethod
    def parse(cls, text):
        t = cls()
        stack, last, expect_len = [], None, False
        done = False
        for m in TOKEN.finditer(text):
            tok = m.group(0)
            c = tok[0]
            if c == "[":
                continue  # comments (e.g. [&R]) are ignored
            if done:
                break
            if c == "(":
                n = t._new(stack[-1] if stack else -1)
                stack.append(n)
                last = None
            elif c == ",":
                if last is None:
                    t._new(stack[-1])
                last = None
            elif c == ")":
                if last is None:
                    t._new(stack[-1])
                if not stack:
                    raise ValueError("unbalanced ')'")
                last = stack.pop()
            elif c == ";":
                done = True
            elif c == ":":
                if last is None:
                    last = t._new(stack[-1] if stack else -1)
                expect_len = True
            elif expect_len:
                t.length[last] = tok
                expect_len = False
            else:
                if last is None:
                    last = t._new(stack[-1] if stack else -1)
                t.label[last] = tok
        if stack:
            raise ValueError("unbalanced '(' (%d open)" % len(stack))
        if not t.parent:
            raise ValueError("no tree found")
        return t

    @classmethod
    def load(cls, path):
        op = gzip.open if path.endswith(".gz") else open
        with op(path, "rt", encoding="utf-8", errors="replace") as f:
            return cls.parse(f.read())

    def __len__(self):
        return len(self.parent)

    def is_tip(self, i):
        return self.nchild[i] == 0

    def tips(self):
        return [i for i in range(len(self)) if self.nchild[i] == 0]

    def sizes(self):
        """number of tips under each node"""
        n = len(self)
        s = [1 if self.nchild[i] == 0 else 0 for i in range(n)]
        p = self.parent
        for i in range(n - 1, 0, -1):
            s[p[i]] += s[i]
        return s

    def end(self):
        """end[i]: exclusive end of the contiguous pre-order range of node i's subtree"""
        n = len(self)
        e = list(range(1, n + 1))
        p = self.parent
        for i in range(n - 1, 0, -1):
            if e[i] > e[p[i]]:
                e[p[i]] = e[i]
        return e

    def depths(self):
        n = len(self)
        d = [0] * n
        p = self.parent
        for i in range(1, n):
            d[i] = d[p[i]] + 1
        return d

    def write(self, out, keep, root=0, collapse_unary=True):
        """Write the tree induced by the boolean list `keep` (tips marked True; their ancestors
        inside the subtree of `root` are derived). Unary nodes are collapsed (their branch
        lengths added to the child, their labels dropped) when collapse_unary. The root of the
        written tree carries no branch length. Returns the number of tips written."""
        p, nch, lab, ln = self.parent, self.nchild, self.label, self.length
        end = self.end()[root]
        used = [False] * (end - root)  # offset by root
        nk = [0] * (end - root)
        for i in range(end - 1, root - 1, -1):
            u = used[i - root] or (nch[i] == 0 and keep[i])
            if u:
                used[i - root] = True
                if i > root:
                    used[p[i] - root] = True
                    nk[p[i] - root] += 1
        if not used[0]:
            raise ValueError("no tips kept")
        top = root
        while collapse_unary and nch[top] != 0 and nk[top - root] == 1:
            top = next(j for j in range(top + 1, end) if used[j - root] and p[j] == top)
        emitted = {}
        eparent = {}
        acc = {}
        order = []
        for i in range(top, self.end()[top]):
            if not used[i - root]:
                continue
            tip = nch[i] == 0
            emit = tip or i == top or nk[i - root] >= 2 or not collapse_unary
            emitted[i] = emit
            if i != top:
                j = p[i]
                if emitted[j]:
                    eparent[i] = j
                    acc[i] = float(ln[i]) if ln[i] is not None else None
                else:
                    eparent[i] = eparent[j]
                    a = acc[j]
                    own = float(ln[i]) if ln[i] is not None else None
                    acc[i] = None if a is None and own is None else (a or 0.0) + (own or 0.0)
            if emit:
                order.append(i)
        merged = {i for i in order if i != top and p[i] != eparent[i]}
        parts, stack, started, ntips = [], [], set(), 0

        def tail(i):
            s = lab[i] or ""
            if i != top and ln[i] is not None:
                s += ":" + (repr(round(acc[i], 12)) if i in merged else ln[i])
            return s

        for i in order:
            ep = eparent.get(i, -1)
            while stack and stack[-1] != ep:
                parts.append(")" + tail(stack.pop()))
            if stack:
                if stack[-1] in started:
                    parts.append(",")
                started.add(stack[-1])
            if nch[i] != 0:
                parts.append("(")
                stack.append(i)
            else:
                parts.append(tail(i))
                ntips += 1
            if len(parts) > 50000:
                out.write("".join(parts))
                parts = []
        while stack:
            parts.append(")" + tail(stack.pop()))
        parts.append(";\n")
        out.write("".join(parts))
        return ntips


def length_stats(t, depths=None, tol=1e-3):
    """Branch-length summary over all edges that carry a length (root edge excluded)."""
    n = len(t)
    vals, bad, missing = [], 0, 0
    L = [0.0] * n
    for i in range(1, n):
        s = t.length[i]
        if s is None:
            missing += 1
            continue
        try:
            v = float(s)
        except ValueError:
            bad += 1
            continue
        L[i] = v
        vals.append(v)
    if not vals:
        return {"present": False, "edges_missing_length": missing}
    vals.sort()
    m = len(vals)
    med = vals[m // 2] if m % 2 else (vals[m // 2 - 1] + vals[m // 2]) / 2
    dist = [0.0] * n  # root-to-node distance
    p = t.parent
    for i in range(1, n):
        dist[i] = dist[p[i]] + L[i]
    td = [dist[i] for i in range(n) if t.nchild[i] == 0]
    lo, hi = min(td), max(td)
    return {"present": True, "edges_with_length": m, "edges_missing_length": missing,
            "edges_unparseable": bad, "min": vals[0], "max": vals[-1], "median": med,
            "mean": sum(vals) / m, "zero_length_edges": sum(1 for v in vals if v == 0),
            "negative_length_edges": sum(1 for v in vals if v < 0),
            "max_over_median": (vals[-1] / med) if med > 0 else None,
            "root_to_tip_min": lo, "root_to_tip_max": hi,
            "ultrametric": (hi - lo) <= tol * hi if hi > 0 else None}


def stats(path):
    t = Tree.load(path)
    n = len(t)
    tips = sum(1 for i in range(n) if t.nchild[i] == 0)
    internal = n - tips
    d = t.depths()
    maxdepth = max(d)
    tl = sum(1 for i in range(n) if t.nchild[i] == 0 and t.label[i] is not None)
    il = sum(1 for i in range(n) if t.nchild[i] != 0 and t.label[i] is not None)
    bl = sum(1 for i in range(1, n) if t.length[i] is not None)
    inl = [t.label[i] for i in range(n) if t.nchild[i] != 0 and t.label[i] is not None][:3]
    inum = sum(1 for i in range(n) if t.nchild[i] != 0 and t.label[i] is not None
               and re.fullmatch(r"[0-9.eE+-]+(/[0-9.eE+-]+)*", t.label[i] or "") is not None)
    maxdeg = max(t.nchild)
    unary = sum(1 for i in range(n) if t.nchild[i] == 1)
    binomial = sum(1 for i in range(n) if t.nchild[i] == 0 and t.label[i] and
                   re.match(r"'?[A-Z][a-z]+[_ ][a-z]", t.label[i]))
    uniq = len({t.label[i] for i in range(n) if t.nchild[i] == 0})
    raw = os.path.getsize(path)
    if path.endswith(".gz"):
        gz = raw
        raw = 0
        with gzip.open(path, "rb") as f:
            while True:
                b = f.read(1 << 20)
                if not b:
                    break
                raw += len(b)
    else:
        with open(path, "rb") as f:
            gz = 0
            c = gzip.GzipFile(fileobj=_Counter(), mode="wb", compresslevel=9, mtime=0)
            ctr = c.fileobj
            while True:
                b = f.read(1 << 20)
                if not b:
                    break
                c.write(b)
            c.close()
            gz = ctr.n
    blstats = length_stats(t, d)
    return {"tips": tips, "internal_nodes": internal, "total_nodes": n, "unique_tip_labels": uniq,
            "max_depth_edges": maxdepth, "max_children": maxdeg, "unary_internal_nodes": unary,
            "tips_with_label": tl, "internal_with_label": il,
            "internal_labels_numeric": inum, "internal_label_examples": inl,
            "edges_with_length": bl, "has_branch_lengths": bl > 0,
            "tips_binomial_like": binomial, "branch_lengths": blstats,
            "bytes_raw": raw, "bytes_gzip9": gz}


class _Counter:
    def __init__(self):
        self.n = 0

    def write(self, b):
        self.n += len(b)
        return len(b)

    def flush(self):
        pass


def _find(t, label):
    hits = [i for i in range(len(t)) if t.label[i] == label and t.nchild[i] != 0]
    if len(hits) != 1:
        sys.exit("label %r matches %d internal nodes" % (label, len(hits)))
    return hits[0]


def main(argv):
    if len(argv) < 3:
        sys.exit(__doc__)
    cmd, path = argv[1], argv[2]
    if cmd == "stats":
        print(json.dumps(stats(path), indent=1))
    elif cmd == "check":
        t = Tree.load(path)
        print(sum(1 for i in range(len(t)) if t.nchild[i] == 0))
    elif cmd == "clades":
        lo, hi = int(argv[3]), int(argv[4])
        lim = int(argv[5]) if len(argv) > 5 else 40
        t = Tree.load(path)
        s = t.sizes()
        c = [(s[i], t.label[i]) for i in range(len(t)) if t.nchild[i] and t.label[i] and lo <= s[i] <= hi]
        c.sort(reverse=True)
        for k, l in c[:lim]:
            print(k, l)
    elif cmd == "extract":
        t = Tree.load(path)
        r = _find(t, argv[3])
        keep = [t.nchild[i] == 0 for i in range(len(t))]
        with open(argv[4], "w", encoding="utf-8", newline="\n") as f:
            print(t.write(f, keep, root=r, collapse_unary=False))
    elif cmd == "sample":
        k, seed, outp = int(argv[3]), argv[4], argv[5]
        t = Tree.load(path)
        r = _find(t, argv[6]) if len(argv) > 6 else 0
        end = t.end()[r]
        cand = [i for i in range(r, end) if t.nchild[i] == 0]
        rank = sorted(cand, key=lambda i: (hashlib.sha256(("%s:%s" % (seed, t.label[i])).encode()).hexdigest(), i))
        keep = [False] * len(t)
        for i in rank[:k]:
            keep[i] = True
        with open(outp, "w", encoding="utf-8", newline="\n") as f:
            print(t.write(f, keep, root=r, collapse_unary=True))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
