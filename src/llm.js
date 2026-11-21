// LLM access with a unified rotating pool + Cloudflare Worker proxies + Netlify server proxy:
// - Picks the least recently used entry from the pool (Cloudflare Workers proxies, Groq, Gemini,
//   OpenRouter, Cloudflare Workers AI, Z.ai, Mistral, NVIDIA, DeepSeek, OpenAI, Anthropic, etc.)
// - Automatically falls through the rest of the pool when a provider returns 429 or fails
// - When running in the browser and a provider blocks CORS, automatically routes via /api/llm
//   (Netlify Function proxy) or any active Cloudflare Worker proxy in the pool.

import { LLM_PROVIDERS } from './config.js';
import { POLLINATIONS_MODELS } from './providers.js';
import { store } from './store.js';
import { availableEntries, markFailure, markUsed, poolEntries } from './keypool.js';
import * as webllm from './webllm.js';

// A proxy that answers 400 "Model not allowed" is misconfigured, not dead. Try the
// model the Worker was built for before dropping the entry for this request.
const GATEWAY_FALLBACK_MODELS = ['openai/gpt-oss-120b', 'llama-3.1-8b-instant', 'llama-3.3-70b-versatile'];

const TIMEOUT_MS = 45_000;
const LOCAL_TIMEOUT_MS = 90_000;

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
  const isProxyChat = /\/chat$/i.test(base) || /\/openai$/i.test(base) || entry.provider === 'gateway' || entry.provider === 'pollinations';

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
  // Pollinations and Worker proxies already expose the full chat endpoint; appending
  // /chat/completions to them produced a 404 that looked like a dead provider.
  const chatUrl = /\/chat(\/completions)?$|\/openai$/i.test(base) ? base : (base + '/chat/completions');
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

function stripThinking(text) {
  return String(text || '').replace(/<\/?think>/gi, '').replace(/<\/?reasoning>/gi, '').trim();
}

function extractText(shape, data) {
  if (typeof data === 'string') return data.trim();
  if (shape === 'anthropic') return (data.content || []).map((c) => c.text || '').join('\n').trim();
  if (shape === 'gemini') return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('\n').trim();
  if (typeof data?.reply === 'string') return data.reply.trim();
  if (typeof data?.response === 'string') return data.response.trim();
  if (typeof data?.text === 'string') return data.text.trim();
  if (typeof data?.output === 'string') return data.output.trim();
  if (typeof data?.result?.response === 'string') return data.result.response.trim();
  const message = data?.choices?.[0]?.message || {};
  const content = stripThinking(message.content);
  if (content) return content;
  // Reasoning models (NVIDIA NIM nemotron/qwen, vLLM) put the answer in
  // reasoning_content / reasoning and leave content null; reading only content
  // made a working model look like it returned nothing at all.
  const reasoning = stripThinking(message.reasoning_content || message.reasoning || data?.choices?.[0]?.text);
  return reasoning;
}

function gatewayCandidateUrls(primaryUrl) {
  const list = [primaryUrl];
  try {
    const u = new URL(primaryUrl);
    const origin = u.origin;
    for (const p of ['/v1/chat/completions', '/chat/completions', '/chat', '/']) {
      const candidate = origin + p;
      if (!list.includes(candidate)) list.push(candidate);
    }
  } catch { /* ignore */ }
  return list;
}

async function parseResponsePayload(res, shape) {
  const raw = await res.text();
  try {
    return extractText(shape || 'openai', JSON.parse(raw));
  } catch {
    return raw.trim();
  }
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
  return await parseResponsePayload(res, shape);
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
  // Same-origin proxy: no CORS, no Origin allowlist, runs the whole pool server-side.
  if (entry?.provider === 'server-proxy') {
    const res = await callServerEnvChat(opts);
    return res.text;
  }

  const models = entry.provider === 'gateway'
    ? [...new Set([entry.model, ...GATEWAY_FALLBACK_MODELS].filter(Boolean))]
    : [entry.model];
  let lastErr = null;

  modelLoop: for (const model of models) {
    const candidate = model === entry.model ? entry : { ...entry, model };
    const { url, init } = buildRequest(candidate, opts);
    const urlsToTry = entry.provider === 'gateway' ? gatewayCandidateUrls(url) : [url];

    for (const targetUrl of urlsToTry) {
      const isLocal = entry.provider === 'ollama' || /\/api\/local-ai|127\.0\.0\.1:11434|localhost:11434|127\.0\.0\.1:11435|localhost:11435/i.test(targetUrl || '');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), isLocal ? LOCAL_TIMEOUT_MS : TIMEOUT_MS);
      try {
        const res = await fetch(targetUrl, { ...init, signal: controller.signal });
        if (!res.ok) {
          const err = await readError(res);
          // If a Cloudflare Worker doesn't mount /v1/chat/completions, try /chat/completions, /chat, or /
          if (entry.provider === 'gateway' && (res.status === 404 || res.status === 405)) {
            lastErr = err;
            continue;
          }
          // Model rejected by the proxy allowlist: retry with the next known model.
          if (entry.provider === 'gateway' && res.status === 400 && /model/i.test(err.message)) {
            lastErr = err;
            continue modelLoop;
          }
          throw err;
        }
        const text = await parseResponsePayload(res, entry.shape || 'openai');
        // Remember the route and model that actually answered.
        if (entry.provider === 'gateway') {
          entry.model = model;
          if (targetUrl !== url) entry.baseUrl = targetUrl.replace(/\/chat\/completions$/i, '');
        }
        return text;
      } catch (err) {
        if (err?.name === 'AbortError') throw new LlmError('המודל/פרוקסי לא ענה בזמן (timeout)', 408);
        if (err instanceof LlmError) {
          if (entry.provider === 'gateway' && (err.status === 404 || err.status === 405)) {
            lastErr = err;
            continue;
          }
          throw err;
        }
        // Browser CORS or network error -> try forwarding via Netlify Function /api/llm
        try {
          return await callViaNetlifyProxy(targetUrl, init, entry.shape || 'openai');
        } catch (proxyErr) {
          lastErr = proxyErr instanceof LlmError ? proxyErr : new LlmError(err?.message || 'שגיאת רשת בחיבור למודל/פרוקסי', 0);
          if (entry.provider === 'gateway' && (lastErr.status === 404 || lastErr.status === 405)) {
            continue;
          }
          throw lastErr;
        }
      } finally {
        clearTimeout(timer);
      }
    }
  }
  throw lastErr || new LlmError('הפרוקסי לא החזיר תגובה תקינה', 0);
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

// Free, keyless AI from the open web plus Alta's own same-origin proxy. These are part
// of the pool, not a last resort, so every AI feature can answer with no keys at all.
export function freeZeroKeyEntries() {
  const list = POLLINATIONS_MODELS.map((model) => ({
    id: `free_pollinations_${model}`,
    provider: 'pollinations',
    label: `Pollinations · ${model} (חינם ללא מפתח)`,
    shape: 'openai',
    baseUrl: 'https://text.pollinations.ai/openai',
    accountId: '',
    model,
    key: '',
    enabled: true,
    valid: true,
  }));
  if (typeof window !== 'undefined') {
    list.unshift({
      id: 'server_proxy_alta',
      provider: 'server-proxy',
      label: 'Alta Proxy (/api/llm · ללא CORS)',
      shape: 'openai',
      baseUrl: '/api/llm',
      accountId: '',
      model: 'auto',
      key: '',
      enabled: true,
      valid: true,
    });
  }
  return list;
}

export function candidates(state = store.state) {
  const list = [...availableEntries(state)];
  const seen = new Set(list.map((e) => `${e.provider}|${e.model}|${e.baseUrl}`));
  for (const entry of freeZeroKeyEntries()) {
    const key = `${entry.provider}|${entry.model}|${entry.baseUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(entry);
  }
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

async function callLocalBaseServerAi({ system, messages, maxTokens = 1200, temperature = 0.4 }) {
  if (typeof window === 'undefined') throw new LlmError('local-ai browser only', 0);
  const origins = [];
  if (/^https?:/.test(window.location.origin)) origins.push(window.location.origin);
  const cfgBase = (store.state?.settings?.db?.baseServerUrl || '').trim().replace(/\/+$/, '');
  if (cfgBase && !origins.includes(cfgBase)) origins.push(cfgBase);
  if (!origins.includes('http://localhost:8181')) origins.push('http://localhost:8181');

  let lastErr = null;
  for (const origin of origins) {
    try {
      const stCtrl = new AbortController();
      const stTimer = setTimeout(() => stCtrl.abort(), 5000);
      const stRes = await fetch(`${origin}/api/local-ai/status`, { signal: stCtrl.signal, headers: { Accept: 'application/json' } });
      clearTimeout(stTimer);
      if (!stRes.ok) continue;
      const st = await stRes.json();
      if (!st?.ok || !Array.isArray(st.models) || !st.models.length) continue;

      const preferred = st.models.find((m) => /^qwen2\.5:3b/i.test(m.model))
        || st.models.find((m) => /^llama3/i.test(m.model))
        || st.models.find((m) => /^qwen2\.5:7b/i.test(m.model))
        || st.models[0];

      const chatCtrl = new AbortController();
      const chatTimer = setTimeout(() => chatCtrl.abort(), LOCAL_TIMEOUT_MS);
      const res = await fetch(`${origin}/api/local-ai/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: chatCtrl.signal,
        body: JSON.stringify({
          model: preferred.model,
          temperature,
          max_tokens: Math.min(maxTokens, 420),
          messages: [
            ...(system ? [{ role: 'system', content: system }] : []),
            ...historyOf(messages),
          ],
        }),
      });
      clearTimeout(chatTimer);
      if (!res.ok) throw await readError(res);
      const text = await parseResponsePayload(res, 'openai');
      if (!text) throw new LlmError('Local AI returned empty text', 502);
      return {
        text,
        entryId: `local-ai:${preferred.model}`,
        provider: 'ollama',
        model: preferred.model,
        accountId: null,
        label: `Ollama המקומי (${preferred.model})`,
        attempts: [],
      };
    } catch (err) {
      lastErr = err instanceof LlmError ? err : new LlmError(err?.message || 'Local AI unavailable', 0);
    }
  }
  throw lastErr || new LlmError('Local AI not reachable', 0);
}

export async function chatDetailed({ system, messages, maxTokens = 1200 }) {
  const state = store.state;
  const temperature = Number(state.settings?.llm?.temperature ?? 0.4);
  const list = candidates(state);
  // Pick at most ONE fast local model (prefer 3B qwen2.5/llama3 via Base Server proxy to avoid VRAM swapping)
  const localAll = list.filter((e) => e.provider === 'ollama' || /\/api\/local-ai|127\.0\.0\.1:11434|localhost:11434/i.test(e.baseUrl || ''));
  const localFast = localAll.find((e) => /\/api\/local-ai/i.test(e.baseUrl || '') && /qwen2\.5:3b/i.test(e.model || ''))
    || localAll.find((e) => /qwen2\.5:3b/i.test(e.model || ''))
    || localAll.find((e) => /llama3\.2:3b/i.test(e.model || ''))
    || localAll[0];
  const cloudRest = list.filter((e) => !localAll.includes(e));
  const queue = [...(localFast ? [localFast] : []), ...cloudRest.slice(0, 6)];
  // Keyless web/proxy entries are always in the queue, even when the pool is full.
  for (const entry of freeZeroKeyEntries()) {
    if (!queue.some((q) => q.provider === entry.provider && q.model === entry.model)) queue.push(entry);
  }

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

  // Fallback 0: Direct Local Base Server AI (Ollama / Intel Arc GPU) even if pool entries were in cooldown
  if (typeof window !== 'undefined') {
    try {
      const localRes = await callLocalBaseServerAi({ system, messages, maxTokens, temperature });
      return { ...localRes, attempts };
    } catch (err) {
      attempts.push({ provider: 'Local Ollama (Base Server)', model: 'auto', error: err.message, status: err.status || 0 });
    }
  }

  // Fallback 1: server-side Netlify Env AI (/api/llm env_chat, e.g. NVIDIA_API_KEY)
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

// True whenever some model can answer — including the keyless web/proxy entries, so
// features do not fall back to "no model configured" on a fresh install.
export function hasModelKey() {
  return candidates(store.state).length > 0;
}

export function poolIsEmpty() {
  return candidates(store.state).length === 0;
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
