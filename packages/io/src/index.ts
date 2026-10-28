// Public surface of @canopy/io: tree file parsers and the TreeModel they produce.
export { parseNewick, toNewick, quoteLabel, NewickError, type ParseOptions, type WriteOptions } from './newick.ts';
export {
  parseNexus,
  nexusIndex,
  nexusTrees,
  toNexus,
  type NexusIndex,
  type NexusNote,
  type NexusResult,
  type NexusTreeInfo,
  type NexusTreeResult,
  type NexusWriteOptions,
} from './nexus.ts';
export { TreeModel, splitInternalLabel, type DerivedArrays, type RawTree, type ParserWarning } from './tree.ts';
export { parseSidecar, Sidecar, SidecarBinding, SidecarError, type Categories, type SidecarReport } from './sidecar.ts';
export { Annotations, supportFrom, type AnnotationRecord, type AnnotationScalar, type AnnotationValue } from './annotations.ts';
export { parsePhyloXml, type PhyloXmlNote, type PhyloXmlOptions, type PhyloXmlResult } from './phyloxml.ts';
