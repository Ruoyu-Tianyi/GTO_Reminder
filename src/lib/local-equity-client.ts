import type { LocalEquityCallbacks, LocalEquityRequest, LocalEquityWorkerMessage } from './local-equity';

let activeWorkers = 0;
/** One worker per calculation; at most two workers, reserving one reported CPU for the UI when possible. */
export function startLocalEquityCalculation(request: LocalEquityRequest, callbacks: LocalEquityCallbacks): { cancel: () => void } {
  const workerLimit = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1));
  if (activeWorkers >= workerLimit) throw new Error('Local calculation capacity is busy. Stop an existing calculation first.');
  const worker = new Worker(new URL('../workers/local-equity.worker.ts', import.meta.url), { type: 'module' });
  activeWorkers += 1;
  let ended = false;
  const cancel = () => {
    if (ended) return;
    ended = true;
    worker.terminate();
    activeWorkers -= 1;
  };
  worker.onmessage = (event: MessageEvent<LocalEquityWorkerMessage>) => {
    if (ended) return;
    const message = event.data;
    if (message.type === 'error') { cancel(); callbacks.onError(message.message); }
    else if (message.type === 'complete') { cancel(); callbacks.onComplete(message.progress); }
    else callbacks.onProgress?.(message.progress);
  };
  worker.onerror = (event) => { if (!ended) { cancel(); callbacks.onError(event.message || 'Local calculation worker failed.'); } };
  try { worker.postMessage({ type: 'start', request }); } catch (error) { cancel(); throw error; }
  return { cancel };
}
