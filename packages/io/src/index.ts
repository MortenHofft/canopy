// Public surface of @gbif-phylo/io: tree file parsers and the TreeModel they produce.
export {
  parseNewick,
  parseNexus,
  toNewick,
  toNexus,
  quoteLabel,
  NewickError,
  type NexusResult,
  type NexusWriteOptions,
  type ParseOptions,
  type WriteOptions,
} from './newick.ts';
export { TreeModel, splitInternalLabel, type RawTree, type ParserWarning } from './tree.ts';
export { Annotations, supportFrom, type AnnotationRecord, type AnnotationScalar, type AnnotationValue } from './annotations.ts';
