// Cloudflare AI / LLM Handler: /api/llm
// Supports:
// 1. Cloudflare Workers AI (native Edge GPU inference via env.AI binding — zero key needed!)
// 2. Multi-provider AI key pool from Cloudflare Environment Variables & Secrets
// 3. Cloudflare Worker Proxies
// 4. Free keyless web AI fallback (Pollinations)
// 5. Browser CORS proxy

import { buildPoolFromEnv } from '../src/keypool.js';

const CF_DEFAULT_MODELS = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-3.1-8b-instruct',
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
];

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

export function getCloudflareEnvPool(env = {}) {
  const entries = [];

  // 1. Native Cloudflare Workers AI (if bound)
  if (env.AI) {
    entries.push({
      id: 'cf-workers-ai',
      provider: 'cloudflare_workers_ai',
      label: 'Cloudflare Workers AI (Edge GPU · חינם)',
      model: env.CF_AI_MODEL || CF_DEFAULT_MODELS[0],
      baseUrl: 'internal://workers-ai',
      hasKey: true,
      free: true,
      native: true,
    });
  }

  // 2. Providers configured via Cloudflare Environment Variables / Secrets
  const fromEnv = buildPoolFromEnv(env);
  for (const e of fromEnv) {
    entries.push({
      id: e.id,
      provider: e.provider,
      label: e.label,
      model: e.model,
      baseUrl: e.baseUrl,
      hasKey: !!e.key,
      free: !e.key,
      native: false,
    });
  }

  // 3. Keyless fallback
  entries.push({
    id: 'free-pollinations',
    provider: 'pollinations',
    label: 'Pollinations AI (Web Fallback · חינם)',
    model: 'openai-fast',
    baseUrl: 'https://text.pollinations.ai/openai',
    hasKey: false,
    free: true,
    native: false,
  });

  return entries;
}

async function callWorkersAi(env, { system, messages, maxTokens = 600, temperature = 0.4, model }) {
  const started = Date.now();
  const targetModel = model || env.CF_AI_MODEL || CF_DEFAULT_MODELS[0];
  const formattedMessages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    ...(messages || []),
  ];

  try {
    const result = await env.AI.run(targetModel, {
      messages: formattedMessages,
      max_tokens: maxTokens,
      temperature,
      stream: false,
    });

    const ms = Date.now() - started;
    const text = (
      result?.response
      || result?.text
      || result?.choices?.[0]?.message?.content
      || ''
    ).replace(/<\/?think>/gi, '').trim();

    if (!text) {
      return { ok: false, status: 502, ms, error: 'Empty response from Cloudflare Workers AI' };
    }

    return {
      ok: true,
      ms,
      text,
      provider: 'cloudflare_workers_ai',
      label: 'Cloudflare Workers AI (Edge GPU)',
      model: targetModel,
    };
  } catch (err) {
    // If large model fails or is unavailable in the region, try fast 8b model
    if (targetModel !== CF_DEFAULT_MODELS[1]) {
      try {
        const fallbackRes = await env.AI.run(CF_DEFAULT_MODELS[1], {
          messages: formattedMessages,
          max_tokens: maxTokens,
          temperature,
          stream: false,
        });
        const ms = Date.now() - started;
        const text = (fallbackRes?.response || fallbackRes?.text || '').replace(/<\/?think>/gi, '').trim();
        if (text) {
          return {
            ok: true,
            ms,
            text,
            provider: 'cloudflare_workers_ai',
            label: 'Cloudflare Workers AI (8B Fallback)',
            model: CF_DEFAULT_MODELS[1],
          };
        }
      } catch { /* proceed to return original error */ }
    }
    return { ok: false, status: 502, ms: Date.now() - started, error: `Workers AI: ${err.message}` };
  }
}

async function callEnvEntry(entry, { system, messages, maxTokens = 400, temperature = 0.4 }) {
  const base = (entry.baseUrl || '').replace(/\/+$/, '').replace('{account_id}', entry.accountId || '');
  const primaryUrl = /\/chat(\/completions)?$|\/openai$/i.test(base) ? base : `${base}/chat/completions`;
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
        ...(/nemotron/i.test(entry.model) ? { chat_template_kwargs: { enable_thinking: false } } : {}),
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
      const message = data.choices?.[0]?.message || {};
      text = (
        message.content
        || message.reasoning_content
        || message.reasoning
        || data.choices?.[0]?.text
        || data.reply
        || data.response
        || data.text
        || data.output
        || data.result?.response
        || ''
      ).replace(/<\/?think>/gi, '').trim();
    } catch {
      text = raw.trim();
    }

    if (!text) {
      return { ok: false, status: 502, ms, error: 'Empty response from model', provider: entry.provider, label: entry.label, model: entry.model };
    }
    return { ok: true, ms, text, provider: entry.provider, label: entry.label, model: entry.model };
  }

  return lastErr || { ok: false, status: 502, ms: Date.now() - started, error: 'Gateway failed' };
}

export async function handleCloudflareLlmRequest(request, env = {}) {
  const method = request.method;

  if (method === 'GET') {
    const pool = getCloudflareEnvPool(env);
    return { ok: true, envPool: pool, workersAiAvailable: !!env.AI };
  }

  let payload = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  // 1. Test ping
  if (payload.action === 'env_test') {
    if (env.AI && (!payload.provider || payload.provider === 'cloudflare_workers_ai')) {
      const res = await callWorkersAi(env, {
        system: 'You are a health check. Reply with exactly: OK',
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 20,
        temperature: 0,
      });
      return res;
    }

    const entries = buildPoolFromEnv(env);
    const target = payload.provider
      ? entries.find((e) => e.provider === payload.provider)
      : entries[0];

    if (!target) {
      // If no env keys, test with Workers AI or Pollinations
      if (env.AI) {
        return await callWorkersAi(env, {
          system: 'Reply with OK',
          messages: [{ role: 'user', content: 'ping' }],
          maxTokens: 10,
        });
      }
      return { ok: false, error: 'לא נמצא ספק מוגדר ב-Cloudflare Environment Variables' };
    }

    return await callEnvEntry(target, {
      system: 'You are a health check. Reply with exactly: OK',
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 20,
      temperature: 0,
    });
  }

  // 2. Chat using Cloudflare internal AI & configured keys
  if (payload.action === 'env_chat') {
    // Priority 1: Native Cloudflare Workers AI if enabled and requested / first
    if (env.AI && (!payload.provider || payload.provider === 'cloudflare_workers_ai')) {
      const aiRes = await callWorkersAi(env, payload);
      if (aiRes.ok) return aiRes;
    }

    // Priority 2: Providers configured in Cloudflare Environment Variables
    const entries = buildPoolFromEnv(env);
    for (const entry of entries) {
      const res = await callEnvEntry(entry, payload);
      if (res.ok) return res;
    }

    // Priority 3: Fallback to Cloudflare Workers AI if not tried yet
    if (env.AI) {
      const aiRes = await callWorkersAi(env, payload);
      if (aiRes.ok) return aiRes;
    }

    // Priority 4: Free web Pollinations fallback
    const freeRes = await callEnvEntry({
      provider: 'pollinations',
      baseUrl: 'https://text.pollinations.ai/openai',
      model: 'openai-fast',
      key: '',
    }, payload);
    if (freeRes.ok) return freeRes;

    return {
      ok: false,
      error: 'כל מודלי ה-AI ב-Cloudflare נכשלו או שלא הוגדרו משתני סביבה מתאימים',
    };
  }

  // 3. CORS Proxy for browser calls
  const { status, text } = await handleLlmProxy(payload);
  return { status, text, isRaw: true };
}
