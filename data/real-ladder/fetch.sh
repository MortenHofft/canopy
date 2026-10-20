#!/usr/bin/env bash
# Download the source trees, verify sha256, and (re)derive the ladder rungs.
#   ./fetch.sh                 all sources, all rungs  (about 130 MB download)
#   ./fetch.sh otl             only the Open Tree of Life source (86 MB; needed for the 1M rung)
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

for s in "${SRC[@]}"; do case "$s" in
  otl)  get opentree16.1 https://files.opentreeoflife.org/synthesis/opentree16.1/output/labelled_supertree/labelled_supertree_simplified_ottnames.tre 8101a8d13b6114fcadd4d4e199ab7238442ede705d227ee15d8d7a9056d96d11 ;;
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
  otl)  IDS+=(otl-0200-canidae otl-1k-testudines otl-10k-amphibia otl-100k-vertebrata otl-1m-metazoa otl-2m-full otl-1k-vertebrata-random otl-10k-vertebrata-random) ;;
  gtdb) IDS+=(gtdb-0200-iainarchaeia gtdb-1k-nitrososphaeria gtdb-10k-archaea gtdb-100k-bacteria-random gtdb-190k-bacteria) ;;
  fish) IDS+=(fish-0200-random fish-1k-random fish-12k-timetree fish-12k-raxml) ;;
esac; done
python3 -I "$HERE/scripts/ladder.py" "$CACHE" "$OUT" "${IDS[@]}"

# verify against the manifest (sha256 of the uncompressed Newick)
python3 -I "$HERE/scripts/make_manifest.py" verify "$HERE/manifest.json" "$OUT"
