// Alta AI Proxy — Cloudflare Worker.
//
// Fixes the two failures that took the old proxies offline:
//   1. Origin allowlist. ALLOWED_ORIGINS is honoured, OPTIONS preflight is answered,
//      and requests with no Origin (Netlify function, curl, server-to-server) are
//      accepted. The old Worker answered 403 {"error":"Origin not allowed"} to every
//      caller except one hardcoded host.
//   2. Model allowlist. The requested model is mapped to one this proxy can actually
//      serve instead of rejecting the call, and the old retired Groq model is gone.
//
// Upstreams come from AI_UPSTREAMS (JSON). With none configured it serves Pollinations,
// which needs no key, so the Worker works immediately after `wrangler deploy`.
//
// Backward compatible with src/llm.js: OpenAI chat-completions shape on
// /v1/chat/completions, /chat/completions, /chat and /openai.

const FREE_UPSTREAM = {
  name: 'pollinations',
  url: 'https://text.pollinations.ai/openai',
  models: ['openai-fast'],
  key: '',
};

function parseUpstreams(env) {
  let raw = [];
  try {
    const parsed = JSON.parse(env.AI_UPSTREAMS || '[]');
    if (Array.isArray(parsed)) raw = parsed;
  } catch {
    raw = [];
  }
  const out = [];
  for (const item of raw) {
    if (!item || !item.url) continue;
    let host = '';
    try { host = new URL(item.url).hostname; } catch { continue; }
    out.push({
      name: String(item.name || host),
      url: String(item.url).replace(/\/+$/, ''),
      key: item.keyEnv ? String(env[item.keyEnv] || '') : String(item.key || ''),
      models: Array.isArray(item.models) && item.models.length ? item.models.map(String) : null,
    });
  }
  // A keyless free upstream is always kept last, so the proxy never dies with its keys.
  out.push({ ...FREE_UPSTREAM });
  return out;
}

function originAllowed(origin, env) {
  if (!origin) return true;
  const rules = String(env.ALLOWED_ORIGINS || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!rules.length || rules.includes('*')) return true;
  return rules.some((rule) => rule === origin || (rule.endsWith('*') && origin.startsWith(rule.slice(0, -1))));
}

function cors(env, origin) {
  const rules = String(env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);
  const allowOrigin = !origin || rules.includes('*') || !rules.length
    ? (origin || '*')
    : origin;
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (data, status, headers) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
});

function upstreamChatUrl(url) {
  return /\/chat(\/completions)?$|\/openai$/i.test(url) ? url : `${url}/chat/completions`;
}

function pickUpstream(upstreams, requested) {
  const known = new Set();
  for (const u of upstreams) for (const m of (u.models || [])) known.add(m);
  if (requested && !known.has(requested)) {
    // Map to a model this proxy really serves instead of failing the whole call.
    const fallback = upstreams[0];
    const model = requested && !fallback.models ? requested : (fallback.models?.[0] || requested || 'openai-fast');
    return { upstream: fallback, model, substituted: true };
  }
  for (const u of upstreams) {
    if (u.models && requested && u.models.includes(requested)) return { upstream: u, model: requested, substituted: false };
  }
  const first = upstreams[0];
  return { upstream: first, model: requested || first.models?.[0] || 'openai-fast', substituted: false };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const headers = cors(env, origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    if (!originAllowed(origin, env)) {
      return json({ error: { message: `Origin not allowed: ${origin}. Add it to ALLOWED_ORIGINS.` } }, 403, headers);
    }

    const upstreams = parseUpstreams(env);
    const isChat = /^\/(v1\/chat\/completions|chat\/completions|chat|openai)\/?$/i.test(url.pathname);

    if (request.method === 'GET' || !isChat) {
      if (url.pathname !== '/' && url.pathname !== '/health' && url.pathname !== '/v1/models') {
        if (!isChat) return json({ error: { message: 'Not found' } }, 404, headers);
      }
      return json({
        status: 'ONLINE',
        service: 'Alta AI Proxy',
        providers: upstreams.map((u) => u.name),
        models: [...new Set(upstreams.flatMap((u) => u.models || []))],
      }, 200, headers);
    }

    if (env.PROXY_TOKEN) {
      const auth = request.headers.get('Authorization') || '';
      if (auth !== `Bearer ${env.PROXY_TOKEN}`) {
        return json({ error: { message: 'Unauthorized' } }, 401, headers);
      }
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: { message: 'Body must be JSON' } }, 400, headers);
    }

    const requested = String(payload?.model || '');
    const { upstream, model, substituted } = pickUpstream(upstreams, requested);
    const body = JSON.stringify({
      ...payload,
      model,
      stream: false,
    });

    const result = await fetch(upstreamChatUrl(upstream.url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(upstream.key ? { Authorization: `Bearer ${upstream.key}` } : {}),
      },
      body,
    });

    const text = await result.text();
    return new Response(text, {
      status: result.status,
      headers: {
        ...headers,
        'Content-Type': result.headers.get('Content-Type') || 'application/json; charset=utf-8',
        'X-Alta-Provider': upstream.name,
        'X-Alta-Model': model,
        ...(substituted ? { 'X-Alta-Model-Substituted': requested || 'none' } : {}),
      },
    });
  },
};
