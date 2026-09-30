import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Plugin } from 'vite';
import { validatePublishedCharts, type PublishedChartsResponse } from '../src/lib/published-charts';

export const PUBLISHED_CHARTS_SHA256 = '9c99741a172bb8534de608385a2380d1da6e5ff267628595a17ed779005ba5f6';
export const PUBLISHED_RESPONSE_CHARTS_SHA256 = 'a87eedd66e38864152f6c969e7cc3f7c58f3481bfdd2388c452b445f1f144d25';
const MAX_BYTES = 20 * 1024 * 1024;

/** The hash is an internal review boundary, never supplied by an HTTP request. */
async function loadArtifact(projectRoot: string, approvedSha256: string, kind: 'rfi' | 'vs-open'): Promise<PublishedChartsResponse> {
  const filename = path.resolve(projectRoot, 'data/private/research', kind === 'rfi' ? 'derived-chart-ranges.json' : 'derived-response-ranges.json');
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
  try {
    const nodes = validatePublishedCharts(value).nodes;
    if (!nodes.every(node => node.kind === kind)) throw new Error('Wrong artifact kind');
    return { nodes, error: null };
  }
  catch { return { nodes: [], error: 'Published chart data failed validation.' }; }
}

export function loadPublishedCharts(projectRoot: string, approvedSha256 = PUBLISHED_CHARTS_SHA256): Promise<PublishedChartsResponse> {
  return loadArtifact(projectRoot, approvedSha256, 'rfi');
}

export function loadPublishedResponseCharts(projectRoot: string, approvedSha256 = PUBLISHED_RESPONSE_CHARTS_SHA256): Promise<PublishedChartsResponse> {
  return loadArtifact(projectRoot, approvedSha256, 'vs-open');
}

/** Hash overrides are for internal contract tests; they are never HTTP inputs. */
export async function loadAllPublishedCharts(projectRoot: string, hashes = { rfi: PUBLISHED_CHARTS_SHA256, vsOpen: PUBLISHED_RESPONSE_CHARTS_SHA256 }): Promise<PublishedChartsResponse> {
  const [rfi, responses] = await Promise.all([
    loadPublishedCharts(projectRoot, hashes.rfi), loadPublishedResponseCharts(projectRoot, hashes.vsOpen),
  ]);
  const errors = [rfi.error && `RFI: ${rfi.error}`, responses.error && `Facing Open: ${responses.error}`].filter(Boolean);
  const seenIds = new Set(rfi.nodes.map(node => node.id));
  if (responses.nodes.some(node => seenIds.has(node.id))) {
    return { nodes: rfi.nodes, error: [...errors, 'Facing Open: Duplicate chart ids across files.'].join(' ') };
  }
  return { nodes: [...rfi.nodes, ...responses.nodes], error: errors.length ? errors.join(' ') : null };
}

/** Reads two reviewed local files; original and transcribed data stay private. */
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
        const result = await loadAllPublishedCharts(server.config.root);
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
