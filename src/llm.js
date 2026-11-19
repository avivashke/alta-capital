// LLM access with a unified rotating pool + Cloudflare Worker proxies + Netlify server proxy:
// - Picks the least recently used entry from the pool (Cloudflare Workers proxies, Groq, Gemini,
//   OpenRouter, Cloudflare Workers AI, Z.ai, Mistral, NVIDIA, DeepSeek, OpenAI, Anthropic, etc.)
// - Automatically falls through the rest of the pool when a provider returns 429 or fails
// - When running in the browser and a provider blocks CORS, automatically routes via /api/llm
//   (Netlify Function proxy) or any active Cloudflare Worker proxy in the pool.

import { LLM_PROVIDERS } from './config.js';
import { store } from './store.js';
import { availableEntries, markFailure, markUsed, poolEntries } from './keypool.js';
import * as webllm from './webllm.js';

const TIMEOUT_MS = 45_000;

export class LlmError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
  }
}

async function readError(res) {
  let detail = '';
  try {
    const text = await res.text();
    detail = text.slice(0, 240);
  } catch { /* noop */ }
  return new LlmError(`HTTP ${res.status}${detail ? ' · ' + detail : ''}`, res.status);
}

function historyOf(messages) {
  return (messages || []).slice(-12).map((m) => ({
    role: m.role === 'ai' ? 'assistant' : m.role,
    content: m.content,
  }));
}

export function buildRequest(entry, { system, messages, maxTokens = 1200, temperature = 0.4 } = {}) {
  const base = (entry.baseUrl || '').replace(/\/+$/, '').replace('{account_id}', entry.accountId || '');
  if (!base) throw new LlmError('לא הוגדרה כתובת API');
  if (!entry.model) throw new LlmError('לא הוגדר שם מודל');
  const history = historyOf(messages);
  const shape = entry.shape || 'openai';
  const isProxyChat = /\/chat$/i.test(base) || entry.provider === 'gateway';

  if (shape === 'anthropic') {
    return {
      url: base + '/messages',
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': entry.key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: entry.model,
          max_tokens: maxTokens,
          temperature,
          system,
          messages: history.filter((m) => m.role !== 'system'),
        }),
      },
    };
  }

  if (shape === 'gemini') {
    const url = `${base}/models/${encodeURIComponent(entry.model)}:generateContent?key=${encodeURIComponent(entry.key)}`;
    return {
      url,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: { temperature, maxOutputTokens: maxTokens },
        }),
      },
    };
  }

  if (!entry.key && entry.provider !== 'ollama' && entry.provider !== 'pollinations' && !isProxyChat) throw new LlmError('חסר מפתח API');
  const chatUrl = /\/chat(\/completions)?$/i.test(base) ? base : (base + '/chat/completions');
  return {
    url: chatUrl,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(entry.key ? { Authorization: `Bearer ${entry.key}` } : {}),
      },
      body: JSON.stringify({
        model: entry.model,
        temperature,
        max_tokens: maxTokens,
        messages: [{ role: 'system', content: system }, ...history],
      }),
    },
  };
}

function extractText(shape, data) {
  if (shape === 'anthropic') return (data.content || []).map((c) => c.text || '').join('\n').trim();
  if (shape === 'gemini') return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('\n').trim();
  if (typeof data?.reply === 'string') return data.reply.trim();
  if (typeof data?.result?.response === 'string') return data.result.response.trim();
  return (data.choices?.[0]?.message?.content || '').trim();
}

async function callViaNetlifyProxy(url, init, shape) {
  if (typeof window === 'undefined') throw new Error('no-browser');
  const res = await fetch('/api/llm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      targetUrl: url,
      method: init.method || 'POST',
      headers: init.headers || {},
      body: init.body,
    }),
  });
  if (!res.ok) throw await readError(res);
  const data = await res.json();
  return extractText(shape || 'openai', data);
}

async function callEntry(entry, opts) {
  if (entry?.provider === 'webllm') {
    const text = await webllm.chat({
      system: opts.system,
      messages: opts.messages,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
    });
    return text;
  }
  const { url, init } = buildRequest(entry, opts);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw await readError(res);
    const data = await res.json();
    return extractText(entry.shape || 'openai', data);
  } catch (err) {
    if (err?.name === 'AbortError') throw new LlmError('המודל/פרוקסי לא ענה בזמן (timeout)', 408);
    if (err instanceof LlmError) throw err;
    // Browser CORS or network error -> try forwarding via Netlify Function /api/llm
    try {
      return await callViaNetlifyProxy(url, init, entry.shape || 'openai');
    } catch {
      throw new LlmError(err?.message || 'שגיאת רשת בחיבור למודל/פרוקסי', 0);
    }
  } finally {
    clearTimeout(timer);
  }
}

export function legacyEntry(state = store.state) {
  const llm = state?.settings?.llm;
  if (!llm) return null;
  const def = LLM_PROVIDERS[llm.provider] || {};
  const key = (llm.apiKey || '').trim();
  const baseUrl = (llm.baseUrl || def.baseUrl || '').trim();
  const model = (llm.model || def.model || '').trim();
  if (!baseUrl || !model) return null;
  if (!key && llm.provider !== 'ollama') return null;
  return {
    id: 'legacy',
    provider: llm.provider || 'openai',
    label: def.label || llm.provider || 'Direct API',
    shape: def.shape || 'openai',
    baseUrl,
    accountId: '',
    model,
    key,
    enabled: true,
    valid: true,
  };
}

export function webllmEntry() {
  if (!webllm.isReady()) return null;
  const st = webllm.state();
  return {
    id: 'webllm',
    provider: 'webllm',
    label: 'WebLLM (מקומי בדפדפן)',
    shape: 'openai',
    baseUrl: 'webllm://local',
    model: st.currentModel || 'local',
    key: '',
    enabled: true,
    valid: true,
  };
}

export function candidates(state = store.state) {
  const list = [...availableEntries(state)];
  const leg = legacyEntry(state);
  if (leg) list.push(leg);
  const w = webllmEntry();
  if (w) list.push(w);
  return list;
}

async function callServerEnvChat({ system, messages, maxTokens = 1200, temperature = 0.4 }) {
  if (typeof window === 'undefined') throw new LlmError('env_chat browser only', 0);
  const res = await fetch('/api/llm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'env_chat',
      system,
      messages: historyOf(messages),
      maxTokens,
      temperature,
    }),
  });
  if (!res.ok) throw await readError(res);
  const data = await res.json();
  if (!data?.ok || !data?.text) throw new LlmError(data?.error || 'env_chat failed', res.status);
  return {
    text: data.text,
    entryId: 'netlify-env',
    provider: data.provider || 'nvidia',
    model: data.model || 'nvidia/nemotron-3-ultra-550b-a55b',
    accountId: null,
    label: data.label || 'Netlify AI (NVIDIA Env)',
    attempts: [],
  };
}

export async function chatDetailed({ system, messages, maxTokens = 1200 }) {
  const state = store.state;
  const temperature = Number(state.settings?.llm?.temperature ?? 0.4);
  const list = candidates(state);
  const queue = list.slice(0, 10);

  const attempts = [];
  for (const entry of queue) {
    try {
      const text = await callEntry(entry, { system, messages, maxTokens, temperature });
      if (entry.id !== 'legacy' && entry.id !== 'webllm') markUsed(state, entry);
      store.save();
      return {
        text,
        entryId: entry.id,
        provider: entry.provider,
        model: entry.model,
        accountId: entry.accountId || null,
        label: entry.label || entry.provider,
        attempts,
      };
    } catch (err) {
      if (entry.id !== 'legacy' && entry.id !== 'webllm') {
        markFailure(state, entry, { status: err.status || 0, message: err.message });
      }
      attempts.push({ provider: entry.label || entry.provider, model: entry.model, error: err.message, status: err.status || 0 });
    }
  }

  // Fallback to server-side Netlify Env AI (/api/llm env_chat, e.g. NVIDIA_API_KEY)
  if (typeof window !== 'undefined') {
    try {
      const envRes = await callServerEnvChat({ system, messages, maxTokens, temperature });
      return { ...envRes, attempts };
    } catch (err) {
      attempts.push({ provider: 'Netlify Env AI', model: 'env_chat', error: err.message, status: err.status || 0 });
    }
  }

  store.save();
  if (!attempts.length) {
    throw new LlmError('אין מודל או פרוקסי זמין בבריכה. הוסף מפתח בהגדרות או הגדר NVIDIA_API_KEY ב-Netlify.', 0);
  }
  throw new LlmError('כל המודלים והפרוקסים בבריכה נכשלו · ' + attempts.map((a) => `${a.provider}: ${a.error}`).join(' | '));
}

export async function chat(opts) {
  const res = await chatDetailed(opts);
  return res.text;
}

export function hasModelKey() {
  return candidates(store.state).length > 0;
}

export function poolIsEmpty() {
  return poolEntries(store.state).length === 0 && !legacyEntry(store.state) && !webllm.isReady();
}

export async function testEntry(entry) {
  const state = store.state;
  const started = Date.now();
  try {
    const reply = await callEntry(entry, {
      system: 'You are a health check. Reply with exactly: OK',
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 20,
      temperature: 0,
    });
    const ms = Date.now() - started;
    entry.lastCheckedAt = Date.now();
    entry.lastLatencyMs = ms;
    entry.lastOk = true;
    if (entry.id !== 'legacy' && entry.id !== 'webllm') markUsed(state, entry);
    store.save();
    return { ok: true, ms, reply: (reply || '(ריק)').slice(0, 60) };
  } catch (err) {
    entry.lastCheckedAt = Date.now();
    entry.lastOk = false;
    if (entry.id !== 'legacy' && entry.id !== 'webllm') markFailure(state, entry, { status: err.status || 0, message: err.message });
    store.save();
    return { ok: false, error: err.message };
  }
}

export function testPoolEntry(id) {
  const entry = poolEntries(store.state).find((e) => e.id === id);
  if (!entry) return Promise.resolve({ ok: false, error: 'המפתח לא נמצא בבריכה' });
  return testEntry(entry);
}

export async function testConnection() {
  const res = await chatDetailed({
    system: 'You are a health check. Reply with exactly: OK',
    messages: [{ role: 'user', content: 'ping' }],
    maxTokens: 20,
  });
  return `${(res.text || '(תשובה ריקה)').slice(0, 60)} · ${res.label || res.provider}/${res.model}`;
}
