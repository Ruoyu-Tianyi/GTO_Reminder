import { describe, expect, it } from 'vitest';
import { DEMO_DATASET } from '../data/demo';
import { validateComputation, validateDataset } from './poker';
import { createTreeTemplate, validateTreeDataset } from './tree-strategy';
import { auditCoverage } from './coverage';
import { validateStudyQuery } from './study-session';
import { bindStudyDataset, matchesStudyDataset } from './study-bindings';

const computation = { engine: 'Test engine', model: 'Synthetic restricted model', iterations: 40, status: 'unconverged' as const, scope: 'Test only: fixed open and three-bet, no further raises.' };
describe('computed provenance is explicit and survives validation', () => {
  it('preserves restricted entry identity through strategy and bookmark validation', () => {
    const tree = {openSizeBb: 2.5, threeBetSizeBb: 10, fourBetSizeBb: 30, maxRaises: 4, limp: true,
      model: 'restricted-entry-k3-limp1-v1' as const, maxVoluntaryContributors: 3 as const, maxUnopenedLimps: 1 as const};
    const full = createTreeTemplate({players: 9, stackBb: 100, anteBb: 0, rake: 'test', format: 'cash'}, []);
    full.source = {...full.source, kind: 'computed', computation: {...computation, tree}};
    const validated = validateTreeDataset(full);
    expect(validated.source.computation?.tree).toEqual(tree);
    const binding = bindStudyDataset(validated);
    const saved = validateStudyQuery({view: 'tree', game: full.game, history: [], hand: 'AA', binding});
    expect(saved.binding).toEqual(binding);
    const unrestricted = {...validated, source: {...validated.source, computation: {...computation,
      tree: {openSizeBb: 2.5, threeBetSizeBb: 10, fourBetSizeBb: 30, maxRaises: 4, limp: true}}}};
    expect(matchesStudyDataset(binding, unrestricted)).toBe(false);
    for (const patch of [{model: undefined}, {model: 'unknown'}, {maxVoluntaryContributors: 2}, {maxUnopenedLimps: 2}, {maxUnopenedLimps: undefined}]) {
      expect(() => validateComputation({...computation, tree: {...tree, ...patch}})).toThrow('Restricted-entry');
    }
  });
  it('requires computation metadata for v1 and excludes it from imported coverage', () => {
    const raw = structuredClone(DEMO_DATASET);
    raw.source.kind = 'computed'; raw.source.computation = computation;
    const dataset = validateDataset(raw);
    expect(dataset.source.computation).toEqual(computation);
    const audit = auditCoverage([dataset], dataset.nodes[0].spot, [6]);
    expect(audit.imported).toBe(0);
    delete raw.source.computation;
    expect(() => validateDataset(raw)).toThrow('computation');
  });
  it('retains v2 quality and rejects unsupported claims of exact convergence', () => {
    const raw = createTreeTemplate({ players: 7, stackBb: 100, anteBb: 0, rake: 'test', format: 'cash' }, []);
    raw.source.kind = 'computed'; raw.source.computation = computation;
    expect(validateTreeDataset(raw).source.computation).toEqual(computation);
    expect(() => validateTreeDataset({ ...raw, source: { ...raw.source, computation: { ...computation, status: 'exact-gto' } } })).toThrow('quality');
    expect(() => validateTreeDataset({ ...raw, source: { ...raw.source, computation: { ...computation, iterations: -1 } } })).toThrow('iterations');
    delete raw.source.computation;
    expect(() => validateTreeDataset(raw)).toThrow('computation');
  });

  it('retains optional model tree and final-snapshot model gap through both schemas', () => {
    const tree = { openSizeBb: 2.5, threeBetSizeBb: 10, fourBetSizeBb: 30, maxRaises: 4, limp: true, limpRaiseBb: 2.5 };
    const metadata = { ...computation, tree, modelGapBb: .017 };
    const quick = structuredClone(DEMO_DATASET);
    quick.source = { ...quick.source, kind: 'computed', computation: metadata };
    expect(validateDataset(quick).source.computation).toEqual(metadata);
    const full = createTreeTemplate({ players: 7, stackBb: 100, anteBb: 0, rake: 'test', format: 'cash' }, []);
    full.source = { ...full.source, kind: 'computed', computation: metadata };
    expect(validateTreeDataset(full).source.computation).toEqual(metadata);
    expect(validateComputation({ ...metadata, modelGapBb: null }).modelGapBb).toBeNull();
    expect(validateComputation(computation).tree).toBeUndefined();
    expect(validateComputation(computation).modelGapBb).toBeUndefined();
    expect(validateComputation({ ...metadata, modelGapBb: 0 }).modelGapBb).toBe(0);
    expect(validateComputation({ ...metadata, tree: { ...tree, openSizeBb: 30, threeBetSizeBb: 100, fourBetSizeBb: 100 } }).tree?.fourBetSizeBb).toBe(100);
  });

  it('rejects invalid model sizes, ordering, limits, limp flags and gap values', () => {
    const tree = { openSizeBb: 2.5, threeBetSizeBb: 10, fourBetSizeBb: 30, maxRaises: 4, limp: true, limpRaiseBb: 2.5 };
    for (const patch of [{ openSizeBb: 0 }, { openSizeBb: Infinity }, { threeBetSizeBb: 2 }, { fourBetSizeBb: 5 }, { maxRaises: 0 }, { maxRaises: 6 }, { maxRaises: 2.5 }, { limp: 'yes' }, { limpRaiseBb: 1 }, { limpRaiseBb: NaN }]) {
      expect(() => validateComputation({ ...computation, tree: { ...tree, ...patch } })).toThrow('computation.tree');
    }
    for (const modelGapBb of [-1, Infinity, NaN, '0.01']) expect(() => validateComputation({ ...computation, modelGapBb })).toThrow('modelGapBb');
  });
});
