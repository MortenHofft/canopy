// Public surface of the renderer core (no React).
export { TreeRenderer } from './renderer.ts';
export { computeLayout, type Layout } from './layout.ts';
export * from './types.ts';
export { cut, searchCut, newCutResult, DrawList, Seen, type CutParams, type CutResult } from './lod.ts';
export { projectionFor, RectProjection, RadialProjection, type LayoutProjection } from './projection.ts';
export { HitIndex } from './hit.ts';
export { InMemorySource, isTreeSource, type TreeSource, type EnsureOptions } from './source.ts';
