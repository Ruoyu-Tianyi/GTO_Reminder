import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Plugin, ViteDevServer } from 'vite';
import { localDatasets } from './local-datasets';
import { publishedCharts } from './published-charts';
import { referenceRanges } from './reference-ranges';
import { privateDataLocked, PRIVATE_DATA_LOCK_MESSAGE } from './private-data-lock';

vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, lstat: vi.fn(original.lstat), readFile: vi.fn(original.readFile) };
});
const originalFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');

const roots: string[] = [];
async function rootWithLock(asDirectory = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gto-restore-lock-test-')); roots.push(root);
  const lock = path.join(root, 'data/private/exports/.restore-lock');
  await fs.mkdir(path.dirname(lock), { recursive: true });
  if (asDirectory) await fs.mkdir(lock); else await fs.writeFile(lock, 'not-even-json');
  return { root, lock };
}
type Handler = (req: { method: string; url: string }, res: { writeHead: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }, next: () => void) => Promise<void>;
function endpoint(plugin: Plugin, root: string) {
  let handler: Handler;
  if (typeof plugin.configureServer !== 'function') throw new Error('Expected middleware');
  Reflect.apply(plugin.configureServer, {}, [{ config: { root }, middlewares: { use: (_: string, value: Handler) => { handler = value; } } } as unknown as ViteDevServer]);
  return async (method = 'GET') => {
    const res = { writeHead: vi.fn(), end: vi.fn() };
    await handler({ method, url: '/' }, res, vi.fn());
    return res;
  };
}
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(fs.lstat).mockReset().mockImplementation(originalFs.lstat);
  vi.mocked(fs.readFile).mockReset().mockImplementation(originalFs.readFile);
  for (const root of roots.splice(0)) {
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('gto-restore-lock-test-')) throw new Error('Unsafe test cleanup');
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe('private data restore visibility barrier', () => {
  it('treats invalid contents and non-file locks as active, with no lock parsing', async () => {
    const malformed = await rootWithLock(); expect(await privateDataLocked(malformed.root)).toBe(true);
    const directory = await rootWithLock(true); expect(await privateDataLocked(directory.root)).toBe(true);
    await fs.unlink(malformed.lock); expect(await privateDataLocked(malformed.root)).toBe(false);
  });
  it('fails closed when the lock cannot be inspected', async () => {
    vi.mocked(fs.lstat).mockRejectedValueOnce(Object.assign(new Error('no access'), { code: 'EACCES' }));
    expect(await privateDataLocked('/unavailable')).toBe(true);
  });
  for (const [name, factory] of [['local', localDatasets], ['published', publishedCharts], ['reference', referenceRanges]] as const) {
    it(`${name} API blocks partial restore and resumes after lock removal`, async () => {
      const { root, lock } = await rootWithLock(); const request = endpoint(factory(), root);
      const blocked = await request();
      expect(blocked.writeHead).toHaveBeenCalledWith(503, expect.objectContaining({ 'Retry-After': '1', 'Cache-Control': 'no-store' }));
      expect(JSON.parse(blocked.end.mock.calls[0][0]).error).toBe(PRIVATE_DATA_LOCK_MESSAGE);
      await fs.unlink(lock);
      expect((await request()).writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    });
    it(`${name} rechecks the lock before returning a scanned result`, async () => {
      const { root, lock } = await rootWithLock(); await fs.unlink(lock);
      const actual = originalFs.lstat;
      let checks = 0;
      vi.mocked(fs.lstat).mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
        if (args[0] === lock && ++checks === 2) await fs.writeFile(lock, 'restore started during scan');
        return actual(...args);
      }) as typeof fs.lstat);
      const response = await endpoint(factory(), root)();
      expect(response.writeHead).toHaveBeenCalledWith(503, expect.any(Object));
    });
    for (const initialEpoch of [null, 'a'.repeat(32)]) {
      it(`${name} rejects an overlapping completed restore even after its lock disappears (${initialEpoch === null ? 'first' : 'later'} restore)`, async () => {
        const { root, lock } = await rootWithLock(); await fs.unlink(lock);
        const epoch = path.join(path.dirname(lock), '.restore-generation');
        if (initialEpoch !== null) await fs.writeFile(epoch, initialEpoch);
        let epochReads = 0;
        vi.mocked(fs.lstat).mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
          if (args[0] === epoch && ++epochReads === 2) {
            await fs.writeFile(lock, 'restore owns the visibility barrier');
            await fs.writeFile(epoch, 'b'.repeat(32));
            await fs.unlink(lock);
          }
          return originalFs.lstat(...args);
        }) as typeof fs.lstat);
        const response = await endpoint(factory(), root)();
        expect(response.writeHead).toHaveBeenCalledWith(503, expect.any(Object));
        expect(JSON.parse(response.end.mock.calls[0][0]).datasets).toEqual([]);
        await expect(originalFs.lstat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
      });
    }
    it(`${name} accepts a stable generation without a restore lock`, async () => {
      const { root, lock } = await rootWithLock(); await fs.unlink(lock);
      await fs.writeFile(path.join(path.dirname(lock), '.restore-generation'), 'c'.repeat(32));
      expect((await endpoint(factory(), root)()).writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    });
  }
  it('captures the generation before the initial lock check', async () => {
    const { root, lock } = await rootWithLock(); await fs.unlink(lock);
    const epoch = path.join(path.dirname(lock), '.restore-generation');
    await fs.writeFile(epoch, 'a'.repeat(32));
    let lockReads = 0;
    vi.mocked(fs.lstat).mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
      if (args[0] === lock && ++lockReads === 1) await fs.writeFile(epoch, 'b'.repeat(32));
      return originalFs.lstat(...args);
    }) as typeof fs.lstat);
    expect((await endpoint(localDatasets(), root)()).writeHead).toHaveBeenCalledWith(503, expect.any(Object));
  });
  for (const contents of ['', ' ', 'a'.repeat(129), Buffer.from([0xff, 0xfe])]) {
    it(`does not mistake an invalid generation (${Buffer.byteLength(contents)} bytes) for an absent generation`, async () => {
      const { root, lock } = await rootWithLock(); await fs.unlink(lock);
      await fs.writeFile(path.join(path.dirname(lock), '.restore-generation'), contents);
      expect((await endpoint(localDatasets(), root)()).writeHead).toHaveBeenCalledWith(503, expect.any(Object));
    });
  }
  it('rejects a directory generation and an unreadable generation', async () => {
    const { root, lock } = await rootWithLock(); await fs.unlink(lock);
    const epoch = path.join(path.dirname(lock), '.restore-generation');
    await fs.mkdir(epoch);
    expect((await endpoint(localDatasets(), root)()).writeHead).toHaveBeenCalledWith(503, expect.any(Object));
    await fs.rmdir(epoch); await fs.writeFile(epoch, 'd'.repeat(32));
    vi.mocked(fs.readFile).mockImplementation((async (...args: Parameters<typeof fs.readFile>) => {
      if (args[0] === epoch) throw Object.assign(new Error('no access'), { code: 'EACCES' });
      return originalFs.readFile(...args);
    }) as typeof fs.readFile);
    expect((await endpoint(localDatasets(), root)()).writeHead).toHaveBeenCalledWith(503, expect.any(Object));
  });
  it('keeps HEAD responses bodyless', async () => {
    const { root } = await rootWithLock();
    const response = await endpoint(referenceRanges(), root)('HEAD');
    expect(response.writeHead).toHaveBeenCalledWith(503, expect.any(Object));
    expect(response.end).toHaveBeenCalledWith(undefined);
  });
});
