#!/usr/bin/env python3
"""Match a sample of tip names against the GBIF backbone and (optionally) count occurrences.
Pure stdlib. Sequential requests with a delay (be polite to api.gbif.org).

Usage (python3 -I):
  gbif_match.py <names.txt> <out.tsv> [--n 200] [--delay 0.15] [--no-counts]

names.txt: one name per line. Underscores are replaced by spaces; trailing Open Tree style
"_ottNNN" ids are removed. Sample = evenly spaced every k-th name (deterministic).
Output TSV columns: input, query, matchType, status, rank, usageKey, scientificName, occurrences.
A hit counts as "matched" when matchType is EXACT or FUZZY (HIGHERRANK/NONE count as unmatched);
"species_exact" additionally requires rank SPECIES and matchType EXACT. Summary printed to stdout.
"""
import http.client
import json
import re
import sys
import time
import urllib.parse
import urllib.request

API = 'https://api.gbif.org/v1/'


_CONN = [None]


def get(url):
    """GET with one persistent HTTPS connection (keep-alive), reconnecting on errors."""
    path = url[len('https://api.gbif.org'):]
    for attempt in range(4):
        try:
            if _CONN[0] is None:
                _CONN[0] = http.client.HTTPSConnection('api.gbif.org', timeout=20)
            _CONN[0].request('GET', path, headers={'User-Agent': 'gbif-phylo-test-data/0.1', 'Accept': 'application/json'})
            r = _CONN[0].getresponse()
            body = r.read()
            if r.status == 200:
                return json.loads(body)
        except Exception:
            pass
        try:
            _CONN[0].close()
        except Exception:
            pass
        _CONN[0] = None
        time.sleep(1 + attempt)
    return None


def clean(n):
    n = re.sub(r'_ott\d+$', '', n.strip())
    n = n.replace('_', ' ')
    return n.strip("'\" ")


def main(a):
    names = [l.rstrip('\n') for l in open(a[1]) if l.strip()]
    out = a[2]
    n = 200
    delay = 0.15
    counts = True
    i = 3
    while i < len(a):
        if a[i] == '--n':
            n = int(a[i + 1]); i += 2
        elif a[i] == '--delay':
            delay = float(a[i + 1]); i += 2
        elif a[i] == '--no-counts':
            counts = False; i += 1
        else:
            sys.exit(__doc__)
    step = max(1, len(names) // n)
    sample = names[::step][:n]
    tot = matched = species_exact = 0
    with open(out, 'w') as f:
        f.write('input\tquery\tmatchType\tstatus\trank\tusageKey\tscientificName\toccurrences\n')
        for nm in sample:
            q = clean(nm)
            j = get(API + 'species/match?' + urllib.parse.urlencode({'name': q}))
            time.sleep(delay)
            tot += 1
            if not j:
                f.write('\t'.join([nm, q, 'ERROR', '', '', '', '', '']) + '\n')
                f.flush()
                continue
            mt = j.get('matchType', 'NONE')
            key = j.get('usageKey', '')
            occ = ''
            if mt in ('EXACT', 'FUZZY'):
                matched += 1
                if mt == 'EXACT' and j.get('rank') == 'SPECIES':
                    species_exact += 1
            if counts and key != '' and mt in ('EXACT', 'FUZZY'):
                c = get(API + 'occurrence/search?' + urllib.parse.urlencode({'taxonKey': key, 'limit': 0}))
                time.sleep(delay)
                occ = c.get('count', '') if c else ''
            f.write('\t'.join(str(x) for x in [nm, q, mt, j.get('status', ''), j.get('rank', ''), key,
                                                 j.get('scientificName', ''), occ]) + '\n')
            f.flush()
            if tot % 25 == 0:
                print('progress', tot, file=sys.stderr, flush=True)
    print(json.dumps({'sampled': tot, 'matched_exact_or_fuzzy': matched, 'species_exact': species_exact,
                      'match_rate': round(matched / tot, 3) if tot else None,
                      'species_exact_rate': round(species_exact / tot, 3) if tot else None}))


if __name__ == '__main__':
    main(sys.argv)
