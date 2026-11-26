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
// Colibri streams a 35B MoE from disk at about a token a second on this machine, so it
// needs its own budget and a smaller answer cap: it is the brain that never goes offline,
// not a fast chat model.
// Colibri runs ~1-1.5 tok/s on the Intel Arc, so a decision-sized answer needs room:
// 700 tokens can take ~10 minutes. The budget must fit the whole JSON, otherwise the
// reply is cut mid-object and the team silently falls back to rules.
const COLIBRI_TIMEOUT_MS = 900_000;
const COLIBRI_MAX_TOKENS = 700;
// Colibri's window is 4096 tokens. Anything longer than this (in characters, Hebrew
// tokenises densely) plus its answer would overflow, so those requests keep the fast
// local model and the cloud first and Colibri stays the last resort.
const COLIBRI_PROMPT_CHAR_LIMIT = 6000;
const COLIBRI_URL_RE = /(?:127\.0\.0\.1|localhost):8000\b/;
// Colibri also arrives through the base-server local-AI proxy with the same model id,
// so match on the model as well — otherwise the team never recognises its own brain.
const isColibriEntry = (entry) => COLIBRI_URL_RE.test(String(entry?.baseUrl || ''))
  || /colibri/i.test(String(entry?.model || ''));

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
        // Nemotron spends the whole max_tokens budget on reasoning and then returns
        // content:null, so callers saw a thinking trace or nothing. Turning thinking
        // off gives the direct answer in the same budget.
        ...(/nemotron/i.test(entry.model) ? { chat_template_kwargs: { enable_thinking: false } } : {}),
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

// Colibri answers at ~1 token/second, so a non-streamed reply can send no headers for
// minutes — and Node's fetch aborts a request that waits 300s for headers. Streaming
// returns headers immediately (SSE) and lets the answer accumulate chunk by chunk in
// both the browser and the 24/7 runner.
async function readColibriStream(res) {
  // The base-server proxy may answer with a plain JSON completion instead of SSE.
  const contentType = String(res.headers?.get?.('content-type') || '');
  if (/application\/json/i.test(contentType)) return parseResponsePayload(res, 'openai');
  if (!res.body?.getReader) return parseResponsePayload(res, 'openai');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload);
        const choice = json?.choices?.[0];
        const delta = choice?.delta?.content ?? choice?.message?.content ?? choice?.text;
        if (typeof delta === 'string') text += delta;
      } catch { /* keep reading: a chunk can split a JSON line */ }
    }
  }
  if (!text.trim()) throw new LlmError('Colibri החזיר תשובה ריקה', 502);
  return text;
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

  const colibri = isColibriEntry(entry);
  const callOpts = colibri
    ? { ...opts, maxTokens: Math.min(Number(opts.maxTokens) || COLIBRI_MAX_TOKENS, COLIBRI_MAX_TOKENS) }
    : opts;

  modelLoop: for (const model of models) {
    const candidate = model === entry.model ? entry : { ...entry, model };
    const { url, init } = buildRequest(candidate, callOpts);
    const urlsToTry = entry.provider === 'gateway' ? gatewayCandidateUrls(url) : [url];

    for (const targetUrl of urlsToTry) {
      const isLocal = entry.provider === 'ollama' || /\/api\/local-ai|127\.0\.0\.1:11434|localhost:11434|127\.0\.0\.1:11435|localhost:11435|127\.0\.0\.1:8000|localhost:8000/i.test(targetUrl || '');
      const controller = new AbortController();
      const localBudget = colibri ? COLIBRI_TIMEOUT_MS : LOCAL_TIMEOUT_MS;
      const timer = setTimeout(() => controller.abort(), isLocal ? localBudget : TIMEOUT_MS);
      let requestInit = init;
      if (colibri) {
        try {
          requestInit = { ...init, body: JSON.stringify({ ...JSON.parse(init.body || '{}'), stream: true }) };
        } catch { /* keep the request unchanged if the body is not JSON */ }
      }
      try {
        const res = await fetch(targetUrl, { ...requestInit, signal: controller.signal });
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
          // Public endpoints answer 403 to a localhost/Pages Origin even though they
          // serve the same request server-side. Relay through our own /api/llm.
          if (entry.provider === 'pollinations' && (res.status === 401 || res.status === 403) && typeof window !== 'undefined') {
            return await callViaNetlifyProxy(targetUrl, init, entry.shape || 'openai');
          }
          throw err;
        }
        const text = colibri ? await readColibriStream(res) : await parseResponsePayload(res, entry.shape || 'openai');
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
  const free = freeZeroKeyEntries();
  // In a browser the same-origin proxy goes first: upstream APIs refuse a localhost
  // Origin (Pollinations 403, NVIDIA no CORS), while our server reaches them fine and
  // keeps the keys server-side.
  const browserProxy = typeof window !== 'undefined' ? free.find((e) => e.provider === 'server-proxy') : null;
  if (browserProxy) {
    list.unshift(browserProxy);
    seen.add(`${browserProxy.provider}|${browserProxy.model}|${browserProxy.baseUrl}`);
  }
  for (const entry of free) {
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
    entryId: data.provider === 'cloudflare_workers_ai' ? 'cloudflare-ai' : 'server-env',
    provider: data.provider || 'cloud',
    model: data.model || 'default',
    accountId: null,
    label: data.label || (data.provider === 'cloudflare_workers_ai' ? 'Cloudflare Workers AI' : 'Cloud Server AI (Env)'),
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

export async function chatDetailed({ system, messages, maxTokens = 1200, preferColibri = false }) {
  const state = store.state;
  const temperature = Number(state.settings?.llm?.temperature ?? 0.4);
  const list = candidates(state);
  // Pick at most ONE fast local model (prefer 3B qwen2.5/llama3 via Base Server proxy to avoid VRAM swapping)
  const localAll = list.filter((e) => e.provider === 'ollama' || /\/api\/local-ai|127\.0\.0\.1:11434|localhost:11434|127\.0\.0\.1:8000|localhost:8000/i.test(e.baseUrl || ''));
  const localFast = localAll.find((e) => !isColibriEntry(e) && /\/api\/local-ai/i.test(e.baseUrl || '') && /qwen2\.5:3b/i.test(e.model || ''))
    || localAll.find((e) => !isColibriEntry(e) && /qwen2\.5:3b/i.test(e.model || ''))
    || localAll.find((e) => !isColibriEntry(e) && /llama3\.2:3b/i.test(e.model || ''))
    || localAll.find((e) => !isColibriEntry(e));
  const cloudRest = list.filter((e) => !localAll.includes(e));
  const colibriEntry = localAll.find((e) => e !== localFast && isColibriEntry(e));
  // Colibri is slow but always there: it is the brain of last resort behind the cloud,
  // or the first brain when there is no cloud key at all / this call asks for it.
  const promptChars = String(system || '').length
    + (Array.isArray(messages) ? messages.reduce((n, m) => n + String(m?.content || '').length, 0) : 0);
  const colibriFirst = !!colibriEntry
    && promptChars <= COLIBRI_PROMPT_CHAR_LIMIT
    && (preferColibri || state.settings?.llm?.preferColibri !== false);
  // "Colibri first" must mean Colibri, not the 3B sidecar: the team's thinking is
  // meant to happen on the big local brain, and only then degrade to fast local/cloud.
  const queue = colibriFirst
    ? [...(colibriEntry ? [colibriEntry] : []), ...(localFast ? [localFast] : []), ...cloudRest.slice(0, 6)]
    : [...(localFast ? [localFast] : []), ...cloudRest.slice(0, 6), ...(colibriEntry ? [colibriEntry] : [])];
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

  // Fallback 1: server-side Cloudflare / Netlify Env AI (/api/llm env_chat, e.g. Workers AI, NVIDIA, Groq)
  if (typeof window !== 'undefined') {
    try {
      const envRes = await callServerEnvChat({ system, messages, maxTokens, temperature });
      return { ...envRes, attempts };
    } catch (err) {
      attempts.push({ provider: 'Server Env / Cloudflare AI', model: 'env_chat', error: err.message, status: err.status || 0 });
    }
  }

  store.save();
  if (!attempts.length) {
    throw new LlmError('אין מודל או פרוקסי זמין בבריכה. הוסף מפתח בהגדרות או הגדר משתני AI ב-Cloudflare.', 0);
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

// A key we pay for (or a Worker proxy with one): when one exists the cloud answers first
// and Colibri stays the fallback. With none, Colibri is the team's brain.
export function hasCloudKey(state = store.state) {
  return candidates(state).some((e) => !!e.key
    && e.provider !== 'pollinations'
    && e.provider !== 'server-proxy'
    && e.provider !== 'webllm');
}

// True when a Colibri entry is in the pool (from COLIBRI_BASE_URL or a saved entry),
// i.e. the team can think on the local brain at all.
export function colibriConfigured(state = store.state) {
  return candidates(state).some(isColibriEntry);
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
