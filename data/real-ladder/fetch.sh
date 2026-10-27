#!/usr/bin/env bash
# Download the source trees, verify sha256, and (re)derive the ladder rungs.
#   ./fetch.sh                 all sources, all rungs  (about 130 MB download)
#   ./fetch.sh otl             only the two large Open Tree of Life trees (39 MB; 1M and 2M rungs), from the data/otl-large branch
#   ./fetch.sh gtdb fish       several sources
# Environment: CACHE (default ./.cache, git-ignored), OUT (default ./fetched, git-ignored).
# Downloads are treated as untrusted data: they are only hashed, decompressed by Python and parsed.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE="${CACHE:-$HERE/.cache}"
OUT="${OUT:-$HERE/fetched}"
SRC=("$@"); [ ${#SRC[@]} -eq 0 ] && SRC=(otl gtdb fish)

get() { # dir url sha256
  local dir="$CACHE/$1" url="$2" sha="$3" f; f="$dir/$(basename "$url")"
  mkdir -p "$dir"
  if [ ! -f "$f" ]; then curl -fsSL --retry 3 -o "$f.part" "$url" && mv "$f.part" "$f"; fi
  echo "$sha  $f" | sha256sum -c - >/dev/null || { echo "sha256 mismatch for $f (expected $sha)" >&2; exit 1; }
  echo "ok $f"
}

# The large OTL trees come from this repo's data/otl-large branch, not from files.opentreeoflife.org (the host can be
# unreachable, and the files may move). The branch is the primary copy; manifest.json holds the sha256 they must match.
OTL_BRANCH_URL="https://raw.githubusercontent.com/MortenHofft/canopy/data/otl-large/trees"
get_branch() { # id
  local f="$OUT/$1.nwk.gz" sha
  mkdir -p "$OUT"
  if [ ! -f "$f" ]; then curl -fsSL --retry 3 -o "$f.part" "$OTL_BRANCH_URL/$1.nwk.gz" && mv "$f.part" "$f"; fi
  sha="$(python3 -I -c 'import json,sys; print([r["sha256_nwk"] for r in json.load(open(sys.argv[1]))["rungs"] if r["id"] == sys.argv[2]][0])' "$HERE/manifest.json" "$1")"
  [ "$(gzip -dc "$f" | sha256sum | cut -d' ' -f1)" = "$sha" ] || { echo "sha256 mismatch for $f (expected $sha)" >&2; exit 1; }
  echo "ok $f"
}

for s in "${SRC[@]}"; do case "$s" in
  otl)  get_branch otl-1m-metazoa; get_branch otl-2m-full ;;
  gtdb) # pinned release (not "latest") so the checksums stay valid; saved under the names ladder.py expects
        mkdir -p "$CACHE/gtdb"
        for pair in "bac120_r232.tree.gz bac120.tree.gz 8c51060f740da69ff7076ed0305250a881b23093413108450c90fc233fd54c19" \
                    "ar53_r232.tree.gz ar53.tree.gz fc879fdef7928e6f7ddb48e2e10893869bfd010da2828b72f9592b50b06ea397"; do
          set -- $pair
          f="$CACHE/gtdb/$2"
          [ -f "$f" ] || { curl -fsSL --retry 3 -o "$f.part" "https://data.gtdb.ecogenomic.org/releases/release232/232.0/$1" && mv "$f.part" "$f"; }
          echo "$3  $f" | sha256sum -c - >/dev/null || { echo "sha256 mismatch for $f" >&2; exit 1; }
          echo "ok $f"
        done ;;
  fish) get fishtree https://fishtreeoflife.org/downloads/actinopt_12k_treePL.tre.xz 543221541758e2bce063a5a76d6858f4f83a8a770225ee96c4292f7917188da2
        get fishtree https://fishtreeoflife.org/downloads/actinopt_12k_raxml.tre.xz 306f83016a3ba172a8f415549093400ef11b36bb718a5b9f23e264e140681686 ;;
  *) echo "unknown source $s" >&2; exit 2 ;;
esac; done

# ladder.py derives only rungs whose source file exists; pass ids explicitly to limit work
IDS=()
for s in "${SRC[@]}"; do case "$s" in
  gtdb) IDS+=(gtdb-0200-iainarchaeia gtdb-1k-nitrososphaeria gtdb-10k-archaea gtdb-100k-bacteria-random gtdb-190k-bacteria) ;;
  fish) IDS+=(fish-0200-random fish-1k-random fish-12k-timetree fish-12k-raxml) ;;
esac; done
if [ ${#IDS[@]} -gt 0 ]; then
  python3 -I "$HERE/scripts/ladder.py" "$CACHE" "$OUT" "${IDS[@]}"

  # verify against the manifest (sha256 of the uncompressed Newick)
  python3 -I "$HERE/scripts/make_manifest.py" verify "$HERE/manifest.json" "$OUT"
fi
