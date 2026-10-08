#!/usr/bin/env python3
"""List or extract single members of a remote ZIP via HTTP Range requests (uses `curl`), so a
multi-hundred-MB archive need not be downloaded. Pure stdlib + the curl binary.

Usage (python3 -I):
  zip_range_extract.py list    <url>
  zip_range_extract.py extract <url> <outdir> <member> [<member> ...]
"""
import io, os, subprocess, sys, time, zipfile


class RangeFile(io.RawIOBase):
    def __init__(self, url):
        self.url, self.pos = url, 0
        h = subprocess.run(['curl', '-sSIL', '-m', '60', url], capture_output=True, text=True).stdout
        sizes = [l.split(':', 1)[1].strip() for l in h.splitlines() if l.lower().startswith('content-length:')]
        self.size = int(sizes[-1])

    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def read(self, n=-1):
        if n < 0 or self.pos + n > self.size:
            n = self.size - self.pos
        if n <= 0:
            return b''
        for attempt in range(10):
            r = subprocess.run(['curl', '-sSL', '-m', '120', '-r', '%d-%d' % (self.pos, self.pos + n - 1), self.url],
                               capture_output=True)
            if len(r.stdout) == n:
                break
            time.sleep(2 + attempt)
        self.pos += len(r.stdout)
        return r.stdout


def main(a):
    z = zipfile.ZipFile(RangeFile(a[2]))
    if a[1] == 'list':
        for i in z.infolist():
            print(i.file_size, i.compress_size, i.filename)
    elif a[1] == 'extract':
        os.makedirs(a[3], exist_ok=True)
        for m in a[4:]:
            data = z.read(m)
            dst = os.path.join(a[3], os.path.basename(m))
            open(dst, 'wb').write(data)
            print('wrote', dst, len(data))
    else:
        sys.exit(__doc__)

if __name__ == '__main__':
    main(sys.argv)
