import { describe, expect, it } from 'vitest';
import { DEMO_DATASET } from '../data/demo';
import { enumerateCoverageSpots } from './coverage';
import { replayPreflop } from './preflop';
import { createTreeTemplate } from './tree-strategy';
import { computedTreeId, resolveQuickTree, sourceSnapshotKey, spotToHistory } from './spot-to-history';
import type { Dataset, Spot } from './poker';

const spot: Spot = { ...DEMO_DATASET.nodes[0].spot, players: 7, hero: 'LJ', villain: 'BB', kind: 'vs-3bet' };
const computation = { engine: 'Fixture', model: 'Restricted test model', iterations: 10, status: 'unconverged' as const, scope: 'Test only' };
const quick: Dataset = { ...DEMO_DATASET, id: 'test-calculation-quick', source: { ...DEMO_DATASET.source, kind: 'computed', computation } };

describe('Quick spot to complete observed history', () => {
  it('replays every 6–9 player simple line to the requested hero without cold calls or extra opponents', () => {
    for (const input of enumerateCoverageSpots(spot, [6, 7, 8, 9])) {
      const { game, history } = spotToHistory(input);
      const state = replayPreflop(game, history);
      expect(state.nextActor).toBe(input.hero);
      expect(history.every(action => action.type === 'fold' || action.type === 'raise')).toBe(true);
      expect(history.filter(action => action.type === 'raise').map(action => action.amountBb)).toEqual(
        [input.openSizeBb, input.threeBetSizeBb, input.fourBetSizeBb].slice(0, ['rfi', 'vs-open', 'vs-3bet', 'vs-4bet'].indexOf(input.kind)));
      if (input.kind === 'vs-3bet' || input.kind === 'vs-4bet') {
        expect(state.seats.filter(seat => !seat.folded).map(seat => seat.position).sort()).toEqual([input.hero, input.villain].sort());
      }
    }
  });

  it('keeps the 7-player LJ seat and folds all intervening players before returning to the opener', () => {
    expect(spotToHistory(spot).history).toEqual([
      { actor: 'UTG', type: 'fold' }, { actor: 'LJ', type: 'raise', amountBb: 2.5 },
      { actor: 'HJ', type: 'fold' }, { actor: 'CO', type: 'fold' }, { actor: 'BTN', type: 'fold' },
      { actor: 'SB', type: 'fold' }, { actor: 'BB', type: 'raise', amountBb: 10 },
    ]);
  });

  it('does not insert unobserved future size controls into the history', () => {
    expect(spotToHistory({ ...spot, fourBetSizeBb: 200 }).history).toEqual(spotToHistory(spot).history);
  });

  it('rejects unsupported games, invalid positions, illegal prior raises and terminal heroes', () => {
    const patches: Partial<Spot>[] = [{ players: 5 }, { format: 'mtt' }, { villain: 'UTG' }, { hero: 'UTG+1' }, { threeBetSizeBb: 3 }, { threeBetSizeBb: 101 }, { openSizeBb: 100 }, { kind: 'rfi', hero: 'BB', villain: null }];
    for (const patch of patches) expect(() => spotToHistory({ ...spot, ...patch })).toThrow();
    expect(() => spotToHistory({ ...spot, threeBetSizeBb: 100 })).not.toThrow();
  });
});

describe('Quick tree snapshot matching', () => {
  function tree() {
    const { game, history } = spotToHistory(spot);
    const result = createTreeTemplate(game, history);
    result.id = 'test-calculation-part-001';
    result.source = { ...quick.source, precision: 'Synthetic test only' };
    result.nodes[0].hands.AA = { status: 'unreachable', reach: 0 };
    return result;
  }
  it('maps only computed Quick IDs and preserves unreachable and missing hands', () => {
    expect(computedTreeId(quick)).toBe('test-calculation-part-001');
    expect(computedTreeId(DEMO_DATASET)).toBeNull();
    const result = resolveQuickTree([tree()], quick, spot);
    expect(result?.node.hands.AA).toEqual({ status: 'unreachable', reach: 0 });
    expect(result?.node.hands.AKs).toEqual({ status: 'missing' });
    expect(resolveQuickTree([], quick, spot)).toBeNull();
    expect(resolveQuickTree([tree()], quick, { ...spot, rake: 'other' })).toBeNull();
  });
  it('ignores v2 precision but rejects every changed common source field', () => {
    expect(sourceSnapshotKey(tree().source)).toBe(sourceSnapshotKey(quick.source));
    for (const field of ['name', 'url', 'license', 'retrievedAt'] as const) {
      const changed = tree();
      changed.source[field] = field === 'url' ? 'https://example.com/new' : field === 'retrievedAt' ? '2026-10-01' : 'different';
      expect(() => resolveQuickTree([changed], quick, spot)).toThrow('SNAPSHOT_CHANGED');
    }
    const changed = tree(); changed.source.computation = { ...computation, iterations: 11 };
    expect(() => resolveQuickTree([changed], quick, spot)).toThrow('SNAPSHOT_CHANGED');
    const foreign = tree(); foreign.id = 'different-part-001';
    expect(() => resolveQuickTree([foreign], quick, spot)).toThrow('does not belong');
  });
  it('includes declared model parameters and final-snapshot gap in snapshot identity', () => {
    const modelTree = { openSizeBb: 2.5, threeBetSizeBb: 10, fourBetSizeBb: 30, maxRaises: 4, limp: true, limpRaiseBb: 2.5 };
    const metadata = { ...computation, tree: modelTree, modelGapBb: .02 };
    const current = { ...quick, source: { ...quick.source, computation: metadata } };
    const full = tree(); full.source.computation = metadata;
    expect(resolveQuickTree([full], current, spot)?.node.hands.AA.status).toBe('unreachable');
    for (const patch of [{ openSizeBb: 3 }, { threeBetSizeBb: 11 }, { fourBetSizeBb: 31 }, { maxRaises: 3 }, { limp: false }, { limpRaiseBb: 3 }]) {
      full.source.computation = { ...metadata, tree: { ...modelTree, ...patch } };
      expect(() => resolveQuickTree([full], current, spot)).toThrow('SNAPSHOT_CHANGED');
    }
    full.source.computation = { ...metadata, modelGapBb: .01 };
    expect(() => resolveQuickTree([full], current, spot)).toThrow('SNAPSHOT_CHANGED');
  });
});
