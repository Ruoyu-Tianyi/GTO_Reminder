/** Preflop lookup utilities. This module never invents or interpolates strategy. */
export const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'] as const;

export const HANDS: string[] = RANKS.flatMap((row, rowIndex) =>
  RANKS.map((column, columnIndex) =>
    rowIndex === columnIndex ? `${row}${column}`
      : rowIndex < columnIndex ? `${row}${column}s` : `${column}${row}o`,
  ),
);

export type Position = 'UTG' | 'UTG+1' | 'UTG+2' | 'LJ' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';
export type SpotKind = 'rfi' | 'vs-open' | 'vs-3bet' | 'vs-4bet';
export type ActionKey = 'raise' | 'call' | 'fold';
export type Frequencies = Record<ActionKey, number>;

export interface Spot {
  players: number;
  hero: Position;
  villain: Position | null;
  stackBb: number;
  kind: SpotKind;
  openSizeBb: number;
  threeBetSizeBb: number;
  fourBetSizeBb: number;
  format: 'cash' | 'mtt';
  anteBb: number;
  rake: string;
}

export interface StrategyNode {
  id: string;
  spot: Spot;
  frequencies: Record<string, Frequencies>;
}

export interface Dataset {
  schemaVersion: 1;
  id: string;
  name: string;
  source: {
    name: string;
    url: string;
    license: string;
    retrievedAt: string;
    kind: 'demo' | 'imported';
  };
  nodes: StrategyNode[];
}

const POSITION_SETS: Record<number, Position[]> = {
  2: ['SB', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['CO', 'BTN', 'SB', 'BB'],
  5: ['HJ', 'CO', 'BTN', 'SB', 'BB'],
  6: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  7: ['UTG', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  8: ['UTG', 'UTG+1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  9: ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
};

/** Preflop action order. Heads-up SB is also the dealer / BTN. */
export function getPositions(players: number): Position[] {
  const positions = POSITION_SETS[players];
  if (!Number.isInteger(players) || !positions) throw new Error('Players must be an integer from 2 to 9.');
  return [...positions];
}

/** Only unopened / heads-up single-raiser lines are represented by this schema. */
export function getVillains(players: number, hero: Position, kind: SpotKind): Position[] {
  const positions = getPositions(players);
  const heroIndex = positions.indexOf(hero);
  if (heroIndex < 0 || kind === 'rfi') return [];
  return kind === 'vs-3bet' ? positions.slice(heroIndex + 1) : positions.slice(0, heroIndex);
}

/** Convert hand classes or two explicit cards to a canonical 169-grid label. */
export function normalizeHand(input: string): string | null {
  const value = input.trim().toUpperCase().replace(/\s/g, '').replace(/10/g, 'T')
    .replace(/♠/g, 'S').replace(/♥/g, 'H').replace(/♦/g, 'D').replace(/♣/g, 'C');
  const cards = /^([AKQJT2-9])([SHDC])([AKQJT2-9])([SHDC])$/.exec(value);
  if (cards) {
    const [, rankA, suitA, rankB, suitB] = cards;
    if (rankA === rankB && suitA === suitB) return null;
    if (rankA === rankB) return `${rankA}${rankB}`;
    const ranks = [rankA, rankB].sort((a, b) => RANKS.indexOf(a as typeof RANKS[number]) - RANKS.indexOf(b as typeof RANKS[number]));
    return `${ranks.join('')}${suitA === suitB ? 's' : 'o'}`;
  }
  const handClass = /^([AKQJT2-9])([AKQJT2-9])([SO]?)$/.exec(value);
  if (!handClass) return null;
  const [, first, second, suffix] = handClass;
  if (first === second) return suffix ? null : `${first}${second}`;
  if (!suffix) return null;
  const ranks = [first, second].sort((a, b) => RANKS.indexOf(a as typeof RANKS[number]) - RANKS.indexOf(b as typeof RANKS[number]));
  return `${ranks.join('')}${suffix.toLowerCase()}`;
}

/** Number of unblocked two-card combinations in a hand class. */
export function comboCount(hand: string): number {
  const canonical = normalizeHand(hand);
  if (!canonical) throw new Error(`Invalid hand: ${hand}`);
  return canonical.length === 2 ? 6 : canonical.endsWith('s') ? 4 : 12;
}

const SPOT_FIELDS = ['players', 'hero', 'villain', 'stackBb', 'kind', 'openSizeBb', 'threeBetSizeBb', 'fourBetSizeBb', 'format', 'anteBb', 'rake'] as const;

/** Every field must match; a nearby stack, sizing, or rake is not a solution. */
export function findNode(dataset: Dataset, spot: Spot): StrategyNode | undefined {
  return dataset.nodes.find((node) => SPOT_FIELDS.every((field) => node.spot[field] === spot[field]));
}

/** Fraction of all 1,326 unblocked combinations, not an unweighted grid average. */
export function rangeSummary(node: StrategyNode): Frequencies {
  const result = { raise: 0, call: 0, fold: 0 };
  for (const hand of HANDS) {
    const combinations = comboCount(hand);
    for (const action of ['raise', 'call', 'fold'] as const) result[action] += node.frequencies[hand][action] * combinations;
  }
  for (const action of ['raise', 'call', 'fold'] as const) result[action] = result[action] / 1326;
  return result;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${path} must be an object.`);
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${path} must be a nonempty string.`);
  return value;
}

function finiteNumber(value: unknown, path: string, min: number, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${path} must be a finite number from ${min} to ${max === Infinity ? 'Infinity' : max}.`);
  }
  return value;
}

function validateSpot(value: unknown, path: string): Spot {
  const raw = record(value, path);
  const players = finiteNumber(raw.players, `${path}.players`, 2, 9);
  const positions = getPositions(players);
  if (!positions.includes(raw.hero as Position)) throw new Error(`${path}.hero is not a position at a ${players}-player table.`);
  const hero = raw.hero as Position;
  const kind = raw.kind as SpotKind;
  if (!['rfi', 'vs-open', 'vs-3bet', 'vs-4bet'].includes(kind)) throw new Error(`${path}.kind is not supported.`);
  const villain = raw.villain as Position | null;
  if (kind === 'rfi') {
    if (villain !== null) throw new Error(`${path}.villain must be null for rfi.`);
    if (hero === 'BB') throw new Error(`${path}: BB cannot Raise First In; a limped pot requires a different action tree.`);
  } else if (villain === null || !getVillains(players, hero, kind).includes(villain)) {
    throw new Error(`${path}.villain is not valid for ${hero} ${kind} in preflop action order.`);
  }
  const stackBb = finiteNumber(raw.stackBb, `${path}.stackBb`, 1);
  // Future sizes are identifiers/placeholders until they occur in the action line.
  // Keep them finite and positive, but do not require an impossible future raise
  // after an all-in, or reject a short-stack node due to an unused default size.
  const openSizeBb = finiteNumber(raw.openSizeBb, `${path}.openSizeBb`, 0);
  const threeBetSizeBb = finiteNumber(raw.threeBetSizeBb, `${path}.threeBetSizeBb`, 0);
  const fourBetSizeBb = finiteNumber(raw.fourBetSizeBb, `${path}.fourBetSizeBb`, 0);
  if (openSizeBb === 0 || threeBetSizeBb === 0 || fourBetSizeBb === 0) throw new Error(`${path}: sizing fields must be positive numbers.`);
  if (raw.format !== 'cash' && raw.format !== 'mtt') throw new Error(`${path}.format must be cash or mtt.`);
  const anteBb = finiteNumber(raw.anteBb, `${path}.anteBb`, 0);
  const rake = requiredText(raw.rake, `${path}.rake`);
  return { players, hero, villain, stackBb, kind, openSizeBb, threeBetSizeBb, fourBetSizeBb, format: raw.format, anteBb, rake };
}

function validateActionSizes(spot: Spot, hasRaise: boolean, path: string): void {
  function checkRaise(field: 'openSizeBb' | 'threeBetSizeBb' | 'fourBetSizeBb', previousBet: number, previousIncrement: number) {
    const size = spot[field];
    if (size > spot.stackBb) throw new Error(`${path}.${field} exceeds the effective stack for an action in this node.`);
    if (size <= previousBet) throw new Error(`${path}.${field} must exceed the previous bet of ${previousBet} BB.`);
    if (size < previousBet + previousIncrement && size !== spot.stackBb) {
      throw new Error(`${path}.${field} is below the minimum full raise and is not all-in.`);
    }
  }
  // Validate observed history, plus Hero's Raise size only when any hand raises.
  if (spot.kind !== 'rfi' || hasRaise) checkRaise('openSizeBb', 1, 1);
  if (spot.kind === 'vs-3bet' || spot.kind === 'vs-4bet' || (spot.kind === 'vs-open' && hasRaise)) {
    checkRaise('threeBetSizeBb', spot.openSizeBb, spot.openSizeBb - 1);
  }
  if (spot.kind === 'vs-4bet' || (spot.kind === 'vs-3bet' && hasRaise)) {
    checkRaise('fourBetSizeBb', spot.threeBetSizeBb, spot.threeBetSizeBb - spot.openSizeBb);
  }
}

/** Validate structure and action-tree consistency, never solver quality or license rights. */
export function validateDataset(value: unknown): Dataset {
  const raw = record(value, 'Dataset');
  if (raw.schemaVersion !== 1) throw new Error('schemaVersion must be 1.');
  const id = requiredText(raw.id, 'id');
  const name = requiredText(raw.name, 'name');
  const rawSource = record(raw.source, 'source');
  const sourceName = requiredText(rawSource.name, 'source.name');
  const url = requiredText(rawSource.url, 'source.url');
  try {
    if (!['https:', 'http:'].includes(new URL(url).protocol)) throw new Error();
  } catch { throw new Error('source.url must be a valid http or https URL.'); }
  const license = requiredText(rawSource.license, 'source.license');
  const retrievedAt = requiredText(rawSource.retrievedAt, 'source.retrievedAt');
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(retrievedAt) || !Number.isFinite(Date.parse(retrievedAt))) {
    throw new Error('source.retrievedAt must be an ISO date or timestamp.');
  }
  if (rawSource.kind !== 'demo' && rawSource.kind !== 'imported') throw new Error('source.kind must be demo or imported.');
  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) throw new Error('nodes must be a nonempty array.');
  const nodeIds = new Set<string>();
  const spotKeys = new Set<string>();
  const nodes = raw.nodes.map((value, index): StrategyNode => {
    const path = `nodes[${index}]`;
    const node = record(value, path);
    const nodeId = requiredText(node.id, `${path}.id`);
    if (nodeIds.has(nodeId)) throw new Error(`${path}.id duplicates ${nodeId}.`);
    nodeIds.add(nodeId);
    const spot = validateSpot(node.spot, `${path}.spot`);
    const spotKey = JSON.stringify(SPOT_FIELDS.map((field) => spot[field]));
    if (spotKeys.has(spotKey)) throw new Error(`${path}.spot duplicates an existing exact spot.`);
    spotKeys.add(spotKey);
    const rawFrequencies = record(node.frequencies, `${path}.frequencies`);
    const keys = Object.keys(rawFrequencies);
    if (keys.length !== HANDS.length || HANDS.some((hand) => !Object.hasOwn(rawFrequencies, hand))) {
      throw new Error(`${path}.frequencies must cover exactly the 169 canonical hand classes.`);
    }
    const frequencies: Record<string, Frequencies> = {};
    for (const hand of HANDS) {
      const handPath = `${path}.frequencies.${hand}`;
      const row = record(rawFrequencies[hand], handPath);
      if (Object.keys(row).length !== 3 || !['raise', 'call', 'fold'].every((action) => Object.hasOwn(row, action))) {
        throw new Error(`${handPath} must contain exactly raise, call, and fold.`);
      }
      const raise = finiteNumber(row.raise, `${handPath}.raise`, 0, 1);
      const call = finiteNumber(row.call, `${handPath}.call`, 0, 1);
      const fold = finiteNumber(row.fold, `${handPath}.fold`, 0, 1);
      if (Math.abs(raise + call + fold - 1) > 1e-6) throw new Error(`${handPath} frequencies must sum to 1 (tolerance 0.000001).`);
      if (spot.kind === 'rfi' && call !== 0) throw new Error(`${handPath}: rfi does not support Call / limp.`);
      const facedSize = spot.kind === 'vs-open' ? spot.openSizeBb : spot.kind === 'vs-3bet' ? spot.threeBetSizeBb : spot.kind === 'vs-4bet' ? spot.fourBetSizeBb : 0;
      if (facedSize === spot.stackBb && raise !== 0) throw new Error(`${handPath}: Raise is unavailable when facing an all-in.`);
      frequencies[hand] = { raise, call, fold };
    }
    validateActionSizes(spot, HANDS.some((hand) => frequencies[hand].raise > 0), `${path}.spot`);
    return { id: nodeId, spot, frequencies };
  });
  return { schemaVersion: 1, id, name, source: { name: sourceName, url, license, retrievedAt, kind: rawSource.kind }, nodes };
}
