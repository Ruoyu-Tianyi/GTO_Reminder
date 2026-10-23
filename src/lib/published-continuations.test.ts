import { describe, expect, it } from 'vitest';
import { HANDS } from './poker';
import { REVIEWED_CONTINUATION_CATALOG, validatePublishedContinuations, type ContinuationHand } from './published-continuations';
import { handBackground, handDescription, publishedActions, publishedHand, MISSING_BACKGROUND } from './published-view';

// Synthetic hands test representation boundaries, not poker advice or source frequencies.
function fixture(graphical = false) {
  const meta = structuredClone(REVIEWED_CONTINUATION_CATALOG.find(node =>
    graphical ? node.precision.kind === 'graphical-actions' : node.actions.some(action => action.id === 'allin'))!);
  const hands: Record<string, ContinuationHand> = Object.fromEntries(HANDS.map(hand => [hand, { status: 'missing', reach: null, reason: 'not-shown' }]));
  hands.AA = graphical ? { status: 'actions-only', reach: null, actions: ['allin', 'call'] }
    : { status: 'available', reach: null, frequencies: Object.fromEntries(meta.actions.map(action => [action.id, action.id === 'allin' || action.id === 'call' ? 0.5 : 0])) };
  return { schemaVersion: 1, kind: 'published-continuations', preparedAt: '2026-10-23', nodes: [{ ...meta, hands }] };
}

describe('reviewed continuation catalog', () => {
  it('records each reviewed pair once, with both kinds and three table sizes', () => {
    const groups = REVIEWED_CONTINUATION_CATALOG.reduce<Record<string, number>>((counts, node) => {
      const key = `${node.players}:${node.kind}`; counts[key] = (counts[key] ?? 0) + 1; return counts;
    }, {});
    expect(groups).toEqual({ '6:vs-3bet': 15, '9:vs-3bet': 36, '8:vs-4bet': 28 });
    expect(new Set(REVIEWED_CONTINUATION_CATALOG.map(node => `${node.refId}:${node.kind}:${node.hero}:${node.villain}`)).size).toBe(79);
  });
  it('preserves source-specific sizes and the missing BB vs MP three-bet size', () => {
    const find = (players: number, hero: string, villain: string) => REVIEWED_CONTINUATION_CATALOG.find(node => node.players === players && node.hero === hero && node.villain === villain)!;
    expect(find(6, 'UTG', 'BTN').actions.find(action => action.id === 'raise')?.amountBb).toBe(23.8);
    expect(find(9, 'UTG', 'SB').actions.find(action => action.id === 'raise')?.amountBb).toBe(26);
    expect(find(9, 'UTG', 'BB').actions.find(action => action.id === 'raise')?.amountBb).toBe(28);
    expect(find(9, 'UTG+2', 'BB').threeBetSizeBb).toBeNull();
  });
});

describe('conditional chart validation', () => {
  it('keeps conditional actions separate from missing evidence and unknown reach', () => {
    const node = validatePublishedContinuations(fixture()).nodes[0];
    expect(node.hands.AA).toMatchObject({ status: 'available', reach: null, frequencies: { allin: 0.5, call: 0.5, raise: 0, fold: 0 } });
    expect(node.hands['72o']).toEqual({ status: 'missing', reach: null, reason: 'not-shown' });
    expect(node).not.toHaveProperty('derivedRangeSummary');
  });
  it('keeps graphical actions without inventing numeric splits or 100% pure frequencies', () => {
    const data = fixture(true);
    data.nodes[0].hands.KK = { status: 'actions-only', reach: null, actions: ['call'] };
    const node = validatePublishedContinuations(data).nodes[0];
    expect(node.hands.KK).toEqual({ status: 'actions-only', reach: null, actions: ['call'] });
    expect(node.hands.AA).not.toHaveProperty('frequencies');
  });
  it.each([
    ['players', 7], ['stackBb', 99], ['page', 2], ['kind', 'vs-4bet'], ['villain', 'UTG'],
    ['threeBetSizeBb', 11], ['ante', 0], ['rake', 'none'], ['sourcePosition', 'wrong'],
    ['precision', { kind: 'original-solver', step: 0.001 }],
  ])('rejects changed reviewed metadata %s', (key, value) => {
    const data = fixture(); Object.assign(data.nodes[0], { [key]: value });
    expect(() => validatePublishedContinuations(data)).toThrow();
  });
  it('rejects fabricated sizing for an unknown source field', () => {
    const data = fixture();
    Object.assign(data.nodes[0], structuredClone(REVIEWED_CONTINUATION_CATALOG.find(node => node.players === 9 && node.hero === 'UTG+2' && node.villain === 'BB')!));
    data.nodes[0].threeBetSizeBb = 13;
    expect(() => validatePublishedContinuations(data)).toThrow(/threeBetSizeBb/);
  });
  it.each([0, 0.5, 1])('rejects an inferred historical reach of %s', reach => {
    const data = fixture(); Object.assign(data.nodes[0].hands.AA, { reach });
    expect(() => validatePublishedContinuations(data)).toThrow(/reach/);
  });
  it.each([0.25, 0.9, -0.5, NaN])('rejects unsupported conditional frequency %s', frequency => {
    const data = fixture(); const row = data.nodes[0].hands.AA;
    if (row.status === 'available') row.frequencies.allin = frequency;
    expect(() => validatePublishedContinuations(data)).toThrow();
  });
  it('rejects incorrect sums, removed actions, and collapsed all-in sizing', () => {
    for (const edit of ['sum', 'missing-action', 'merged-size']) {
      const data = fixture(); const row = data.nodes[0].hands.AA;
      if (row.status === 'available') {
        if (edit === 'sum') row.frequencies.call = 0;
        if (edit === 'missing-action') delete row.frequencies.allin;
        if (edit === 'merged-size') data.nodes[0].actions.find(action => action.id === 'allin')!.amountBb = 28;
      }
      expect(() => validatePublishedContinuations(data)).toThrow();
    }
  });
  it('rejects missing canonical hands and extra hand aliases', () => {
    const data = fixture(); delete data.nodes[0].hands['AKs'];
    data.nodes[0].hands.KAs = { status: 'missing', reach: null, reason: 'not-shown' };
    expect(() => validatePublishedContinuations(data)).toThrow(/169/);
  });
  it.each(['unreachable', 'fold', 'inferred'])('rejects unsupported missing-hand status %s', status => {
    const data = fixture(); Object.assign(data.nodes[0].hands['72o'], { status });
    expect(() => validatePublishedContinuations(data)).toThrow();
  });
  it('rejects frequencies on missing or graphical entries', () => {
    for (const graphical of [false, true]) {
      const data = fixture(graphical);
      Object.assign(data.nodes[0].hands[graphical ? 'AA' : '72o'], { frequencies: { allin: 0, call: 0, fold: 1 } });
      expect(() => validatePublishedContinuations(data)).toThrow();
    }
  });
  it('rejects unknown/duplicate visible actions and empty graphical evidence', () => {
    for (const actions of [[], ['check'], ['call', 'call']]) {
      const data = fixture(true); data.nodes[0].hands.AA = { status: 'actions-only', reach: null, actions };
      expect(() => validatePublishedContinuations(data)).toThrow();
    }
  });
  it('rejects global aggregates, duplicate nodes and invented source provenance', () => {
    const data = fixture(); Object.assign(data.nodes[0], { derivedRangeSummary: { fold: 1 } });
    expect(() => validatePublishedContinuations(data)).toThrow(/aggregate/);
    const duplicate = fixture(); duplicate.nodes.push(structuredClone(duplicate.nodes[0]));
    expect(() => validatePublishedContinuations(duplicate)).toThrow(/duplicate/);
    const source = fixture(); source.nodes[0].source.sha256 = '0'.repeat(64);
    expect(() => validatePublishedContinuations(source)).toThrow(/source/);
  });
});

describe('continuation display semantics', () => {
  it('does not turn missing/graphical evidence into numeric split colors', () => {
    const node = validatePublishedContinuations(fixture(true)).nodes[0];
    const actions = publishedActions(node, node.kind);
    expect(handBackground(publishedHand(node, '72o'), actions)).toBe(MISSING_BACKGROUND);
    expect(handBackground(publishedHand(node, 'AA'), actions)).not.toContain('gradient');
    const description = handDescription('AA', publishedHand(node, 'AA'), actions);
    expect(description).toContain('All-in 100 BB + Call shown');
    expect(description).not.toMatch(/50%|100%/);
  });
  it('exposes fixed 4-bet and all-in as separate options, with numeric conditional percentages', () => {
    const node = validatePublishedContinuations(fixture()).nodes[0];
    const actions = publishedActions(node, node.kind);
    expect(actions.map(action => action.label)).toContain('All-in 100 BB');
    expect(actions.some(action => action.label.startsWith('4-Bet to '))).toBe(true);
    expect(handDescription('AA', publishedHand(node, 'AA'), actions)).toContain('All-in 100 BB 50%');
    expect(publishedHand(node, null)).toBeUndefined();
  });
});
