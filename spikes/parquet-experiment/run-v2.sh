#!/usr/bin/env bash
# Second pass after the overview budget was changed from "expanded nodes" to "rows" (Open Tree polytomies made level 0 63,670 rows):
# regenerate everything with the final layout and re-run the main browser measurement. The first pass is kept as
# results/browser-main-v1-64k-nodebudget.json (the OTL rows there show the problem).
set -u
SCR="${SCR:?set SCR}"; HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
echo "start $(date -u +%T)"
./build.sh > /dev/null
[ -f results/browser-main.json ] && [ ! -f results/browser-main-v1-64k-nodebudget.json ] && mv results/browser-main.json results/browser-main-v1-64k-nodebudget.json && mv results/browser-main.log results/browser-main-v1-64k-nodebudget.log
[ -f results/browser-nodew.json ] && [ ! -f results/browser-nodew-v1.json ] && mv results/browser-nodew.json results/browser-nodew-v1.json
SCR=$SCR ./convert/prepare_all.sh > results/prepare.log 2>&1 || { echo "PREPARE FAILED"; exit 1; }; echo "prepared $(date -u +%T)"
$SCR/venv/bin/python -I report/collect_layout_sizes.py $SCR/serve > /dev/null
{ for pair in "yule1M:$SCR/syn/newick/yule_1000000.nwk" "otl1.49M:$SCR/otl/out/otl-1m-metazoa.nwk.gz" "otl91k:$HERE/../../data/real-ladder/trees/otl-100k-vertebrata.nwk.gz" "gtdb190k:$HERE/../../data/real-ladder/trees/gtdb-190k-bacteria.nwk.gz" "yule100k:$SCR/syn/newick/yule_100000.nwk" "yule10k:$HERE/../../data/synthetic/newick/yule_10000.nwk.gz"; do
    n=${pair%%:*}; f=${pair#*:}; nice -n 19 node --max-old-space-size=8000 test/overview_vs_layout.mjs "$f" $SCR/serve/$n; done; } > results/overview-vs-layout.txt 2>&1
SCR=$SCR node-writer/compare.sh yule100k yule1M > results/nodew.log 2>&1; echo "node writer done $(date -u +%T)"
ALL=yule10k,otl91k,yule100k,gtdb190k,yule1M,otl1.49M
SERVE=$SCR/serve nice -n 19 node run-browser.mjs --trees $ALL --profiles none,wifi,4g,3g --out results/browser-main.json --reps 2 > results/browser-main.log 2>&1; echo "browser main done $(date -u +%T)"
SERVE=$SCR/nodew nice -n 19 node run-browser.mjs --trees yule100k,yule1M --profiles none,wifi --baseline no --full-parquet none --out results/browser-nodew.json --reps 2 > results/browser-nodew.log 2>&1
echo "all done $(date -u +%T)"
