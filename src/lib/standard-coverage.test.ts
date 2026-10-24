import { describe, expect, it } from 'vitest';
import { HANDS, getPositions } from './poker';
import { replayPreflop, type PreflopAction } from './preflop';
import type { ReferenceRange } from './reference-ranges';
import { createTreeTemplate, type TreeGame } from './tree-strategy';
import { buildStandardCoverage, classifyStandardHistory, standardCases, standardHistory, summarizeStandardSpots, type StandardTreeEntry } from './standard-coverage';

const game: TreeGame = { players: 6, stackBb: 100, anteBb: 0, format: 'cash', rake: 'fixture zero rake' };
function entry(id = 'model'): StandardTreeEntry {
  const dataset = createTreeTemplate(game, []);
  dataset.id = id;
  dataset.source = { ...dataset.source, kind: 'computed', computation: { engine: 'test', model: 'test', iterations: 2, status: 'unconverged', scope: 'synthetic' } };
  dataset.nodes[0].hands = Object.fromEntries(HANDS.map(hand => [hand, { status: 'available', reach: 1, frequencies: { fold: 1 } }]));
  return { ...dataset, standardSpots: summarizeStandardSpots(dataset) };
}
function chart(): ReferenceRange {
  return { id: 'chart', refId: 'fixture', players: 6, stackBb: 100, kind: 'rfi', hero: 'UTG', villain: null, page: 1,
    source: { name: 'fixture', title: 'fixture', url: 'https://example.com/', sha256: 'a'.repeat(64) }, provenance: 'publisher-simplified', sourcePlayers: 6,
    actions: [{ id: 'fold', type: 'fold', label: 'Fold' }], notes: ['Unknown source ante and rake.'], precision: 'test',
    hands: Object.fromEntries(HANDS.map(hand => [hand, { status: 'available', frequencies: { fold: 1 } }])) };
}

describe('standard single-opponent catalogue and classification', () => {
  it('enumerates exactly 434 categories and roundtrips every complete legal action history', () => {
    expect([6, 7, 8, 9].map(players => standardCases(players).length)).toEqual([67, 92, 121, 154]);
    expect(standardCases()).toHaveLength(434);
    expect(new Set(standardCases().map(spot => spot.key)).size).toBe(434);
    for (const spot of standardCases()) {
      const history = standardHistory(spot, [2.5, 10, 25, 100]);
      expect(replayPreflop({ ...game, players: spot.players }, history).nextActor).toBe(spot.hero);
      expect(classifyStandardHistory({ ...game, players: spot.players }, history)).toEqual(spot);
    }
  });

  it('does not count cold calls, squeezes, limps outside the blinds, or truncated rotations', () => {
    const histories: PreflopAction[][] = [
      [{ actor: 'UTG', type: 'raise', amountBb: 2.5 }, { actor: 'HJ', type: 'call' }],
      [{ actor: 'UTG', type: 'raise', amountBb: 2.5 }, { actor: 'HJ', type: 'call' }, { actor: 'CO', type: 'raise', amountBb: 12 }],
      [{ actor: 'UTG', type: 'call' }],
      [{ actor: 'UTG', type: 'raise', amountBb: 2.5 }, { actor: 'HJ', type: 'raise', amountBb: 10 }],
      [...getPositions(6).slice(0, -2).map(actor => ({ actor, type: 'fold' as const })), { actor: 'SB', type: 'call' }, { actor: 'BB', type: 'check' }],
    ];
    for (const history of histories) expect(classifyStandardHistory(game, history)).toBeNull();
  });

  it('rejects illegal raise sizes, wrong actors, terminal histories and three-raiser lines', () => {
    const spot = standardCases(6).find(spot => spot.kind === 'vs-4bet' && spot.hero === 'BB')!;
    expect(classifyStandardHistory(game, standardHistory(spot, [2.5, 3, 4]))).toBeNull();
    expect(classifyStandardHistory(game, [{ actor: 'BB', type: 'fold' }])).toBeNull();
    expect(classifyStandardHistory(game, getPositions(6).slice(0, -1).map(actor => ({ actor, type: 'fold' })))).toBeNull();
    const threeRaisers = standardHistory(spot, [2.5, 10, 25]);
    threeRaisers[1] = { actor: 'HJ', type: 'raise', amountBb: 5 };
    expect(classifyStandardHistory(game, threeRaisers)).toBeNull();
  });

  it('summarizes only status counts and histories, retaining unavailable versus unreachable', () => {
    const dataset = createTreeTemplate(game, []);
    dataset.nodes[0].hands.AA = { status: 'available', reach: 1, frequencies: { fold: 1 } };
    dataset.nodes[0].hands.KK = { status: 'unreachable', reach: 0 };
    const summary = summarizeStandardSpots(dataset);
    expect(summary[0]).toMatchObject({ kind: 'rfi', availableHands: 1, unreachableHands: 1, missingHands: 167 });
    expect(JSON.stringify(summary)).not.toMatch(/frequencies|"reach"|"AA"/);
    expect(summary[0].history).not.toBe(dataset.nodes[0].history);
  });
});

describe('source and condition aware category audit', () => {
  it('keeps absent data and old API summaries unknown rather than reporting false gaps', () => {
    expect(buildStandardCoverage({ references: null, treeLibrary: [] }).totals.missing).toBeNull();
    const old = entry(); delete old.standardSpots;
    const report = buildStandardCoverage({ references: [], treeLibrary: [old] });
    expect(report.unknownTreeEntries).toBe(1); expect(report.complete).toBe(false); expect(report.totals.missing).toBeNull();
    expect(buildStandardCoverage({ references: [], treeLibrary: [] }).totals.missing).toBe(434);
    expect(buildStandardCoverage({ references: [], treeLibrary: [], incomplete: true }).totals.missing).toBeNull();
  });

  it('counts overlapping sources once as readable but separately by provenance and quality', () => {
    const approximate = entry('approximate'); approximate.source = { ...approximate.source, computation: { ...approximate.source.computation!, status: 'approximate' } };
    const projection = { ...chart(), id: 'projection', provenance: 'seat-projection' as const, sourcePlayers: 8 };
    const report = buildStandardCoverage({ references: [chart(), projection], treeLibrary: [entry(), approximate] });
    expect(report.totals).toMatchObject({ total: 434, readable: 1, resolved: 1, missing: 433, original: 1, projected: 1, computed: 1, unconverged: 1 });
    expect(report.cases[0].evidence).toHaveLength(4);
  });

  it('preserves source, sizing and rake snapshots without combining partial hand grids', () => {
    const first = entry('first'); first.standardSpots![0].availableHands = 168; first.standardSpots![0].missingHands = 1;
    const second = entry('second'); second.game = { ...second.game, rake: 'different rake' };
    second.source = { ...second.source, retrievedAt: '2026-10-14' };
    second.standardSpots![0].availableHands = 168; second.standardSpots![0].missingHands = 1;
    const report = buildStandardCoverage({ references: [], treeLibrary: [first, second] });
    expect(report.totals.readable).toBe(1); expect(report.totals.resolved).toBe(0);
    expect(new Set(report.cases[0].evidence.map(item => item.conditionKey)).size).toBe(2);
    expect(report.cases[0].evidence.map(item => item.game?.rake)).toEqual(['fixture zero rake', 'different rake']);
    expect(report.cases[0].evidence[1].source).toEqual(second.source);
  });

  it('excludes non-100 effective stacks and antes while allowing canonical explicit 100 BB overrides', () => {
    const short = entry('short'); short.game = { ...short.game, stacksBb: { BB: 99 } };
    const ante = entry('ante'); ante.game = { ...ante.game, anteBb: 0.1 };
    const equivalent = entry('equivalent'); equivalent.game = { ...equivalent.game, stacksBb: { BB: 100 } };
    const report = buildStandardCoverage({ references: [], treeLibrary: [short, ante, equivalent] });
    expect(report.excludedConditionEntries).toBe(2); expect(report.cases[0].evidence).toHaveLength(1);
    expect(report.cases[0].evidence[0].datasetId).toBe('equivalent');
  });

  it('does not call all-missing, all-unreachable or demo-only data readable coverage', () => {
    const missing = entry('missing'); Object.assign(missing.standardSpots![0], { availableHands: 0, missingHands: 169 });
    const unreachable = entry('unreachable'); Object.assign(unreachable.standardSpots![0], { availableHands: 0, unreachableHands: 169, missingHands: 0 });
    const demo = entry('demo'); demo.source = { ...demo.source, kind: 'demo', computation: undefined };
    const report = buildStandardCoverage({ references: [], treeLibrary: [missing, unreachable, demo] });
    expect(report.totals).toMatchObject({ readable: 0, resolved: 0, demo: 1, missing: 434 });
  });

  it('does not turn unknown reference hands into Fold or complete rows, or duplicate a chart on repeated input', () => {
    const reference = chart(); reference.hands.AA = { status: 'not-charted' }; reference.hands.KK = { status: 'unreadable' };
    const report = buildStandardCoverage({ references: [reference, reference], treeLibrary: [] });
    expect(report.totals).toMatchObject({ readable: 1, resolved: 0 });
    expect(report.cases[0].evidence).toHaveLength(1);
    expect(report.cases[0].evidence[0]).toMatchObject({ availableHands: 167, missingHands: 2 });
    expect(report.cases[0].evidence[0].conditionKey).toContain('reference-conditions-not-established');
  });
});
