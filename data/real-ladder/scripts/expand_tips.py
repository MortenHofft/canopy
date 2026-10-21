#!/usr/bin/env python3
"""Grow a Newick tree to a target tip count by replacing every tip with a small random clade.

    python3 -I expand_tips.py IN.nwk[.gz] OUT.nwk.gz --target-tips N [options]

    --target-tips N     tips in the output (exact)
    --seed S            seed string (default gbif-phylo-expand-1)
    --lengths           give every edge a branch length: existing lengths are kept byte for byte,
                        missing ones (and all new edges) are drawn from an exponential with mean
                        0.05, written with 4 significant digits; the root gets none. Without this
                        flag nothing is added and existing lengths are kept as they are.
    --max-tip-clade K   largest clade one tip may become (default: 3 x the mean, at least 2)
    --level L           gzip level of the output (default 6; 9 is slow on hundreds of MB)
    --stats FILE        write counts, bytes and sha256 as JSON (also printed)

Why: the largest real tree in the ladder (Open Tree of Life synthesis, 2.39M tips) is not large
enough to stress the Parquet TreeSource. This makes a 10M-tip tree that keeps the real topology
above the species level (polytomies with thousands of children, 99-deep paths, quoted labels) and
adds synthetic structure below it.

How: the input is tokenised twice with the regex of nwk.py, once to count tips and once to rewrite.
Everything that is not a tip (parentheses, internal labels, branch lengths, comments, whitespace) is
copied byte for byte. A tip labelled L becomes a clade whose root keeps the label L (it turns into
an internal node, as genera are in Open Tree) and whose tips are L_s1 .. L_sk; a quoted label keeps
its quotes ('a (b)' becomes 'a (b)_s1'); an unlabeled tip is treated as "tip". k is drawn around
the ratio of remaining target tips to remaining input tips, so the output has exactly N tips; k = 1
leaves the tip unchanged. The clade is built by random joins of 2 (85%), 3 or 4 sub-clades, so the
new part is mostly bifurcating with some polytomies, about log2(k) levels deep. New internal nodes
carry no label. The tip's own incoming branch length, if any, stays on the clade root.

Reproducible for a given seed on one CPython version (random.Random(seed).random() is stable
across 3.x; record the sha256 anyway). Pure standard library, iterative, reads the input into
memory (86 MB for the full Open Tree) and streams the output through gzip.
"""
import argparse, gzip, hashlib, json, os, random, re, sys, time

TOKEN = re.compile(r"""\[[^\]]*\]|'(?:[^']|'')*'|[(),;:]|[^\s(),;:\[\]']+""")  # same as nwk.py

OPEN, CLOSE, LABEL, COLON, LENGTH = range(5)  # kind of the previous significant token


def read_text(path):
    op = gzip.open if path.endswith(".gz") else open
    with op(path, "rt", encoding="utf-8", errors="replace") as f:
        return f.read()


def walk(text, on_tip, on_copy, add_len=None):
    """One pass over the first tree in `text`.
    on_tip(label)          a tip (label text with quotes, or None if unlabeled); the caller emits it
    on_copy(start, end)    a slice of the input to copy verbatim (everything else)
    add_len()              with --lengths: called when a node ends without a length (not the root);
                           returns the text to append, e.g. ':0.0123'
    Returns the number of tips seen."""
    tips = 0
    prev = OPEN          # state before the first token: a node may start
    pos = 0              # copy position
    has_len = False      # the node that is about to end has a branch length
    for m in TOKEN.finditer(text):
        tok = m.group(0)
        c = tok[0]
        s, e = m.start(), m.end()
        if c == "[":
            continue                     # comments ride along inside the copied slices
        if c == "(":
            on_copy(pos, e); pos = e
            prev, has_len = OPEN, False
        elif c == "," or c == ")" or c == ";":
            if prev == OPEN:             # empty slot: an unlabeled tip
                tips += 1
                on_copy(pos, s); pos = s
                on_tip(None)
            if add_len and not has_len and c != ";":
                on_copy(pos, s); pos = s
                on_copy(add_len())
            on_copy(pos, e); pos = e
            if c == ";":
                break
            prev, has_len = (OPEN if c == "," else CLOSE), False
        elif c == ":":
            on_copy(pos, e); pos = e
            prev, has_len = COLON, True
        elif prev == COLON:              # branch length text
            on_copy(pos, e); pos = e
            prev = LENGTH
        elif prev == OPEN:               # tip label
            tips += 1
            on_copy(pos, s); pos = e
            on_tip(tok)
            prev = LABEL
        else:                            # internal label (after ')') or a second label token
            on_copy(pos, e); pos = e
            prev = LABEL
    else:
        on_copy(pos, len(text))          # no ';' found: copy the rest
    return tips


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("inp")
    ap.add_argument("out")
    ap.add_argument("--target-tips", type=int, required=True)
    ap.add_argument("--seed", default="gbif-phylo-expand-1")
    ap.add_argument("--lengths", action="store_true")
    ap.add_argument("--max-tip-clade", type=int, default=0)
    ap.add_argument("--level", type=int, default=6)
    ap.add_argument("--stats", default=None)
    A = ap.parse_args(argv[1:])

    t0 = time.time()
    text = read_text(A.inp)
    n_in = walk(text, lambda label: None, lambda *a: None)
    if n_in == 0:
        sys.exit("no tips found")
    if A.target_tips < n_in:
        sys.exit("target %d is below the input's %d tips (this script only grows trees)" % (A.target_tips, n_in))
    mean = A.target_tips / n_in
    kmax = A.max_tip_clade or max(2, int(round(3 * mean)))
    print("input tips %d, target %d, mean clade %.2f, max clade %d (%.1fs)" % (n_in, A.target_tips, mean, kmax, time.time() - t0), flush=True)

    rnd = random.Random(A.seed)
    uniform = rnd.random

    def new_len():
        return ":" + format(rnd.expovariate(20.0), ".4g")

    state = {"in": n_in, "out": A.target_tips, "tips": 0, "internal": 0}
    chunks = []
    sha = hashlib.sha256()
    out_bytes = 0

    def clade(label, k):
        """Newick text for a clade of k tips derived from `label`; the root keeps `label`."""
        if label is None:
            label, base = "", "tip"
            quoted = False
        else:
            quoted = len(label) >= 2 and label[0] == "'" and label[-1] == "'"
            base = label[1:-1] if quoted else label
        if quoted:
            items = ["'%s_s%d'" % (base, i) for i in range(1, k + 1)]
        else:
            items = ["%s_s%d" % (base, i) for i in range(1, k + 1)]
        if A.lengths:
            items = [t + new_len() for t in items]
        while len(items) > 1:
            r = uniform()
            j = 2 if r < 0.85 or len(items) < 3 else (3 if r < 0.95 or len(items) < 4 else 4)
            picked = []
            for _ in range(j):
                i = int(uniform() * len(items))
                picked.append(items[i])
                items[i] = items[-1]
                items.pop()
            node = "(" + ",".join(picked) + ")"
            state["internal"] += 1
            if items and A.lengths:
                node += new_len()      # an inner node; the clade root's length comes from the input or add_len
            items.append(node)
        return items[0] + label

    def on_tip(label):
        rem_in, rem_out = state["in"], state["out"]
        if rem_in == 1:
            k = rem_out
        else:
            k = int(round(rem_out / rem_in + (uniform() * 4.0 - 2.0)))
            k = max(1, min(k, kmax, rem_out - (rem_in - 1)))
        state["in"], state["out"], state["tips"] = rem_in - 1, rem_out - k, state["tips"] + k
        chunks.append(label if (k == 1 and label is not None) else clade(label, k))

    with open(A.out, "wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=A.level, mtime=0) as gz:

        def flush():
            nonlocal out_bytes
            data = "".join(chunks).encode("utf-8")
            chunks.clear()
            sha.update(data)
            gz.write(data)
            out_bytes += len(data)

        def on_copy(a, b=None):
            chunks.append(text[a:b] if b is not None else a)   # (start, end) slice, or a ready string
            if len(chunks) >= 100000:
                flush()

        n_seen = walk(text, on_tip, on_copy, new_len if A.lengths else None)
        flush()

    assert n_seen == n_in, (n_seen, n_in)
    assert state["tips"] == A.target_tips, (state["tips"], A.target_tips)
    digest = sha.hexdigest()
    stats = {"input": os.path.basename(A.inp), "input_tips": n_in, "tips": state["tips"], "new_internal_nodes": state["internal"],
             "seed": A.seed, "lengths": A.lengths, "max_tip_clade": kmax, "bytes_raw": out_bytes, "bytes_gz": os.path.getsize(A.out),
             "sha256_nwk": digest, "python": sys.version.split()[0], "seconds": round(time.time() - t0, 1)}
    print(json.dumps(stats, indent=1), flush=True)
    if A.stats:
        with open(A.stats, "w") as f:
            json.dump(stats, f, indent=1)
    base = A.out[:-3] if A.out.endswith(".gz") else A.out
    with open(base + ".sha256", "w") as f:
        f.write(digest + "\n")


if __name__ == "__main__":
    main(sys.argv)
