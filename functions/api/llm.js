// Cloudflare Pages Function: /api/llm
import { handleCloudflareLlmRequest } from '../../cloudflare/llm.js';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  try {
    const result = await handleCloudflareLlmRequest(request, env);
    if (result.isRaw) {
      return new Response(result.text, {
        status: result.status,
        headers: corsHeaders(),
      });
    }
    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders() });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 502, headers: corsHeaders() });
  }
}
