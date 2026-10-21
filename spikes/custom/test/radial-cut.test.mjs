// Runs the radial-cut regression script (scripts/check-radial-cut.mjs) under `npm test`. The script stays runnable on its own; it takes
// from a few seconds up to a couple of minutes depending on the machine, hence the generous timeout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', 'scripts', 'check-radial-cut.mjs');

test('radial cut regression script (scripts/check-radial-cut.mjs) passes', { timeout: 10 * 60 * 1000 }, () => {
  const r = spawnSync(process.execPath, ['--experimental-transform-types', '--no-warnings', script], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(r.status, 0, `exit code ${r.status}\n${r.stdout.slice(-4000)}\n${r.stderr.slice(-2000)}`);
  assert.equal(r.stdout.trimEnd().split('\n').pop(), 'OK', 'the script must end with OK');
});
