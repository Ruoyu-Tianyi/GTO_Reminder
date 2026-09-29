import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';
import { validateDataset, type Dataset } from '../src/lib/poker';
import { validateTreeDataset, type TreeDataset } from '../src/lib/tree-strategy';

/** Personal strategy files stay outside the source bundle and Git repository. */
export function localDatasets(): Plugin {
  return {
    name: 'gto-local-strategy-library',
    apply: 'serve',
    configureServer(server) {
      const directory = path.resolve(server.config.root, 'data/private');
      server.middlewares.use('/api/local-datasets', async (request, response, next) => {
        if ((request.url ?? '/').split('?')[0] !== '/') return next();
        if (request.method !== 'GET') {
          response.writeHead(405, { Allow: 'GET' });
          response.end();
          return;
        }
        const datasets: Dataset[] = [];
        const treeDatasets: TreeDataset[] = [];
        const errors: string[] = [];
        try {
          const entries = await readdir(directory, { withFileTypes: true }).catch(error => {
            if (error.code === 'ENOENT') return [];
            throw error;
          });
          for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
            try {
              const filename = path.join(directory, entry.name);
              if ((await stat(filename)).size > 20 * 1024 * 1024) throw new Error('Dataset exceeds the 20 MB limit.');
              const raw = JSON.parse(await readFile(filename, 'utf8'));
              const dataset = raw?.schemaVersion === 2 ? validateTreeDataset(raw) : validateDataset(raw);
              if (dataset.id === 'gto-reminder-ui-demo-v1' || [...datasets, ...treeDatasets].some(existing => existing.id === dataset.id)) {
                throw new Error('Dataset ID is reserved or already loaded.');
              }
              if (dataset.schemaVersion === 2) treeDatasets.push(dataset);
              else datasets.push(dataset);
            } catch (error) {
              errors.push(`${entry.name}: ${error instanceof Error ? error.message : 'Invalid dataset'}`);
            }
          }
          response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          response.end(JSON.stringify({ datasets, treeDatasets, errors }));
        } catch {
          response.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          response.end(JSON.stringify({ datasets: [], treeDatasets: [], errors: ['The local strategy folder could not be read.'] }));
        }
      });
    },
  };
}
