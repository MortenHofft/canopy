// Small helpers shared by the runner modules.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

export const RUNNER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const SPIKES_DIR = path.resolve(RUNNER_DIR, '..');
export const REPO_DIR = path.resolve(SPIKES_DIR, '..');
export const DATA_DIR = path.join(REPO_DIR, 'data');
export const RESULTS_DIR = path.join(SPIKES_DIR, 'results');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class TimeoutError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'TimeoutError';
  }
}

export function withTimeout(promise, ms, what) {
  let t;
  const to = new Promise((_, rej) => {
    t = setTimeout(() => rej(new TimeoutError(`${what} exceeded ${(ms / 1000).toFixed(0)} s`)), ms);
  });
  promise.catch(() => {}); // a late rejection after the timeout must not crash the run
  return Promise.race([promise, to]).finally(() => clearTimeout(t));
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (k.startsWith('no-')) out[k] = true;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

export function median(a) {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function pearson(x, y) {
  const n = x.length;
  if (n < 3) return NaN;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

export function spearman(x, y) {
  const rank = (a) => {
    const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(a.length);
    for (let k = 0; k < idx.length; ) {
      let j = k;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[k][0]) j++;
      for (let m = k; m <= j; m++) r[idx[m][1]] = (k + j) / 2;
      k = j + 1;
    }
    return r;
  };
  return pearson(rank(x), rank(y));
}

export async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

export const fmt = (x, d = 0) => (x === undefined || x === null || Number.isNaN(x) ? '-' : Number(x).toFixed(d));

export function runId(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
}

export function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
