import { describe, expect, it } from 'vitest';
import { buildPreset } from './preflop-presets';
import {
  addStudyBookmark, emptyStudyCollection, loadStudyStorage, MAX_STUDY_BOOKMARKS, MAX_STUDY_JSON_CHARS,
  mergeStudyCollections, parseStudyCollection, saveStudyStorage, serializeStudyCollection, STUDY_STORAGE_KEY,
  studyQueryKey, studySourceKey, validateStudyCollection, validateStudyQuery,
  type StudyCollection, type StudyDatasetBinding, type StudyQuery, type StudyReferenceBinding, type StudyStorage,
} from './study-session';

const SOURCE: StudyDatasetBinding['source'] = {
  kind: 'computed', name: 'Synthetic source', url: 'https://example.com/model', license: 'Synthetic test data',
  retrievedAt: '2026-10-02T14:04:11.192820+00:00', precision: 'Test tree precision',
  computation: { engine: 'Test engine', model: 'Test model', iterations: 40, status: 'approximate', scope: 'Test only', modelGapBb: 0.02,
    tree: { openSizeBb: 2.5, threeBetSizeBb: 10, fourBetSizeBb: 30, maxRaises: 4, limp: true, limpRaiseBb: 2.5 } },
};
function treeQuery(): Extract<StudyQuery, { view: 'tree' }> {
  const game = { players: 7, format: 'cash' as const, stackBb: 100, anteBb: 0, rake: 'Synthetic rake' };
  return { view: 'tree', game, history: buildPreset(game, 'unopened'), hand: 'AKs',
    binding: { datasetId: 'synthetic-tree-part-001', datasetName: 'Synthetic model', source: SOURCE } };
}
function quickQuery(): Extract<StudyQuery, { view: 'quick' }> {
  return { view: 'quick', hand: 'AKo', binding: null,
    spot: { players: 7, stackBb: 100, anteBb: 0, format: 'cash', rake: 'Synthetic rake', hero: 'UTG', villain: 'BB', kind: 'vs-3bet', openSizeBb: 2.5, threeBetSizeBb: 10, fourBetSizeBb: 30 } };
}
function referenceQuery(): Extract<StudyQuery, { view: 'reference' }> {
  const binding: StudyReferenceBinding = { chartId: 'estimate-7-chart', refId: 'synthetic-reference', page: 5, provenance: 'seat-projection', sourcePlayers: 8, precision: 'Synthetic precision',
    source: { name: 'Synthetic', title: 'Synthetic reference', url: 'https://example.com/reference', sha256: 'a'.repeat(64) },
    actions: [{ id: 'call', label: 'Call', type: 'call' }, { id: 'fold', label: 'Fold', type: 'fold' }] };
  return { view: 'reference', selection: { players: 7, kind: 'vs-4bet', hero: 'BB', villain: 'UTG' }, hand: 'QQ', binding };
}
const collection = (query: StudyQuery, label = 'Synthetic bookmark'): StudyCollection => ({ schemaVersion: 1, kind: 'gto-study-bookmarks', bookmarks: [{ label, createdAt: '2026-10-13T04:00:00.000Z', query }] });
function storage(raw: string | null = null): StudyStorage & { raw: string | null; writes: number } {
  return { raw, writes: 0, getItem(key) { expect(key).toBe(STUDY_STORAGE_KEY); return this.raw; }, setItem(key, value) { expect(key).toBe(STUDY_STORAGE_KEY); this.raw = value; this.writes++; } };
}

describe('portable study bookmark validation', () => {
  it('round-trips all three views with complete conditions and metadata, never strategy payloads', () => {
    const queries = [treeQuery(), quickQuery(), referenceQuery()];
    const saved: StudyCollection = { ...emptyStudyCollection(), bookmarks: queries.map((query, index) => ({ label: `Study ${index}`, createdAt: '2026-10-13', query })) };
    const json = serializeStudyCollection(saved);
    expect(parseStudyCollection(json)).toEqual(saved);
    expect(json).not.toMatch(/"(?:frequencies|hands|nodes|reach)"/);
    expect(parseStudyCollection(json).bookmarks[0].query.binding).toEqual(treeQuery().binding);
  });

  it('normalizes hand notation without inventing data or a binding', () => {
    const query = { ...quickQuery(), hand: 'as kh' };
    expect(validateStudyQuery(query).hand).toBe('AKo');
    expect(validateStudyQuery(query).binding).toBeNull();
    expect(() => validateStudyQuery({ ...query, hand: 'As As' })).toThrow(/valid starting hand/);
    expect(() => validateStudyQuery({ ...query, binding: undefined })).toThrow(/plain object/);
  });

  it('preserves mixed stacks and actual full histories including terminal states', () => {
    const query = treeQuery();
    query.game.stacksBb = { UTG: 70, BB: 50 };
    query.history = [
      { actor: 'UTG', type: 'raise', amountBb: 2.5 }, { actor: 'LJ', type: 'fold' }, { actor: 'HJ', type: 'fold' },
      { actor: 'CO', type: 'fold' }, { actor: 'BTN', type: 'fold' }, { actor: 'SB', type: 'fold' }, { actor: 'BB', type: 'fold' },
    ];
    expect(validateStudyQuery(query)).toEqual(query);
    expect(() => validateStudyQuery({ ...query, history: [...query.history, { actor: 'UTG', type: 'check' }] })).toThrow();
  });

  it('rejects wrong actors, illegal raises, excessive histories, and invalid game amounts', () => {
    expect(() => validateStudyQuery({ ...treeQuery(), history: [{ actor: 'BB', type: 'raise', amountBb: 3 }] })).toThrow();
    expect(() => validateStudyQuery({ ...treeQuery(), history: [{ actor: 'UTG', type: 'raise', amountBb: 1.5 }] })).toThrow();
    expect(() => validateStudyQuery({ ...treeQuery(), history: Array.from({ length: 201 }, () => ({ actor: 'UTG', type: 'fold' })) })).toThrow(/200/);
    expect(() => validateStudyQuery({ ...treeQuery(), game: { ...treeQuery().game, stackBb: Infinity } })).toThrow();
    expect(() => validateStudyQuery({ ...treeQuery(), game: { ...treeQuery().game, stacksBb: { 'UTG+2': 50 } } })).toThrow();
    expect(() => validateStudyQuery({ ...treeQuery(), history: [{ actor: 'UTG', type: 'fold', amountBb: 5 }] })).toThrow(/Only/);
  });

  it('validates quick observed sizes and seats while retaining unused future size controls', () => {
    expect(() => validateStudyQuery({ ...quickQuery(), spot: { ...quickQuery().spot, threeBetSizeBb: 3 } })).toThrow(/minimum full raise/);
    expect(() => validateStudyQuery({ ...quickQuery(), spot: { ...quickQuery().spot, hero: 'BB', villain: 'UTG' } })).toThrow(/villain/);
    const unopened = { ...quickQuery(), spot: { ...quickQuery().spot, kind: 'rfi', hero: 'UTG', villain: null, stackBb: 10, fourBetSizeBb: 30 } };
    expect(validateStudyQuery(unopened).view).toBe('quick');
    expect(validateStudyQuery({ ...quickQuery(), spot: { ...quickQuery().spot, format: 'mtt', players: 2, hero: 'SB', villain: 'BB' } }).view).toBe('quick');
  });

  it('validates reference seats and projection identity instead of treating estimated charts as originals', () => {
    expect(validateStudyQuery(referenceQuery())).toEqual(referenceQuery());
    expect(() => validateStudyQuery({ ...referenceQuery(), selection: { ...referenceQuery().selection, hero: 'UTG', villain: 'BB' } })).toThrow(/seats/);
    expect(() => validateStudyQuery({ ...referenceQuery(), binding: { ...referenceQuery().binding, provenance: 'image-transcription' } })).toThrow(/table size/);
    expect(() => validateStudyQuery({ ...referenceQuery(), binding: { ...referenceQuery().binding, sourcePlayers: 7 } })).toThrow(/projection/);
    expect(() => validateStudyQuery({ ...referenceQuery(), binding: { ...referenceQuery().binding, actions: [{ id: 'call', label: 'Call', type: 'call', amountBb: 3 }] } })).toThrow(/Only Raise/);
  });

  it('rejects frequency payloads and extra properties at every retained structural level', () => {
    expect(() => validateStudyQuery({ ...treeQuery(), frequencies: {} })).toThrow(/unsupported key/);
    expect(() => validateStudyQuery({ ...treeQuery(), game: { ...treeQuery().game, nodes: [] } })).toThrow(/unsupported key/);
    expect(() => validateStudyQuery({ ...treeQuery(), binding: { ...treeQuery().binding, source: { ...SOURCE, frequencies: {} } } })).toThrow(/unsupported key/);
    expect(() => validateStudyCollection({ ...collection(treeQuery()), hands: {} })).toThrow(/unsupported key/);
    expect(() => validateStudyQuery({ ...quickQuery(), selection: referenceQuery().selection })).toThrow(/unsupported key/);
  });

  it('rejects dangerous prototype keys and non-plain object inputs', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const raw = JSON.parse(JSON.stringify(treeQuery()));
      raw.game = JSON.parse(`{"players":7,"stackBb":100,"anteBb":0,"format":"cash","rake":"test","${key}":{}}`);
      expect(() => validateStudyQuery(raw)).toThrow(/unsupported key/);
    }
    expect(() => validateStudyQuery(Object.assign(Object.create({ inherited: true }), quickQuery()))).toThrow(/plain object/);
    expect(() => validateStudyQuery({ ...referenceQuery(), binding: { ...referenceQuery().binding, actions: [{ id: '__proto__', label: 'Fold', type: 'fold' }] } })).toThrow(/safe and unique/);
  });

  it('enforces collection, JSON, text, date, source precision and URL boundaries', () => {
    expect(() => validateStudyCollection({ ...emptyStudyCollection(), schemaVersion: 2 })).toThrow(/version/);
    expect(() => validateStudyCollection({ ...emptyStudyCollection(), bookmarks: Array(MAX_STUDY_BOOKMARKS + 1).fill(collection(quickQuery()).bookmarks[0]) })).toThrow(/200/);
    expect(() => parseStudyCollection(' '.repeat(MAX_STUDY_JSON_CHARS + 1))).toThrow(/2 MB/);
    expect(() => parseStudyCollection('中'.repeat(700_000))).toThrow(/2 MB/);
    expect(() => validateStudyCollection(collection(quickQuery(), 'x'.repeat(161)))).toThrow(/160/);
    expect(() => validateStudyCollection({ ...collection(quickQuery()), bookmarks: [{ ...collection(quickQuery()).bookmarks[0], createdAt: '2026-02-31' }] })).toThrow(/ISO/);
    expect(() => validateStudyQuery({ ...treeQuery(), binding: { ...treeQuery().binding, source: { ...SOURCE, precision: undefined } } })).toThrow(/precision/);
    expect(() => validateStudyQuery({ ...treeQuery(), binding: { ...treeQuery().binding, source: { ...SOURCE, url: 'https://user:secret@example.com' } } })).toThrow(/without credentials/);
  });
});

describe('exact identity and additive bookmark merge', () => {
  it('canonicalizes metadata field order and equivalent effective stacks', () => {
    const changed = treeQuery();
    changed.game.stacksBb = { BB: 100 };
    changed.binding = { ...changed.binding!, datasetName: 'Renamed display label', source: Object.fromEntries(Object.entries(SOURCE).reverse()) as StudyDatasetBinding['source'] };
    expect(studySourceKey(changed.binding.source)).toBe(studySourceKey(SOURCE));
    expect(studyQueryKey(changed)).toBe(studyQueryKey(treeQuery()));
  });

  it('keeps snapshots with changed precision, quality, iterations or model scope separate', () => {
    for (const source of [
      { ...SOURCE, precision: 'Changed precision' },
      { ...SOURCE, computation: { ...SOURCE.computation!, iterations: 41 } },
      { ...SOURCE, computation: { ...SOURCE.computation!, status: 'unconverged' as const } },
      { ...SOURCE, computation: { ...SOURCE.computation!, scope: 'Different model scope' } },
    ]) {
      const changed = { ...treeQuery(), binding: { ...treeQuery().binding!, source } };
      const merged = mergeStudyCollections(collection(treeQuery()), collection(changed));
      expect(merged.added).toBe(1);
      expect(merged.collection.bookmarks).toHaveLength(2);
    }
  });

  it('preserves distinct hands, histories, game conditions and dataset identities', () => {
    const query = treeQuery();
    for (const changed of [
      { ...query, hand: 'QQ' }, { ...query, history: [{ actor: 'UTG' as const, type: 'fold' as const }] },
      { ...query, game: { ...query.game, rake: 'Other rake' } },
      { ...query, binding: { ...query.binding!, datasetId: 'different-model' } },
      { ...query, binding: null },
    ]) expect(studyQueryKey(changed)).not.toBe(studyQueryKey(query));
  });

  it('deduplicates exact queries and retains the existing label without mutating either collection', () => {
    const left = collection(treeQuery(), 'Existing label'), right = collection(treeQuery(), 'Imported label');
    const leftBefore = JSON.stringify(left), rightBefore = JSON.stringify(right);
    const result = mergeStudyCollections(left, right);
    expect(result.added).toBe(0); expect(result.duplicates).toBe(1);
    expect(result.collection.bookmarks[0].label).toBe('Existing label');
    expect(JSON.stringify(left)).toBe(leftBefore); expect(JSON.stringify(right)).toBe(rightBefore);
    expect(validateStudyCollection({ ...left, bookmarks: [...left.bookmarks, ...right.bookmarks] }).bookmarks).toHaveLength(1);
  });

  it('adds bookmarks and rejects a merge exceeding the limit without truncating existing entries', () => {
    const result = addStudyBookmark(emptyStudyCollection(), quickQuery(), 'Quick study', '2026-10-13');
    expect(result.added).toBe(1);
    const full: StudyCollection = { ...emptyStudyCollection(), bookmarks: Array.from({ length: MAX_STUDY_BOOKMARKS }, (_, index) => ({ label: `Study ${index}`, createdAt: '2026-10-13', query: { ...quickQuery(), spot: { ...quickQuery().spot, rake: `Profile ${index}` } } })) };
    expect(() => mergeStudyCollections(full, collection(treeQuery()))).toThrow(/200/);
    expect(full.bookmarks).toHaveLength(MAX_STUDY_BOOKMARKS);
  });
});

describe('storage failure handling', () => {
  it('loads empty or valid storage and persists a collection without browser globals', () => {
    const target = storage();
    expect(loadStudyStorage(target)).toEqual({ collection: emptyStudyCollection(), status: 'empty', error: null });
    expect(saveStudyStorage(target, collection(treeQuery()))).toEqual({ ok: true, error: null });
    expect(target.writes).toBe(1);
    expect(loadStudyStorage(target).status).toBe('ready');
    expect(loadStudyStorage(target).collection).toEqual(collection(treeQuery()));
  });

  it('preserves malformed data and unsupported versions on load and subsequent save', () => {
    for (const raw of ['broken { json', JSON.stringify({ schemaVersion: 2, kind: 'gto-study-bookmarks', bookmarks: [] })]) {
      const target = storage(raw);
      expect(loadStudyStorage(target).status).toBe('invalid');
      expect(saveStudyStorage(target, collection(quickQuery())).ok).toBe(false);
      expect(target.writes).toBe(0);
      expect(target.raw).toBe(raw);
    }
  });

  it('keeps the in-memory collection usable when reads or writes fail', () => {
    const current = collection(treeQuery()), snapshot = JSON.stringify(current);
    const blockedRead: StudyStorage = { getItem() { throw new Error('Access denied'); }, setItem() { throw new Error('Should not write'); } };
    expect(loadStudyStorage(blockedRead).status).toBe('unavailable');
    expect(saveStudyStorage(blockedRead, current).ok).toBe(false);
    const full: StudyStorage = { getItem: () => null, setItem() { throw new Error('Quota exceeded'); } };
    const result = saveStudyStorage(full, current);
    expect(result.ok).toBe(false); expect(result.error).toContain('Quota exceeded');
    expect(JSON.stringify(current)).toBe(snapshot);
    expect(parseStudyCollection(serializeStudyCollection(current))).toEqual(current);
  });
});
