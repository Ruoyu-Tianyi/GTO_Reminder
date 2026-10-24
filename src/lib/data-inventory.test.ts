import { describe, expect, it } from 'vitest';
import { HANDS, type Dataset } from './poker';
import type { PublishedChartNode } from './published-charts';
import type { ReferenceRange } from './reference-ranges';
import { buildDataInventory, type InventoryInput, type InventoryTreeEntry } from './data-inventory';

const empty: InventoryInput = { publishedCharts: [], referenceRanges: [], datasets: [], treeLibrary: [] };
const source: InventoryTreeEntry['source'] = {
  kind: 'computed', name: 'Synthetic model', url: 'https://example.com/model', license: 'Synthetic test only',
  retrievedAt: '2026-10-13', precision: 'Synthetic',
  computation: { engine: 'Test', model: 'Test', iterations: 20, status: 'approximate', scope: 'Synthetic', modelGapBb: 0.01 },
};
function tree(id = 'computed-fixture-part-001', players = 7): InventoryTreeEntry {
  return { id, name: 'Test pack', game: { players, stackBb: 100, anteBb: 0, format: 'cash', rake: 'test' }, source, nodeCount: 100 };
}
function quick(id = 'computed-fixture-quick', players = 7): Dataset {
  return { schemaVersion: 1, id, name: id, source, nodes: [{ id: 'rfi',
    spot: { players, stackBb: 100, anteBb: 0, format: 'cash', rake: 'test', kind: 'rfi', hero: 'UTG', villain: null, openSizeBb: 2.5, threeBetSizeBb: 10, fourBetSizeBb: 30 },
    frequencies: Object.fromEntries(HANDS.map(hand => [hand, { raise: 0, call: 0, fold: 1 }])),
  }] };
}
function reference(id = 'chart', players = 8): ReferenceRange {
  return { id, players, refId: 'synthetic', stackBb: 100, kind: 'vs-3bet', hero: 'UTG', villain: 'BB', page: 1,
    provenance: 'image-transcription', sourcePlayers: 8, precision: 'Synthetic', notes: [],
    actions: [{ id: 'fold', label: 'Fold', type: 'fold' }],
    hands: Object.fromEntries(HANDS.map(hand => [hand, { status: 'available', frequencies: { fold: 1 } }])),
    source: { name: 'Synthetic', title: 'Synthetic', url: 'https://example.com/chart', sha256: 'a'.repeat(64) },
  };
}
function published(): PublishedChartNode {
  return { id: 'published', refId: 'synthetic', players: 6, stackBb: 100, format: 'cash', hero: 'UTG', sourcePosition: 'UTG', ante: null, rake: null, page: 1,
    source: reference().source, precision: { step: 0.5, kind: 'publisher-simplified' }, kind: 'rfi', villain: null, raiseToBb: 2.5,
    callMeaning: 'unused', printedRaisePercent: 0,
    frequencies: Object.fromEntries(HANDS.map(hand => [hand, { raise: 0, call: 0, fold: 1 }])), derivedRangeSummary: { raise: 0, call: 0, fold: 1 } };
}

describe('source-aware data inventory', () => {
  it('distinguishes unknown data from successfully loaded empty data', () => {
    const unknown = buildDataInventory({ publishedCharts: null, referenceRanges: null, datasets: null, treeLibrary: null });
    expect(unknown.totals).toEqual({ references: null, local: null });
    expect(unknown.byPlayers.map(row => row.players)).toEqual([6, 7, 8, 9]);
    expect(unknown.packs).toBeNull();
    const loaded = buildDataInventory(empty);
    expect(loaded.totals.references?.original.charts).toBe(0);
    expect(loaded.totals.local?.modelPacks).toBe(0);
    expect(loaded.totals.local?.quickNodes).toBe(0);
  });

  it('keeps reference or local totals unknown if only half its sources loaded', () => {
    const inventory = buildDataInventory({ ...empty, referenceRanges: null, datasets: null, treeLibrary: [tree()] });
    expect(inventory.totals.references).toBeNull();
    expect(inventory.totals.local).toBeNull();
    expect(inventory.packs).toHaveLength(1);
  });

  it('counts published originals and projected references separately by table and case', () => {
    const projected: ReferenceRange = { ...reference('projected', 7), provenance: 'seat-projection' };
    const inventory = buildDataInventory({ ...empty, publishedCharts: [published()], referenceRanges: [reference(), projected] });
    expect(inventory.totals.references?.original.charts).toBe(2);
    expect(inventory.totals.references?.projected.charts).toBe(1);
    expect(inventory.totals.references?.original.availableHands).toBe(338);
    expect(inventory.totals.references?.byKind.rfi.original.charts).toBe(1);
    expect(inventory.totals.references?.byKind['vs-3bet'].projected.charts).toBe(1);
    expect(inventory.byPlayers[1].references?.original.charts).toBe(0);
    expect(inventory.byPlayers[1].references?.projected.charts).toBe(1);
  });

  it('keeps unreadable, uncharted and absent hands unknown; a known 100% Fold is available', () => {
    const chart = reference();
    chart.hands.AA = { status: 'not-charted' };
    chart.hands.KK = { status: 'unreadable' };
    delete chart.hands.QQ;
    const counts = buildDataInventory({ ...empty, referenceRanges: [chart] }).totals.references?.original;
    expect(counts).toEqual({ charts: 1, availableHands: 166, unknownHands: 3, notChartedHands: 1, unreadableHands: 1, missingHands: 1 });
  });

  it('merges computed shards without adding overlapping Quick nodes to decisions', () => {
    const inventory = buildDataInventory({ ...empty, treeLibrary: [tree(), tree('computed-fixture-part-002')], datasets: [quick()] });
    expect(inventory.packs).toHaveLength(1);
    expect(inventory.packs?.[0].shardIds).toEqual(['computed-fixture-part-001', 'computed-fixture-part-002']);
    expect(inventory.totals.local?.modelPacks).toBe(1);
    expect(inventory.totals.local?.decisionNodes).toBe(200);
    expect(inventory.totals.local?.quickNodes).toBe(1);
    expect(inventory.totals.local?.qualityCounts.approximate).toBe(1);
    expect(inventory.byPlayers[1].local?.decisionNodes).toBe(200);
    expect(inventory.byPlayers[0].local?.decisionNodes).toBe(0);
  });

  it('does not merge foreign source snapshots or changed game conditions', () => {
    const next = tree('computed-fixture-part-002');
    next.source = { ...source, computation: { ...source.computation!, iterations: 21 } };
    const precision = tree('computed-fixture-part-003');
    precision.source = { ...source, precision: 'Another precision' };
    const rake = tree('computed-fixture-part-004');
    rake.game = { ...rake.game, rake: 'another profile' };
    const stack = tree('computed-fixture-part-005');
    stack.game = { ...stack.game, stacksBb: { BB: 99 } };
    expect(buildDataInventory({ ...empty, treeLibrary: [tree(), next, precision, rake, stack] }).packs).toHaveLength(5);
  });

  it('uses effective stacks when testing equivalent games and does not infer absent shards', () => {
    const equivalent = tree('computed-fixture-part-003');
    equivalent.game = { ...equivalent.game, stacksBb: { BB: 100 } };
    const inventory = buildDataInventory({ ...empty, treeLibrary: [tree(), equivalent] });
    expect(inventory.packs).toHaveLength(1);
    expect(inventory.totals.local?.decisionNodes).toBe(200);
  });

  it('does not merge unnumbered or imported datasets by a shared filename stem', () => {
    const importedA = tree('imported-part-001');
    importedA.source = { ...source, kind: 'imported', computation: undefined };
    const importedB = { ...importedA, id: 'imported-part-002' };
    const inventory = buildDataInventory({ ...empty, treeLibrary: [tree(), tree('computed-fixture'), importedA, importedB] });
    expect(inventory.packs).toHaveLength(4);
    expect(inventory.totals.local?.bySource.imported.modelPacks).toBe(2);
    expect(inventory.totals.local?.bySource.computed.modelPacks).toBe(2);
  });

  it('classifies declared quality and source kinds without treating imports as solver verified', () => {
    const unconverged = tree('unconverged-part-001');
    unconverged.source = { ...source, computation: { ...source.computation!, status: 'unconverged', modelGapBb: null } };
    const imported = tree('imported'); imported.source = { ...source, kind: 'imported', computation: undefined };
    const demo = tree('demo'); demo.source = { ...source, kind: 'demo', computation: undefined };
    const demoQuick = quick('demo-quick'); demoQuick.source = demo.source;
    const importedQuick = quick('imported-quick'); importedQuick.source = imported.source;
    const inventory = buildDataInventory({ ...empty, treeLibrary: [tree(), unconverged, imported, demo], datasets: [quick(), demoQuick, importedQuick] });
    expect(inventory.totals.local?.qualityCounts).toEqual({ approximate: 1, unconverged: 1, imported: 1, demo: 1, unknown: 0 });
    expect(inventory.totals.local?.bySource.computed).toEqual({ modelPacks: 2, decisionNodes: 200, quickNodes: 1 });
    expect(inventory.totals.local?.bySource.demo.quickNodes).toBe(1);
    expect(inventory.totals.local?.bySource.imported.quickNodes).toBe(1);
  });

  it('deduplicates repeated identical records but excludes conflicting duplicate IDs', () => {
    const conflictingChart = reference('bad'); conflictingChart.hands.AA = { status: 'unreadable' };
    const conflictingQuick = quick('bad-quick'); conflictingQuick.name = 'Changed snapshot';
    const inventory = buildDataInventory({ ...empty,
      referenceRanges: [reference(), reference(), reference('bad'), conflictingChart],
      treeLibrary: [tree(), tree(), tree('bad-part-001'), { ...tree('bad-part-001'), nodeCount: 99 }],
      datasets: [quick(), quick(), quick('bad-quick'), conflictingQuick],
    });
    expect(inventory.totals.references?.original.charts).toBe(1);
    expect(inventory.totals.local?.decisionNodes).toBe(100);
    expect(inventory.totals.local?.quickNodes).toBe(1);
    expect(inventory.warnings).toHaveLength(3);
  });

  it('never turns invalid summary counts into negative or NaN availability', () => {
    const inventory = buildDataInventory({ ...empty, treeLibrary: [tree(), { ...tree('bad'), nodeCount: NaN }] });
    expect(inventory.totals.local?.decisionNodes).toBe(100);
    expect(inventory.warnings).toHaveLength(1);
  });

  it('does not mutate inputs or share counters between table rows and totals', () => {
    const input = { ...empty, referenceRanges: [reference()], treeLibrary: [tree()] };
    const snapshot = JSON.stringify(input);
    const inventory = buildDataInventory(input);
    inventory.byPlayers[0].references!.original.charts++;
    inventory.byPlayers[0].local!.bySource.computed.modelPacks++;
    expect(inventory.totals.references?.original.charts).toBe(1);
    expect(inventory.byPlayers[1].references?.original.charts).toBe(0);
    expect(inventory.byPlayers[1].local?.bySource.computed.modelPacks).toBe(1);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('uses optional cached standard metadata and treats legacy summaries as unaudited', () => {
    const legacy = buildDataInventory({ ...empty, treeLibrary: [tree()] });
    expect(legacy.standard.unknownTreeEntries).toBe(1);
    expect(legacy.standard.totals.missing).toBeNull();
    const audited = tree();
    audited.standardSpots = [{ key: '7:rfi:UTG:-', players: 7, kind: 'rfi', hero: 'UTG', villain: null, history: [], availableHands: 100, unreachableHands: 60, missingHands: 9 }];
    const report = buildDataInventory({ ...empty, treeLibrary: [audited] }).standard;
    expect(report.totals).toMatchObject({ readable: 1, resolved: 0, computed: 1, missing: 433 });
    expect(report.byPlayers[1].counts.readable).toBe(1);
    expect(report.cases.find(spot => spot.key === '7:rfi:UTG:-')?.evidence[0].datasetId).toBe(audited.id);
  });

  it('keeps standard gaps unknown when a successful API excluded invalid files', () => {
    expect(buildDataInventory({ ...empty, localIncomplete: true }).standard.totals.missing).toBeNull();
    expect(buildDataInventory(empty).standard.totals.missing).toBe(434);
  });

  it('retains known source evidence as a lower bound when another reference API fails', () => {
    const report = buildDataInventory({ ...empty, publishedCharts: [published()], referenceRanges: null });
    expect(report.totals.references).toBeNull();
    expect(report.standard.totals).toMatchObject({ readable: 1, original: 1, missing: null });
    expect(report.standard.complete).toBe(false);
  });
});
