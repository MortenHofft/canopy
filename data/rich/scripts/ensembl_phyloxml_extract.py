#!/usr/bin/env python3
"""Pull single trees out of an Ensembl Compara *.tree.phyloxml.xml.tar (tar of tar.gz of xml).
Usage: python3 -I ensembl_phyloxml_extract.py <tar> <outdir> <member_name_substring> [...]
Nothing is extracted to disk by path: members are read in memory and written to outdir/<basename>.
"""
import io, os, sys, tarfile, zlib

def main(a):
    tarp, outdir, wants = a[1], a[2], a[3:]
    os.makedirs(outdir, exist_ok=True)
    outer = tarfile.open(tarp)
    for m in outer:
        inner = tarfile.open(fileobj=io.BytesIO(zlib.decompress(outer.extractfile(m).read(), 31)))
        for mm in inner:
            if any(w in mm.name for w in wants):
                data = inner.extractfile(mm).read()
                dst = os.path.join(outdir, os.path.basename(mm.name))
                with open(dst, 'wb') as f:
                    f.write(data)
                print('wrote', dst, len(data))

if __name__ == '__main__':
    main(sys.argv)
