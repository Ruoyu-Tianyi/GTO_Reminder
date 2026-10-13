import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Plugin } from 'vite';
import { projectSevenMax, validateReferenceRanges, type ReferenceRangesResponse } from '../src/lib/reference-ranges';

// Updated only after running the transcription and checking the source/hand audit.
export const POKERCOACHING_RANGES_SHA256 = '249ec25b4efea0d1f4a1c6ac736e7333dfd2993f40e4e3e1f663311af3825cde';
export const RANGECONVERTER_6_LATER_SHA256 = '3291cbfac6969e40cf75fbe873ec5c29ac209d42937bfc4354fda796e55f905b';
export const RANGECONVERTER_9_LATER_SHA256 = '0c1af8ff0ba1cc9ea82582ebc2d3297d7033ce2d97256772b3dbc5afca9f664e';

async function loadArtifact(root: string, basename: string, reviewedHash: string): Promise<ReferenceRangesResponse> {
  const filename = path.resolve(root, 'data/private/research', basename);
  try {
    const info = await stat(filename);
    if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error('Reference artifact exceeds the supported size.');
    const content = await readFile(filename);
    if (content.length > 20 * 1024 * 1024 || createHash('sha256').update(content).digest('hex') !== reviewedHash) throw new Error('Reference artifact does not match the reviewed transcription.');
    const nodes = validateReferenceRanges(JSON.parse(content.toString('utf8')));
    return { nodes: [...nodes, ...projectSevenMax(nodes)], error: null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { nodes: [], error: null };
    return { nodes: [], error: error instanceof Error ? error.message : 'Reference loading failed.' };
  }
}

export async function loadReferenceRanges(root: string, reviewedHash = POKERCOACHING_RANGES_SHA256): Promise<ReferenceRangesResponse> {
  const results = await Promise.all([
    loadArtifact(root, 'derived-pokercoaching-ranges.json', reviewedHash),
    loadArtifact(root, 'derived-rangeconverter-6max-later.json', RANGECONVERTER_6_LATER_SHA256),
    loadArtifact(root, 'derived-rangeconverter-9max-later.json', RANGECONVERTER_9_LATER_SHA256),
  ]);
  return { nodes: results.flatMap(result => result.nodes), error: results.map(result => result.error).filter(Boolean).join(' ') || null };
}

export function referenceRanges(): Plugin {
  return { name: 'gto-reference-ranges', apply: 'serve', configureServer(server) {
    server.middlewares.use('/api/reference-ranges', async (request, response) => {
      const route = (request.url ?? '/').split('?')[0];
      if (route !== '/' && route !== '') { response.writeHead(404); response.end(); return; }
      if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
      const body = JSON.stringify(await loadReferenceRanges(server.config.root));
      response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : body);
    });
  } };
}
