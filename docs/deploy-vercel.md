# Deploying the comparison site on Vercel

The site is one static deployment built from this repository: a hub page with the comparison matrix and links, a side-by-side compare page, every candidate demo under its own path, and the test trees under `/data`. Nothing runs on a server.

## Settings

Import the GitHub repository `MortenHofft/gbif-phylo` in Vercel (Add New, Project). Most settings are also in [`vercel.json`](../vercel.json), which Vercel reads, so the dashboard fields can stay at what they show.

| Setting | Value |
|---------|-------|
| Production branch | `main` |
| Root Directory | the repository root (leave empty, not `spikes/`) |
| Framework Preset | **Other** |
| Build Command | `node scripts/build-site.mjs` (set in `vercel.json`) |
| Output Directory | `site-dist` (set in `vercel.json`) |
| Install Command | leave as `vercel.json` sets it (`echo ...`); each candidate installs its own dependencies inside the build script |
| Node.js Version | 22.x (also in the root `package.json` `engines`; check Project Settings, General) |
| Environment variables | none needed |
| "Include source files outside of the Root Directory" | not needed (root is the repository root) |

## What the build does

`scripts/build-site.mjs` runs on Vercel and locally:

1. For every folder in `spikes/` with a `package.json` and a `build` script (the candidates; `shared`, `runner`, `site` and `results` are skipped): `npm ci --ignore-scripts` (or `npm install` if there is no lockfile) and `npm run build`, then copies `dist/` to `site-dist/<name>/`. A candidate that fails to build is skipped and reported; the rest still deploy.
2. Builds the hub and compare page from `spikes/site` into the site root.
3. Copies the trees listed in `spikes/shared/trees.json` (plus their metadata and alignment files) that exist in `data/` to `site-dist/data/`, and writes `data/available.json`. Trees that are not committed (for example the 1M tip trees) are simply not offered. The build fails if the data folder exceeds 120 MB (`--max-data-mb`).
4. Writes `candidates.json` (read by the hub and compare pages from each candidate's `spike.json`) and copies the latest runner result per candidate into `results/`.

Expect a few minutes for the first build (a package install per candidate). Pin versions and commit the lockfiles of every candidate so builds are repeatable.

## Run it locally first

```
node scripts/build-site.mjs          # from the repository root; add --skip-install on reruns
npx --yes serve site-dist            # or any static server; serve supports the clean /compare URL
```

`vercel dev` is not needed.

## Why every app is built with an absolute base path

`vercel.json` sets `trailingSlash: false`, so `/custom/` is redirected to `/custom`. A page built with a relative base (`./assets/...`) then loads its scripts from `/assets/...` at the site root, which does not exist, and shows a blank white page. `scripts/build-site.mjs` therefore builds each demo with `--base=/<name>/` and the hub with `--base=/`. If you add a candidate, no change is needed; just do not hard-code a relative base in its Vite config command.

## Things to check after the first deploy

- `/` shows the matrix and the cards; `/compare` loads; `/<candidate>/` (for example `/stub/`) opens a viewer.
- A tree loads on the compare page (the `/data/...` requests return 200). `.gz` trees are inflated in the browser; the headers in `vercel.json` set the content types.
- If the project has Deployment Protection (Vercel Authentication), preview URLs ask people to sign in; set it as you want for sharing the link with colleagues (Project Settings, Deployment Protection).
- The GBIF logo and fonts load from gbif.org and Google Fonts; the page works without them but looks plainer.

## Notes and unverified points

- Vercel limits (deployment size, file counts, build time) were not checked here. The site is about 12 MB of data plus the apps; the build refuses data over 120 MB.
- Text responses such as `.nwk` are given `text/plain` in `vercel.json` so that Vercel compresses them; whether compression applies to every file type was not verified.
- Frame rates on the live site depend on the visitor's machine and GPU; the automated runs in `docs/results/` use headless Chromium without a GPU.
