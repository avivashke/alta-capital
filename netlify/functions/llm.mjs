// Netlify Serverless Function: /api/llm (/.netlify/functions/llm)
// 1. GET /api/llm -> returns sanitized list of AI providers configured in Netlify Environment Variables
// 2. POST /api/llm { action: 'env_chat' | 'env_test', ... } -> runs inference using Netlify Env Vars
// 3. POST /api/llm { targetUrl, method, headers, body } -> CORS proxy for browser pool calls

import { buildPoolFromEnv } from '../../src/keypool.js';

export async function handleLlmProxy(payload = {}) {
  const { targetUrl, method = 'POST', headers = {}, body } = payload;
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    throw new Error('Missing or invalid targetUrl');
  }
  const cleanHeaders = { 'content-type': 'application/json' };
  for (const [k, v] of Object.entries(headers || {})) {
    if (/^(authorization|x-api-key|anthropic-version|content-type)$/i.test(k) && v) {
      cleanHeaders[k] = v;
    }
  }
  const res = await fetch(targetUrl, {
    method,
    headers: cleanHeaders,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text };
}

function getEnvPoolSafe() {
  const entries = buildPoolFromEnv(process.env);
  return entries.map((e) => ({
    id: e.id,
    provider: e.provider,
    label: e.label,
    model: e.model,
    baseUrl: e.baseUrl,
    hasKey: !!e.key,
  }));
}

async function callEnvEntry(entry, { system, messages, maxTokens = 400, temperature = 0.4 }) {
  const base = (entry.baseUrl || '').replace(/\/+$/, '').replace('{account_id}', entry.accountId || '');
  const primaryUrl = /\/chat(\/completions)?$/i.test(base) ? base : `${base}/chat/completions`;
  const urls = [primaryUrl];
  if (entry.provider === 'gateway') {
    try {
      const origin = new URL(primaryUrl).origin;
      for (const p of ['/v1/chat/completions', '/chat/completions', '/chat', '/']) {
        const u = origin + p;
        if (!urls.includes(u)) urls.push(u);
      }
    } catch { /* ignore */ }
  }

  const started = Date.now();
  let lastErr = null;
  for (const chatUrl of urls) {
    const res = await fetch(chatUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(entry.key ? { Authorization: `Bearer ${entry.key}` } : {}),
      },
      body: JSON.stringify({
        model: entry.model,
        temperature,
        max_tokens: maxTokens,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          ...(messages || []),
        ],
      }),
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      const errTxt = await res.text().catch(() => '');
      lastErr = { ok: false, status: res.status, ms, error: `HTTP ${res.status}: ${errTxt.slice(0, 180)}` };
      if (entry.provider === 'gateway' && (res.status === 404 || res.status === 405)) continue;
      return lastErr;
    }
    const raw = await res.text();
    let text = '';
    try {
      const data = JSON.parse(raw);
      text = (
        data.choices?.[0]?.message?.content
        || data.reply
        || data.response
        || data.text
        || data.output
        || data.result?.response
        || ''
      ).trim();
    } catch {
      text = raw.trim();
    }
    return { ok: true, ms, text, provider: entry.provider, label: entry.label, model: entry.model };
  }
  return lastErr || { ok: false, status: 502, ms: Date.now() - started, error: 'Gateway failed' };
}

export const handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod === 'GET') {
    const envPool = getEnvPoolSafe();
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, envPool }),
    };
  }

  try {
    const payload = event.body ? JSON.parse(event.body) : {};

    if (payload.action === 'env_test') {
      const entries = buildPoolFromEnv(process.env);
      const target = payload.provider
        ? entries.find((e) => e.provider === payload.provider)
        : entries[0];
      if (!target) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, error: 'לא נמצא מפתח מוגדר ב-Netlify Environment Variables' }),
        };
      }
      const res = await callEnvEntry(target, {
        system: 'You are a health check. Reply with exactly: OK',
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 20,
        temperature: 0,
      });
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(res) };
    }

    if (payload.action === 'env_chat') {
      const entries = buildPoolFromEnv(process.env);
      for (const entry of entries) {
        const res = await callEnvEntry(entry, payload);
        if (res.ok) return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(res) };
      }
      return {
        statusCode: 502,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: 'כל המודלים ב-Netlify Environment Variables נכשלו או לא הוגדרו' }),
      };
    }

    const { status, text } = await handleLlmProxy(payload);
    return { statusCode: status, headers: corsHeaders, body: text };
  } catch (err) {
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({ error: { message: err.message } }),
    };
  }
};
