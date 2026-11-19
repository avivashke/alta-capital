// Netlify Serverless Function: /api/llm (/.netlify/functions/llm)
// Proxies LLM requests server-side so providers that block browser CORS
// (Cloudflare Workers AI API, Groq, NVIDIA NIM, Mistral, DeepSeek, etc.)
// work seamlessly from both the browser dashboard and the 24/7 runner.

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

export const handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }
  try {
    const payload = event.body ? JSON.parse(event.body) : {};
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
