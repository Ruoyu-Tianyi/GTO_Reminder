import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLocalEquityCalculation } from './local-equity-client';
import type { LocalEquityProgress, LocalEquityWorkerMessage } from './local-equity';

const workers: WorkerStub[] = [];
const cancelTasks: Array<() => void> = [];
class WorkerStub {
  onmessage: ((event: MessageEvent<LocalEquityWorkerMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { workers.push(this); }
}
const request = { opponents: [{ kind: 'random' as const }], hands: ['AA'], samplesPerHand: 100, seed: 1 };
const progress: LocalEquityProgress = { model: 'showdown-monte-carlo-v1', completedHands: 0, totalHands: 1, currentHand: 'AA', currentHandSamples: 25, samplesPerHand: 100, results: [], done: false };
function start() {
  const callbacks = { onProgress: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };
  const task = startLocalEquityCalculation(request, callbacks);
  cancelTasks.push(task.cancel);
  return { ...task, ...callbacks, worker: workers[workers.length - 1] };
}
function message(worker: WorkerStub, data: LocalEquityWorkerMessage) { worker.onmessage?.({ data } as MessageEvent<LocalEquityWorkerMessage>); }

beforeEach(() => {
  workers.length = 0;
  vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
  vi.stubGlobal('Worker', WorkerStub);
});
afterEach(() => { cancelTasks.splice(0).forEach((cancel) => cancel()); vi.unstubAllGlobals(); });

describe('responsive local equity worker lifecycle', () => {
  it('passes bounded progress and stops a completed worker', () => {
    const task = start();
    expect(task.worker.postMessage).toHaveBeenCalledWith({ type: 'start', request });
    message(task.worker, { type: 'progress', progress });
    expect(task.onProgress).toHaveBeenCalledWith(progress);
    message(task.worker, { type: 'complete', progress: { ...progress, done: true } });
    expect(task.onComplete).toHaveBeenCalledOnce();
    expect(task.worker.terminate).toHaveBeenCalledOnce();
  });

  it('terminates cancellation immediately and ignores stale result events', () => {
    const task = start();
    task.cancel();
    task.cancel();
    message(task.worker, { type: 'complete', progress: { ...progress, done: true } });
    message(task.worker, { type: 'error', message: 'late' });
    expect(task.worker.terminate).toHaveBeenCalledOnce();
    expect(task.onComplete).not.toHaveBeenCalled();
    expect(task.onError).not.toHaveBeenCalled();
  });

  it('caps concurrent workers and frees capacity when one stops', () => {
    const first = start();
    start();
    expect(() => start()).toThrow(/capacity/);
    first.cancel();
    expect(() => start()).not.toThrow();
  });

  it('reserves a CPU on two-core devices and frees failed workers', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 2 });
    const task = start();
    expect(() => start()).toThrow(/capacity/);
    message(task.worker, { type: 'error', message: 'incompatible ranges' });
    expect(task.onError).toHaveBeenCalledWith('incompatible ranges');
    expect(task.worker.terminate).toHaveBeenCalledOnce();
    expect(() => start()).not.toThrow();
  });
});
