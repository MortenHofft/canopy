# Hosting the Parquet tree files: what the host must do

Date 2026-10-21. Companion to [results/parquet-experiment.md](results/parquet-experiment.md) (section 12 asked for this check) and [results/treesource-slice.md](results/treesource-slice.md). Evidence levels as in [evaluation-framework.md](evaluation-framework.md): **M** measured here, **D** documented by the vendor (read from memory unless a link is given, so treat as unverified), **U** unverified.

## 1. Short answer

Plain static files are enough. No server code, no database, no special service. The files are immutable byte blobs that the browser reads in pieces with HTTP range requests, so the host has to do three things:

1. Answer `GET` with a `Range: bytes=a-b` header by `206 Partial Content` and exactly those bytes. Every ordinary static server does this (nginx, Apache, S3, object stores); what breaks it is a proxy, CDN or framework that strips `Range` or re-compresses the body.
2. Send `Access-Control-Allow-Origin` for the origin the viewer runs on (`https://www.gbif.org`, or `*`). The reader sends only a simple `Range` header, which browsers allow without a preflight, so an `OPTIONS` handler is not needed (**M**: no preflight observed in Chromium in the experiment, section 6).
3. Not apply `Content-Encoding` (gzip, brotli) to the Parquet files. The byte offsets in the reader are offsets into the stored file; a compressed transfer would change them. Parquet is already zstd-compressed inside, so there is nothing to gain anyway.

Nice to have: a long `Cache-Control` (`public, max-age=31536000, immutable`) because the files never change in place (a new tree version gets a new path), and a CDN that caches ranges as objects rather than fetching the whole file from origin for every range.

Checking a host takes a minute with `node spikes/parquet-experiment/check-host.mjs <url to a parquet file> --origin https://www.gbif.org`: it sends the same requests the reader sends and reports the three requirements plus cache behaviour (**M** against GitHub raw: pass).

## 2. What the reader actually requests

The browser code (`spikes/parquet-experiment/web/reader.js`, used by `spikes/custom/src/parquet/ParquetSource.ts`) does, per tree:

* `GET manifest.json` (2 to 4 KB) once.
* `GET overview.parquet` with `Range: bytes=<tail_start>-` (20 to 60 KB) for the first view, then one range per deeper overview level.
* `GET nodes.parquet`, `tips.parquet`, `labels.parquet` with ranges of 64 KB to a few MB as the user zooms (one row group of 16,384 rows at a time, coalesced when adjacent).
* Nothing is ever downloaded whole. Byte lengths come from `manifest.json`, so the host does not need to expose `Content-Range` to JavaScript (it is not a CORS-safelisted response header; without `Access-Control-Expose-Headers` the browser hides it, and that is fine).
* `HEAD` is never sent. `OPTIONS` is never sent.

A 10M-tip tree is about 300 MB in 6 files; the largest (`nodes.parquet`) about 130 MB. Each file is one object. There is no need to split files for the reader; only a host with a per-file limit (GitHub: 100 MB) would force that.

## 3. Candidate hosts

| Host | Range | CORS | Content-Encoding | Notes | Evidence |
|---|---|---|---|---|---|
| **Amazon S3** (or any S3-compatible store: MinIO, Ceph RGW, R2) | yes, native | bucket CORS configuration: `AllowedOrigins`, `AllowedMethods: GET, HEAD`, `AllowedHeaders: Range` (or `*`) | none unless you set it on the object; upload with `Content-Type: application/octet-stream` and no `Content-Encoding` | S3 stores arbitrary bytes; there are no rules on content, only on size (5 TB per object, multipart above 5 GB). Public read needs a bucket policy or public-read ACL, or put CloudFront in front. | D |
| **CloudFront in front of S3** | yes; CloudFront fetches the origin in 1 MB-ish parts (D) and serves ranges from cache | a CORS response headers policy, or forward the `Origin` header to S3 and let S3 answer | leave compression off for `.parquet` (CloudFront only compresses listed types; `application/octet-stream` is not one, D) | the normal AWS setup | D |
| **nginx static** (a GBIF server) | on by default for static files | `add_header Access-Control-Allow-Origin *;` for the location (add `always` so it is also sent on 206 and 416) | `gzip on` does not touch `application/octet-stream` unless listed in `gzip_types`; do not list it | works out of the box; `sendfile` and `max_ranges` default is unlimited | D |
| **Apache static** | on by default (`Accept-Ranges: bytes`, seen on api.gbif.org's download host, **M** on a 404) | `Header set Access-Control-Allow-Origin "*"` (mod_headers) | `mod_deflate` only compresses listed types; keep `.parquet` off the list | | D, M |
| **Varnish in front** (GBIF uses Varnish on api.gbif.org, **M** from the `server` header) | Varnish serves ranges from cache; the first range for an uncached object makes it fetch the whole object from the backend (streamed) and cache it, so one 130 MB fetch per cache node per file | passed through from the backend, or set in VCL | none | fine for immutable files; make sure the TTL is long so the whole-object fetch is rare | D |
| GitHub raw (`raw.githubusercontent.com`) | 206, Fastly cache hits on repeated ranges | `*` | none | 100 MB per file, rate limited for unauthenticated use, 5-minute cache; fine for a test, not for gbif.org | **M** |
| GitHub Releases | 206 | **no `Access-Control-Allow-Origin`** on the asset response: the browser blocks it | | out | **M** |
| Vercel static deployment | not tested (the sandbox cannot reach vercel.app) | ours to set in `vercel.json` | | 100 MB per file (Hobby) / 1 GB (Pro); redeploys re-upload everything | D, U |

The S3 CORS configuration that covers the reader, in the JSON form the S3 console takes:

```json
[
  {
    "AllowedOrigins": ["https://www.gbif.org", "https://*.gbif.org"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range"],
    "ExposeHeaders": ["Content-Range", "Content-Length", "ETag"],
    "MaxAgeSeconds": 86400
  }
]
```

`ExposeHeaders` is optional for our reader (section 2) but harmless and useful for other tools. For a quick test `AllowedOrigins: ["*"]` is fine: the files are public data.

The nginx equivalent for a location that serves the tree folders:

```nginx
location /phylo/ {
    root /var/www;
    add_header Access-Control-Allow-Origin "*" always;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    types { application/octet-stream parquet; application/json json; }
}
```

## 4. Layout on the host

```
<base>/<tree id>/<content hash or version>/manifest.json
                                          overview.parquet
                                          nodes.parquet
                                          tips.parquet
                                          tipmeta.parquet
                                          labels.parquet
                                          spine.parquet
                                          open.json
```

`manifest.json` ties the files together (sizes, row groups, levels), so the seven files of one tree version must stay together and unchanged; a re-converted tree goes under a new prefix. The reader takes the folder URL and appends the file names (`ParquetSource` in `spikes/custom/src/parquet/`, `?url=<folder>` on the dev page).

## 5. Not checked

Real CDN behaviour for ranges of a 130 MB object (cold-start cost, per-range billing), Safari and Firefox range handling against the chosen host, and behaviour under many concurrent users. Section 12 of the experiment report lists the same gaps; `check-host.mjs` answers the first part once a URL exists.
