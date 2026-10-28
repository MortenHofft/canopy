// The Chromium the browser checks and benchmarks launch: $CHROMIUM_PATH, else the newest one preinstalled under /opt/pw-browsers (the
// cloud sandbox) when there is one, else undefined, which lets Playwright use its own browser (what `npx playwright-core install
// chromium` fetched, as in CI).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/opt/pw-browsers';

export function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  let names;
  try {
    names = fs.readdirSync(ROOT);
  } catch {
    return undefined;
  }
  const revision = (name) => Number(/^chromium-(\d+)$/.exec(name)?.[1]);
  const dirs = names.filter((name) => revision(name) > 0).sort((a, b) => revision(b) - revision(a));
  for (const dir of dirs) {
    for (const sub of ['chrome-linux64', 'chrome-linux']) {
      const exe = path.join(ROOT, dir, sub, 'chrome');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return undefined;
}
