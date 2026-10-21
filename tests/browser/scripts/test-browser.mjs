// `npm run test:browser`: build the production bundle, serve it with `vite preview` on a free port, wait until THAT server is up, run the
// browser check (scripts/check-radial-ui.mjs) against it, stop the server and exit with the check's exit code.
//   node scripts/test-browser.mjs [--port 5326] [--no-build]
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
function run(args) {
  return new Promise((resolve) => {
    running = spawn(process.execPath, args, { cwd: pkg, stdio: 'inherit' });
    running.on('error', () => resolve(1));
    running.on('exit', (code) => resolve(code ?? 1));
  });
}

/** Start `vite preview` and resolve once it has printed its Local: line for `port` and answers; reject when it exits first or is too slow. */
function startPreview(port, ms) {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: pkg,
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

let code = 1;
try {
  if (!flag('no-build')) {
    console.log('> vite build');
    const b = await run([vite, 'build']);
    if (b !== 0) process.exit(b);
  }
  const port = Number(opt('port') || (await freePort()));
  console.log(`> vite preview on 127.0.0.1:${port}`);
  await startPreview(port, 30000);
  console.log('> check-radial-ui.mjs');
  code = await run([path.join(here, 'check-radial-ui.mjs'), '--port', String(port)]);
} catch (e) {
  console.error(String(e?.message ?? e));
} finally {
  stop();
}
process.exit(code);
