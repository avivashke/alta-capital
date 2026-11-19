// Netlify Serverless Function: /api/db (/.netlify/functions/db)
// Provides zero-config database persistence on Netlify (and locally) for:
// - state (full firm state, desks, parameters, walk-forward metrics, paper portfolio)
// - versions (published strategy versions & bot code)
// - trades (executed paper & testnet trades)
// - cycles (optimization cycle history)

import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const TMP_DB_FILE = '/tmp/alta-capital-db.json';
const LOCAL_DB_FILE = path.join(DATA_DIR, 'db.json');
const SEED_STATE_FILE = path.join(DATA_DIR, 'state.json');

function readDbFile() {
  for (const file of [LOCAL_DB_FILE, TMP_DB_FILE]) {
    try {
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch { /* ignore */ }
  }
  let seedState = null;
  try {
    if (fs.existsSync(SEED_STATE_FILE)) {
      seedState = JSON.parse(fs.readFileSync(SEED_STATE_FILE, 'utf8'));
    }
  } catch { /* ignore */ }
  return {
    provider: 'Netlify Database',
    updatedAt: seedState?.updatedAt || new Date().toISOString(),
    state: seedState,
    versions: [],
    trades: [],
    cycles: [],
  };
}

function writeDbFile(db) {
  db.updatedAt = new Date().toISOString();
  const raw = JSON.stringify(db, null, 2);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LOCAL_DB_FILE, raw);
    if (db.state) {
      fs.writeFileSync(SEED_STATE_FILE, JSON.stringify(db.state, null, 1));
    }
  } catch {
    // Read-only lambda filesystem on Netlify -> write to /tmp
    try {
      fs.writeFileSync(TMP_DB_FILE, raw);
    } catch { /* ignore */ }
  }
}

function getSupaEnv() {
  const url = (process.env.SUPABASE_URL || 'https://lqiakdsdpdvdlobeeovz.supabase.co').trim().replace(/\/+$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  return { url, key, configured: !!(url && key) };
}

async function supaFetch(table, { method = 'GET', query = '', body = null, upsert = false } = {}) {
  const { url, key } = getSupaEnv();
  if (!url || !key) return { ok: false, error: 'SUPABASE_ANON_KEY not set in Netlify Environment Variables' };
  const res = await fetch(`${url}/rest/v1/${table}${query ? '?' + query : ''}`, {
    method,
    headers: {
      apikey: key,
      ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
      'Content-Type': 'application/json',
      Prefer: upsert ? 'resolution=merge-duplicates,return=minimal' : 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    return { ok: false, status: res.status, error: `HTTP ${res.status}: ${txt.slice(0, 180)}` };
  }
  const data = method === 'GET' ? await res.json() : null;
  return { ok: true, data };
}

export async function handleDbRequest(method, bodyObj = {}) {
  const db = readDbFile();
  const supaEnv = getSupaEnv();

  if (method === 'GET' || bodyObj.action === 'pull') {
    let supabaseConnected = false;
    let supabaseError = supaEnv.configured ? null : 'משתנה SUPABASE_ANON_KEY לא מוגדר ב-Netlify Environment Variables';
    if (supaEnv.configured) {
      try {
        const res = await supaFetch('firm_state', { method: 'GET', query: 'id=eq.main&select=state,updated_at' });
        if (res.ok) {
          supabaseConnected = true;
          const rows = res.data;
          if (Array.isArray(rows) && rows[0]?.state) {
            return {
              ok: true,
              provider: 'Supabase PostgreSQL (Netlify Env)',
              supabaseConfigured: true,
              supabaseConnected: true,
              updatedAt: rows[0].updated_at,
              state: rows[0].state,
              counts: {
                versions: (db.versions || []).length,
                trades: (db.trades || []).length,
                cycles: rows[0].state?.stats?.cycles || 0,
              },
            };
          }
        } else {
          supabaseError = res.error;
        }
      } catch (err) {
        supabaseError = err.message;
      }
    }
    return {
      ok: true,
      provider: supabaseConnected ? 'Supabase PostgreSQL (Netlify Env)' : 'Netlify Database',
      supabaseConfigured: supaEnv.configured,
      supabaseConnected,
      supabaseError,
      updatedAt: db.updatedAt,
      state: db.state,
      counts: {
        versions: (db.versions || []).length,
        trades: (db.trades || []).length,
        cycles: (db.cycles || []).length || (db.state?.stats?.cycles || 0),
      },
      recentVersions: (db.versions || []).slice(-10).reverse(),
      recentTrades: (db.trades || []).slice(-20).reverse(),
    };
  }

  const action = bodyObj.action || 'push_state';
  let supaWrite = null;

  if (action === 'push_state' && bodyObj.state) {
    db.state = bodyObj.state;
    writeDbFile(db);
    if (supaEnv.configured) {
      supaWrite = await supaFetch('firm_state', {
        method: 'POST',
        upsert: true,
        body: {
          id: 'main',
          state: bodyObj.state,
          cycles: bodyObj.state.stats?.cycles || 0,
          backtests: bodyObj.state.stats?.backtests || 0,
          deployments: bodyObj.state.stats?.deployments || 0,
          updated_at: new Date().toISOString(),
        },
      });
    }
  } else if (action === 'record_version' && bodyObj.record) {
    db.versions = db.versions || [];
    db.versions.push(bodyObj.record);
    if (db.versions.length > 200) db.versions = db.versions.slice(-200);
    writeDbFile(db);
    if (supaEnv.configured) supaWrite = await supaFetch('firm_versions', { method: 'POST', upsert: true, body: bodyObj.record });
  } else if (action === 'record_trade' && bodyObj.record) {
    db.trades = db.trades || [];
    db.trades.push(bodyObj.record);
    if (db.trades.length > 500) db.trades = db.trades.slice(-500);
    writeDbFile(db);
    if (supaEnv.configured) supaWrite = await supaFetch('firm_trades', { method: 'POST', upsert: true, body: bodyObj.record });
  } else if (action === 'record_cycle' && bodyObj.record) {
    db.cycles = db.cycles || [];
    db.cycles.push(bodyObj.record);
    if (db.cycles.length > 500) db.cycles = db.cycles.slice(-500);
    writeDbFile(db);
    if (supaEnv.configured) supaWrite = await supaFetch('firm_cycles', { method: 'POST', upsert: true, body: bodyObj.record });
  }

  return {
    ok: true,
    provider: supaWrite?.ok ? 'Supabase PostgreSQL (Netlify Env)' : 'Netlify Database',
    supabaseConfigured: supaEnv.configured,
    supabaseConnected: !!supaWrite?.ok,
    supabaseError: supaWrite && !supaWrite.ok ? supaWrite.error : null,
    updatedAt: db.updatedAt,
    counts: {
      versions: (db.versions || []).length,
      trades: (db.trades || []).length,
      cycles: (db.cycles || []).length || (db.state?.stats?.cycles || 0),
    },
  };

  return {
    ok: true,
    provider: 'Netlify Database',
    updatedAt: db.updatedAt,
    counts: {
      versions: (db.versions || []).length,
      trades: (db.trades || []).length,
      cycles: (db.cycles || []).length || (db.state?.stats?.cycles || 0),
    },
  };
}

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  try {
    const bodyObj = event.body ? JSON.parse(event.body) : {};
    const result = await handleDbRequest(event.httpMethod, bodyObj);
    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
