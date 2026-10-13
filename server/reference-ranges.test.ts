import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { loadReferenceRanges } from './reference-ranges';
import { CHART_REFERENCES } from '../src/data/references';
import { HANDS } from '../src/lib/poker';
const fs = vi.hoisted(() => ({ stat: vi.fn(), readFile: vi.fn() }));
vi.mock('node:fs/promises', () => fs);
function fixture() {
  const source = CHART_REFERENCES[1];
  return { schemaVersion: 1, kind: 'reference-ranges', source: { name: source.provider, title: source.title, url: source.url, sha256: source.sha256 }, nodes: [{ id: 'synthetic-contract', refId: source.id, players: 8, stackBb: 100, kind: 'rfi', hero: 'BTN', villain: null, page: 4,
    actions: [{ id: 'raise', type: 'raise', label: 'Raise 3 BB', amountBb: 3 }, { id: 'fold', type: 'fold', label: 'Fold' }], hands: Object.fromEntries(HANDS.map(hand => [hand, { status: 'available', frequencies: { raise: 0.5, fold: 0.5 } }])), precision: 'Test only', notes: ['Synthetic fixture'] }] };
}
beforeEach(() => { vi.resetAllMocks(); fs.stat.mockImplementation(async (filename: string) => { if (!filename.endsWith('derived-pokercoaching-ranges.json')) throw Object.assign(new Error(), { code: 'ENOENT' }); return { isFile: () => true, size: 100 }; }); });
it('loads reviewed source and labels its seven-seat projection separately', async () => {
  const content = Buffer.from(JSON.stringify(fixture())); fs.readFile.mockResolvedValue(content);
  const result = await loadReferenceRanges('/workspace', createHash('sha256').update(content).digest('hex'));
  expect(result.error).toBeNull();
  expect(result.nodes.map(node => [node.players, node.provenance])).toEqual([[8, 'image-transcription'], [7, 'seat-projection']]);
});
it('rejects changed bytes even if JSON is structurally valid', async () => {
  fs.readFile.mockResolvedValue(Buffer.from(JSON.stringify(fixture())));
  const result = await loadReferenceRanges('/workspace', '0'.repeat(64));
  expect(result.nodes).toEqual([]); expect(result.error).toContain('reviewed');
});
it('rejects invalid frequencies after hash verification and tolerates missing local files', async () => {
  const data = fixture(); data.nodes[0].hands.AA.frequencies.raise = 0.8;
  const content = Buffer.from(JSON.stringify(data)); fs.readFile.mockResolvedValue(content);
  const result = await loadReferenceRanges('/workspace', createHash('sha256').update(content).digest('hex'));
  expect(result.nodes).toEqual([]); expect(result.error).toContain('sum');
  fs.stat.mockRejectedValue(Object.assign(new Error(), { code: 'ENOENT' }));
  expect(await loadReferenceRanges('/workspace')).toEqual({ nodes: [], error: null });
});
