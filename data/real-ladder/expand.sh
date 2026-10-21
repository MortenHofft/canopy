#!/usr/bin/env bash
# Build the 10M-tip stress-test tree from the full Open Tree of Life synthesis (2.39M tips) and,
# when pyarrow is available, convert it to the Parquet layout of spikes/parquet-experiment.
#   ./expand.sh                       # 10,000,000 tips, no branch lengths (like Open Tree)
#   TIPS=5000000 ./expand.sh          # another size
#   LENGTHS=1 ./expand.sh             # add random branch lengths to every edge (phylogram test)
#   PARQUET=0 ./expand.sh             # skip the Parquet conversion
# Environment: CACHE (default ./.cache), OUT (default ./fetched), both git-ignored.
# Output: $OUT/otl-10m-expanded.nwk.gz (+ .sha256, .stats.json) and $OUT/parquet/otl-10m-expanded/.
# Needs the Open Tree source in $CACHE (./fetch.sh otl downloads it; 86 MB). About 1 minute and
# 1 GB of RAM for the Newick; the Parquet conversion needs numpy + pyarrow and several GB more.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE="${CACHE:-$HERE/.cache}"
OUT="${OUT:-$HERE/fetched}"
TIPS="${TIPS:-10000000}"
ID="${ID:-otl-10m-expanded}"
SRC="$CACHE/opentree16.1/labelled_supertree_simplified_ottnames.tre"
[ -f "$SRC" ] || { echo "source not found: $SRC (run ./fetch.sh otl first)" >&2; exit 1; }
echo "8101a8d13b6114fcadd4d4e199ab7238442ede705d227ee15d8d7a9056d96d11  $SRC" | sha256sum -c - >/dev/null
mkdir -p "$OUT"
ARGS=(--target-tips "$TIPS" --stats "$OUT/$ID.stats.json")
[ "${LENGTHS:-0}" = 1 ] && ARGS+=(--lengths)
python3 -I "$HERE/scripts/expand_tips.py" "$SRC" "$OUT/$ID.nwk.gz" "${ARGS[@]}"

if [ "${PARQUET:-1}" = 1 ] && python3 -c "import pyarrow, numpy" 2>/dev/null; then
  CONV="$HERE/../../spikes/parquet-experiment/convert"
  mkdir -p "$OUT/parquet/$ID"
  python3 -I "$CONV/convert.py" "$OUT/$ID.nwk.gz" "$OUT/parquet/$ID"
  python3 -I "$CONV/verify.py" "$OUT/$ID.nwk.gz" "$OUT/parquet/$ID" | tail -3
  du -sh "$OUT/parquet/$ID"
else
  echo "skipping Parquet conversion (PARQUET=0 or pyarrow/numpy missing)"
fi
