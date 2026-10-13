import { getPositions, normalizeHand, validateActionSizes, validateComputation, validateSpot, type Dataset, type Spot } from './poker';
import { replayPreflop, type PreflopAction } from './preflop';
import { referenceVillains, type ReferenceAction, type ReferenceKind, type ReferenceRange } from './reference-ranges';
import { gameKey, historyKey, type TreeGame } from './tree-strategy';
import { spotToHistory } from './spot-to-history';

export const STUDY_STORAGE_KEY = 'gto-reminder:study-bookmarks:v1';
export const MAX_STUDY_BOOKMARKS = 200;
export const MAX_STUDY_JSON_CHARS = 2_000_000;
export const MAX_STUDY_JSON_BYTES = 2_000_000;
export interface StudyDatasetBinding {
  datasetId: string;
  datasetName: string;
  source: Dataset['source'] & { precision?: string };
}
export interface StudyReferenceBinding {
  chartId: string;
  refId: string;
  source: ReferenceRange['source'];
  provenance: ReferenceRange['provenance'];
  sourcePlayers: number;
  page: number;
  precision: string;
  actions: ReferenceAction[];
}
export type StudyReferenceSelection = Pick<ReferenceRange, 'players' | 'kind' | 'hero' | 'villain'>;
export type StudyQuery =
  | { view: 'tree'; game: TreeGame; history: PreflopAction[]; hand: string; binding: StudyDatasetBinding | null }
  | { view: 'quick'; spot: Spot; hand: string; binding: StudyDatasetBinding | null }
  | { view: 'reference'; selection: StudyReferenceSelection; hand: string; binding: StudyReferenceBinding | null };
export interface StudyBookmark { label: string; createdAt: string; query: StudyQuery }
export interface StudyCollection { schemaVersion: 1; kind: 'gto-study-bookmarks'; bookmarks: StudyBookmark[] }
export interface StudyStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface StudyStorageLoad {
  collection: StudyCollection;
  status: 'empty' | 'ready' | 'invalid' | 'unavailable';
  error: string | null;
}
export type StudyStorageSave = { ok: true; error: null } | { ok: false; error: string };
export interface StudyMerge { collection: StudyCollection; added: number; duplicates: number }

const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;
function object(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error(`${path} must be a plain object.`);
  }
  for (const key of Object.keys(value)) {
    if (forbidden.has(key) || !keys.includes(key)) throw new Error(`${path} contains an unsupported key: ${key}.`);
  }
  return value as Record<string, unknown>;
}
function text(value: unknown, path: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new Error(`${path} must contain 1–${max} valid characters.`);
  }
  return value;
}
function number(value: unknown, path: string, min = 0, max = 1_000_000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${path} is outside its supported numeric range.`);
  return value;
}
function integer(value: unknown, path: string, min: number, max: number): number {
  const result = number(value, path, min, max);
  if (!Number.isInteger(result)) throw new Error(`${path} must be an integer.`);
  return result;
}
function date(value: unknown, path: string): string {
  const result = text(value, path, 40);
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(`${result.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== result.slice(0, 10)) {
    throw new Error(`${path} must be a valid ISO date or timestamp with a timezone.`);
  }
  return result;
}
function url(value: unknown, path: string): string {
  const result = text(value, path, 2048);
  let parsed: URL;
  try { parsed = new URL(result); } catch { throw new Error(`${path} must be an HTTP(S) URL.`); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(`${path} must be an HTTP(S) URL without credentials.`);
  return result;
}

function validateSource(value: unknown): StudyDatasetBinding['source'] {
  const raw = object(value, ['name', 'url', 'license', 'retrievedAt', 'kind', 'computation', 'precision'], 'binding.source');
  if (!['computed', 'imported', 'demo'].includes(raw.kind as string)) throw new Error('Invalid dataset source kind.');
  const source: StudyDatasetBinding['source'] = {
    name: text(raw.name, 'source.name'), url: url(raw.url, 'source.url'), license: text(raw.license, 'source.license', 4096),
    retrievedAt: date(raw.retrievedAt, 'source.retrievedAt'), kind: raw.kind as Dataset['source']['kind'],
  };
  if (raw.precision !== undefined) source.precision = text(raw.precision, 'source.precision', 4096);
  if (source.kind === 'computed') {
    const computation = object(raw.computation, ['engine', 'model', 'iterations', 'status', 'scope', 'tree', 'modelGapBb'], 'source.computation');
    text(computation.engine, 'computation.engine', 4096); text(computation.model, 'computation.model', 4096); text(computation.scope, 'computation.scope', 4096);
    if (computation.tree !== undefined) object(computation.tree, ['openSizeBb', 'threeBetSizeBb', 'fourBetSizeBb', 'maxRaises', 'limp', 'limpRaiseBb'], 'computation.tree');
    source.computation = validateComputation(computation);
  } else if (raw.computation !== undefined) throw new Error('Only computed sources may declare computation metadata.');
  return source;
}
function datasetBinding(value: unknown, tree: boolean): StudyDatasetBinding | null {
  if (value === null) return null;
  const raw = object(value, ['datasetId', 'datasetName', 'source'], 'binding');
  const source = validateSource(raw.source);
  if (tree && source.precision === undefined) throw new Error('A tree binding requires source precision.');
  return { datasetId: text(raw.datasetId, 'binding.datasetId'), datasetName: text(raw.datasetName, 'binding.datasetName', 300), source };
}
function referenceBinding(value: unknown, selection: StudyReferenceSelection): StudyReferenceBinding | null {
  if (value === null) return null;
  const raw = object(value, ['chartId', 'refId', 'source', 'provenance', 'sourcePlayers', 'page', 'precision', 'actions'], 'binding');
  const source = object(raw.source, ['name', 'title', 'url', 'sha256'], 'binding.source');
  if (typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(source.sha256)) throw new Error('Reference source requires a SHA-256 identity.');
  if (!['image-transcription', 'seat-projection', 'publisher-simplified'].includes(raw.provenance as string)) throw new Error('Invalid reference provenance.');
  const sourcePlayers = integer(raw.sourcePlayers, 'binding.sourcePlayers', 6, 9);
  if (raw.provenance === 'seat-projection' ? selection.players !== 7 || sourcePlayers !== 8 : sourcePlayers !== selection.players) {
    throw new Error('Reference source table size does not match the selected chart or 8-to-7 projection.');
  }
  if (!Array.isArray(raw.actions) || raw.actions.length < 1 || raw.actions.length > 5) throw new Error('Reference actions must contain 1–5 choices.');
  const ids = new Set<string>();
  const actions: ReferenceAction[] = raw.actions.map(value => {
    const action = object(value, ['id', 'label', 'type', 'amountBb'], 'binding.actions[]');
    const id = text(action.id, 'action.id', 50);
    if (!/^[a-z][a-z0-9_-]*$/.test(id) || forbidden.has(id) || ids.has(id)) throw new Error('Reference action IDs must be safe and unique.');
    ids.add(id);
    if (!['raise', 'call', 'fold', 'check'].includes(action.type as string)) throw new Error('Invalid reference action.');
    if (action.amountBb !== undefined && action.type !== 'raise') throw new Error('Only Raise may have an amount.');
    return { id, label: text(action.label, 'action.label', 200), type: action.type as ReferenceAction['type'],
      ...(action.amountBb === undefined ? {} : { amountBb: number(action.amountBb, 'action.amountBb', Number.MIN_VALUE) }) };
  });
  return { chartId: text(raw.chartId, 'binding.chartId'), refId: text(raw.refId, 'binding.refId'),
    source: { name: text(source.name, 'source.name'), title: text(source.title, 'source.title', 500), url: url(source.url, 'source.url'), sha256: source.sha256.toLowerCase() },
    provenance: raw.provenance as ReferenceRange['provenance'], sourcePlayers, page: integer(raw.page, 'binding.page', 1, 10000),
    precision: text(raw.precision, 'binding.precision', 4096), actions };
}

/** Rebuilds only the schema's whitelisted fields, so strategy payloads can never enter bookmarks. */
export function validateStudyQuery(value: unknown): StudyQuery {
  const raw = object(value, ['view', 'game', 'history', 'spot', 'selection', 'hand', 'binding'], 'query');
  const hand = normalizeHand(text(raw.hand, 'query.hand', 30));
  if (!hand) throw new Error('A study query requires a valid starting hand.');
  if (raw.view === 'tree') {
    object(raw, ['view', 'game', 'history', 'hand', 'binding'], 'tree query');
    const input = object(raw.game, ['players', 'stackBb', 'anteBb', 'stacksBb', 'format', 'rake'], 'query.game');
    if (input.format !== 'cash') throw new Error('Tree queries currently require Cash.');
    const players = integer(input.players, 'game.players', 6, 9);
    const game: TreeGame = { players, stackBb: number(input.stackBb, 'game.stackBb', Number.MIN_VALUE), anteBb: number(input.anteBb, 'game.anteBb'), format: 'cash', rake: text(input.rake, 'game.rake', 300) };
    if (input.stacksBb !== undefined) {
      const stacks = object(input.stacksBb, getPositions(players), 'game.stacksBb');
      game.stacksBb = Object.fromEntries(Object.entries(stacks).map(([position, chips]) => [position, number(chips, `stacksBb.${position}`, Number.MIN_VALUE)]));
    }
    if (!Array.isArray(raw.history) || raw.history.length > 200) throw new Error('A study history supports at most 200 actions.');
    const history: PreflopAction[] = raw.history.map(value => {
      const action = object(value, ['actor', 'type', 'amountBb'], 'history[]');
      if (!getPositions(players).includes(action.actor as PreflopAction['actor']) || !['raise', 'call', 'fold', 'check'].includes(action.type as string)) throw new Error('Invalid history actor or action.');
      if (action.type !== 'raise' && action.amountBb !== undefined) throw new Error('Only a Raise history action may have an amount.');
      return { actor: action.actor as PreflopAction['actor'], type: action.type as PreflopAction['type'],
        ...(action.type === 'raise' ? { amountBb: number(action.amountBb, 'history.amountBb', Number.MIN_VALUE) } : {}) };
    });
    replayPreflop(game, history);
    return { view: 'tree', game, history, hand, binding: datasetBinding(raw.binding, true) };
  }
  if (raw.view === 'quick') {
    object(raw, ['view', 'spot', 'hand', 'binding'], 'quick query');
    const input = object(raw.spot, ['players', 'hero', 'villain', 'stackBb', 'kind', 'openSizeBb', 'threeBetSizeBb', 'fourBetSizeBb', 'format', 'anteBb', 'rake'], 'query.spot');
    for (const key of ['stackBb', 'openSizeBb', 'threeBetSizeBb', 'fourBetSizeBb', 'anteBb']) number(input[key], `spot.${key}`);
    text(input.rake, 'spot.rake', 300);
    const spot = validateSpot(input, 'query.spot');
    validateActionSizes(spot, false, 'query.spot');
    if (spot.format === 'cash' && spot.players >= 6) spotToHistory(spot);
    return { view: 'quick', spot, hand, binding: datasetBinding(raw.binding, false) };
  }
  if (raw.view === 'reference') {
    object(raw, ['view', 'selection', 'hand', 'binding'], 'reference query');
    const input = object(raw.selection, ['players', 'kind', 'hero', 'villain'], 'query.selection');
    const players = integer(input.players, 'selection.players', 6, 9);
    if (!['rfi', 'vs-open', 'vs-3bet', 'vs-4bet', 'vs-5bet', 'vs-limp'].includes(input.kind as string)) throw new Error('Invalid reference scenario.');
    const kind = input.kind as ReferenceKind;
    const hero = input.hero as StudyReferenceSelection['hero'], villain = input.villain as StudyReferenceSelection['villain'];
    if (!getPositions(players).includes(hero) || (kind === 'rfi' ? hero === 'BB' || villain !== null : !villain || !referenceVillains(players, hero, kind).includes(villain))) throw new Error('Invalid reference seats for this scenario.');
    const selection = { players, kind, hero, villain };
    return { view: 'reference', selection, hand, binding: referenceBinding(raw.binding, selection) };
  }
  throw new Error('Unsupported study query view.');
}

/** Stable metadata comparison, including tree precision. Never treats a different snapshot as interchangeable. */
export function studySourceKey(source: StudyDatasetBinding['source']): string {
  return canonical(validateSource(source));
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function studyQueryKey(query: StudyQuery): string {
  const value = validateStudyQuery(query);
  if (value.view === 'tree') return canonical({ view: value.view, game: gameKey(value.game), history: historyKey(value.history), hand: value.hand,
    binding: value.binding ? { datasetId: value.binding.datasetId, source: value.binding.source } : null });
  if (value.view === 'quick') return canonical({ ...value, binding: value.binding ? { datasetId: value.binding.datasetId, source: value.binding.source } : null });
  return canonical(value);
}
export const emptyStudyCollection = (): StudyCollection => ({ schemaVersion: 1, kind: 'gto-study-bookmarks', bookmarks: [] });

export function validateStudyCollection(value: unknown): StudyCollection {
  const raw = object(value, ['schemaVersion', 'kind', 'bookmarks'], 'collection');
  if (raw.schemaVersion !== 1 || raw.kind !== 'gto-study-bookmarks') throw new Error('Unsupported study bookmark format or version.');
  if (!Array.isArray(raw.bookmarks) || raw.bookmarks.length > MAX_STUDY_BOOKMARKS) throw new Error(`A collection supports at most ${MAX_STUDY_BOOKMARKS} bookmarks.`);
  const keys = new Set<string>();
  const bookmarks: StudyBookmark[] = [];
  for (const value of raw.bookmarks) {
    const bookmark = object(value, ['label', 'createdAt', 'query'], 'bookmark');
    const entry = { label: text(bookmark.label, 'bookmark.label', 160), createdAt: date(bookmark.createdAt, 'bookmark.createdAt'), query: validateStudyQuery(bookmark.query) };
    const key = studyQueryKey(entry.query);
    if (!keys.has(key)) { bookmarks.push(entry); keys.add(key); }
  }
  const result: StudyCollection = { schemaVersion: 1, kind: 'gto-study-bookmarks', bookmarks };
  if (byteLength(JSON.stringify(result)) > MAX_STUDY_JSON_BYTES) throw new Error('Study bookmarks exceed the 2 MB text limit.');
  return result;
}
export function parseStudyCollection(json: string): StudyCollection {
  if (json.length > MAX_STUDY_JSON_CHARS || byteLength(json) > MAX_STUDY_JSON_BYTES) throw new Error('Study bookmark input exceeds the 2 MB text limit.');
  return validateStudyCollection(JSON.parse(json));
}
export function serializeStudyCollection(collection: StudyCollection): string {
  const clean = validateStudyCollection(collection);
  const pretty = JSON.stringify(clean, null, 2);
  return byteLength(pretty) <= MAX_STUDY_JSON_BYTES ? pretty : JSON.stringify(clean);
}
/** Union by exact query + source identity. Existing labels and timestamps win; neither source snapshot is replaced. */
export function mergeStudyCollections(current: StudyCollection, incoming: StudyCollection): StudyMerge {
  const left = validateStudyCollection(current), right = validateStudyCollection(incoming);
  const keys = new Set(left.bookmarks.map(entry => studyQueryKey(entry.query)));
  const additions = right.bookmarks.filter(entry => !keys.has(studyQueryKey(entry.query)));
  return { collection: validateStudyCollection({ ...left, bookmarks: [...left.bookmarks, ...additions] }), added: additions.length, duplicates: right.bookmarks.length - additions.length };
}
export function addStudyBookmark(current: StudyCollection, query: StudyQuery, label: string, createdAt = new Date().toISOString()): StudyMerge {
  return mergeStudyCollections(current, { schemaVersion: 1, kind: 'gto-study-bookmarks', bookmarks: [{ label, createdAt, query }] });
}
export function loadStudyStorage(storage: StudyStorage): StudyStorageLoad {
  let raw: string | null;
  try { raw = storage.getItem(STUDY_STORAGE_KEY); }
  catch (error) { return { collection: emptyStudyCollection(), status: 'unavailable', error: `Could not read study storage: ${error instanceof Error ? error.message : 'Storage unavailable'}` }; }
  if (raw === null) return { collection: emptyStudyCollection(), status: 'empty', error: null };
  try { return { collection: parseStudyCollection(raw), status: 'ready', error: null }; }
  catch (error) { return { collection: emptyStudyCollection(), status: 'invalid', error: `Existing study storage was preserved: ${error instanceof Error ? error.message : 'Invalid bookmarks'}` }; }
}
/** Saving is explicit. A failure does not modify the in-memory collection or erase a corrupt/unknown stored version. */
export function saveStudyStorage(storage: StudyStorage, collection: StudyCollection): StudyStorageSave {
  try {
    const json = serializeStudyCollection(collection);
    const previous = storage.getItem(STUDY_STORAGE_KEY);
    if (previous !== null) {
      try { parseStudyCollection(previous); }
      catch { return { ok: false, error: 'Existing study storage is invalid or from an unsupported version and was preserved. Export your in-memory bookmarks before replacing browser storage.' }; }
    }
    storage.setItem(STUDY_STORAGE_KEY, json);
    return { ok: true, error: null };
  } catch (error) { return { ok: false, error: `Could not save study bookmarks; in-memory bookmarks remain usable: ${error instanceof Error ? error.message : 'Storage unavailable'}` }; }
}
