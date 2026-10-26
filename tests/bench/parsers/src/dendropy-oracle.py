#!/usr/bin/env python3
# Note: NOT run with -I. CLAUDE.md requires `-I` for data scripts in data/, which must use only the
# standard library. This oracle depends on DendroPy (third-party), so it needs user site-packages
# on sys.path. It is a test tool, not a data script.
"""DendroPy correctness oracle.

Reads one JSON object per line from stdin, each describing a fixture:
    {"id": "...", "kind": "newick"|"nexus", "input": "...", "wellFormed": bool,
     "tipCount": int|null, "tipLabels": [str]|null}

Writes one JSON object per line to stdout:
    {"id": "...", "verdict": "ok"|"wrong"|"error"|"crash", "tipCount": int|null,
     "tipLabels": [str]|null, "note": str}

Methodology mirrors src/correctness.mjs: well-formed inputs must parse and match the expected
tipCount + sorted tip labels; malformed inputs must throw an exception from DendroPy. DendroPy's
output is the "reference" column against which we compare the JS implementations.
"""
import json
import sys

import dendropy


def parse_one(fixture):
    text = fixture["input"]
    kind = fixture["kind"]
    schema = "newick" if kind == "newick" else "nexus"
    try:
        tree_list = dendropy.TreeList.get(data=text, schema=schema)
    except Exception as e:
        return {"verdict": "error", "note": f"{type(e).__name__}: {str(e)[:120]}"}
    if not tree_list:
        return {"verdict": "crash", "note": "empty TreeList"}
    tree = tree_list[0]
    labels = sorted(leaf.taxon.label for leaf in tree.leaf_node_iter() if leaf.taxon is not None)
    # Count ALL leaves (nodes with no children), whether labeled or not
    leaf_count = sum(1 for _ in tree.leaf_node_iter())
    return {"tipCount": leaf_count, "tipLabels": labels}


def compare(fixture, got):
    if "verdict" in got:
        return got
    if not fixture["wellFormed"]:
        return {**got, "verdict": "wrong",
                "note": f"parsed malformed input as {got['tipCount']} tips"}
    exp_count = fixture.get("tipCount")
    if exp_count is not None and got["tipCount"] != exp_count:
        return {**got, "verdict": "wrong",
                "note": f"tipCount {got['tipCount']}, expected {exp_count}"}
    exp_labels = fixture.get("tipLabels")
    if exp_labels is not None and sorted(got["tipLabels"]) != sorted(exp_labels):
        return {**got, "verdict": "wrong",
                "note": f"labels {got['tipLabels']} vs expected {exp_labels}"}
    return {**got, "verdict": "ok"}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        fixture = json.loads(line)
        try:
            got = parse_one(fixture)
            result = compare(fixture, got)
        except Exception as e:
            result = {"verdict": "crash", "note": f"{type(e).__name__}: {str(e)[:120]}"}
        result["id"] = fixture["id"]
        sys.stdout.write(json.dumps(result) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
