// Alta Capital — Cloudflare Worker (Edge Serverless + 24/7 Autonomous Cron)
//
// Unifies the entire trading research desk on Cloudflare:
// - /api/db: Internal SQLite via Cloudflare D1 or KV + Supabase PostgreSQL mirror
// - /api/llm: Native Cloudflare Workers AI (Edge GPU) + multi-provider pool & proxy
// - /api/market: Yahoo Finance, CoinGecko, SEC Edgar, RSS News, Reddit & YouTube Scout
// - /api/firm-cron: On-demand autonomous optimization cycles
// - Scheduled Event (cron): Runs every 15 min 24/7 on Cloudflare's global edge network
// - ASSETS: Serves static frontend SPA

import { handleCloudflareDbRequest } from './db.js';
import { handleCloudflareLlmRequest } from './llm.js';
import { handleMarketRequest } from './market.js';
import { runFirmCronJob } from './cron.js';
import { runResearchPassCf, getResearchNotesCf } from './research.js';

function corsHeaders(origin = '*') {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

export default {
  // 1. HTTP Request Handler
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const origin = request.headers.get('Origin') || '*';

    // CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Health Check
    if (pathname === '/api/health' || pathname === '/health') {
      return jsonResponse({
        ok: true,
        service: 'Alta Capital Cloudflare Edge',
        timestamp: new Date().toISOString(),
        environment: {
          cloudflareD1: !!env.DB,
          cloudflareKV: !!env.STATE_KV,
          workersAi: !!env.AI,
          supabaseConfigured: !!(env.SUPABASE_URL && (env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY)),
          hasStaticAssets: !!env.ASSETS,
        },
      });
    }

    // Database API: /api/db
    if (pathname === '/api/db' || pathname === '/.netlify/functions/db') {
      try {
        const bodyObj = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
        const result = await handleCloudflareDbRequest(request.method, bodyObj, env);
        return jsonResponse(result);
      } catch (err) {
        return jsonResponse({ ok: false, error: err.message }, 500);
      }
    }

    // LLM / AI API: /api/llm
    if (pathname === '/api/llm' || pathname === '/.netlify/functions/llm') {
      try {
        const result = await handleCloudflareLlmRequest(request, env);
        if (result.isRaw) {
          return new Response(result.text, {
            status: result.status,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              ...corsHeaders(origin),
            },
          });
        }
        return jsonResponse(result);
      } catch (err) {
        return jsonResponse({ ok: false, error: err.message }, 502);
      }
    }

    // Market Proxy API: /api/market
    if (pathname === '/api/market' || pathname === '/.netlify/functions/market') {
      try {
        const query = Object.fromEntries(url.searchParams.entries());
        const result = await handleMarketRequest(query);
        return jsonResponse(result);
      } catch (err) {
        return jsonResponse({ ok: false, error: err.message }, 502);
      }
    }

    // Firm Autonomous Cron API: /api/firm-cron
    if (pathname === '/api/firm-cron' || pathname === '/.netlify/functions/firm-cron') {
      try {
        const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
        const cycles = Math.max(1, Math.min(5, Number(body.cycles || url.searchParams.get('cycles')) || 2));
        const deep = body.deep === true || url.searchParams.get('deep') === 'true';
        const result = await runFirmCronJob({ cycles, deep, env });
        return jsonResponse(result);
      } catch (err) {
        return jsonResponse({ ok: false, error: err.message }, 500);
      }
    }

    // AI Research Analyst (Workers AI + D1): /api/ai-research, /api/ai-research/run
    if (pathname === '/api/ai-research') {
      try {
        return jsonResponse(await getResearchNotesCf(env, Number(url.searchParams.get('limit')) || 10));
      } catch (err) {
        return jsonResponse({ ok: false, reason: err.message, notes: [] }, 500);
      }
    }
    if (pathname === '/api/ai-research/run' && request.method === 'POST') {
      return jsonResponse(await runResearchPassCf(env));
    }
    // Static Assets (Cloudflare Workers Assets or Pages)
    if (env.ASSETS) {
      try {
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse.status !== 404) {
          return assetResponse;
        }
        // If file not found and client requests HTML, serve index.html (SPA routing)
        const accept = request.headers.get('Accept') || '';
        if (accept.includes('text/html')) {
          const indexUrl = new URL('/index.html', request.url);
          return await env.ASSETS.fetch(new Request(indexUrl, request));
        }
        return assetResponse;
      } catch {
        // Fallback if ASSETS fetch fails
      }
    }

    return new Response('Not Found', { status: 404 });
  },

  // 2. Scheduled Cron Handler (runs every 15 min 24/7)
  async scheduled(event, env, ctx) {
    console.log(`[cloudflare-cron] Triggered at ${new Date().toISOString()}`);
    ctx.waitUntil(
      runFirmCronJob({ cycles: 2, deep: false, env })
        .then((res) => {
          console.log(`[cloudflare-cron] Completed: ${res.summary?.length || 0} cycles in ${res.durationMs}ms`);
        })
        .catch((err) => {
          console.error(`[cloudflare-cron] Failed:`, err);
        }),
    );
    // The AI research analyst runs once an hour (first trigger of each hour)
    if (new Date(event.scheduledTime || Date.now()).getUTCMinutes() < 15) {
      ctx.waitUntil(runResearchPassCf(env).then((r) => console.log(`[cloudflare-research] `+ (r.ok ? 'ok' : r.reason))).catch(() => {}));
    }
  },
};
