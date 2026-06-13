export type NormalizedBlock = {
  blockId: string;
  blockType: string;
  text: string;
  headingLevel: number | null;
};

export type NormalizedPage = {
  pageId: string;
  title: string;
  url: string;
  blocks: NormalizedBlock[];
};

export type SourceChunk = {
  sourceId: string;
  pageId: string;
  pageTitle: string;
  pageUrl: string;
  headingPath: string[];
  blockIds: string[];
  text: string;
  score: number;
};

export type NotionSearchPage = {
  pageId: string;
  title: string;
  url: string;
};

export type NotionMarkdownPage = NotionSearchPage & {
  markdown: string;
  truncated: boolean;
  unknownBlockIds: string[];
};
