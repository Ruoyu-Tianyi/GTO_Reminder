import type { Dataset } from './poker';
import type { StandardTreeSpot } from './standard-coverage';
import type { TreeDataset } from './tree-strategy';

/** Paths are relative to /strategy-library/. JSON objects are stored as gzip files. */
export interface StrategyLibraryManifest {
  schemaVersion: 1;
  summary: string;
  published: string;
  references: string;
  pdfs: Record<string, string>;
  trees: Record<string, { file: string; packId: string }>;
  packs: Record<string, { index: string }>;
}

export interface StrategyTreeSummary {
  id: string;
  name: string;
  game: TreeDataset['game'];
  source: TreeDataset['source'];
  nodeCount: number;
  standardSpots?: StandardTreeSpot[];
}

export interface StrategyDatasetResponse {
  datasets: Dataset[];
  treeDatasets: TreeDataset[];
  errors: string[];
  treeLibrary?: StrategyTreeSummary[];
  matchedPartId?: string;
}

/** Exact canonical historyKey -> original tree part ID; no strategy interpolation. */
export type StrategyPackIndex = Record<string, string>;
