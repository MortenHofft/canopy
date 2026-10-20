#!/usr/bin/env bash
# Reproduce results/sizes-*.json. SCR = scratch dir with the trees (see README). One heavy job at a time.
set -eu
SCR="${SCR:?set SCR}"; PY="${PY:-$SCR/venv/bin/python}"; HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$HERE/../.."
mkdir -p "$HERE/results" "$SCR/cache" "$SCR/sizes-tmp"
run() { nice -n 19 "$PY" -I "$HERE/convert/sizes.py" "$1" "$2" "$HERE/results/sizes-$1.json" --cache "$SCR/cache" --scratch "$SCR/sizes-tmp/$1"; }
run gtdb190k "$REPO/data/real-ladder/trees/gtdb-190k-bacteria.nwk.gz"
run yule100k "$SCR/syn/newick/yule_100000.nwk"
run yule1M "$SCR/syn/newick/yule_1000000.nwk"
run otl1.49M "$SCR/otl/out/otl-1m-metazoa.nwk.gz"
