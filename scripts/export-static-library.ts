/** Export the reviewed strategy library for a static host. No solver or network work. */
import { copyFile, lstat, mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { CHART_REFERENCES } from '../src/data/references';
import { validateDataset, type Dataset } from '../src/lib/poker';
import { historyKey, validateTreeDataset, type TreeDataset } from '../src/lib/tree-strategy';
import { buildDataInventory, inventoryPackKey, type InventoryTreeEntry } from '../src/lib/data-inventory';
import { summarizeStandardSpots } from '../src/lib/standard-coverage';
import type { StrategyLibraryManifest } from '../src/lib/strategy-library';
import { loadAllPublishedCharts } from '../server/published-charts';
import { loadReferenceRanges } from '../server/reference-ranges';
import { beginPrivateDataRead, stopForPrivateDataRestore, PRIVATE_DATA_LOCK_MESSAGE } from '../server/private-data-lock';

interface ResourceReport {
  file: string; kind: string; rawBytes: number; storedBytes: number;
  sha256: string; storedSha256: string; encoding: 'gzip' | 'identity';
}

const MAX_JSON_BYTES = 20 * 1024 * 1024;
const MAX_PDF_BYTES = 60 * 1024 * 1024;
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const fingerprint = async (filename: string, maxBytes: number) => {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) throw new Error(`Not a regular file within the size limit: ${filename}`);
  return `${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.ino}`;
};
async function localNames(directory: string): Promise<string[]> {
  return (await readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => entry.name).sort((a, b) => a.localeCompare(b));
}

export async function exportStaticLibrary(rootInput = '.') {
  const root = path.resolve(rootInput);
  const input = path.join(root, 'data/private');
  const output = path.join(root, 'public/strategy-library');
  const runtime = path.join(root, '.runtime');
  const staging = path.join(runtime, `static-library-${randomUUID()}`);
  const response = { writeHead() {}, end() {} };
  const generation = await beginPrivateDataRead(root, 'GET', response);
  if (!generation) throw new Error(PRIVATE_DATA_LOCK_MESSAGE);
  const names = await localNames(input);
  const fingerprints = new Map(await Promise.all(names.map(async name => [name, await fingerprint(path.join(input, name), MAX_JSON_BYTES)] as const)));
  const resources: ResourceReport[] = [];
  const stagedFiles: string[] = [];
  const manifest: StrategyLibraryManifest = { schemaVersion: 1, summary: '', published: '', references: '', pdfs: {}, trees: {}, packs: {} };
  const datasets: Dataset[] = [];
  const treeLibrary: InventoryTreeEntry[] = [];
  const packHistories = new Map<string, Record<string, string>>();
  const ids = new Set<string>();
  let treeNodes = 0, quickNodes = 0, inputJsonBytes = 0;
  await mkdir(staging, { recursive: true });

  async function resource(kind: string, bytes: Buffer, compress = true): Promise<string> {
    const digest = sha(bytes);
    const basename = `${kind}.${digest.slice(0, 16)}.${compress ? 'json.gz' : 'pdf'}`;
    const file = `assets/${basename}`;
    const stored = compress ? gzipSync(bytes, { level: 6 }) : bytes;
    // Node's gzip encoder writes a zero mtime; refuse a time-dependent artifact.
    if (compress && stored.readUInt32LE(4) !== 0) throw new Error('Gzip mtime must remain zero.');
    await writeFile(path.join(staging, basename), stored);
    stagedFiles.push(basename);
    resources.push({ file, kind, rawBytes: bytes.length, storedBytes: stored.length,
      sha256: digest, storedSha256: sha(stored), encoding: compress ? 'gzip' : 'identity' });
    return file;
  }
  const jsonResource = (kind: string, value: unknown) => resource(kind, Buffer.from(JSON.stringify(value)));

  try {
    // Only regular top-level JSON files enter the app's existing schema validators.
    // Research artifacts are loaded separately through their reviewed-hash loaders.
    for (const name of names) {
      const filename = path.join(input, name);
      const bytes = await readFile(filename);
      if (bytes.length > MAX_JSON_BYTES || await fingerprint(filename, MAX_JSON_BYTES) !== fingerprints.get(name)) {
        throw new Error(`Strategy file changed during export: ${name}`);
      }
      inputJsonBytes += bytes.length;
      const raw: unknown = JSON.parse(bytes.toString('utf8'));
      const dataset = (raw as { schemaVersion?: number })?.schemaVersion === 2 ? validateTreeDataset(raw) : validateDataset(raw);
      if (ids.has(dataset.id) || dataset.id === 'gto-reminder-ui-demo-v1') throw new Error(`Duplicate or reserved dataset ID: ${dataset.id}`);
      ids.add(dataset.id);
      if (dataset.schemaVersion === 1) {
        datasets.push(dataset); quickNodes += dataset.nodes.length;
        continue;
      }
      treeNodes += dataset.nodes.length;
      treeLibrary.push({ id: dataset.id, name: dataset.name, game: dataset.game, source: dataset.source,
        nodeCount: dataset.nodes.length, standardSpots: summarizeStandardSpots(dataset) });
      // This helper shares the server's computed-parts + game + full-source rule.
      const packId = `pack-${sha(inventoryPackKey(dataset)).slice(0, 24)}`;
      const histories = packHistories.get(packId) ?? Object.create(null) as Record<string, string>;
      for (const node of dataset.nodes) {
        const key = historyKey(node.history);
        if (Object.hasOwn(histories, key)) throw new Error(`History is duplicated within a model pack: ${dataset.id}/${node.id}`);
        histories[key] = dataset.id;
      }
      packHistories.set(packId, histories);
      manifest.trees[dataset.id] = { file: await jsonResource('tree', dataset), packId };
    }

    const [published, references] = await Promise.all([loadAllPublishedCharts(root), loadReferenceRanges(root)]);
    if (published.error || references.error) throw new Error([published.error, references.error].filter(Boolean).join('; '));
    const summary = { datasets, treeDatasets: [] as TreeDataset[], treeLibrary, errors: [] as string[] };
    manifest.summary = await jsonResource('summary', summary);
    manifest.published = await jsonResource('published', published);
    manifest.references = await jsonResource('references', references);
    for (const [packId, histories] of packHistories) manifest.packs[packId] = { index: await jsonResource('index', histories) };

    for (const reference of CHART_REFERENCES) {
      // Only the explicit catalogue is publishable; arbitrary PDFs are not scanned.
      const filename = path.join(input, 'research', reference.filename);
      const before = await fingerprint(filename, MAX_PDF_BYTES);
      const bytes = await readFile(filename);
      if (bytes.length > MAX_PDF_BYTES || await fingerprint(filename, MAX_PDF_BYTES) !== before || sha(bytes) !== reference.sha256) {
        throw new Error(`Reference PDF does not match its reviewed edition: ${reference.id}`);
      }
      manifest.pdfs[reference.id] = await resource(reference.id, bytes, false);
    }

    if (JSON.stringify(await localNames(input)) !== JSON.stringify(names)) throw new Error('Strategy files were added or removed during export.');
    for (const [name, initial] of fingerprints) if (await fingerprint(path.join(input, name), MAX_JSON_BYTES) !== initial) {
      throw new Error(`Strategy file changed before publication: ${name}`);
    }
    if (await stopForPrivateDataRestore(root, 'GET', response, generation)) throw new Error(PRIVATE_DATA_LOCK_MESSAGE);

    const inventory = buildDataInventory({ datasets, treeLibrary, publishedCharts: published.nodes, referenceRanges: references.nodes });
    const stats = {
      schemaVersion: 1, generatedAt: new Date().toISOString(), output: 'public/strategy-library',
      localFiles: names.length, treeFiles: treeLibrary.length, quickFiles: datasets.length,
      treeNodes, quickNodes, modelPacks: packHistories.size,
      publishedCharts: published.nodes.length, referenceRanges: references.nodes.length, pdfs: Object.keys(manifest.pdfs).length,
      standard: { complete: inventory.standard.complete, totals: inventory.standard.totals },
      inputJsonBytes, rawResourceBytes: resources.reduce((sum, item) => sum + item.rawBytes, 0),
      storedResourceBytes: resources.reduce((sum, item) => sum + item.storedBytes, 0),
      resources,
    };

    // Immutable resource names permit publication first and manifest replacement last.
    // Earlier hashed files may remain available to readers holding an older manifest.
    await mkdir(path.join(output, 'assets'), { recursive: true });
    for (const basename of stagedFiles) await copyFile(path.join(staging, basename), path.join(output, 'assets', basename));
    const manifestTemporary = path.join(output, `.manifest-${randomUUID()}.tmp`);
    await writeFile(manifestTemporary, JSON.stringify(manifest, null, 2) + '\n');
    await rename(manifestTemporary, path.join(output, 'manifest.json'));
    await writeFile(path.join(runtime, 'static-library-export.json'), JSON.stringify(stats, null, 2) + '\n');
    return stats;
  } finally {
    // These are exact files created by this invocation, never a recursive deletion.
    for (const basename of stagedFiles) await unlink(path.join(staging, basename)).catch(() => {});
    await rmdir(staging).catch(() => {});
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--root' || !args[1])) throw new Error('Usage: export-static-library.ts [--root PROJECT_ROOT]');
  const { resources, ...stats } = await exportStaticLibrary(args[1] ?? '.');
  console.log(JSON.stringify({ ...stats, resourceFiles: resources.length, report: '.runtime/static-library-export.json' }, null, 2));
}
