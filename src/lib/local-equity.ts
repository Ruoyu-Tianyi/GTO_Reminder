import { HANDS, normalizeHand } from './poker';

/** This module estimates showdown equity under explicit opponent models. It is not a poker solver. */
export const LOCAL_EQUITY_MODEL = 'showdown-monte-carlo-v1' as const;
export type OpponentModel =
  | { kind: 'random' }
  | { kind: 'heuristic'; topPercent: number }
  | { kind: 'range'; weights: Record<string, number>; label?: string }
  | { kind: 'cards'; cards: [string, string] };

export interface LocalEquityRequest {
  /** Only opponents still contesting the pot, not all originally occupied seats. */
  opponents: OpponentModel[];
  /** Canonical 169 classes, or explicit cards such as AsKh. Default: all 169 classes. */
  hands?: string[];
  samplesPerHand: number;
  seed: number;
  board?: string[];
  deadCards?: string[];
}

export interface LocalEquityResult {
  hand: string;
  equity: number;
  winProbability: number;
  tieProbability: number;
  samples: number;
  standardError: number;
  /** Conservative per-hand Hoeffding interval; excludes opponent-model uncertainty. */
  confidence95: [number, number];
}

export interface LocalEquityProgress {
  model: typeof LOCAL_EQUITY_MODEL;
  completedHands: number;
  totalHands: number;
  currentHand: string | null;
  currentHandSamples: number;
  samplesPerHand: number;
  results: LocalEquityResult[];
  done: boolean;
}

type Combo = { a: number; b: number; weight: number };
type Distribution = { combos: Combo[]; cumulative: number[]; total: number };
type HeroPlan = { cards: [number, number]; distributions: Distribution[] };

const RANK_TEXT = '23456789TJQKA';
const SUIT_TEXT = 'cdhs';
const CATEGORY_SCALE = 15 ** 5;

export function parseEquityCard(card: string): number {
  if (typeof card !== 'string' || !/^[2-9TJQKA][cdhs]$/i.test(card)) throw new Error(`Invalid card: ${String(card)}.`);
  return RANK_TEXT.indexOf(card[0].toUpperCase()) * 4 + SUIT_TEXT.indexOf(card[1].toLowerCase());
}

function straightHigh(mask: number): number {
  for (let high = 14; high >= 6; high -= 1) if ((mask & (31 << (high - 4))) === (31 << (high - 4))) return high;
  return (mask & 16444) === 16444 ? 5 : 0; // A, 2, 3, 4, 5.
}

function score(category: number, ranks: number[]): number {
  let result = category * CATEGORY_SCALE;
  for (let index = 0; index < ranks.length; index += 1) result += ranks[index] * 15 ** (4 - index);
  return result;
}

/** Larger values win. Direct seven-card evaluation, including wheel and board-only ties. */
function rankSeven(cards: readonly number[]): number {
  const counts = new Uint8Array(15);
  const suitCounts = new Uint8Array(4);
  const suitMasks = new Int32Array(4);
  let mask = 0;
  for (const card of cards) {
    const rank = (card >> 2) + 2;
    const suit = card & 3;
    counts[rank] += 1;
    suitCounts[suit] += 1;
    suitMasks[suit] |= 1 << rank;
    mask |= 1 << rank;
  }
  let flushSuit = -1;
  for (let suit = 0; suit < 4; suit += 1) {
    if (suitCounts[suit] >= 5) {
      flushSuit = suit;
      const straight = straightHigh(suitMasks[suit]);
      if (straight) return score(8, [straight]);
    }
  }
  const quads: number[] = [];
  const trips: number[] = [];
  const pairs: number[] = [];
  const ranks: number[] = [];
  for (let rank = 14; rank >= 2; rank -= 1) {
    if (counts[rank]) ranks.push(rank);
    if (counts[rank] === 4) quads.push(rank);
    if (counts[rank] === 3) trips.push(rank);
    if (counts[rank] >= 2) pairs.push(rank);
  }
  if (quads.length) return score(7, [quads[0], ranks.find((rank) => rank !== quads[0])!]);
  const fullHousePair = trips.length ? pairs.find((rank) => rank !== trips[0]) : undefined;
  if (fullHousePair !== undefined) return score(6, [trips[0], fullHousePair]);
  if (flushSuit !== -1) return score(5, ranks.filter((rank) => (suitMasks[flushSuit] & (1 << rank)) !== 0).slice(0, 5));
  const straight = straightHigh(mask);
  if (straight) return score(4, [straight]);
  if (trips.length) return score(3, [trips[0], ...ranks.filter((rank) => rank !== trips[0]).slice(0, 2)]);
  if (pairs.length >= 2) return score(2, [pairs[0], pairs[1], ranks.find((rank) => rank !== pairs[0] && rank !== pairs[1])!]);
  if (pairs.length) return score(1, [pairs[0], ...ranks.filter((rank) => rank !== pairs[0]).slice(0, 3)]);
  return score(0, ranks.slice(0, 5));
}

export function evaluateSevenCards(cards: readonly string[]): number {
  if (cards.length !== 7) throw new Error('Exactly seven cards are required.');
  const parsed = cards.map(parseEquityCard);
  if (new Set(parsed).size !== 7) throw new Error('Duplicate cards are not allowed.');
  return rankSeven(parsed);
}

function classOf(a: number, b: number): string {
  const high = Math.max(a >> 2, b >> 2);
  const low = Math.min(a >> 2, b >> 2);
  return `${RANK_TEXT[high]}${RANK_TEXT[low]}${high === low ? '' : (a & 3) === (b & 3) ? 's' : 'o'}`;
}

const ALL_COMBOS: Combo[] = [];
for (let a = 0; a < 52; a += 1) for (let b = a + 1; b < 52; b += 1) ALL_COMBOS.push({ a, b, weight: 1 });

/** An explicitly heuristic order, not an equity table, solver range, or calibrated playing strategy. */
function heuristicStrength(hand: string): number {
  const high = RANK_TEXT.indexOf(hand[0]) + 2;
  const low = RANK_TEXT.indexOf(hand[1]) + 2;
  if (high === low) return 38 + high * 4;
  return high * 3 + low * 1.5 + (hand.endsWith('s') ? 5 : 0) - Math.max(0, high - low - 1) * 1.8 + (high === 14 && low <= 5 ? 2 : 0);
}

function opponentCombos(model: OpponentModel): Combo[] {
  if (!model || typeof model !== 'object') throw new Error('Opponent model is required.');
  if (model.kind === 'random') return ALL_COMBOS;
  if (model.kind === 'cards') {
    if (!Array.isArray(model.cards) || model.cards.length !== 2) throw new Error('A fixed opponent requires exactly two cards.');
    const [a, b] = model.cards.map(parseEquityCard);
    if (a === b) throw new Error('Fixed opponent cards must be distinct.');
    return [{ a, b, weight: 1 }];
  }
  let weights: Record<string, number>;
  if (model.kind === 'heuristic') {
    if (!Number.isFinite(model.topPercent) || model.topPercent < 1 || model.topPercent > 100) throw new Error('Heuristic topPercent must be between 1 and 100.');
    weights = {};
    let remaining = 1326 * model.topPercent / 100;
    for (const hand of [...HANDS].sort((a, b) => heuristicStrength(b) - heuristicStrength(a) || a.localeCompare(b))) {
      const combinations = hand.length === 2 ? 6 : hand.endsWith('s') ? 4 : 12;
      weights[hand] = Math.max(0, Math.min(1, remaining / combinations));
      remaining -= combinations;
    }
  } else if (model.kind === 'range') {
    if (!model.weights || typeof model.weights !== 'object' || Array.isArray(model.weights)) throw new Error('Range weights must be keyed by canonical hand class.');
    weights = model.weights;
    for (const [hand, weight] of Object.entries(weights)) {
      if (!HANDS.includes(hand) || !Number.isFinite(weight) || weight < 0 || weight > 1e9) throw new Error(`Invalid range weight for ${hand}.`);
    }
  } else throw new Error('Unknown opponent model.');
  const result = ALL_COMBOS.filter(({ a, b }) => (weights[classOf(a, b)] ?? 0) > 0).map(({ a, b }) => ({ a, b, weight: weights[classOf(a, b)] }));
  if (!result.length) throw new Error('Opponent range has no positive weights.');
  return result;
}

function distribution(combos: Combo[]): Distribution {
  let total = 0;
  const cumulative = combos.map((combo) => (total += combo.weight));
  return { combos, cumulative, total };
}

function draw(distribution: Distribution, random: () => number): Combo {
  const target = random() * distribution.total;
  let low = 0;
  let high = distribution.cumulative.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (target < distribution.cumulative[middle]) high = middle;
    else low = middle + 1;
  }
  return distribution.combos[low];
}

function seededRandom(seed: number, hand: string): () => number {
  let state = seed >>> 0;
  for (let index = 0; index < hand.length; index += 1) state = Math.imul(state ^ hand.charCodeAt(index), 16777619) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function canonicalInput(hand: string): string {
  if (typeof hand !== 'string') throw new Error('Hands must be strings.');
  if (/^([2-9TJQKA][cdhs]){2}$/i.test(hand)) {
    const a = parseEquityCard(hand.slice(0, 2));
    const b = parseEquityCard(hand.slice(2));
    if (a === b) throw new Error('Hero cards must be distinct.');
    return `${RANK_TEXT[a >> 2]}${SUIT_TEXT[a & 3]}${RANK_TEXT[b >> 2]}${SUIT_TEXT[b & 3]}`;
  }
  const canonical = normalizeHand(hand);
  if (!canonical || !HANDS.includes(canonical)) throw new Error(`Invalid hero hand: ${hand}.`);
  return canonical;
}

/** Synchronous bounded engine used by the worker and deterministic tests. */
export class LocalEquityEngine {
  readonly request: LocalEquityRequest;
  private readonly hands: string[];
  private readonly board: number[];
  private readonly dead: number[];
  private readonly known: number[];
  private readonly baseRanges: Combo[][];
  private readonly results: LocalEquityResult[] = [];
  private plans: HeroPlan[] = [];
  private random: () => number = () => 0;
  private samples = 0;
  private sum = 0;
  private sumSquares = 0;
  private wins = 0;
  private ties = 0;
  private rejections = 0;
  private pendingPlan: HeroPlan | null = null;

  constructor(request: LocalEquityRequest) {
    if (!request || !Array.isArray(request.opponents) || request.opponents.length < 1 || request.opponents.length > 8) throw new Error('Between 1 and 8 live opponents are required (2–9 players).');
    if (!Number.isInteger(request.samplesPerHand) || request.samplesPerHand < 1 || request.samplesPerHand > 1_000_000) throw new Error('samplesPerHand must be an integer from 1 to 1,000,000.');
    if (!Number.isInteger(request.seed) || request.seed < 0 || request.seed > 0xffffffff) throw new Error('seed must be an unsigned 32-bit integer.');
    if (request.hands !== undefined && (!Array.isArray(request.hands) || !request.hands.length || request.hands.length > 169)) throw new Error('Provide between 1 and 169 hero hands.');
    this.request = structuredClone(request);
    this.hands = (request.hands ?? HANDS).map(canonicalInput);
    if (new Set(this.hands).size !== this.hands.length) throw new Error('Hero hand labels must be unique.');
    this.board = (request.board ?? []).map(parseEquityCard);
    this.dead = (request.deadCards ?? []).map(parseEquityCard);
    if (![0, 3, 4, 5].includes(this.board.length)) throw new Error('The board must contain 0, 3, 4, or 5 cards.');
    this.baseRanges = request.opponents.map(opponentCombos);
    const fixed = this.baseRanges.flatMap((combos, index) => request.opponents[index].kind === 'cards' ? [combos[0].a, combos[0].b] : []);
    this.known = [...this.board, ...this.dead, ...fixed];
    if (new Set(this.known).size !== this.known.length) throw new Error('Board, dead cards, and fixed opponent cards cannot overlap.');
    if (this.dead.length + 2 + 2 * request.opponents.length + 5 > 52) throw new Error('Not enough cards remain to deal a complete board.');
  }

  private prepareHand(): void {
    const hand = this.hands[this.results.length];
    const fixedHero = hand.length === 4;
    const combos = fixedHero
      ? [{ a: parseEquityCard(hand.slice(0, 2)), b: parseEquityCard(hand.slice(2)), weight: 1 }]
      : ALL_COMBOS.filter(({ a, b }) => classOf(a, b) === hand);
    const known = new Set(this.known);
    let available = combos.filter(({ a, b }) => !known.has(a) && !known.has(b));
    // With no known suits, all suit realizations of a class are equivalent.
    if (!known.size) available = available.slice(0, 1);
    if (!available.length) throw new Error(`All combinations of ${hand} are blocked by known cards.`);
    this.plans = available.map(({ a, b }) => ({
      cards: [a, b],
      distributions: this.baseRanges.map((range, index) => distribution(range.filter((combo) => {
        if (combo.a === a || combo.a === b || combo.b === a || combo.b === b) return false;
        if (this.request.opponents[index].kind === 'cards') return true;
        return !known.has(combo.a) && !known.has(combo.b);
      }))),
    }));
    // A requested hand with impossible opponent support is rejected, never silently replaced by a random range.
    if (this.plans.some((plan) => plan.distributions.some((range) => !range.combos.length))) throw new Error(`Opponent range is entirely blocked for at least one combination of ${hand}. Use explicit hero cards or a compatible range.`);
    this.random = seededRandom(this.request.seed, hand);
  }

  private sample(): void {
    const plan = this.pendingPlan ?? this.plans[Math.floor(this.random() * this.plans.length)];
    this.pendingPlan = plan;
    const used = new Uint8Array(52);
    for (const card of [...this.board, ...this.dead, ...plan.cards]) used[card] = 1;
    const opponents: Combo[] = [];
    // Joint rejection preserves product range weights conditioned on no collision.
    // Sequential renormalization would bias earlier opponents toward heavily blocked holdings.
    for (const range of plan.distributions) {
      const combo = draw(range, this.random);
      if (used[combo.a] || used[combo.b]) {
        this.rejections += 1;
        if (this.rejections >= 20000) throw new Error('Opponent ranges are incompatible or too narrow to sample jointly. Broaden the model or use fewer live opponents.');
        return;
      }
      opponents.push(combo);
      used[combo.a] = 1;
      used[combo.b] = 1;
    }
    this.rejections = 0;
    this.pendingPlan = null;
    const board = [...this.board];
    while (board.length < 5) {
      const card = Math.floor(this.random() * 52);
      if (!used[card]) { used[card] = 1; board.push(card); }
    }
    const heroRank = rankSeven([...board, ...plan.cards]);
    let winners = 1;
    let lost = false;
    for (const opponent of opponents) {
      const rank = rankSeven([...board, opponent.a, opponent.b]);
      if (rank > heroRank) { lost = true; break; }
      if (rank === heroRank) winners += 1;
    }
    const share = lost ? 0 : 1 / winners;
    if (!lost && winners === 1) this.wins += 1;
    if (!lost && winners > 1) this.ties += 1;
    this.sum += share;
    this.sumSquares += share * share;
    this.samples += 1;
    if (this.samples === this.request.samplesPerHand) {
      const equity = this.sum / this.samples;
      const variance = this.samples > 1 ? Math.max(0, (this.sumSquares - this.sum * this.sum / this.samples) / (this.samples - 1)) : 0;
      const bound = Math.sqrt(Math.log(40) / (2 * this.samples));
      this.results.push({ hand: this.hands[this.results.length], equity, winProbability: this.wins / this.samples, tieProbability: this.ties / this.samples, samples: this.samples, standardError: Math.sqrt(variance / this.samples), confidence95: [Math.max(0, equity - bound), Math.min(1, equity + bound)] });
      this.plans = [];
      this.samples = this.sum = this.sumSquares = this.wins = this.ties = 0;
    }
  }

  /** maxAttempts counts rejected deals too, keeping even impossible range work bounded. */
  step(maxAttempts = 250, maxMilliseconds = 20): LocalEquityProgress {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10000) throw new Error('Batch attempts must be from 1 to 10,000.');
    if (!Number.isFinite(maxMilliseconds) || maxMilliseconds < 1 || maxMilliseconds > 1000) throw new Error('Batch time limit must be from 1 to 1,000 milliseconds.');
    const start = performance.now();
    for (let attempt = 0; attempt < maxAttempts && this.results.length < this.hands.length; attempt += 1) {
      if (!this.plans.length) this.prepareHand();
      this.sample();
      if (performance.now() - start >= maxMilliseconds) break;
    }
    return this.progress();
  }

  progress(): LocalEquityProgress {
    const done = this.results.length === this.hands.length;
    return { model: LOCAL_EQUITY_MODEL, completedHands: this.results.length, totalHands: this.hands.length, currentHand: done ? null : this.hands[this.results.length], currentHandSamples: this.samples, samplesPerHand: this.request.samplesPerHand, results: [...this.results], done };
  }
}

export interface ShowdownCallContext {
  potBeforeCallBb: number;
  callBb: number;
  /** Must include all opponents' final contributions; calling closes all action. */
  closesAction: boolean;
  noFurtherBetting: boolean;
  equalPotEligibility: boolean;
  /** A known total deduction, not an inferred rake percentage or unknown rake model. */
  rakeBb: number;
}

/** Incremental EV versus folding, only for a fully specified single showdown pot. */
export function showdownCallEv(equity: number, context: ShowdownCallContext): { available: true; evBb: number; breakEvenEquity: number } | { available: false; reason: string } {
  if (!Number.isFinite(equity) || equity < 0 || equity > 1) throw new Error('Equity must be between 0 and 1.');
  if (!context.closesAction || !context.noFurtherBetting) return { available: false, reason: 'Future betting or further opponent actions are not modeled.' };
  if (!context.equalPotEligibility) return { available: false, reason: 'Side pots or unequal pot eligibility require separate pot-by-pot equities.' };
  const { potBeforeCallBb, callBb, rakeBb } = context;
  if (![potBeforeCallBb, callBb, rakeBb].every((value) => Number.isFinite(value) && value >= 0) || rakeBb > potBeforeCallBb + callBb) throw new Error('Pot, call, and known rake must be valid nonnegative amounts.');
  const award = potBeforeCallBb + callBb - rakeBb;
  if (award <= 0) return { available: false, reason: 'The post-call pot after rake must be positive.' };
  return { available: true, evBb: equity * award - callBb, breakEvenEquity: callBb / award };
}

export type LocalEquityWorkerMessage = { type: 'progress' | 'complete'; progress: LocalEquityProgress } | { type: 'error'; message: string };
export interface LocalEquityCallbacks {
  onProgress?: (progress: LocalEquityProgress) => void;
  onComplete: (progress: LocalEquityProgress) => void;
  onError: (message: string) => void;
}
