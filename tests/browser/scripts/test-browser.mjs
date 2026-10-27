// `npm run test:browser`: for each page, build it, serve it with `vite preview` on a free port, wait until THAT server is up, run its
// browser check against it and stop the server; exit with the first failing check's exit code (0 when all pass). The pages:
//   test      this workspace's test page            scripts/check-radial-ui.mjs
//   vanilla   examples/vanilla (no framework)        scripts/check-vanilla-example.mjs
//   react     examples/react (<TreeView>, tree-ops)  scripts/check-node-menu.mjs
//   explorer  examples/explorer (the styled explorer)    scripts/check-explorer.mjs
//   playground examples/playground (every setting)     scripts/check-playground.mjs
//   table     examples/table (TBrowse-like table)    scripts/check-table.mjs
//   unrooted  examples/unrooted (layout spike, #42)  scripts/check-unrooted.mjs
//   parquet   examples/parquet (a tree and its sidecar as Parquet)  scripts/check-parquet.mjs (makes and serves its own dataset)
//   no-build  examples/no-build (plain HTML)          scripts/check-no-build.mjs (builds the packages, serves static files itself)
//   site      the demo site as Vercel serves it        scripts/check-site.mjs (runs scripts/build-site.mjs, serves site-dist itself)
//   node scripts/test-browser.mjs [--only test,vanilla,react,explorer,playground,table,unrooted,parquet,no-build,site] [--no-build]
// What is handled, exactly:
//  - readiness: the preview child must print its "Local:" line for our port and then answer; if it exits first (port taken with --strictPort,
//    crash) the run fails at once with its output, so a stale server on that port is never tested;
//  - the children (build, preview, check) are async, so SIGINT and SIGTERM sent to this script are acted on at once: the running child and the
//    server are killed by PID (never by pattern) and the exit code is 130;
//  - the server is also stopped on any error and when the check ends. A SIGKILL of this script cannot be handled and leaves the server running.
// Needs Playwright (playwright-core, a dev dependency of this workspace) and a Chromium: $CHROMIUM_PATH, the sandbox copy, or the one
// `npx playwright-core install chromium` fetched.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
const vite = path.join(path.dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin', 'vite.js');

/** A port nobody listens on: ask the OS for one and release it. */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

let running = null; // the foreground child (build or check)
let server = null;
let serverExited = false;
const stop = () => {
  if (server && !serverExited) server.kill('SIGTERM'); // by PID: the child we started
};
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.error(`\n${sig}: stopping`);
    if (running && running.exitCode === null) running.kill('SIGTERM');
    stop();
    process.exit(130);
  });
}

/** Run a node script with inherited output; resolves to its exit code (1 when killed by a signal). */
function run(args, cwd = pkg) {
  return new Promise((resolve) => {
    running = spawn(process.execPath, args, { cwd, stdio: 'inherit' });
    running.on('error', () => resolve(1));
    running.on('exit', (code) => resolve(code ?? 1));
  });
}

/** Start `vite preview` and resolve once it has printed its Local: line for `port` and answers; reject when it exits first or is too slow. */
function startPreview(port, ms, cwd) {
  serverExited = false;
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    let settled = false;
    const done = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(v);
    };
    const timer = setTimeout(() => done(reject, new Error(`vite preview was not ready within ${ms} ms\n${log}`)), ms);
    const local = new RegExp(`Local:\\s+http://127\\.0\\.0\\.1:${port}/`);
    const onData = (d) => {
      log += d;
      // eslint-disable-next-line no-control-regex -- strips the ANSI colour codes vite prints
      if (!settled && local.test(log.replace(/\u001b\[[0-9;]*m/g, ''))) {
        fetch(`http://127.0.0.1:${port}/`).then(
          (r) => (r.ok ? done(resolve) : done(reject, new Error(`the preview answered ${r.status}\n${log}`))),
          (e) => done(reject, new Error(`the preview printed its address but does not answer: ${e.message}\n${log}`)),
        );
      }
    };
    server.stdout.on('data', onData);
    server.stderr.on('data', onData);
    server.on('error', (e) => done(reject, e));
    server.on('exit', (code, signal) => {
      serverExited = true;
      done(reject, new Error(`vite preview exited (${signal ?? 'code ' + code}) before it was ready; is port ${port} already in use?\n${log}`));
    });
  });
}

const repo = path.resolve(pkg, '../..');
const SUITES = [
  { name: 'test', dir: pkg, check: 'check-radial-ui.mjs', args: (port) => ['--port', String(port)] },
  {
    name: 'vanilla',
    dir: path.join(repo, 'examples/vanilla'),
    check: 'check-vanilla-example.mjs',
    args: (port) => ['--url', `http://127.0.0.1:${port}/`],
  },
  { name: 'react', dir: path.join(repo, 'examples/react'), check: 'check-node-menu.mjs', args: (port) => ['--url', `http://127.0.0.1:${port}/`] },
  {
    name: 'explorer',
    dir: path.join(repo, 'examples/explorer'),
    check: 'check-explorer.mjs',
    args: (port) => ['--url', `http://127.0.0.1:${port}/`],
  },
  {
    name: 'playground',
    dir: path.join(repo, 'examples/playground'),
    check: 'check-playground.mjs',
    args: (port) => ['--url', `http://127.0.0.1:${port}/`],
  },
  {
    name: 'table',
    dir: path.join(repo, 'examples/table'),
    check: 'check-table.mjs',
    args: (port) => ['--url', `http://127.0.0.1:${port}/`],
  },
  {
    name: 'unrooted',
    dir: path.join(repo, 'examples/unrooted'),
    check: 'check-unrooted.mjs',
    args: (port) => ['--url', `http://127.0.0.1:${port}/`],
  },
  // the Parquet page: the check makes a small dataset and serves it itself (range requests, on another origin)
  {
    name: 'parquet',
    dir: path.join(repo, 'examples/parquet'),
    check: 'check-parquet.mjs',
    args: (port) => ['--url', `http://127.0.0.1:${port}/`],
  },
  // no Vite: the packages' own build (dist/browser), and the check serves the repository as static files
  { name: 'no-build', dir: path.join(repo, 'examples/no-build'), check: 'check-no-build.mjs', static: true },
  // the check builds the site itself (scripts/build-site.mjs, unless --no-build) and serves it
  { name: 'site', dir: repo, check: 'check-site.mjs', self: true },
];

/** `npm run build` at the repository root (every package, with the single-file browser builds); resolves to its exit code. */
function buildPackages() {
  return new Promise((resolve) => {
    running = spawn('npm', ['run', 'build'], { cwd: repo, stdio: 'inherit' });
    running.on('error', () => resolve(1));
    running.on('exit', (c) => resolve(c ?? 1));
  });
}
const only = opt('only')?.split(',');

let code = 0;
for (const s of SUITES) {
  if (only && !only.includes(s.name)) continue;
  try {
    console.log(`\n== ${s.name}: ${path.relative(repo, s.dir)}`);
    if (s.self) {
      console.log(`> ${s.check}`);
      const c = await run([path.join(here, s.check), ...(flag('no-build') ? ['--no-build'] : [])]);
      code ||= c;
      continue;
    }
    if (s.static) {
      if (!flag('no-build')) {
        console.log('> npm run build (packages)');
        const b = await buildPackages();
        if (b !== 0) {
          code ||= b;
          continue;
        }
      }
      console.log(`> ${s.check}`);
      const c = await run([path.join(here, s.check)]);
      code ||= c;
      continue;
    }
    if (!flag('no-build')) {
      console.log('> vite build');
      const b = await run([vite, 'build'], s.dir);
      if (b !== 0) {
        code ||= b;
        continue;
      }
    }
    const port = await freePort();
    console.log(`> vite preview on 127.0.0.1:${port}`);
    await startPreview(port, 30000, s.dir);
    console.log(`> ${s.check}`);
    const c = await run([path.join(here, s.check), ...s.args(port)]);
    code ||= c;
  } catch (e) {
    console.error(String(e?.message ?? e));
    code ||= 1;
  } finally {
    stop();
  }
}
process.exit(code);
