// Cloudflare Pages Function: /api/firm-cron
import { runFirmCronJob } from '../../cloudflare/cron.js';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  try {
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    const cycles = Math.max(1, Math.min(5, Number(body.cycles || url.searchParams.get('cycles')) || 2));
    const deep = body.deep === true || url.searchParams.get('deep') === 'true';
    const result = await runFirmCronJob({ cycles, deep, env });
    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders() });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: corsHeaders() });
  }
}
