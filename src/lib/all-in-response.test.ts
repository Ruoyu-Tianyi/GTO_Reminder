import { describe, expect, it } from 'vitest';
import { getPositions } from './poker';
import type { PreflopAction } from './preflop';
import type { TreeGame } from './tree-strategy';
import { LOCAL_EQUITY_MODEL, LocalEquityEngine, type LocalEquityProgress, type LocalEquityRequest } from './local-equity';
import {
  createAllInEquityRequest, evaluateAllInResponse, identifyAllInResponse,
  type AllInOpponentAssumption, type AllInRake, type AllInResponseInput,
} from './all-in-response';

const game: TreeGame = { players: 6, stackBb: 100, anteBb: 0, format: 'cash', rake: 'Text is not a numeric rake contract' };
const history: PreflopAction[] = [
  { actor: 'UTG', type: 'raise', amountBb: 2.5 }, { actor: 'HJ', type: 'fold' }, { actor: 'CO', type: 'fold' },
  { actor: 'BTN', type: 'raise', amountBb: 10 }, { actor: 'SB', type: 'fold' }, { actor: 'BB', type: 'fold' },
  { actor: 'UTG', type: 'raise', amountBb: 30 }, { actor: 'BTN', type: 'raise', amountBb: 100 },
];
const rake: AllInRake = { status: 'known', percent: 5, capBb: 2.5, noFlopNoDrop: true };
const opponent: AllInOpponentAssumption = { label: 'Assumed top 10%, not inferred from this action line', model: { kind: 'heuristic', topPercent: 10 } };
const request = createAllInEquityRequest(opponent, { hands: ['AKs'], samplesPerHand: 10000, seed: 123 });

/** Synthetic sample proportions for testing EV arithmetic, not published strategy data. */
function toyProgress(winProbability: number, tieProbability = 0): LocalEquityProgress {
  const samples = 10000;
  const equity = winProbability + tieProbability / 2;
  const bound = Math.sqrt(Math.log(40) / (2 * samples));
  return { model: LOCAL_EQUITY_MODEL, done: true, completedHands: 1, totalHands: 1, currentHand: null,
    currentHandSamples: 0, samplesPerHand: samples, results: [{ hand: 'AKs', samples, equity, winProbability, tieProbability,
      standardError: Math.sqrt(Math.max(0, winProbability + tieProbability / 4 - equity ** 2) / (samples - 1)),
      confidence95: [Math.max(0, equity - bound), Math.min(1, equity + bound)] }] };
}
const input = (equity = toyProgress(0.5)): AllInResponseInput => ({ game, history, rake, opponent, equityRequest: request, equity });

describe('terminal heads-up all-in recognition', () => {
  it.each([6, 7, 8, 9])('recognizes a %i-seat table after all unrelated seats have folded', players => {
    const positions = getPositions(players);
    const expanded: PreflopAction[] = [
      { actor: 'UTG', type: 'raise', amountBb: 2.5 },
      ...positions.slice(1, positions.indexOf('BTN')).map(actor => ({ actor, type: 'fold' as const })),
      ...history.slice(3),
    ];
    const found = identifyAllInResponse({ ...game, players }, expanded);
    expect(found.available).toBe(true);
    if (!found.available) return;
    expect(found.context).toMatchObject({ hero: 'UTG', villain: 'BTN', callBb: 70, potBeforeCallBb: 131.5, potAfterCallBb: 201.5 });
    expect(found.context.foldedSeats).toHaveLength(players - 2);
  });

  it('supports a covering hero against a shorter shove when no money is returned', () => {
    const shortHistory = [...history.slice(0, -1), { actor: 'BTN' as const, type: 'raise' as const, amountBb: 50 }];
    const found = identifyAllInResponse({ ...game, stacksBb: { BTN: 50 } }, shortHistory);
    expect(found.available).toBe(true);
    if (found.available) expect(found.context).toMatchObject({ callBb: 20, potAfterCallBb: 101.5, heroRemainingAfterCallBb: 50 });
  });

  it('refuses an oversized shove requiring an uncalled refund after a short call', () => {
    expect(identifyAllInResponse({ ...game, stacksBb: { UTG: 60 } }, history)).toMatchObject({ available: false, reason: 'uncalled-refund' });
    expect(identifyAllInResponse({ ...game, stacksBb: { UTG: 99.999999999 } }, history)).toMatchObject({ available: false, reason: 'uncalled-refund' });
  });

  it('refuses multiple all-in opponents and side-pot situations', () => {
    const multi: PreflopAction[] = [
      { actor: 'UTG', type: 'raise', amountBb: 100 }, { actor: 'HJ', type: 'call' }, { actor: 'CO', type: 'fold' },
      { actor: 'BTN', type: 'fold' }, { actor: 'SB', type: 'fold' },
    ];
    expect(identifyAllInResponse({ ...game, stacksBb: { HJ: 50 } }, multi)).toMatchObject({ available: false, reason: 'multiple-opponents' });
  });

  it('refuses non-all-in 4-bets, closed action, and invalid action order', () => {
    expect(identifyAllInResponse(game, history.slice(0, -1))).toMatchObject({ available: false, reason: 'opponent-not-all-in' });
    expect(identifyAllInResponse(game, [...history, { actor: 'UTG', type: 'call' }])).toMatchObject({ available: false, reason: 'closed-action' });
    expect(identifyAllInResponse(game, [{ actor: 'BTN', type: 'raise', amountBb: 100 }])).toMatchObject({ available: false, reason: 'invalid-history' });
  });

  it('retains antes and dead folded blinds in the common pot', () => {
    const withAnte: PreflopAction[] = [...history.slice(0, -1), { actor: 'BTN', type: 'raise', amountBb: 99 }];
    const found = identifyAllInResponse({ ...game, anteBb: 1 }, withAnte);
    expect(found.available).toBe(true);
    if (found.available) expect(found.context).toMatchObject({ callBb: 69, potBeforeCallBb: 136.5, potAfterCallBb: 205.5 });
  });
});

describe('conditional all-in EV from completed physical-card equity', () => {
  it('counts each contribution once and takes rake even with no-flop-no-drop', () => {
    const result = evaluateAllInResponse(input());
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.rake.amountBb).toBe(2.5);
    expect(result.breakEvenEquity).toBeCloseTo(70 / 199, 12);
    expect(result.hands[0]).toMatchObject({ callEvBb: 29.5, foldEvBb: 0, signal: 'call-favored' });
    expect(result.hands[0].callEvConfidence95Bb[0]).toBeCloseTo(toyProgress(0.5).results[0].confidence95[0] * 199 - 70, 12);
    expect(result.assumptions.opponent).toEqual(opponent);
    expect(result.assumptions.ignoredFoldedCardConditioning).toBe(true);
    expect(result.assumptions.strategyScope).toContain('not GTO');
    expect(result.hands[0]).not.toHaveProperty('frequencies');
  });

  it('uses a zero-rake or percentage-limited contract without reading the free-text label', () => {
    const zero = evaluateAllInResponse({ ...input(), rake: { status: 'known', percent: 0, capBb: 2.5, noFlopNoDrop: true } });
    const percentLimited = evaluateAllInResponse({ ...input(), rake: { status: 'known', percent: 1, capBb: 10, noFlopNoDrop: false } });
    if (!zero.available || !percentLimited.available) throw Error('Expected valid EV');
    expect(zero.hands[0].callEvBb).toBe(30.75);
    expect(percentLimited.rake.amountBb).toBeCloseTo(2.015, 12);
  });

  it('divides HU ties in half and distinguishes fold-favored from uncertain samples', () => {
    const tie = evaluateAllInResponse(input(toyProgress(0.2, 0.2)));
    const fold = evaluateAllInResponse(input(toyProgress(0.1)));
    const borderline = evaluateAllInResponse(input(toyProgress(0.35)));
    if (!tie.available || !fold.available || !borderline.available) throw Error('Expected valid EV');
    expect(tie.hands[0].equity).toBeCloseTo(0.3, 12);
    expect(tie.hands[0].callEvBb).toBeCloseTo(-10.3, 12);
    expect(fold.hands[0].signal).toBe('fold-favored');
    expect(borderline.hands[0].signal).toBe('uncertain');
    expect(borderline.hands[0].callEvConfidence95Bb[0]).toBeLessThan(0);
    expect(borderline.hands[0].callEvConfidence95Bb[1]).toBeGreaterThan(0);
  });

  it('consumes the existing engine with exact known-card assumptions and no new sampler', () => {
    const exactOpponent: AllInOpponentAssumption = { label: 'Assumed Ks Kd', model: { kind: 'cards', cards: ['Ks', 'Kd'] } };
    const exactRequest = createAllInEquityRequest(exactOpponent, { hands: ['AsAd'], samplesPerHand: 1000, seed: 42 });
    const engine = new LocalEquityEngine(exactRequest);
    while (!engine.progress().done) engine.step(1000, 1000);
    const equity = engine.progress();
    const result = evaluateAllInResponse({ ...input(), opponent: exactOpponent, equityRequest: exactRequest, equity });
    if (!result.available) throw Error('Expected valid EV');
    expect(result.hands[0].equity).toBeGreaterThan(0.7);
    expect(result.hands[0].equity).toBeLessThan(0.95);
    expect(result.hands[0].callEvBb).toBeCloseTo(equity.results[0].equity * 199 - 70, 12);
  });

  it('gives no EV signal when rake is unknown', () => {
    const result = evaluateAllInResponse({ ...input(), rake: { status: 'unknown', reason: 'cap not provided' } });
    expect(result).toMatchObject({ available: false, reason: 'unknown-rake' });
    expect(result).not.toHaveProperty('hands');
  });

  it.each([
    { status: 'known', percent: NaN, capBb: 2.5, noFlopNoDrop: true },
    { status: 'known', percent: 100, capBb: 2.5, noFlopNoDrop: true },
    { status: 'known', percent: 5, capBb: -1, noFlopNoDrop: true },
  ] as AllInRake[])('rejects malformed rake contracts', bad => {
    expect(() => evaluateAllInResponse({ ...input(), rake: bad })).toThrow(/rake/);
  });

  it('rejects future-board information, a different opponent model, and incomplete results', () => {
    expect(() => evaluateAllInResponse({ ...input(), equityRequest: { ...request, board: ['As', 'Ks', 'Qs'] } })).toThrow(/unknown future board/);
    expect(() => evaluateAllInResponse({ ...input(), opponent: { label: 'different', model: { kind: 'random' } } })).toThrow(/differs/);
    expect(() => evaluateAllInResponse({ ...input(), equity: { ...toyProgress(0.5), done: false } })).toThrow(/completed/);
    expect(() => evaluateAllInResponse({ ...input(), equityRequest: { ...request, samplesPerHand: 500 } })).toThrow(/completed/);
  });

  it('rejects fabricated tight intervals and a multiway tie share mislabeled as heads-up', () => {
    const tight = toyProgress(0.35);
    tight.results[0].confidence95 = [0.35, 0.35];
    expect(() => evaluateAllInResponse(input(tight))).toThrow(/sampling interval/);
    const nineWay = toyProgress(0, 1);
    nineWay.results[0].equity = 1 / 9;
    expect(() => evaluateAllInResponse(input(nineWay))).toThrow(/ties/);
  });

  it('validates range support and requires an explicit assumption label', () => {
    expect(() => createAllInEquityRequest({ label: '', model: { kind: 'random' } }, request)).toThrow(/Describe/);
    expect(() => createAllInEquityRequest({ label: 'empty', model: { kind: 'range', weights: {} } }, request)).toThrow(/positive/);
    const weights = { AA: 1, KK: 0.5 };
    const built: LocalEquityRequest = createAllInEquityRequest({ label: 'assumed narrow', model: { kind: 'range', weights } }, request);
    weights.AA = 0;
    expect(built.opponents[0]).toEqual({ kind: 'range', weights: { AA: 1, KK: 0.5 } });
  });

  it('compares range weights independently of label and object-key order', () => {
    const range = { label: 'Assumed AA/KK', model: { kind: 'range' as const, weights: { AA: 1, KK: 0.5 } } };
    const rangeRequest = createAllInEquityRequest(range, request);
    const result = evaluateAllInResponse({ ...input(), equityRequest: rangeRequest,
      opponent: { label: 'Same weights reordered', model: { kind: 'range', weights: { KK: 0.5, AA: 1 } } } });
    expect(result.available).toBe(true);
  });
});
