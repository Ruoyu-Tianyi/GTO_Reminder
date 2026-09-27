import { describe, expect, it } from 'vitest';
import { DEMO_DATASET } from '../data/demo';
import { HANDS, getPositions, validateDataset, type Dataset, type Spot } from './poker';
import { auditCoverage, enumerateCoverageSpots, type CoverageConfig, type CoverageCounts } from './coverage';

const CONFIG: CoverageConfig = {
  format: 'cash', stackBb: 100, anteBb: 0, rake: '5% · 3 BB cap',
  openSizeBb: 2.5, threeBetSizeBb: 10, fourBetSizeBb: 22,
};

const counts = ({ expected, imported, demoOnly, missing, missingImported, importedFraction }: CoverageCounts): CoverageCounts =>
  ({ expected, imported, demoOnly, missing, missingImported, importedFraction });

/** Synthetic fixtures exercise coverage classification, never poker accuracy. */
function fixture(spots: Spot[], kind: Dataset['source']['kind'] = 'imported', id = 'test-import'): Dataset {
  return validateDataset({
    schemaVersion: 1,
    id,
    name: 'Synthetic coverage test fixture',
    source: {
      kind, name: 'Test fixture', url: 'https://example.com/test-fixture',
      license: 'Synthetic test data', retrievedAt: '2026-09-27',
    },
    nodes: spots.map((spot, index) => ({
      id: `${id}-${index}`, spot,
      frequencies: Object.fromEntries(HANDS.map((hand) => [hand, { raise: 0, call: 0, fold: 1 }])),
    })),
  });
}

describe('limited v1 preflop coverage enumeration', () => {
  it('enumerates 34, 50, 69, 91 and 116 unique spots, totaling 360', () => {
    const spots = enumerateCoverageSpots(CONFIG);
    expect(spots).toHaveLength(360);
    expect(new Set(spots.map((spot) => JSON.stringify(spot))).size).toBe(360);
    expect([5, 6, 7, 8, 9].map((players) => spots.filter((spot) => spot.players === players).length)).toEqual([34, 50, 69, 91, 116]);
  });

  it('covers every legal opponent pairing without BB RFI or self-opponents', () => {
    for (const players of [5, 6, 7, 8, 9]) {
      const positions = getPositions(players);
      const spots = enumerateCoverageSpots(CONFIG, [players]);
      expect(spots.filter((spot) => spot.kind === 'rfi')).toHaveLength(players - 1);
      for (const kind of ['vs-open', 'vs-3bet', 'vs-4bet']) {
        expect(spots.filter((spot) => spot.kind === kind)).toHaveLength(players * (players - 1) / 2);
      }
      for (const spot of spots) {
        if (spot.kind === 'rfi') {
          expect(spot.hero).not.toBe('BB');
          expect(spot.villain).toBeNull();
        } else {
          const heroIndex = positions.indexOf(spot.hero);
          const villainIndex = positions.indexOf(spot.villain!);
          expect(villainIndex).toBeGreaterThanOrEqual(0);
          if (spot.kind === 'vs-3bet') expect(villainIndex).toBeGreaterThan(heroIndex);
          else expect(villainIndex).toBeLessThan(heroIndex);
        }
      }
    }
  });

  it('normalizes table-size subsets without duplicate counts', () => {
    expect(enumerateCoverageSpots(CONFIG, [9, 5, 5])).toHaveLength(150);
    expect(auditCoverage([], CONFIG, [9, 5, 5]).byPlayers.map((row) => row.players)).toEqual([5, 9]);
    expect(() => enumerateCoverageSpots(CONFIG, [])).toThrow(/5 to 9/);
    expect(() => enumerateCoverageSpots(CONFIG, [4])).toThrow(/5 to 9/);
    expect(() => enumerateCoverageSpots(CONFIG, [5.5])).toThrow(/5 to 9/);
  });

  it('requires a legal complete action ladder for the fixed coverage denominator', () => {
    expect(() => enumerateCoverageSpots({ ...CONFIG, stackBb: 20 })).toThrow(/separate, reduced coverage scope/);
    expect(() => enumerateCoverageSpots({ ...CONFIG, threeBetSizeBb: 3 })).toThrow(/minimum full raise/);
    expect(() => enumerateCoverageSpots({ ...CONFIG, fourBetSizeBb: 12 })).toThrow(/minimum full raise/);
    expect(enumerateCoverageSpots({ ...CONFIG, stackBb: 12, fourBetSizeBb: 12 })).toHaveLength(360);
    expect(() => enumerateCoverageSpots({ ...CONFIG, anteBb: NaN })).toThrow(/anteBb/);
    expect(() => enumerateCoverageSpots({ ...CONFIG, stackBb: Infinity })).toThrow(/finite numbers/);
    expect(() => enumerateCoverageSpots({ ...CONFIG, rake: '' })).toThrow(/rake/);
  });
});

describe('source-aware coverage auditing', () => {
  it('reports the full acquisition checklist when no datasets exist', () => {
    const audit = auditCoverage([], CONFIG);
    expect(counts(audit)).toEqual({ expected: 360, imported: 0, demoOnly: 0, missing: 360, missingImported: 360, importedFraction: 0 });
    expect(audit.missingImportedSpots).toHaveLength(360);
    expect(audit.scope).toBe('v1-single-opponent-lines');
    expect(audit.scopeDescription).toContain('Excludes limps');
    expect(audit.sourceCaveat).toContain('not solver-verified');
  });

  it('never counts the four built-in demo nodes as imported coverage', () => {
    const audit = auditCoverage([DEMO_DATASET], CONFIG);
    expect(counts(audit)).toEqual({ expected: 360, imported: 0, demoOnly: 4, missing: 356, missingImported: 360, importedFraction: 0 });
    expect(audit.byPlayers.find((row) => row.players === 6)?.demoOnly).toBe(4);
    expect(audit.missingImportedSpots).toHaveLength(360);
    const entry = audit.entries.find((row) => row.status === 'demo-only');
    expect(entry?.importedSources).toEqual([]);
    expect(entry?.demoSources[0].source.kind).toBe('demo');
  });

  it('counts unique imported spots across overlapping sources and preserves both references', () => {
    const spot = DEMO_DATASET.nodes[0].spot;
    const first = fixture([spot], 'imported', 'one');
    const second = fixture([spot], 'imported', 'two');
    const audit = auditCoverage([DEMO_DATASET, first, second], CONFIG);
    expect(audit.imported).toBe(1);
    expect(audit.demoOnly).toBe(3);
    expect(audit.missingImported).toBe(359);
    expect(audit.importedFraction).toBeCloseTo(1 / 360);
    expect(audit.missingImportedSpots).toHaveLength(359);
    const entry = audit.entries.find((row) => row.status === 'imported');
    expect(entry?.importedSources.map((source) => source.datasetId)).toEqual(['one', 'two']);
    expect(entry?.demoSources).toHaveLength(1);
    expect(entry?.importedSources[0].source.license).toBe('Synthetic test data');
  });

  it('does not substitute any other game, stack, ante, rake or sizing configuration', () => {
    const data = fixture([DEMO_DATASET.nodes[0].spot]);
    const changes: Partial<CoverageConfig>[] = [
      { format: 'mtt' }, { stackBb: 99 }, { anteBb: 0.1 }, { rake: 'none' },
      { openSizeBb: 2 }, { threeBetSizeBb: 9 }, { fourBetSizeBb: 23 },
    ];
    for (const patch of changes) {
      expect(auditCoverage([data], { ...CONFIG, ...patch }).imported).toBe(0);
    }
  });

  it('reports full imported coverage only within the declared narrow scope', () => {
    const data = fixture(enumerateCoverageSpots(CONFIG));
    const audit = auditCoverage([data], CONFIG);
    expect(counts(audit)).toEqual({ expected: 360, imported: 360, demoOnly: 0, missing: 0, missingImported: 0, importedFraction: 1 });
    expect(audit.missingImportedSpots).toEqual([]);
    expect(audit.byPlayers.map((row) => row.imported)).toEqual([34, 50, 69, 91, 116]);
    expect(audit.sourceCaveat).toContain('does not independently verify accuracy');
    expect(audit.scopeDescription).toContain('multiway action histories');
  });
});
