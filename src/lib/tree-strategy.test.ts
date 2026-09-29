import { describe, expect, it } from 'vitest';
import { HANDS, getPositions } from './poker';
import { replayPreflop, type PreflopAction } from './preflop';
import {
  createTreeTemplate, findTreeNode, gameKey, historyKey, treeRangeSummary, validateTreeDataset,
  type HandStrategy, type StrategyChoice, type TreeDataset, type TreeGame, type TreeNode,
} from './tree-strategy';

// Synthetic fixtures test the file contract and arithmetic only. They are NOT
// solver output, poker advice, or realistic strategic frequencies.
const GAME: TreeGame = { players: 6, stackBb: 100, anteBb: 0, format: 'cash', rake: 'none' };
const CHOICES: StrategyChoice[] = [
  { id: 'fold', type: 'fold' },
  { id: 'call', type: 'call' },
  { id: 'raise_small', type: 'raise', amountBb: 2.5 },
  { id: 'raise_large', type: 'raise', amountBb: 3 },
];

function missingNode(id: string, history: PreflopAction[], actions = CHOICES): TreeNode {
  return {
    id, history: structuredClone(history), actions: structuredClone(actions),
    hands: Object.fromEntries(HANDS.map(hand => [hand, { status: 'missing' } as HandStrategy])),
  };
}

function fixture(): TreeDataset {
  const node = missingNode('synthetic-btn', [
    { actor: 'UTG', type: 'fold' }, { actor: 'HJ', type: 'fold' }, { actor: 'CO', type: 'fold' },
  ]);
  node.hands.AA = { status: 'available', reach: 0.5, frequencies: { fold: 0.1, call: 0.2, raise_small: 0.3, raise_large: 0.4 } };
  node.hands.KK = { status: 'unreachable', reach: 0 };
  return {
    schemaVersion: 2, id: 'synthetic-test-only', name: 'Synthetic contract fixture, not solver output',
    source: { name: 'Synthetic test fixture', url: 'https://example.com/synthetic-test-fixture', license: 'Tests only; no poker use', retrievedAt: '2026-09-29', kind: 'demo', precision: 'Synthetic exact test values' },
    game: structuredClone(GAME), nodes: [node],
  };
}

function availableAA(data: TreeDataset): Extract<HandStrategy, { status: 'available' }> {
  const row = data.nodes[0].hands.AA;
  if (row.status !== 'available') throw new Error('Invalid synthetic fixture');
  return row;
}

describe('schema v2 full-history matching', () => {
  it.each(['game', 'history', 'choice'])('rejects %s amounts that collapse into another key at engine precision', field => {
    const raw = fixture();
    if (field === 'game') raw.game.stackBb = 100.0000000001;
    if (field === 'history') raw.nodes[0].history[0] = { actor: 'UTG', type: 'raise', amountBb: 2.5000000001 };
    if (field === 'choice') raw.nodes[0].actions[2].amountBb = 2.5000000001;
    expect(() => validateTreeDataset(raw)).toThrow(/9 decimal places/);
  });

  it('preserves distinct supported nine-decimal raise amounts', () => {
    const raw = fixture();
    raw.nodes[0].actions[2].amountBb = 2.500000001;
    expect(validateTreeDataset(raw).nodes[0].actions[2].amountBb).toBe(2.500000001);
  });

  it('preserves the exact history and the separate states available, unreachable and missing', () => {
    const raw = fixture();
    const validated = validateTreeDataset(raw);
    expect(validated).toEqual(raw);
    expect(validated.source.kind).toBe('demo');
    expect(validated.name).toContain('not solver output');
    expect(validated.nodes[0].hands.AA.status).toBe('available');
    expect(validated.nodes[0].hands.KK).toEqual({ status: 'unreachable', reach: 0 });
    expect(validated.nodes[0].hands.QQ).toEqual({ status: 'missing' });
    expect(findTreeNode(validated, structuredClone(GAME), structuredClone(validated.nodes[0].history))).toBe(validated.nodes[0]);
  });

  it('does not match a limp/caller history merely because the same seat acts next', () => {
    const data = validateTreeDataset(fixture());
    const other = structuredClone(data.nodes[0].history);
    other[2] = { actor: 'CO', type: 'call' };
    expect(replayPreflop(GAME, other).nextActor).toBe('BTN');
    expect(replayPreflop(GAME, data.nodes[0].history).nextActor).toBe('BTN');
    expect(historyKey(other)).not.toBe(historyKey(data.nodes[0].history));
    expect(findTreeNode(data, GAME, other)).toBeUndefined();
  });

  it('keeps earlier raise sizes as distinct nodes instead of choosing a nearby sizing', () => {
    const raw = fixture();
    const responseChoices: StrategyChoice[] = [{ id: 'fold', type: 'fold' }, { id: 'call', type: 'call' }];
    raw.nodes = [
      missingNode('open-2_5', [{ actor: 'UTG', type: 'raise', amountBb: 2.5 }], responseChoices),
      missingNode('open-3', [{ actor: 'UTG', type: 'raise', amountBb: 3 }], responseChoices),
    ];
    const data = validateTreeDataset(raw);
    for (const node of data.nodes) expect(findTreeNode(data, GAME, node.history)).toBe(node);
    expect(findTreeNode(data, GAME, [{ actor: 'UTG', type: 'raise', amountBb: 2.75 }])).toBeUndefined();
  });

  it.each([
    ['players', { players: 7 }], ['default stack', { stackBb: 99 }],
    ['ante', { anteBb: 0.1 }], ['rake', { rake: '5% capped at 2.5 BB' }],
    ['individual stack', { stacksBb: { SB: 70 } }],
  ])('requires the same %s context', (_label, change) => {
    const data = validateTreeDataset(fixture());
    expect(findTreeNode(data, { ...GAME, ...change }, data.nodes[0].history)).toBeUndefined();
  });

  it('keys actual seat stacks independent of override order and redundant default values', () => {
    const data = validateTreeDataset(fixture());
    const sameStacks = Object.fromEntries(getPositions(6).reverse().map(position => [position, 100]));
    const equivalent = { ...GAME, stackBb: 200, stacksBb: sameStacks };
    expect(gameKey(equivalent)).toBe(gameKey(GAME));
    expect(findTreeNode(data, equivalent, data.nodes[0].history)).toBe(data.nodes[0]);
    expect(gameKey({ ...GAME, stacksBb: { BTN: 50, BB: 100 } })).not.toBe(gameKey({ ...GAME, stacksBb: { BTN: 100, BB: 50 } }));
  });

  it('separates multiple raise choices and retains their individual frequencies', () => {
    const data = validateTreeDataset(fixture());
    expect(data.nodes[0].actions.filter(action => action.type === 'raise')).toEqual([
      { id: 'raise_small', type: 'raise', amountBb: 2.5 },
      { id: 'raise_large', type: 'raise', amountBb: 3 },
    ]);
    expect(availableAA(data).frequencies).toEqual({ fold: 0.1, call: 0.2, raise_small: 0.3, raise_large: 0.4 });
  });
});

describe('schema v2 import rejects ambiguous or unsafe strategy data', () => {
  it('requires exactly all 169 canonical hand classes even when some are missing', () => {
    const missing = fixture();
    delete missing.nodes[0].hands.QQ;
    expect(() => validateTreeDataset(missing)).toThrow(/169/);
    const renamed = fixture();
    renamed.nodes[0].hands.KAs = renamed.nodes[0].hands.AKs;
    delete renamed.nodes[0].hands.AKs;
    expect(() => validateTreeDataset(renamed)).toThrow(/169/);
    const extra = fixture();
    extra.nodes[0].hands.Joker = { status: 'missing' };
    expect(() => validateTreeDataset(extra)).toThrow(/169/);
  });

  it.each([NaN, Infinity, -0.1, 1.1, 100])('rejects invalid conditional frequency %s', frequency => {
    const raw = fixture();
    availableAA(raw).frequencies.raise_small = frequency;
    expect(() => validateTreeDataset(raw)).toThrow(/finite number/);
  });

  it('requires probabilities to sum to one and match exactly the choice IDs', () => {
    const badSum = fixture();
    availableAA(badSum).frequencies.raise_small = 0.2;
    expect(() => validateTreeDataset(badSum)).toThrow(/sum to 1/);
    const missingAction = fixture();
    delete availableAA(missingAction).frequencies.call;
    expect(() => validateTreeDataset(missingAction)).toThrow(/exactly/);
    const unknownAction = fixture();
    availableAA(unknownAction).frequencies.raise = 0;
    expect(() => validateTreeDataset(unknownAction)).toThrow(/exactly/);
  });

  it.each([0, -0.1, 1.01, NaN, Infinity])('requires positive finite available reach at most one: %s', reach => {
    const raw = fixture();
    availableAA(raw).reach = reach;
    expect(() => validateTreeDataset(raw)).toThrow(/reach/);
  });

  it('does not allow missing or unreachable to hide a supplied strategy', () => {
    const missing = fixture();
    Object.assign(missing.nodes[0].hands.QQ, { reach: 0 });
    expect(() => validateTreeDataset(missing)).toThrow(/missing data/);
    const unreachable = fixture();
    Object.assign(unreachable.nodes[0].hands.KK, { frequencies: { fold: 1 } });
    expect(() => validateTreeDataset(unreachable)).toThrow(/unreachable/);
    const nonzero = fixture();
    Object.assign(nonzero.nodes[0].hands.KK, { reach: 0.1 });
    expect(() => validateTreeDataset(nonzero)).toThrow(/unreachable/);
  });

  it.each([1.5, 101, 0, NaN, Infinity])('validates each raise choice against the live action tree: %s BB', amountBb => {
    const raw = fixture();
    raw.nodes[0].actions[2].amountBb = amountBb;
    expect(() => validateTreeDataset(raw)).toThrow();
  });

  it('rejects a free Check while facing a bet and explicit chip amounts on Call', () => {
    const check = fixture();
    check.nodes[0].actions[1] = { id: 'call', type: 'check' };
    expect(() => validateTreeDataset(check)).toThrow(/Check/);
    const call = fixture();
    call.nodes[0].actions[1].amountBb = 1;
    expect(() => validateTreeDataset(call)).toThrow(/only Raise/);
  });

  it('rejects duplicate raise sizes even when their action IDs differ', () => {
    const raw = fixture();
    raw.nodes[0].actions[3].amountBb = 2.5;
    expect(() => validateTreeDataset(raw)).toThrow(/duplicate action or raise size/);
  });

  it.each(['fold', '__proto__', 'constructor', 'prototype', 'contains a space'])('rejects duplicate or unsafe action ID %s', id => {
    const raw = fixture();
    raw.nodes[0].actions[2].id = id;
    expect(() => validateTreeDataset(raw)).toThrow(/action IDs/);
  });

  it('rejects duplicate node IDs and duplicate full histories', () => {
    const duplicateId = fixture();
    duplicateId.nodes.push(missingNode(duplicateId.nodes[0].id, []));
    expect(() => validateTreeDataset(duplicateId)).toThrow(/duplicate node id/);
    const duplicateHistory = fixture();
    duplicateHistory.nodes.push({ ...structuredClone(duplicateHistory.nodes[0]), id: 'different-id' });
    expect(() => validateTreeDataset(duplicateHistory)).toThrow(/duplicate exact action history/);
  });

  it('rejects wrong actor order, illegal history raises, and closed hands', () => {
    const wrongActor = fixture();
    wrongActor.nodes[0].history[0].actor = 'BTN';
    expect(() => validateTreeDataset(wrongActor)).toThrow(/must act next/);
    const shortRaise = fixture();
    shortRaise.nodes[0].history = [{ actor: 'UTG', type: 'raise', amountBb: 1.5 }];
    expect(() => validateTreeDataset(shortRaise)).toThrow(/Raise/);
    const terminal = fixture();
    terminal.nodes[0].history = getPositions(6).slice(0, -1).map(actor => ({ actor, type: 'fold' }));
    expect(() => validateTreeDataset(terminal)).toThrow(/terminal/);
  });

  it('rejects absent table seats, unsupported formats, and missing provenance', () => {
    const absent = fixture();
    absent.game.stacksBb = { 'UTG+2': 100 };
    expect(() => validateTreeDataset(absent)).toThrow(/invalid seat/);
    const format = fixture();
    Object.assign(format.game, { format: 'mtt' });
    expect(() => validateTreeDataset(format)).toThrow(/Cash/);
    const source = fixture();
    source.source.precision = '';
    expect(() => validateTreeDataset(source)).toThrow(/precision/);
    source.source.precision = 'Synthetic';
    source.source.url = 'javascript:alert(1)';
    expect(() => validateTreeDataset(source)).toThrow(/http or https/);
  });
});

describe('conditional range summaries and empty templates', () => {
  function weightedNode(): TreeNode {
    const node = fixture().nodes[0];
    node.hands = Object.fromEntries(HANDS.map(hand => [hand, { status: 'unreachable', reach: 0 } as HandStrategy]));
    // AA: 6 * 0.5 = 3 combos; AKs: 4 * 0.25 = 1; AKo: 12 * 0.5 = 6.
    node.hands.AA = { status: 'available', reach: 0.5, frequencies: { fold: 0, call: 0, raise_small: 1, raise_large: 0 } };
    node.hands.AKs = { status: 'available', reach: 0.25, frequencies: { fold: 0, call: 0, raise_small: 0, raise_large: 1 } };
    node.hands.AKo = { status: 'available', reach: 0.5, frequencies: { fold: 0.5, call: 0.5, raise_small: 0, raise_large: 0 } };
    return node;
  }

  it('weights each action by both hand combinations and reach, excluding unreachable hands', () => {
    const raw = fixture();
    raw.nodes = [weightedNode()];
    const summary = treeRangeSummary(validateTreeDataset(raw).nodes[0]);
    expect(summary).not.toBeNull();
    expect(summary!.fold).toBeCloseTo(0.3);
    expect(summary!.call).toBeCloseTo(0.3);
    expect(summary!.raise_small).toBeCloseTo(0.3);
    expect(summary!.raise_large).toBeCloseTo(0.1);
    expect(Object.values(summary!).reduce((sum, probability) => sum + probability, 0)).toBeCloseTo(1);
  });

  it('returns no summary for a partially missing range or a node with no reached hands', () => {
    const partial = weightedNode();
    partial.hands['72o'] = { status: 'missing' };
    expect(treeRangeSummary(partial)).toBeNull();
    const empty = weightedNode();
    empty.hands = Object.fromEntries(HANDS.map(hand => [hand, { status: 'unreachable', reach: 0 } as HandStrategy]));
    expect(treeRangeSummary(empty)).toBeNull();
  });

  it('exports a legal, explicitly empty template without inventing any hand strategy', () => {
    const history: PreflopAction[] = getPositions(6).slice(0, -1).map(actor => ({ actor, type: actor === 'SB' ? 'call' : 'fold' }));
    const template = createTreeTemplate(GAME, history);
    expect(validateTreeDataset(template)).toEqual(template);
    expect(template.source.kind).toBe('demo');
    expect(template.source.precision).toContain('No frequencies');
    expect(template.nodes[0].history).toEqual(history);
    expect(Object.keys(template.nodes[0].hands)).toHaveLength(169);
    expect(Object.values(template.nodes[0].hands).every(row => row.status === 'missing' && !('frequencies' in row) && !('reach' in row))).toBe(true);
    expect(template.nodes[0].actions.map(action => action.type)).toEqual(['fold', 'check', 'raise']);
    expect(treeRangeSummary(template.nodes[0])).toBeNull();
  });

  it('does not export a decision template after the hand is closed', () => {
    const history: PreflopAction[] = getPositions(6).slice(0, -1).map(actor => ({ actor, type: 'fold' }));
    expect(() => createTreeTemplate(GAME, history)).toThrow(/unfinished hand/);
  });
});
