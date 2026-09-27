import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ViteDevServer } from 'vite';
import { DEMO_DATASET } from '../src/data/demo';
import type { Dataset } from '../src/lib/poker';
import { localDatasets } from './local-datasets';

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

afterEach(async () => {
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
    expect(JSON.parse(result.body!)).toEqual({ datasets: [], errors: [] });
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
    expect(body.datasets.map((data: Dataset) => data.id)).toEqual(['valid', 'also-valid']);
    expect(body.errors).toHaveLength(4);
    expect(body.errors[0]).toMatch(/^b-duplicate.json: Dataset ID is reserved or already loaded\./);
    expect(body.errors[1]).toMatch(/^c-reserved.json: Dataset ID is reserved or already loaded\./);
    expect(body.errors[2]).toMatch(/^d-corrupt.json:/);
    expect(body.errors[3]).toMatch(/^e-incomplete.json: .*169 canonical hand classes/);
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
    expect(JSON.parse(result.body!)).toEqual({ datasets: [], errors: ['The local strategy folder could not be read.'] });
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

  it.each(['/other', '/../secret.json', '/nested/data.json'])('passes unexpected subpath %s through without reading a file', async (url) => {
    const app = await harness();
    const result = await app.request('GET', url);
    expect(result.next).toHaveBeenCalledOnce();
    expect(result.status).toBeUndefined();
    expect(result.end).not.toHaveBeenCalled();
  });
});
