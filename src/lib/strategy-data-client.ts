import { getPositions } from './poker';
import { CHART_REFERENCES } from '../data/references';
import type { PreflopAction } from './preflop';
import { gameKey, historyKey, type TreeDataset } from './tree-strategy';
import type { StrategyDatasetResponse, StrategyLibraryManifest, StrategyPackIndex } from './strategy-library';

const LIBRARY_ROOT = '/strategy-library/';
const DATA_ROUTES = new Set(['/api/local-datasets', '/api/published-charts', '/api/reference-ranges', '/api/reference-charts']);
const MAX_JSON_BYTES = 32 * 1024 * 1024;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function relativePath(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(value) || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Invalid strategy library asset path.');
  }
  return value;
}

function manifestFrom(value: unknown): StrategyLibraryManifest {
  if (!object(value) || value.schemaVersion !== 1 || !object(value.pdfs) || !object(value.trees) || !object(value.packs)) {
    throw new Error('Unsupported strategy library manifest.');
  }
  for (const field of ['summary', 'published', 'references']) relativePath(value[field]);
  for (const path of Object.values(value.pdfs)) relativePath(path);
  for (const part of Object.values(value.trees)) {
    if (!object(part) || typeof part.packId !== 'string' || !Object.hasOwn(value.packs, part.packId)) throw new Error('Invalid strategy library tree pack.');
    relativePath(part.file);
  }
  for (const pack of Object.values(value.packs)) {
    if (!object(pack)) throw new Error('Invalid strategy library pack index.');
    relativePath(pack.index);
  }
  return value as unknown as StrategyLibraryManifest;
}

function historyFrom(raw: string): PreflopAction[] {
  if (raw.length > 32 * 1024) throw new Error('History exceeds the supported size.');
  const values: unknown = JSON.parse(raw);
  if (!Array.isArray(values) || values.length > 200) throw new Error('History must contain at most 200 actions.');
  return values.map(value => {
    if (!object(value) || !getPositions(9).includes(value.actor as PreflopAction['actor']) ||
      !['fold', 'call', 'check', 'raise'].includes(String(value.type)) || Object.keys(value).some(key => !['actor', 'type', 'amountBb'].includes(key))) {
      throw new Error('Invalid action history.');
    }
    if (value.type === 'raise') {
      if (typeof value.amountBb !== 'number' || !Number.isFinite(value.amountBb) || value.amountBb <= 0 || value.amountBb !== Number(value.amountBb.toFixed(9))) throw new Error('Invalid history raise size.');
    } else if (value.amountBb !== undefined) throw new Error('Only raises may contain amountBb.');
    return value as unknown as PreflopAction;
  });
}

/** Cancellation stops this reader, while a shared asset download can serve other views. */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  const reason = () => signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
  if (signal.aborted) { void promise.catch(() => {}); return Promise.reject(reason()); }
  return new Promise((resolve, reject) => {
    const abort = () => reject(reason());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

function jsonResponse(value: unknown, method: string, status = 200): Response {
  return new Response(method === 'HEAD' ? null : JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

/** Factory keeps the production transport independently testable without changing Vite's DEV flag. */
export function createStrategyDataClient(options: { development?: boolean; fetcher?: typeof fetch; root?: string } = {}) {
  const development = options.development ?? import.meta.env.DEV;
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const root = options.root ?? LIBRARY_ROOT;
  let manifest: StrategyLibraryManifest | undefined;
  let manifestRequest: Promise<StrategyLibraryManifest> | undefined;
  const smallCache = new Map<string, unknown>();
  const treeCache = new Map<string, TreeDataset>();
  const inflight = new Map<string, Promise<unknown>>();

  async function loadManifest(): Promise<StrategyLibraryManifest> {
    if (manifest) return manifest;
    if (!manifestRequest) {
      manifestRequest = (async () => {
        const response = await fetcher(`${root}manifest.json`, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`Strategy library manifest: HTTP ${response.status}`);
        manifest = manifestFrom(await response.json());
        return manifest;
      })().catch(error => { manifestRequest = undefined; throw error; });
    }
    return manifestRequest;
  }

  async function readCompressedJson(file: string): Promise<unknown> {
    const response = await fetcher(root + relativePath(file));
    if (!response.ok) throw new Error(`Strategy library asset: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_JSON_BYTES) throw new Error('Strategy library asset is too large.');
    const compressed = bytes[0] === 0x1f && bytes[1] === 0x8b;
    if (compressed && typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read compressed strategy data. Please update your browser.');
    // Accept transparently decoded responses too, if a host supplies Content-Encoding.
    const stream = new Blob([bytes]).stream();
    const reader = (compressed ? stream.pipeThrough(new DecompressionStream('gzip')) : stream).getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_JSON_BYTES) { await reader.cancel(); throw new Error('Decoded strategy data is too large.'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(await new Blob(chunks).text());
  }

  function readAsset<T>(file: string, tree = false): Promise<T> {
    const cache = tree ? treeCache : smallCache;
    if (cache.has(file)) {
      const value = cache.get(file);
      if (tree) { treeCache.delete(file); treeCache.set(file, value as TreeDataset); }
      return Promise.resolve(value as T);
    }
    const key = `${tree ? 'tree' : 'small'}:${file}`;
    let pending = inflight.get(key);
    if (!pending) {
      pending = readCompressedJson(file).then(value => {
        if (tree) {
          treeCache.set(file, value as TreeDataset);
          while (treeCache.size > 3) treeCache.delete(treeCache.keys().next().value!);
        } else smallCache.set(file, value);
        return value;
      }).finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    return pending as Promise<T>;
  }

  async function loadTree(library: StrategyLibraryManifest, id: string): Promise<TreeDataset> {
    const part = library.trees[id];
    if (!part) throw new Error('Requested tree dataset was not found.');
    const tree = await readAsset<TreeDataset>(part.file, true);
    if (!tree || tree.schemaVersion !== 2 || tree.id !== id || !Array.isArray(tree.nodes)) throw new Error('Tree asset does not match its library identity.');
    return tree;
  }

  async function staticRequest(url: URL, method: string, signal?: AbortSignal | null): Promise<Response> {
    const library = await abortable(loadManifest(), signal);
    if (url.pathname === '/api/published-charts') return jsonResponse(await abortable(readAsset(library.published), signal), method);
    if (url.pathname === '/api/reference-ranges') return jsonResponse(await abortable(readAsset(library.references), signal), method);
    if (url.pathname === '/api/reference-charts') return jsonResponse(Object.keys(library.pdfs).map(id => ({ id, local: true })), method);
    const empty = (): StrategyDatasetResponse => ({ datasets: [], treeDatasets: [], errors: [] });
    const id = url.searchParams.get('treeId');
    if (id === null) {
      if (url.searchParams.get('summary') !== '1' || url.searchParams.has('history')) return jsonResponse({ ...empty(), errors: ['Use a summary or a specific treeId.'] }, method, 400);
      return jsonResponse(await abortable(readAsset(library.summary), signal), method);
    }
    if (url.searchParams.getAll('treeId').length !== 1 || url.searchParams.getAll('history').length > 1) return jsonResponse({ ...empty(), errors: ['Use one treeId and one history parameter.'] }, method, 400);
    if (!Object.hasOwn(library.trees, id)) return jsonResponse({ ...empty(), errors: ['Requested tree dataset was not found.'] }, method);
    if (!url.searchParams.has('history')) return jsonResponse({ ...empty(), treeDatasets: [await abortable(loadTree(library, id), signal)] }, method);
    let history: PreflopAction[];
    try { history = historyFrom(url.searchParams.get('history')!); }
    catch (error) { return jsonResponse({ ...empty(), errors: [error instanceof Error ? error.message : 'Invalid action history.'] }, method, 400); }
    const part = library.trees[id];
    const index = await abortable(readAsset<StrategyPackIndex>(library.packs[part.packId].index), signal);
    const key = historyKey(history);
    if (!object(index)) throw new Error('Invalid strategy history index.');
    if (!Object.hasOwn(index, key)) return jsonResponse(empty(), method);
    const matchedId = index[key];
    if (typeof matchedId !== 'string' || !Object.hasOwn(library.trees, matchedId) || library.trees[matchedId].packId !== part.packId) throw new Error('History index points outside the selected model.');
    const [tree, summary] = await abortable(Promise.all([loadTree(library, matchedId), readAsset<StrategyDatasetResponse>(library.summary)]), signal);
    const selected = summary.treeLibrary?.find(entry => entry.id === id);
    if (!selected || gameKey(selected.game) !== gameKey(tree.game) || JSON.stringify(selected.source) !== JSON.stringify(tree.source)) throw new Error('SNAPSHOT_CHANGED');
    const nodes = tree.nodes.filter(node => historyKey(node.history) === key);
    if (nodes.length !== 1) throw new Error('Indexed history is missing or duplicated in its tree file.');
    return jsonResponse({ ...empty(), treeDatasets: [{ ...tree, id, name: selected.name, nodes }], matchedPartId: matchedId }, method);
  }

  function strategyFetch(input: string, init?: RequestInit): Promise<Response> {
    if (development) return fetcher(input, init);
    const url = new URL(input, 'https://strategy.invalid');
    if (!DATA_ROUTES.has(url.pathname)) return fetcher(input, init);
    if (init?.signal?.aborted) return Promise.reject(init.signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return Promise.resolve(new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } }));
    return staticRequest(url, method, init?.signal);
  }

  function resolveReferencePdfUrl(id: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid reference PDF identity.');
    if (development) return `/api/reference-charts/${id}.pdf`;
    if (manifest && Object.hasOwn(manifest.pdfs, id)) return root + manifest.pdfs[id];
    const reference = CHART_REFERENCES.find(item => item.id === id);
    if (!reference) throw new Error('Reference PDF is not in the source catalogue.');
    return reference.url;
  }

  return { strategyFetch, resolveReferencePdfUrl };
}

const client = createStrategyDataClient();
export const strategyFetch = client.strategyFetch;
export const resolveReferencePdfUrl = client.resolveReferencePdfUrl;
