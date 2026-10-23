import { createHash } from 'node:crypto';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HANDS } from '../src/lib/poker';
import { REVIEWED_CONTINUATION_CATALOG } from '../src/lib/published-continuations';
import { APPROVED_CONTINUATION_FILES, loadPublishedContinuations, publishedContinuations } from './published-continuations';

const fs = vi.hoisted(() => ({ stat: vi.fn(), readFile: vi.fn() }));
vi.mock('node:fs/promises', () => fs);
const ROOT = path.resolve('synthetic-project-root');
const FILES = APPROVED_CONTINUATION_FILES.map(file => path.resolve(ROOT, 'data/private/research', file.filename));
function fixture(graphical = false) {
  const meta = REVIEWED_CONTINUATION_CATALOG.find(node => (node.precision.kind === 'graphical-actions') === graphical)!;
  // Synthetic strategy for transport tests only; the source chart is not copied.
  return JSON.stringify({ schemaVersion: 1, kind: 'published-continuations', preparedAt: '2026-10-23', nodes: [{ ...meta,
    hands: Object.fromEntries(HANDS.map(hand => [hand, graphical
      ? { status: 'actions-only', reach: null, actions: ['call'] }
      : { status: 'available', reach: null, frequencies: Object.fromEntries(meta.actions.map(action => [action.id, action.id === 'call' ? 1 : 0])) }])),
  }] });
}
function files(values: (string | undefined)[]) {
  const contents = new Map(FILES.map((filename, index) => [filename, values[index] === undefined ? undefined : Buffer.from(values[index]!, 'utf8')]));
  fs.stat.mockImplementation(async (filename: string) => {
    const bytes = contents.get(filename);
    if (!bytes) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return { isFile: () => true, size: bytes.length };
  });
  fs.readFile.mockImplementation(async (filename: string) => contents.get(filename));
  return values.map(value => value === undefined ? '0'.repeat(64) : createHash('sha256').update(value).digest('hex'));
}
beforeEach(() => { vi.clearAllMocks(); fs.stat.mockReset(); fs.readFile.mockReset(); });

describe('local continuation artifact loader', () => {
  it('loads both independently approved artifacts and strips extraction internals', async () => {
    const hashes = files([fixture(), fixture(true)]);
    const result = await loadPublishedContinuations(ROOT, hashes);
    expect(result.errors).toEqual([]);
    expect(result.nodes.map(node => node.precision.kind)).toEqual(['publisher-simplified', 'graphical-actions']);
    expect(fs.readFile.mock.calls.map(call => call[0]).sort()).toEqual([...FILES].sort());
    expect(result.nodes[0].hands.AA).not.toHaveProperty('cellBox');
  });
  it.each([0, 1])('keeps the other valid artifact when file %s is invalid', async invalid => {
    const values = [fixture(), fixture(true)]; values[invalid] = '{';
    const result = await loadPublishedContinuations(ROOT, files(values));
    expect(result.nodes).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain(APPROVED_CONTINUATION_FILES[invalid].filename);
  });
  it('accepts absent optional artifacts without fabricating a node', async () => {
    expect(await loadPublishedContinuations(ROOT, files([undefined, undefined]))).toEqual({ nodes: [], errors: [] });
  });
  it('rejects unreviewed bytes and never reads another path', async () => {
    files([fixture(), fixture(true)]);
    const result = await loadPublishedContinuations(ROOT);
    expect(result.nodes).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.every(error => error.includes('reviewed version'))).toBe(true);
    expect(fs.readFile.mock.calls.map(call => call[0]).sort()).toEqual([...FILES].sort());
  });
  it('rejects valid JSON that makes qualitative evidence numeric', async () => {
    const value = JSON.parse(fixture(true));
    value.nodes[0].hands.AA.frequencies = { allin: 0.5, call: 0.5, fold: 0 };
    const result = await loadPublishedContinuations(ROOT, files([fixture(), JSON.stringify(value)]));
    expect(result.nodes).toHaveLength(1);
    expect(result.errors.join(' ')).toContain('cannot claim numerical');
  });
  it('rejects duplicate charts across artifacts while retaining the first', async () => {
    const text = fixture();
    const result = await loadPublishedContinuations(ROOT, files([text, text]));
    expect(result.nodes).toHaveLength(1);
    expect(result.errors.join(' ')).toContain('Duplicate continuation ids');
  });
  it('rejects oversized/nonregular files before reading and rechecks bytes after stat', async () => {
    fs.stat.mockResolvedValue({ isFile: () => false, size: 1 });
    expect((await loadPublishedContinuations(ROOT)).nodes).toEqual([]);
    expect(fs.readFile).not.toHaveBeenCalled();
    fs.stat.mockResolvedValue({ isFile: () => true, size: 20 * 1024 * 1024 + 1 });
    await loadPublishedContinuations(ROOT);
    expect(fs.readFile).not.toHaveBeenCalled();
    fs.stat.mockResolvedValue({ isFile: () => true, size: 1 });
    fs.readFile.mockResolvedValue(Buffer.alloc(20 * 1024 * 1024 + 1));
    expect((await loadPublishedContinuations(ROOT)).errors.every(error => error.includes('exceeds 20 MB'))).toBe(true);
  });
});

type Reply = { writeHead: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
type Handler = (request: { url?: string; method?: string }, reply: Reply) => Promise<void>;
function handler(): Handler {
  let callback: Handler | undefined;
  const plugin = publishedContinuations();
  expect(plugin.apply).toBe('serve');
  (plugin.configureServer as (server: unknown) => void)({ config: { root: ROOT }, middlewares: { use: (route: string, fn: Handler) => {
    expect(route).toBe('/api/published-continuations'); callback = fn;
  } } });
  return callback!;
}
describe('continuation API boundary', () => {
  it.each(['GET', 'HEAD'])('%s serves JSON without caching private ranges', async method => {
    files([undefined, undefined]);
    const reply = { writeHead: vi.fn(), end: vi.fn() };
    await handler()({ method, url: '/' }, reply);
    expect(reply.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }));
    expect(reply.end).toHaveBeenCalledWith(method === 'HEAD' ? undefined : JSON.stringify({ nodes: [], errors: [] }));
  });
  it.each(['POST', 'PUT', 'DELETE'])('rejects %s without reading local files', async method => {
    const reply = { writeHead: vi.fn(), end: vi.fn() };
    await handler()({ method, url: '/' }, reply);
    expect(reply.writeHead).toHaveBeenCalledWith(405, { Allow: 'GET, HEAD' });
    expect(fs.stat).not.toHaveBeenCalled();
  });
  it('rejects child routes and ignores query attempts to replace the reviewed paths', async () => {
    const reply = { writeHead: vi.fn(), end: vi.fn() };
    await handler()({ method: 'GET', url: '/../../secret' }, reply);
    expect(reply.writeHead).toHaveBeenCalledWith(404);
    expect(fs.stat).not.toHaveBeenCalled();
    files([undefined, undefined]);
    await handler()({ method: 'GET', url: '/?path=../../secret&sha256=override' }, reply);
    expect(fs.stat.mock.calls.map(call => call[0]).sort()).toEqual([...FILES].sort());
  });
});
