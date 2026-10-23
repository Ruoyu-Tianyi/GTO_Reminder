import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Plugin } from 'vite';
import { validatePublishedContinuations, type PublishedContinuationsResponse } from '../src/lib/published-continuations';

export const APPROVED_CONTINUATION_FILES = [
  { filename: 'derived-3bet-ranges.json', sha256: 'ab2e1658ecfeaa5903ff0608938592d9838e1365b252aa1ee6c16bf15aa9c443' },
  { filename: 'derived-4bet-actions.json', sha256: 'f7d22460d1e7522c0def86180b965933cd5c3380bb94952467d2b6c79e45b0b9' },
] as const;
const MAX_BYTES = 20 * 1024 * 1024;

/** Fixed private paths; hash overrides are internal tests, never request inputs. */
export async function loadPublishedContinuations(projectRoot: string,
  hashes: readonly string[] = APPROVED_CONTINUATION_FILES.map(file => file.sha256)): Promise<PublishedContinuationsResponse> {
  const results = await Promise.all(APPROVED_CONTINUATION_FILES.map(async (file, index): Promise<PublishedContinuationsResponse> => {
    const filename = path.resolve(projectRoot, 'data/private/research', file.filename);
    try {
      const info = await stat(filename);
      if (!info.isFile() || info.size > MAX_BYTES) throw new Error('File must be regular and at most 20 MB.');
      const bytes = await readFile(filename);
      if (bytes.length > MAX_BYTES) throw new Error('File exceeds 20 MB.');
      if (!/^[a-f0-9]{64}$/.test(hashes[index] ?? '') || createHash('sha256').update(bytes).digest('hex') !== hashes[index])
        throw new Error('File does not match the reviewed version.');
      const value: unknown = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
      return { nodes: validatePublishedContinuations(value).nodes, errors: [] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { nodes: [], errors: [] };
      return { nodes: [], errors: [`${file.filename}: ${error instanceof Error ? error.message : 'Data could not be read.'}`] };
    }
  }));
  const nodes: PublishedContinuationsResponse['nodes'] = [];
  const errors = results.flatMap(result => result.errors);
  const seenIds = new Set<string>();
  for (const result of results) {
    if (result.nodes.some(node => seenIds.has(node.id))) { errors.push('Duplicate continuation ids across files; conflicting file omitted.'); continue; }
    for (const node of result.nodes) { seenIds.add(node.id); nodes.push(node); }
  }
  return { nodes, errors };
}

export function publishedContinuations(): Plugin {
  return {
    name: 'gto-published-continuations', apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/published-continuations', async (request, response) => {
        const route = (request.url ?? '/').split('?')[0];
        if (route !== '/' && route !== '') { response.writeHead(404); response.end(); return; }
        if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
        const result = await loadPublishedContinuations(server.config.root);
        const body = JSON.stringify(result);
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        response.end(request.method === 'HEAD' ? undefined : body);
      });
    },
  };
}
