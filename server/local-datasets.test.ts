import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ViteDevServer } from 'vite';
import { DEMO_DATASET } from '../src/data/demo';
import type { Dataset } from '../src/lib/poker';
import { localDatasets } from './local-datasets';
import { createTreeTemplate } from '../src/lib/tree-strategy';
import * as treeStrategy from '../src/lib/tree-strategy';
import type { PreflopAction } from '../src/lib/preflop';

type ResponseHeaders = Record<string, string>;
type Handler = (
  request: { method?: string; url?: string },
  response: { writeHead(status: number, headers?: ResponseHeaders): void; end(body?: string): void },
  next: () => void,
) => Promise<void> | void;

const temporaryRoots: string[] = [];

async function harness() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gto-local-datasets-test-'));
  temporaryRoots.push(root);
  const directory = path.join(root, 'data', 'private');
  let middleware: Handler | undefined;
  const use = vi.fn((route: string, handler: Handler) => {
    expect(route).toBe('/api/local-datasets');
    middleware = handler;
  });
  const plugin = localDatasets();
  const configure = plugin.configureServer;
  if (typeof configure !== 'function') throw new Error('Expected a configureServer function.');
  Reflect.apply(configure, {}, [{ config: { root }, middlewares: { use } } as unknown as ViteDevServer]);
  expect(use).toHaveBeenCalledOnce();

  return {
    root,
    directory,
    async put(name: string, value: unknown) {
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, name), typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
    },
    async request(method = 'GET', url = '/') {
      let status: number | undefined;
      let headers: ResponseHeaders = {};
      let body: string | undefined;
      const next = vi.fn();
      const end = vi.fn((value?: string) => { body = value ?? ''; });
      if (!middleware) throw new Error('Middleware was not registered.');
      await middleware({ method, url }, {
        writeHead(code, values = {}) { status = code; headers = values; },
        end,
      }, next);
      return { status, headers, body, next, end };
    },
  };
}

/** Test payloads only: this does not create real strategy data. */
function fixture(id: string): Dataset {
  const data = structuredClone(DEMO_DATASET);
  data.id = id;
  data.name = `Local fixture ${id}`;
  data.nodes = [data.nodes[0]];
  return data;
}

function treeFixture(id: string) {
  const data = createTreeTemplate({ players: 7, stackBb: 100, anteBb: 0, format: 'cash', rake: 'test only' }, []);
  data.id = id;
  data.name = `Tree fixture ${id}`;
  return data;
}

function computedPart(id: string, history: PreflopAction[] = []) {
  const data = createTreeTemplate({ players: 7, stackBb: 100, anteBb: 0, format: 'cash', rake: 'test only' }, history);
  data.id = id; data.name = id;
  data.source.kind = 'computed';
  data.source.computation = { engine: 'fixture-engine', model: 'fixture-model', iterations: 10, status: 'unconverged', scope: 'test only' };
  return data;
}

afterEach(async () => {
  vi.restoreAllMocks();
  const roots = temporaryRoots.splice(0);
  for (const root of roots) {
    const resolved = path.resolve(root);
    const tempDirectory = path.resolve(os.tmpdir());
    if (path.dirname(resolved) !== tempDirectory || !path.basename(resolved).startsWith('gto-local-datasets-test-')) {
      throw new Error('Refusing to clean a path outside this test’s temporary directories.');
    }
    await rm(resolved, { recursive: true, force: true });
  }
});

describe('personal local dataset endpoint', () => {
  it('is development-only and treats an absent private folder as an empty library', async () => {
    expect(localDatasets().apply).toBe('serve');
    const app = await harness();
    const result = await app.request();
    expect(result.status).toBe(200);
    expect(result.headers).toEqual({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    expect(JSON.parse(result.body!)).toEqual({ datasets: [], treeDatasets: [], errors: [] });
    expect(result.next).not.toHaveBeenCalled();
    expect(result.end).toHaveBeenCalledOnce();
  });

  it('loads validated JSON files in stable filename order and ignores other entries', async () => {
    const app = await harness();
    await app.put('zeta.json', fixture('last'));
    await app.put('alpha.json', fixture('first'));
    await app.put('notes.txt', 'not JSON');
    await mkdir(path.join(app.directory, 'nested.json'));
    const result = await app.request('GET', '/?refresh=1');
    const body = JSON.parse(result.body!);
    expect(result.status).toBe(200);
    expect(body.errors).toEqual([]);
    expect(body.datasets.map((data: Dataset) => data.id)).toEqual(['first', 'last']);
    expect(body.datasets[0].nodes[0].frequencies.AA).toEqual(DEMO_DATASET.nodes[0].frequencies.AA);
    expect(body.datasets[0].source.kind).toBe('demo');
  });

  it('isolates corrupt, invalid, duplicate and reserved files without hiding valid datasets', async () => {
    const app = await harness();
    await app.put('a-valid.json', fixture('valid'));
    await app.put('b-duplicate.json', fixture('valid'));
    await app.put('c-reserved.json', DEMO_DATASET);
    await app.put('d-corrupt.json', '{ not json }');
    const incomplete = fixture('incomplete');
    delete incomplete.nodes[0].frequencies.AA;
    await app.put('e-incomplete.json', incomplete);
    await app.put('f-valid.json', fixture('also-valid'));
    const result = await app.request();
    const body = JSON.parse(result.body!);
    expect(result.status).toBe(200);
    expect(body.datasets.map((data: Dataset) => data.id)).toEqual(['also-valid']);
    expect(body.errors).toHaveLength(5);
    expect(body.errors[0]).toMatch(/^a-valid.json: Dataset ID is duplicated/);
    expect(body.errors[1]).toMatch(/^b-duplicate.json: Dataset ID is duplicated/);
    expect(body.errors[2]).toMatch(/^c-reserved.json: Dataset ID is reserved or already loaded\./);
    expect(body.errors[3]).toMatch(/^d-corrupt.json:/);
    expect(body.errors[4]).toMatch(/^e-incomplete.json: .*169 canonical hand classes/);
  });

  it('rejects oversized files before parsing and continues loading normal files', async () => {
    const app = await harness();
    await app.put('normal.json', fixture('normal'));
    const file = await open(path.join(app.directory, 'oversized.json'), 'w');
    try { await file.truncate(20 * 1024 * 1024 + 1); } finally { await file.close(); }
    const result = await app.request();
    const body = JSON.parse(result.body!);
    expect(result.status).toBe(200);
    expect(body.datasets).toHaveLength(1);
    expect(body.errors).toEqual(['oversized.json: Dataset exceeds the 20 MB limit.']);
  });

  it('returns a generic uncached error if the private folder cannot be enumerated', async () => {
    const app = await harness();
    await mkdir(path.join(app.root, 'data'));
    await writeFile(app.directory, 'a file cannot be enumerated as a directory');
    const result = await app.request();
    expect(result.status).toBe(500);
    expect(result.headers['Cache-Control']).toBe('no-store');
    expect(JSON.parse(result.body!)).toEqual({ datasets: [], treeDatasets: [], errors: ['The local strategy folder could not be read.'] });
    expect(result.body).not.toContain(app.root);
    expect(result.end).toHaveBeenCalledOnce();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('rejects %s without loading data', async (method) => {
    const app = await harness();
    const result = await app.request(method);
    expect(result.status).toBe(405);
    expect(result.headers.Allow).toBe('GET');
    expect(result.body).toBe('');
    expect(result.next).not.toHaveBeenCalled();
  });

  it('separates validated legacy files and tree files, sharing duplicate ID checks', async () => {
    const app = await harness();
    const tree = createTreeTemplate({ players: 7, stackBb: 100, anteBb: 0, format: 'cash', rake: 'test only' }, []);
    tree.id = 'tree-fixture';
    await app.put('a-tree.json', tree);
    await app.put('b-legacy.json', fixture('legacy-fixture'));
    await app.put('c-duplicate.json', fixture('tree-fixture'));
    const result = await app.request();
    const body = JSON.parse(result.body!);
    expect(body.treeDatasets).toEqual([]);
    expect(body.datasets.map((item: { id: string }) => item.id)).toEqual(['legacy-fixture']);
    expect(body.errors).toEqual([
      'a-tree.json: Dataset ID is duplicated across local files.',
      'c-duplicate.json: Dataset ID is duplicated across local files.',
    ]);
  });

  it.each(['/other', '/../secret.json', '/nested/data.json'])('passes unexpected subpath %s through without reading a file', async (url) => {
    const app = await harness();
    const result = await app.request('GET', url);
    expect(result.next).toHaveBeenCalledOnce();
    expect(result.status).toBeUndefined();
    expect(result.end).not.toHaveBeenCalled();
  });
});

describe('on-demand local tree library', () => {
  it('returns small validated summaries alongside legacy datasets, then only the selected tree', async () => {
    const app = await harness();
    const first = treeFixture('first-tree');
    await app.put('a-tree.json', first);
    await app.put('b-tree.json', treeFixture('second-tree'));
    await app.put('legacy.json', fixture('legacy'));
    const summary = JSON.parse((await app.request('GET', '/?summary=1')).body!);
    expect(summary.datasets.map((entry: Dataset) => entry.id)).toEqual(['legacy']);
    expect(summary.treeDatasets).toEqual([]);
    expect(summary.errors).toEqual([]);
    expect(summary.treeLibrary[0]).toEqual({ id: first.id, name: first.name, game: first.game, source: first.source, nodeCount: 1 });
    expect(summary.treeLibrary.map((entry: { id: string }) => entry.id)).toEqual(['first-tree', 'second-tree']);
    expect(JSON.stringify(summary.treeLibrary)).not.toContain('hands');
    const selected = JSON.parse((await app.request('GET', '/?treeId=second-tree')).body!);
    expect(selected.datasets).toEqual([]);
    expect(selected.treeDatasets.map((entry: { id: string }) => entry.id)).toEqual(['second-tree']);
    expect(selected.treeDatasets[0].nodes[0].hands.AA).toEqual({ status: 'missing' });
    expect(selected.errors).toEqual([]);
    expect(selected).not.toHaveProperty('treeLibrary');
    const legacy = JSON.parse((await app.request()).body!);
    expect(legacy.treeDatasets).toHaveLength(2);
    expect(legacy).not.toHaveProperty('treeLibrary');
  });

  it('does not parse unchanged trees again for repeated or concurrent summaries, and caches selected payloads', async () => {
    const app = await harness();
    await app.put('tree.json', treeFixture('cached-tree'));
    const validate = vi.spyOn(treeStrategy, 'validateTreeDataset');
    await Promise.all([app.request('GET', '/?summary=1'), app.request('GET', '/?summary=1')]);
    expect(validate).toHaveBeenCalledTimes(1);
    await app.request('GET', '/?treeId=cached-tree');
    expect(validate).toHaveBeenCalledTimes(2);
    await app.request('GET', '/?treeId=cached-tree');
    await app.request('GET', '/?summary=1');
    expect(validate).toHaveBeenCalledTimes(2);
    const changed = treeFixture('cached-tree');
    changed.name = 'A changed tree with a different byte length';
    await app.put('tree.json', changed);
    const refreshed = JSON.parse((await app.request('GET', '/?summary=1')).body!);
    expect(refreshed.treeLibrary[0].name).toBe(changed.name);
    expect(validate).toHaveBeenCalledTimes(3);
    const selected = JSON.parse((await app.request('GET', '/?treeId=cached-tree')).body!);
    expect(selected.treeDatasets[0].name).toBe(changed.name);
    expect(validate).toHaveBeenCalledTimes(4);
    await rm(path.join(app.directory, 'tree.json'));
    expect(JSON.parse((await app.request('GET', '/?summary=1')).body!).treeLibrary).toEqual([]);
    expect(JSON.parse((await app.request('GET', '/?treeId=cached-tree')).body!).treeDatasets).toEqual([]);
  });

  it('bounds the full payload cache and reloads an evicted tree only when selected', async () => {
    const app = await harness();
    for (let i = 0; i < 5; i += 1) await app.put(`${i}.json`, treeFixture(`tree-${i}`));
    const validate = vi.spyOn(treeStrategy, 'validateTreeDataset');
    await app.request('GET', '/?summary=1');
    expect(validate).toHaveBeenCalledTimes(5);
    for (let i = 0; i < 5; i += 1) await app.request('GET', `/?treeId=tree-${i}`);
    expect(validate).toHaveBeenCalledTimes(10);
    await app.request('GET', '/?summary=1');
    await app.request('GET', '/?treeId=tree-4');
    expect(validate).toHaveBeenCalledTimes(10);
    await app.request('GET', '/?treeId=tree-0');
    expect(validate).toHaveBeenCalledTimes(11);
  });

  it('rejects both copies of duplicate IDs consistently across summary, selection, cached scans, and legacy mode', async () => {
    const app = await harness();
    await app.put('first.json', treeFixture('duplicate'));
    await app.request('GET', '/?summary=1');
    await app.put('second.json', treeFixture('duplicate'));
    for (const url of ['/?summary=1', '/?treeId=duplicate', '/', '/?summary=1', '/?treeId=duplicate']) {
      const body = JSON.parse((await app.request('GET', url)).body!);
      expect(body.treeDatasets).toEqual([]);
      expect(body.treeLibrary ?? []).toEqual([]);
      expect(body.errors.filter((error: string) => error.includes('duplicated across local files'))).toHaveLength(2);
    }
    await rm(path.join(app.directory, 'second.json'));
    const selected = JSON.parse((await app.request('GET', '/?treeId=duplicate')).body!);
    expect(selected.treeDatasets).toHaveLength(1);
    expect(selected.errors).toEqual([]);
  });

  it('never treats a selected ID as a filename or reads nested and outside files', async () => {
    const app = await harness();
    await app.put('tree.json', treeFixture('allowed'));
    await app.put('legacy.json', fixture('legacy'));
    await mkdir(path.join(app.directory, 'nested'));
    await writeFile(path.join(app.directory, 'nested', 'secret.json'), JSON.stringify(treeFixture('nested-secret')));
    await writeFile(path.join(app.root, 'outside.json'), JSON.stringify(treeFixture('outside-secret')));
    for (const id of ['../outside.json', '../../outside.json', 'nested/secret.json', 'tree.json', 'legacy', '']) {
      const result = await app.request('GET', `/?treeId=${encodeURIComponent(id)}`);
      expect(result.status).toBe(200);
      expect(JSON.parse(result.body!)).toEqual({ datasets: [], treeDatasets: [], errors: ['Requested tree dataset was not found or its ID is duplicated.'] });
    }
  });

  it('preserves corrupt-file errors in summaries and selections and recovers after a file is repaired', async () => {
    const app = await harness();
    await app.put('valid.json', treeFixture('valid'));
    await app.put('broken.json', '{ malformed');
    const summary = JSON.parse((await app.request('GET', '/?summary=1')).body!);
    expect(summary.treeLibrary).toHaveLength(1);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]).toMatch(/^broken.json:/);
    const selected = JSON.parse((await app.request('GET', '/?treeId=valid')).body!);
    expect(selected.treeDatasets).toHaveLength(1);
    expect(selected.errors).toEqual(summary.errors);
    await app.put('broken.json', treeFixture('repaired'));
    expect(JSON.parse((await app.request('GET', '/?summary=1')).body!).errors).toEqual([]);
  });

  it('finds an exact history in another part of the same computation and returns just its node under the selected ID', async () => {
    const app = await harness();
    const history: PreflopAction[] = [{ actor: 'UTG', type: 'fold' }];
    await app.put('one.json', computedPart('pack-part-001'));
    await app.put('two.json', computedPart('pack-part-002', history));
    await app.request('GET', '/?summary=1');
    const validate = vi.spyOn(treeStrategy, 'validateTreeDataset');
    const url = `/?treeId=pack-part-001&history=${encodeURIComponent(JSON.stringify(history))}`;
    const selected = JSON.parse((await app.request('GET', url)).body!);
    expect(selected.errors).toEqual([]);
    expect(selected.datasets).toEqual([]);
    expect(selected.matchedPartId).toBe('pack-part-002');
    expect(selected.treeDatasets).toHaveLength(1);
    expect(selected.treeDatasets[0].id).toBe('pack-part-001');
    expect(selected.treeDatasets[0].name).toBe('pack-part-001');
    expect(selected.treeDatasets[0].nodes).toHaveLength(1);
    expect(selected.treeDatasets[0].nodes[0].history).toEqual(history);
    expect(validate).toHaveBeenCalledTimes(1);
    await app.request('GET', url);
    expect(validate).toHaveBeenCalledTimes(1);
    const absent = JSON.parse((await app.request('GET', `/?treeId=pack-part-001&history=${encodeURIComponent(JSON.stringify([{ actor: 'UTG', type: 'call' }]))}`)).body!);
    expect(absent).toEqual({ datasets: [], treeDatasets: [], errors: [] });
    expect(validate).toHaveBeenCalledTimes(1);
  });

  it.each(['model', 'iterations', 'snapshot', 'game', 'kind', 'stem', 'unpartitioned'] as const)(
    'never borrows a history across mismatched %s boundaries', async difference => {
      const app = await harness();
      const history: PreflopAction[] = [{ actor: 'UTG', type: 'fold' }];
      const first = computedPart(difference === 'unpartitioned' ? 'pack' : 'pack-part-001');
      const second = computedPart('pack-part-002', history);
      if (difference === 'model') second.source.computation!.model = 'other-model';
      if (difference === 'iterations') second.source.computation!.iterations = 20;
      if (difference === 'snapshot') second.source.retrievedAt = '2020-01-01';
      if (difference === 'game') second.game.rake = 'different rake';
      if (difference === 'kind') second.source.kind = 'imported';
      if (difference === 'stem') second.id = 'other-pack-part-002';
      await app.put('one.json', first); await app.put('two.json', second);
      const body = JSON.parse((await app.request('GET', `/?treeId=${first.id}&history=${encodeURIComponent(JSON.stringify(history))}`)).body!);
      expect(body).toEqual({ datasets: [], treeDatasets: [], errors: [] });
    },
  );

  it('rejects ambiguous exact histories across parts rather than selecting the first file', async () => {
    const app = await harness();
    await app.put('one.json', computedPart('pack-part-001'));
    await app.put('two.json', computedPart('pack-part-002'));
    const result = JSON.parse((await app.request('GET', '/?treeId=pack-part-001&history=%5B%5D')).body!);
    expect(result.treeDatasets).toEqual([]);
    expect(result.errors).toEqual(['Requested action history appears in multiple files of the computed pack.']);
  });

  it('rejects malformed and oversized histories before inspecting the local library', async () => {
    const app = await harness();
    await app.put('tree.json', computedPart('pack-part-001'));
    const validate = vi.spyOn(treeStrategy, 'validateTreeDataset');
    const invalid = [
      '{', '{}', JSON.stringify(Array.from({ length: 201 }, () => ({ actor: 'UTG', type: 'fold' }))),
      JSON.stringify([{ actor: 'UTG', type: 'raise', amountBb: -1 }]),
      JSON.stringify([{ actor: 'UTG', type: 'call', amountBb: 1 }]),
      JSON.stringify([{ actor: 'invalid', type: 'fold' }]),
      JSON.stringify([{ actor: 'UTG', type: 'fold', padding: 'x'.repeat(33 * 1024) }]),
    ];
    for (const history of invalid) {
      const result = await app.request('GET', `/?treeId=pack-part-001&history=${encodeURIComponent(history)}`);
      expect(result.status).toBe(400);
      expect(JSON.parse(result.body!).treeDatasets).toEqual([]);
    }
    expect((await app.request('GET', '/?history=%5B%5D')).status).toBe(400);
    expect(validate).not.toHaveBeenCalled();
  });
});
