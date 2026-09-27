import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Plugin } from 'vite';
import { CHART_REFERENCES, type ChartReference } from '../src/data/references';

async function reviewedPdf(directory: string, reference: ChartReference): Promise<Buffer> {
  const filename = path.join(directory, reference.filename);
  const info = await stat(filename);
  if (!info.isFile() || info.size > 60 * 1024 * 1024) throw new Error('Invalid reference PDF');
  const data = await readFile(filename);
  if (createHash('sha256').update(data).digest('hex') !== reference.sha256) throw new Error('Unreviewed PDF edition');
  return data;
}

/** Serve only explicitly catalogued PDFs, never arbitrary private files. */
export function referenceCharts(): Plugin {
  return {
    name: 'gto-reference-charts', apply: 'serve',
    configureServer(server) {
      const directory = path.resolve(server.config.root, 'data/private/research');
      server.middlewares.use('/api/reference-charts', async (request, response) => {
        const route = (request.url ?? '/').split('?')[0];
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
        }
        if (route === '/') {
          const available = await Promise.all(CHART_REFERENCES.map(async reference => {
            const local = await reviewedPdf(directory, reference).then(() => true, () => false);
            return { id: reference.id, local };
          }));
          response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          response.end(request.method === 'HEAD' ? undefined : JSON.stringify(available)); return;
        }
        const reference = CHART_REFERENCES.find(item => route === `/${item.id}.pdf`);
        if (!reference) { response.writeHead(404); response.end(); return; }
        try {
          const data = await reviewedPdf(directory, reference);
          response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': data.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          response.end(request.method === 'HEAD' ? undefined : data);
        } catch {
          if (!response.headersSent) response.writeHead(404);
          response.end();
        }
      });
    },
  };
}
