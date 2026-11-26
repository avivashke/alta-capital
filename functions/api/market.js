// Cloudflare Pages Function: /api/market
import { handleMarketRequest } from '../../cloudflare/market.js';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

export async function onRequest(context) {
  const { request } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  try {
    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const result = await handleMarketRequest(query);
    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders() });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 502, headers: corsHeaders() });
  }
}
