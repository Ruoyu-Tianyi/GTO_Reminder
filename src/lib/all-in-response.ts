import { HANDS, normalizeHand, type Position } from './poker';
import { replayPreflop, type PreflopAction } from './preflop';
import type { TreeGame } from './tree-strategy';
import {
  LOCAL_EQUITY_MODEL, LocalEquityEngine, parseEquityCard, showdownCallEv,
  type LocalEquityProgress, type LocalEquityRequest, type LocalEquityResult, type OpponentModel,
} from './local-equity';

export const ALL_IN_RESPONSE_MODEL = 'conditional-heads-up-all-in-ev-v1' as const;

export type AllInUnavailableReason = 'invalid-history' | 'closed-action' | 'multiple-opponents' | 'opponent-not-all-in'
  | 'call-does-not-close' | 'unequal-pot-eligibility' | 'uncalled-refund' | 'unknown-rake';
export interface AllInUnavailable { available: false; reason: AllInUnavailableReason; message: string }
export interface AllInContext {
  hero: Position;
  villain: Position;
  potBeforeCallBb: number;
  callBb: number;
  potAfterCallBb: number;
  heroRemainingAfterCallBb: number;
  foldedSeats: Position[];
}
export type AllInContextResult = AllInUnavailable | { available: true; context: AllInContext };

const chipsEqual = (a: number, b: number) => Number((a - b).toFixed(9)) === 0;
const unavailable = (reason: AllInUnavailableReason, message: string): AllInUnavailable => ({ available: false, reason, message });

/** Only one common showdown pot, with no chips returned on the proposed call. */
export function identifyAllInResponse(game: TreeGame, history: readonly PreflopAction[]): AllInContextResult {
  try {
    if (game.format !== 'cash') return unavailable('invalid-history', 'This model supports Cash preflop histories only.');
    const before = replayPreflop(game, history);
    if (before.terminal || !before.nextActor) return unavailable('closed-action', 'There is no further preflop decision.');
    const live = before.seats.filter(seat => !seat.folded);
    if (live.length !== 2) return unavailable('multiple-opponents', 'Exactly two live players are required; multiway pots are not supported.');
    const hero = live.find(seat => seat.position === before.nextActor)!;
    const villain = live.find(seat => seat.position !== hero.position)!;
    if (!villain.allIn) return unavailable('opponent-not-all-in', 'The only live opponent must already be all-in.');
    if (!before.legal.call || !before.legal.fold || before.legal.raise || before.legal.callAmountBb <= 0) {
      return unavailable('call-does-not-close', 'The decision must be a positive Call or Fold with no further raise option.');
    }
    const after = replayPreflop(game, [...history, { actor: hero.position, type: 'call' }]);
    if (after.terminal !== 'all-in' || after.nextActor !== null) return unavailable('call-does-not-close', 'Calling must end all preflop betting.');
    const calledHero = after.seats.find(seat => seat.position === hero.position)!;
    const calledVillain = after.seats.find(seat => seat.position === villain.position)!;
    if (!chipsEqual(after.potBb, before.potBb + before.legal.callAmountBb)
      || before.seats.some(seat => {
        const final = after.seats.find(item => item.position === seat.position)!;
        const increase = seat.position === hero.position ? before.legal.callAmountBb : 0;
        return !chipsEqual(final.totalContributionBb, seat.totalContributionBb + increase);
      })) {
      return unavailable('uncalled-refund', 'This call returns an unmatched wager; the unadjusted pot cannot be used for EV.');
    }
    if (!chipsEqual(calledHero.committedBb, calledVillain.committedBb)
      || !chipsEqual(calledHero.totalContributionBb, calledVillain.totalContributionBb)
      || after.seats.some(seat => seat.folded && Number((seat.totalContributionBb - calledHero.totalContributionBb).toFixed(9)) > 0)) {
      return unavailable('unequal-pot-eligibility', 'Unequal pot eligibility or side pots require separate pot-by-pot equity calculations.');
    }
    return { available: true, context: {
      hero: hero.position, villain: villain.position, potBeforeCallBb: before.potBb,
      callBb: before.legal.callAmountBb, potAfterCallBb: after.potBb,
      heroRemainingAfterCallBb: calledHero.remainingBb,
      foldedSeats: before.seats.filter(seat => seat.folded).map(seat => seat.position),
    } };
  } catch (error) {
    return unavailable('invalid-history', error instanceof Error ? error.message : 'Invalid preflop history.');
  }
}

export type AllInRake =
  | { status: 'known'; percent: number; capBb: number; noFlopNoDrop: boolean }
  | { status: 'unknown'; reason?: string };

/** Every opponent model is an explicit assumption, never inferred from the action history. */
export interface AllInOpponentAssumption { label: string; model: OpponentModel }
export type AllInSampling = Pick<LocalEquityRequest, 'hands' | 'samplesPerHand' | 'seed' | 'deadCards'>;

export function createAllInEquityRequest(opponent: AllInOpponentAssumption, sampling: AllInSampling): LocalEquityRequest {
  if (!opponent || typeof opponent.label !== 'string' || !opponent.label.trim()) throw new Error('Describe the assumed opponent range or cards.');
  const request: LocalEquityRequest = { hands: sampling.hands, samplesPerHand: sampling.samplesPerHand,
    seed: sampling.seed, deadCards: sampling.deadCards, opponents: [structuredClone(opponent.model)] };
  // Reuse the existing request validation without starting any sampling.
  return new LocalEquityEngine(request).request;
}

function opponentKey(model: OpponentModel): string {
  if (model.kind === 'range') return JSON.stringify(['range', Object.entries(model.weights).sort(([a], [b]) => a.localeCompare(b))]);
  if (model.kind === 'cards') return JSON.stringify(['cards', model.cards.map(parseEquityCard).sort((a, b) => a - b)]);
  return model.kind === 'heuristic' ? JSON.stringify(['heuristic', model.topPercent]) : JSON.stringify(['random']);
}

function canonicalHand(hand: string): string {
  if (/^([2-9TJQKA][cdhs]){2}$/i.test(hand)) {
    return [hand.slice(0, 2), hand.slice(2)].map(card => card[0].toUpperCase() + card[1].toLowerCase()).join('');
  }
  return normalizeHand(hand)!;
}

/** Validate the current engine's per-hand HU results, including split pots and interval construction. */
function checkedResults(request: LocalEquityRequest, progress: LocalEquityProgress): LocalEquityResult[] {
  const expectedHands = (request.hands ?? HANDS).map(canonicalHand);
  if (!progress || progress.model !== LOCAL_EQUITY_MODEL || !progress.done || progress.currentHand !== null
    || progress.samplesPerHand !== request.samplesPerHand || progress.totalHands !== expectedHands.length
    || progress.completedHands !== expectedHands.length || !Array.isArray(progress.results) || progress.results.length !== expectedHands.length) {
    throw new Error('Use a completed equity result for the same requested hands and sample count.');
  }
  const found = new Map<string, LocalEquityResult>();
  for (const row of progress.results) {
    const values = [row.equity, row.winProbability, row.tieProbability, row.standardError];
    if (!expectedHands.includes(row.hand) || found.has(row.hand) || row.samples !== request.samplesPerHand
      || values.some(value => !Number.isFinite(value) || value < 0 || value > 1)
      || row.winProbability + row.tieProbability > 1 + 1e-12
      || Math.abs(row.equity - row.winProbability - row.tieProbability / 2) > 1e-12) {
      throw new Error('Invalid heads-up equity result; ties must receive half of the pot.');
    }
    const bound = Math.sqrt(Math.log(40) / (2 * row.samples));
    const expectedInterval = [Math.max(0, row.equity - bound), Math.min(1, row.equity + bound)];
    const expectedError = row.samples > 1
      ? Math.sqrt(Math.max(0, row.winProbability + row.tieProbability / 4 - row.equity ** 2) / (row.samples - 1)) : 0;
    if (!Array.isArray(row.confidence95) || row.confidence95.length !== 2
      || row.confidence95.some((value, index) => !Number.isFinite(value) || Math.abs(value - expectedInterval[index]) > 1e-12)
      || Math.abs(row.standardError - expectedError) > 1e-10) {
      throw new Error('The sampling interval or standard error does not match the local equity model.');
    }
    found.set(row.hand, row);
  }
  return expectedHands.map(hand => found.get(hand)!);
}

export interface AllInHandResponse {
  hand: string;
  equity: number;
  equityConfidence95: [number, number];
  samples: number;
  callEvBb: number;
  callEvConfidence95Bb: [number, number];
  foldEvBb: 0;
  /** Describes only the specified range/rake assumptions, never a GTO frequency. */
  signal: 'call-favored' | 'fold-favored' | 'uncertain';
}
export interface AllInResponseInput {
  game: TreeGame;
  history: readonly PreflopAction[];
  rake: AllInRake;
  opponent: AllInOpponentAssumption;
  equityRequest: LocalEquityRequest;
  /** Must be the worker result produced by equityRequest; the caller owns that request/result binding. */
  equity: LocalEquityProgress;
}
export interface AllInResponse {
  available: true;
  model: typeof ALL_IN_RESPONSE_MODEL;
  context: AllInContext;
  rake: Extract<AllInRake, { status: 'known' }> & { amountBb: number };
  breakEvenEquity: number;
  hands: AllInHandResponse[];
  assumptions: {
    opponent: AllInOpponentAssumption;
    equityModel: typeof LOCAL_EQUITY_MODEL;
    seed: number;
    knownDeadCards: string[];
    ignoredFoldedCardConditioning: true;
    confidenceScope: 'per-hand sampling only; excludes range/rake uncertainty and is not simultaneous across hands';
    method: 'physical compatible cards; wins plus half of heads-up ties';
    strategyScope: 'incremental Call EV versus Fold under explicit opponent assumptions; not GTO action frequencies';
  };
}

/** Convert completed physical-card equity to incremental EV; never infers range or rake from labels. */
export function evaluateAllInResponse(input: AllInResponseInput): AllInResponse | AllInUnavailable {
  const identified = identifyAllInResponse(input.game, input.history);
  if (!identified.available) return identified;
  if (!input.rake || input.rake.status !== 'known') return unavailable('unknown-rake', 'An explicit known rake percentage and cap are required; no EV signal is given for uncertain rake.');
  const { percent, capBb, noFlopNoDrop } = input.rake;
  if (!Number.isFinite(percent) || percent < 0 || percent >= 100 || !Number.isFinite(capBb) || capBb < 0 || typeof noFlopNoDrop !== 'boolean') {
    throw new Error('Known rake requires percent in [0, 100), a finite nonnegative cap, and noFlopNoDrop.');
  }
  const request = input.equityRequest;
  if (!request || !Array.isArray(request.opponents) || request.opponents.length !== 1 || (request.board?.length ?? 0) !== 0) {
    throw new Error('Preflop all-in EV requires one opponent and an unknown future board.');
  }
  new LocalEquityEngine(request); // Validate the supplied evidence request without drawing cards.
  createAllInEquityRequest(input.opponent, request);
  if (opponentKey(request.opponents[0]) !== opponentKey(input.opponent.model)) throw new Error('The equity request differs from the stated opponent assumption.');
  const rows = checkedResults(request, input.equity);
  const context = identified.context;
  // An all-in call runs out a board, so no-flop-no-drop never makes this called pot rake-free.
  const rakeBb = Math.min(context.potAfterCallBb * percent / 100, capBb);
  const evContext = { potBeforeCallBb: context.potBeforeCallBb, callBb: context.callBb, rakeBb,
    closesAction: true, noFurtherBetting: true, equalPotEligibility: true };
  const value = (equity: number) => {
    const evaluated = showdownCallEv(equity, evContext);
    if (!evaluated.available) throw new Error(evaluated.reason);
    return evaluated;
  };
  return {
    available: true, model: ALL_IN_RESPONSE_MODEL, context, rake: { ...input.rake, amountBb: rakeBb },
    breakEvenEquity: value(0).breakEvenEquity,
    hands: rows.map(row => {
      const low = value(row.confidence95[0]).evBb;
      const high = value(row.confidence95[1]).evBb;
      return { hand: row.hand, equity: row.equity, equityConfidence95: [...row.confidence95], samples: row.samples,
        callEvBb: value(row.equity).evBb, callEvConfidence95Bb: [low, high], foldEvBb: 0,
        signal: low > 0 ? 'call-favored' : high < 0 ? 'fold-favored' : 'uncertain' };
    }),
    assumptions: {
      opponent: structuredClone(input.opponent), equityModel: LOCAL_EQUITY_MODEL, seed: request.seed,
      knownDeadCards: [...(request.deadCards ?? [])], ignoredFoldedCardConditioning: true,
      confidenceScope: 'per-hand sampling only; excludes range/rake uncertainty and is not simultaneous across hands',
      method: 'physical compatible cards; wins plus half of heads-up ties',
      strategyScope: 'incremental Call EV versus Fold under explicit opponent assumptions; not GTO action frequencies',
    },
  };
}
