import { describe, expect, it } from 'vitest';
import type { PublishedChartNode } from './published-charts';
import type { ReferenceRange } from './reference-ranges';
import { precedingRaiseSizes, supportsActionView, transcribedActions } from './reference-evidence';

// Metadata fixtures test matching; they contain no copied source frequencies.
const reference = { refId: 'reviewed-pdf', players: 9, sourcePlayers: 9, stackBb: 100, kind: 'vs-3bet',
  hero: 'UTG+2', villain: 'BB', provenance: 'publisher-simplified', source: { sha256: 'reviewed-hash' } } as ReferenceRange;
const charts = [
  { ...reference, kind: 'rfi', villain: null, raiseToBb: 3 },
  { ...reference, kind: 'vs-open', hero: 'BB', villain: 'UTG+2', raiseToBb: null },
] as unknown as PublishedChartNode[];

describe('reference evidence presentation', () => {
  it('allows action view for an original 8-max image transcription only', () => {
    const image = { ...reference, players: 8, sourcePlayers: 8, provenance: 'image-transcription' as const };
    expect(supportsActionView(image)).toBe(true);
    expect(supportsActionView({ ...image, players: 7, provenance: 'seat-projection' })).toBe(false);
    expect(supportsActionView({ ...image, sourcePlayers: 9 })).toBe(false);
    expect(supportsActionView(reference)).toBe(false);
    expect(supportsActionView(undefined)).toBe(false);
  });
  it('exposes action identities without inventing equal mixes or pure frequencies', () => {
    const mixed = { status: 'available' as const, frequencies: { shove: .34, call: .66, fold: 0 } };
    expect(transcribedActions(mixed, ['shove', 'call', 'fold'])).toEqual(['shove', 'call']);
    expect(transcribedActions({ status: 'available', frequencies: { call: 1, fold: 0 } }, ['call', 'fold'])).toEqual(['call']);
    expect(mixed.frequencies).toEqual({ shove: .34, call: .66, fold: 0 });
  });
  it.each(['not-charted', 'unreadable'] as const)('does not turn %s into Fold', status => {
    expect(transcribedActions({ status }, ['call', 'fold'])).toBeNull();
    expect(transcribedActions(undefined, ['call', 'fold'])).toBeNull();
  });
  it('keeps the missing BB-vs-MP three-bet legend unknown', () => {
    expect(precedingRaiseSizes(reference, charts)).toEqual({ openSizeBb: 3, threeBetSizeBb: null });
    expect(precedingRaiseSizes(reference, [])).toEqual({ openSizeBb: null, threeBetSizeBb: null });
  });
  it('matches both positions in the correct historical order', () => {
    const known = structuredClone(charts);
    known[1].raiseToBb = 13;
    expect(precedingRaiseSizes(reference, known)).toEqual({ openSizeBb: 3, threeBetSizeBb: 13 });
    expect(precedingRaiseSizes({ ...reference, hero: 'UTG' }, known)).toEqual({ openSizeBb: null, threeBetSizeBb: null });
  });
  it('never borrows sizes from a different source, table, depth or projection', () => {
    for (const patch of [{ refId: 'other' }, { players: 6 }, { stackBb: 50 }, { source: { sha256: 'other' } }]) {
      const unrelated = charts.map(chart => ({ ...chart, ...patch })) as PublishedChartNode[];
      expect(precedingRaiseSizes(reference, unrelated)).toEqual({ openSizeBb: null, threeBetSizeBb: null });
    }
    expect(precedingRaiseSizes({ ...reference, kind: 'vs-4bet' }, charts)).toBeNull();
    expect(precedingRaiseSizes({ ...reference, players: 7, provenance: 'seat-projection' }, charts)).toBeNull();
    expect(precedingRaiseSizes(undefined, charts)).toBeNull();
  });
});
