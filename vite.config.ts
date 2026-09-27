import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { localDatasets } from './server/local-datasets';
import { referenceCharts } from './server/reference-charts';
export default defineConfig({ plugins: [react(), localDatasets(), referenceCharts()], base: './' });
