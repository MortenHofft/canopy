#!/usr/bin/env bash
# Everything after the size matrices, unattended and one heavy job at a time (niced). Logs in results/*.log (git-ignored).
set -u
SCR="${SCR:?set SCR}"; HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
echo "start $(date -u +%T) load $(cut -d' ' -f1-3 /proc/loadavg)"
SCR=$SCR ./convert/prepare_all.sh > results/prepare.log 2>&1; echo "prepared $(date -u +%T)"
SCR=$SCR node-writer/compare.sh yule100k yule1M > results/nodew.log 2>&1; echo "node writer done $(date -u +%T)"
ALL=yule10k,otl91k,yule100k,gtdb190k,yule1M,otl1.49M
SERVE=$SCR/serve nice -n 19 node run-browser.mjs --trees $ALL --profiles none,wifi,4g,3g --out results/browser-main.json --reps 2 > results/browser-main.log 2>&1; echo "browser main done $(date -u +%T)"
for v in none snappy rg16k rg256k plainzstd; do
  SERVE=$SCR/serve nice -n 19 node run-browser.mjs --trees yule1M__$v --profiles none,wifi,4g --baseline no --full-parquet none --out results/browser-variant-$v.json --reps 2 > results/browser-variant-$v.log 2>&1
done
SERVE=$SCR/serve nice -n 19 node run-browser.mjs --trees yule1M__paged --profiles none,wifi,4g --baseline no --full-parquet none --offset-index yes --out results/browser-variant-paged.json --reps 2 > results/browser-variant-paged.log 2>&1
SERVE=$SCR/nodew nice -n 19 node run-browser.mjs --trees yule100k,yule1M --profiles none,wifi --baseline no --full-parquet none --out results/browser-nodew.json --reps 2 > results/browser-nodew.log 2>&1
echo "all done $(date -u +%T)"
