// @phylocanvas/phylocanvas.gl 1.64.1 ships no type declarations (no `types` field in its package.json).
declare module '@phylocanvas/phylocanvas.gl' {
  const PhylocanvasGL: any;
  export default PhylocanvasGL;
}

// deck.gl 8.9 ships its types in a different layout than this tsconfig resolves; we only use three layers.
declare module '@deck.gl/layers' {
  export const LineLayer: any;
  export const TextLayer: any;
  export const BitmapLayer: any;
}
