// The Chromium the browser checks and benchmarks launch: $CHROMIUM_PATH, else the cloud sandbox's copy when it exists, else undefined,
// which lets Playwright use its own browser (what `npx playwright-core install chromium` fetched, as in CI).
import fs from 'node:fs';

const SANDBOX = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  return fs.existsSync(SANDBOX) ? SANDBOX : undefined;
}
