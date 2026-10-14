// Build a candidate, serve its production build with `npm run preview`, measure bundle size.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { sleep } from './util.mjs';

export function build(dir, log) {
  log(`building ${path.basename(dir)} (npm run build)`);
  const r = spawnSync('npm', ['run', 'build'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`npm run build failed in ${dir}:\n${(r.stdout || '') + (r.stderr || '')}`.slice(-4000));
}

/** Minified + gzipped size of everything in dist/ (the page's own assets; /data is not part of it). */
export function bundleSize(dir) {
  const dist = path.join(dir, 'dist');
  if (!fs.existsSync(dist)) return null;
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const b = fs.readFileSync(p);
        files.push({ path: path.relative(dist, p), bytes: b.length, gzipBytes: zlib.gzipSync(b, { level: 9 }).length });
      }
    }
  };
  walk(dist);
  const sum = (f, k) => files.filter(f).reduce((a, x) => a + x[k], 0);
  const isJs = (x) => /\.(m?js)$/.test(x.path);
  const isCss = (x) => x.path.endsWith('.css');
  return {
    jsBytes: sum(isJs, 'bytes'),
    jsGzipBytes: sum(isJs, 'gzipBytes'),
    cssBytes: sum(isCss, 'bytes'),
    cssGzipBytes: sum(isCss, 'gzipBytes'),
    totalBytes: sum(() => true, 'bytes'),
    totalGzipBytes: sum(() => true, 'gzipBytes'),
    files,
  };
}

export async function startPreview(dir, port, log) {
  const child = spawn('npm', ['run', 'preview', '--', '--port', String(port), '--strictPort'], { cwd: dir, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  let exited = false;
  child.on('exit', () => (exited = true));
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) {
    if (exited) throw new Error(`preview server exited early:\n${out}`);
    try {
      const r = await fetch(url);
      if (r.ok) {
        log(`preview serving ${url}`);
        return {
          url,
          stop: async () => {
            try {
              process.kill(-child.pid, 'SIGTERM');
            } catch {}
            await sleep(200);
            try {
              process.kill(-child.pid, 'SIGKILL');
            } catch {}
          },
        };
      }
    } catch {}
    await sleep(150);
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {}
  throw new Error(`preview server did not answer on ${url}:\n${out}`);
}
