// Public surface of @canopy/io: tree file parsers and the TreeModel they produce.
export {
  parseNewick,
  parseNexus,
  nexusIndex,
  nexusTrees,
  toNewick,
  toNexus,
  quoteLabel,
  NewickError,
  type NexusIndex,
  type NexusNote,
  type NexusResult,
  type NexusTreeInfo,
  type NexusTreeResult,
  type NexusWriteOptions,
  type ParseOptions,
  type WriteOptions,
} from './newick.ts';
export { TreeModel, splitInternalLabel, type RawTree, type ParserWarning } from './tree.ts';
export { parseSidecar, Sidecar, SidecarBinding, SidecarError, type Categories, type SidecarReport } from './sidecar.ts';
export { Annotations, supportFrom, type AnnotationRecord, type AnnotationScalar, type AnnotationValue } from './annotations.ts';
export { parsePhyloXml, type PhyloXmlNote, type PhyloXmlOptions, type PhyloXmlResult } from './phyloxml.ts';
