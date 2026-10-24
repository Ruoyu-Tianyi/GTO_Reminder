import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { createStrategyDataClient } from './strategy-data-client';
import { historyKey, type TreeDataset } from './tree-strategy';
import type { StrategyDatasetResponse, StrategyLibraryManifest } from './strategy-library';

const root = '/strategy-library/';
const firstHistory = [{ actor: 'UTG' as const, type: 'fold' as const }];
const laterHistory = [...firstHistory, { actor: 'HJ' as const, type: 'raise' as const, amountBb: 2.5 }];
function tree(id: string, history = firstHistory): TreeDataset {
  return {
    schemaVersion: 2, id, name: `Synthetic ${id}`, game: { players: 6, stackBb: 100, anteBb: 0, format: 'cash', rake: 'none' },
    source: { name: 'Synthetic transport fixture', url: 'https://example.com/test', license: 'Tests only', retrievedAt: '2026-10-13', kind: 'demo', precision: 'Test data, not strategy' },
    nodes: [{ id: `${id}-node`, history, actions: [], hands: {} }],
  };
}

function fixture() {
  const first = tree('model-part-001');
  const second = { ...tree('model-part-002'), nodes: [{ ...tree('model-part-002').nodes[0], history: laterHistory }] };
  const manifest: StrategyLibraryManifest = {
    schemaVersion: 1, summary: 'assets/summary.json.gz', published: 'assets/published.json.gz', references: 'assets/references.json.gz',
    pdfs: { 'rangeconverter-6max-100bb': 'assets/chart.hash.pdf' },
    trees: { [first.id]: { file: 'assets/first.json.gz', packId: 'model' }, [second.id]: { file: 'assets/second.json.gz', packId: 'model' } },
    packs: { model: { index: 'assets/index.json.gz' } },
  };
  const summary: StrategyDatasetResponse = { datasets: [], treeDatasets: [], errors: [], treeLibrary: [first, second].map(({ id, name, game, source, nodes }) => ({ id, name, game, source, nodeCount: nodes.length, standardSpots: [] })) };
  const assets: Record<string, unknown> = {
    [manifest.summary]: summary,
    [manifest.published]: { nodes: [], error: null },
    [manifest.references]: { nodes: [], error: null },
    [manifest.trees[first.id].file]: first,
    [manifest.trees[second.id].file]: second,
    [manifest.packs.model.index]: { [historyKey(firstHistory)]: first.id, [historyKey(laterHistory)]: second.id },
  };
  const fetcher = vi.fn<typeof fetch>(async input => {
    const path = String(input).slice(root.length);
    if (path === 'manifest.json') return Response.json(manifest);
    if (!Object.hasOwn(assets, path)) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(gzipSync(JSON.stringify(assets[path]))));
  });
  const client = createStrategyDataClient({ development: false, fetcher });
  return { first, second, manifest, summary, assets, fetcher, client };
}

describe('static strategy library transport', () => {
  it('loads only the matching gzip part and preserves the requested source identity across parts', async () => {
    const { client, first, second, fetcher, summary } = fixture();
    const response = await client.strategyFetch(`/api/local-datasets?treeId=${first.id}&history=${encodeURIComponent(JSON.stringify(laterHistory))}`);
    const result = await response.json() as StrategyDatasetResponse;
    expect(result.matchedPartId).toBe(second.id);
    expect(result.treeDatasets[0]).toEqual({ ...second, id: first.id, name: first.name });
    expect(fetcher.mock.calls.map(call => String(call[0]))).not.toContain(root + 'assets/first.json.gz');
    const loaded = await (await client.strategyFetch('/api/local-datasets?summary=1')).json();
    expect(loaded).toEqual(summary);
    const calls = fetcher.mock.calls.length;
    await client.strategyFetch(`/api/local-datasets?treeId=${second.id}`);
    expect(fetcher).toHaveBeenCalledTimes(calls);
    expect(client.resolveReferencePdfUrl('rangeconverter-6max-100bb')).toBe(root + 'assets/chart.hash.pdf');
  });

  it('returns no invented node for an unknown history and rejects an index pointing to another pack', async () => {
    const { client, manifest, assets, second } = fixture();
    const absent = await (await client.strategyFetch('/api/local-datasets?treeId=model-part-001&history=[]')).json() as StrategyDatasetResponse;
    expect(absent.treeDatasets).toEqual([]);
    expect(absent.errors).toEqual([]);
    const malformed = await client.strategyFetch('/api/local-datasets?treeId=model-part-001&history=%7B%7D');
    expect(malformed.status).toBe(400);
    manifest.packs.other = { index: 'assets/other.json.gz' };
    manifest.trees[second.id].packId = 'other';
    const isolated = createStrategyDataClient({ development: false, fetcher: async input => {
      const path = String(input).slice(root.length);
      return path === 'manifest.json' ? Response.json(manifest) : new Response(new Uint8Array(gzipSync(JSON.stringify(assets[path]))));
    } });
    await expect(isolated.strategyFetch(`/api/local-datasets?treeId=model-part-001&history=${encodeURIComponent(JSON.stringify(laterHistory))}`)).rejects.toThrow(/outside the selected model/);
  });

  it('cancels one reader without cancelling a shared download or poisoning the next request', async () => {
    const { manifest, summary } = fixture();
    let release!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(async input => String(input).endsWith('manifest.json')
      ? new Promise<Response>(resolve => { release = resolve; })
      : new Response(new Uint8Array(gzipSync(JSON.stringify(summary)))));
    const client = createStrategyDataClient({ development: false, fetcher });
    const controller = new AbortController();
    const cancelled = client.strategyFetch('/api/local-datasets?summary=1', { signal: controller.signal });
    const active = client.strategyFetch('/api/local-datasets?summary=1');
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    release(Response.json(manifest));
    expect(await (await active).json()).toEqual(summary);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await (await client.strategyFetch('/api/local-datasets?summary=1')).json()).toEqual(summary);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('retries a failed compressed download and keeps only the three most recently used tree parts', async () => {
    const { manifest, assets, fetcher } = fixture();
    for (const id of ['model-part-003', 'model-part-004']) {
      manifest.trees[id] = { file: `assets/${id}.json.gz`, packId: 'model' };
      assets[manifest.trees[id].file] = tree(id);
    }
    let fail = true;
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).endsWith('first.json.gz') && fail) { fail = false; return new Response('broken compressed JSON'); }
      return fetcher(input, init);
    });
    const client = createStrategyDataClient({ development: false, fetcher: transport });
    await expect(client.strategyFetch('/api/local-datasets?treeId=model-part-001')).rejects.toThrow();
    for (const id of Object.keys(manifest.trees)) await client.strategyFetch(`/api/local-datasets?treeId=${id}`);
    const before = transport.mock.calls.length;
    await client.strategyFetch('/api/local-datasets?treeId=model-part-001');
    expect(transport).toHaveBeenCalledTimes(before + 1);
  });

  it('keeps development requests on the real API', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ local: true }));
    const client = createStrategyDataClient({ development: true, fetcher });
    const signal = new AbortController().signal;
    await client.strategyFetch('/api/local-datasets?summary=1', { signal });
    expect(fetcher).toHaveBeenCalledWith('/api/local-datasets?summary=1', { signal });
    expect(client.resolveReferencePdfUrl('rangeconverter-6max-100bb')).toBe('/api/reference-charts/rangeconverter-6max-100bb.pdf');
  });
});
