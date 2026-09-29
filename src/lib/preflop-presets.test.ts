import { describe, expect, it } from 'vitest';
import { getPositions, type Position } from './poker';
import { replayPreflop, type PreflopConfig } from './preflop';
import { buildPreset, LINE_PRESETS, type LinePreset } from './preflop-presets';

// These are example betting histories, not solved strategies or poker advice.
const EXPECTED_ACTOR: Record<LinePreset, Position> = {
  unopened: 'BTN', 'bb-open': 'BB', limp: 'BB', 'limp-raise': 'SB',
  squeeze: 'BTN', 'cold-four': 'SB', 'three-bet': 'UTG', 'four-bet': 'BTN', 'five-bet': 'UTG',
};

describe.each([6, 7, 8, 9])('example lines at a %i-player Cash 100 BB table', players => {
  const config: PreflopConfig = { players, stackBb: 100, anteBb: 0 };

  it.each(LINE_PRESETS)('$id leaves the intended player with a legal unfinished decision', ({ id }) => {
    const history = buildPreset(config, id);
    const state = replayPreflop(config, history);
    expect(state.nextActor).toBe(EXPECTED_ACTOR[id]);
    expect(state.terminal).toBeNull();
    expect(state.seats).toHaveLength(players);
    expect(state.legal.fold || state.legal.check || state.legal.call || state.legal.raise).toBe(true);
    for (let index = 0; index < history.length; index += 1) {
      expect(replayPreflop(config, history.slice(0, index)).nextActor).toBe(history[index].actor);
    }
  });

  it('keeps the SB limp decision different from the SB raise decision', () => {
    const limp = replayPreflop(config, buildPreset(config, 'limp'));
    const raise = replayPreflop(config, buildPreset(config, 'limp-raise'));
    expect(limp.legal.check).toBe(true);
    expect(limp.legal.call).toBe(false);
    expect(limp.potBb).toBe(2);
    expect(raise.legal.check).toBe(false);
    expect(raise.legal.callAmountBb).toBe(3);
    expect(raise.potBb).toBe(5);
  });

  it('retains the caller in a squeeze opportunity and keeps the cold 4-bettor uncommitted except for the blind', () => {
    const squeezeHistory = buildPreset(config, 'squeeze');
    const squeeze = replayPreflop(config, squeezeHistory);
    const opener = squeeze.seats.find(seat => seat.position === getPositions(players)[0])!;
    const caller = squeeze.seats.find(seat => seat.position === getPositions(players)[1])!;
    expect(opener.folded).toBe(false);
    expect(caller.folded).toBe(false);
    expect(opener.committedBb).toBe(2.5);
    expect(caller.committedBb).toBe(2.5);
    expect(squeezeHistory.filter(action => action.type === 'call')).toHaveLength(1);
    const coldHistory = buildPreset(config, 'cold-four');
    const cold = replayPreflop(config, coldHistory);
    expect(coldHistory.some(action => action.actor === 'SB')).toBe(false);
    expect(cold.seats.find(seat => seat.position === 'SB')!.committedBb).toBe(0.5);
    expect(cold.currentBetBb).toBe(8);
    expect(cold.legal.callAmountBb).toBe(7.5);
  });

  it('models Facing 5-Bet as the original opener facing the same opponent all-in', () => {
    const history = buildPreset(config, 'five-bet');
    const raises = history.filter(action => action.type === 'raise');
    expect(raises.map(action => action.actor)).toEqual(['UTG', 'BTN', 'UTG', 'BTN']);
    expect(raises.map(action => action.amountBb)).toEqual([2.5, 8, 22, 100]);
    const state = replayPreflop(config, history);
    expect(state.legal.callAmountBb).toBe(78);
    expect(state.legal.raise).toBe(false);
    expect(state.seats.find(seat => seat.position === 'BTN')!.allIn).toBe(true);
    expect(state.seats.filter(seat => !seat.folded).map(seat => seat.position)).toEqual(['UTG', 'BTN']);
  });
});

describe('example line boundaries', () => {
  it('contains all nine distinct examples', () => {
    expect(LINE_PRESETS).toHaveLength(9);
    expect(new Set(LINE_PRESETS.map(preset => preset.id)).size).toBe(9);
  });

  it('uses actual chips left after antes for the final shove', () => {
    const config: PreflopConfig = { players: 8, stackBb: 100, anteBb: 0.5 };
    const history = buildPreset(config, 'five-bet');
    expect(history.at(-1)).toEqual({ actor: 'BTN', type: 'raise', amountBb: 99.5 });
    const state = replayPreflop(config, history);
    expect(state.nextActor).toBe('UTG');
    expect(state.terminal).toBeNull();
    expect(state.legal.callAmountBb).toBe(77.5);
  });

  it('uses a position-specific stack for the final shove', () => {
    const config: PreflopConfig = { players: 7, stackBb: 100, stacksBb: { BTN: 75 }, anteBb: 0 };
    const history = buildPreset(config, 'five-bet');
    expect(history.at(-1)).toEqual({ actor: 'BTN', type: 'raise', amountBb: 75 });
    expect(replayPreflop(config, history).legal.callAmountBb).toBe(53);
  });

  it('rejects an example whose requested raises exceed a short stack', () => {
    expect(() => buildPreset({ players: 6, stackBb: 10, anteBb: 0 }, 'four-bet')).toThrow();
  });
});
