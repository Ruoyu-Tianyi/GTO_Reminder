import { HANDS, type Dataset } from './poker';
import { displayPublishedChart } from './display-ranges';
import type { PublishedChartNode } from './published-charts';
import type { ReferenceKind, ReferenceRange } from './reference-ranges';
import { gameKey, type TreeDataset } from './tree-strategy';
import { buildStandardCoverage, type StandardCoverage, type StandardTreeSpot } from './standard-coverage';

export const INVENTORY_PLAYERS = [6, 7, 8, 9] as const;
export const INVENTORY_REFERENCE_KINDS: readonly ReferenceKind[] = ['rfi', 'vs-open', 'vs-3bet', 'vs-4bet', 'vs-5bet', 'vs-limp'];
export type InventoryQuality = 'approximate' | 'unconverged' | 'imported' | 'demo' | 'unknown';
type SourceKind = Dataset['source']['kind'];

/** The summary API contains metadata only, never all hands from every shard. */
export type InventoryTreeEntry = Pick<TreeDataset, 'id' | 'name' | 'game' | 'source'> & { nodeCount: number; standardSpots?: StandardTreeSpot[] };
export interface InventoryInput {
  /** null means unavailable or not yet loaded; [] means successfully loaded and empty. */
  publishedCharts: readonly PublishedChartNode[] | null;
  referenceRanges: readonly ReferenceRange[] | null;
  datasets: readonly Dataset[] | null;
  treeLibrary: readonly InventoryTreeEntry[] | null;
  /** An endpoint can succeed while excluding invalid files; their coverage remains unknown. */
  localIncomplete?: boolean;
}
export interface ReferenceCounts {
  charts: number;
  /** Counts hand-class rows across charts, not distinct hands or physical combinations. */
  availableHands: number;
  unknownHands: number;
  notChartedHands: number;
  unreadableHands: number;
  missingHands: number;
}
export interface ReferenceCaseInventory { original: ReferenceCounts; projected: ReferenceCounts }
export interface ReferenceInventory extends ReferenceCaseInventory {
  byKind: Record<ReferenceKind, ReferenceCaseInventory>;
}
export interface LocalCounts {
  /** Tree model packs only. A Quick-only dataset does not establish a tree pack. */
  modelPacks: number;
  /** Stored decisions across packs; not globally distinct histories. */
  decisionNodes: number;
  /** v1 stored lookup nodes; overlaps with tree decisions and must not be added to them. */
  quickNodes: number;
}
export interface LocalInventory extends LocalCounts {
  bySource: Record<SourceKind, LocalCounts>;
  /** Counts tree packs by source declaration, not independent quality verification. */
  qualityCounts: Record<InventoryQuality, number>;
}
export interface InventoryModelPack {
  key: string;
  /** Representative dataset ID for opening the pack. */
  id: string;
  name: string;
  players: number;
  game: TreeDataset['game'];
  source: TreeDataset['source'];
  shardIds: string[];
  decisionNodes: number;
  quality: InventoryQuality;
}
export interface DataInventory {
  byPlayers: Array<{ players: number; references: ReferenceInventory | null; local: LocalInventory | null }>;
  totals: { references: ReferenceInventory | null; local: LocalInventory | null };
  packs: InventoryModelPack[] | null;
  standard: StandardCoverage;
  warnings: string[];
}

const emptyReferenceCounts = (): ReferenceCounts => ({ charts: 0, availableHands: 0, unknownHands: 0, notChartedHands: 0, unreadableHands: 0, missingHands: 0 });
const emptyReferenceCase = (): ReferenceCaseInventory => ({ original: emptyReferenceCounts(), projected: emptyReferenceCounts() });
const emptyLocalCounts = (): LocalCounts => ({ modelPacks: 0, decisionNodes: 0, quickNodes: 0 });

/** A repeated ID is harmless only when the records agree. Conflicts fail closed. */
function distinctRecords<T extends { id: string }>(records: readonly T[], label: string, warnings: string[]): T[] {
  const unique = new Map<string, { value: T; json: string }>();
  const conflicts = new Set<string>();
  for (const value of records) {
    const json = JSON.stringify(value);
    const prior = unique.get(value.id);
    if (prior && prior.json !== json) conflicts.add(value.id);
    else if (!prior) unique.set(value.id, { value, json });
  }
  for (const id of conflicts) warnings.push(`${label}: conflicting duplicate ID ${id}; excluded from inventory.`);
  return [...unique.values()].map(item => item.value).filter(item => !conflicts.has(item.id));
}

function referenceInventory(nodes: readonly ReferenceRange[]): ReferenceInventory {
  const result: ReferenceInventory = {
    ...emptyReferenceCase(),
    byKind: Object.fromEntries(INVENTORY_REFERENCE_KINDS.map(kind => [kind, emptyReferenceCase()])) as ReferenceInventory['byKind'],
  };
  for (const node of nodes) {
    const counts = emptyReferenceCounts();
    counts.charts = 1;
    for (const hand of HANDS) {
      const row = node.hands[hand];
      if (row?.status === 'available') counts.availableHands++;
      else if (row?.status === 'not-charted') counts.notChartedHands++;
      else if (row?.status === 'unreadable') counts.unreadableHands++;
      else counts.missingHands++;
    }
    counts.unknownHands = counts.notChartedHands + counts.unreadableHands + counts.missingHands;
    const category = node.provenance === 'seat-projection' ? 'projected' : 'original';
    for (const key of Object.keys(counts) as Array<keyof ReferenceCounts>) {
      result[category][key] += counts[key];
      result.byKind[node.kind][category][key] += counts[key];
    }
  }
  return result;
}

/** Match the server's shard rule: computed, numbered parts, same game and full source snapshot. */
export function inventoryPackKey(entry: Pick<InventoryTreeEntry, 'id' | 'game' | 'source'>): string {
  return entry.source.kind === 'computed' && /-part-\d+$/.test(entry.id)
    ? JSON.stringify(['computed-parts', entry.id.replace(/-part-\d+$/, ''), gameKey(entry.game), entry.source])
    : JSON.stringify(['single', entry.id]);
}

function groupPacks(entries: readonly InventoryTreeEntry[], warnings: string[]): InventoryModelPack[] {
  const packs = new Map<string, InventoryModelPack>();
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.nodeCount) || entry.nodeCount < 0) {
      warnings.push(`Tree library: invalid node count for ${entry.id}; excluded from inventory.`);
      continue;
    }
    const key = inventoryPackKey(entry);
    const pack = packs.get(key);
    if (pack) {
      pack.shardIds.push(entry.id);
      pack.decisionNodes += entry.nodeCount;
    } else {
      packs.set(key, { key, id: entry.id, name: entry.name, players: entry.game.players, game: entry.game,
        source: entry.source, shardIds: [entry.id], decisionNodes: entry.nodeCount,
        quality: entry.source.kind === 'computed' ? entry.source.computation?.status ?? 'unknown' : entry.source.kind });
    }
  }
  return [...packs.values()];
}

function localInventory(packs: readonly InventoryModelPack[], datasets: readonly Dataset[], players?: number): LocalInventory {
  const result: LocalInventory = { ...emptyLocalCounts(),
    bySource: { computed: emptyLocalCounts(), imported: emptyLocalCounts(), demo: emptyLocalCounts() },
    qualityCounts: { approximate: 0, unconverged: 0, imported: 0, demo: 0, unknown: 0 } };
  for (const pack of packs) {
    if (players !== undefined && pack.players !== players) continue;
    result.modelPacks++;
    result.decisionNodes += pack.decisionNodes;
    result.bySource[pack.source.kind].modelPacks++;
    result.bySource[pack.source.kind].decisionNodes += pack.decisionNodes;
    result.qualityCounts[pack.quality]++;
  }
  for (const dataset of datasets) {
    const count = dataset.nodes.filter(node => players === undefined || node.spot.players === players).length;
    result.quickNodes += count;
    result.bySource[dataset.source.kind].quickNodes += count;
  }
  return result;
}

/** Inventory already-validated inputs. This is availability, never whole-game coverage or accuracy. */
export function buildDataInventory(input: InventoryInput): DataInventory {
  const warnings: string[] = [];
  const knownReferences = distinctRecords([...(input.publishedCharts ?? []).map(displayPublishedChart), ...(input.referenceRanges ?? [])], 'Reference charts', warnings);
  const references = input.publishedCharts !== null && input.referenceRanges !== null
    ? knownReferences : null;
  const datasets = input.datasets === null ? null : distinctRecords(input.datasets, 'Quick datasets', warnings);
  const trees = input.treeLibrary === null ? null : distinctRecords(input.treeLibrary, 'Tree library', warnings);
  const packs = trees === null ? null : groupPacks(trees, warnings);
  const local = (players?: number) => packs !== null && datasets !== null ? localInventory(packs, datasets, players) : null;
  return {
    byPlayers: INVENTORY_PLAYERS.map(players => ({ players,
      references: references === null ? null : referenceInventory(references.filter(node => node.players === players)),
      local: local(players),
    })),
    totals: { references: references === null ? null : referenceInventory(references), local: local() },
    packs, warnings,
    standard: buildStandardCoverage({ references: input.publishedCharts === null && input.referenceRanges === null ? null : knownReferences,
      treeLibrary: trees, incomplete: input.localIncomplete || input.publishedCharts === null || input.referenceRanges === null || warnings.length > 0 }),
  };
}
