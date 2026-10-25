// What a page shows of the build it is (the site hub's footer, the explorer's debug panel): Vercel's variables when it builds, git
// otherwise, "dev" without either. Read by the pages' vite.config.ts and handed to the page as the `__BUILD__` define.

import { execFileSync } from 'node:child_process';

const git = (...a) => {
  try {
    return execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

/** `{ commit, branch, env, time }`: the short commit, the branch, Vercel's environment ('local' outside it) and when it was built. */
export function buildInfo() {
  return {
    commit: (process.env.VERCEL_GIT_COMMIT_SHA || git('rev-parse', 'HEAD') || 'dev').slice(0, 7),
    branch: process.env.VERCEL_GIT_COMMIT_REF || git('rev-parse', '--abbrev-ref', 'HEAD'),
    env: process.env.VERCEL_ENV || 'local',
    time: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
  };
}
