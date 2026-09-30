import { createHash } from 'node:crypto';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHART_REFERENCES } from '../src/data/references';
import { HANDS } from '../src/lib/poker';
import { REVIEWED_RESPONSE_CHARTS } from '../src/lib/published-charts';
import { loadPublishedCharts, loadPublishedResponseCharts, loadAllPublishedCharts, publishedCharts, PUBLISHED_CHARTS_SHA256, PUBLISHED_RESPONSE_CHARTS_SHA256 } from './published-charts';

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
const RESPONSE_FILE = path.resolve(ROOT, 'data/private/research/derived-response-ranges.json');
function responseFixture() {
  const input = fixture();
  const source = input.sources[0];
  const chart = REVIEWED_RESPONSE_CHARTS.find(chart => chart.players === 6 && chart.hero === 'HJ' && chart.villain === 'UTG')!;
  return {
    ...input,
    sources: [{ id: source.id, name: source.name, title: source.title, url: source.url, sha256: source.sha256, localFile: source.localFile, pages: [4, 5, 6, 7, 8] }],
    nodes: [{ ...input.nodes[0], id: 'synthetic-response-api-contract-fixture', hero: 'HJ', sourcePosition: 'MP', kind: 'vs-open',
      villain: 'UTG', sourceVillain: 'UTG', page: chart.page, facingRaiseToBb: chart.facingRaiseToBb, raiseToBb: chart.raiseToBb,
      callMeaning: 'Call Open', printedCallPercent: null }],
  };
}
function setFile(text: string) {
  const bytes = Buffer.from(text, 'utf8');
  fs.stat.mockResolvedValue({ size: bytes.length, isFile: () => true });
  fs.readFile.mockResolvedValue(bytes);
  return createHash('sha256').update(bytes).digest('hex');
}
function setFiles(rfi?: string, responses?: string) {
  const files = new Map<string, Buffer>();
  if (rfi !== undefined) files.set(FILE, Buffer.from(rfi, 'utf8'));
  if (responses !== undefined) files.set(RESPONSE_FILE, Buffer.from(responses, 'utf8'));
  fs.stat.mockImplementation(async (filename: string) => {
    const bytes = files.get(filename);
    if (!bytes) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return { size: bytes.length, isFile: () => true };
  });
  fs.readFile.mockImplementation(async (filename: string) => files.get(filename));
  return {
    rfi: rfi === undefined ? PUBLISHED_CHARTS_SHA256 : createHash('sha256').update(rfi).digest('hex'),
    vsOpen: responses === undefined ? PUBLISHED_RESPONSE_CHARTS_SHA256 : createHash('sha256').update(responses).digest('hex'),
  };
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

describe('separately reviewed Facing Open artifact', () => {
  it('loads the response file only through its fixed path and reviewed schema', async () => {
    const hashes = setFiles(undefined, JSON.stringify(responseFixture()));
    const result = await loadPublishedResponseCharts(ROOT, hashes.vsOpen);
    expect(result.error).toBeNull();
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].kind).toBe('vs-open');
    expect(fs.readFile).toHaveBeenCalledExactlyOnceWith(RESPONSE_FILE);
  });

  it('merges independent RFI and response nodes without changing the old file contract', async () => {
    const hashes = setFiles(JSON.stringify(fixture()), JSON.stringify(responseFixture()));
    const result = await loadAllPublishedCharts(ROOT, hashes);
    expect(result.error).toBeNull();
    expect(result.nodes.map(node => node.kind)).toEqual(['rfi', 'vs-open']);
    expect(result.nodes[0].villain).toBeNull();
    expect(result.nodes[1].villain).toBe('UTG');
    expect(fs.readFile.mock.calls.map(call => call[0]).sort()).toEqual([FILE, RESPONSE_FILE].sort());
  });

  it('keeps valid RFI data when the response JSON is bad and reports its error', async () => {
    const hashes = setFiles(JSON.stringify(fixture()), '{');
    const result = await loadAllPublishedCharts(ROOT, hashes);
    expect(result.nodes.map(node => node.kind)).toEqual(['rfi']);
    expect(result.error).toBe('Facing Open: Published chart JSON is invalid.');
  });

  it('keeps valid response data when the RFI JSON is bad and reports its error', async () => {
    const hashes = setFiles('{', JSON.stringify(responseFixture()));
    const result = await loadAllPublishedCharts(ROOT, hashes);
    expect(result.nodes.map(node => node.kind)).toEqual(['vs-open']);
    expect(result.error).toBe('RFI: Published chart JSON is invalid.');
  });

  it('does not report missing optional files as invalid data', async () => {
    const hashes = setFiles(undefined, JSON.stringify(responseFixture()));
    const result = await loadAllPublishedCharts(ROOT, hashes);
    expect(result.nodes).toHaveLength(1);
    expect(result.error).toBeNull();
  });

  it('reports both errors when neither file validates', async () => {
    const hashes = setFiles('{', '{');
    expect(await loadAllPublishedCharts(ROOT, hashes)).toEqual({ nodes: [], error: 'RFI: Published chart JSON is invalid. Facing Open: Published chart JSON is invalid.' });
  });

  it('does not let one artifact pass using the other reviewed hash', async () => {
    const hashes = setFiles(JSON.stringify(fixture()), JSON.stringify(responseFixture()));
    const result = await loadAllPublishedCharts(ROOT, { rfi: hashes.vsOpen, vsOpen: hashes.rfi });
    expect(result.nodes).toEqual([]);
    expect(result.error).toContain('RFI: Published chart file does not match the reviewed version.');
    expect(result.error).toContain('Facing Open: Published chart file does not match the reviewed version.');
  });

  it('rejects a correctly hashed RFI artifact placed in the response file', async () => {
    const hashes = setFiles(undefined, JSON.stringify(fixture()));
    expect(await loadPublishedResponseCharts(ROOT, hashes.vsOpen)).toEqual({ nodes: [], error: 'Published chart data failed validation.' });
  });

  it('rejects a correctly hashed response artifact placed in the RFI file', async () => {
    const hashes = setFiles(JSON.stringify(responseFixture()));
    expect(await loadPublishedCharts(ROOT, hashes.rfi)).toEqual({ nodes: [], error: 'Published chart data failed validation.' });
  });

  it('prevents duplicate ids across artifacts while retaining the valid RFI library', async () => {
    const rfi = fixture();
    const responses = responseFixture();
    responses.nodes[0].id = rfi.nodes[0].id;
    const hashes = setFiles(JSON.stringify(rfi), JSON.stringify(responses));
    const result = await loadAllPublishedCharts(ROOT, hashes);
    expect(result.nodes.map(node => node.kind)).toEqual(['rfi']);
    expect(result.error).toBe('Facing Open: Duplicate chart ids across files.');
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
    expect(fs.readFile).toHaveBeenCalledWith(RESPONSE_FILE);
    expect(JSON.parse(res.end.mock.calls[0][0])).toEqual({ nodes: [], error: 'RFI: Published chart file does not match the reviewed version. Facing Open: Published chart file does not match the reviewed version.' });
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
