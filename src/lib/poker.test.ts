import { describe, expect, it } from 'vitest';
import { DEMO_DATASET } from '../data/demo';
import { HANDS, comboCount, findNode, getPositions, getVillains, normalizeHand, rangeSummary, validateDataset } from './poker';

const clone = () => structuredClone(DEMO_DATASET);

describe('hand classes and combination accounting', () => {
  it('builds 169 unique classes representing all 1,326 combinations', () => {
    expect(HANDS).toHaveLength(169);
    expect(new Set(HANDS).size).toBe(169);
    expect(HANDS[0]).toBe('AA');
    expect(HANDS[1]).toBe('AKs');
    expect(HANDS[13]).toBe('AKo');
    expect(HANDS[168]).toBe('22');
    expect(HANDS.reduce((total, hand) => total + comboCount(hand), 0)).toBe(1326);
  });

  it.each([
    ['aKs', 'AKs'], ['kAs', 'AKs'], ['kAo', 'AKo'], ['tt', 'TT'],
    ['As Ks', 'AKs'], ['K♥A♠', 'AKo'], ['AsAh', 'AA'], ['10sJs', 'JTs'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeHand(input)).toBe(expected);
  });

  it.each(['AK', 'AAs', 'AAo', 'AsAs', '1sKh', 'AKx', '', 'invalid'])('rejects impossible or ambiguous hand %s', (input) => {
    expect(normalizeHand(input)).toBeNull();
  });

  it('weights a pair, suited and offsuit class by 6, 4 and 12 combinations', () => {
    const node = clone().nodes[0];
    for (const hand of HANDS) node.frequencies[hand] = { raise: 0, call: 0, fold: 1 };
    node.frequencies.AA = { raise: 1, call: 0, fold: 0 };
    node.frequencies.AKs = { raise: 0, call: 1, fold: 0 };
    node.frequencies.AKo = { raise: 0.5, call: 0.5, fold: 0 };
    const summary = rangeSummary(node);
    expect(summary.raise).toBeCloseTo(12 / 1326);
    expect(summary.call).toBeCloseTo(10 / 1326);
    expect(summary.fold).toBeCloseTo(1304 / 1326);
  });
});

describe('position order and lookup', () => {
  it('represents heads-up with SB as dealer and preserves every table size', () => {
    expect(getPositions(2)).toEqual(['SB', 'BB']);
    expect(getPositions(6)).toEqual(['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
    expect(getPositions(9)).toEqual(['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
    for (let players = 2; players <= 9; players += 1) expect(getPositions(players)).toHaveLength(players);
    expect(() => getPositions(2.5)).toThrow();
    expect(() => getPositions(10)).toThrow();
  });

  it('limits opponents to valid preflop action order', () => {
    expect(getVillains(6, 'BTN', 'vs-open')).toEqual(['UTG', 'HJ', 'CO']);
    expect(getVillains(6, 'BTN', 'vs-3bet')).toEqual(['SB', 'BB']);
    expect(getVillains(6, 'BTN', 'vs-4bet')).toEqual(['UTG', 'HJ', 'CO']);
    expect(getVillains(6, 'BB', 'rfi')).toEqual([]);
    expect(getVillains(2, 'BB', 'vs-open')).toEqual(['SB']);
    expect(getVillains(2, 'SB', 'vs-3bet')).toEqual(['BB']);
    expect(getVillains(6, 'BB', 'vs-3bet')).toEqual([]);
  });

  it('returns a stored node only when every context field matches', () => {
    const node = DEMO_DATASET.nodes[0];
    expect(findNode(DEMO_DATASET, { ...node.spot })).toBe(node);
    const differentValues = {
      players: 5, hero: 'CO', villain: 'UTG', stackBb: 99, kind: 'vs-open',
      openSizeBb: 2, threeBetSizeBb: 9, fourBetSizeBb: 21, format: 'mtt', anteBb: 1, rake: 'none',
    };
    for (const [field, value] of Object.entries(differentValues)) {
      expect(findNode(DEMO_DATASET, { ...node.spot, [field]: value })).toBeUndefined();
    }
  });
});

describe('strategy import validation', () => {
  it('accepts the synthetic fixtures and keeps their provenance explicit', () => {
    expect(validateDataset(clone())).toEqual(DEMO_DATASET);
    expect(DEMO_DATASET.source.kind).toBe('demo');
    expect(DEMO_DATASET.name).toContain('not solver output');
    for (const node of DEMO_DATASET.nodes) {
      const summary = rangeSummary(node);
      expect(summary.raise + summary.call + summary.fold).toBeCloseTo(1);
    }
  });

  it('rejects missing or noncanonical hand classes', () => {
    const missing = clone();
    delete missing.nodes[0].frequencies.AA;
    expect(() => validateDataset(missing)).toThrow(/169/);
    const noncanonical = clone();
    noncanonical.nodes[0].frequencies.KAs = noncanonical.nodes[0].frequencies.AKs;
    delete noncanonical.nodes[0].frequencies.AKs;
    expect(() => validateDataset(noncanonical)).toThrow(/169/);
  });

  it.each([NaN, Infinity, -0.1, 1.1])('rejects invalid frequency %s', (frequency) => {
    const raw = clone();
    raw.nodes[0].frequencies.AA.raise = frequency;
    expect(() => validateDataset(raw)).toThrow(/finite number/);
  });

  it('rejects percentages, bad sums, unknown actions and missing provenance', () => {
    const badSum = clone();
    badSum.nodes[0].frequencies.AA = { raise: 0.9, call: 0, fold: 0 };
    expect(() => validateDataset(badSum)).toThrow(/sum to 1/);
    const percentages = clone();
    percentages.nodes[0].frequencies.AA.raise = 100;
    expect(() => validateDataset(percentages)).toThrow(/finite number/);
    const unknownAction = clone();
    Object.assign(unknownAction.nodes[0].frequencies.AA, { jam: 0 });
    expect(() => validateDataset(unknownAction)).toThrow(/exactly raise, call, and fold/);
    const missingSource = clone();
    missingSource.source.license = '';
    expect(() => validateDataset(missingSource)).toThrow(/source.license/);
    missingSource.source.license = 'Personal export';
    missingSource.source.url = 'javascript:alert(1)';
    expect(() => validateDataset(missingSource)).toThrow(/http or https/);
  });

  it('rejects ambiguous duplicate IDs and exact spots', () => {
    const duplicateId = clone();
    duplicateId.nodes[1].id = duplicateId.nodes[0].id;
    expect(() => validateDataset(duplicateId)).toThrow(/duplicates/);
    const duplicateSpot = clone();
    duplicateSpot.nodes.push({ ...structuredClone(duplicateSpot.nodes[0]), id: 'a-different-id' });
    expect(() => validateDataset(duplicateSpot)).toThrow(/duplicates an existing exact spot/);
  });

  it('rejects BB RFI, invalid aggressor order, limps and illegal raise sizes', () => {
    const bbRfi = clone();
    bbRfi.nodes[0].spot.hero = 'BB';
    expect(() => validateDataset(bbRfi)).toThrow(/BB cannot Raise First In/);
    const wrongOrder = clone();
    wrongOrder.nodes[2].spot.villain = 'UTG';
    expect(() => validateDataset(wrongOrder)).toThrow(/preflop action order/);
    const limp = clone();
    limp.nodes[0].frequencies.AA = { raise: 0.5, call: 0.5, fold: 0 };
    expect(() => validateDataset(limp)).toThrow(/does not support Call/);
    const undersized = clone();
    undersized.nodes[1].spot.threeBetSizeBb = 3;
    expect(() => validateDataset(undersized)).toThrow(/minimum full raise/);
  });

  it('allows Call/Fold facing a 4-bet all-in, but rejects another Raise', () => {
    const raw = clone();
    const node = raw.nodes[3];
    node.spot.fourBetSizeBb = 100;
    expect(() => validateDataset(raw)).toThrow(/facing an all-in/);
    for (const hand of HANDS) node.frequencies[hand] = { raise: 0, call: 0.5, fold: 0.5 };
    expect(validateDataset(raw).nodes[3].spot.fourBetSizeBb).toBe(100);
  });

  it('supports an open all-in while ignoring future sizing placeholders', () => {
    const raw = clone();
    raw.nodes = [raw.nodes[0]];
    raw.nodes[0].spot = { ...raw.nodes[0].spot, stackBb: 10, openSizeBb: 10, threeBetSizeBb: 10, fourBetSizeBb: 22 };
    expect(validateDataset(raw).nodes[0].spot.openSizeBb).toBe(10);
    raw.nodes[0].spot.openSizeBb = 1.5;
    raw.nodes[0].spot.stackBb = 1.5;
    expect(validateDataset(raw).nodes[0].spot.openSizeBb).toBe(1.5);
  });

  it('supports Call/Fold facing open and 3-bet shoves without requiring another raise size', () => {
    const raw = clone();
    raw.nodes = [raw.nodes[1], raw.nodes[2]];
    raw.nodes[0].spot = { ...raw.nodes[0].spot, stackBb: 10, openSizeBb: 10, threeBetSizeBb: 10, fourBetSizeBb: 22 };
    raw.nodes[1].spot = { ...raw.nodes[1].spot, stackBb: 20, threeBetSizeBb: 20, fourBetSizeBb: 22 };
    for (const node of raw.nodes) for (const hand of HANDS) node.frequencies[hand] = { raise: 0, call: 0.5, fold: 0.5 };
    expect(validateDataset(raw).nodes).toHaveLength(2);
    raw.nodes[0].frequencies.AA = { raise: 0.5, call: 0.5, fold: 0 };
    expect(() => validateDataset(raw)).toThrow(/facing an all-in/);
    raw.nodes[0].frequencies.AA = { raise: 0, call: 1, fold: 0 };
    raw.nodes[1].frequencies.AA = { raise: 0.5, call: 0.5, fold: 0 };
    expect(() => validateDataset(raw)).toThrow(/facing an all-in/);
  });

  it('validates only used future sizes but always validates observed action history', () => {
    const raw = clone();
    raw.nodes = [raw.nodes[0]];
    raw.nodes[0].spot.stackBb = 20;
    expect(validateDataset(raw).nodes[0].spot.fourBetSizeBb).toBe(22);
    raw.nodes[0].spot.openSizeBb = 25;
    expect(() => validateDataset(raw)).toThrow(/exceeds the effective stack/);

    const facing = clone();
    facing.nodes = [facing.nodes[2]];
    facing.nodes[0].spot.stackBb = 20;
    expect(() => validateDataset(facing)).toThrow(/fourBetSizeBb exceeds/);
    for (const hand of HANDS) facing.nodes[0].frequencies[hand] = { raise: 0, call: 0.5, fold: 0.5 };
    expect(validateDataset(facing).nodes[0].spot.fourBetSizeBb).toBe(22);
    facing.nodes[0].spot.threeBetSizeBb = 3;
    expect(() => validateDataset(facing)).toThrow(/minimum full raise/);
    facing.nodes[0].spot.threeBetSizeBb = 2;
    expect(() => validateDataset(facing)).toThrow(/must exceed the previous bet/);
  });

  it('supports a 3-bet shove and rejects a 4-bet history after that shove', () => {
    const raw = clone();
    raw.nodes = [raw.nodes[1]];
    raw.nodes[0].spot = { ...raw.nodes[0].spot, stackBb: 20, threeBetSizeBb: 20, fourBetSizeBb: 22 };
    expect(validateDataset(raw).nodes[0].spot.threeBetSizeBb).toBe(20);
    raw.nodes[0].spot.kind = 'vs-4bet';
    expect(() => validateDataset(raw)).toThrow(/fourBetSizeBb exceeds/);
  });
});
