# Regenerate the synthetic trees. Needs only python3 (stdlib) and gzip.
#   make check   verify the committed files against manifest.json
#   make small   regenerate 200 / 1,000 / 10,000-tip files (all variants) and the mixed polytomy, gzip the committed 10k files, verify
#   make large   generate the 100,000 and 1,000,000-tip files (about 450 MB, ~2 min) and verify sha256
#   make all     small + large
#   make clean-large   delete the generated large files (they are git-ignored)
PY ?= python3

.PHONY: all small large check clean-large
all: small large

check:
	$(PY) check.py . --verify manifest.json

small:
	$(PY) generate.py --out . --sizes 200,1000,10000
	for f in newick/*_10000.nwk newick/yule_10000_support.nwk newick/caterpillar_10000_support.nwk; do gzip -9 -n -k -f $$f; done
	$(PY) make_polytomy_mixed.py
	$(PY) make_radial_depth.py
	$(PY) check.py . --verify manifest.json

large:
	$(PY) generate.py --out . --sizes 100000,1000000
	$(PY) check.py . --verify manifest.json

clean-large:
	rm -f newick/*_100000*.nwk newick/*_1000000*.nwk
