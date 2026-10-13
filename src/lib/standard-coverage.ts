import { HANDS, getPositions, type Position } from './poker';
import { replayPreflop, type PreflopAction } from './preflop';
import type { ReferenceRange } from './reference-ranges';
import { gameKey, historyKey, type TreeDataset, type TreeGame } from './tree-strategy';

export const STANDARD_KINDS = ['rfi', 'vs-open', 'vs-3bet', 'vs-4bet', 'vs-5bet', 'bb-vs-sb-limp', 'sb-limp-vs-bb-raise'] as const;
export type StandardKind = typeof STANDARD_KINDS[number];
export interface StandardCase { key: string; players: number; kind: StandardKind; hero: Position; villain: Position | null }
export interface StandardTreeSpot extends StandardCase {
  history: PreflopAction[];
  availableHands: number; unreachableHands: number; missingHands: number;
}
export type StandardTreeEntry = Pick<TreeDataset, 'id' | 'name' | 'game' | 'source'> & { standardSpots?: StandardTreeSpot[] };
export type StandardChannel = 'original' | 'projected' | 'computed' | 'unconverged' | 'imported' | 'demo' | 'unknown';
export interface StandardEvidence {
  channel: StandardChannel;
  datasetId?: string;
  chartId?: string;
  name: string;
  source: TreeDataset['source'] | ReferenceRange['source'];
  /** Each snapshot keeps its own conditions. Categories never combine into an exact strategy. */
  conditionKey: string;
  game?: TreeGame;
  history?: PreflopAction[];
  reference?: Pick<ReferenceRange, 'refId' | 'page' | 'precision' | 'provenance' | 'sourcePlayers' | 'stackBb' | 'actions' | 'notes'>;
  availableHands: number; unreachableHands: number; missingHands: number;
}
export interface StandardCoverageCase extends StandardCase { evidence: StandardEvidence[] }
export interface StandardCounts {
  total: number; readable: number; resolved: number; missing: number | null;
  /** Categories overlap; their sum is not a coverage total. */
  original: number; projected: number; computed: number; unconverged: number; imported: number; demo: number; unknown: number;
}
export interface StandardCoverage {
  scope: 'standard-single-opponent-100bb';
  complete: boolean;
  unknownTreeEntries: number;
  excludedConditionEntries: number;
  cases: StandardCoverageCase[];
  totals: StandardCounts;
  byPlayers: Array<{ players: number; counts: StandardCounts; byKind: Record<StandardKind, StandardCounts> }>;
}

export function standardCaseKey(spot: Pick<StandardCase, 'players' | 'kind' | 'hero' | 'villain'>): string {
  return `${spot.players}:${spot.kind}:${spot.hero}:${spot.villain ?? '-'}`;
}

/** A category catalogue, not a claim that every bet size, rake or strategy is covered. */
export function standardCases(players?: number): StandardCase[] {
  const tables = players === undefined ? [6, 7, 8, 9] : [players];
  return tables.flatMap(players => {
    if (!Number.isInteger(players) || players < 6 || players > 9) throw new Error('Standard coverage supports 6–9 seats.');
    const seats = getPositions(players);
    const result: StandardCase[] = [];
    const add = (kind: StandardKind, hero: Position, villain: Position | null) => {
      const spot = { players, kind, hero, villain }; result.push({ ...spot, key: standardCaseKey(spot) });
    };
    for (const hero of seats.slice(0, -1)) add('rfi', hero, null);
    for (let early = 0; early < seats.length - 1; early++) for (let late = early + 1; late < seats.length; late++) {
      add('vs-open', seats[late], seats[early]);
      add('vs-3bet', seats[early], seats[late]);
      add('vs-4bet', seats[late], seats[early]);
      add('vs-5bet', seats[early], seats[late]);
    }
    add('bb-vs-sb-limp', 'BB', 'SB'); add('sb-limp-vs-bb-raise', 'SB', 'BB');
    return result;
  });
}
const CATALOGUE = standardCases();
const CASES = new Map(CATALOGUE.map(spot => [spot.key, spot]));

/** Canonical full history: all uninvolved seats fold, without calls or squeeze players. */
export function standardHistory(spot: Pick<StandardCase, 'players' | 'kind' | 'hero' | 'villain'>, raiseToBb: readonly number[] = []): PreflopAction[] {
  if (!CASES.has(standardCaseKey(spot))) throw new Error('Not a standard single-opponent case.');
  const positions = getPositions(spot.players);
  const fold = (actor: Position): PreflopAction => ({ actor, type: 'fold' });
  const raise = (actor: Position, index: number): PreflopAction => ({ actor, type: 'raise', amountBb: raiseToBb[index] });
  if (spot.kind === 'rfi') return positions.slice(0, positions.indexOf(spot.hero)).map(fold);
  if (spot.kind === 'bb-vs-sb-limp' || spot.kind === 'sb-limp-vs-bb-raise') return [
    ...positions.slice(0, -2).map(fold), { actor: 'SB', type: 'call' },
    ...(spot.kind === 'sb-limp-vs-bb-raise' ? [raise('BB', 0)] : []),
  ];
  if (spot.kind === 'vs-open') return positions.slice(0, positions.indexOf(spot.hero)).map(actor => actor === spot.villain ? raise(actor, 0) : fold(actor));
  const opener = spot.kind === 'vs-4bet' ? spot.villain! : spot.hero;
  const responder = spot.kind === 'vs-4bet' ? spot.hero : spot.villain!;
  const history = positions.map(actor => actor === opener ? raise(actor, 0) : actor === responder ? raise(actor, 1) : fold(actor));
  if (spot.kind === 'vs-4bet' || spot.kind === 'vs-5bet') history.push(raise(opener, 2));
  if (spot.kind === 'vs-5bet') history.push(raise(responder, 3));
  return history;
}

function classify(game: TreeGame, history: readonly PreflopAction[], validated: boolean): StandardCase | null {
  if (game.players < 6 || game.players > 9 || !Number.isInteger(game.players) || history.length > game.players + 2) return null;
  const positions = getPositions(game.players);
  const voluntary = history.filter(action => action.type !== 'fold');
  const raises = voluntary.filter(action => action.type === 'raise');
  let kind: StandardKind, hero: Position | undefined, villain: Position | null;
  if (!voluntary.length) { kind = 'rfi'; hero = positions[history.length]; villain = null; }
  else if (voluntary[0].actor === 'SB' && voluntary[0].type === 'call' && voluntary.length <= 2) {
    kind = voluntary.length === 1 ? 'bb-vs-sb-limp' : 'sb-limp-vs-bb-raise';
    hero = voluntary.length === 1 ? 'BB' : 'SB'; villain = voluntary.length === 1 ? 'SB' : 'BB';
  } else {
    if (voluntary.length !== raises.length || raises.length < 1 || raises.length > 4) return null;
    kind = (['vs-open', 'vs-3bet', 'vs-4bet', 'vs-5bet'] as const)[raises.length - 1];
    hero = raises.length === 1 ? positions[history.length] : raises[raises.length % 2 === 0 ? 0 : 1].actor;
    villain = raises.length === 1 ? raises[0].actor : raises[raises.length % 2 === 0 ? 1 : 0].actor;
  }
  if (!hero) return null;
  const spot = CASES.get(standardCaseKey({ players: game.players, kind, hero, villain }));
  if (!spot || historyKey(standardHistory(spot, raises.map(action => action.amountBb!))) !== historyKey(history)) return null;
  if (!validated) {
    try { const state = replayPreflop(game, history); if (state.terminal || state.nextActor !== hero) return null; }
    catch { return null; }
  }
  return { ...spot };
}

export function classifyStandardHistory(game: TreeGame, history: readonly PreflopAction[]): StandardCase | null {
  return classify(game, history, false);
}

/** Call only after validateTreeDataset. Cached by the server's unchanged-file index. */
export function summarizeStandardSpots(dataset: TreeDataset): StandardTreeSpot[] {
  return dataset.nodes.flatMap(node => {
    // Most large-tree nodes fail the cheap shape test; no second replay is needed.
    const spot = classify(dataset.game, node.history, true);
    if (!spot) return [];
    let availableHands = 0, unreachableHands = 0, missingHands = 0;
    for (const hand of HANDS) {
      const row = node.hands[hand];
      if (row?.status === 'available') availableHands++;
      else if (row?.status === 'unreachable') unreachableHands++;
      else missingHands++;
    }
    return [{ ...spot, history: node.history.map(action => ({ ...action })), availableHands, unreachableHands, missingHands }];
  });
}

function inScope(game: TreeGame): boolean {
  return game.format === 'cash' && game.anteBb === 0 && getPositions(game.players).every(position => (game.stacksBb?.[position] ?? game.stackBb) === 100);
}
function counts(cases: StandardCoverageCase[], complete: boolean): StandardCounts {
  const readable = (entry: StandardCoverageCase) => entry.evidence.filter(item => item.availableHands > 0 && item.channel !== 'demo');
  const result: StandardCounts = { total: cases.length, readable: 0, resolved: 0, missing: null, original: 0, projected: 0, computed: 0, unconverged: 0, imported: 0, demo: 0, unknown: 0 };
  for (const entry of cases) {
    const found = readable(entry);
    if (found.length) result.readable++;
    // One source must resolve the whole grid; never fill source A's holes using B.
    if (found.some(item => item.missingHands === 0)) result.resolved++;
    for (const channel of ['original', 'projected', 'computed', 'unconverged', 'imported', 'demo', 'unknown'] as const) {
      if (entry.evidence.some(item => item.channel === channel && item.availableHands > 0)) result[channel]++;
    }
  }
  if (complete) result.missing = result.total - result.readable;
  return result;
}

/** Source availability by category, retaining every source/condition/history separately. */
export function buildStandardCoverage(input: { references: readonly ReferenceRange[] | null; treeLibrary: readonly StandardTreeEntry[] | null; incomplete?: boolean }): StandardCoverage {
  const cases = CATALOGUE.map(spot => ({ ...spot, evidence: [] as StandardEvidence[] }));
  const indexed = new Map(cases.map(spot => [spot.key, spot]));
  let unknownTreeEntries = 0, excludedConditionEntries = 0;
  for (const node of input.references ?? []) {
    if (node.stackBb !== 100) { excludedConditionEntries++; continue; }
    const kind = node.kind === 'vs-limp' ? 'bb-vs-sb-limp' : node.kind;
    const target = indexed.get(standardCaseKey({ ...node, kind }));
    if (!target) continue;
    const availableHands = HANDS.filter(hand => node.hands[hand]?.status === 'available').length;
    const reference = { refId: node.refId, page: node.page, precision: node.precision, provenance: node.provenance, sourcePlayers: node.sourcePlayers, stackBb: node.stackBb, actions: node.actions, notes: node.notes };
    const conditionKey = JSON.stringify(['reference-conditions-not-established', node.players, node.source, reference]);
    if (target.evidence.some(item => item.chartId === node.id && item.conditionKey === conditionKey)) continue;
    target.evidence.push({ channel: node.provenance === 'seat-projection' ? 'projected' : 'original', chartId: node.id, name: node.source.name,
      source: node.source, conditionKey, reference, availableHands, unreachableHands: 0, missingHands: 169 - availableHands });
  }
  for (const entry of input.treeLibrary ?? []) {
    if (!inScope(entry.game)) { excludedConditionEntries++; continue; }
    if (!entry.standardSpots) { unknownTreeEntries++; continue; }
    const channel: StandardChannel = entry.source.kind === 'computed'
      ? entry.source.computation?.status === 'approximate' ? 'computed' : entry.source.computation?.status === 'unconverged' ? 'unconverged' : 'unknown'
      : entry.source.kind;
    for (const spot of entry.standardSpots) {
      const target = indexed.get(spot.key);
      if (!target || spot.players !== entry.game.players || spot.key !== standardCaseKey(spot)) continue;
      const conditionKey = JSON.stringify([gameKey(entry.game), entry.source, historyKey(spot.history)]);
      // Identical shards may repeat metadata, but unrelated sources remain visible.
      if (target.evidence.some(item => item.conditionKey === conditionKey && item.datasetId === entry.id)) continue;
      target.evidence.push({ channel, datasetId: entry.id, name: entry.name, source: entry.source, conditionKey,
        game: entry.game, history: spot.history, availableHands: spot.availableHands, unreachableHands: spot.unreachableHands, missingHands: spot.missingHands });
    }
  }
  const complete = input.references !== null && input.treeLibrary !== null && !unknownTreeEntries && !input.incomplete;
  return { scope: 'standard-single-opponent-100bb', complete, unknownTreeEntries, excludedConditionEntries, cases, totals: counts(cases, complete),
    byPlayers: [6, 7, 8, 9].map(players => {
      const rows = cases.filter(spot => spot.players === players);
      return { players, counts: counts(rows, complete), byKind: Object.fromEntries(STANDARD_KINDS.map(kind => [kind, counts(rows.filter(spot => spot.kind === kind), complete)])) as Record<StandardKind, StandardCounts> };
    }),
  };
}
