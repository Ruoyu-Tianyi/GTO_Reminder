import { findNode, getPositions, getVillains, type Dataset, type Spot, type SpotKind } from './poker';

export type CoverageConfig = Pick<Spot, 'format' | 'stackBb' | 'anteBb' | 'rake' | 'openSizeBb' | 'threeBetSizeBb' | 'fourBetSizeBb'>;
export type CoverageStatus = 'imported' | 'demo-only' | 'missing';

export const COVERAGE_PLAYERS = [5, 6, 7, 8, 9] as const;
export const COVERAGE_SCOPE = 'v1-single-opponent-lines' as const;
export const COVERAGE_SCOPE_DESCRIPTION = 'RFI and single-opponent vs Open, vs 3-Bet, and vs 4-Bet lines only. Excludes limps, cold calls, squeezes, multiway action histories, and other preflop branches.';
export const COVERAGE_SOURCE_CAVEAT = 'Imported means user-supplied data, not solver-verified data. Coverage does not independently verify accuracy, provenance, or license rights. Demo data never counts as imported coverage.';

export interface CoverageSource {
  datasetId: string;
  datasetName: string;
  nodeId: string;
  source: Dataset['source'];
}

export interface CoverageEntry {
  spot: Spot;
  status: CoverageStatus;
  importedSources: CoverageSource[];
  demoSources: CoverageSource[];
}

export interface CoverageCounts {
  expected: number;
  imported: number;
  demoOnly: number;
  /** No matching imported or demo node exists. */
  missing: number;
  /** Includes demo-only spots, which still need actual source data. */
  missingImported: number;
  /** A fraction in [0, 1], not a percentage or a source-quality score. */
  importedFraction: number;
}

export interface CoverageAudit extends CoverageCounts {
  config: CoverageConfig;
  scope: typeof COVERAGE_SCOPE;
  scopeDescription: string;
  sourceCaveat: string;
  byPlayers: Array<{ players: number } & CoverageCounts>;
  entries: CoverageEntry[];
  /** Acquisition checklist: both demo-only and entirely missing spots. */
  missingImportedSpots: Spot[];
}

function normalizedPlayers(players: readonly number[]): number[] {
  if (players.length === 0 || players.some((value) => !Number.isInteger(value) || value < 5 || value > 9)) {
    throw new Error('Coverage audit requires one or more table sizes from 5 to 9 players.');
  }
  return [...new Set(players)].sort((a, b) => a - b);
}

function validateConfig(config: CoverageConfig): void {
  if (config.format !== 'cash' && config.format !== 'mtt') throw new Error('Coverage format must be cash or mtt.');
  if (!Number.isFinite(config.anteBb) || config.anteBb < 0) throw new Error('Coverage anteBb must be a finite, nonnegative number.');
  if (typeof config.rake !== 'string' || config.rake.trim() === '') throw new Error('Coverage rake must be a nonempty exact profile identifier.');
  if (![config.stackBb, config.openSizeBb, config.threeBetSizeBb, config.fourBetSizeBb].every(Number.isFinite)) {
    throw new Error('Coverage stack and sizing fields must be finite numbers.');
  }
  // This audit enumerates a full four-bet ladder. Terminal earlier shoves are
  // importable in schema v1 but require a different, reduced coverage scope.
  if (config.openSizeBb < 2 || config.threeBetSizeBb <= config.openSizeBb || config.fourBetSizeBb <= config.threeBetSizeBb || config.fourBetSizeBb > config.stackBb) {
    throw new Error('This coverage scope requires 2 <= open < 3-bet < 4-bet <= stack. Earlier all-ins and unused future sizes need a separate, reduced coverage scope.');
  }
  if (config.threeBetSizeBb < 2 * config.openSizeBb - 1) {
    throw new Error('Coverage 3-bet size is below the minimum full raise.');
  }
  if (config.fourBetSizeBb < 2 * config.threeBetSizeBb - config.openSizeBb && config.fourBetSizeBb !== config.stackBb) {
    throw new Error('Coverage 4-bet size is below the minimum full raise and is not all-in.');
  }
}

/**
 * Enumerate every legal v1 position line for one exact game/sizing config.
 * With all 5–9-player tables this is 360 spots, not the entire preflop tree.
 */
export function enumerateCoverageSpots(config: CoverageConfig, players: readonly number[] = COVERAGE_PLAYERS): Spot[] {
  validateConfig(config);
  const spots: Spot[] = [];
  for (const tableSize of normalizedPlayers(players)) {
    const positions = getPositions(tableSize);
    for (const hero of positions) {
      if (hero !== 'BB') spots.push({ ...config, players: tableSize, hero, villain: null, kind: 'rfi' });
    }
    for (const kind of ['vs-open', 'vs-3bet', 'vs-4bet'] as const satisfies readonly SpotKind[]) {
      for (const hero of positions) {
        for (const villain of getVillains(tableSize, hero, kind)) {
          spots.push({ ...config, players: tableSize, hero, villain, kind });
        }
      }
    }
  }
  return spots;
}

function countsFor(entries: CoverageEntry[]): CoverageCounts {
  const imported = entries.filter((entry) => entry.status === 'imported').length;
  const demoOnly = entries.filter((entry) => entry.status === 'demo-only').length;
  const expected = entries.length;
  return {
    expected,
    imported,
    demoOnly,
    missing: expected - imported - demoOnly,
    missingImported: expected - imported,
    importedFraction: expected === 0 ? 0 : imported / expected,
  };
}

/**
 * Audit already-validated datasets. Counts unique spots, never source-file count.
 * Exact matching includes every Spot field and never interpolates or substitutes.
 */
export function auditCoverage(datasets: readonly Dataset[], config: CoverageConfig, players: readonly number[] = COVERAGE_PLAYERS): CoverageAudit {
  const spots = enumerateCoverageSpots(config, players);
  const entries = spots.map((spot): CoverageEntry => {
    const importedSources: CoverageSource[] = [];
    const demoSources: CoverageSource[] = [];
    for (const dataset of datasets) {
      const node = findNode(dataset, spot);
      if (!node) continue;
      const reference: CoverageSource = {
        datasetId: dataset.id,
        datasetName: dataset.name,
        nodeId: node.id,
        source: { ...dataset.source },
      };
      if (dataset.source.kind === 'imported') importedSources.push(reference);
      else if (dataset.source.kind === 'demo') demoSources.push(reference);
    }
    return { spot, status: importedSources.length > 0 ? 'imported' : demoSources.length > 0 ? 'demo-only' : 'missing', importedSources, demoSources };
  });
  return {
    config: { ...config },
    scope: COVERAGE_SCOPE,
    scopeDescription: COVERAGE_SCOPE_DESCRIPTION,
    sourceCaveat: COVERAGE_SOURCE_CAVEAT,
    ...countsFor(entries),
    byPlayers: normalizedPlayers(players).map((tableSize) => ({ players: tableSize, ...countsFor(entries.filter((entry) => entry.spot.players === tableSize)) })),
    entries,
    missingImportedSpots: entries.filter((entry) => entry.status !== 'imported').map((entry) => ({ ...entry.spot })),
  };
}
