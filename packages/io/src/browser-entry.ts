// The entry of the single-file browser build (`@canopy/io/browser`, scripts/bundle-browser.mjs): everything in index.ts and the worker
// parse (#4), so a page without a build step can parse in a worker through the one import. The worker's own file is
// `dist/browser/io-parse-worker.js`, next to the build. Bundler users import `@canopy/io` and `@canopy/io/worker` separately.
export * from './index.ts';
export * from './worker.ts';
