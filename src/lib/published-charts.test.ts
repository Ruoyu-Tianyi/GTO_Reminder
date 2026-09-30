import { describe, expect, it } from 'vitest';
import { CHART_REFERENCES } from '../data/references';
import { HANDS, getPositions, type Frequencies, type Position } from './poker';
import { REVIEWED_RESPONSE_CHARTS, validatePublishedCharts, type ReviewedResponseChart } from './published-charts';

// Synthetic contract fixtures only. These frequencies are NOT poker advice,
// transcribed publisher ranges, or a claimed solver output.
function fixture(players: 6 | 9 = 6, hero: Position = 'UTG') {
  const ref = CHART_REFERENCES.find(ref => ref.players === players)!;
  const source = { name: ref.provider, title: players === 6 ? '6-max 100bb 100z' : '9-max 100bb live cash', url: ref.url, sha256: ref.sha256 };
  const frequencies: Record<string, Frequencies> = Object.fromEntries(HANDS.map(hand => [hand, { raise: 0, call: 0, fold: 1 }]));
  frequencies.AA = { raise: 1, call: 0, fold: 0 };
  frequencies.AKs = { raise: 0.5, call: 0, fold: 0.5 };
  frequencies.AKo = { raise: 0.5, call: 0, fold: 0.5 };
  return {
    schemaVersion: 1, kind: 'derived-published-chart', preparedAt: '2026-09-29', frequencyUnit: 'fraction',
    precision: { step: 0.5, label: 'Publisher simplified to 50% steps; not original solver frequencies' },
    sources: [{ id: players === 6 ? 'rangeconverter-6max-100bb-100z' : ref.id, ...source, localFile: ref.filename, page: 3 }],
    nodes: [{ id: 'synthetic-contract-fixture', refId: ref.id, players, stackBb: 100, format: 'cash', hero,
      sourcePosition: players === 6 && hero === 'HJ' || players === 9 && hero === 'UTG+2' ? 'MP' : hero,
      kind: 'rfi', raiseToBb: players === 6 && hero !== 'SB' ? 2.5 : 3, ante: null, rake: null, page: 3,
      source: { ...source }, precision: { step: 0.5, kind: 'publisher-simplified' }, frequencies,
      callMeaning: players === 6 && hero === 'SB' ? 'SB completion / limp' : 'unused',
      printedRaisePercent: 7.7, derivedRangeSummary: { raise: 1, call: 0, fold: 0 },
    }],
  };
}

function responseFixture(chart: ReviewedResponseChart = REVIEWED_RESPONSE_CHARTS[0]) {
  const input = fixture(chart.players, chart.hero);
  const source = input.sources[0];
  const sourceVillain = chart.players === 6 && chart.villain === 'HJ' || chart.players === 9 && chart.villain === 'UTG+2' ? 'MP'
    : chart.players === 9 && chart.villain === 'UTG+1' ? 'UTG1' : chart.villain;
  return {
    ...input,
    sources: [{ id: source.id, name: source.name, title: source.title, url: source.url, sha256: source.sha256, localFile: source.localFile,
      pages: chart.players === 6 ? [4, 5, 6, 7, 8] : [4, 5, 6, 7, 8, 9, 10] }],
    nodes: [{ ...input.nodes[0], id: `synthetic-${chart.players}-${chart.hero.toLowerCase().replaceAll('+', '-')}-${chart.villain.toLowerCase().replaceAll('+', '-')}`,
      sourcePosition: chart.players === 9 && chart.hero === 'UTG+1' ? 'UTG1' : input.nodes[0].sourcePosition,
      kind: 'vs-open', villain: chart.villain, sourceVillain, facingRaiseToBb: chart.facingRaiseToBb,
      raiseToBb: chart.raiseToBb, page: chart.page, callMeaning: 'Call Open',
      printedRaisePercent: chart.raiseToBb === null ? null : 7.7, printedCallPercent: chart.raiseToBb === null || !chart.hasCallAction ? null : 12.3,
    }],
  };
}

describe('validatePublishedCharts', () => {
  it('preserves disclosure and unknown conditions while rebuilding combo-weighted aggregates', () => {
    const input = fixture();
    const node = validatePublishedCharts(input).nodes[0];
    expect(node.derivedRangeSummary.raise).toBeCloseTo((6 + 4 * 0.5 + 12 * 0.5) / 1326, 14);
    expect(node.derivedRangeSummary.fold).toBeCloseTo(1 - 14 / 1326, 14);
    expect(node.derivedRangeSummary.call).toBe(0);
    expect(node.printedRaisePercent).toBe(7.7);
    expect(node.ante).toBeNull();
    expect(node.rake).toBeNull();
    expect(node.precision).toEqual({ step: 0.5, kind: 'publisher-simplified' });
    expect(Object.keys(node.frequencies)).toHaveLength(169);
    expect(node.frequencies).not.toBe(input.nodes[0].frequencies);
    expect(input.nodes[0].derivedRangeSummary.raise).toBe(1);
  });

  it.each([[6, 'HJ'], [9, 'UTG+2']] as const)('keeps the reviewed MP alias for %i-max %s', (players, hero) => {
    const node = validatePublishedCharts(fixture(players, hero)).nodes[0];
    expect(node.hero).toBe(hero);
    expect(node.sourcePosition).toBe('MP');
  });

  it('only interprets 6-max SB Call as a completion in an unopened pot', () => {
    const input = fixture(6, 'SB');
    input.nodes[0].frequencies['72o'] = { raise: 0, call: 0.5, fold: 0.5 };
    const node = validatePublishedCharts(input).nodes[0];
    expect(node.callMeaning).toBe('SB completion / limp');
    expect(node.raiseToBb).toBe(3);
    expect(node.derivedRangeSummary.call).toBeCloseTo(6 / 1326, 14);
  });

  it.each([[6, 'UTG'], [9, 'SB']] as const)('rejects invented calls at %i-max %s', (players, hero) => {
    const input = fixture(players, hero);
    input.nodes[0].frequencies.AA = { raise: 0.5, call: 0.5, fold: 0 };
    expect(() => validatePublishedCharts(input)).toThrow(/Limp/);
  });

  it('rejects a missing hand even if replaced by a noncanonical hand to keep 169 rows', () => {
    const input = fixture();
    delete input.nodes[0].frequencies.AA;
    input.nodes[0].frequencies.AsAh = { raise: 1, call: 0, fold: 0 };
    expect(() => validatePublishedCharts(input)).toThrow(/169/);
  });

  it('rejects incomplete grids instead of converting absent hands to Fold', () => {
    const input = fixture();
    delete input.nodes[0].frequencies.AA;
    expect(() => validatePublishedCharts(input)).toThrow(/169/);
  });

  it.each([0.25, -0.5, 2, Number.NaN, Number.POSITIVE_INFINITY, '0.5', null, undefined])('rejects frequency %s outside the reviewed steps', value => {
    const input = fixture();
    Object.assign(input.nodes[0].frequencies.AA, { raise: value });
    expect(() => validatePublishedCharts(input)).toThrow(/0\/50\/100/);
  });

  it('rejects valid individual steps whose total is not one', () => {
    const input = fixture();
    input.nodes[0].frequencies.AA = { raise: 0.5, call: 0, fold: 0 };
    expect(() => validatePublishedCharts(input)).toThrow(/sum to one/);
  });

  it('rejects additional actions instead of silently dropping them', () => {
    const input = fixture();
    Object.assign(input.nodes[0].frequencies.AA, { shove: 0.5 });
    expect(() => validatePublishedCharts(input)).toThrow(/exactly/);
  });

  it.each([
    ['URL', { url: 'https://example.invalid/changed.pdf' }],
    ['PDF hash', { sha256: '0'.repeat(64) }],
    ['provider', { name: 'Unreviewed provider' }],
    ['title', { title: 'Exact solver output' }],
  ])('rejects a mismatched node source %s', (_label, patch) => {
    const input = fixture();
    Object.assign(input.nodes[0].source, patch);
    expect(() => validatePublishedCharts(input)).toThrow(/Source identity/);
  });

  it.each([
    ['id', { id: 'unreviewed-source' }],
    ['file', { localFile: '../different.pdf' }],
    ['page', { page: 4 }],
    ['hash', { sha256: 'f'.repeat(64) }],
  ])('rejects mismatched root source %s', (_label, patch) => {
    const input = fixture();
    Object.assign(input.sources[0], patch);
    expect(() => validatePublishedCharts(input)).toThrow();
  });

  it('rejects duplicated source declarations', () => {
    const input = fixture();
    input.sources.push({ ...input.sources[0] });
    expect(() => validatePublishedCharts(input)).toThrow(/duplicate/);
  });

  it('rejects an undeclared reference even when its PDF is individually known', () => {
    const input = fixture();
    input.nodes = fixture(9).nodes;
    expect(() => validatePublishedCharts(input)).toThrow(/undeclared/);
  });

  it.each([
    ['ref', { refId: 'pokercoaching-8max-100bb' }],
    ['player substitution', { players: 7 }],
    ['BB RFI', { hero: 'BB', sourcePosition: 'BB' }],
    ['wrong alias', { sourcePosition: 'MP' }],
    ['stack', { stackBb: 200 }],
    ['format', { format: 'mtt' }],
    ['response chart', { kind: 'vs-open' }],
    ['raise size', { raiseToBb: 3 }],
    ['ante assumed zero', { ante: 0 }],
    ['rake assumed zero', { rake: 0 }],
    ['missing rake', { rake: undefined }],
    ['wrong page', { page: 4 }],
    ['Call semantics', { callMeaning: 'Call open' }],
    ['precision claim', { precision: { step: 0.01, kind: 'exact-solver' } }],
    ['invalid printed aggregate', { printedRaisePercent: Number.NaN }],
  ])('rejects mismatched or invented %s metadata', (_label, patch) => {
    const input = fixture();
    Object.assign(input.nodes[0], patch);
    expect(() => validatePublishedCharts(input)).toThrow();
  });

  it('rejects repeated ids', () => {
    const input = fixture();
    input.nodes.push({ ...input.nodes[0] });
    expect(() => validatePublishedCharts(input)).toThrow(/unique safe id/);
  });

  it('rejects the same source and seat under a second id', () => {
    const input = fixture();
    input.nodes.push({ ...input.nodes[0], id: 'synthetic-second-id' });
    expect(() => validatePublishedCharts(input)).toThrow(/same source and seat/);
  });

  it.each([
    ['solver schema', { schemaVersion: 2 }],
    ['solver kind', { kind: 'solver-strategy' }],
    ['percent units', { frequencyUnit: 'percent' }],
    ['precision disclosure', { precision: { step: 0.5, label: 'Exact GTO' } }],
    ['impossible date', { preparedAt: '2026-02-31' }],
    ['missing nodes', { nodes: [] }],
  ])('rejects root %s', (_label, patch) => {
    expect(() => validatePublishedCharts({ ...fixture(), ...patch })).toThrow();
  });
});

describe('published Facing Open charts', () => {
  it('whitelists exactly 15 six-max and 36 nine-max reviewed matchups', () => {
    expect(REVIEWED_RESPONSE_CHARTS).toHaveLength(51);
    for (const players of [6, 9] as const) {
      const reviewed = REVIEWED_RESPONSE_CHARTS.filter(chart => chart.players === players);
      expect(reviewed).toHaveLength(players * (players - 1) / 2);
      const expected = getPositions(players).flatMap((hero, index, positions) => positions.slice(0, index).map(villain => `${hero}:${villain}`));
      expect(reviewed.map(chart => `${chart.hero}:${chart.villain}`).sort()).toEqual(expected.sort());
    }
  });

  it('accepts all 51 reviewed source contexts without inventing frequencies', () => {
    const input = responseFixture();
    input.sources.push(responseFixture(REVIEWED_RESPONSE_CHARTS.find(chart => chart.players === 9)!).sources[0]);
    input.nodes = REVIEWED_RESPONSE_CHARTS.map(chart => responseFixture(chart).nodes[0]);
    const result = validatePublishedCharts(input);
    expect(result.nodes).toHaveLength(51);
    expect(result.nodes.every(node => node.kind === 'vs-open' && node.callMeaning === 'Call Open')).toBe(true);
    expect(result.nodes.reduce((count, node) => count + Object.keys(node.frequencies).length, 0)).toBe(8619);
  });

  it('recomputes Call Open summaries with combo weights and keeps printed aggregates separate', () => {
    const input = responseFixture(REVIEWED_RESPONSE_CHARTS.find(chart => chart.players === 6 && chart.hero === 'BTN')!);
    input.nodes[0].frequencies.AKo = { raise: 0, call: 0.5, fold: 0.5 };
    const node = validatePublishedCharts(input).nodes[0];
    expect(node.kind).toBe('vs-open');
    expect(node.callMeaning).toBe('Call Open');
    expect(node.derivedRangeSummary.call).toBeCloseTo(6 / 1326, 14);
    expect(node.derivedRangeSummary.raise).toBeCloseTo(8 / 1326, 14);
    expect(node.printedRaisePercent).toBe(7.7);
    expect(node.ante).toBeNull();
    expect(node.rake).toBeNull();
  });

  it('keeps the UTG1 response alias distinct from the UTG+1 RFI label', () => {
    const response = validatePublishedCharts(responseFixture(REVIEWED_RESPONSE_CHARTS.find(chart => chart.players === 9 && chart.hero === 'UTG+1')!)).nodes[0];
    const rfi = validatePublishedCharts(fixture(9, 'UTG+1')).nodes[0];
    expect(response.hero).toBe('UTG+1');
    expect(response.sourcePosition).toBe('UTG1');
    expect(rfi.sourcePosition).toBe('UTG+1');
    const withOpener = validatePublishedCharts(responseFixture(REVIEWED_RESPONSE_CHARTS.find(chart => chart.players === 9 && chart.villain === 'UTG+1')!)).nodes[0];
    if (withOpener.kind === 'vs-open') expect(withOpener.sourceVillain).toBe('UTG1');
  });

  it('retains explicit zero calls on the seven charts that show only Raise and Fold', () => {
    const withoutCalls = REVIEWED_RESPONSE_CHARTS.filter(chart => !chart.hasCallAction);
    expect(withoutCalls).toHaveLength(7);
    for (const chart of withoutCalls) {
      const input = responseFixture(chart);
      const node = validatePublishedCharts(input).nodes[0];
      expect(node.derivedRangeSummary.call).toBe(0);
      if (node.kind === 'vs-open') expect(node.printedCallPercent).toBeNull();
      input.nodes[0].frequencies.AKs = { raise: 0, call: 0.5, fold: 0.5 };
      expect(() => validatePublishedCharts(input)).toThrow(/only Raise and Fold/);
    }
  });

  it('preserves the missing 9-max BB versus UTG+2 legend as null', () => {
    const chart = REVIEWED_RESPONSE_CHARTS.find(chart => chart.players === 9 && chart.hero === 'BB' && chart.villain === 'UTG+2')!;
    const input = responseFixture(chart);
    const node = validatePublishedCharts(input).nodes[0];
    expect(node.kind).toBe('vs-open');
    expect(node.raiseToBb).toBeNull();
    expect(node.printedRaisePercent).toBeNull();
    if (node.kind === 'vs-open') expect(node.printedCallPercent).toBeNull();
    Object.assign(input.nodes[0], { raiseToBb: 13, printedRaisePercent: 4, printedCallPercent: 30 });
    expect(() => validatePublishedCharts(input)).toThrow(/Raise size/);
  });

  it('does not infer missing legend percentages while retaining a null raise size', () => {
    const chart = REVIEWED_RESPONSE_CHARTS.find(chart => chart.raiseToBb === null)!;
    const input = responseFixture(chart);
    input.nodes[0].printedCallPercent = 0;
    expect(() => validatePublishedCharts(input)).toThrow(/missing legend/);
  });

  it('keeps published fractional sizes exactly instead of rounding them', () => {
    const chart = REVIEWED_RESPONSE_CHARTS.find(chart => chart.raiseToBb === 8.48)!;
    const input = responseFixture(chart);
    expect(validatePublishedCharts(input).nodes[0].raiseToBb).toBe(8.48);
    input.nodes[0].raiseToBb = 8.5;
    expect(() => validatePublishedCharts(input)).toThrow(/Raise size/);
  });

  it.each([
    ['opener after Hero', { villain: 'BB', sourceVillain: 'BB' }],
    ['Hero is opener', { villain: 'HJ', sourceVillain: 'MP' }],
    ['missing opponent', { villain: undefined }],
    ['wrong source alias', { sourceVillain: 'MP' }],
    ['different open size', { facingRaiseToBb: 3 }],
    ['different chart page', { page: 8 }],
    ['unknown known raise', { raiseToBb: null }],
    ['unknown known aggregate', { printedRaisePercent: null }],
    ['invalid Call aggregate', { printedCallPercent: 101 }],
    ['limp semantics', { callMeaning: 'SB completion / limp' }],
  ])('rejects mismatched response metadata: %s', (_label, patch) => {
    const chart = REVIEWED_RESPONSE_CHARTS.find(chart => chart.players === 6 && chart.hero === 'HJ' && chart.villain === 'UTG')!;
    const input = responseFixture(chart);
    Object.assign(input.nodes[0], patch);
    expect(() => validatePublishedCharts(input)).toThrow();
  });

  it('rejects a response root with incorrect reviewed source pages', () => {
    const input = responseFixture();
    input.sources[0].pages = [4, 5, 6, 7, 9];
    expect(() => validatePublishedCharts(input)).toThrow(/source pages/);
  });

  it('rejects a duplicated matchup under a new id', () => {
    const input = responseFixture();
    input.nodes.push({ ...input.nodes[0], id: 'synthetic-duplicate-response' });
    expect(() => validatePublishedCharts(input)).toThrow(/Duplicate/);
  });

  it('rejects response artifacts that try to label an RFI node as Facing Open', () => {
    const input = responseFixture();
    Object.assign(input.nodes[0], { kind: 'rfi' });
    expect(() => validatePublishedCharts(input)).toThrow();
  });

  it('rejects explicit opponent metadata on an RFI chart', () => {
    const input = fixture();
    Object.assign(input.nodes[0], { villain: 'SB', facingRaiseToBb: 3 });
    expect(() => validatePublishedCharts(input)).toThrow(/RFI charts cannot/);
  });
});
