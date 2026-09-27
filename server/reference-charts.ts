import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';
import { CHART_REFERENCES } from '../src/data/references';

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
            const info = await stat(path.join(directory, reference.filename)).catch(() => null);
            return { id: reference.id, local: Boolean(info?.isFile() && info.size <= 60 * 1024 * 1024) };
          }));
          response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          response.end(request.method === 'HEAD' ? undefined : JSON.stringify(available)); return;
        }
        const reference = CHART_REFERENCES.find(item => route === `/${item.id}.pdf`);
        if (!reference) { response.writeHead(404); response.end(); return; }
        try {
          const filename = path.join(directory, reference.filename);
          const info = await stat(filename);
          if (!info.isFile() || info.size > 60 * 1024 * 1024) throw new Error('Invalid reference PDF');
          const data = request.method === 'HEAD' ? undefined : await readFile(filename);
          response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': info.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          response.end(data);
        } catch {
          if (!response.headersSent) response.writeHead(404);
          response.end();
        }
      });
    },
  };
}
