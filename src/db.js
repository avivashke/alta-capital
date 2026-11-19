// Real cross-device database persistence layer for Alta Capital.
// Supports simultaneous multi-target sync across:
//  1. Supabase PostgreSQL REST API (direct PostgREST upsert/insert)
//  2. Same-origin /api/db (Netlify Function on Cloud OR Local Base Server)
//  3. External Cloud API URL (e.g. Netlify site URL when running from GitHub Pages or Base Server)
//  4. Base Server URL (user's always-on PC running server.mjs, LAN or tunnel)
//  5. Cloudflare Worker D1 / KV endpoint
//
// Uses conflict-free merging (src/state_merge.js) so a fresh device can NEVER reset
// the portfolio balance or wipe trade/optimization history.

import { store } from './store.js';
import { mergeFirmStates, isStateFreshEmpty, remoteHasMoreOrNewerData } from './state_merge.js';

export const dbState = {
  connected: false,
  provider: 'none',
  supabaseConnected: false,
  supabaseConfigured: false,
  supabaseError: null,
  baseServerConnected: false,
  baseServerInfo: null,
  cloudApiConnected: false,
  initialSyncDone: false,
  lastSyncAt: null,
  lastPushAt: null,
  lastError: null,
  saving: false,
  counts: { versions: 0, trades: 0, cycles: 0 },
  activeProviders: [],
};

let pushTimer = null;
let canonicalStateListener = null;

export function onCanonicalStateFromServer(fn) {
  canonicalStateListener = typeof fn === 'function' ? fn : null;
}

export const SUPABASE_SQL_SCHEMA = `-- Run this once in your Supabase SQL Editor (Free Tier):
create table if not exists public.firm_state (
  id text primary key default 'main',
  state jsonb not null,
  cycles integer default 0,
  backtests integer default 0,
  deployments integer default 0,
  updated_at timestamptz default now()
);

create table if not exists public.firm_versions (
  id text primary key,
  desk_id text not null,
  symbol text not null,
  tf text not null,
  version text not null,
  strategy_id text not null,
  params jsonb,
  oos_return numeric,
  in_sample_return numeric,
  profit_factor numeric,
  max_dd numeric,
  robustness numeric,
  code text,
  created_at timestamptz default now()
);

create table if not exists public.firm_trades (
  id text primary key,
  desk_id text,
  symbol text not null,
  side text not null,
  price numeric not null,
  quantity numeric,
  pnl_pct numeric,
  fee numeric,
  tax numeric,
  reason text,
  created_at timestamptz default now()
);

create table if not exists public.firm_cycles (
  id text primary key,
  desk_id text not null,
  tf text,
  strategy_id text,
  ok boolean default true,
  published boolean default false,
  version text,
  oos_return numeric,
  robustness numeric,
  ai_provider text,
  ai_model text,
  created_at timestamptz default now()
);

alter table public.firm_state enable row level security;
alter table public.firm_versions enable row level security;
alter table public.firm_trades enable row level security;
alter table public.firm_cycles enable row level security;

create policy "Allow anon access firm_state" on public.firm_state for all using (true) with check (true);
create policy "Allow anon access firm_versions" on public.firm_versions for all using (true) with check (true);
create policy "Allow anon access firm_trades" on public.firm_trades for all using (true) with check (true);
create policy "Allow anon access firm_cycles" on public.firm_cycles for all using (true) with check (true);`;

function normalizeApiUrl(rawUrl, defaultPath = '/api/db') {
  const s = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  if (s.endsWith('/api/db') || s.endsWith('/.netlify/functions/db')) return s;
  return `${s}${defaultPath}`;
}

export function getDbConfig(state = store.state) {
  const db = state?.settings?.db || {};
  const env = typeof process !== 'undefined' && process?.env ? process.env : {};
  const cloudApiRaw = db.cloudApiUrl || env.CLOUD_API_URL || '';
  const baseServerRaw = db.baseServerUrl || env.BASE_SERVER_URL || '';
  return {
    enabled: db.enabled !== false,
    mode: db.mode || (env.SUPABASE_URL ? 'supabase' : 'auto'),
    supabaseUrl: (db.supabaseUrl || env.SUPABASE_URL || '').trim().replace(/\/+$/, ''),
    supabaseKey: (db.supabaseKey || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || '').trim(),
    workerDbUrl: (db.workerDbUrl || env.CF_DB_WORKER_URL || '').trim().replace(/\/+$/, ''),
    workerDbKey: (db.workerDbKey || env.CF_DB_WORKER_KEY || '').trim(),
    cloudApiUrl: normalizeApiUrl(cloudApiRaw),
    baseServerUrl: normalizeApiUrl(baseServerRaw),
    baseServerToken: (db.baseServerToken || env.BASE_SERVER_TOKEN || '').trim(),
    apiEndpoint: db.apiEndpoint || '/api/db',
  };
}

export function sanitizeStateForDb(state = store.state) {
  const out = JSON.parse(JSON.stringify(state));
  // Keep pool metadata/usage and Cloudflare Worker proxy URLs, scrub raw secret keys
  if (out.settings?.llm) out.settings.llm.apiKey = '';
  if (out.settings?.github) out.settings.github.token = '';
  if (out.settings?.news) out.settings.news.apiKey = '';
  if (out.settings?.binance) {
    out.settings.binance.apiKey = '';
    out.settings.binance.apiSecret = '';
  }
  if (out.settings?.db) {
    out.settings.db = {
      ...out.settings.db,
      supabaseKey: '',
      workerDbKey: '',
      baseServerToken: '',
      netlifyToken: '',
    };
  }
  for (const entry of out.settings?.pool?.entries || []) {
    if (entry.provider !== 'gateway') entry.key = '';
  }
  out.updatedAt = new Date().toISOString();
  return out;
}

function isValidSupabaseKey(key) {
  return /^(eyJ|sb_publishable_|sb_secret_)/.test(String(key || '').trim());
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 9000) {
  if (options.keepalive) {
    return fetch(url, options);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function supabaseRequest(cfg, table, { method = 'GET', query = '', body = null, upsert = false, keepalive = false } = {}) {
  if (!isValidSupabaseKey(cfg.supabaseKey)) {
    throw new Error('מפתח Supabase אינו תקין — יש להדביק מפתח שמתחיל ב-eyJ... או sb_publishable_... מתוך Project Settings → API Keys');
  }
  const url = `${cfg.supabaseUrl}/rest/v1/${table}${query ? '?' + query : ''}`;
  const headers = {
    apikey: cfg.supabaseKey,
    ...(cfg.supabaseKey.startsWith('eyJ') ? { Authorization: `Bearer ${cfg.supabaseKey}` } : {}),
    'Content-Type': 'application/json',
    Prefer: upsert ? 'resolution=merge-duplicates,return=minimal' : 'return=representation',
  };
  const res = await fetchWithTimeout(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    keepalive,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Supabase ${table} HTTP ${res.status}: ${txt.slice(0, 180)}`);
  }
  if (method === 'GET') return await res.json();
  return { ok: true };
}

async function workerDbRequest(cfg, action, payload = {}, { keepalive = false } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(cfg.workerDbKey ? { Authorization: `Bearer ${cfg.workerDbKey}` } : {}),
  };
  const res = await fetchWithTimeout(cfg.workerDbUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...payload }),
    keepalive,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Worker DB HTTP ${res.status}: ${txt.slice(0, 180)}`);
  }
  return await res.json();
}

async function apiDbRequest(endpoint, action, payload = {}, { token = '', keepalive = false, timeoutMs = 9000 } = {}) {
  if (!endpoint) return null;
  if (typeof window === 'undefined' && !/^https?:\/\//i.test(endpoint)) {
    return null;
  }
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const url = action === 'pull' ? `${endpoint}${endpoint.includes('?') ? '&' : '?'}t=${Date.now()}` : endpoint;
  const res = await fetchWithTimeout(url, {
    method: action === 'pull' ? 'GET' : 'POST',
    headers,
    body: action === 'pull' ? undefined : JSON.stringify({ action, ...payload }),
    cache: 'no-store',
    keepalive,
  }, timeoutMs);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`DB API (${endpoint}) HTTP ${res.status}: ${txt.slice(0, 180)}`);
  }
  return await res.json();
}

function sameOriginAbs(endpoint) {
  if (typeof window === 'undefined') return '';
  try {
    return new URL(endpoint, window.location.origin).href.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export async function checkBaseServerHealth(rawUrl) {
  const base = String(rawUrl || '').trim().replace(/\/+$/, '').replace(/\/api\/db$/, '');
  const endpoint = base ? `${base}/api/health` : '/api/health';
  try {
    const res = await fetchWithTimeout(endpoint, { method: 'GET', cache: 'no-store' }, 4500);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    if (data?.ok) {
      dbState.baseServerConnected = true;
      dbState.baseServerInfo = data;
    }
    return data;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function pullFromDatabase() {
  const cfg = getDbConfig();
  if (!cfg.enabled) return { ok: false, reason: 'disabled' };

  const tasks = [];
  const sameOriginUrl = sameOriginAbs(cfg.apiEndpoint);

  // 1. Direct Supabase (if key configured in browser or Node env)
  if ((cfg.mode === 'supabase' || cfg.mode === 'auto') && cfg.supabaseUrl && cfg.supabaseKey) {
    tasks.push((async () => {
      const rows = await supabaseRequest(cfg, 'firm_state', {
        method: 'GET',
        query: 'id=eq.main&select=state,updated_at,cycles,backtests,deployments',
      });
      const row = Array.isArray(rows) ? rows[0] : null;
      return {
        kind: 'supabase',
        ok: true,
        provider: 'Supabase PostgreSQL',
        supabaseConfigured: true,
        supabaseConnected: true,
        state: row?.state || null,
        updatedAt: row?.updated_at || row?.state?.updatedAt || null,
      };
    })().catch((err) => ({ kind: 'supabase', ok: false, error: err.message })));
  }

  // 2. Cloudflare Worker DB
  if ((cfg.mode === 'worker' || cfg.mode === 'auto') && cfg.workerDbUrl) {
    tasks.push((async () => {
      const data = await workerDbRequest(cfg, 'pull');
      return {
        kind: 'worker',
        ok: true,
        provider: 'Cloudflare D1/KV',
        state: data?.state || null,
        updatedAt: data?.updatedAt || data?.state?.updatedAt || null,
      };
    })().catch((err) => ({ kind: 'worker', ok: false, error: err.message })));
  }

  // 3. Same-origin /api/db (works on Netlify AND on Base Server!)
  if (cfg.mode === 'netlify' || cfg.mode === 'auto') {
    tasks.push((async () => {
      const data = await apiDbRequest(cfg.apiEndpoint, 'pull', {}, { token: cfg.baseServerToken });
      if (!data?.ok) return { kind: 'same-origin', ok: false, error: data?.error || 'no-data' };
      return {
        kind: 'same-origin',
        ok: true,
        provider: data.provider || 'Netlify / Local DB',
        supabaseConfigured: !!data.supabaseConfigured,
        supabaseConnected: !!data.supabaseConnected,
        supabaseError: data.supabaseError || null,
        baseServer: !!data.baseServer,
        counts: data.counts || null,
        state: data.state || null,
        updatedAt: data.updatedAt || data.state?.updatedAt || null,
      };
    })().catch((err) => ({ kind: 'same-origin', ok: false, error: err.message })));
  }

  // 4. External Cloud API URL (e.g. Netlify deployment when browsing via GitHub Pages or Base Server)
  if (cfg.cloudApiUrl && cfg.cloudApiUrl !== sameOriginUrl) {
    tasks.push((async () => {
      const data = await apiDbRequest(cfg.cloudApiUrl, 'pull', {}, { timeoutMs: 7000 });
      if (!data?.ok) return { kind: 'cloud-api', ok: false, error: data?.error || 'no-data' };
      return {
        kind: 'cloud-api',
        ok: true,
        provider: data.provider || 'Cloud API',
        supabaseConfigured: !!data.supabaseConfigured,
        supabaseConnected: !!data.supabaseConnected,
        supabaseError: data.supabaseError || null,
        counts: data.counts || null,
        state: data.state || null,
        updatedAt: data.updatedAt || data.state?.updatedAt || null,
      };
    })().catch((err) => ({ kind: 'cloud-api', ok: false, error: err.message })));
  }

  // 5. Dedicated Base Server URL (user's always-on PC)
  if (cfg.baseServerUrl && cfg.baseServerUrl !== sameOriginUrl && cfg.baseServerUrl !== cfg.cloudApiUrl) {
    tasks.push((async () => {
      const data = await apiDbRequest(cfg.baseServerUrl, 'pull', {}, { token: cfg.baseServerToken, timeoutMs: 4500 });
      if (!data?.ok) return { kind: 'base-server', ok: false, error: data?.error || 'no-data' };
      return {
        kind: 'base-server',
        ok: true,
        provider: data.provider || 'Base Server',
        baseServer: true,
        counts: data.counts || null,
        state: data.state || null,
        updatedAt: data.updatedAt || data.state?.updatedAt || null,
      };
    })().catch((err) => ({ kind: 'base-server', ok: false, error: err.message })));
  }

  if (!tasks.length) return { ok: false, reason: 'no-db-configured' };

  const results = await Promise.all(tasks);
  const okResults = results.filter((r) => r.ok);

  if (!okResults.length) {
    const firstErr = results.find((r) => r.error)?.error || 'no-db-configured';
    dbState.lastError = firstErr;
    return { ok: false, error: firstErr };
  }

  let mergedState = null;
  let latestUpdatedAt = null;
  const providers = [];

  for (const r of okResults) {
    if (r.provider && !providers.includes(r.provider)) providers.push(r.provider);
    if (r.supabaseConnected) {
      dbState.supabaseConnected = true;
      dbState.supabaseConfigured = true;
      dbState.supabaseError = null;
    } else if (r.supabaseConfigured && !dbState.supabaseConnected) {
      dbState.supabaseConfigured = true;
      if (r.supabaseError) dbState.supabaseError = r.supabaseError;
    } else if (r.supabaseError && !dbState.supabaseConnected) {
      dbState.supabaseError = r.supabaseError;
    }
    if (r.baseServer) dbState.baseServerConnected = true;
    if (r.kind === 'cloud-api') dbState.cloudApiConnected = true;
    if (r.counts) Object.assign(dbState.counts, r.counts);

    if (r.state && typeof r.state === 'object' && Array.isArray(r.state.desks)) {
      mergedState = mergedState ? mergeFirmStates(mergedState, r.state) : r.state;
      const rTs = Date.parse(r.updatedAt || r.state.updatedAt || '') || 0;
      const curTs = Date.parse(latestUpdatedAt || '') || 0;
      if (rTs >= curTs) latestUpdatedAt = r.updatedAt || r.state.updatedAt || new Date().toISOString();
    }
  }

  dbState.connected = true;
  dbState.activeProviders = providers;
  dbState.provider = providers.join(' + ') || 'Cloud DB';
  dbState.lastSyncAt = Date.now();
  dbState.lastError = null;
  dbState.initialSyncDone = true;

  return {
    ok: true,
    provider: dbState.provider,
    supabaseConnected: dbState.supabaseConnected,
    baseServerConnected: dbState.baseServerConnected,
    state: mergedState,
    updatedAt: latestUpdatedAt || mergedState?.updatedAt || new Date().toISOString(),
  };
}

export async function pushStateToDatabase(state = store.state, { keepalive = false, forceReset = false } = {}) {
  const cfg = getDbConfig(state);
  if (!cfg.enabled) return { ok: false, reason: 'disabled' };

  // Safety guard: never allow an unsynced fresh empty browser to wipe out cloud data
  if (!forceReset && !dbState.initialSyncDone && isStateFreshEmpty(state)) {
    return { ok: false, reason: 'waiting-for-initial-sync' };
  }

  const clean = sanitizeStateForDb(state);
  const sameOriginUrl = sameOriginAbs(cfg.apiEndpoint);
  dbState.saving = true;

  try {
    const pushTasks = [];

    // 1. Direct Supabase (pull-merge-upsert to guarantee non-destructive cross-device merge)
    if ((cfg.mode === 'supabase' || cfg.mode === 'auto') && cfg.supabaseUrl && cfg.supabaseKey) {
      pushTasks.push((async () => {
        let toWrite = clean;
        if (!forceReset && !keepalive) {
          try {
            const rows = await supabaseRequest(cfg, 'firm_state', {
              method: 'GET',
              query: 'id=eq.main&select=state,updated_at',
            });
            if (Array.isArray(rows) && rows[0]?.state) {
              toWrite = mergeFirmStates(rows[0].state, clean, { bumpRevision: true });
            }
          } catch { /* proceed with clean if read fails */ }
        }
        await supabaseRequest(cfg, 'firm_state', {
          method: 'POST',
          upsert: true,
          keepalive,
          body: {
            id: 'main',
            state: toWrite,
            cycles: toWrite.stats?.cycles || 0,
            backtests: toWrite.stats?.backtests || 0,
            deployments: toWrite.stats?.deployments || 0,
            updated_at: toWrite.updatedAt || new Date().toISOString(),
          },
        });
        return {
          ok: true,
          provider: 'Supabase PostgreSQL',
          supabaseConnected: true,
          mergedState: toWrite,
        };
      })().catch((err) => ({ ok: false, provider: 'Supabase', error: err.message })));
    }

    // 2. Cloudflare Worker DB
    if ((cfg.mode === 'worker' || cfg.mode === 'auto') && cfg.workerDbUrl) {
      pushTasks.push((async () => {
        const res = await workerDbRequest(cfg, 'push_state', { state: clean, forceReset }, { keepalive });
        return {
          ok: true,
          provider: 'Cloudflare D1/KV',
          mergedState: res?.state || null,
        };
      })().catch((err) => ({ ok: false, provider: 'Cloudflare D1/KV', error: err.message })));
    }

    // 3. Same-origin /api/db (Netlify or Base Server — performs server-side mergeFirmStates!)
    if (cfg.mode === 'netlify' || cfg.mode === 'auto') {
      pushTasks.push((async () => {
        const res = await apiDbRequest(cfg.apiEndpoint, 'push_state', { state: clean, forceReset }, { token: cfg.baseServerToken, keepalive });
        if (!res?.ok) return { ok: false, provider: 'API DB', error: res?.error || 'push failed' };
        return {
          ok: true,
          provider: res.provider || 'Netlify / Local DB',
          supabaseConnected: !!res.supabaseConnected,
          supabaseError: res.supabaseError || null,
          baseServer: !!res.baseServer,
          counts: res.counts || null,
          mergedState: res.state || null,
        };
      })().catch((err) => ({ ok: false, provider: 'API DB', error: err.message })));
    }

    // 4. External Cloud API URL
    if (cfg.cloudApiUrl && cfg.cloudApiUrl !== sameOriginUrl) {
      pushTasks.push((async () => {
        const res = await apiDbRequest(cfg.cloudApiUrl, 'push_state', { state: clean, forceReset }, { keepalive, timeoutMs: 7000 });
        if (!res?.ok) return { ok: false, provider: 'Cloud API', error: res?.error || 'push failed' };
        return {
          ok: true,
          provider: res.provider || 'Cloud API',
          supabaseConnected: !!res.supabaseConnected,
          counts: res.counts || null,
          mergedState: res.state || null,
        };
      })().catch((err) => ({ ok: false, provider: 'Cloud API', error: err.message })));
    }

    // 5. External Base Server URL
    if (cfg.baseServerUrl && cfg.baseServerUrl !== sameOriginUrl && cfg.baseServerUrl !== cfg.cloudApiUrl) {
      pushTasks.push((async () => {
        const res = await apiDbRequest(cfg.baseServerUrl, 'push_state', { state: clean, forceReset }, { token: cfg.baseServerToken, keepalive, timeoutMs: 4500 });
        if (!res?.ok) return { ok: false, provider: 'Base Server', error: res?.error || 'push failed' };
        return {
          ok: true,
          provider: res.provider || 'Base Server',
          baseServer: true,
          counts: res.counts || null,
          mergedState: res.state || null,
        };
      })().catch((err) => ({ ok: false, provider: 'Base Server', error: err.message })));
    }

    if (!pushTasks.length) return { ok: false, reason: 'no-active-provider' };

    const results = await Promise.all(pushTasks);
    const okResults = results.filter((r) => r.ok);

    if (!okResults.length) {
      const errMsg = results.find((r) => r.error)?.error || 'no-active-provider';
      dbState.lastError = errMsg;
      return { ok: false, error: errMsg };
    }

    const providers = [];
    let canonical = null;
    for (const r of okResults) {
      if (r.provider && !providers.includes(r.provider)) providers.push(r.provider);
      if (r.supabaseConnected) {
        dbState.supabaseConnected = true;
        dbState.supabaseConfigured = true;
        dbState.supabaseError = null;
      } else if (r.supabaseError && !dbState.supabaseConnected) {
        dbState.supabaseError = r.supabaseError;
      }
      if (r.baseServer) dbState.baseServerConnected = true;
      if (r.counts) Object.assign(dbState.counts, r.counts);
      if (r.mergedState && Array.isArray(r.mergedState.desks)) {
        canonical = canonical ? mergeFirmStates(canonical, r.mergedState) : r.mergedState;
      }
    }

    dbState.connected = true;
    dbState.activeProviders = providers;
    dbState.provider = providers.join(' + ');
    dbState.lastPushAt = Date.now();
    dbState.lastError = null;

    // If the server returned merged progress from another device, converge local state immediately
    if (canonical && canonicalStateListener && !forceReset && remoteHasMoreOrNewerData(store.state, canonical)) {
      canonicalStateListener(canonical, dbState.provider);
    }

    return { ok: true, provider: dbState.provider, state: canonical };
  } catch (err) {
    dbState.lastError = err.message;
    return { ok: false, error: err.message };
  } finally {
    dbState.saving = false;
  }
}

export function scheduleDatabasePush(delayMs = 1500) {
  const cfg = getDbConfig();
  if (!cfg.enabled) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushStateToDatabase(store.state).catch(() => {});
  }, delayMs);
}

async function fanOutRecord(action, table, record) {
  const cfg = getDbConfig();
  if (!cfg.enabled) return;
  const sameOriginUrl = sameOriginAbs(cfg.apiEndpoint);
  const jobs = [];

  if ((cfg.mode === 'supabase' || cfg.mode === 'auto') && cfg.supabaseUrl && cfg.supabaseKey) {
    jobs.push(supabaseRequest(cfg, table, { method: 'POST', upsert: true, body: record }).catch(() => {}));
  }
  if ((cfg.mode === 'worker' || cfg.mode === 'auto') && cfg.workerDbUrl) {
    jobs.push(workerDbRequest(cfg, action, { record }).catch(() => {}));
  }
  if (cfg.mode === 'netlify' || cfg.mode === 'auto') {
    jobs.push(apiDbRequest(cfg.apiEndpoint, action, { record }, { token: cfg.baseServerToken }).catch(() => {}));
  }
  if (cfg.cloudApiUrl && cfg.cloudApiUrl !== sameOriginUrl) {
    jobs.push(apiDbRequest(cfg.cloudApiUrl, action, { record }, { timeoutMs: 6000 }).catch(() => {}));
  }
  if (cfg.baseServerUrl && cfg.baseServerUrl !== sameOriginUrl && cfg.baseServerUrl !== cfg.cloudApiUrl) {
    jobs.push(apiDbRequest(cfg.baseServerUrl, action, { record }, { token: cfg.baseServerToken, timeoutMs: 4000 }).catch(() => {}));
  }

  await Promise.all(jobs);
}

export async function recordVersionInDb(desk, evaluation, assessment) {
  const cfg = getDbConfig();
  if (!cfg.enabled) return;
  const record = {
    id: `${desk.id}_${desk.version}_${Date.now()}`,
    desk_id: desk.id,
    symbol: desk.symbol,
    tf: desk.tf,
    version: desk.version,
    strategy_id: desk.strategyId,
    params: desk.params,
    oos_return: evaluation?.oos?.returnPct ?? desk.bestReturn ?? null,
    in_sample_return: evaluation?.is?.returnPct ?? null,
    profit_factor: evaluation?.full?.profitFactor ?? desk.metrics?.profitFactor ?? null,
    max_dd: evaluation?.full?.maxDrawdownPct ?? desk.metrics?.maxDrawdownPct ?? null,
    robustness: assessment?.robustness ?? desk.robustness ?? null,
    code: desk.generatedCode || '',
    created_at: new Date().toISOString(),
  };

  try {
    await fanOutRecord('record_version', 'firm_versions', record);
    dbState.counts.versions = (dbState.counts.versions || 0) + 1;
  } catch (err) {
    console.warn('[db] recordVersion failed:', err.message);
  }
}

export async function recordTradeInDb(trade) {
  const cfg = getDbConfig();
  if (!cfg.enabled) return;
  const record = {
    id: trade.id || `tr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    desk_id: trade.deskId || null,
    symbol: trade.symbol || 'BTCUSDT',
    side: trade.side || (trade.dir > 0 ? 'LONG' : 'SHORT'),
    price: Number(trade.price || trade.exit || trade.entry || 0),
    quantity: Number(trade.quantity || 0),
    pnl_pct: trade.pct != null ? Number(trade.pct) : null,
    fee: Number(trade.fee || 0),
    tax: Number(trade.tax || 0),
    reason: trade.reason || '',
    created_at: new Date(trade.timestamp || trade.at || Date.now()).toISOString(),
  };

  try {
    await fanOutRecord('record_trade', 'firm_trades', record);
    dbState.counts.trades = (dbState.counts.trades || 0) + 1;
  } catch (err) {
    console.warn('[db] recordTrade failed:', err.message);
  }
}

export async function recordCycleInDb(cycleInfo) {
  const cfg = getDbConfig();
  if (!cfg.enabled) return;
  const record = {
    id: `cyc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    desk_id: cycleInfo.deskId,
    tf: cycleInfo.tf || '',
    strategy_id: cycleInfo.strategyId || '',
    ok: !!cycleInfo.ok,
    published: !!cycleInfo.published,
    version: cycleInfo.version || null,
    oos_return: cycleInfo.oosReturn ?? null,
    robustness: cycleInfo.robustness ?? null,
    ai_provider: cycleInfo.aiProvider || null,
    ai_model: cycleInfo.aiModel || null,
    created_at: new Date().toISOString(),
  };

  try {
    await fanOutRecord('record_cycle', 'firm_cycles', record);
    dbState.counts.cycles = (dbState.counts.cycles || 0) + 1;
  } catch (err) {
    console.warn('[db] recordCycle failed:', err.message);
  }
}

export async function testDatabaseConnection() {
  // Always pull first so we never push a fresh empty state over existing cloud progress!
  const pullRes = await pullFromDatabase();
  if (pullRes?.ok && pullRes.state && canonicalStateListener && remoteHasMoreOrNewerData(store.state, pullRes.state)) {
    canonicalStateListener(pullRes.state, pullRes.provider);
  }
  const pushRes = await pushStateToDatabase(store.state);
  if (pushRes.ok) return pushRes;
  return pullRes;
}
