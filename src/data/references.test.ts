import { describe, expect, it } from 'vitest';
import { getPositions, type Position, type SpotKind } from '../lib/poker';
import { POKERCOACHING_PAGES } from './pokercoaching-pages';
import { CHART_REFERENCES, referencePage, type ChartReference } from './references';

type ReferenceSpot = Parameters<typeof referencePage>[1];
const KINDS: SpotKind[] = ['rfi', 'vs-open', 'vs-3bet', 'vs-4bet'];

function reference(players: number): ChartReference {
  const result = CHART_REFERENCES.find((entry) => entry.players === players);
  if (!result) throw new Error(`Missing ${players}-max reference fixture.`);
  return result;
}

function spot(ref: ChartReference, patch: Partial<ReferenceSpot> = {}): ReferenceSpot {
  return { players: ref.players, stackBb: ref.stackBb, format: ref.format, hero: 'BTN', villain: null, kind: 'rfi', ...patch };
}

/** Enumerate the independently defined no-cold-call action topology. */
function legalSpots(ref: ChartReference): ReferenceSpot[] {
  const positions = getPositions(ref.players);
  const result = positions.filter((hero) => hero !== 'BB').map((hero) => spot(ref, { hero }));
  for (let early = 0; early < positions.length; early += 1) {
    for (let late = early + 1; late < positions.length; late += 1) {
      result.push(spot(ref, { kind: 'vs-open', hero: positions[late], villain: positions[early] }));
      result.push(spot(ref, { kind: 'vs-3bet', hero: positions[early], villain: positions[late] }));
      result.push(spot(ref, { kind: 'vs-4bet', hero: positions[late], villain: positions[early] }));
    }
  }
  return result;
}

describe('reference manifests', () => {
  it('identifies every personal PDF with a unique filename and a valid SHA-256 checksum', () => {
    expect(CHART_REFERENCES.map((ref) => ref.players).sort((a, b) => a - b)).toEqual([6, 8, 9]);
    expect(new Set(CHART_REFERENCES.map((ref) => ref.id)).size).toBe(CHART_REFERENCES.length);
    expect(new Set(CHART_REFERENCES.map((ref) => ref.filename)).size).toBe(CHART_REFERENCES.length);
    for (const ref of CHART_REFERENCES) {
      expect(ref.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(ref.filename).toMatch(/^[a-z0-9-]+\.pdf$/);
      expect(new URL(ref.url).protocol).toBe('https:');
      expect(ref.format).toBe('cash');
      expect(ref.stackBb).toBe(100);
      expect(ref.provider.length).toBeGreaterThan(0);
      expect(ref.conditions.length).toBeGreaterThan(0);
      expect(ref.precision.length).toBeGreaterThan(0);
    }
  });

  it('indexes exactly 90 distinct 8-max spots with 7 / 28 / 27 / 28 action counts', () => {
    expect(POKERCOACHING_PAGES).toHaveLength(90);
    expect(new Set(POKERCOACHING_PAGES.map((entry) => `${entry.kind}:${entry.hero}:${entry.villain ?? ''}`)).size).toBe(90);
    expect(KINDS.map((kind) => POKERCOACHING_PAGES.filter((entry) => entry.kind === kind).length)).toEqual([7, 28, 27, 28]);
    const ref = reference(8);
    const legalKeys = new Set(legalSpots(ref).map((entry) => `${entry.kind}:${entry.hero}:${entry.villain ?? ''}`));
    for (const entry of POKERCOACHING_PAGES) {
      expect(legalKeys.has(`${entry.kind}:${entry.hero}:${entry.villain ?? ''}`)).toBe(true);
      expect(Number.isInteger(entry.page)).toBe(true);
      expect(entry.page).toBeGreaterThanOrEqual(1);
      expect(entry.page).toBeLessThanOrEqual(ref.pages);
      expect(referencePage(ref, spot(ref, { ...entry, villain: entry.villain ?? null }))).toBe(entry.page);
    }
  });

  it('excludes the ambiguous CO versus BB 3-bet chart while retaining nearby clear charts', () => {
    const ref = reference(8);
    const missing = legalSpots(ref).filter((entry) => referencePage(ref, entry) === null);
    expect(missing).toEqual([spot(ref, { kind: 'vs-3bet', hero: 'CO', villain: 'BB' })]);
    expect(referencePage(ref, spot(ref, { kind: 'vs-3bet', hero: 'CO', villain: 'SB' }))).toBe(16);
    expect(referencePage(ref, spot(ref, { kind: 'vs-3bet', hero: 'BTN', villain: 'BB' }))).toBe(17);
    expect(referencePage(ref, spot(ref, { kind: 'rfi', hero: 'SB' }))).toBe(5);
  });

  it('keeps all 200 BB pages outside the 8-max 100 BB page picker and spot index', () => {
    const ref = reference(8);
    const forbidden = new Set([6, 7, ...Array.from({ length: 20 }, (_, index) => index + 28)]);
    expect(ref.browsePages).toEqual([1, 2, 3, 4, 5, ...Array.from({ length: 20 }, (_, index) => index + 8)]);
    expect(new Set(ref.browsePages).size).toBe(ref.browsePages?.length);
    for (const page of ref.browsePages ?? []) {
      expect(forbidden.has(page)).toBe(false);
      expect(page).toBeGreaterThanOrEqual(1);
      expect(page).toBeLessThanOrEqual(ref.pages);
    }
    for (const entry of POKERCOACHING_PAGES) {
      expect(forbidden.has(entry.page)).toBe(false);
      expect(ref.browsePages).toContain(entry.page);
    }
  });
});

describe('reference matching by source topology', () => {
  it.each([[6, 35, [5, 15, 15, 0]], [9, 80, [8, 36, 36, 0]]] as const)(
    'matches exactly %i-max / %i indexed legal spots without inventing 4-bet coverage',
    (players, expected, actionCounts) => {
      const ref = reference(players);
      const matches = legalSpots(ref).filter((entry) => referencePage(ref, entry) !== null);
      expect(matches).toHaveLength(expected);
      expect(KINDS.map((kind) => matches.filter((entry) => entry.kind === kind).length)).toEqual(actionCounts);
      for (const entry of matches) {
        const page = referencePage(ref, entry)!;
        expect(Number.isInteger(page)).toBe(true);
        expect(page).toBeGreaterThanOrEqual(1);
        expect(page).toBeLessThanOrEqual(ref.pages);
      }
    },
  );

  it('preserves the published 6-max and 9-max response-page boundaries', () => {
    const six = reference(6);
    expect(referencePage(six, spot(six, { hero: 'SB' }))).toBe(3);
    expect(referencePage(six, spot(six, { hero: 'HJ', villain: 'UTG', kind: 'vs-open' }))).toBe(4);
    expect(referencePage(six, spot(six, { hero: 'BB', villain: 'SB', kind: 'vs-open' }))).toBe(8);
    expect(referencePage(six, spot(six, { hero: 'UTG', villain: 'BB', kind: 'vs-3bet' }))).toBe(9);
    expect(referencePage(six, spot(six, { hero: 'SB', villain: 'BB', kind: 'vs-3bet' }))).toBe(13);
    const nine = reference(9);
    expect(referencePage(nine, spot(nine, { hero: 'UTG+1', villain: 'UTG', kind: 'vs-open' }))).toBe(4);
    expect(referencePage(nine, spot(nine, { hero: 'UTG+2', villain: 'UTG+1', kind: 'vs-open' }))).toBe(4);
    expect(referencePage(nine, spot(nine, { hero: 'LJ', villain: 'UTG+2', kind: 'vs-open' }))).toBe(5);
    expect(referencePage(nine, spot(nine, { hero: 'UTG+2', villain: 'BB', kind: 'vs-3bet' }))).toBe(13);
    expect(referencePage(nine, spot(nine, { hero: 'SB', villain: 'BB', kind: 'vs-3bet' }))).toBe(18);
  });

  it('does not substitute 5-max, 7-max, another stack or MTT for a published reference', () => {
    for (const ref of CHART_REFERENCES) {
      for (const players of [2, 3, 4, 5, 6, 7, 8, 9].filter((value) => value !== ref.players)) {
        expect(referencePage(ref, spot(ref, { players }))).toBeNull();
      }
      for (const stackBb of [20, 40, 99, 101, 200]) expect(referencePage(ref, spot(ref, { stackBb }))).toBeNull();
      expect(referencePage(ref, spot(ref, { format: 'mtt' }))).toBeNull();
    }
  });

  it('rejects invalid positions, self-opponents, absent opponents and reversed action order', () => {
    for (const ref of CHART_REFERENCES) {
      expect(referencePage(ref, spot(ref, { hero: 'INVALID' as Position }))).toBeNull();
      expect(referencePage(ref, spot(ref, { hero: 'BB', kind: 'rfi' }))).toBeNull();
      for (const kind of ['vs-open', 'vs-3bet', 'vs-4bet'] as const) {
        expect(referencePage(ref, spot(ref, { kind, villain: null }))).toBeNull();
        expect(referencePage(ref, spot(ref, { kind, villain: 'BTN' }))).toBeNull();
        expect(referencePage(ref, spot(ref, { kind, villain: 'INVALID' as Position }))).toBeNull();
      }
      expect(referencePage(ref, spot(ref, { kind: 'vs-open', villain: 'BB' }))).toBeNull();
      expect(referencePage(ref, spot(ref, { kind: 'vs-3bet', villain: 'UTG' }))).toBeNull();
      expect(referencePage(ref, spot(ref, { kind: 'vs-4bet', villain: 'BB' }))).toBeNull();
    }
    expect(referencePage(reference(6), spot(reference(6), { hero: 'LJ' }))).toBeNull();
    expect(referencePage(reference(8), spot(reference(8), { hero: 'UTG+2' }))).toBeNull();
  });

  it('rejects an RFI request that incorrectly supplies an opponent', () => {
    for (const ref of CHART_REFERENCES) {
      expect(referencePage(ref, spot(ref, { villain: 'UTG' }))).toBeNull();
    }
  });
});
