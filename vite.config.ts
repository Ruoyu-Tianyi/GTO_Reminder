import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { localDatasets } from './server/local-datasets';
import { referenceCharts } from './server/reference-charts';
import { publishedCharts } from './server/published-charts';
import { referenceRanges } from './server/reference-ranges';
export default defineConfig({ plugins: [react(), localDatasets(), referenceCharts(), publishedCharts(), referenceRanges()], base: './', server: { watch: { ignored: ['**/data/private/**', '**/.runtime/**'] } } });
