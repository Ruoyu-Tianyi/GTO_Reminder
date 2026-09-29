import { getPositions, type Position } from './poker';

export interface PreflopConfig {
  players: number;
  /** Initial chips, including the per-player ante. Overrides apply by position. */
  stackBb: number;
  stacksBb?: Partial<Record<Position, number>>;
  anteBb: number;
}

export interface PreflopAction {
  actor: Position;
  type: 'fold' | 'check' | 'call' | 'raise';
  /** Raise-to live commitment, including a posted blind but excluding the ante. */
  amountBb?: number;
}

export interface PreflopSeat {
  position: Position;
  stackBb: number;
  remainingBb: number;
  /** Live preflop commitment; excludes antes and returned uncalled chips. */
  committedBb: number;
  totalContributionBb: number;
  folded: boolean;
  allIn: boolean;
}

export interface PreflopLegal {
  fold: boolean;
  check: boolean;
  call: boolean;
  /** Additional chips needed, capped by the acting player's remaining stack. */
  callAmountBb: number;
  raise: boolean;
  /** Smallest legal raise-to; a short all-in may be below the full minimum. */
  minRaiseToBb: number;
  maxRaiseToBb: number;
}

export interface PreflopState {
  seats: PreflopSeat[];
  nextActor: Position | null;
  /** all-in means no further betting is possible; one player may retain chips. */
  terminal: 'uncontested' | 'flop' | 'all-in' | null;
  potBb: number;
  currentBetBb: number;
  /** Full minimum raise-to, before the short-all-in exception. */
  minRaiseToBb: number;
  legal: PreflopLegal;
}

interface Seat extends PreflopSeat {
  /** Blinds are not voluntary actions, so their initial value is null. */
  lastActionBetBb: number | null;
}

const clean = (amount: number) => Number(amount.toFixed(9));
const exceeds = (a: number, b: number) => clean(a - b) > 0;
const atLeast = (a: number, b: number) => clean(a - b) >= 0;

function amount(value: unknown, name: string, allowZero = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER / 16 || value < 0 || (!allowZero && value === 0)) {
    throw new Error(`${name} must be a finite ${allowZero ? 'nonnegative' : 'positive'} chip amount within the supported numeric range.`);
  }
  const result = clean(value);
  if (!allowZero && result === 0) throw new Error(`${name} is below the supported chip precision.`);
  return result;
}

const noActions = (): PreflopLegal => ({ fold: false, check: false, call: false, callAmountBb: 0, raise: false, minRaiseToBb: 0, maxRaiseToBb: 0 });

/**
 * Strict NLHE preflop replay: six to nine occupied seats, SB 0.5 / BB 1,
 * per-player antes paid before blinds. No straddles, rake or pot awards.
 * Uncalled live bets are returned when action closes; side pots are not awarded.
 *
 * Rules checked 2026-09-29:
 * - Poker TDA 2026 rules 45 and 49: full raises and cumulative short-all-in reopening.
 *   https://www.pokertda.com/view-poker-tda-rules/
 * - Robert's Rules v11, section 14, no-limit rules 2–4: short blinds and raise size.
 *   https://www.pagat.com/docs/RobsPkrRules11.pdf
 *
 * A player's reopening threshold is measured from that player's latest action.
 * Short all-ins do not change the last full raise increment. Explicit in-turn
 * folds are accepted even when checking is free; live-room penalties are outside
 * this replay model. It validates actions, not strategy or solver quality.
 */
export function replayPreflop(config: PreflopConfig, history: readonly PreflopAction[]): PreflopState {
  if (!config || typeof config !== 'object' || !Number.isInteger(config.players) || config.players < 6 || config.players > 9) {
    throw new Error('Preflop replay requires an integer table size from 6 to 9.');
  }
  if (!Array.isArray(history)) throw new Error('Preflop history must be an array of ordered actions.');
  const positions = getPositions(config.players);
  const defaultStack = amount(config.stackBb, 'stackBb');
  const anteBb = amount(config.anteBb, 'anteBb', true);
  if (config.stacksBb !== undefined) {
    if (typeof config.stacksBb !== 'object' || config.stacksBb === null || Array.isArray(config.stacksBb)) throw new Error('stacksBb must be an object keyed by table positions.');
    for (const [position, chips] of Object.entries(config.stacksBb)) {
      if (!positions.includes(position as Position)) throw new Error(`stacksBb contains a position absent from this table: ${position}.`);
      amount(chips, `stacksBb.${position}`);
    }
  }
  const seats: Seat[] = positions.map((position) => {
    const stackBb = config.stacksBb?.[position] === undefined ? defaultStack : amount(config.stacksBb[position], `stacksBb.${position}`);
    const ante = Math.min(stackBb, anteBb);
    const blind = position === 'SB' ? 0.5 : position === 'BB' ? 1 : 0;
    const committedBb = clean(Math.min(clean(stackBb - ante), blind));
    const totalContributionBb = clean(ante + committedBb);
    const remainingBb = clean(stackBb - totalContributionBb);
    return { position, stackBb, remainingBb, committedBb, totalContributionBb, folded: false, allIn: remainingBb === 0, lastActionBetBb: null };
  });
  let currentBetBb = 1; // A short big blind does not reduce the NLHE bring-in.
  let lastFullRaiseBb = 1;
  let cursor = 0;
  const pending = new Set(seats.filter((seat) => !seat.allIn).map((seat) => seat.position));

  function activeSeats(): Seat[] { return seats.filter((seat) => !seat.folded && !seat.allIn); }

  function owed(seat: Seat): number {
    // With only one player holding chips, there can be no additional side pot.
    const otherLive = seats.filter((other) => !other.folded && other.position !== seat.position);
    const facing = activeSeats().length === 1 ? Math.max(0, ...otherLive.map((other) => other.committedBb)) : currentBetBb;
    return clean(Math.max(0, facing - seat.committedBb));
  }

  function status(): { terminal: PreflopState['terminal']; actor: Seat | null } {
    if (seats.filter((seat) => !seat.folded).length === 1) return { terminal: 'uncontested', actor: null };
    const active = activeSeats();
    if (active.length === 0 || (active.length === 1 && owed(active[0]) === 0)) return { terminal: 'all-in', actor: null };
    // An only remaining player still gets Call/Fold when facing an unmatched all-in.
    if (active.length === 1) pending.add(active[0].position);
    for (let offset = 0; offset < seats.length; offset += 1) {
      const seat = seats[(cursor + offset) % seats.length];
      if (!seat.folded && !seat.allIn && pending.has(seat.position)) return { terminal: null, actor: seat };
    }
    return { terminal: 'flop', actor: null };
  }

  function legalFor(actor: Seat | null): PreflopLegal {
    if (!actor) return noActions();
    const callAmountBb = clean(Math.min(owed(actor), actor.remainingBb));
    const maxRaiseToBb = clean(actor.committedBb + actor.remainingBb);
    const fullMinimum = clean(currentBetBb + lastFullRaiseBb);
    const reopened = actor.lastActionBetBb === null || atLeast(clean(currentBetBb - actor.lastActionBetBb), lastFullRaiseBb);
    const contested = seats.some((other) => other.position !== actor.position && !other.folded && !other.allIn && exceeds(clean(other.committedBb + other.remainingBb), currentBetBb));
    const raise = reopened && contested && exceeds(maxRaiseToBb, currentBetBb);
    return {
      fold: true,
      check: callAmountBb === 0,
      call: callAmountBb > 0,
      callAmountBb,
      raise,
      minRaiseToBb: raise ? Math.min(fullMinimum, maxRaiseToBb) : fullMinimum,
      maxRaiseToBb,
    };
  }

  function contribute(seat: Seat, chips: number): void {
    seat.committedBb = clean(seat.committedBb + chips);
    seat.totalContributionBb = clean(seat.totalContributionBb + chips);
    seat.remainingBb = clean(seat.remainingBb - chips);
    seat.allIn = seat.remainingBb === 0;
  }

  for (let index = 0; index < history.length; index += 1) {
    const action = history[index];
    const state = status();
    const prefix = `Action ${index + 1}`;
    if (state.terminal || !state.actor) throw new Error(`${prefix}: preflop action is already closed (${state.terminal}).`);
    if (!action || typeof action !== 'object' || !['fold', 'check', 'call', 'raise'].includes(action.type)) throw new Error(`${prefix}: unsupported preflop action.`);
    const actor = state.actor;
    if (action.actor !== actor.position) throw new Error(`${prefix}: ${actor.position} must act next, not ${String(action.actor)}.`);
    if (action.type !== 'raise' && action.amountBb !== undefined) throw new Error(`${prefix}: only Raise accepts amountBb; Call is calculated from the current bet.`);
    const legal = legalFor(actor);
    if (action.type === 'fold') {
      actor.folded = true;
    } else if (action.type === 'check') {
      if (!legal.check) throw new Error(`${prefix}: Check is unavailable while facing a bet.`);
    } else if (action.type === 'call') {
      if (!legal.call) throw new Error(`${prefix}: there is no bet to Call; use Check.`);
      contribute(actor, legal.callAmountBb);
    } else {
      if (!legal.raise) throw new Error(`${prefix}: Raise is unavailable; betting has not reopened, the stack cannot raise, or no opponent can contest a raise.`);
      const raiseToBb = amount(action.amountBb, `${prefix}.amountBb`);
      if (!exceeds(raiseToBb, currentBetBb)) throw new Error(`${prefix}: Raise must exceed the current bet of ${currentBetBb} BB.`);
      if (exceeds(raiseToBb, legal.maxRaiseToBb)) throw new Error(`${prefix}: Raise exceeds the player's remaining stack.`);
      const increment = clean(raiseToBb - currentBetBb);
      const fullRaise = atLeast(increment, lastFullRaiseBb);
      if (!fullRaise && clean(raiseToBb - legal.maxRaiseToBb) !== 0) throw new Error(`${prefix}: Raise must reach ${clean(currentBetBb + lastFullRaiseBb)} BB or commit the entire remaining stack.`);
      contribute(actor, clean(raiseToBb - actor.committedBb));
      currentBetBb = raiseToBb;
      if (fullRaise) lastFullRaiseBb = increment;
      for (const other of seats) {
        if (!other.folded && !other.allIn && other.position !== actor.position && exceeds(currentBetBb, other.committedBb)) pending.add(other.position);
      }
    }
    actor.lastActionBetBb = currentBetBb;
    pending.delete(actor.position);
    cursor = (positions.indexOf(actor.position) + 1) % seats.length;
  }

  const final = status();
  if (final.terminal) {
    // Return an uncalled live wager, including unmatched blinds. Folded chips
    // still match a wager; antes never participate in this live-bet comparison.
    const byCommitment = [...seats].sort((a, b) => b.committedBb - a.committedBb);
    const highest = byCommitment[0];
    const refund = clean(highest.committedBb - byCommitment[1].committedBb);
    if (!highest.folded && refund > 0) {
      highest.committedBb = clean(highest.committedBb - refund);
      highest.totalContributionBb = clean(highest.totalContributionBb - refund);
      highest.remainingBb = clean(highest.remainingBb + refund);
      highest.allIn = highest.remainingBb === 0;
    }
    currentBetBb = Math.max(...seats.map((seat) => seat.committedBb));
  }
  return {
    seats: seats.map(({ lastActionBetBb: _lastActionBetBb, ...seat }) => seat),
    nextActor: final.actor?.position ?? null,
    terminal: final.terminal,
    potBb: clean(seats.reduce((sum, seat) => sum + seat.totalContributionBb, 0)),
    currentBetBb,
    minRaiseToBb: clean(currentBetBb + lastFullRaiseBb),
    legal: legalFor(final.actor),
  };
}
