import { describe, expect, it } from 'vitest';
import { HANDS } from './poker';
import { evaluateSevenCards, LocalEquityEngine, parseEquityCard, showdownCallEv, type LocalEquityRequest } from './local-equity';

const cards = (text: string) => text.split(' ');
const rank = (text: string) => evaluateSevenCards(cards(text));
const base: LocalEquityRequest = { opponents: [{ kind: 'random' }], hands: ['AA'], samplesPerHand: 1000, seed: 12345 };
function calculate(request: LocalEquityRequest, batch = 500) {
  const engine = new LocalEquityEngine(request);
  while (!engine.progress().done) engine.step(batch, 1000);
  return engine.progress();
}

describe('independent seven-card showdown evaluator', () => {
  it('orders every hand category, including the weakest straight', () => {
    const examples = [
      'As Kd 9h 8c 6d 4s 2c', // high card
      'As Ad 9h 8c 6d 4s 2c', // pair
      'As Ad 9h 9c 6d 4s 2c', // two pair
      'As Ad Ah 9c 6d 4s 2c', // trips
      'As 2d 3h 4c 5d 9s Jc', // wheel
      'As Js 9s 6s 3s 2d 4c', // flush
      '2s 2d 2h 3c 3d 8s Ac', // full house
      '2s 2d 2h 2c 3d 8s Ac', // quads
      'As 2s 3s 4s 5s 8d Tc', // wheel straight flush
      'As Ks Qs Js Ts 8d 2c', // royal flush
    ].map(rank);
    for (let index = 1; index < examples.length; index += 1) expect(examples[index]).toBeGreaterThan(examples[index - 1]);
  });

  it('handles two trips, three pairs, flush kickers, and straight comparisons', () => {
    expect(rank('As Ad Ah Ks Kd Kh 2c')).toBeGreaterThan(rank('Ks Kd Kh Qs Qd Ah 2c'));
    expect(rank('As Ad Ks Kd Qs Qd 2c')).toBe(rank('As Ad Ks Kd Qc Jh 2c'));
    expect(rank('As Js 9s 6s 4s 2d 3c')).toBeGreaterThan(rank('As Js 9s 6s 3s 2d 4c'));
    expect(rank('2s 3d 4h 5c 6d 9s Jc')).toBeGreaterThan(rank('As 2d 3h 4c 5d 9s Jc'));
    expect(rank('As Ad Ah Ac Kd 8s 2c')).toBeGreaterThan(rank('As Ad Ah Ac Qd 8s 2c'));
  });

  it('uses the board for a tie and rejects invalid/duplicate cards', () => {
    expect(rank('As Ks Qs Js Ts 8d 2c')).toBe(rank('As Ks Qs Js Ts 9d 3c'));
    expect(() => rank('As As Qs Js Ts 8d 2c')).toThrow(/Duplicate/);
    expect(() => rank('As Ks Qs Js Ts')).toThrow(/seven/);
    expect(() => parseEquityCard('1s')).toThrow(/Invalid/);
  });

  it('matches an independent five-card combination evaluator on 500 deals', () => {
    function fiveCardScore(hand: string[]): number {
      const ranks = hand.map((card) => '23456789TJQKA'.indexOf(card[0]) + 2).sort((a, b) => b - a);
      const counts = new Map<number, number>();
      ranks.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
      const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
      const unique = [...counts.keys()];
      const straight = unique.length === 5 && ranks[0] - ranks[4] === 4 ? ranks[0] : unique.join(',') === '14,5,4,3,2' ? 5 : 0;
      const flush = hand.every((card) => card[1] === hand[0][1]);
      const ordered = groups.map(([value]) => value);
      let category = 0;
      let kickers = ranks;
      if (straight && flush) { category = 8; kickers = [straight]; }
      else if (groups[0][1] === 4) { category = 7; kickers = ordered; }
      else if (groups[0][1] === 3 && groups[1][1] === 2) { category = 6; kickers = ordered; }
      else if (flush) category = 5;
      else if (straight) { category = 4; kickers = [straight]; }
      else if (groups[0][1] === 3) { category = 3; kickers = ordered; }
      else if (groups[0][1] === 2 && groups[1][1] === 2) { category = 2; kickers = ordered; }
      else if (groups[0][1] === 2) { category = 1; kickers = ordered; }
      return category * 15 ** 5 + kickers.reduce((sum, value, index) => sum + value * 15 ** (4 - index), 0);
    }
    let randomState = 20261002;
    const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296; };
    for (let sample = 0; sample < 500; sample += 1) {
      const deck = [...'23456789TJQKA'].flatMap((value) => [...'cdhs'].map((suit) => value + suit));
      const seven: string[] = [];
      while (seven.length < 7) seven.push(deck.splice(Math.floor(random() * deck.length), 1)[0]);
      let best = 0;
      for (let first = 0; first < 7; first += 1) for (let second = first + 1; second < 7; second += 1) best = Math.max(best, fiveCardScore(seven.filter((_, index) => index !== first && index !== second)));
      expect(evaluateSevenCards(seven), seven.join(' ')).toBe(best);
    }
  });
});

describe('deterministic Monte Carlo equity under explicit models', () => {
  it('gives plausible independent AA versus random heads-up equity', () => {
    const result = calculate({ ...base, samplesPerHand: 5000 }).results[0];
    expect(result.equity).toBeGreaterThan(0.82);
    expect(result.equity).toBeLessThan(0.88);
    expect(result.standardError).toBeGreaterThan(0);
    expect(result.confidence95[0]).toBeLessThan(result.equity);
    expect(result.confidence95[1]).toBeGreaterThan(result.equity);
  });

  it('divides a nine-way board tie exactly and does not report all ties as a win', () => {
    const result = calculate({ ...base, opponents: Array.from({ length: 8 }, () => ({ kind: 'random' as const })), board: cards('As Ks Qs Js Ts'), hands: ['22'], samplesPerHand: 100 }).results[0];
    expect(result.equity).toBeCloseTo(1 / 9, 12);
    expect(result.winProbability).toBe(0);
    expect(result.tieProbability).toBe(1);
    expect(result.standardError).toBeCloseTo(0, 8);
  });

  it('respects exact cards, hero blockers, a known board and range weights', () => {
    const result = calculate({ ...base, hands: ['AsAd'], opponents: [{ kind: 'cards', cards: ['Ks', 'Kd'] }], board: cards('2c 3c 4c 7h 9s'), samplesPerHand: 100 }).results[0];
    expect(result.equity).toBe(1);
    const split = calculate({ ...base, hands: ['AsAd'], opponents: [{ kind: 'range', weights: { AA: 1 } }], board: cards('2c 3c 4c 7h 9s'), samplesPerHand: 100 }).results[0];
    expect(split.equity).toBe(0.5);
    expect(split.tieProbability).toBe(1);
    const weighted = calculate({ ...base, hands: ['AsAd'], opponents: [{ kind: 'range', weights: { AA: 100, KK: 1 } }], board: cards('2c 3c 4c 7h 9s'), samplesPerHand: 3000 }).results[0];
    // Hero blocks five of six AA combinations, while all six KK combinations remain.
    expect(weighted.equity).toBeCloseTo((100 * 0.5 + 6) / 106, 2);
  });

  it('preserves product-range weights under joint blocker conditioning', () => {
    const result = calculate({ ...base, hands: ['QsQd'], opponents: [{ kind: 'range', weights: { AA: 1, KK: 1 } }, { kind: 'range', weights: { AA: 1 } }], board: cards('Qh Kc 2d 3h 4s'), samplesPerHand: 3000 }).results[0];
    // Six AA/AA joint deals lose to QQ; eighteen KK/AA joint deals beat QQ.
    // Sequentially normalizing each range would incorrectly produce 2/3 here.
    expect(result.equity).toBeCloseTo(0.25, 1);
    const engine = new LocalEquityEngine({ ...base, hands: ['AsAd'], opponents: [{ kind: 'range', weights: { AA: 1 } }, { kind: 'range', weights: { AA: 1 } }], samplesPerHand: 2 });
    expect(() => { while (!engine.progress().done) engine.step(500, 1000); }).toThrow(/incompatible/);
  });

  it('is reproducible across different batch sizes and unrelated hand order', () => {
    const request = { ...base, hands: ['AKs', '72o'], samplesPerHand: 400 };
    const first = calculate(request, 7);
    expect(calculate(request, 500)).toEqual(first);
    const reverse = calculate({ ...request, hands: ['72o', 'AKs'] });
    expect(reverse.results).toEqual([...first.results].reverse());
    expect(calculate({ ...request, seed: 45 }).results).not.toEqual(first.results);
  });

  it.each([6, 7, 8, 9])('supports %i occupied/live players with legal unique deals', (players) => {
    const result = calculate({ ...base, opponents: Array.from({ length: players - 1 }, () => ({ kind: 'random' as const })), samplesPerHand: 300 }).results[0];
    expect(result.equity).toBeGreaterThan(0.2);
    expect(result.equity).toBeLessThan(0.65);
  });

  it('covers every one of the 169 hand classes and reports bounded progress', () => {
    const engine = new LocalEquityEngine({ ...base, hands: undefined, samplesPerHand: 2 });
    const progress = engine.step(1, 1000);
    expect(progress.completedHands).toBe(0);
    expect(progress.currentHandSamples).toBe(1);
    expect(progress.totalHands).toBe(169);
    while (!engine.progress().done) engine.step(100, 1000);
    expect(engine.progress().results.map((entry) => entry.hand)).toEqual(HANDS);
    expect(engine.progress().results.every((entry) => entry.samples === 2 && entry.equity >= 0 && entry.equity <= 1)).toBe(true);
  });

  it('supports heuristic models while preserving explicit source-independent provenance', () => {
    const result = calculate({ ...base, opponents: [{ kind: 'heuristic', topPercent: 20 }], samplesPerHand: 200 });
    expect(result.model).toBe('showdown-monte-carlo-v1');
    expect(result.results[0].equity).toBeGreaterThan(0.6);
  });

  it('rejects blocked cards, malformed weights, unsupported requests and overlapping known cards', () => {
    expect(() => calculate({ ...base, hands: ['AsAd'], deadCards: ['As'] })).toThrow(/blocked/);
    expect(() => new LocalEquityEngine({ ...base, board: ['As', 'As', '2s'] })).toThrow(/overlap/);
    expect(() => new LocalEquityEngine({ ...base, opponents: [{ kind: 'cards', cards: ['Ks', 'Kd'] }], deadCards: ['Ks'] })).toThrow(/overlap/);
    expect(() => new LocalEquityEngine({ ...base, opponents: [{ kind: 'range', weights: { AA: -1 } }] })).toThrow(/weight/);
    expect(() => new LocalEquityEngine({ ...base, opponents: [{ kind: 'range', weights: {} }] })).toThrow(/positive/);
    expect(() => new LocalEquityEngine({ ...base, opponents: [] })).toThrow(/opponents/);
    expect(() => new LocalEquityEngine({ ...base, samplesPerHand: Infinity })).toThrow(/samples/);
    expect(() => new LocalEquityEngine({ ...base, seed: -1 })).toThrow(/seed/);
    expect(() => new LocalEquityEngine({ ...base, hands: ['AKs', 'KAs'] })).toThrow(/unique/);
  });
});

describe('strictly scoped showdown call EV', () => {
  const context = { potBeforeCallBb: 90, callBb: 10, rakeBb: 0, closesAction: true, noFurtherBetting: true, equalPotEligibility: true };
  it('uses the existing pot plus call and counts the additional cost once', () => {
    expect(showdownCallEv(0.3, context)).toEqual({ available: true, evBb: 20, breakEvenEquity: 0.1 });
    expect(showdownCallEv(0.1, context)).toEqual({ available: true, evBb: 0, breakEvenEquity: 0.1 });
  });
  it('refuses to infer EV in the presence of future betting or side pots', () => {
    expect(showdownCallEv(0.3, { ...context, noFurtherBetting: false }).available).toBe(false);
    expect(showdownCallEv(0.3, { ...context, closesAction: false }).available).toBe(false);
    expect(showdownCallEv(0.3, { ...context, equalPotEligibility: false }).available).toBe(false);
  });
});
