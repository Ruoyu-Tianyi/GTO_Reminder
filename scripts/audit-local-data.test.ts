import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTreeTemplate } from '../src/lib/tree-strategy';
import type { Dataset } from '../src/lib/poker';
import { loadAllPublishedCharts } from '../server/published-charts';
import { loadReferenceRanges } from '../server/reference-ranges';
import { auditComputationIdentity, auditLocalData } from './audit-local-data';

vi.mock('../server/published-charts', () => ({ loadAllPublishedCharts: vi.fn() }));
vi.mock('../server/reference-ranges', () => ({ loadReferenceRanges: vi.fn() }));

describe('offline audit snapshot boundaries', () => {
  let root: string, output: string, datasetPath: string;
  beforeEach(() => {
    vi.resetAllMocks();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'gto-audit-test-'));
    fs.mkdirSync(path.join(root, 'data/private/research'), { recursive: true });
    fs.mkdirSync(path.join(root, 'data/private/exports'));
    for (const name of ['derived-chart-ranges.json', 'derived-response-ranges.json', 'derived-pokercoaching-ranges.json',
      'derived-rangeconverter-6max-later.json', 'derived-rangeconverter-9max-later.json']) fs.writeFileSync(path.join(root, 'data/private/research', name), 'Synthetic loader fixture');
    const data = createTreeTemplate({ players: 6, stackBb: 100, anteBb: 0, format: 'cash', rake: 'none' }, []);
    data.id = 'synthetic-audit-fixture-part-001';
    data.source.kind = 'computed';
    data.source.computation = { engine: 'Synthetic', model: 'Tests only', iterations: 0, status: 'unconverged', scope: 'Synthetic, not solver data' };
    datasetPath = path.join(root, 'data/private/fixture.tree.json');
    fs.writeFileSync(datasetPath, JSON.stringify(data));
    output = path.join(root, 'previous-audit.json');
    fs.writeFileSync(output, 'previous successful audit');
    vi.mocked(loadAllPublishedCharts).mockResolvedValue({ nodes: [], error: null });
    vi.mocked(loadReferenceRanges).mockResolvedValue({ nodes: [], error: null });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('reports missing hand states explicitly and records an exact input digest', async () => {
    const result = await auditLocalData(root, output);
    expect(result).toMatchObject({ files: 1, treeFiles: 1, treeNodes: 1, modelPacks: 1,
      treeHandRows: { available: 0, unreachable: 0, missing: 169 } });
    expect(result.standard.totals).toMatchObject({ total: 434, readable: 0, resolved: 0, missing: 434 });
    expect(result.inputs[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(fs.readFileSync(output, 'utf8')).treeNodes).toBe(1);
  });

  it('refuses an active restore before reading and preserves the previous audit', async () => {
    fs.writeFileSync(path.join(root, 'data/private/exports/.restore-lock'), 'active or unresolved');
    await expect(auditLocalData(root, output)).rejects.toThrow(/restore is in progress/);
    expect(loadAllPublishedCharts).not.toHaveBeenCalled();
    expect(fs.readFileSync(output, 'utf8')).toBe('previous successful audit');
  });

  it('detects a complete restore between lock checks through its persistent generation', async () => {
    vi.mocked(loadReferenceRanges).mockImplementation(async () => {
      fs.writeFileSync(path.join(root, 'data/private/exports/.restore-generation'), 'a'.repeat(32) + '\n');
      return { nodes: [], error: null };
    });
    await expect(auditLocalData(root, output)).rejects.toThrow(/restore is in progress/);
    expect(fs.readFileSync(output, 'utf8')).toBe('previous successful audit');
  });

  it('refuses a changed dataset without replacing the previous audit', async () => {
    vi.mocked(loadReferenceRanges).mockImplementation(async () => {
      fs.appendFileSync(datasetPath, ' ');
      return { nodes: [], error: null };
    });
    await expect(auditLocalData(root, output)).rejects.toThrow(/Input changed during audit/);
    expect(fs.readFileSync(output, 'utf8')).toBe('previous successful audit');
  });

  it('refuses a file published during the scan', async () => {
    vi.mocked(loadReferenceRanges).mockImplementation(async () => {
      fs.copyFileSync(datasetPath, path.join(root, 'data/private/new.tree.json'));
      return { nodes: [], error: null };
    });
    await expect(auditLocalData(root, output)).rejects.toThrow(/inventory changed during audit/);
    expect(fs.readFileSync(output, 'utf8')).toBe('previous successful audit');
  });

  it('rejects duplicate histories across numbered shards of the same model', async () => {
    const duplicate = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
    duplicate.id = 'synthetic-audit-fixture-part-002';
    fs.writeFileSync(path.join(root, 'data/private/part2.tree.json'), JSON.stringify(duplicate));
    await expect(auditLocalData(root, output)).rejects.toThrow(/Duplicate history across model shards/);
  });

  it('refuses output paths that would overwrite an input, including Windows case aliases', async () => {
    const before = fs.readFileSync(datasetPath);
    await expect(auditLocalData(root, datasetPath)).rejects.toThrow(/must not overwrite an input/);
    if (process.platform === 'win32') await expect(auditLocalData(root, datasetPath.toUpperCase())).rejects.toThrow(/must not overwrite an input/);
    expect(fs.readFileSync(datasetPath)).toEqual(before);
  });

  it('treats imported numbered files as independent models, matching the inventory', async () => {
    const first = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
    first.source.kind = 'imported'; delete first.source.computation;
    fs.writeFileSync(datasetPath, JSON.stringify(first));
    const second = structuredClone(first); second.id = 'synthetic-audit-fixture-part-002';
    fs.writeFileSync(path.join(root, 'data/private/part2.tree.json'), JSON.stringify(second));
    const result = await auditLocalData(root);
    expect(result.modelPacks).toBe(2);
    expect(result.treeNodes).toBe(2);
  });

  it('counts one standard category when multiple exact raise sizes represent it', async () => {
    const data = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
    data.nodes = [2.5, 3].map(size => {
      const node = createTreeTemplate(data.game, [{ actor: 'UTG', type: 'raise', amountBb: size }]).nodes[0];
      return { ...node, id: `open-${size}` };
    });
    fs.writeFileSync(datasetPath, JSON.stringify(data));
    const result = await auditLocalData(root);
    expect(result.reports[0].nodes).toBe(2);
    expect(result.reports[0].categories['vs-open']).toBe(1);
    expect(result.reports[0].standardCases).toBe(1);
  });
});

describe('computation audit cross-checks', () => {
  function source(): Dataset['source'] {
    return { name: 'Synthetic', url: 'https://example.com', retrievedAt: '2026-10-13', license: 'Tests only', kind: 'computed',
      computation: { engine: 'Synthetic', model: 'Synthetic', iterations: 10, status: 'unconverged', scope: 'Tests only', modelGapBb: null } };
  }
  it('rejects a checkpoint gap relabelled as an unmeasured final gap', () => {
    const declared = source(); declared.computation!.modelGapBb = 0.01;
    const raw = { computation: { exactNlHeGto: false, modelConverged: false,
      solver_quality: { iterations: 10, metricAppliesToFinalSnapshot: false, measuredModelBestResponseGapBb: null, realGameExploitability: null } } };
    expect(() => auditComputationIdentity(raw, declared, 'synthetic')).toThrow(/must not reuse an old gap/);
  });
  it('rejects a restricted source declaration without its pinned engine identity', () => {
    const declared = source();
    declared.computation!.tree = { openSizeBb: 2.5, threeBetSizeBb: 10, fourBetSizeBb: 30, maxRaises: 4, limp: true,
      model: 'restricted-entry-k3-limp1-v1', maxVoluntaryContributors: 3, maxUnopenedLimps: 1 };
    expect(() => auditComputationIdentity({}, declared, 'synthetic')).toThrow(/missing its engine audit identity/);
  });

  it('requires consistent payoff fingerprints and refuses unknown historical inputs', () => {
    const declared = source();
    declared.computation!.tree = { openSizeBb: 2.5, threeBetSizeBb: 10, fourBetSizeBb: 30, maxRaises: 4, limp: true,
      model: 'restricted-entry-k3-limp1-v1', maxVoluntaryContributors: 3, maxUnopenedLimps: 1 };
    const hash = 'a'.repeat(64), baseCommit = 'b'.repeat(40);
    const payoffs = { realizationFitPath: 'cache/realization_fit.json', realizationFitSha256: hash,
      equityCachePath: 'cache/preflop_eq169.bin', equityCacheSha256: hash, equitySamplesPerClassPair: 20000 };
    const raw = { computation: { exactNlHeGto: false, modelConverged: false,
      solver_quality: { iterations: 10, metricAppliesToFinalSnapshot: false, measuredModelBestResponseGapBb: null, realGameExploitability: null },
      engineCommit: baseCommit, modelIdentity: 'restricted-entry-k3-limp1-v1', engineConfig: { restricted_entry_k3_limp1: true },
      restrictedEngine: { source: { model: 'restricted-entry-k3-limp1-v1', baseCommit, patchSha256: hash, sources: { 'test.rs': hash } },
        binarySha256: hash, payoffInputs: payoffs as typeof payoffs | undefined },
      chanceModel: { model: 'coupled_deck_v1', latentStrengthSamples: 1024, seed: 90210, jointPhysicalCardRemoval: false,
        pairwiseEquitySamplesPerClassPair: 20000, pairwiseEquitySeed: 'class_i * 169 + class_j; pinned engine RNG', equityCacheSha256: hash },
    } };
    expect(() => auditComputationIdentity(raw, declared, 'synthetic')).not.toThrow();
    raw.computation.restrictedEngine.payoffInputs = undefined;
    expect(() => auditComputationIdentity(raw, declared, 'synthetic')).toThrow(/unknown historical inputs are not verified/);
    raw.computation.restrictedEngine.payoffInputs = { ...payoffs, equityCacheSha256: 'c'.repeat(64) };
    expect(() => auditComputationIdentity(raw, declared, 'synthetic')).toThrow(/payoff-input identity/);
  });
});
