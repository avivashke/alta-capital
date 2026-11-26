// Cloudflare Pages Function: /api/health
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  return new Response(JSON.stringify({
    ok: true,
    service: 'Alta Capital Cloudflare Pages',
    timestamp: new Date().toISOString(),
    environment: {
      cloudflareD1: !!env.DB,
      cloudflareKV: !!env.STATE_KV,
      workersAi: !!env.AI,
      supabaseConfigured: !!(env.SUPABASE_URL && (env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY)),
    },
  }), {
    status: 200,
    headers: corsHeaders(),
  });
}
