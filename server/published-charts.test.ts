import { createHash } from 'node:crypto';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHART_REFERENCES } from '../src/data/references';
import { HANDS } from '../src/lib/poker';
import { loadPublishedCharts, publishedCharts, PUBLISHED_CHARTS_SHA256 } from './published-charts';

const fs = vi.hoisted(() => ({ stat: vi.fn(), readFile: vi.fn() }));
vi.mock('node:fs/promises', () => fs);

// Entirely synthetic frequencies for API contract tests, not publisher data.
function fixture() {
  const ref = CHART_REFERENCES.find(ref => ref.id === 'rangeconverter-6max-100bb')!;
  const source = { name: ref.provider, title: '6-max 100bb 100z', url: ref.url, sha256: ref.sha256 };
  return {
    schemaVersion: 1, kind: 'derived-published-chart', preparedAt: '2026-09-29', frequencyUnit: 'fraction',
    precision: { step: 0.5, label: 'Publisher simplified to 50% steps; not original solver frequencies' },
    sources: [{ ...source, id: 'rangeconverter-6max-100bb-100z', localFile: ref.filename, page: 3 }],
    nodes: [{ id: 'synthetic-api-contract-fixture', refId: ref.id, players: 6, stackBb: 100, format: 'cash',
      hero: 'UTG', sourcePosition: 'UTG', kind: 'rfi', raiseToBb: 2.5, ante: null, rake: null, page: 3,
      source, precision: { step: 0.5, kind: 'publisher-simplified' }, callMeaning: 'unused',
      frequencies: Object.fromEntries(HANDS.map(hand => [hand, { raise: 0, call: 0, fold: 1 }])),
      printedRaisePercent: 0, derivedRangeSummary: { raise: 1, call: 0, fold: 0 },
    }],
  };
}
const ROOT = path.resolve('synthetic-project-root');
const FILE = path.resolve(ROOT, 'data/private/research/derived-chart-ranges.json');
function setFile(text: string) {
  const bytes = Buffer.from(text, 'utf8');
  fs.stat.mockResolvedValue({ size: bytes.length, isFile: () => true });
  fs.readFile.mockResolvedValue(bytes);
  return createHash('sha256').update(bytes).digest('hex');
}

beforeEach(() => { vi.clearAllMocks(); fs.stat.mockReset(); fs.readFile.mockReset(); });

describe('loadPublishedCharts', () => {
  it('reads only the fixed local path and passes data through validation', async () => {
    const hash = setFile(JSON.stringify(fixture()));
    const result = await loadPublishedCharts(ROOT, hash);
    expect(fs.stat).toHaveBeenCalledWith(FILE);
    expect(fs.readFile).toHaveBeenCalledWith(FILE);
    expect(result.error).toBeNull();
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].derivedRangeSummary.raise).toBe(0);
    expect(result.nodes[0].derivedRangeSummary.fold).toBeCloseTo(1, 14);
    expect(result.nodes[0].ante).toBeNull();
    expect(result.nodes[0].rake).toBeNull();
  });

  it('allows a UTF-8 BOM only when those exact bytes are reviewed', async () => {
    const hash = setFile('\uFEFF' + JSON.stringify(fixture()));
    expect((await loadPublishedCharts(ROOT, hash)).nodes).toHaveLength(1);
  });

  it('returns an explicit empty result when the local file is absent', async () => {
    fs.stat.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    expect(await loadPublishedCharts(ROOT, PUBLISHED_CHARTS_SHA256)).toEqual({ nodes: [], error: null });
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  it('rejects unreviewed bytes even if they are otherwise structurally valid', async () => {
    setFile(JSON.stringify(fixture()));
    const result = await loadPublishedCharts(ROOT, PUBLISHED_CHARTS_SHA256);
    expect(result.nodes).toEqual([]);
    expect(result.error).toMatch(/reviewed version/);
  });

  it('rejects malformed JSON after checking its reviewed hash', async () => {
    const hash = setFile('{');
    expect(await loadPublishedCharts(ROOT, hash)).toEqual({ nodes: [], error: 'Published chart JSON is invalid.' });
  });

  it('rejects a correctly hashed file that fails the schema', async () => {
    const input = fixture();
    delete input.nodes[0].frequencies.AA;
    const hash = setFile(JSON.stringify(input));
    expect(await loadPublishedCharts(ROOT, hash)).toEqual({ nodes: [], error: 'Published chart data failed validation.' });
  });

  it('does not expose local paths or exception messages on read errors', async () => {
    fs.stat.mockRejectedValue(new Error('secret local filesystem path'));
    expect(await loadPublishedCharts(ROOT, PUBLISHED_CHARTS_SHA256)).toEqual({ nodes: [], error: 'Published chart file could not be read.' });
  });

  it.each([
    { size: 20 * 1024 * 1024 + 1, isFile: () => true },
    { size: 0, isFile: () => false },
  ])('rejects an invalid file before reading its contents', async info => {
    fs.stat.mockResolvedValue(info);
    const result = await loadPublishedCharts(ROOT, PUBLISHED_CHARTS_SHA256);
    expect(result.error).toMatch(/20 MB/);
    expect(result.nodes).toEqual([]);
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  it('rechecks actual byte length when a file grows after stat', async () => {
    fs.stat.mockResolvedValue({ size: 10, isFile: () => true });
    fs.readFile.mockResolvedValue(Buffer.alloc(20 * 1024 * 1024 + 1));
    const result = await loadPublishedCharts(ROOT, PUBLISHED_CHARTS_SHA256);
    expect(result).toEqual({ nodes: [], error: 'Published chart file exceeds 20 MB.' });
  });
});

type Response = { writeHead: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
type Handler = (request: { url?: string; method?: string }, response: Response) => Promise<void>;
function middleware() {
  let handler: Handler | undefined;
  const use = vi.fn((route: string, callback: Handler) => { expect(route).toBe('/api/published-charts'); handler = callback; });
  const plugin = publishedCharts();
  expect(plugin.apply).toBe('serve');
  const configure = plugin.configureServer as (server: unknown) => unknown;
  configure({ middlewares: { use }, config: { root: ROOT } });
  if (!handler) throw new Error('The API middleware was not registered.');
  return handler;
}
function response(): Response { return { writeHead: vi.fn(), end: vi.fn() }; }

describe('publishedCharts local API', () => {
  it('returns the empty GET response with JSON, no-store and content length headers', async () => {
    fs.stat.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    const res = response();
    await middleware()({ method: 'GET', url: '/' }, res);
    const body = JSON.stringify({ nodes: [], error: null });
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    });
    expect(res.end).toHaveBeenCalledWith(body);
  });

  it('HEAD sends the same headers without a response body', async () => {
    fs.stat.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    const res = response();
    await middleware()({ method: 'HEAD', url: '/' }, res);
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'application/json; charset=utf-8' }));
    expect(res.end).toHaveBeenCalledWith(undefined);
  });

  it('query parameters cannot choose another file or bypass the reviewed hash', async () => {
    const syntheticHash = setFile(JSON.stringify(fixture()));
    const res = response();
    await middleware()({ method: 'GET', url: `/?path=../../other.json&sha256=${syntheticHash}` }, res);
    expect(fs.readFile).toHaveBeenCalledWith(FILE);
    expect(JSON.parse(res.end.mock.calls[0][0])).toEqual({ nodes: [], error: 'Published chart file does not match the reviewed version.' });
  });

  it.each(['POST', 'PUT', 'DELETE'])('rejects %s without reading files', async method => {
    const res = response();
    await middleware()({ method, url: '/' }, res);
    expect(res.writeHead).toHaveBeenCalledWith(405, { Allow: 'GET, HEAD' });
    expect(fs.stat).not.toHaveBeenCalled();
  });

  it('rejects child routes without reading files', async () => {
    const res = response();
    await middleware()({ method: 'GET', url: '/../../private.json' }, res);
    expect(res.writeHead).toHaveBeenCalledWith(404);
    expect(fs.stat).not.toHaveBeenCalled();
  });
});
