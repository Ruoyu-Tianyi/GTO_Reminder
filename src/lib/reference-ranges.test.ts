import { describe, expect, it } from 'vitest';
import { HANDS, getPositions } from './poker';
import { CHART_REFERENCES } from '../data/references';
import { projectSevenMax, referenceVillains, validateReferenceRanges } from './reference-ranges';
import { displayPublishedChart } from './display-ranges';

function fixture(hero = 'UTG+1') {
  const ref = CHART_REFERENCES[1];
  return { schemaVersion: 1, kind: 'reference-ranges', source: { name: ref.provider, title: ref.title, url: ref.url, sha256: ref.sha256 }, nodes: [{
    id: 'test-eight-rfi', players: 8, stackBb: 100, refId: ref.id, kind: 'rfi', hero, villain: null, page: 4,
    actions: [{ id: 'raise', type: 'raise', label: 'Raise 3 BB', amountBb: 3 }, { id: 'fold', type: 'fold', label: 'Fold' }],
    hands: Object.fromEntries(HANDS.map(hand => [hand, { status: 'available', frequencies: { raise: 0.5, fold: 0.5 } }])),
    precision: 'Synthetic contract fixture, not a strategy', notes: ['Test only'],
  }] };
}
describe('reviewed image references and explicitly estimated seat projection', () => {
  it('keeps source seats and provenance distinct when projecting seven-max', () => {
    const originals = validateReferenceRanges(fixture());
    const projected = projectSevenMax(originals);
    expect(projected[0]).toMatchObject({ hero: 'UTG', players: 7, sourcePlayers: 8, provenance: 'seat-projection', page: 4 });
    expect(originals[0]).toMatchObject({ hero: 'UTG+1', players: 8, provenance: 'image-transcription' });
    expect(projected[0].notes.join(' ')).toContain('No card-bunching');
    expect(projectSevenMax(projected)).toEqual([]);
    expect(projectSevenMax(validateReferenceRanges(fixture('UTG')))).toEqual([]);
  });
  it('requires every hand and never fills unknown cells as Fold', () => {
    const raw = fixture();
    const hands = raw.nodes[0].hands as Record<string, unknown>;
    hands.AA = { status: 'unreadable' };
    expect(validateReferenceRanges(raw)[0].hands.AA).toEqual({ status: 'unreadable' });
    hands.AA = { status: 'not-charted', frequencies: { fold: 1 } };
    expect(() => validateReferenceRanges(raw)).toThrow('Missing hands');
    delete hands.AA;
    expect(() => validateReferenceRanges(raw)).toThrow('Every hand');
  });
  it('rejects unknown source hashes, made-up seats, pages and frequency actions', () => {
    const raw = fixture(); raw.source.sha256 = '0'.repeat(64);
    expect(() => validateReferenceRanges(raw)).toThrow('source');
    const wrongPage = fixture(); wrongPage.nodes[0].page = 6;
    expect(() => validateReferenceRanges(wrongPage)).toThrow('catalog');
    const wrongSeat = fixture('UTG+2');
    expect(() => validateReferenceRanges(wrongSeat)).toThrow('seats');
    const wrongFrequency = fixture(); wrongFrequency.nodes[0].hands.AA.frequencies.raise = 0.6;
    expect(() => validateReferenceRanges(wrongFrequency)).toThrow('sum');
    const wrongAction = fixture(); wrongAction.nodes[0].actions[0].id = 'constructor';
    expect(() => validateReferenceRanges(wrongAction)).toThrow('action ID');
  });
  it('supports separate all-in and fixed raise actions without losing missing status', () => {
    const raw = fixture('CO'); raw.nodes[0].kind = 'vs-3bet';
    Object.assign(raw.nodes[0], { villain: 'BB', page: 17 });
    raw.nodes[0].actions.push({ id: 'shove', type: 'raise', label: 'All-in 100 BB', amountBb: 100 });
    for (const hand of HANDS) Object.assign(raw.nodes[0].hands[hand].frequencies, { shove: 0 });
    const result = validateReferenceRanges(raw)[0];
    expect(result.actions).toHaveLength(3);
    expect(projectSevenMax([result])[0].villain).toBe('BB');
  });
  it('keeps opponent choices in the correct action order for all supported scenarios', () => {
    for (const players of [6,7,8,9]) {
      const seats = getPositions(players);
      expect(referenceVillains(players, 'BB', 'vs-limp')).toEqual(['SB']);
      expect(referenceVillains(players, 'UTG', 'vs-5bet')).toEqual(seats.slice(1));
      expect(referenceVillains(players, 'UTG', 'vs-open')).toEqual([]);
    }
  });
  it('preserves original 50% chart semantics in the display adapter', () => {
    const chart = displayPublishedChart({ id: 'test', refId: 'test', players: 6, stackBb: 100, format: 'cash', hero: 'SB', sourcePosition: 'SB', ante: null, rake: null, page: 3,
      source: { name: 'Test', title: 'Test', url: 'https://example.com', sha256: '0'.repeat(64) }, precision: { step: 0.5, kind: 'publisher-simplified' },
      frequencies: Object.fromEntries(HANDS.map(hand => [hand, { raise: 0.5, call: 0.5, fold: 0 }])), derivedRangeSummary: { raise: 0.5, call: 0.5, fold: 0 },
      kind: 'rfi', villain: null, raiseToBb: 3, callMeaning: 'SB completion / limp', printedRaisePercent: 50 });
    expect(chart.actions.find(action => action.id === 'call')?.label).toBe('Limp');
    expect(chart.provenance).toBe('publisher-simplified');
  });
});
