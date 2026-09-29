import type { Position } from '../lib/poker';

export type ExtendedReferenceScenario =
  | 'sb-unopened'
  | 'bb-vs-sb-limp'
  | 'vs-5bet-shove';

export interface ExtendedReferencePage {
  id: string;
  referenceId: 'pokercoaching-8max-100bb';
  players: 8;
  stackBb: 100;
  format: 'cash';
  hero: Position;
  villain: Position | null;
  scenario: ExtendedReferenceScenario;
  page: number;
  /** Reading order in the two-column source page; starts at 1. */
  chart: number;
  /** The visible source heading, without reconstructing the text layer. */
  title: string;
  note: string;
}

/**
 * Visually reviewed on 2026-09-29 against the original public PDF:
 * https://poker-coaching.s3.amazonaws.com/tools/preflop-charts/The%20Ultimate%20Cash%20Game%20Preflop%20Guide.pdf
 * SHA-256: 2927bdf938a52d95aa53716e5bf61705216da8685d17572775c6f11a0ecd7df9
 *
 * Metadata only: no numerical strategy frequencies are reproduced.
 * The 25 unambiguous Facing 5-Bet charts are distinct from the existing index.
 * SB unopened is the SAME source chart as the existing SB RFI entry on page 5,
 * so it must not be counted as an additional unique source chart.
 *
 * Matching a full action history requires all three conditions below:
 * - Exactly 8 players and Cash 100 BB, with hero currently to act.
 * - All other players folded, with no limpers, callers, squeezes or cold raises.
 * - For vs-5bet-shove: hero Open -> villain 3-Bet -> hero 4-Bet ->
 *   villain 5-Bet All-In. Hero is the original opener, not a cold 4-bettor.
 *   The source response is Call/Fold. Its earlier sizing assumptions must be
 *   checked in the source charts before claiming an exact strategy match.
 * - For bb-vs-sb-limp: everyone before SB Fold -> SB Limp -> BB to act.
 *   There must be no raise. The source labels the free passive option "Call",
 *   but poker rules make this Check, not an additional call or an overlimp.
 * - For sb-unopened: all six seats before SB Fold -> SB to act. There is no
 *   prior open. Source Raise 4 BB / Call / Fold means Raise / Limp / Fold.
 *
 * Missing: UTG vs UTG+1 Facing 5-Bet, and SB limp/facing BB isolation raise.
 * Conflicting visual headings are recorded separately below and NOT indexed.
 */
const base = {
  referenceId: 'pokercoaching-8max-100bb',
  players: 8,
  stackBb: 100,
  format: 'cash',
} as const;

const fiveBetNote = 'Hero opened, faced a 3-Bet, made a 4-Bet, and now faces the same opponent\'s 5-Bet All-In; all other players folded. Verify prior sizes in the source. Black cells are absent from the reached range, not a Fold recommendation.';

function facingFiveBet(page: number, chart: number, hero: Position, villain: Position): ExtendedReferencePage {
  return {
    ...base,
    id: `pokercoaching-8max-100bb-vs-5bet-${hero.toLowerCase().replace('+', 'plus')}-${villain.toLowerCase().replace('+', 'plus')}`,
    hero, villain, scenario: 'vs-5bet-shove', page, chart,
    title: `${hero} vs ${villain} · 5-Bet All-In`, note: fiveBetNote,
  };
}

export const EXTENDED_REFERENCE_PAGES: ReadonlyArray<ExtendedReferencePage> = [
  {
    ...base, id: 'pokercoaching-8max-100bb-sb-unopened',
    hero: 'SB', villain: null, scenario: 'sb-unopened', page: 5, chart: 1,
    title: 'SB · RFI',
    note: 'All preceding seats folded. The source offers Raise 4 BB, Call (SB Limp), and Fold. This is the same page-5 SB RFI chart already in the original index, not a new unique chart.',
  },
  {
    ...base, id: 'pokercoaching-8max-100bb-bb-vs-sb-limp',
    hero: 'BB', villain: 'SB', scenario: 'bb-vs-sb-limp', page: 12, chart: 5,
    title: 'BB vs SB · Limp',
    note: 'Everyone before SB folded, then SB completed to 1 BB. The source offers Raise 4 BB and labels the other option Call. At this node BB owes no chips, so the passive option is Check. This is not the BB vs SB RFI chart on the same page.',
  },
  facingFiveBet(23, 1, 'UTG', 'LJ'),
  facingFiveBet(23, 2, 'UTG', 'HJ'),
  facingFiveBet(23, 3, 'UTG', 'CO'),
  facingFiveBet(23, 4, 'UTG', 'BTN'),
  facingFiveBet(23, 5, 'UTG', 'SB'),
  facingFiveBet(23, 6, 'UTG', 'BB'),
  facingFiveBet(24, 1, 'UTG+1', 'LJ'),
  facingFiveBet(24, 2, 'UTG+1', 'HJ'),
  facingFiveBet(24, 3, 'UTG+1', 'CO'),
  facingFiveBet(24, 4, 'UTG+1', 'BTN'),
  facingFiveBet(24, 5, 'UTG+1', 'SB'),
  facingFiveBet(25, 1, 'LJ', 'HJ'),
  facingFiveBet(25, 2, 'LJ', 'CO'),
  facingFiveBet(25, 3, 'LJ', 'BTN'),
  facingFiveBet(25, 4, 'LJ', 'SB'),
  facingFiveBet(25, 5, 'LJ', 'BB'),
  facingFiveBet(25, 6, 'HJ', 'CO'),
  facingFiveBet(26, 1, 'HJ', 'BTN'),
  facingFiveBet(26, 2, 'HJ', 'SB'),
  facingFiveBet(26, 3, 'HJ', 'BB'),
  facingFiveBet(26, 4, 'CO', 'BTN'),
  facingFiveBet(26, 5, 'CO', 'SB'),
  facingFiveBet(27, 1, 'BTN', 'SB'),
  facingFiveBet(27, 2, 'BTN', 'BB'),
  facingFiveBet(27, 3, 'SB', 'BB'),
];

/** Source defects retained for audit; never promote these to matched nodes. */
export const EXTENDED_REFERENCE_ISSUES = [
  {
    page: 24, chart: 6,
    visibleTitle: 'UTG+1 vs SB · 5-Bet All-In',
    textLayerTitle: 'UTG+1 vs BB · 5-Bet All-In',
    note: 'The bottom-left chart already has the consistent UTG+1 vs SB heading. The bottom-right chart conflicts with its text layer and is excluded; do not silently rename it BB.',
  },
  {
    page: 26, chart: 6,
    visibleTitle: 'CO vs SB · 5-Bet All-In',
    textLayerTitle: 'CO vs BB · 5-Bet All-In',
    note: 'The bottom-left chart already has the consistent CO vs SB heading. The bottom-right chart conflicts with its text layer and is excluded; do not silently rename it BB.',
  },
] as const;
