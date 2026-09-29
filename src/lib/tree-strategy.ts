import { HANDS, comboCount, getPositions, type Dataset, type Position } from './poker';
import { replayPreflop, type PreflopAction, type PreflopConfig } from './preflop';

export type TreeGame = PreflopConfig & { format: 'cash'; rake: string };
export type StrategyChoice = Omit<PreflopAction, 'actor'> & { id: string };
export type HandStrategy =
  | { status: 'available'; reach: number; frequencies: Record<string, number> }
  | { status: 'unreachable'; reach: 0 }
  | { status: 'missing' };
export interface TreeNode {
  id: string;
  history: PreflopAction[];
  actions: StrategyChoice[];
  hands: Record<string, HandStrategy>;
}
export interface TreeDataset {
  schemaVersion: 2;
  id: string;
  name: string;
  source: Dataset['source'] & { precision: string };
  game: TreeGame;
  nodes: TreeNode[];
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} must be a nonempty string.`);
  return value;
}
function number(value: unknown, path: string, min = 0, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${path} must be a finite number between ${min} and ${max}.`);
  return value;
}
function chips(value: unknown, path: string, min = 0): number {
  const amount = number(value, path, min);
  if (amount !== Number(amount.toFixed(9))) throw new Error(`${path}: BB amounts support at most 9 decimal places.`);
  return amount;
}
function action(value: unknown, path: string): Omit<PreflopAction, 'actor'> {
  const raw = object(value, path);
  if (!['fold', 'check', 'call', 'raise'].includes(raw.type as string)) throw new Error(`${path}.type must be fold, check, call or raise.`);
  if (raw.type === 'raise') return { type: 'raise', amountBb: chips(raw.amountBb, `${path}.amountBb`, Number.MIN_VALUE) };
  if (raw.amountBb !== undefined) throw new Error(`${path}: only Raise has amountBb; Call uses the amount owed.`);
  return { type: raw.type as 'fold' | 'check' | 'call' };
}

export function gameKey(game: TreeGame): string {
  return JSON.stringify([game.format, game.anteBb, game.rake, getPositions(game.players).map(position => [position, game.stacksBb?.[position] ?? game.stackBb])]);
}
export function historyKey(history: readonly PreflopAction[]): string {
  return JSON.stringify(history.map(item => [item.actor, item.type, item.type === 'raise' ? item.amountBb : null]));
}

/** Import validation establishes legal structure, never solver accuracy. */
export function validateTreeDataset(value: unknown): TreeDataset {
  const raw = object(value, 'Dataset');
  if (raw.schemaVersion !== 2) throw new Error('Full action-history files require schemaVersion 2.');
  const id = text(raw.id, 'id');
  const name = text(raw.name, 'name');
  const source = object(raw.source, 'source');
  const url = text(source.url, 'source.url');
  try { if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error(); } catch { throw new Error('source.url must be an http or https URL.'); }
  const retrievedAt = text(source.retrievedAt, 'source.retrievedAt');
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(retrievedAt) || !Number.isFinite(Date.parse(retrievedAt))) throw new Error('source.retrievedAt must be an ISO date.');
  if (source.kind !== 'demo' && source.kind !== 'imported') throw new Error('source.kind must be demo or imported.');
  const rawGame = object(raw.game, 'game');
  if (rawGame.format !== 'cash') throw new Error('schema v2 currently supports Cash only.');
  const players = number(rawGame.players, 'game.players', 6, 9);
  const positions = getPositions(players);
  const game: TreeGame = { players, stackBb: chips(rawGame.stackBb, 'game.stackBb', Number.MIN_VALUE), anteBb: chips(rawGame.anteBb, 'game.anteBb'), format: 'cash', rake: text(rawGame.rake, 'game.rake') };
  if (rawGame.stacksBb !== undefined) {
    const stacks = object(rawGame.stacksBb, 'game.stacksBb');
    if (Object.keys(stacks).some(position => !positions.includes(position as Position))) throw new Error('game.stacksBb contains an invalid seat.');
    game.stacksBb = Object.fromEntries(Object.entries(stacks).map(([position, stack]) => [position, chips(stack, `game.stacksBb.${position}`, Number.MIN_VALUE)]));
  }
  replayPreflop(game, []);
  if (!Array.isArray(raw.nodes) || !raw.nodes.length || raw.nodes.length > 10000) throw new Error('nodes must contain 1 to 10000 decision nodes.');
  const ids = new Set<string>();
  const histories = new Set<string>();
  const nodes = raw.nodes.map((value, index): TreeNode => {
    const path = `nodes[${index}]`;
    const node = object(value, path);
    const nodeId = text(node.id, `${path}.id`);
    if (ids.has(nodeId)) throw new Error(`${path}: duplicate node id.`);
    ids.add(nodeId);
    if (!Array.isArray(node.history) || node.history.length > 200) throw new Error(`${path}.history must contain at most 200 actions.`);
    const history = node.history.map((entry, actionIndex): PreflopAction => {
      const rawAction = object(entry, `${path}.history[${actionIndex}]`);
      if (!positions.includes(rawAction.actor as Position)) throw new Error(`${path}: invalid history actor.`);
      return { actor: rawAction.actor as Position, ...action(rawAction, `${path}.history[${actionIndex}]`) };
    });
    const key = historyKey(history);
    if (histories.has(key)) throw new Error(`${path}: duplicate exact action history.`);
    histories.add(key);
    const state = replayPreflop(game, history);
    if (!state.nextActor || state.terminal) throw new Error(`${path}: a terminal hand has no preflop decision.`);
    if (!Array.isArray(node.actions) || !node.actions.length || node.actions.length > 30) throw new Error(`${path}.actions must contain 1 to 30 choices.`);
    const actionIds = new Set<string>();
    const actionKeys = new Set<string>();
    const actions = node.actions.map((entry, choiceIndex): StrategyChoice => {
      const rawChoice = object(entry, `${path}.actions[${choiceIndex}]`);
      const choiceId = text(rawChoice.id, `${path}.actions[${choiceIndex}].id`);
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(choiceId) || ['constructor', 'prototype', '__proto__'].includes(choiceId) || actionIds.has(choiceId)) throw new Error(`${path}: action IDs must be unique safe identifiers.`);
      const choice = action(rawChoice, `${path}.actions[${choiceIndex}]`);
      const choiceKey = JSON.stringify(choice);
      if (actionKeys.has(choiceKey)) throw new Error(`${path}: duplicate action or raise size.`);
      actionIds.add(choiceId); actionKeys.add(choiceKey);
      replayPreflop(game, [...history, { actor: state.nextActor!, ...choice }]);
      return { id: choiceId, ...choice };
    });
    const rawHands = object(node.hands, `${path}.hands`);
    if (Object.keys(rawHands).length !== 169 || HANDS.some(hand => !Object.hasOwn(rawHands, hand))) throw new Error(`${path}.hands must explicitly cover all 169 hand classes.`);
    const hands = Object.fromEntries(HANDS.map((hand): [string, HandStrategy] => {
      const row = object(rawHands[hand], `${path}.hands.${hand}`);
      if (row.status === 'missing') {
        if (row.frequencies !== undefined || row.reach !== undefined) throw new Error(`${path}.${hand}: missing data cannot carry a reach or strategy.`);
        return [hand, { status: 'missing' }];
      }
      if (row.status === 'unreachable') {
        if (row.reach !== 0 || row.frequencies !== undefined) throw new Error(`${path}.${hand}: unreachable requires reach 0 and no frequencies.`);
        return [hand, { status: 'unreachable', reach: 0 }];
      }
      if (row.status !== 'available') throw new Error(`${path}.${hand}: status must be available, unreachable or missing.`);
      const reach = number(row.reach, `${path}.${hand}.reach`, Number.MIN_VALUE, 1);
      const rawFrequencies = object(row.frequencies, `${path}.${hand}.frequencies`);
      if (Object.keys(rawFrequencies).length !== actionIds.size || [...actionIds].some(id => !Object.hasOwn(rawFrequencies, id))) throw new Error(`${path}.${hand}: frequencies must contain exactly the node's action IDs.`);
      const frequencies = Object.fromEntries([...actionIds].map(id => [id, number(rawFrequencies[id], `${path}.${hand}.${id}`, 0, 1)]));
      if (Math.abs(Object.values(frequencies).reduce((sum, frequency) => sum + frequency, 0) - 1) > 1e-6) throw new Error(`${path}.${hand}: conditional action frequencies must sum to 1.`);
      return [hand, { status: 'available', reach, frequencies }];
    }));
    return { id: nodeId, history, actions, hands };
  });
  return { schemaVersion: 2, id, name, game, nodes, source: { name: text(source.name, 'source.name'), url, license: text(source.license, 'source.license'), retrievedAt, kind: source.kind, precision: text(source.precision, 'source.precision') } };
}

export function findTreeNode(dataset: TreeDataset, game: TreeGame, history: readonly PreflopAction[]): TreeNode | undefined {
  if (gameKey(dataset.game) !== gameKey(game)) return undefined;
  const key = historyKey(history);
  return dataset.nodes.find(node => historyKey(node.history) === key);
}

/** Never summarize a partial range as though it were complete. */
export function treeRangeSummary(node: TreeNode): Record<string, number> | null {
  if (HANDS.some(hand => node.hands[hand].status === 'missing')) return null;
  const result = Object.fromEntries(node.actions.map(action => [action.id, 0]));
  let total = 0;
  for (const hand of HANDS) {
    const row = node.hands[hand];
    if (row.status !== 'available') continue;
    const weight = comboCount(hand) * row.reach;
    total += weight;
    for (const choice of node.actions) result[choice.id] += weight * row.frequencies[choice.id];
  }
  return total > 0 ? Object.fromEntries(Object.entries(result).map(([id, frequency]) => [id, frequency / total])) : null;
}

export function createTreeTemplate(game: TreeGame, history: PreflopAction[]): TreeDataset {
  const state = replayPreflop(game, history);
  if (!state.nextActor) throw new Error('Choose an unfinished hand to export a decision template.');
  const actions: StrategyChoice[] = [];
  if (state.legal.fold) actions.push({ id: 'fold', type: 'fold' });
  if (state.legal.check) actions.push({ id: 'check', type: 'check' });
  if (state.legal.call) actions.push({ id: 'call', type: 'call' });
  if (state.legal.raise) actions.push({ id: 'raise_min', type: 'raise', amountBb: state.legal.minRaiseToBb });
  return validateTreeDataset({ schemaVersion: 2, id: 'empty-action-tree-template', name: 'Empty template — no strategy', source: { kind: 'demo', name: 'GTO Reminder empty template', url: 'https://github.com/Ruoyu-Tianyi/GTO_Reminder', license: 'Replace with the source and usage terms of your strategy.', retrievedAt: new Date().toISOString().slice(0, 10), precision: 'No frequencies supplied' }, game, nodes: [{ id: 'decision-1', history, actions, hands: Object.fromEntries(HANDS.map(hand => [hand, { status: 'missing' }])) }] });
}
