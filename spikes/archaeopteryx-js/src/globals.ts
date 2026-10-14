// Side-effect module: puts d3, phyloXml and forester on globalThis. It must be imported BEFORE 'archaeopteryx'.
//
// archaeopteryx.js is a UMD file whose CommonJS branch resolves its dependencies with `require(variable)` inside
// try/catch (archaeopteryx.js:84-96). A bundler cannot follow `require(variable)`, so d3, phyloxml and
// ./forester are not bundled through that path; the library then falls back to the globals `d3`, `phyloXml`
// and `forester` (and says "d3 (version 7) must be loaded before launching" if they are missing).
import * as d3 from 'd3';
import { phyloXml } from 'phyloxml';
import { forester } from 'archaeopteryx/forester';

const g = globalThis as unknown as Record<string, unknown>;
g.d3 = d3;
g.phyloXml = phyloXml;
g.forester = forester;
