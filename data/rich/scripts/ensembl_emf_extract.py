#!/usr/bin/env python3
"""Index or extract gene families from Ensembl Compara EMF dumps (pure stdlib, iterative).

Usage (run with `python3 -I`):
  ensembl_emf_extract.py index   <aln.emf.gz>                      -> prints "index nseq alnlen" per record
  ensembl_emf_extract.py extract <aln.emf.gz> <record_index> <outdir> <prefix>

The aln.emf.gz files (ftp.ensembl.org/pub/release-N/emf/ensembl-compara/homologies/) hold, for each
gene tree, SEQ lines (species, protein id, location, gene id, symbol), TREE newick/nhx lines and the
alignment (after DATA: one line per alignment COLUMN, one character per sequence in SEQ order). Records end with a line "//".

extract writes: <prefix>.nwk (plain newick), <prefix>.nhx, <prefix>.aln.fa (aligned FASTA),
<prefix>.members.tsv (tip -> species, gene, symbol, location).
"""
import gzip
import os
import sys


def records(path):
    cur = []
    with gzip.open(path, 'rt', encoding='utf-8', errors='replace') as fh:
        for line in fh:
            line = line.rstrip('\n')
            if line == '//':
                yield cur
                cur = []
            else:
                cur.append(line)
    if cur:
        yield cur


def split(rec):
    seqs, trees, rows = [], {}, []
    in_data = False
    for l in rec:
        if in_data:
            if l:
                rows.append(l)
        elif l.startswith('SEQ '):
            seqs.append(l.split(' '))
        elif l.startswith('TREE '):
            _, kind, rest = l.split(' ', 2)
            trees[kind] = rest
        elif l == 'DATA':
            in_data = True
    return seqs, trees, rows


def main(argv):
    if len(argv) >= 3 and argv[1] == 'index':
        for i, rec in enumerate(records(argv[2])):
            seqs, trees, rows = split(rec)
            print(i, len(seqs), len(rows))  # rows = alignment columns
        return
    if len(argv) == 6 and argv[1] == 'extract':
        want = int(argv[3])
        outdir, prefix = argv[4], argv[5]
        os.makedirs(outdir, exist_ok=True)
        for i, rec in enumerate(records(argv[2])):
            if i != want:
                continue
            seqs, trees, rows = split(rec)
            # EMF DATA lines are alignment COLUMNS (one char per sequence): transpose to rows
            assert all(len(c) == len(seqs) for c in rows), 'unexpected DATA layout'
            rows = [''.join(c[k] for c in rows) for k in range(len(seqs))]
            base = os.path.join(outdir, prefix)
            with open(base + '.nwk', 'w') as f:
                f.write(trees['newick'] + '\n')
            with open(base + '.nhx', 'w') as f:
                f.write(trees['nhx'] + '\n')
            with open(base + '.aln.fa', 'w') as f:
                for s, r in zip(seqs, rows):
                    f.write('>%s\n' % s[2])
                    for k in range(0, len(r), 80):
                        f.write(r[k:k + 80] + '\n')
            with open(base + '.members.tsv', 'w') as f:
                f.write('protein_id\tspecies\tgene_id\tgene_symbol\tseq_region\tstart\tend\tstrand\n')
                for s in seqs:
                    # SEQ species protein region start end strand gene symbol
                    sym = s[9] if len(s) > 9 and s[9] != 'NULL' else ''
                    f.write('\t'.join([s[2], s[1], s[8], sym, s[3], s[4], s[5], s[6]]) + '\n')
            print('wrote', base, len(seqs), 'sequences', len(rows[0]), 'columns')
            return
        sys.exit('record not found')
    sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv)
