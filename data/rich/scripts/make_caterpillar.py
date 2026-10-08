#!/usr/bin/env python3
"""Write a fully unbalanced (caterpillar) Newick tree with N tips, iteratively. Hand-made test data.
Usage: python3 -I make_caterpillar.py <N> <out.nwk>"""
import sys
n = int(sys.argv[1])
buf = ['(' * (n - 1) + 't0:1']
for i in range(1, n):
    buf.append(',t%d:1):1' % i)
open(sys.argv[2], 'w').write(''.join(buf)[:-2] + ';\n')
