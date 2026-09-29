import { EXTENDED_REFERENCE_PAGES, type ExtendedReferenceScenario } from '../data/extended-reference-pages';
import { CHART_REFERENCES, referencePage, type ChartReference } from '../data/references';
import type { Position, SpotKind } from './poker';
import { replayPreflop, type PreflopAction } from './preflop';
import type { TreeGame } from './tree-strategy';

export interface HistoryReferenceMatch {
  reference: ChartReference;
  page: number;
  note: string;
}

export const HISTORY_REFERENCE_NOTE = 'Position and action-line reference only. Verify bet sizes, rake and ante in the original source; this is not an exact strategy match.';

/**
 * Match published chart metadata to a legal, unfinished action history.
 * This does not return frequencies or certify that a chart's game assumptions fit.
 * All configured seat stacks must be exactly 100 BB; never substitute table size.
 */
export function findHistoryReferences(game: TreeGame, history: readonly PreflopAction[]): HistoryReferenceMatch[] {
  if (!game || game.format !== 'cash') return [];
  let state;
  try { state = replayPreflop(game, history); } catch { return []; }
  if (state.terminal || !state.nextActor) return [];
  if (state.seats.some((seat) => (game.stacksBb?.[seat.position] ?? game.stackBb) !== 100)) return [];

  const hero = state.nextActor;
  const nonFolds = history.filter((action) => action.type !== 'fold');
  const otherPlayersFolded = (villain: Position | null, extraSeat?: Position) => state.seats.every((seat) => seat.position === hero || seat.position === villain || seat.position === extraSeat || seat.folded);

  function extended(scenario: ExtendedReferenceScenario, villain: Position | null): HistoryReferenceMatch[] {
    return EXTENDED_REFERENCE_PAGES.filter((entry) => entry.scenario === scenario && entry.players === game.players && entry.format === game.format && entry.hero === hero && entry.villain === villain)
      .flatMap((entry) => {
        const reference = CHART_REFERENCES.find((item) => item.id === entry.referenceId && item.players === game.players && item.stackBb === 100 && item.format === game.format);
        return reference ? [{ reference, page: entry.page, note: `${HISTORY_REFERENCE_NOTE} Chart ${entry.chart}: ${entry.note}` }] : [];
      });
  }

  function simple(kind: SpotKind, villain: Position | null): HistoryReferenceMatch[] {
    return CHART_REFERENCES.flatMap((reference) => {
      const page = referencePage(reference, { players: game.players, stackBb: 100, format: game.format, hero, villain, kind });
      return page === null ? [] : [{ reference, page, note: HISTORY_REFERENCE_NOTE }];
    });
  }

  if (nonFolds.length === 0) {
    // Later positions have not acted yet. They are legitimate unopened-pot seats.
    if (hero === 'SB' && otherPlayersFolded(null, 'BB')) {
      const matches = extended('sb-unopened', null);
      if (matches.length) return matches; // Same SB chart as RFI; never count twice.
    }
    return simple('rfi', null);
  }

  if (nonFolds.length === 1 && nonFolds[0].type === 'call') {
    const limper = state.seats.find((seat) => seat.position === 'SB');
    if (hero === 'BB' && nonFolds[0].actor === 'SB' && otherPlayersFolded('SB') && limper?.committedBb === 1 && state.legal.check) {
      return extended('bb-vs-sb-limp', 'SB');
    }
    return [];
  }

  // Even a caller who subsequently folded changes the reached ranges. Never
  // discard calls/checks while reducing a cold-call or squeeze history to raises.
  if (nonFolds.some((action) => action.type !== 'raise')) return [];
  if (nonFolds.length === 1) {
    const villain = nonFolds[0].actor;
    // The ordinary charts do not establish a response to an opening shove.
    if (state.seats.find((seat) => seat.position === villain)?.allIn) return [];
    return simple('vs-open', villain);
  }

  if (nonFolds.length === 2) {
    const [open, threeBet] = nonFolds;
    if (open.actor !== hero || !otherPlayersFolded(threeBet.actor)) return [];
    if (state.seats.find((seat) => seat.position === threeBet.actor)?.allIn) return [];
    return simple('vs-3bet', threeBet.actor);
  }

  if (nonFolds.length === 3) {
    const [open, threeBet, fourBet] = nonFolds;
    if (threeBet.actor !== hero || open.actor !== fourBet.actor || !otherPlayersFolded(open.actor)) return [];
    if (state.seats.find((seat) => seat.position === fourBet.actor)?.allIn) return [];
    return simple('vs-4bet', open.actor);
  }

  if (nonFolds.length === 4) {
    const [open, threeBet, fourBet, fiveBet] = nonFolds;
    if (open.actor !== hero || fourBet.actor !== hero || threeBet.actor !== fiveBet.actor || !otherPlayersFolded(fiveBet.actor)) return [];
    if (fiveBet.amountBb !== 100 || !state.seats.find((seat) => seat.position === fiveBet.actor)?.allIn) return [];
    return extended('vs-5bet-shove', fiveBet.actor);
  }
  return [];
}
