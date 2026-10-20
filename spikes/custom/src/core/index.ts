// Public surface of the renderer core (no React).
export { TreeRenderer } from './renderer.ts';
export { computeLayout, type Layout } from './layout.ts';
export * from './types.ts';
export { cutRect, cutRadial, DrawList, Seen } from './lod.ts';
export { HitIndex } from './hit.ts';
export { InMemorySource, isTreeSource, type TreeSource, type EnsureOptions } from './source.ts';
