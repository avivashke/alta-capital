// LLM access: OpenAI-compatible, Anthropic and Gemini shapes. Keys stay in localStorage.

import { LLM_PROVIDERS } from './config.js';
import { store } from './store.js';

function endpoint(baseUrl, path) {
  const base = (baseUrl || '').replace(/\/+$/, '');
  return base + path;
}

async function readError(res) {
  let detail = '';
  try {
    const text = await res.text();
    detail = text.slice(0, 240);
  } catch { /* noop */ }
  return `HTTP ${res.status}${detail ? ' · ' + detail : ''}`;
}

export async function chat({ system, messages, maxTokens = 1200 }) {
  const cfg = store.state.settings.llm;
  const provider = LLM_PROVIDERS[cfg.provider] || LLM_PROVIDERS.openai;
  const shape = provider.shape;
  const apiKey = (cfg.apiKey || '').trim();
  const model = (cfg.model || provider.model || '').trim();
  const baseUrl = (cfg.baseUrl || provider.baseUrl || '').trim();
  const temperature = Number(cfg.temperature ?? 0.4);

  if (!baseUrl) throw new Error('לא הוגדרה כתובת API של המודל');
  if (!model) throw new Error('לא הוגדר שם מודל');
  if (!apiKey && provider.shape !== 'openai') throw new Error('חסר מפתח API');
  if (!apiKey && cfg.provider !== 'ollama' && cfg.provider !== 'custom') throw new Error('חסר מפתח API — הוסף אותו בהגדרות');

  const history = (messages || []).slice(-12).map((m) => ({
    role: m.role === 'ai' ? 'assistant' : m.role,
    content: m.content,
  }));

  if (shape === 'anthropic') {
    const res = await fetch(endpoint(baseUrl, '/messages'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        system,
        messages: history.filter((m) => m.role !== 'system'),
      }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    return (data.content || []).map((c) => c.text || '').join('\n').trim();
  }

  if (shape === 'gemini') {
    const res = await fetch(`${endpoint(baseUrl, '')}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('\n').trim();
  }

  const res = await fetch(endpoint(baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...history],
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

export function hasModelKey() {
  const cfg = store.state.settings.llm;
  return !!(cfg.apiKey || '').trim() || cfg.provider === 'ollama';
}

export async function testConnection() {
  const reply = await chat({
    system: 'You are a health check. Reply with exactly: OK',
    messages: [{ role: 'user', content: 'ping' }],
    maxTokens: 20,
  });
  return reply.slice(0, 80) || '(תשובה ריקה)';
}
