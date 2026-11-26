// Cloudflare Pages Function: /api/db
import { handleCloudflareDbRequest } from '../../cloudflare/db.js';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  try {
    const bodyObj = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    const result = await handleCloudflareDbRequest(request.method, bodyObj, env);
    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders() });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: corsHeaders() });
  }
}
