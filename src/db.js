// Real database persistence layer for Alta Capital.
// Supports:
//  1. Netlify Database API (/api/db -> Netlify Blobs / local SQLite-JSON store)
//  2. Supabase PostgreSQL REST API (free tier, direct PostgREST upsert/insert)
//  3. Cloudflare Worker D1 / KV endpoint
//
// Collects and persists:
//  - Full firm state & paper portfolio progress (firm_state)
//  - Published strategy versions & bot code artifacts (firm_versions)
//  - Executed paper / testnet trades (firm_trades)
//  - Optimization cycle history & AI director decisions (firm_cycles)

import { store } from './store.js';

export const dbState = {
  connected: false,
  provider: 'none',
  supabaseConnected: false,
  supabaseConfigured: false,
  supabaseError: null,
  lastSyncAt: null,
  lastPushAt: null,
  lastError: null,
  saving: false,
  counts: { versions: 0, trades: 0, cycles: 0 },
};

let pushTimer = null;

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

function getDbConfig(state = store.state) {
  const db = state?.settings?.db || {};
  const env = typeof process !== 'undefined' && process?.env ? process.env : {};
  return {
    enabled: db.enabled !== false,
    mode: db.mode || (env.SUPABASE_URL ? 'supabase' : 'auto'),
    supabaseUrl: (db.supabaseUrl || env.SUPABASE_URL || '').trim().replace(/\/+$/, ''),
    supabaseKey: (db.supabaseKey || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || '').trim(),
    workerDbUrl: (db.workerDbUrl || env.CF_DB_WORKER_URL || '').trim().replace(/\/+$/, ''),
    workerDbKey: (db.workerDbKey || env.CF_DB_WORKER_KEY || '').trim(),
    apiEndpoint: db.apiEndpoint || '/api/db',
  };
}

export function sanitizeStateForDb(state = store.state) {
  const out = JSON.parse(JSON.stringify(state));
  // Keep pool metadata/usage and Cloudflare Worker proxy URLs, scrub raw secret keys if needed
  if (out.settings?.llm) out.settings.llm.apiKey = '';
  if (out.settings?.github) out.settings.github.token = '';
  if (out.settings?.news) out.settings.news.apiKey = '';
  if (out.settings?.db) {
    out.settings.db = {
      ...out.settings.db,
      supabaseKey: '',
      workerDbKey: '',
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

async function supabaseRequest(cfg, table, { method = 'GET', query = '', body = null, upsert = false } = {}) {
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
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Supabase ${table} HTTP ${res.status}: ${txt.slice(0, 180)}`);
  }
  if (method === 'GET') return await res.json();
  return { ok: true };
}

async function workerDbRequest(cfg, action, payload = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(cfg.workerDbKey ? { Authorization: `Bearer ${cfg.workerDbKey}` } : {}),
  };
  const res = await fetch(cfg.workerDbUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Worker DB HTTP ${res.status}: ${txt.slice(0, 180)}`);
  }
  return await res.json();
}

async function netlifyApiRequest(cfg, action, payload = {}) {
  if (typeof window === 'undefined' && !/^https?:\/\//i.test(cfg.apiEndpoint)) {
    return null;
  }
  const res = await fetch(cfg.apiEndpoint, {
    method: action === 'pull' ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: action === 'pull' ? undefined : JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Netlify DB HTTP ${res.status}: ${txt.slice(0, 180)}`);
  }
  return await res.json();
}

export async function pullFromDatabase() {
  const cfg = getDbConfig();
  if (!cfg.enabled) return { ok: false, reason: 'disabled' };

  try {
    // 1. Try Supabase if configured
    if ((cfg.mode === 'supabase' || cfg.mode === 'auto') && cfg.supabaseUrl && cfg.supabaseKey) {
      const rows = await supabaseRequest(cfg, 'firm_state', {
        method: 'GET',
        query: 'id=eq.main&select=state,updated_at,cycles,backtests,deployments',
      });
      if (Array.isArray(rows) && rows[0]?.state) {
        dbState.connected = true;
        dbState.supabaseConnected = true;
        dbState.supabaseConfigured = true;
        dbState.supabaseError = null;
        dbState.provider = 'Supabase PostgreSQL';
        dbState.lastSyncAt = Date.now();
        dbState.lastError = null;
        return { ok: true, provider: 'Supabase PostgreSQL', supabaseConnected: true, state: rows[0].state, updatedAt: rows[0].updated_at };
      }
      dbState.supabaseConnected = true;
      dbState.supabaseConfigured = true;
      dbState.supabaseError = null;
    }

    // 2. Try Cloudflare Worker DB if configured
    if ((cfg.mode === 'worker' || cfg.mode === 'auto') && cfg.workerDbUrl) {
      const data = await workerDbRequest(cfg, 'pull');
      if (data?.state) {
        dbState.connected = true;
        dbState.provider = 'Cloudflare D1/KV';
        dbState.lastSyncAt = Date.now();
        dbState.lastError = null;
        return { ok: true, provider: 'Cloudflare D1/KV', state: data.state, updatedAt: data.updatedAt };
      }
    }

    // 3. Try Netlify Database API (/api/db -> automatically uses Netlify SUPABASE_URL / SUPABASE_ANON_KEY env vars if set!)
    if (cfg.mode === 'netlify' || cfg.mode === 'auto') {
      const data = await netlifyApiRequest(cfg, 'pull');
      if (data?.ok) {
        dbState.connected = true;
        dbState.provider = data.provider || 'Netlify Database';
        dbState.supabaseConnected = !!data.supabaseConnected;
        dbState.supabaseConfigured = !!data.supabaseConfigured;
        dbState.supabaseError = data.supabaseError || null;
        dbState.lastSyncAt = Date.now();
        dbState.lastError = null;
        if (data.counts) Object.assign(dbState.counts, data.counts);
        if (data.state) {
          return { ok: true, provider: dbState.provider, supabaseConnected: dbState.supabaseConnected, state: data.state, updatedAt: data.updatedAt };
        }
        return { ok: true, provider: dbState.provider, supabaseConnected: dbState.supabaseConnected, state: null };
      }
    }
  } catch (err) {
    dbState.lastError = err.message;
    return { ok: false, error: err.message };
  }

  return { ok: false, reason: 'no-db-configured' };
}

export async function pushStateToDatabase(state = store.state) {
  const cfg = getDbConfig(state);
  if (!cfg.enabled) return { ok: false, reason: 'disabled' };

  const clean = sanitizeStateForDb(state);
  dbState.saving = true;
  try {
    let usedProvider = null;

    if ((cfg.mode === 'supabase' || cfg.mode === 'auto') && cfg.supabaseUrl && cfg.supabaseKey) {
      await supabaseRequest(cfg, 'firm_state', {
        method: 'POST',
        upsert: true,
        body: {
          id: 'main',
          state: clean,
          cycles: clean.stats?.cycles || 0,
          backtests: clean.stats?.backtests || 0,
          deployments: clean.stats?.deployments || 0,
          updated_at: clean.updatedAt,
        },
      });
      usedProvider = 'Supabase PostgreSQL';
      dbState.supabaseConnected = true;
      dbState.supabaseConfigured = true;
      dbState.supabaseError = null;
    }

    if ((cfg.mode === 'worker' || cfg.mode === 'auto') && cfg.workerDbUrl) {
      await workerDbRequest(cfg, 'push_state', { state: clean });
      usedProvider = usedProvider ? `${usedProvider} + Cloudflare` : 'Cloudflare D1/KV';
    }

    if (cfg.mode === 'netlify' || cfg.mode === 'auto') {
      try {
        const res = await netlifyApiRequest(cfg, 'push_state', { state: clean });
        if (res?.ok) {
          usedProvider = usedProvider || res.provider || 'Netlify Database';
          if (res.supabaseConnected) {
            dbState.supabaseConnected = true;
            dbState.supabaseConfigured = true;
            dbState.supabaseError = null;
          } else if (res.supabaseError && !usedProvider.includes('Supabase')) {
            dbState.supabaseError = res.supabaseError;
          }
          if (res.counts) Object.assign(dbState.counts, res.counts);
        }
      } catch (err) {
        if (!usedProvider) throw err;
      }
    }

    if (usedProvider) {
      dbState.connected = true;
      dbState.provider = usedProvider;
      dbState.lastPushAt = Date.now();
      dbState.lastError = null;
      return { ok: true, provider: usedProvider };
    }
    return { ok: false, reason: 'no-active-provider' };
  } catch (err) {
    dbState.lastError = err.message;
    return { ok: false, error: err.message };
  } finally {
    dbState.saving = false;
  }
}

export function scheduleDatabasePush() {
  const cfg = getDbConfig();
  if (!cfg.enabled) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushStateToDatabase(store.state).catch(() => {});
  }, 2500);
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
    if ((cfg.mode === 'supabase' || cfg.mode === 'auto') && cfg.supabaseUrl && cfg.supabaseKey) {
      await supabaseRequest(cfg, 'firm_versions', { method: 'POST', upsert: true, body: record });
    }
    if ((cfg.mode === 'worker' || cfg.mode === 'auto') && cfg.workerDbUrl) {
      await workerDbRequest(cfg, 'record_version', { record });
    }
    if (cfg.mode === 'netlify' || cfg.mode === 'auto') {
      await netlifyApiRequest(cfg, 'record_version', { record }).catch(() => {});
    }
    dbState.counts.versions = (dbState.counts.versions || 0) + 1;
  } catch (err) {
    console.warn('[db] recordVersion failed:', err.message);
  }
}

export async function recordTradeInDb(trade) {
  const cfg = getDbConfig();
  if (!cfg.enabled) return;
  const record = {
    id: `tr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
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
    if ((cfg.mode === 'supabase' || cfg.mode === 'auto') && cfg.supabaseUrl && cfg.supabaseKey) {
      await supabaseRequest(cfg, 'firm_trades', { method: 'POST', upsert: true, body: record });
    }
    if ((cfg.mode === 'worker' || cfg.mode === 'auto') && cfg.workerDbUrl) {
      await workerDbRequest(cfg, 'record_trade', { record });
    }
    if (cfg.mode === 'netlify' || cfg.mode === 'auto') {
      await netlifyApiRequest(cfg, 'record_trade', { record }).catch(() => {});
    }
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
    if ((cfg.mode === 'supabase' || cfg.mode === 'auto') && cfg.supabaseUrl && cfg.supabaseKey) {
      await supabaseRequest(cfg, 'firm_cycles', { method: 'POST', upsert: true, body: record });
    }
    if ((cfg.mode === 'worker' || cfg.mode === 'auto') && cfg.workerDbUrl) {
      await workerDbRequest(cfg, 'record_cycle', { record });
    }
    if (cfg.mode === 'netlify' || cfg.mode === 'auto') {
      await netlifyApiRequest(cfg, 'record_cycle', { record }).catch(() => {});
    }
    dbState.counts.cycles = (dbState.counts.cycles || 0) + 1;
  } catch (err) {
    console.warn('[db] recordCycle failed:', err.message);
  }
}

export async function testDatabaseConnection() {
  const pushRes = await pushStateToDatabase(store.state);
  if (pushRes.ok) return pushRes;
  return await pullFromDatabase();
}
