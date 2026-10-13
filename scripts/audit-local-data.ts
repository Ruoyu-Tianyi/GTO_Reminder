/** Offline audit of the exact files used by the app. No network or solver work. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { HANDS, validateDataset, type ComputationInfo, type Dataset } from '../src/lib/poker';
import { validateTreeDataset, historyKey, type TreeDataset } from '../src/lib/tree-strategy';
import { buildDataInventory, inventoryPackKey, type InventoryTreeEntry } from '../src/lib/data-inventory';
import { STANDARD_KINDS, summarizeStandardSpots } from '../src/lib/standard-coverage';
import { loadAllPublishedCharts } from '../server/published-charts';
import { loadReferenceRanges } from '../server/reference-ranges';
import { beginPrivateDataRead, stopForPrivateDataRestore, PRIVATE_DATA_LOCK_MESSAGE } from '../server/private-data-lock';

const MODEL = 'restricted-entry-k3-limp1-v1';
const MAX_BYTES = 20 * 1024 * 1024;
const REFERENCES = ['derived-chart-ranges.json', 'derived-response-ranges.json',
  'derived-pokercoaching-ranges.json', 'derived-rangeconverter-6max-later.json', 'derived-rangeconverter-9max-later.json'];
const SHA256 = /^[0-9a-f]{64}$/;
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const fingerprint = (filename: string) => {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw new Error(`Not a regular file within 20 MiB: ${filename}`);
  return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}:${stat.dev}`;
};
const localFiles = (root: string) => fs.readdirSync(path.join(root, 'data/private'), { withFileTypes: true })
  .filter(item => item.name.endsWith('.json')).map(item => item.name).sort();
const rowCounts = () => ({ available: 0, unreachable: 0, missing: 0 });
type RowCounts = ReturnType<typeof rowCounts>;
type RawRecord = Record<string, any>;

function canonicalPath(filename: string): string {
  let ancestor = path.resolve(filename);
  const remaining: string[] = [];
  while (!fs.existsSync(ancestor)) {
    remaining.unshift(path.basename(ancestor));
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error(`Cannot resolve audit output: ${filename}`);
    ancestor = parent;
  }
  const resolved = path.join(fs.realpathSync(ancestor), ...remaining);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function protectInputs(outputFile: string | undefined, root: string, inputPaths: string[]): void {
  if (outputFile && inputPaths.some(name => canonicalPath(path.join(root, name)) === canonicalPath(outputFile))) {
    throw new Error('Audit output must not overwrite an input strategy/reference file');
  }
}

/** Export metadata checks supplement the app's schema/action validators. */
export function auditComputationIdentity(raw: RawRecord, source: Dataset['source'], filename: string): void {
  if (source.kind !== 'computed') return;
  const declared = source.computation!;
  const metadata = raw.computation;
  const restricted = declared.tree?.model === MODEL;
  if (!metadata) {
    if (restricted) throw new Error(`${filename}: restricted model is missing its engine audit identity`);
    return; // Other user-supplied computed schemas need not be this exporter.
  }
  const quality = metadata.solver_quality;
  if (!quality || metadata.exactNlHeGto !== false || quality.realGameExploitability !== null
      || quality.iterations !== declared.iterations) throw new Error(`${filename}: inconsistent computation quality audit`);
  if (quality.metricAppliesToFinalSnapshot === true) {
    if (quality.accuracyIteration !== declared.iterations || typeof declared.modelGapBb !== 'number'
        || quality.measuredModelBestResponseGapBb !== declared.modelGapBb) throw new Error(`${filename}: gap does not belong to final snapshot`);
  } else if (declared.modelGapBb != null || quality.measuredModelBestResponseGapBb != null) {
    throw new Error(`${filename}: unmeasured final snapshot must not reuse an old gap`);
  }
  if (declared.status === 'approximate' && (metadata.modelConverged !== true || quality.metricAppliesToFinalSnapshot !== true
      || !(declared.modelGapBb! <= quality.targetModelBestResponseGapBb))) throw new Error(`${filename}: approximate status lacks a final model-target measurement`);
  if (declared.status === 'unconverged' && metadata.modelConverged !== false) throw new Error(`${filename}: unconverged status conflicts with audit`);
  if (!restricted) {
    if (metadata.engineConfig?.restricted_entry_k3_limp1 === true || metadata.modelIdentity === MODEL) throw new Error(`${filename}: restricted engine identity is missing from source.computation.tree`);
    return;
  }
  const engine = metadata.restrictedEngine;
  const chance = metadata.chanceModel;
  if (metadata.modelIdentity !== MODEL || metadata.engineConfig?.restricted_entry_k3_limp1 !== true
      || engine?.source?.model !== MODEL || engine.source.baseCommit !== metadata.engineCommit
      || !/^[0-9a-f]{40}$/.test(engine.source.baseCommit) || !SHA256.test(engine.source.patchSha256)
      || !SHA256.test(engine.binarySha256) || !engine.source.sources || Object.keys(engine.source.sources).length === 0
      || Object.values(engine.source.sources).some(value => typeof value !== 'string' || !SHA256.test(value))) {
    throw new Error(`${filename}: restricted engine/source identity is incomplete or inconsistent`);
  }
  if (chance?.model !== 'coupled_deck_v1' || chance.seed !== 90210 || chance.latentStrengthSamples !== 1024 || chance.pairwiseEquitySamplesPerClassPair !== 20000
      || chance.pairwiseEquitySeed !== 'class_i * 169 + class_j; pinned engine RNG' || !SHA256.test(chance.equityCacheSha256)
      || chance.jointPhysicalCardRemoval !== false) throw new Error(`${filename}: restricted chance-model identity is incomplete or inconsistent`);
  const payoffs = engine.payoffInputs;
  if (payoffs?.realizationFitPath !== 'cache/realization_fit.json' || !SHA256.test(payoffs.realizationFitSha256)
      || payoffs.equityCachePath !== 'cache/preflop_eq169.bin' || payoffs.equityCacheSha256 !== chance.equityCacheSha256
      || payoffs.equitySamplesPerClassPair !== chance.pairwiseEquitySamplesPerClassPair) {
    throw new Error(`${filename}: restricted payoff-input identity is missing or inconsistent; unknown historical inputs are not verified`);
  }
}

interface Group {
  id: string; name: string; game: TreeDataset['game']; tree: ComputationInfo['tree']; quality: ComputationInfo | undefined;
  files: string[]; nodes: number; bytes: number; histories: Set<string>; rowStatuses: RowCounts;
  categories: Record<string, number>; categoryKeys: Set<string>; computation: RawRecord | undefined;
}

export async function auditLocalData(rootInput: string, outputFile?: string) {
  const root = path.resolve(rootInput);
  const response = { writeHead() {}, end() {} };
  const generation = await beginPrivateDataRead(root, 'GET', response);
  if (!generation) throw new Error(PRIVATE_DATA_LOCK_MESSAGE);
  const names = localFiles(root);
  const referencePaths = REFERENCES.map(name => path.join('data/private/research', name));
  const inputPaths = [...names.map(name => path.join('data/private', name)), ...referencePaths];
  protectInputs(outputFile, root, inputPaths);
  const fingerprints = new Map(inputPaths.map(name => [name, fingerprint(path.join(root, name))]));
  const fileReports: Array<Record<string, unknown>> = [];
  const groups = new Map<string, Group>();
  const shardIdentities = new Map<string, string>();
  const ids = new Set<string>();
  const datasets: Dataset[] = [];
  const treeLibrary: InventoryTreeEntry[] = [];
  let treeNodes = 0, quickNodes = 0, treeFiles = 0, quickFiles = 0;
  const treeHandRows = rowCounts();

  for (const name of names) {
    const filename = path.join(root, 'data/private', name);
    const bytes = fs.readFileSync(filename);
    if (bytes.length > MAX_BYTES || fingerprint(filename) !== fingerprints.get(path.join('data/private', name))) throw new Error(`Input changed during read: ${name}`);
    const raw = JSON.parse(bytes.toString('utf8'));
    const dataset = raw?.schemaVersion === 2 ? validateTreeDataset(raw) : validateDataset(raw);
    if (ids.has(dataset.id) || dataset.id === 'gto-reminder-ui-demo-v1') throw new Error(`Duplicate/reserved dataset ID: ${dataset.id}`);
    ids.add(dataset.id);
    auditComputationIdentity(raw, dataset.source, name);
    const rows = rowCounts();
    fileReports.push({ file: `data/private/${name}`, bytes: bytes.length, sha256: sha(bytes),
      id: dataset.id, schemaVersion: dataset.schemaVersion, nodes: dataset.nodes.length, rowStatuses: rows });
    if (dataset.schemaVersion === 1) {
      datasets.push(dataset); quickNodes += dataset.nodes.length; quickFiles++;
      // v1 has frequencies for all hands but no reach/unreachable representation.
      rows.available = dataset.nodes.length * HANDS.length;
      continue;
    }
    treeFiles++; treeNodes += dataset.nodes.length;
    const standardSpots = summarizeStandardSpots(dataset);
    const summary = { id: dataset.id, name: dataset.name, game: dataset.game, source: dataset.source,
      nodeCount: dataset.nodes.length, standardSpots };
    treeLibrary.push(summary);
    const key = inventoryPackKey(summary);
    const stem = dataset.id.replace(/-part-\d+$/, '');
    if (dataset.source.kind === 'computed' && /-part-\d+$/.test(dataset.id)) {
      if (shardIdentities.has(stem) && shardIdentities.get(stem) !== key) throw new Error(`Conflicting shard model snapshots: ${stem}`);
      shardIdentities.set(stem, key);
    }
    const group: Group = groups.get(key) ?? { id: stem, name: dataset.name, game: dataset.game, tree: dataset.source.computation?.tree,
      quality: dataset.source.computation, files: [], nodes: 0, bytes: 0, histories: new Set<string>(), rowStatuses: rowCounts(),
      categories: Object.fromEntries(STANDARD_KINDS.map(kind => [kind, 0])), categoryKeys: new Set<string>(), computation: raw.computation };
    if (JSON.stringify(group.computation) !== JSON.stringify(raw.computation)) throw new Error(`Inconsistent engine audit across shards: ${name}`);
    group.files.push(name); group.nodes += dataset.nodes.length; group.bytes += bytes.length;
    for (const node of dataset.nodes) {
      const history = historyKey(node.history);
      if (group.histories.has(history)) throw new Error(`Duplicate history across model shards: ${name}/${node.id}`);
      group.histories.add(history);
      for (const hand of HANDS) rows[node.hands[hand].status]++;
    }
    for (const status of ['available', 'unreachable', 'missing'] as const) {
      group.rowStatuses[status] += rows[status]; treeHandRows[status] += rows[status];
    }
    for (const spot of standardSpots) {
      if (!group.categoryKeys.has(spot.key)) group.categories[spot.kind]++;
      group.categoryKeys.add(spot.key);
    }
    groups.set(key, group);
  }

  const [published, references] = await Promise.all([loadAllPublishedCharts(root), loadReferenceRanges(root)]);
  if (published.error || references.error) throw new Error([published.error, references.error].filter(Boolean).join('; '));
  for (const name of referencePaths) {
    const bytes = fs.readFileSync(path.join(root, name));
    fileReports.push({ file: name.replaceAll('\\', '/'), bytes: bytes.length, sha256: sha(bytes), kind: 'reviewed-reference-artifact' });
  }
  const inventory = buildDataInventory({ datasets, treeLibrary, publishedCharts: published.nodes, referenceRanges: references.nodes });
  if (inventory.warnings.length || !inventory.standard.complete || inventory.standard.totals.total !== 434) throw new Error(`Incomplete inventory audit: ${inventory.warnings.join('; ')}`);
  if (inventory.totals.local?.modelPacks !== groups.size || inventory.totals.local?.decisionNodes !== treeNodes) throw new Error('Independent node/model count disagrees with inventory');
  const reports = [...groups.values()].map(({ histories, categoryKeys, computation, ...group }) => ({ ...group,
    standardCases: categoryKeys.size,
    uniqueHistories: histories.size, files: group.files.length, filenames: group.files,
    exportCoverage: computation?.coverage ?? null, engineConfig: computation?.engineConfig ?? null,
    modelIdentity: computation?.modelIdentity ?? null, restrictedEngine: computation?.restrictedEngine ?? null,
    chanceModel: computation?.chanceModel ?? null, solverQuality: computation?.solver_quality ?? null,
  })).sort((a, b) => a.game.players - b.game.players || a.id.localeCompare(b.id));
  const standard = { ...inventory.standard,
    // Keep source/condition summaries, not another large copy of every frequency.
    cases: inventory.standard.cases.map(spot => ({ key: spot.key, players: spot.players, kind: spot.kind, hero: spot.hero, villain: spot.villain,
      evidence: spot.evidence.map(item => ({ channel: item.channel, datasetId: item.datasetId, chartId: item.chartId,
        conditionSha256: sha(item.conditionKey), availableHands: item.availableHands, unreachableHands: item.unreachableHands, missingHands: item.missingHands })) })),
    missingCases: inventory.standard.cases.filter(spot => !spot.evidence.some(item => item.availableHands > 0 && item.channel !== 'demo')).map(spot => spot.key),
  };
  const result = { schemaVersion: 2, kind: 'gto-reminder-local-validation-and-coverage', validatedAt: new Date().toISOString(),
    limitations: ['Counts establish schema/legal action/explicit hand-state validity, not independent solver accuracy.',
      'Quick nodes overlap tree decisions; do not add them together.', '434 is the fixed standard category catalogue, not the complete NLHE game.',
      'Reference, projected and computed channels overlap and retain different conditions.',
      'Engine/source digests are checked for metadata consistency; this audit does not rerun the solver or prove authorship.'],
    files: names.length, treeFiles, quickFiles, treeNodes, quickNodes, modelPacks: groups.size,
    treeHandRows, quickHandRows: quickNodes * HANDS.length, reports,
    referenceInventory: inventory.totals.references, byPlayers: inventory.byPlayers, standard, inputs: fileReports };

  if (JSON.stringify(localFiles(root)) !== JSON.stringify(names)) throw new Error('Local dataset inventory changed during audit; retry after exports finish');
  for (const [name, initial] of fingerprints) if (fingerprint(path.join(root, name)) !== initial) throw new Error(`Input changed during audit: ${name}`);
  if (await stopForPrivateDataRestore(root, 'GET', response, generation)) throw new Error(PRIVATE_DATA_LOCK_MESSAGE);
  if (outputFile) {
    const output = path.resolve(outputFile);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const temporary = `${output}.${randomUUID()}.partial`;
    try {
      const descriptor = fs.openSync(temporary, 'wx');
      try { fs.writeFileSync(descriptor, JSON.stringify(result, null, 2) + '\n'); fs.fsyncSync(descriptor); }
      finally { fs.closeSync(descriptor); }
      if (await stopForPrivateDataRestore(root, 'GET', response, generation)) throw new Error(PRIVATE_DATA_LOCK_MESSAGE);
      protectInputs(outputFile, root, inputPaths);
      fs.renameSync(temporary, output);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root'), outputIndex = args.indexOf('--output');
  if (args.some(value => value.startsWith('--') && !['--root', '--output', '--no-write'].includes(value))
      || (rootIndex >= 0 && !args[rootIndex + 1]) || (outputIndex >= 0 && !args[outputIndex + 1])) throw new Error('Usage: --root PATH --output JSON or --no-write');
  const root = path.resolve(rootIndex >= 0 ? args[rootIndex + 1] : '.');
  const output = args.includes('--no-write') ? undefined : path.resolve(outputIndex >= 0 ? args[outputIndex + 1] : path.join(root, 'data/private/solver-audits/validation-and-coverage.json'));
  const result = await auditLocalData(root, output);
  console.log(JSON.stringify({ output: output ?? null, files: result.files, treeFiles: result.treeFiles, quickFiles: result.quickFiles,
    treeNodes: result.treeNodes, quickNodes: result.quickNodes, modelPacks: result.modelPacks, treeHandRows: result.treeHandRows,
    referenceInventory: result.referenceInventory, standardTotals: result.standard.totals,
    byPlayers: result.standard.byPlayers, missingCases: result.standard.missingCases }, null, 2));
}
