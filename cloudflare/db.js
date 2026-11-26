// Cloudflare Database Handler: /api/db
// Supports:
// 1. Cloudflare D1 (internal relational SQLite edge database via env.DB)
// 2. Cloudflare KV (internal edge KV store via env.STATE_KV)
// 3. Supabase PostgreSQL (via env.SUPABASE_URL + env.SUPABASE_ANON_KEY / env.SUPABASE_SERVICE_ROLE_KEY)
// 4. GitHub 24/7 cloud seed fallback
// Conflict-free and monotonic: guarantees no fresh device can wipe trading progress.

import { mergeFirmStates, remoteHasMoreOrNewerData } from '../src/state_merge.js';

const GITHUB_RAW_STATE_URL = 'https://raw.githubusercontent.com/avivashke/alta-capital/main/data/state.json';

// In-memory fallback if neither D1, KV nor Supabase are configured
let memoryDb = {
  provider: 'Cloudflare Worker Memory (Edge)',
  updatedAt: new Date().toISOString(),
  state: null,
  versions: [],
  trades: [],
  cycles: [],
};

let d1Initialized = false;

export async function ensureD1Tables(db) {
  if (d1Initialized || !db) return;
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS firm_state (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        cycles INTEGER DEFAULT 0,
        backtests INTEGER DEFAULT 0,
        deployments INTEGER DEFAULT 0,
        updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE IF NOT EXISTS firm_versions (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE IF NOT EXISTS firm_trades (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE IF NOT EXISTS firm_cycles (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);
    d1Initialized = true;
  } catch (err) {
    console.warn('[cloudflare-d1] auto-migration warning:', err.message);
  }
}

async function fetchGitHubCloudSeed() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${GITHUB_RAW_STATE_URL}?t=${Date.now()}`, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    if (json && Array.isArray(json.desks) && json.updatedAt) return json;
  } catch { /* ignore */ }
  return null;
}

function getSupaEnv(env = {}) {
  const processEnv = typeof process !== 'undefined' && process?.env ? process.env : {};
  const url = (env.SUPABASE_URL || processEnv.SUPABASE_URL || 'https://lqiakdsdpdvdlobeeovz.supabase.co').trim().replace(/\/+$/, '');
  const key = (env.SUPABASE_SERVICE_ROLE_KEY || processEnv.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || processEnv.SUPABASE_ANON_KEY || '').trim();
  return { url, key, configured: !!(url && key) };
}

async function supaFetch(env, table, { method = 'GET', query = '', body = null, upsert = false } = {}) {
  const { url, key, configured } = getSupaEnv(env);
  if (!configured) return { ok: false, error: 'SUPABASE_ANON_KEY not set in Cloudflare Environment Variables' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(`${url}/rest/v1/${table}${query ? '?' + query : ''}`, {
      method,
      headers: {
        apikey: key,
        ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
        'Content-Type': 'application/json',
        Prefer: upsert ? 'resolution=merge-duplicates,return=minimal' : 'return=representation',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: `HTTP ${res.status}: ${txt.slice(0, 180)}` };
    }
    const data = method === 'GET' ? await res.json() : null;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

function makeCounts(db, state) {
  const pfTrades = Math.max(
    Number(state?.paperPortfolio?.totalTradesCount) || 0,
    state?.paperPortfolio?.trades?.length || 0,
  );
  return {
    versions: Math.max((db?.versions || []).length, Number(state?.stats?.deployments) || 0),
    trades: Math.max((db?.trades || []).length, pfTrades),
    cycles: Math.max((db?.cycles || []).length, Number(state?.stats?.cycles) || 0),
  };
}

export async function handleCloudflareDbRequest(method, bodyObj = {}, env = {}) {
  const hasD1 = !!env.DB;
  const hasKV = !!env.STATE_KV;
  const supaEnv = getSupaEnv(env);

  if (hasD1) {
    await ensureD1Tables(env.DB);
  }

  if (method === 'GET' || bodyObj.action === 'pull') {
    let canonical = null;
    let providerName = 'Cloudflare Worker (Edge)';
    let recentVersions = [];
    let recentTrades = [];
    let recentCycles = [];
    let supabaseConnected = false;
    let supabaseError = supaEnv.configured ? null : 'משתנה SUPABASE_ANON_KEY לא הוגדר';

    // 1. Try Cloudflare D1
    if (hasD1) {
      try {
        const row = await env.DB.prepare('SELECT state, updated_at FROM firm_state WHERE id = ?').bind('main').first();
        if (row?.state) {
          try {
            canonical = JSON.parse(row.state);
            providerName = 'Cloudflare D1 (Internal SQL)';
          } catch { /* ignore */ }
        }
        const vRows = await env.DB.prepare('SELECT data FROM firm_versions ORDER BY created_at DESC LIMIT 10').all();
        recentVersions = (vRows?.results || []).map((r) => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);

        const tRows = await env.DB.prepare('SELECT data FROM firm_trades ORDER BY created_at DESC LIMIT 20').all();
        recentTrades = (tRows?.results || []).map((r) => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);

        const cRows = await env.DB.prepare('SELECT data FROM firm_cycles ORDER BY created_at DESC LIMIT 20').all();
        recentCycles = (cRows?.results || []).map((r) => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
      } catch (err) {
        console.warn('[cloudflare-d1] pull error:', err.message);
      }
    }

    // 2. Try Cloudflare KV if no D1 or state empty
    if (!canonical && hasKV) {
      try {
        const raw = await env.STATE_KV.get('firm_state');
        if (raw) {
          canonical = JSON.parse(raw);
          providerName = 'Cloudflare KV (Internal)';
        }
      } catch { /* ignore */ }
    }

    // 3. Try Supabase
    if (supaEnv.configured) {
      const supaRes = await supaFetch(env, 'firm_state', { method: 'GET', query: 'id=eq.main&select=state,updated_at' });
      if (supaRes.ok && Array.isArray(supaRes.data) && supaRes.data[0]?.state) {
        supabaseConnected = true;
        const supaState = supaRes.data[0].state;
        canonical = canonical ? mergeFirmStates(canonical, supaState) : supaState;
        providerName = hasD1 ? 'Cloudflare D1 + Supabase' : 'Supabase PostgreSQL (Cloudflare Env)';
      } else if (!supaRes.ok) {
        supabaseError = supaRes.error;
      }
    }

    // 4. Memory or GitHub Seed fallback
    if (!canonical) {
      canonical = memoryDb.state;
      const ghSeed = await fetchGitHubCloudSeed();
      if (ghSeed) {
        canonical = canonical ? mergeFirmStates(ghSeed, canonical) : ghSeed;
        providerName = 'Cloudflare + GitHub Cloud 24/7';
      }
    }

    // If D1 was empty and we have a canonical seed, persist it into D1
    if (hasD1 && canonical) {
      try {
        await env.DB.prepare(`
          INSERT INTO firm_state (id, state, cycles, backtests, deployments, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            state = excluded.state,
            cycles = excluded.cycles,
            backtests = excluded.backtests,
            deployments = excluded.deployments,
            updated_at = excluded.updated_at
        `).bind(
          'main',
          JSON.stringify(canonical),
          canonical.stats?.cycles || 0,
          canonical.stats?.backtests || 0,
          canonical.stats?.deployments || 0,
          canonical.updatedAt || new Date().toISOString(),
        ).run();
      } catch { /* ignore */ }
    }

    return {
      ok: true,
      provider: providerName,
      cloudflareD1: hasD1,
      cloudflareKV: hasKV,
      supabaseConfigured: supaEnv.configured,
      supabaseConnected,
      supabaseError,
      updatedAt: canonical?.updatedAt || new Date().toISOString(),
      revision: canonical?.stateRevision || 0,
      state: canonical,
      counts: makeCounts({ versions: recentVersions, trades: recentTrades, cycles: recentCycles }, canonical),
      recentVersions,
      recentTrades,
      recentCycles,
    };
  }

  const action = bodyObj.action || 'push_state';

  if (action === 'push_state' && bodyObj.state) {
    const forceReset = !!bodyObj.forceReset;
    let existingState = null;

    // Pull current state to merge safely
    if (hasD1 && !forceReset) {
      try {
        const row = await env.DB.prepare('SELECT state FROM firm_state WHERE id = ?').bind('main').first();
        if (row?.state) existingState = JSON.parse(row.state);
      } catch { /* ignore */ }
    }
    if (!existingState && hasKV && !forceReset) {
      try {
        const raw = await env.STATE_KV.get('firm_state');
        if (raw) existingState = JSON.parse(raw);
      } catch { /* ignore */ }
    }
    if (!existingState && supaEnv.configured && !forceReset) {
      const supaRes = await supaFetch(env, 'firm_state', { method: 'GET', query: 'id=eq.main&select=state' });
      if (supaRes.ok && supaRes.data?.[0]?.state) existingState = supaRes.data[0].state;
    }
    if (!existingState && !forceReset) {
      existingState = memoryDb.state;
    }

    const merged = mergeFirmStates(existingState, bodyObj.state, { forceReset, bumpRevision: true });
    merged.updatedAt = new Date().toISOString();
    memoryDb.state = merged;

    let writeSucceeded = false;
    let lastError = null;

    // 1. Write to Cloudflare D1
    if (hasD1) {
      try {
        await env.DB.prepare(`
          INSERT INTO firm_state (id, state, cycles, backtests, deployments, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            state = excluded.state,
            cycles = excluded.cycles,
            backtests = excluded.backtests,
            deployments = excluded.deployments,
            updated_at = excluded.updated_at
        `).bind(
          'main',
          JSON.stringify(merged),
          merged.stats?.cycles || 0,
          merged.stats?.backtests || 0,
          merged.stats?.deployments || 0,
          merged.updatedAt,
        ).run();
        writeSucceeded = true;
      } catch (err) {
        lastError = `D1 error: ${err.message}`;
      }
    }

    // 2. Write to Cloudflare KV
    if (hasKV) {
      try {
        await env.STATE_KV.put('firm_state', JSON.stringify(merged));
        writeSucceeded = true;
      } catch (err) {
        lastError = `KV error: ${err.message}`;
      }
    }

    // 3. Mirror to Supabase if configured
    let supaWrite = null;
    if (supaEnv.configured) {
      supaWrite = await supaFetch(env, 'firm_state', {
        method: 'POST',
        upsert: true,
        body: {
          id: 'main',
          state: merged,
          cycles: merged.stats?.cycles || 0,
          backtests: merged.stats?.backtests || 0,
          deployments: merged.stats?.deployments || 0,
          updated_at: merged.updatedAt,
        },
      });
      if (supaWrite.ok) writeSucceeded = true;
      else lastError = supaWrite.error;
    }

    const providerName = hasD1
      ? (supaWrite?.ok ? 'Cloudflare D1 + Supabase' : 'Cloudflare D1 (Internal SQL)')
      : (supaWrite?.ok ? 'Supabase PostgreSQL (Cloudflare Env)' : (hasKV ? 'Cloudflare KV (Internal)' : 'Cloudflare Worker Memory'));

    return {
      ok: writeSucceeded || !lastError,
      provider: providerName,
      cloudflareD1: hasD1,
      cloudflareKV: hasKV,
      supabaseConfigured: supaEnv.configured,
      supabaseConnected: !!supaWrite?.ok,
      supabaseError: lastError,
      updatedAt: merged.updatedAt,
      revision: merged.stateRevision || 0,
      state: merged,
      counts: makeCounts(memoryDb, merged),
    };
  }

  if (action === 'record_version' && bodyObj.record) {
    memoryDb.versions.unshift(bodyObj.record);
    if (memoryDb.versions.length > 100) memoryDb.versions.pop();
    if (hasD1) {
      try {
        await env.DB.prepare('INSERT INTO firm_versions (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
          .bind(String(bodyObj.record.id), JSON.stringify(bodyObj.record))
          .run();
      } catch { /* ignore */ }
    }
    if (supaEnv.configured) {
      await supaFetch(env, 'firm_versions', { method: 'POST', upsert: true, body: bodyObj.record }).catch(() => {});
    }
  } else if (action === 'record_trade' && bodyObj.record) {
    memoryDb.trades.unshift(bodyObj.record);
    if (memoryDb.trades.length > 200) memoryDb.trades.pop();
    if (hasD1) {
      try {
        await env.DB.prepare('INSERT INTO firm_trades (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
          .bind(String(bodyObj.record.id), JSON.stringify(bodyObj.record))
          .run();
      } catch { /* ignore */ }
    }
    if (supaEnv.configured) {
      await supaFetch(env, 'firm_trades', { method: 'POST', upsert: true, body: bodyObj.record }).catch(() => {});
    }
  } else if (action === 'record_cycle' && bodyObj.record) {
    memoryDb.cycles.unshift(bodyObj.record);
    if (memoryDb.cycles.length > 200) memoryDb.cycles.pop();
    if (hasD1) {
      try {
        await env.DB.prepare('INSERT INTO firm_cycles (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
          .bind(String(bodyObj.record.id), JSON.stringify(bodyObj.record))
          .run();
      } catch { /* ignore */ }
    }
    if (supaEnv.configured) {
      await supaFetch(env, 'firm_cycles', { method: 'POST', upsert: true, body: bodyObj.record }).catch(() => {});
    }
  }

  return {
    ok: true,
    provider: hasD1 ? 'Cloudflare D1 (Internal SQL)' : (supaEnv.configured ? 'Supabase PostgreSQL' : 'Cloudflare Worker Memory'),
    cloudflareD1: hasD1,
    cloudflareKV: hasKV,
    supabaseConfigured: supaEnv.configured,
    updatedAt: memoryDb.state?.updatedAt || new Date().toISOString(),
    counts: makeCounts(memoryDb, memoryDb.state),
  };
}
