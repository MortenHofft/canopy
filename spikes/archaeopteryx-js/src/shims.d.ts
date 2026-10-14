declare module 'archaeopteryx/forester' {
  export const forester: {
    joinMetadataTable(tree: unknown, text: string): {
      columns: Array<{ header: string; ref: string; datatype: string; filled: number }>;
      tips: number;
      matchedTips: number;
      unmatchedTips: string[];
      unmatchedRows: string[];
      properties?: unknown;
    };
    [k: string]: unknown;
  };
}
declare module 'phyloxml' {
  export const phyloXml: unknown;
}
declare module 'd3';
