// Browser-local LLM via WebLLM (WebGPU) — truly unlimited free inference in the browser.
//
// No API key, no rate limit, no network call after the model is downloaded. The model
// runs entirely on the user's GPU through WebGPU, so it is the honest answer to
// "free models without API limits in the browser". Trade-off: small models (1-3B)
// and a one-time download of ~0.7-2 GB. Requires a WebGPU-capable browser
// (Chrome/Edge 113+, recent Safari). Not available to the 24/7 runner (Node) —
// there, use Ollama on a self-hosted runner for the same "no limits" property.

const CDN = 'https://esm.run/@mlc-ai/web-llm';

export const WEBLLM_MODELS = [
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 - 1B (fast, ~0.7GB)', size: '0.7 GB' },
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 - 1.5B (balanced, ~1GB)', size: '1 GB' },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 - 3B (smarter, ~2GB)', size: '2 GB' },
  { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC', label: 'Phi 3.5 mini (~2GB)', size: '2 GB' },
];

let engine = null;
let loading = false;
let loadPromise = null;
let loadError = null;
let progress = 0;
let progressText = '';
let currentModel = null;
let listeners = new Set();

function notify() { for (const fn of listeners) { try { fn(state()); } catch {} } }

export function state() {
  return { engine: !!engine, loading, loadError, progress, progressText, currentModel };
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function isSupported() {
  return typeof navigator !== 'undefined' && !!navigator.gpu;
}

export function isReady() { return !!engine; }

export async function loadModel(modelId, onProgress) {
  if (engine && currentModel === modelId) return engine;
  if (loading) return loadPromise;
  if (!isSupported()) {
    loadError = 'Browser does not support WebGPU (Chrome/Edge 113+ or recent Safari).';
    notify();
    throw new Error(loadError);
  }
  loading = true;
  loadError = null;
  progress = 0;
  progressText = 'Loading library...';
  notify();
  loadPromise = (async () => {
    try {
      const mod = await import(CDN);
      progressText = 'Initializing engine...';
      notify();
      const cb = (report) => {
        progress = typeof report?.progress === 'number' ? report.progress : progress;
        progressText = report?.text || progressText;
        if (onProgress) onProgress({ progress, text: progressText });
        notify();
      };
      engine = await mod.CreateMLCEngine(modelId, { initProgressCallback: cb });
      currentModel = modelId;
      progress = 1;
      progressText = 'Model ready';
      notify();
      return engine;
    } catch (err) {
      loadError = err?.message || String(err);
      engine = null;
      currentModel = null;
      notify();
      throw err;
    } finally {
      loading = false;
      loadPromise = null;
    }
  })();
  return loadPromise;
}

export async function unload() {
  try { if (engine?.unload) await engine.unload(); } catch {}
  engine = null;
  currentModel = null;
  progress = 0;
  progressText = '';
  notify();
}

export async function chat({ system, messages, maxTokens = 600, temperature = 0.4 } = {}) {
  if (!engine) throw new Error('WebLLM model not loaded - load it in Settings');
  const history = (messages || []).slice(-8).map((m) => ({
    role: m.role === 'ai' ? 'assistant' : (m.role === 'system' ? 'system' : m.role),
    content: m.content,
  }));
  const req = {
    messages: system ? [{ role: 'system', content: system }, ...history] : history,
    temperature,
    max_tokens: maxTokens,
  };
  const res = await engine.chat.completions.create(req);
  const text = (res?.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new Error('WebLLM returned an empty reply');
  return text;
}

export function currentModelId() { return currentModel; }
