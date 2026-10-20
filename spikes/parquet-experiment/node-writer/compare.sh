#!/usr/bin/env bash
# Node writer vs Python/pyarrow on the same data: sizes, conversion time, ground-truth verification, reader smoke test.
# Needs $SCR/serve from convert/prepare_all.sh (tips.parquet there supplies identical occurrence_count / country).
set -eu
SCR="${SCR:?set SCR}"; PY="${PY:-$SCR/venv/bin/python}"; HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/.."
mkdir -p "$SCR/nodew" "$ROOT/results"
declare -A SRC=( [yule100k]="$SCR/syn/newick/yule_100000.nwk" [yule1M]="$SCR/syn/newick/yule_1000000.nwk" [gtdb190k]="$ROOT/../../data/real-ladder/trees/gtdb-190k-bacteria.nwk.gz" )
for t in "${@:-yule100k yule1M}"; do
  out="$SCR/nodew/$t"; rm -rf "$out"
  for codec in zstd snappy; do
    d="$out"; [ "$codec" = snappy ] && d="$out-snappy"
    nice -n 19 node --max-old-space-size=8000 "$HERE/convert.mjs" "${SRC[$t]}" "$d" --meta "$SCR/serve/$t/tipmeta.parquet" --codec "$codec" --rg 16384 > "$ROOT/results/node-writer-$t-$codec.json"
    cat "$ROOT/results/node-writer-$t-$codec.json" | tr -d '\n ' ; echo
  done
  nice -n 19 "$PY" -I "$ROOT/convert/verify.py" "${SRC[$t]}" "$out" --cache "$SCR/cache" > "$ROOT/results/verify-nodew-$t.txt" 2>&1 && tail -1 "$ROOT/results/verify-nodew-$t.txt" || tail -3 "$ROOT/results/verify-nodew-$t.txt"
  cp "$SCR/serve/$t/clades.json" "$out/clades.json"; ln -sf "$SCR/serve/$t/tree.nwk.gz" "$out/tree.nwk.gz"
done
