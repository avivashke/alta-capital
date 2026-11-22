// Netlify Serverless Function & Local Base Server Database API: /api/db (/.netlify/functions/db)
// Provides conflict-free, monotonic database persistence across:
// - Supabase PostgreSQL (primary cloud DB via SUPABASE_URL + SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY)
// - Local persistent disk (data/db.json + data/state.json with atomic writes & rolling backups on Base Server)
// - Optional external Cloud API mirror (CLOUD_API_URL) when running on Base Server
//
// Guarantees that a fresh/stale device can NEVER reset total portfolio balance or wipe trade history.

import fs from 'node:fs';
import path from 'node:path';
import { mergeFirmStates, remoteHasMoreOrNewerData } from '../../src/state_merge.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const TMP_DB_FILE = '/tmp/alta-capital-db.json';
const LOCAL_DB_FILE = path.join(DATA_DIR, 'db.json');
const SEED_STATE_FILE = path.join(DATA_DIR, 'state.json');

let lastBackupHour = '';

function atomicWriteJson(filePath, text) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, text);
  fs.renameSync(tmpPath, filePath);
}

function maybeWriteRollingBackup(raw) {
  try {
    const hourKey = new Date().toISOString().slice(0, 13).replace(/[:T]/g, '-');
    if (hourKey === lastBackupHour) return;
    lastBackupHour = hourKey;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const backupFile = path.join(BACKUP_DIR, `db-${hourKey}.json`);
    if (!fs.existsSync(backupFile)) {
      fs.writeFileSync(backupFile, raw);
    }
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('db-') && f.endsWith('.json'))
      .sort();
    while (files.length > 24) {
      const oldest = files.shift();
      try { fs.unlinkSync(path.join(BACKUP_DIR, oldest)); } catch { /* ignore */ }
    }
  } catch { /* ignore on read-only lambda filesystem */ }
}

export function readDbFile() {
  let fileDb = null;
  for (const file of [LOCAL_DB_FILE, TMP_DB_FILE]) {
    try {
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          fileDb = parsed;
          break;
        }
      }
    } catch { /* ignore */ }
  }

  let seedState = null;
  try {
    if (fs.existsSync(SEED_STATE_FILE)) {
      seedState = JSON.parse(fs.readFileSync(SEED_STATE_FILE, 'utf8'));
    }
  } catch { /* ignore */ }

  if (fileDb) {
    if (seedState && fileDb.state) {
      fileDb.state = mergeFirmStates(seedState, fileDb.state);
    } else if (seedState && !fileDb.state) {
      fileDb.state = seedState;
    }
    return fileDb;
  }

  return {
    provider: process.env.ALTA_BASE_SERVER === '1' ? 'Base Server DB' : 'Netlify Database',
    updatedAt: seedState?.updatedAt || new Date().toISOString(),
    state: seedState,
    versions: [],
    trades: [],
    cycles: [],
  };
}

export function writeDbFile(db) {
  db.updatedAt = new Date().toISOString();
  const raw = JSON.stringify(db, null, 2);
  try {
    atomicWriteJson(LOCAL_DB_FILE, raw);
    maybeWriteRollingBackup(raw);
    return { persistent: true, path: LOCAL_DB_FILE };
  } catch {
    // Read-only lambda filesystem on Netlify -> write to /tmp
    try {
      fs.writeFileSync(TMP_DB_FILE, raw);
    } catch { /* ignore */ }
    return { persistent: false, path: TMP_DB_FILE };
  }
}

// ---------- Local relational DB (SQLite, data/alta.db) ----------
// Enabled with DB_MODE=local in .env. Same interface as the Supabase REST layer, so the rest of the code is unchanged.
let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* node:sqlite unavailable (e.g. old Node on Netlify) */ }

export function isLocalSql() {
  return process.env.DB_MODE === 'local' && !!DatabaseSync;
}

const SQL_FILE = path.join(DATA_DIR, 'alta.db');
const SQL_TABLES = new Set(['firm_state', 'firm_versions', 'firm_trades', 'firm_cycles']);
let sqlDb = null;

export function getSqlDb() {
  if (sqlDb) return sqlDb;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const d = new DatabaseSync(SQL_FILE);
  d.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS firm_state (
      id TEXT PRIMARY KEY, state TEXT NOT NULL,
      cycles INTEGER DEFAULT 0, backtests INTEGER DEFAULT 0, deployments INTEGER DEFAULT 0,
      updated_at TEXT);
    CREATE TABLE IF NOT EXISTS firm_versions (
      id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS firm_trades (
      id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS firm_cycles (
      id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
  `);
  sqlDb = d;
  // One-time import of the existing JSON database
  try {
    const has = d.prepare('SELECT 1 AS x FROM firm_state WHERE id = ?').get('main');
    if (!has && fs.existsSync(LOCAL_DB_FILE)) {
      const old = JSON.parse(fs.readFileSync(LOCAL_DB_FILE, 'utf8'));
      sqlUpsert('firm_state', old.state ? { id: 'main', state: old.state, cycles: old.state.stats?.cycles || 0, backtests: old.state.stats?.backtests || 0, deployments: old.state.stats?.deployments || 0, updated_at: old.state.updatedAt || old.updatedAt } : null);
      for (const [tbl, arr] of [['firm_versions', old.versions], ['firm_trades', old.trades], ['firm_cycles', old.cycles]]) {
        for (const rec of arr || []) if (rec?.id != null) sqlUpsert(tbl, rec);
      }
    }
  } catch { /* ignore import errors */ }
  return d;
}

function sqlUpsert(table, rec) {
  if (!rec) return;
  const d = sqlDb;
  if (table === 'firm_state') {
    d.prepare(`INSERT INTO firm_state (id,state,cycles,backtests,deployments,updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET state=excluded.state,cycles=excluded.cycles,backtests=excluded.backtests,deployments=excluded.deployments,updated_at=excluded.updated_at`)
      .run(rec.id || 'main', JSON.stringify(rec.state), rec.cycles || 0, rec.backtests || 0, rec.deployments || 0, rec.updated_at || new Date().toISOString());
  } else {
    d.prepare(`INSERT INTO ${table} (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`)
      .run(String(rec.id), JSON.stringify(rec));
  }
}

function localSqlFetch(table, { method, body }) {
  if (!SQL_TABLES.has(table)) return { ok: false, error: `unknown table ${table}` };
  try {
    getSqlDb();
    if (method === 'GET') {
      if (table === 'firm_state') {
        const r = sqlDb.prepare('SELECT state, updated_at FROM firm_state WHERE id = ?').get('main');
        return { ok: true, data: r ? [{ state: JSON.parse(r.state), updated_at: r.updated_at }] : [] };
      }
      const rows = sqlDb.prepare(`SELECT data FROM ${table} ORDER BY created_at DESC LIMIT 500`).all();
      return { ok: true, data: rows.map((r) => JSON.parse(r.data)) };
    }
    for (const rec of Array.isArray(body) ? body : [body]) sqlUpsert(table, rec);
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: `SQLite: ${err.message}` };
  }
}

export function getSupaEnv() {
  if (isLocalSql()) return { url: 'local-sqlite', key: 'local', configured: true, local: true };
  const url = (process.env.SUPABASE_URL || 'https://lqiakdsdpdvdlobeeovz.supabase.co').trim().replace(/\/+$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  return { url, key, configured: !!(url && key) };
}

export async function supaFetch(table, { method = 'GET', query = '', body = null, upsert = false } = {}) {
  if (isLocalSql()) return localSqlFetch(table, { method, body });
  const { url, key } = getSupaEnv();
  if (!url || !key) return { ok: false, error: 'SUPABASE_ANON_KEY not set in Environment Variables' };
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
    versions: Math.max((db.versions || []).length, Number(state?.stats?.deployments) || 0),
    trades: Math.max((db.trades || []).length, pfTrades),
    cycles: Math.max((db.cycles || []).length, Number(state?.stats?.cycles) || 0),
  };
}

const GITHUB_RAW_STATE_URL = 'https://raw.githubusercontent.com/avivashke/alta-capital/main/data/state.json';

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

export async function handleDbRequest(method, bodyObj = {}) {
  const isBaseServer = process.env.ALTA_BASE_SERVER === '1';
  const db = readDbFile();
  const supaEnv = getSupaEnv();

  if (method === 'GET' || bodyObj.action === 'pull') {
    let supabaseConnected = false;
    let supabaseError = supaEnv.configured ? null : 'משתנה SUPABASE_ANON_KEY לא מוגדר ב-Environment Variables';
    let supaState = null;
    let supaUpdatedAt = null;

    if (supaEnv.configured) {
      const res = await supaFetch('firm_state', { method: 'GET', query: 'id=eq.main&select=state,updated_at' });
      if (res.ok) {
        supabaseConnected = true;
        const rows = res.data;
        if (Array.isArray(rows) && rows[0]?.state) {
          supaState = rows[0].state;
          supaUpdatedAt = rows[0].updated_at || supaState.updatedAt;
        }
      } else {
        supabaseError = res.error;
      }
    }

    // Merge local disk state & Supabase state so neither side ever loses progress
    let canonical = db.state || null;
    if (supaState && canonical) {
      canonical = mergeFirmStates(canonical, supaState);
      // Persist merged state locally on Base Server if Supabase had newer data
      if (remoteHasMoreOrNewerData(db.state, canonical)) {
        db.state = canonical;
        writeDbFile(db);
      }
      // Backfill Supabase if local Base Server had offline progress Supabase missed
      if (supabaseConnected && remoteHasMoreOrNewerData(supaState, canonical)) {
        supaFetch('firm_state', {
          method: 'POST',
          upsert: true,
          body: {
            id: 'main',
            state: canonical,
            cycles: canonical.stats?.cycles || 0,
            backtests: canonical.stats?.backtests || 0,
            deployments: canonical.stats?.deployments || 0,
            updated_at: canonical.updatedAt || new Date().toISOString(),
          },
        }).catch(() => {});
      }
    } else if (supaState) {
      canonical = supaState;
      db.state = canonical;
      writeDbFile(db);
    }

    // Always reconcile with live GitHub Actions 24/7 state on cold starts or if Supabase is not configured yet
    if (!supabaseConnected || !canonical) {
      const ghSeed = await fetchGitHubCloudSeed();
      if (ghSeed) {
        canonical = canonical ? mergeFirmStates(ghSeed, canonical) : ghSeed;
        db.state = canonical;
        writeDbFile(db);
      }
    }

    const provider = supabaseConnected
      ? (isBaseServer ? (isLocalSql() ? 'Base Server + SQLite (local)' : 'Base Server + Supabase PostgreSQL') : 'Supabase PostgreSQL (Netlify Env)')
      : (isBaseServer ? 'Base Server + GitHub Cloud 24/7' : 'Netlify + GitHub Cloud 24/7');

    return {
      ok: true,
      provider,
      baseServer: isBaseServer,
      supabaseConfigured: supaEnv.configured,
      supabaseConnected,
      supabaseError,
      updatedAt: canonical?.updatedAt || supaUpdatedAt || db.updatedAt,
      revision: canonical?.stateRevision || 0,
      state: canonical,
      counts: makeCounts(db, canonical),
      recentVersions: (db.versions || []).slice(-10).reverse(),
      recentTrades: (db.trades || []).slice(-20).reverse(),
    };
  }

  const action = bodyObj.action || 'push_state';
  let supaWrite = null;

  if (action === 'push_state' && bodyObj.state) {
    const forceReset = !!bodyObj.forceReset;
    let canonical = db.state || null;

    // Pull latest Supabase row before merging so concurrent writes from another device are NEVER clobbered
    if (supaEnv.configured && !forceReset) {
      const existingRes = await supaFetch('firm_state', { method: 'GET', query: 'id=eq.main&select=state,updated_at' });
      if (existingRes.ok && Array.isArray(existingRes.data) && existingRes.data[0]?.state) {
        canonical = canonical
          ? mergeFirmStates(canonical, existingRes.data[0].state)
          : existingRes.data[0].state;
      }
    }

    const merged = mergeFirmStates(canonical, bodyObj.state, { forceReset, bumpRevision: true });
    db.state = merged;
    writeDbFile(db);

    if (supaEnv.configured) {
      supaWrite = await supaFetch('firm_state', {
        method: 'POST',
        upsert: true,
        body: {
          id: 'main',
          state: merged,
          cycles: merged.stats?.cycles || 0,
          backtests: merged.stats?.backtests || 0,
          deployments: merged.stats?.deployments || 0,
          updated_at: merged.updatedAt || new Date().toISOString(),
        },
      });
    }

    const provider = supaWrite?.ok
      ? (isBaseServer ? (isLocalSql() ? 'Base Server + SQLite (local)' : 'Base Server + Supabase PostgreSQL') : 'Supabase PostgreSQL (Netlify Env)')
      : (isBaseServer ? 'Base Server Local DB' : 'Netlify Database');

    return {
      ok: true,
      provider,
      baseServer: isBaseServer,
      supabaseConfigured: supaEnv.configured,
      supabaseConnected: !!supaWrite?.ok,
      supabaseError: supaWrite && !supaWrite.ok ? supaWrite.error : null,
      updatedAt: merged.updatedAt || db.updatedAt,
      revision: merged.stateRevision || 0,
      state: merged,
      counts: makeCounts(db, merged),
    };
  } else if (action === 'record_version' && bodyObj.record) {
    db.versions = db.versions || [];
    if (!db.versions.some((v) => v.id === bodyObj.record.id)) {
      db.versions.push(bodyObj.record);
      if (db.versions.length > 200) db.versions = db.versions.slice(-200);
      writeDbFile(db);
    }
    if (supaEnv.configured) supaWrite = await supaFetch('firm_versions', { method: 'POST', upsert: true, body: bodyObj.record });
  } else if (action === 'record_trade' && bodyObj.record) {
    db.trades = db.trades || [];
    if (!db.trades.some((t) => t.id === bodyObj.record.id)) {
      db.trades.push(bodyObj.record);
      if (db.trades.length > 500) db.trades = db.trades.slice(-500);
      writeDbFile(db);
    }
    if (supaEnv.configured) supaWrite = await supaFetch('firm_trades', { method: 'POST', upsert: true, body: bodyObj.record });
  } else if (action === 'record_cycle' && bodyObj.record) {
    db.cycles = db.cycles || [];
    if (!db.cycles.some((c) => c.id === bodyObj.record.id)) {
      db.cycles.push(bodyObj.record);
      if (db.cycles.length > 500) db.cycles = db.cycles.slice(-500);
      writeDbFile(db);
    }
    if (supaEnv.configured) supaWrite = await supaFetch('firm_cycles', { method: 'POST', upsert: true, body: bodyObj.record });
  }

  const provider = supaWrite?.ok
    ? (isBaseServer ? (isLocalSql() ? 'Base Server + SQLite (local)' : 'Base Server + Supabase PostgreSQL') : 'Supabase PostgreSQL (Netlify Env)')
    : (isBaseServer ? 'Base Server Local DB' : 'Netlify Database');

  return {
    ok: true,
    provider,
    baseServer: isBaseServer,
    supabaseConfigured: supaEnv.configured,
    supabaseConnected: !!supaWrite?.ok,
    supabaseError: supaWrite && !supaWrite.ok ? supaWrite.error : null,
    updatedAt: db.updatedAt,
    counts: makeCounts(db, db.state),
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
