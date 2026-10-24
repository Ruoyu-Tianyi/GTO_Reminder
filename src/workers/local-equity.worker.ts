import { LocalEquityEngine, type LocalEquityRequest, type LocalEquityWorkerMessage } from '../lib/local-equity';

// A structural worker type avoids importing the conflicting DOM/WebWorker global libraries.
const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<{ type: 'start'; request: LocalEquityRequest } | { type: 'cancel' }>) => void) | null;
  postMessage: (message: LocalEquityWorkerMessage) => void;
};
let generation = 0;
workerScope.onmessage = (event) => {
  const current = ++generation;
  if (event.data.type === 'cancel') return;
  try {
    const engine = new LocalEquityEngine(event.data.request);
    let lastUpdate = 0;
    const runBatch = () => {
      if (current !== generation) return;
      try {
        const progress = engine.step(500, 20);
        const now = performance.now();
        if (progress.done || now - lastUpdate >= 100) {
          workerScope.postMessage({ type: progress.done ? 'complete' : 'progress', progress });
          lastUpdate = now;
        }
        if (!progress.done) setTimeout(runBatch, 0);
      } catch (error) {
        workerScope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    };
    runBatch();
  } catch (error) {
    workerScope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
