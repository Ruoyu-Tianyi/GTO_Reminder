import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Plugin } from 'vite';
import { validatePublishedCharts, type PublishedChartsResponse } from '../src/lib/published-charts';

export const PUBLISHED_CHARTS_SHA256 = '9c99741a172bb8534de608385a2380d1da6e5ff267628595a17ed779005ba5f6';
const MAX_BYTES = 20 * 1024 * 1024;

/** The hash is an internal review boundary, never supplied by an HTTP request. */
export async function loadPublishedCharts(projectRoot: string, approvedSha256: string): Promise<PublishedChartsResponse> {
  const filename = path.resolve(projectRoot, 'data/private/research/derived-chart-ranges.json');
  let content: Buffer;
  try {
    const info = await stat(filename);
    if (!info.isFile() || info.size > MAX_BYTES) return { nodes: [], error: 'Published chart file is invalid or exceeds 20 MB.' };
    content = await readFile(filename);
    if (content.length > MAX_BYTES) return { nodes: [], error: 'Published chart file exceeds 20 MB.' };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { nodes: [], error: null };
    return { nodes: [], error: 'Published chart file could not be read.' };
  }
  if (!/^[0-9a-f]{64}$/.test(approvedSha256) || createHash('sha256').update(content).digest('hex') !== approvedSha256) {
    return { nodes: [], error: 'Published chart file does not match the reviewed version.' };
  }
  let value: unknown;
  try { value = JSON.parse(content.toString('utf8').replace(/^\uFEFF/, '')); }
  catch { return { nodes: [], error: 'Published chart JSON is invalid.' }; }
  try { return { nodes: validatePublishedCharts(value).nodes, error: null }; }
  catch { return { nodes: [], error: 'Published chart data failed validation.' }; }
}

/** Reads one reviewed local file; original and transcribed data stay private. */
export function publishedCharts(): Plugin {
  return {
    name: 'gto-published-charts', apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/published-charts', async (request, response) => {
        const route = (request.url ?? '/').split('?')[0];
        if (route !== '/' && route !== '') { response.writeHead(404); response.end(); return; }
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
        }
        const result = await loadPublishedCharts(server.config.root, PUBLISHED_CHARTS_SHA256);
        const body = JSON.stringify(result);
        response.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        });
        response.end(request.method === 'HEAD' ? undefined : body);
      });
    },
  };
}
