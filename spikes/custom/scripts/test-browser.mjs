// `npm run test:browser`: build the production bundle, serve it with `vite preview` on a free port, wait until it answers, run the browser
// check (scripts/check-radial-ui.mjs) against it, stop the server and exit with the check's exit code.
//   node scripts/test-browser.mjs [--port 5326] [--no-build]
// The server is stopped by its PID (never by pattern), also on Ctrl-C, SIGTERM and an error. Needs Playwright (spikes/runner, see the check
// script) and a Chromium: $CHROMIUM_PATH, the sandbox copy, or the one `npx playwright-core install chromium` fetched.
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
const vite = path.join(pkg, 'node_modules', 'vite', 'bin', 'vite.js');

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

async function waitFor(url, ms) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > end) throw new Error(`${url} did not answer within ${ms} ms`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

if (!flag('no-build')) {
  console.log('> vite build');
  const b = spawnSync(process.execPath, [vite, 'build'], { cwd: pkg, stdio: 'inherit' });
  if (b.status !== 0) process.exit(b.status ?? 1);
}

const port = Number(opt('port') || (await freePort()));
console.log(`> vite preview on 127.0.0.1:${port}`);
const server = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: pkg,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
for (const s of [server.stdout, server.stderr]) s.on('data', (d) => (serverLog += d));
let serverExited = false;
server.on('exit', () => (serverExited = true));
const stop = () => {
  if (!serverExited) server.kill('SIGTERM'); // by PID: the child we started
};
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stop();
    process.exit(130);
  });
}

let code = 1;
try {
  await waitFor(`http://127.0.0.1:${port}/`, 30000);
  console.log('> check-radial-ui.mjs');
  const r = spawnSync(process.execPath, [path.join(here, 'check-radial-ui.mjs'), '--port', String(port)], { cwd: pkg, stdio: 'inherit' });
  code = r.status ?? 1;
} catch (e) {
  console.error(String(e?.message ?? e));
  if (serverLog) console.error(serverLog);
} finally {
  stop();
}
process.exit(code);
