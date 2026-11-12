// LLM access with a free-model pool in front: pick the least recently used key,
// call it, and fall through the rest of the pool when a provider says 429 or dies.
// Keys stay in localStorage (browser) or in GitHub Secrets (24/7 runner).

import { LLM_PROVIDERS } from './config.js';
import { store } from './store.js';
import { availableEntries, markFailure, markUsed, poolEntries } from './keypool.js';

const TIMEOUT_MS = 45_000;

export class LlmError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
  }
}

function joinUrl(base, path) {
  return (base || '').replace(/\/+$/, '').replace('{account_id}', '') + path;
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

  if (!entry.key && entry.provider !== 'ollama') throw new LlmError('חסר מפתח API');
  return {
    url: base + '/chat/completions',
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
  return (data.choices?.[0]?.message?.content || '').trim();
}

async function callEntry(entry, opts) {
  const { url, init } = buildRequest(entry, opts);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw await readError(res);
    const data = await res.json();
    return extractText(entry.shape || 'openai', data);
  } catch (err) {
    if (err?.name === 'AbortError') throw new LlmError('מודל לא ענה בזמן', 408);
    if (err instanceof LlmError) throw err;
    throw new LlmError(err?.message || 'שגיאת רשת', 0);
  } finally {
    clearTimeout(timer);
  }
}

// The single configured model is just another entry, so one code path serves both.
export function legacyEntry(state = store.state) {
  const cfg = state.settings?.llm;
  if (!cfg) return null;
  const def = LLM_PROVIDERS[cfg.provider] || LLM_PROVIDERS.openai;
  const key = (cfg.apiKey || '').trim();
  if (!key && cfg.provider !== 'ollama') return null;
  return {
    id: 'legacy',
    provider: cfg.provider || 'openai',
    label: def.label,
    shape: def.shape || 'openai',
    baseUrl: (cfg.baseUrl || def.baseUrl || '').trim(),
    model: (cfg.model || def.model || '').trim(),
    key,
    accountId: cfg.accountId || '',
    enabled: true,
    valid: true,
  };
}

export function candidates(state = store.state) {
  const pool = availableEntries(state);
  if (pool.length) {
    const legacy = legacyEntry(state);
    // A configured paid model stays as the last resort, never the first choice.
    return legacy && !pool.some((e) => e.key === legacy.key && e.model === legacy.model)
      ? [...pool, { ...legacy, lastUsedAt: Infinity }]
      : pool;
  }
  const legacy = legacyEntry(state);
  return legacy ? [legacy] : [];
}

export async function chatDetailed({ system, messages, maxTokens = 1200 }) {
  const state = store.state;
  const temperature = Number(state.settings?.llm?.temperature ?? 0.4);
  const list = candidates(state);
  if (!list.length) throw new LlmError('אין מודל זמין — הוסף מפתח לבריכת המודלים בהגדרות');

  const attempts = [];
  for (const entry of list.slice(0, 8)) {
    try {
      const text = await callEntry(entry, { system, messages, maxTokens, temperature });
      if (entry.id !== 'legacy') markUsed(state, entry);
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
      if (entry.id !== 'legacy') markFailure(state, entry, { status: err.status || 0, message: err.message });
      attempts.push({ provider: entry.provider, model: entry.model, error: err.message, status: err.status || 0 });
    }
  }
  store.save();
  throw new LlmError('כל המודלים בבריכה נכשלו · ' + attempts.map((a) => `${a.provider}: ${a.error}`).join(' | '));
}

export async function chat(opts) {
  const res = await chatDetailed(opts);
  return res.text;
}

export function hasModelKey() {
  return candidates(store.state).length > 0;
}

export function poolIsEmpty() {
  return poolEntries(store.state).length === 0 && !legacyEntry(store.state);
}

export async function testEntry(entry) {
  const state = store.state;
  try {
    const reply = await callEntry(entry, {
      system: 'You are a health check. Reply with exactly: OK',
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 20,
      temperature: 0,
    });
    if (entry.id !== 'legacy') markUsed(state, entry);
    store.save();
    return { ok: true, reply: (reply || '(ריק)').slice(0, 60) };
  } catch (err) {
    if (entry.id !== 'legacy') markFailure(state, entry, { status: err.status || 0, message: err.message });
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
  return `${(res.text || '(תשובה ריקה)').slice(0, 60)} · ${res.provider}/${res.model}`;
}
