import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';
import { getPositions, validateDataset, type Dataset, type Position } from '../src/lib/poker';
import { gameKey, historyKey, validateTreeDataset, type TreeDataset } from '../src/lib/tree-strategy';
import type { PreflopAction } from '../src/lib/preflop';
import { beginPrivateDataRead, stopForPrivateDataRestore } from './private-data-lock';

export interface TreeLibraryEntry {
  id: string; name: string; game: TreeDataset['game']; source: TreeDataset['source']; nodeCount: number;
}
type LocalDataset = Dataset | TreeDataset;
interface FileIndex {
  name: string; fingerprint: string; bytes: number; id?: string; schemaVersion?: 1 | 2;
  treeSummary?: TreeLibraryEntry; histories?: Map<string, string>; error?: string;
}
interface FullCacheEntry { fingerprint: string; bytes: number; dataset: LocalDataset }
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FULL_CACHE_BYTES = 40 * 1024 * 1024;
const MAX_FULL_CACHE_FILES = 4;
const MAX_INDEX_FILES = 512;

function requestedHistory(value: string): PreflopAction[] {
  if (Buffer.byteLength(value, 'utf8') > 32 * 1024) throw new Error('history exceeds the 32 KB limit.');
  const raw: unknown = JSON.parse(value);
  if (!Array.isArray(raw) || raw.length > 200) throw new Error('history must be an array of at most 200 actions.');
  return raw.map((entry): PreflopAction => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
      Object.keys(entry).some(key => !['actor', 'type', 'amountBb'].includes(key)) ||
      !getPositions(9).includes(entry.actor as Position) || !['fold', 'call', 'check', 'raise'].includes(entry.type)) {
      throw new Error('history contains an invalid action.');
    }
    if (entry.type === 'raise') {
      if (typeof entry.amountBb !== 'number' || !Number.isFinite(entry.amountBb) || entry.amountBb <= 0 ||
        entry.amountBb !== Number(entry.amountBb.toFixed(9))) throw new Error('history contains an invalid raise amount.');
      return { actor: entry.actor, type: 'raise', amountBb: entry.amountBb };
    }
    if (entry.amountBb !== undefined) throw new Error('Only history raises may contain amountBb.');
    return { actor: entry.actor, type: entry.type };
  });
}

function samePack(selected: FileIndex, candidate: FileIndex): boolean {
  if (selected.name === candidate.name) return true;
  const left = selected.treeSummary, right = candidate.treeSummary;
  return !!left && !!right && left.source.kind === 'computed' && right.source.kind === 'computed' &&
    /-part-\d+$/.test(left.id) && /-part-\d+$/.test(right.id) &&
    left.id.replace(/-part-\d+$/, '') === right.id.replace(/-part-\d+$/, '') &&
    gameKey(left.game) === gameKey(right.game) &&
    JSON.stringify(left.source) === JSON.stringify(right.source);
}

/** Personal strategy files stay outside the source bundle and Git repository. */
export function localDatasets(): Plugin {
  return {
    name: 'gto-local-strategy-library', apply: 'serve',
    configureServer(server) {
      const directory = path.resolve(server.config.root, 'data/private');
      // Summary scans retain metadata only. Full payloads use a bounded LRU.
      const index = new Map<string, FileIndex>();
      const fullCache = new Map<string, FullCacheEntry>();
      let fullCacheBytes = 0;
      let queue: Promise<void> = Promise.resolve();
      function dropFull(name: string) {
        fullCacheBytes -= fullCache.get(name)?.bytes ?? 0;
        fullCache.delete(name);
      }
      function remember(record: FileIndex) {
        index.delete(record.name);
        index.set(record.name, record);
        while (index.size > MAX_INDEX_FILES) {
          const oldest = index.keys().next().value!;
          index.delete(oldest); dropFull(oldest);
        }
      }
      function retain(record: FileIndex, dataset: LocalDataset) {
        dropFull(record.name);
        fullCache.set(record.name, { fingerprint: record.fingerprint, bytes: record.bytes, dataset });
        fullCacheBytes += record.bytes;
        while (fullCacheBytes > MAX_FULL_CACHE_BYTES || fullCache.size > MAX_FULL_CACHE_FILES) {
          dropFull(fullCache.keys().next().value!);
        }
      }
      async function inspect(name: string, includeData: boolean): Promise<{ record: FileIndex; dataset?: LocalDataset }> {
        // name originates exclusively from readdir, never from a query parameter.
        const filename = path.join(directory, name);
        let record: FileIndex = { name, fingerprint: '', bytes: 0 };
        try {
          const info = await lstat(filename);
          record = { name, bytes: info.size, fingerprint: `${info.mtimeMs}:${info.size}:${info.ctimeMs}:${info.ino}` };
          if (!info.isFile()) throw new Error('Dataset must be a regular top-level file.');
          const cached = index.get(name);
          if (cached?.fingerprint === record.fingerprint) {
            remember(cached);
            if (cached.error || !includeData) return { record: cached };
            const full = fullCache.get(name);
            if (full?.fingerprint === record.fingerprint) {
              retain(cached, full.dataset);
              return { record: cached, dataset: full.dataset };
            }
          } else dropFull(name);
          if (info.size > MAX_FILE_BYTES) throw new Error('Dataset exceeds the 20 MB limit.');
          const contents = await readFile(filename);
          if (contents.byteLength > MAX_FILE_BYTES) throw new Error('Dataset exceeds the 20 MB limit.');
          const after = await lstat(filename);
          if (!after.isFile() || `${after.mtimeMs}:${after.size}:${after.ctimeMs}:${after.ino}` !== record.fingerprint) {
            throw new Error('Dataset changed while being read; refresh the library.');
          }
          const raw = JSON.parse(contents.toString('utf8'));
          const dataset = raw?.schemaVersion === 2 ? validateTreeDataset(raw) : validateDataset(raw);
          if (dataset.id === 'gto-reminder-ui-demo-v1') throw new Error('Dataset ID is reserved or already loaded.');
          record.id = dataset.id; record.schemaVersion = dataset.schemaVersion;
          if (dataset.schemaVersion === 2) record.treeSummary = {
            id: dataset.id, name: dataset.name, game: dataset.game, source: dataset.source, nodeCount: dataset.nodes.length,
          };
          if (dataset.schemaVersion === 2) record.histories = new Map(dataset.nodes.map(node => [historyKey(node.history), node.id]));
          remember(record);
          if (includeData) retain(record, dataset);
          return { record, ...(includeData ? { dataset } : {}) };
        } catch (error) {
          dropFull(name);
          record.error = error instanceof Error ? error.message : 'Invalid dataset';
          remember(record);
          return { record };
        }
      }
      server.middlewares.use('/api/local-datasets', async (request, response, next) => {
        if ((request.url ?? '/').split('?')[0] !== '/') return next();
        if (request.method !== 'GET') {
          response.writeHead(405, { Allow: 'GET' }); response.end(); return;
        }
        // Concurrent refreshes share the completed index instead of parsing all
        // large files at once. Responses still perform a fresh directory scan.
        const operation = queue.then(async () => {
          const version = await beginPrivateDataRead(server.config.root, request.method, response);
          if (!version) return;
          const query = new URL(request.url ?? '/', 'http://localhost').searchParams;
          const selectedId = query.get('treeId');
          const summary = selectedId === null && query.get('summary') === '1';
          let exactHistory: string | null = null;
          try {
            if (query.has('history')) {
              if (selectedId === null || query.getAll('history').length !== 1 || query.getAll('treeId').length !== 1) {
                throw new Error('history requires one treeId and one history parameter.');
              }
              exactHistory = historyKey(requestedHistory(query.get('history')!));
            }
          } catch (error) {
            response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            response.end(JSON.stringify({ datasets: [], treeDatasets: [], errors: [error instanceof Error ? error.message : 'Invalid history parameter.'] }));
            return;
          }
          const datasets: Dataset[] = [], treeDatasets: TreeDataset[] = [];
          const treeLibrary: TreeLibraryEntry[] = [], errors: string[] = [];
          let matchedPartId: string | undefined;
          try {
            const entries = await readdir(directory, { withFileTypes: true }).catch(error => {
              if (error.code === 'ENOENT') return []; throw error;
            });
            const names = entries.filter(entry => entry.isFile() && entry.name.endsWith('.json'))
              .map(entry => entry.name).sort((a, b) => a.localeCompare(b));
            const present = new Set(names);
            for (const name of index.keys()) if (!present.has(name)) { index.delete(name); dropFull(name); }
            const inspected: Array<Awaited<ReturnType<typeof inspect>>> = [];
            const counts = new Map<string, number>();
            for (const name of names) {
              const item = await inspect(name, !summary && selectedId === null);
              inspected.push(item);
              if (item.record.id && !item.record.error) counts.set(item.record.id, (counts.get(item.record.id) ?? 0) + 1);
            }
            let foundSelection = false;
            let selectedRecord: FileIndex | undefined;
            const usableRecords: FileIndex[] = [];
            for (const item of inspected) {
              const record = item.record;
              if (record.error) { errors.push(`${record.name}: ${record.error}`); continue; }
              if (counts.get(record.id!) !== 1) {
                errors.push(`${record.name}: Dataset ID is duplicated across local files.`);
                dropFull(record.name); continue;
              }
              usableRecords.push(record);
              if (summary && record.treeSummary) { treeLibrary.push(record.treeSummary); continue; }
              if (selectedId !== null && (record.schemaVersion !== 2 || record.id !== selectedId)) continue;
              if (selectedId !== null) { foundSelection = true; selectedRecord = record; }
              if (exactHistory !== null) continue;
              const loaded = item.dataset ? item : await inspect(record.name, true);
              if (loaded.record.error) { errors.push(`${record.name}: ${loaded.record.error}`); continue; }
              if (!loaded.dataset || loaded.record.fingerprint !== record.fingerprint || loaded.dataset.id !== record.id) {
                errors.push(`${record.name}: Dataset changed while selecting it; refresh the library.`); continue;
              }
              if (loaded.dataset.schemaVersion === 2) treeDatasets.push(loaded.dataset);
              else datasets.push(loaded.dataset);
            }
            if (selectedId !== null && !foundSelection) errors.push('Requested tree dataset was not found or its ID is duplicated.');
            if (exactHistory !== null && selectedRecord) {
              const matches = usableRecords.filter(record => samePack(selectedRecord!, record) && record.histories?.has(exactHistory!));
              if (matches.length > 1) errors.push('Requested action history appears in multiple files of the computed pack.');
              else if (matches.length === 1) {
                const match = matches[0];
                const loaded = await inspect(match.name, true);
                if (loaded.record.error) errors.push(`${match.name}: ${loaded.record.error}`);
                else if (loaded.record.fingerprint !== match.fingerprint || loaded.dataset?.id !== match.id ||
                  loaded.dataset?.schemaVersion !== 2) errors.push(`${match.name}: Dataset changed while selecting it; refresh the library.`);
                else {
                  const node = loaded.dataset.nodes.find(entry => entry.id === match.histories!.get(exactHistory) && historyKey(entry.history) === exactHistory);
                  if (!node) errors.push(`${match.name}: Indexed history no longer matches the dataset; refresh the library.`);
                  else {
                    matchedPartId = loaded.dataset.id;
                    treeDatasets.push({ ...loaded.dataset, id: selectedRecord.id!, name: selectedRecord.treeSummary!.name, nodes: [node] });
                  }
                }
              }
            }
            if (await stopForPrivateDataRestore(server.config.root, request.method, response, version)) return;
            response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            response.end(JSON.stringify({ datasets, treeDatasets, errors, ...(summary ? { treeLibrary } : {}), ...(matchedPartId ? { matchedPartId } : {}) }));
          } catch {
            response.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            response.end(JSON.stringify({ datasets: [], treeDatasets: [], errors: ['The local strategy folder could not be read.'], ...(summary ? { treeLibrary: [] } : {}) }));
          }
        });
        queue = operation.catch(() => {});
        await operation;
      });
    },
  };
}
