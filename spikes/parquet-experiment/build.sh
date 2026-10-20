#!/usr/bin/env bash
# Bundle the reader + harness for the browser (esbuild, no minify of names that matter, ESM).
set -eu
cd "$(dirname "$0")"
node_modules/.bin/esbuild web/entry.js --bundle --format=esm --minify --outfile=web/dist/harness.bundle.js --legal-comments=none
# reader only (what a product would ship): hyparquet + fzstd + hysnappy + reader.js
node_modules/.bin/esbuild web/reader.js --bundle --format=esm --minify --outfile=web/dist/reader.only.js --legal-comments=none
ls -l web/dist; for f in web/dist/reader.only.js; do echo "reader-only gzip bytes: $(gzip -9 -c $f | wc -c)"; done
