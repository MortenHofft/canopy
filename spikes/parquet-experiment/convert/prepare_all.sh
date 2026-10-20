#!/usr/bin/env bash
# Convert the six measured trees (+ codec / row-group / page variants of the 1M tree) into $SCR/serve/, gzip the Newick
# baselines, and write clades.json. One heavy job at a time, niced.
set -eu
SCR="${SCR:?set SCR}"; PY="${PY:-$SCR/venv/bin/python}"; HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$HERE/../../../.."
REPO="$(cd "$HERE/../../.." && pwd)"
SRV="$SCR/serve"; mkdir -p "$SRV" "$SCR/cache"
declare -A SRC=(
  [yule10k]="$REPO/data/synthetic/newick/yule_10000.nwk.gz"
  [otl91k]="$REPO/data/real-ladder/trees/otl-100k-vertebrata.nwk.gz"
  [yule100k]="$SCR/syn/newick/yule_100000.nwk"
  [gtdb190k]="$REPO/data/real-ladder/trees/gtdb-190k-bacteria.nwk.gz"
  [yule1M]="$SCR/syn/newick/yule_1000000.nwk"
  [otl1.49M]="$SCR/otl/out/otl-1m-metazoa.nwk.gz"
)
conv() { # name srcname extra-args...
  local name="$1" src="$2"; shift 2
  nice -n 19 "$PY" -I "$HERE/convert.py" "${SRC[$src]}" "$SRV/$name" --cache "$SCR/cache" "$@" > "$SRV/$name.convert.log"
}
for t in yule10k otl91k yule100k gtdb190k yule1M otl1.49M; do
  conv "$t" "$t" --rg 65536 --codec zstd --enc tuned
  nice -n 19 "$PY" -I "$HERE/pick_clades.py" "${SRC[$t]}" "$SRV/$t/clades.json" "$SCR/cache"
  if [[ "${SRC[$t]}" == *.gz ]]; then zcat "${SRC[$t]}" | nice -n 19 gzip -9 -n > "$SRV/$t/tree.nwk.gz"; else nice -n 19 gzip -9 -n -c "${SRC[$t]}" > "$SRV/$t/tree.nwk.gz"; fi
done
# variants of the 1M tree for the browser decode / granularity comparison
for v in "snappy:--codec snappy --enc tuned" "none:--codec none --enc tuned" "rg16k:--codec zstd --enc tuned --rg 16384" "rg256k:--codec zstd --enc tuned --rg 262144" "plainzstd:--codec zstd --enc plain"; do
  name="yule1M__${v%%:*}"; args="${v#*:}"
  conv "$name" yule1M $args
  cp "$SRV/yule1M/clades.json" "$SRV/$name/clades.json"
done
echo prepared
