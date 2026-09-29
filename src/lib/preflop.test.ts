import { describe, expect, it } from 'vitest';
import { getPositions, type Position } from './poker';
import { replayPreflop, type PreflopAction, type PreflopConfig, type PreflopState } from './preflop';

const CONFIG: PreflopConfig = { players: 6, stackBb: 100, anteBb: 0 };
const fold = (actor: Position): PreflopAction => ({ actor, type: 'fold' });
const call = (actor: Position): PreflopAction => ({ actor, type: 'call' });
const check = (actor: Position): PreflopAction => ({ actor, type: 'check' });
const raise = (actor: Position, amountBb: number): PreflopAction => ({ actor, type: 'raise', amountBb });
const seat = (state: PreflopState, position: Position) => {
  const result = state.seats.find((entry) => entry.position === position);
  if (!result) throw new Error(`Missing seat ${position}`);
  return result;
};

function expectConservation(state: PreflopState) {
  for (const player of state.seats) {
    expect(player.remainingBb).toBeGreaterThanOrEqual(0);
    expect(player.totalContributionBb).toBeGreaterThanOrEqual(player.committedBb);
    expect(player.remainingBb + player.totalContributionBb).toBeCloseTo(player.stackBb, 8);
    expect(player.allIn).toBe(player.remainingBb === 0);
  }
  expect(state.potBb).toBeCloseTo(state.seats.reduce((sum, player) => sum + player.totalContributionBb, 0), 8);
}

describe('preflop posting and turn order', () => {
  it.each([6, 7, 8, 9])('posts blinds and preserves the complete %i-max action order', (players) => {
    const state = replayPreflop({ ...CONFIG, players }, []);
    expect(state.seats.map((player) => player.position)).toEqual(getPositions(players));
    expect(state.nextActor).toBe('UTG');
    expect(state.terminal).toBeNull();
    expect(state.potBb).toBe(1.5);
    expect(state.currentBetBb).toBe(1);
    expect(state.minRaiseToBb).toBe(2);
    expect(state.legal).toEqual({ fold: true, check: false, call: true, callAmountBb: 1, raise: true, minRaiseToBb: 2, maxRaiseToBb: 100 });
    expect(seat(state, 'SB').remainingBb).toBe(99.5);
    expect(seat(state, 'BB').remainingBb).toBe(99);
    expectConservation(state);
  });

  it('pays per-player antes before blinds and excludes them from raise-to amounts', () => {
    const config = { ...CONFIG, anteBb: 0.1 };
    const initial = replayPreflop(config, []);
    expect(initial.potBb).toBe(2.1);
    expect(initial.legal.maxRaiseToBb).toBe(99.9);
    expect(seat(initial, 'SB')).toMatchObject({ committedBb: 0.5, totalContributionBb: 0.6, remainingBb: 99.4 });
    expect(seat(initial, 'BB')).toMatchObject({ committedBb: 1, totalContributionBb: 1.1, remainingBb: 98.9 });
    const state = replayPreflop(config, [raise('UTG', 3)]);
    expect(seat(state, 'UTG')).toMatchObject({ committedBb: 3, totalContributionBb: 3.1, remainingBb: 96.9 });
    expect(state.potBb).toBe(5.1);
    expect(() => replayPreflop(config, [raise('UTG', 100)])).toThrow(/remaining stack/);
    expectConservation(state);
  });

  it.each([6, 7, 8, 9])('retains the BB option after every other seat limps at %i-max', (players) => {
    const config = { ...CONFIG, players };
    const positions = getPositions(players);
    const limps = positions.slice(0, -1).map(call);
    const option = replayPreflop(config, limps);
    expect(option.nextActor).toBe('BB');
    expect(option.terminal).toBeNull();
    expect(option.legal).toMatchObject({ check: true, call: false, callAmountBb: 0, raise: true, minRaiseToBb: 2 });
    const checked = replayPreflop(config, [...limps, check('BB')]);
    expect(checked.terminal).toBe('flop');
    expect(checked.potBb).toBe(players);
    const raised = replayPreflop(config, [...limps, raise('BB', 4)]);
    expect(raised.nextActor).toBe('UTG');
    expect(raised.legal.callAmountBb).toBe(3);
    expect(raised.minRaiseToBb).toBe(7);
    const called = replayPreflop(config, [...limps, raise('BB', 4), ...positions.slice(0, -1).map(call)]);
    expect(called.terminal).toBe('flop');
    expect(called.potBb).toBe(players * 4);
    expectConservation(called);
  });

  it('keeps the 1 BB bring-in and 2 BB opening minimum when BB posts short', () => {
    const config = { ...CONFIG, stacksBb: { BB: 0.6 } };
    const initial = replayPreflop(config, []);
    expect(initial.potBb).toBe(1.1);
    expect(initial.currentBetBb).toBe(1);
    expect(initial.legal.callAmountBb).toBe(1);
    expect(initial.legal.minRaiseToBb).toBe(2);
    expect(seat(initial, 'BB').allIn).toBe(true);
    const state = replayPreflop(config, getPositions(6).slice(0, -1).map(call));
    expect(state.terminal).toBe('flop');
    expect(state.potBb).toBe(5.6);
    expectConservation(state);
  });
});

describe('raises, cold calls and multiway histories', () => {
  it('replays a squeeze and reopens action for both the opener and caller', () => {
    const prefix = [raise('UTG', 3), call('HJ'), raise('CO', 12), fold('BTN'), fold('SB'), fold('BB')];
    const opener = replayPreflop(CONFIG, prefix);
    expect(opener.nextActor).toBe('UTG');
    expect(opener.legal).toMatchObject({ callAmountBb: 9, raise: true, minRaiseToBb: 21 });
    const caller = replayPreflop(CONFIG, [...prefix, raise('UTG', 27)]);
    expect(caller.nextActor).toBe('HJ');
    expect(caller.legal).toMatchObject({ callAmountBb: 24, raise: true, minRaiseToBb: 42 });
    const state = replayPreflop(CONFIG, [...prefix, raise('UTG', 27), call('HJ'), call('CO')]);
    expect(state.terminal).toBe('flop');
    expect(state.potBb).toBe(82.5);
    expectConservation(state);
  });

  it('replays 4-bets, 5-bets and another raise without a no-limit raise cap', () => {
    const prefix = [raise('UTG', 3), raise('HJ', 10), fold('CO'), fold('BTN'), fold('SB'), fold('BB'), raise('UTG', 25), raise('HJ', 50)];
    const facingFiveBet = replayPreflop(CONFIG, prefix);
    expect(facingFiveBet.nextActor).toBe('UTG');
    expect(facingFiveBet.minRaiseToBb).toBe(75);
    expect(facingFiveBet.legal.callAmountBb).toBe(25);
    const called = replayPreflop(CONFIG, [...prefix, call('UTG')]);
    expect(called.terminal).toBe('flop');
    expect(called.potBb).toBe(101.5);
    const shoved = replayPreflop(CONFIG, [...prefix, raise('UTG', 100), call('HJ')]);
    expect(shoved.terminal).toBe('all-in');
    expect(shoved.potBb).toBe(201.5);
    expectConservation(shoved);
  });

  it('updates the full increment from the actual previous bet after a short all-in', () => {
    const config = { ...CONFIG, stacksBb: { HJ: 14 } };
    const short = replayPreflop(config, [raise('UTG', 10), raise('HJ', 14)]);
    expect(short.nextActor).toBe('CO');
    expect(short.legal.raise).toBe(true);
    expect(short.minRaiseToBb).toBe(23);
    const full = replayPreflop(config, [raise('UTG', 10), raise('HJ', 14), raise('CO', 25)]);
    expect(full.minRaiseToBb).toBe(36);
  });
});

describe('short all-ins and reopening rights', () => {
  it('offers a below-minimum raise only as the entire remaining stack', () => {
    const config = { ...CONFIG, stacksBb: { HJ: 14 } };
    const state = replayPreflop(config, [raise('UTG', 10)]);
    expect(state.minRaiseToBb).toBe(19);
    expect(state.legal).toMatchObject({ raise: true, minRaiseToBb: 14, maxRaiseToBb: 14 });
    expect(() => replayPreflop(config, [raise('UTG', 10), raise('HJ', 12)])).toThrow(/entire remaining stack/);
    expect(seat(replayPreflop(config, [raise('UTG', 10), raise('HJ', 14)]), 'HJ').allIn).toBe(true);
  });

  it.each([[14, false], [15, false], [19, true]] as const)('a shove to %i after a raise to 10 gives reopening=%s', (chips, reopened) => {
    const config = { ...CONFIG, stacksBb: { HJ: chips } };
    const history = [raise('UTG', 10), raise('HJ', chips), call('CO'), fold('BTN'), fold('SB'), fold('BB')];
    const state = replayPreflop(config, history);
    expect(state.nextActor).toBe('UTG');
    expect(state.legal.raise).toBe(reopened);
    expect(state.legal.callAmountBb).toBe(chips - 10);
    if (!reopened) expect(() => replayPreflop(config, [...history, raise('UTG', chips + 9)])).toThrow(/not reopened/);
  });

  it('reopens after cumulative short all-ins, but measures each player from their own latest action', () => {
    const config = { ...CONFIG, stacksBb: { HJ: 14, CO: 19, SB: 23 } };
    const history = [raise('UTG', 10), raise('HJ', 14), raise('CO', 19), call('BTN'), raise('SB', 23), fold('BB')];
    const opener = replayPreflop(config, history);
    expect(opener.nextActor).toBe('UTG');
    expect(opener.legal).toMatchObject({ raise: true, callAmountBb: 13, minRaiseToBb: 32 });
    const laterCaller = replayPreflop(config, [...history, call('UTG')]);
    expect(laterCaller.nextActor).toBe('BTN');
    expect(laterCaller.legal).toMatchObject({ raise: false, callAmountBb: 4 });
    expect(() => replayPreflop(config, [...history, call('UTG'), raise('BTN', 32)])).toThrow(/not reopened/);
    const state = replayPreflop(config, [...history, call('UTG'), call('BTN')]);
    expect(state.terminal).toBe('flop');
    expectConservation(state);
  });

  it('lets an unacted blind raise after a short shove without treating it as a full raise', () => {
    const config = { ...CONFIG, stacksBb: { SB: 4.5 } };
    const history = [raise('UTG', 3), fold('HJ'), fold('CO'), fold('BTN'), raise('SB', 4.5)];
    const state = replayPreflop(config, history);
    expect(state.nextActor).toBe('BB');
    expect(state.legal).toMatchObject({ raise: true, minRaiseToBb: 6.5, callAmountBb: 3.5 });
    expect(replayPreflop(config, [...history, raise('BB', 6.5)]).nextActor).toBe('UTG');
  });
});

describe('all-in closure, refunds and uneven stacks', () => {
  it('keeps Call/Fold pending against an all-in while disallowing a raise into an empty side pot', () => {
    const config = { ...CONFIG, stacksBb: { UTG: 20 } };
    const history = [raise('UTG', 20), fold('HJ'), fold('CO'), fold('BTN'), fold('SB')];
    const state = replayPreflop(config, history);
    expect(state.terminal).toBeNull();
    expect(state.nextActor).toBe('BB');
    expect(state.legal).toMatchObject({ fold: true, check: false, call: true, callAmountBb: 19, raise: false });
    expect(() => replayPreflop(config, [...history, raise('BB', 100)])).toThrow(/no opponent can contest/);
    const called = replayPreflop(config, [...history, call('BB')]);
    expect(called.terminal).toBe('all-in');
    expect(called.potBb).toBe(40.5);
    expect(seat(called, 'BB').remainingBb).toBe(80);
    expectConservation(called);
  });

  it('does not allow a side-pot raise when the only other player with chips cannot cover the current bet', () => {
    const config = { ...CONFIG, stacksBb: { UTG: 20, BB: 10 } };
    const history = [raise('UTG', 20), fold('HJ'), fold('CO'), fold('BTN')];
    expect(replayPreflop(config, history).legal.raise).toBe(false);
    const state = replayPreflop(config, [...history, call('SB'), call('BB')]);
    expect(state.terminal).toBe('all-in');
    expect(state.potBb).toBe(50);
    expectConservation(state);
  });

  it('caps short calls and returns the unmatched part of a shove before reporting the final pot', () => {
    const config = { ...CONFIG, stacksBb: { HJ: 20, CO: 40 } };
    const history = [raise('UTG', 100), call('HJ'), call('CO'), fold('BTN'), fold('SB'), fold('BB')];
    expect(replayPreflop(config, [raise('UTG', 100)]).legal.callAmountBb).toBe(20);
    const state = replayPreflop(config, history);
    expect(state.terminal).toBe('all-in');
    expect(state.nextActor).toBeNull();
    expect(state.potBb).toBe(101.5);
    expect(seat(state, 'UTG')).toMatchObject({ committedBb: 40, remainingBb: 60, allIn: false });
    expect(seat(state, 'HJ')).toMatchObject({ committedBb: 20, remainingBb: 0, allIn: true });
    expect(seat(state, 'CO')).toMatchObject({ committedBb: 40, remainingBb: 0, allIn: true });
    for (let length = 0; length <= history.length; length += 1) expectConservation(replayPreflop(config, history.slice(0, length)));
  });

  it('returns the uncalled live portion of an uncontested raise but retains every ante', () => {
    const config = { ...CONFIG, anteBb: 0.1 };
    const history = [raise('UTG', 3), ...getPositions(6).slice(1).map(fold)];
    const state = replayPreflop(config, history);
    expect(state.terminal).toBe('uncontested');
    expect(state.potBb).toBe(3.1);
    expect(seat(state, 'UTG')).toMatchObject({ committedBb: 1, totalContributionBb: 1.1, remainingBb: 98.9 });
    expectConservation(state);
  });

  it('closes a walk before BB acts and refunds the unmatched half blind', () => {
    const state = replayPreflop(CONFIG, getPositions(6).slice(0, -1).map(fold));
    expect(state.terminal).toBe('uncontested');
    expect(state.nextActor).toBeNull();
    expect(state.potBb).toBe(1);
    expect(seat(state, 'BB')).toMatchObject({ committedBb: 0.5, remainingBb: 99.5 });
    expect(state.legal).toEqual({ fold: false, check: false, call: false, callAmountBb: 0, raise: false, minRaiseToBb: 0, maxRaiseToBb: 0 });
  });

  it('handles ante-only all-ins and only calls the actual short blind when nobody else can bet', () => {
    const anteOnly = replayPreflop({ ...CONFIG, stackBb: 0.5, anteBb: 1 }, []);
    expect(anteOnly.terminal).toBe('all-in');
    expect(anteOnly.potBb).toBe(3);
    expect(anteOnly.nextActor).toBeNull();
    const config = { ...CONFIG, anteBb: 0.5, stacksBb: { HJ: 0.5, CO: 0.5, BTN: 0.5, SB: 0.8, BB: 0.9 } };
    const initial = replayPreflop(config, []);
    expect(initial.nextActor).toBe('UTG');
    expect(initial.legal).toMatchObject({ callAmountBb: 0.4, raise: false });
    const called = replayPreflop(config, [call('UTG')]);
    expect(called.terminal).toBe('all-in');
    expect(called.potBb).toBe(4.1);
    expectConservation(called);
  });
});

describe('strict input validation and replay purity', () => {
  it('rejects out-of-turn actions and actions after all terminal outcomes', () => {
    expect(() => replayPreflop(CONFIG, [fold('BTN')])).toThrow(/UTG must act next/);
    expect(() => replayPreflop(CONFIG, [fold('UTG'), call('UTG')])).toThrow(/HJ must act next/);
    const positions = getPositions(6);
    const walk = positions.slice(0, -1).map(fold);
    expect(() => replayPreflop(CONFIG, [...walk, check('BB')])).toThrow(/already closed \(uncontested\)/);
    const limps = [...positions.slice(0, -1).map(call), check('BB')];
    expect(() => replayPreflop(CONFIG, [...limps, check('UTG')])).toThrow(/already closed \(flop\)/);
    const showdown = [raise('UTG', 100), call('HJ'), fold('CO'), fold('BTN'), fold('SB'), fold('BB')];
    expect(() => replayPreflop(CONFIG, [...showdown, call('UTG')])).toThrow(/already closed \(all-in\)/);
  });

  it('rejects free calls, checks facing bets, non-all-in underraises and excessive raises', () => {
    expect(() => replayPreflop(CONFIG, [check('UTG')])).toThrow(/Check is unavailable/);
    expect(() => replayPreflop(CONFIG, [raise('UTG', 1.5)])).toThrow(/entire remaining stack/);
    expect(() => replayPreflop(CONFIG, [raise('UTG', 1)])).toThrow(/must exceed the current bet/);
    expect(() => replayPreflop(CONFIG, [raise('UTG', 101)])).toThrow(/remaining stack/);
    const limps = getPositions(6).slice(0, -1).map(call);
    expect(() => replayPreflop(CONFIG, [...limps, call('BB')])).toThrow(/use Check/);
  });

  it.each([NaN, Infinity, -1, 0])('rejects invalid raise amount %s', (chips) => {
    expect(() => replayPreflop(CONFIG, [raise('UTG', chips)])).toThrow(/chip amount/);
  });

  it('requires an explicit raise total and keeps call amounts implicit', () => {
    expect(() => replayPreflop(CONFIG, [{ actor: 'UTG', type: 'raise' }])).toThrow(/amountBb/);
    expect(() => replayPreflop(CONFIG, [{ actor: 'UTG', type: 'call', amountBb: 1 }])).toThrow(/only Raise accepts/);
    expect(() => replayPreflop(CONFIG, [{ actor: 'UTG', type: 'fold', amountBb: 0 }])).toThrow(/only Raise accepts/);
    expect(() => replayPreflop(CONFIG, [{ actor: 'UTG', type: 'bet' } as unknown as PreflopAction])).toThrow(/unsupported preflop action/);
  });

  it('does not lose a smallest supported remaining chip or permit an over-stack raise', () => {
    const config = { ...CONFIG, stackBb: 3 };
    const state = replayPreflop(config, [raise('UTG', 2.999999999)]);
    expect(seat(state, 'UTG')).toMatchObject({ remainingBb: 0.000000001, allIn: false });
    expect(() => replayPreflop(config, [raise('UTG', 3.000000001)])).toThrow(/remaining stack/);
    expectConservation(state);
  });

  it('rejects unsupported tables, invalid stack overrides and malformed chip settings', () => {
    for (const players of [2, 5, 6.5, 10, NaN]) expect(() => replayPreflop({ ...CONFIG, players }, [])).toThrow(/6 to 9/);
    for (const stackBb of [0, -1, NaN, Infinity]) expect(() => replayPreflop({ ...CONFIG, stackBb }, [])).toThrow(/stackBb/);
    expect(() => replayPreflop({ ...CONFIG, anteBb: -0.1 }, [])).toThrow(/anteBb/);
    expect(() => replayPreflop({ ...CONFIG, stacksBb: { 'UTG+2': 100 } }, [])).toThrow(/position absent/);
    expect(() => replayPreflop({ ...CONFIG, stacksBb: { UTG: 0 } }, [])).toThrow(/stacksBb.UTG/);
    expect(() => replayPreflop(CONFIG, null as unknown as PreflopAction[])).toThrow(/history must be an array/);
  });

  it('does not mutate configuration or history and returns detached state objects', () => {
    const config = Object.freeze({ ...CONFIG, stacksBb: Object.freeze({ SB: 30 }) });
    const history = Object.freeze([Object.freeze(raise('UTG', 3)), Object.freeze(call('HJ'))]);
    const first = replayPreflop(config, history);
    const second = replayPreflop(config, history);
    expect(first).toEqual(second);
    first.seats[0].remainingBb = -100;
    expect(replayPreflop(config, history)).toEqual(second);
    expectConservation(second);
  });
});
