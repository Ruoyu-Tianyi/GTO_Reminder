import { describe, expect, it } from 'vitest';
import type { Dataset } from './poker';
import type { ReferenceRange } from './reference-ranges';
import type { TreeDataset } from './tree-strategy';
import { bindStudyDataset, bindStudyReference, matchesStudyDataset, matchesStudyReference } from './study-bindings';

function dataset(): Pick<TreeDataset, 'id' | 'name' | 'source'> {
  return { id: 'model-part-001', name: 'Synthetic model', source: { kind: 'computed', name: 'Test',
    url: 'https://example.com/model', license: 'Synthetic test only', retrievedAt: '2026-10-13T04:06:38.600956+00:00', precision: 'Tree precision',
    computation: { engine: 'Test engine', model: 'Test model', iterations: 20, status: 'unconverged', scope: 'Test scope', modelGapBb: null,
      tree: { openSizeBb: 2.5, threeBetSizeBb: 10, fourBetSizeBb: 30, maxRaises: 4, limp: false } } } };
}
function reference(): ReferenceRange {
  return { id: 'chart-7', refId: 'source-8', players: 7, stackBb: 100, kind: 'rfi', hero: 'BTN', villain: null, page: 3,
    source: { name: 'Test', title: 'Synthetic reference', url: 'https://example.com/reference', sha256: 'a'.repeat(64) },
    precision: 'Synthetic chart precision', provenance: 'seat-projection', sourcePlayers: 8,
    actions: [{ id: 'raise', type: 'raise', label: 'Raise', amountBb: 2.5 }, { id: 'fold', type: 'fold', label: 'Fold' }],
    hands: { AA: { status: 'available', frequencies: { raise: 1, fold: 0 } } }, notes: ['Synthetic fixture only'] };
}

describe('saved query source bindings', () => {
  it('stores detached metadata only and preserves tree precision', () => {
    const original = dataset();
    const bound = bindStudyDataset(original);
    expect(bound.source).toEqual(original.source);
    original.source.computation!.tree!.fourBetSizeBb = 40;
    expect(bound.source.computation?.tree?.fourBetSizeBb).toBe(30);
    expect(bound.source.precision).toBe('Tree precision');
    const chart = reference(), chartBinding = bindStudyReference(chart);
    chart.actions[0].amountBb = 4;
    chart.source.title = 'Changed title';
    expect(chartBinding.actions[0].amountBb).toBe(2.5);
    expect(chartBinding.source.title).toBe('Synthetic reference');
    expect(chartBinding).not.toHaveProperty('hands');
    expect(chartBinding).not.toHaveProperty('frequencies');
  });

  it('matches exact metadata regardless of property order or dataset display name', () => {
    const original = dataset(), binding = bindStudyDataset(original);
    const reordered = { ...original, name: 'New display name', source: Object.fromEntries(Object.entries(original.source).reverse()) as Dataset['source'] };
    expect(matchesStudyDataset(binding, reordered)).toBe(true);
  });

  it('rejects different dataset IDs, source kinds, precision and computation snapshots', () => {
    const original = dataset(), binding = bindStudyDataset(original);
    expect(matchesStudyDataset(binding, { ...original, id: 'other-part-001' })).toBe(false);
    expect(matchesStudyDataset(binding, { ...original, source: { ...original.source, precision: 'Changed precision' } })).toBe(false);
    expect(matchesStudyDataset(binding, { ...original, source: { ...original.source, computation: { ...original.source.computation!, iterations: 21 } } })).toBe(false);
    expect(matchesStudyDataset(binding, { ...original, source: { ...original.source, kind: 'imported', computation: undefined } })).toBe(false);
  });

  it('rejects incompatible or invalid candidate metadata without throwing from rendering', () => {
    const original = dataset(), binding = bindStudyDataset(original);
    // The strategy import validator accepts longer metadata than the bounded bookmark format.
    const longMetadata = { ...original, source: { ...original.source, license: 'x'.repeat(4097) } };
    expect(matchesStudyDataset(binding, longMetadata)).toBe(false);
    const invalidTimestamp = { ...original, source: { ...original.source, retrievedAt: 'invalid' } };
    expect(matchesStudyDataset(binding, invalidTimestamp)).toBe(false);
  });

  it('compares the reference file hash, exact chart and page, sizes, precision, and provenance', () => {
    const chart = reference(), binding = bindStudyReference(chart);
    expect(matchesStudyReference(binding, chart)).toBe(true);
    for (const changed of [
      { ...chart, id: 'other-chart' }, { ...chart, page: 4 }, { ...chart, precision: 'Changed precision' },
      { ...chart, source: { ...chart.source, sha256: 'b'.repeat(64) } },
      { ...chart, actions: [{ ...chart.actions[0], amountBb: 3 }, chart.actions[1]] },
      { ...chart, sourcePlayers: 7, provenance: 'image-transcription' as const },
    ]) expect(matchesStudyReference(binding, changed)).toBe(false);
  });

  it('returns no match for another table size instead of throwing a projection validation error', () => {
    const projected = reference(), binding = bindStudyReference(projected);
    const originalEightMax: ReferenceRange = { ...projected, id: 'chart-8', players: 8, provenance: 'image-transcription' };
    expect(matchesStudyReference(binding, originalEightMax)).toBe(false);
  });

  it('does not claim frequency snapshots are retained when only reference metadata is bound', () => {
    const chart = reference(), binding = bindStudyReference(chart);
    chart.hands.AA = { status: 'available', frequencies: { raise: 0.5, fold: 0.5 } };
    expect(matchesStudyReference(binding, chart)).toBe(true);
    expect(JSON.stringify(binding)).not.toContain('frequencies');
  });
});
