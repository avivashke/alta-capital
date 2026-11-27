// Runs the heavy firm cycle (backtests / walk-forward) in a worker thread so the Base Server's
// event loop stays free: the UI, /api/health and the AI endpoints keep answering while it computes.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

export function runFirmCronInWorker(opts = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { cron: opts }, env: process.env });
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };
    worker.once('message', (m) => (m.error ? done(reject, new Error(m.error)) : done(resolve, m.result)));
    worker.once('error', (e) => done(reject, e));
    worker.once('exit', (code) => { if (code !== 0) done(reject, new Error(`cron worker exited with code ${code}`)); });
  });
}

if (!isMainThread && workerData?.cron) {
  (async () => {
    try {
      const { runFirmCronJob } = await import('./netlify/functions/firm-cron.mjs');
      const result = await runFirmCronJob(workerData.cron);
      parentPort.postMessage({ result });
    } catch (err) {
      parentPort.postMessage({ error: err?.message || String(err) });
    }
  })();
}