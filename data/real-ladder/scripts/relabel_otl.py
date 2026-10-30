#!/usr/bin/env python3
"""Clean the internal-node labels of an Open Tree of Life Newick tree.

    python3 -I relabel_otl.py IN.nwk[.gz] OUT.nwk[.gz]

The synthesis tree names every internal node, many with a placeholder. Internal nodes only (tips are copied as they are):

  1. A label starting with "mrcaott" (a placeholder made of two ott ids) is removed.
  2. A trailing "_ott<digits>" (or " ott<digits>" in a quoted label) is removed.
  3. If a name is then no longer unique in the tree, every node that would share it keeps its ott id. Unique means unique
     among all labels after cleaning, with "_" and " " taken as the same (as Newick does for unquoted labels).

The tree shape is not touched. OUT ending in .gz is written at gzip level 9 with mtime 0 and no file name. Prints the counts.
Standard library only; the input is parsed, never executed, and the tokenizer is a loop (no recursion).
"""
import collections, gzip, re, sys

sys.dont_write_bytecode = True

TOKEN = re.compile(r"'(?:[^']|'')*'|\[[^\]]*\]|[(),;:]|[^(),;:\[\]'\s]+|\s+")
OTT = re.compile(r"[ _]ott\d+$")
PUNCT = "(),;:"


def read(path):
    with (gzip.open(path, "rb") if path.endswith(".gz") else open(path, "rb")) as f:
        return f.read().decode("utf-8")


def write(path, text):
    data = text.encode("utf-8")
    if path.endswith(".gz"):
        with open(path, "wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=9, mtime=0) as f:
            f.write(data)
    else:
        with open(path, "wb") as f:
            f.write(data)


def unquote(tok):
    return tok[1:-1].replace("''", "'") if tok[0] == "'" else tok


def quote(name, was_quoted):
    return "'" + name.replace("'", "''") + "'" if was_quoted else name


def relabel(text):
    out = []  # the tokens, with the internal labels as they are until the second pass
    internal = []  # index in out of each internal label that is not a placeholder
    tip_keys = set()
    counts = collections.Counter()
    stats = collections.Counter()
    prev = None
    for m in TOKEN.finditer(text):
        tok = m.group(0)
        if tok.isspace() or tok[0] == "[":
            out.append(tok)
            continue
        if len(tok) == 1 and tok in PUNCT:
            prev = tok
            out.append(tok)
            continue
        if prev == ")":
            stats["internal"] += 1
            name = unquote(tok)
            if name.startswith("mrcaott"):
                stats["placeholder removed"] += 1
                out.append("")
            else:
                internal.append(len(out))
                counts[OTT.sub("", name).replace("_", " ")] += 1
                out.append(tok)
        else:
            stats["tips"] += 1
            tip_keys.add(unquote(tok).replace("_", " "))
            out.append(tok)
        prev = "label"

    for i in internal:
        tok = out[i]
        name = unquote(tok)
        stripped = OTT.sub("", name)
        key = stripped.replace("_", " ")
        if stripped == name:
            stats["no ott suffix, kept"] += 1
        elif counts[key] > 1 or key in tip_keys:
            stats["ott kept, name not unique"] += 1
        else:
            stats["ott removed"] += 1
            out[i] = quote(stripped, tok[0] == "'")
    return "".join(out), stats


def check_unique(text):
    """Internal labels that are not empty must stay distinct from each other and from the tips (underscore = space)."""
    seen = collections.Counter()
    prev = None
    for m in TOKEN.finditer(text):
        tok = m.group(0)
        if tok.isspace() or tok[0] == "[":
            continue
        if len(tok) == 1 and tok in PUNCT:
            prev = tok
            continue
        if prev == ")" and tok:
            seen[unquote(tok).replace("_", " ")] += 1
        elif prev in "(,":
            seen[unquote(tok).replace("_", " ")] += 1
        prev = "label"
    return [k for k, v in seen.items() if v > 1]


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    result, stats = relabel(read(sys.argv[1]))
    for k, v in sorted(stats.items()):
        print(f"{k}: {v}")
    clashes = check_unique(result)
    print(f"labels that are not unique after cleaning: {len(clashes)}", clashes[:5])
    write(sys.argv[2], result)
