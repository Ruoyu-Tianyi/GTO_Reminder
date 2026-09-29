import { describe, expect, it } from 'vitest';
import { EXTENDED_REFERENCE_PAGES } from '../data/extended-reference-pages';
import { POKERCOACHING_PAGES } from '../data/pokercoaching-pages';
import { CHART_REFERENCES, referencePage } from '../data/references';
import { getPositions, type Position, type SpotKind } from './poker';
import { replayPreflop, type PreflopAction } from './preflop';
import { buildPreset } from './preflop-presets';
import { findHistoryReferences } from './tree-references';
import type { TreeGame } from './tree-strategy';

const GAME: TreeGame = { players: 8, stackBb: 100, anteBb: 0, format: 'cash', rake: 'unverified reference profile' };
const fold = (actor: Position): PreflopAction => ({ actor, type: 'fold' });
const call = (actor: Position): PreflopAction => ({ actor, type: 'call' });
const raise = (actor: Position, amountBb: number): PreflopAction => ({ actor, type: 'raise', amountBb });

function foldTo(game: TreeGame, history: PreflopAction[], actor: Position): void {
  for (let count = 0; count < game.players; count += 1) {
    const current = replayPreflop(game, history).nextActor;
    if (current === actor) return;
    if (!current) throw new Error(`Hand closed before ${actor} could act.`);
    history.push(fold(current));
  }
  throw new Error(`Could not reach ${actor}.`);
}

function line(game: TreeGame, kind: SpotKind | 'vs-5bet', hero: Position, villain: Position | null): PreflopAction[] {
  const history: PreflopAction[] = [];
  if (kind === 'rfi') { foldTo(game, history, hero); return history; }
  if (!villain) throw new Error('Response line requires a villain.');
  const opener = kind === 'vs-open' || kind === 'vs-4bet' ? villain : hero;
  const threeBettor = opener === hero ? villain : hero;
  foldTo(game, history, opener);
  history.push(raise(opener, 3));
  if (kind === 'vs-open') { foldTo(game, history, hero); return history; }
  foldTo(game, history, threeBettor);
  history.push(raise(threeBettor, 10));
  foldTo(game, history, opener);
  if (kind === 'vs-3bet') return history;
  history.push(raise(opener, 25));
  if (kind === 'vs-4bet') return history;
  history.push(raise(threeBettor, 100));
  return history;
}

describe('simple reference lines from complete action histories', () => {
  it('matches every existing unambiguous 8-max chart without promoting the CO versus BB gap', () => {
    for (const entry of POKERCOACHING_PAGES) {
      const history = line(GAME, entry.kind, entry.hero, entry.villain ?? null);
      expect(replayPreflop(GAME, history).nextActor).toBe(entry.hero);
      const matches = findHistoryReferences(GAME, history);
      expect(matches).toHaveLength(1);
      expect(matches[0].reference.id).toBe('pokercoaching-8max-100bb');
      expect(matches[0].page).toBe(entry.page);
    }
    expect(findHistoryReferences(GAME, line(GAME, 'vs-3bet', 'CO', 'BB'))).toEqual([]);
  });

  it.each([[6, 35], [9, 80]] as const)('preserves the %i-max reference topology with exactly %i simple matches', (players, expected) => {
    const game = { ...GAME, players };
    const reference = CHART_REFERENCES.find((entry) => entry.players === players)!;
    const positions = getPositions(players);
    let matched = 0;
    for (const hero of positions) {
      if (hero !== 'BB') {
        const matches = findHistoryReferences(game, line(game, 'rfi', hero, null));
        expect(matches[0].page).toBe(reference.rfiPage);
        matched += matches.length;
      }
      for (const villain of positions) {
        if (positions.indexOf(villain) < positions.indexOf(hero)) {
          for (const kind of ['vs-open', 'vs-4bet'] as const) {
            const matches = findHistoryReferences(game, line(game, kind, hero, villain));
            const page = referencePage(reference, { ...game, hero, villain, kind });
            expect(matches.map((entry) => entry.page)).toEqual(page === null ? [] : [page]);
            matched += matches.length;
          }
        } else if (positions.indexOf(villain) > positions.indexOf(hero)) {
          const matches = findHistoryReferences(game, line(game, 'vs-3bet', hero, villain));
          expect(matches[0].page).toBe(referencePage(reference, { ...game, hero, villain, kind: 'vs-3bet' }));
          matched += matches.length;
        }
      }
    }
    expect(matched).toBe(expected);
  });

  it('allows unacted later seats in RFI and Facing Open, while preserving the current actor', () => {
    const unopened = findHistoryReferences(GAME, []);
    expect(unopened.map((entry) => entry.page)).toEqual([4]);
    const earlyResponse = [raise('UTG', 3)];
    expect(replayPreflop(GAME, earlyResponse).nextActor).toBe('UTG+1');
    expect(findHistoryReferences(GAME, earlyResponse).map((entry) => entry.page)).toEqual([8]);
  });

  it('does not label a cold 4-bet opportunity as the opener facing a 3-bet', () => {
    const history = buildPreset(GAME, 'cold-four');
    expect(replayPreflop(GAME, history).nextActor).toBe('SB');
    expect(findHistoryReferences(GAME, history)).toEqual([]);
  });

  it('does not link an ordinary response chart to an Open, 3-Bet or 4-Bet shove', () => {
    expect(findHistoryReferences(GAME, [raise('UTG', 100)])).toEqual([]);
    const threeBet = line(GAME, 'vs-3bet', 'UTG', 'BTN');
    threeBet.find((action) => action.actor === 'BTN' && action.type === 'raise')!.amountBb = 100;
    expect(findHistoryReferences(GAME, threeBet)).toEqual([]);
    const fourBet = line(GAME, 'vs-4bet', 'BTN', 'UTG');
    fourBet[fourBet.length - 1].amountBb = 100;
    expect(findHistoryReferences(GAME, fourBet)).toEqual([]);
  });
});

describe('extended blind and 5-bet reference lines', () => {
  it('returns SB unopened once with its Limp interpretation rather than double-counting RFI', () => {
    const history = line(GAME, 'rfi', 'SB', null);
    const matches = findHistoryReferences(GAME, history);
    expect(matches).toHaveLength(1);
    expect(matches[0].page).toBe(5);
    expect(matches[0].note).toContain('SB Limp');
  });

  it('distinguishes BB versus SB Limp from BB versus SB Open on the shared source page', () => {
    const limp = buildPreset(GAME, 'limp');
    const state = replayPreflop(GAME, limp);
    expect(state.nextActor).toBe('BB');
    expect(state.legal.check).toBe(true);
    const matches = findHistoryReferences(GAME, limp);
    expect(matches).toHaveLength(1);
    expect(matches[0].page).toBe(12);
    expect(matches[0].note).toContain('Chart 5');
    expect(matches[0].note).toContain('Check');
    expect(findHistoryReferences(GAME, line(GAME, 'vs-open', 'BB', 'SB'))[0].note).not.toContain('Chart 5');
    expect(findHistoryReferences(GAME, buildPreset(GAME, 'limp-raise'))).toEqual([]);
  });

  it('matches exactly the 25 visually unambiguous 5-bet shove charts', () => {
    const entries = EXTENDED_REFERENCE_PAGES.filter((entry) => entry.scenario === 'vs-5bet-shove');
    expect(entries).toHaveLength(25);
    for (const entry of entries) {
      const history = line(GAME, 'vs-5bet', entry.hero, entry.villain);
      const state = replayPreflop(GAME, history);
      expect(state.nextActor).toBe(entry.hero);
      expect(state.legal.raise).toBe(false);
      const matches = findHistoryReferences(GAME, history);
      expect(matches).toHaveLength(1);
      expect(matches[0].reference.id).toBe(entry.referenceId);
      expect(matches[0].page).toBe(entry.page);
      expect(matches[0].note).toContain(`Chart ${entry.chart}`);
    }
  });

  it.each([['UTG', 'UTG+1'], ['UTG+1', 'BB'], ['CO', 'BB']] as const)('does not fill the missing/ambiguous %s versus %s 5-bet chart', (hero, villain) => {
    expect(findHistoryReferences(GAME, line(GAME, 'vs-5bet', hero, villain))).toEqual([]);
  });

  it('requires a genuine final 100 BB shove, not just a fourth raise', () => {
    const history = line(GAME, 'vs-5bet', 'UTG', 'BTN');
    history[history.length - 1].amountBb = 60;
    expect(replayPreflop(GAME, history).currentBetBb).toBe(60);
    expect(findHistoryReferences(GAME, history)).toEqual([]);
    history[history.length - 1].amountBb = 100;
    expect(findHistoryReferences(GAME, history)).toHaveLength(1);
  });
});

describe('rejecting different or multiway histories', () => {
  it('does not discard callers when matching a squeeze or an unresolved multiway pot', () => {
    expect(findHistoryReferences(GAME, buildPreset(GAME, 'squeeze'))).toEqual([]);
    const history: PreflopAction[] = [raise('UTG', 3), call('UTG+1'), raise('LJ', 12), fold('HJ'), fold('CO'), fold('BTN'), fold('SB'), fold('BB')];
    expect(replayPreflop(GAME, history).nextActor).toBe('UTG');
    expect(findHistoryReferences(GAME, history)).toEqual([]);
  });

  it('rejects a caller even after they folded before the nominal heads-up 5-bet decision', () => {
    const history: PreflopAction[] = [raise('UTG', 3), call('UTG+1'), raise('LJ', 10), fold('HJ'), fold('CO'), fold('BTN'), fold('SB'), fold('BB'), raise('UTG', 25), fold('UTG+1'), raise('LJ', 100)];
    expect(replayPreflop(GAME, history).nextActor).toBe('UTG');
    expect(findHistoryReferences(GAME, history)).toEqual([]);
  });

  it('rejects limpers, overlimpers, limp isolation and cold raises by a third player', () => {
    expect(findHistoryReferences(GAME, [call('UTG')])).toEqual([]);
    const overlimp = line(GAME, 'rfi', 'BTN', null);
    overlimp.push(call('BTN'), call('SB'));
    expect(replayPreflop(GAME, overlimp).nextActor).toBe('BB');
    expect(findHistoryReferences(GAME, overlimp)).toEqual([]);
    const isolation: PreflopAction[] = [call('UTG'), raise('UTG+1', 4)];
    expect(findHistoryReferences(GAME, isolation)).toEqual([]);
    const coldRaise: PreflopAction[] = [raise('UTG', 3), raise('UTG+1', 10), raise('LJ', 25), fold('HJ'), fold('CO'), fold('BTN'), fold('SB'), fold('BB')];
    expect(replayPreflop(GAME, coldRaise).nextActor).toBe('UTG');
    expect(findHistoryReferences(GAME, coldRaise)).toEqual([]);
  });

  it('requires actual 100 BB stacks in every seat, including already-folded players', () => {
    const history = line(GAME, 'vs-open', 'BB', 'BTN');
    expect(findHistoryReferences({ ...GAME, stackBb: 99 }, history)).toEqual([]);
    expect(findHistoryReferences({ ...GAME, stacksBb: { UTG: 50 } }, history)).toEqual([]);
    expect(findHistoryReferences({ ...GAME, stacksBb: { BB: 99.999 } }, history)).toEqual([]);
    const allOverrides = Object.fromEntries(getPositions(8).map((position) => [position, 100]));
    expect(findHistoryReferences({ ...GAME, stackBb: 200, stacksBb: allOverrides }, history)).toHaveLength(1);
  });

  it('does not substitute missing table sizes or formats, and ignores invalid or terminal histories', () => {
    expect(findHistoryReferences({ ...GAME, players: 7 }, [])).toEqual([]);
    expect(findHistoryReferences({ ...GAME, players: 5 }, [])).toEqual([]);
    expect(findHistoryReferences({ ...GAME, format: 'mtt' } as unknown as TreeGame, [])).toEqual([]);
    expect(findHistoryReferences(GAME, [raise('BTN', 3)])).toEqual([]);
    expect(findHistoryReferences(GAME, getPositions(8).slice(0, -1).map(fold))).toEqual([]);
    const limps = getPositions(8).slice(0, -1).map(call);
    expect(findHistoryReferences(GAME, [...limps, { actor: 'BB', type: 'check' }])).toEqual([]);
    const terminalShove = line(GAME, 'vs-5bet', 'UTG', 'BTN');
    terminalShove.push(call('UTG'));
    expect(findHistoryReferences(GAME, terminalShove)).toEqual([]);
  });

  it('labels sizing, rake and ante as unverified instead of claiming an exact strategy match', () => {
    const game = { ...GAME, rake: 'a different unverified profile', anteBb: 0.1 };
    const history = [raise('UTG', 2.75)];
    const matches = findHistoryReferences(game, history);
    expect(matches).toHaveLength(1);
    expect(matches[0].note).toContain('Position and action-line reference only');
    expect(matches[0].note).toContain('bet sizes, rake and ante');
    expect(matches[0].note).toContain('not an exact strategy match');
  });
});
