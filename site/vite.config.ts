import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';

// Build facts for the footer: Vercel's variables when it builds, git otherwise.
const git = (...a: string[]) => {
  try {
    return execFileSync('git', a, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};
const build = {
  commit: (process.env.VERCEL_GIT_COMMIT_SHA || git('rev-parse', 'HEAD')).slice(0, 7),
  branch: process.env.VERCEL_GIT_COMMIT_REF || git('rev-parse', '--abbrev-ref', 'HEAD'),
  env: process.env.VERCEL_ENV || 'local',
  time: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
};

export default defineConfig({
  base: '/',
  define: { __BUILD__: JSON.stringify(build) },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  build: { target: 'es2022' },
});
