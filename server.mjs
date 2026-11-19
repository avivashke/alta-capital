#!/usr/bin/env node
// Alta Capital — Always-On Base Server + Cloud Two-Way Sync Node.
//
// Features:
//  - Serves the full dashboard + /api/db, /api/llm, /api/market, /api/firm-cron, /api/health, /api/sync
//  - Auto-loads .env / .env.local so credentials persist across reboots
//  - Listens on 0.0.0.0:8181 (accessible on localhost AND LAN devices like phone/tablet)
//  - Persistent atomic local database (data/db.json + data/state.json + rolling hourly backups)
//  - Continuous two-way sync with Cloud (Supabase PostgreSQL and/or Netlify CLOUD_API_URL)
//  - Built-in 24/7 autonomous scheduler (every 15 min) that keeps desks & paper portfolio running
//    even if the cloud is temporarily unreachable, then reconciles automatically when back online.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(ROOT);
process.env.ALTA_BASE_SERVER = '1';

// Zero-dependency .env loader (loads .env then .env.local without overwriting real env vars)
function loadEnvFile(filename) {
  const full = path.join(ROOT, filename);
  if (!fs.existsSync(full)) return;
  try {
    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch (err) {
    console.warn(`[Base Server] Failed reading ${filename}:`, err.message);
  }
}

loadEnvFile('.env');
loadEnvFile('.env.local');

const { handleDbRequest, readDbFile, writeDbFile, getSupaEnv } = await import('./netlify/functions/db.mjs');
const { runFirmCronJob } = await import('./netlify/functions/firm-cron.mjs');
const { handleMarketRequest } = await import('./netlify/functions/market.mjs');
const { mergeFirmStates, remoteHasMoreOrNewerData } = await import('./src/state_merge.js');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8181);
const SYNC_INTERVAL_MS = Math.max(15, Number(process.env.SYNC_INTERVAL_SEC || 60)) * 1000;
const ENABLE_LOCAL_CRON = process.env.ENABLE_LOCAL_CRON !== 'false';
const CRON_INTERVAL_MS = Math.max(5, Number(process.env.CRON_INTERVAL_MIN || 15)) * 60 * 1000;
const CRON_CYCLES = Math.max(1, Math.min(5, Number(process.env.CRON_CYCLES || 2)));
const CLOUD_API_URL = (() => {
  const raw = (process.env.CLOUD_API_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return raw.endsWith('/api/db') || raw.endsWith('/.netlify/functions/db') ? raw : `${raw}/api/db`;
})();
const BASE_SERVER_TOKEN = (process.env.BASE_SERVER_TOKEN || '').trim();

const startedAt = Date.now();
const syncStatus = {
  syncing: false,
  lastCloudSyncAt: null,
  lastCloudSyncProvider: null,
  lastCloudSyncError: null,
  supabaseConnected: false,
  cloudApiConnected: false,
  cronRunning: false,
  lastCronAt: null,
  lastCronError: null,
  nextCronAt: ENABLE_LOCAL_CRON ? Date.now() + CRON_INTERVAL_MS : null,
};

function getLanUrls() {
  const urls = [`http://localhost:${PORT}`];
  try {
    const nets = os.networkInterfaces();
    for (const ifaces of Object.values(nets)) {
      for (const iface of ifaces || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          urls.push(`http://${iface.address}:${PORT}`);
        }
      }
    }
  } catch { /* ignore */ }
  return urls;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function isAuthorized(req) {
  if (!BASE_SERVER_TOKEN) return true;
  const auth = req.headers.authorization || '';
  if (auth === `Bearer ${BASE_SERVER_TOKEN}`) return true;
  const addr = req.socket?.remoteAddress || '';
  if (addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1') return true;
  return false;
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${txt.slice(0, 140)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function syncBaseServerWithCloud() {
  if (syncStatus.syncing) return { ok: true, skipped: true };
  syncStatus.syncing = true;
  try {
    const providers = [];
    let lastErr = null;

    // 1. Reconcile local disk <-> Supabase (handled atomically inside handleDbRequest)
    const pullRes = await handleDbRequest('GET', { action: 'pull' });
    syncStatus.supabaseConnected = !!pullRes?.supabaseConnected;
    if (pullRes?.supabaseConnected) providers.push('Supabase PostgreSQL');
    else if (pullRes?.supabaseError && getSupaEnv().configured) lastErr = pullRes.supabaseError;

    // 2. Reconcile local disk <-> external Cloud API (e.g. Netlify deployment) if configured
    if (CLOUD_API_URL) {
      try {
        const cloudPull = await fetchJsonWithTimeout(`${CLOUD_API_URL}?t=${Date.now()}`, { method: 'GET' });
        const db = readDbFile();
        let localState = db.state;
        const cloudState = cloudPull?.state || null;

        if (cloudState && localState) {
          const merged = mergeFirmStates(localState, cloudState);
          if (remoteHasMoreOrNewerData(localState, merged)) {
            db.state = merged;
            writeDbFile(db);
            localState = merged;
          }
          if (remoteHasMoreOrNewerData(cloudState, merged)) {
            await fetchJsonWithTimeout(CLOUD_API_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'push_state', state: merged }),
            });
          }
        } else if (cloudState && !localState) {
          db.state = cloudState;
          writeDbFile(db);
        } else if (localState && !cloudState) {
          await fetchJsonWithTimeout(CLOUD_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'push_state', state: localState }),
          });
        }
        syncStatus.cloudApiConnected = true;
        providers.push('Cloud API');
      } catch (err) {
        syncStatus.cloudApiConnected = false;
        lastErr = `Cloud API: ${err.message}`;
      }
    }

    syncStatus.lastCloudSyncAt = new Date().toISOString();
    syncStatus.lastCloudSyncProvider = providers.join(' + ') || 'Local Base DB';
    syncStatus.lastCloudSyncError = providers.length ? null : lastErr;
    return {
      ok: true,
      providers,
      supabaseConnected: syncStatus.supabaseConnected,
      cloudApiConnected: syncStatus.cloudApiConnected,
      error: syncStatus.lastCloudSyncError,
    };
  } catch (err) {
    syncStatus.lastCloudSyncError = err.message;
    return { ok: false, error: err.message };
  } finally {
    syncStatus.syncing = false;
  }
}

async function runScheduledBaseCron() {
  if (syncStatus.cronRunning) return;
  syncStatus.cronRunning = true;
  try {
    console.log(`[Base Server] Running autonomous 24/7 firm cycle (${CRON_CYCLES} desks)...`);
    const res = await runFirmCronJob({ cycles: CRON_CYCLES, deep: false });
    syncStatus.lastCronAt = new Date().toISOString();
    syncStatus.lastCronError = null;
    console.log(`[Base Server] Cycle finished in ${res.durationMs}ms · total cycles=${res.stats?.cycles || 0}`);
    await syncBaseServerWithCloud();
  } catch (err) {
    syncStatus.lastCronError = err.message;
    console.warn('[Base Server] Autonomous cycle error:', err.message);
  } finally {
    syncStatus.cronRunning = false;
    syncStatus.nextCronAt = Date.now() + CRON_INTERVAL_MS;
  }
}

function buildHealthPayload() {
  const db = readDbFile();
  const st = db.state || {};
  const pf = st.paperPortfolio || null;
  const supaEnv = getSupaEnv();
  return {
    ok: true,
    mode: 'base-server',
    hostname: os.hostname(),
    platform: process.platform,
    node: process.version,
    port: PORT,
    lanUrls: getLanUrls(),
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    revision: st.stateRevision || 0,
    updatedAt: st.updatedAt || db.updatedAt || null,
    sync: {
      supabaseConfigured: supaEnv.configured,
      supabaseConnected: syncStatus.supabaseConnected,
      cloudApiConfigured: !!CLOUD_API_URL,
      cloudApiConnected: syncStatus.cloudApiConnected,
      lastCloudSyncAt: syncStatus.lastCloudSyncAt,
      lastCloudSyncProvider: syncStatus.lastCloudSyncProvider,
      lastCloudSyncError: syncStatus.lastCloudSyncError,
      localCronEnabled: ENABLE_LOCAL_CRON,
      cronIntervalMin: Math.round(CRON_INTERVAL_MS / 60000),
      lastCronAt: syncStatus.lastCronAt,
      lastCronError: syncStatus.lastCronError,
      nextCronInSec: syncStatus.nextCronAt ? Math.max(0, Math.round((syncStatus.nextCronAt - Date.now()) / 1000)) : null,
    },
    portfolio: pf
      ? {
        initialBalance: pf.initialBalance ?? 100000,
        cash: Math.round((pf.cash ?? 0) * 100) / 100,
        openPositions: Object.keys(pf.positions || {}).length,
        tradesCount: Math.max(Number(pf.totalTradesCount) || 0, (pf.trades || []).length),
        isActive: !!pf.isActive,
      }
      : null,
    stats: st.stats || { cycles: 0, backtests: 0, deployments: 0 },
  };
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url || '/', `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(urlObj.pathname);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (pathname === '/api/health') {
    res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(buildHealthPayload()));
    return;
  }

  if (pathname === '/api/sync') {
    if (!isAuthorized(req)) {
      res.writeHead(401, { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
      return;
    }
    const out = await syncBaseServerWithCloud();
    res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ...out, health: buildHealthPayload() }));
    return;
  }

  if (pathname === '/api/db' || pathname === '/.netlify/functions/db') {
    if (req.method === 'POST' && !isAuthorized(req)) {
      res.writeHead(401, { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
      return;
    }
    try {
      const raw = req.method === 'POST' ? await readBody(req) : '';
      const bodyObj = raw ? JSON.parse(raw) : {};
      const out = await handleDbRequest(req.method, bodyObj);
      // Mirror push to external Cloud API asynchronously if configured
      if (req.method === 'POST' && CLOUD_API_URL && out?.ok && out?.state) {
        fetchJsonWithTimeout(CLOUD_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'push_state', state: out.state }),
        }, 6000).catch(() => {});
      }
      res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(out));
    } catch (err) {
      res.writeHead(500, { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  if (pathname === '/api/llm' || pathname === '/.netlify/functions/llm') {
    try {
      const { handler: llmHandler } = await import('./netlify/functions/llm.mjs');
      const raw = req.method === 'POST' ? await readBody(req) : '';
      const out = await llmHandler({ httpMethod: req.method, body: raw });
      res.writeHead(out.statusCode || 200, { ...CORS_HEADERS, ...(out.headers || { 'Content-Type': 'application/json; charset=utf-8' }) });
      res.end(out.body);
    } catch (err) {
      res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message: err.message } }));
    }
    return;
  }

  if (pathname === '/api/market' || pathname === '/.netlify/functions/market') {
    try {
      const q = Object.fromEntries(urlObj.searchParams.entries());
      const out = await handleMarketRequest(q);
      res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(out));
    } catch (err) {
      res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  if (pathname === '/api/firm-cron' || pathname === '/.netlify/functions/firm-cron') {
    try {
      const raw = req.method === 'POST' ? await readBody(req) : '';
      const bodyObj = raw ? JSON.parse(raw) : {};
      const out = await runFirmCronJob({ cycles: Number(bodyObj.cycles) || 2, deep: !!bodyObj.deep });
      syncStatus.lastCronAt = new Date().toISOString();
      syncBaseServerWithCloud().catch(() => {});
      res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(out));
    } catch (err) {
      res.writeHead(500, { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  let filePath = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    const ext = path.extname(filePath).toLowerCase();
    const data = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, HOST, () => {
  const urls = getLanUrls();
  console.log('==============================================================');
  console.log('[Alta Capital] Always-On Base Server + Cloud Sync ACTIVE');
  console.log(`  Local URLs: ${urls.join('  |  ')}`);
  console.log(`  Supabase Env: ${getSupaEnv().configured ? 'CONFIGURED' : 'NOT SET (using local disk + CLOUD_API_URL)'}`);
  if (CLOUD_API_URL) console.log(`  Cloud API Mirror: ${CLOUD_API_URL}`);
  console.log(`  Cloud Sync Loop: every ${Math.round(SYNC_INTERVAL_MS / 1000)}s`);
  console.log(`  Local 24/7 Cron: ${ENABLE_LOCAL_CRON ? `ENABLED (every ${Math.round(CRON_INTERVAL_MS / 60000)}m)` : 'DISABLED'}`);
  console.log('==============================================================');

  // Immediate startup sync with cloud
  syncBaseServerWithCloud()
    .then((r) => console.log(`[Base Server] Startup sync: ${r.providers?.join(' + ') || 'Local DB only'}${r.error ? ' (' + r.error + ')' : ''}`))
    .catch(() => {});
});

const syncTimer = setInterval(() => {
  syncBaseServerWithCloud().catch(() => {});
}, SYNC_INTERVAL_MS);

let cronTimer = null;
if (ENABLE_LOCAL_CRON) {
  cronTimer = setInterval(() => {
    runScheduledBaseCron().catch(() => {});
  }, CRON_INTERVAL_MS);
}

function shutdown(sig) {
  console.log(`[Base Server] Received ${sig}, shutting down cleanly...`);
  clearInterval(syncTimer);
  if (cronTimer) clearInterval(cronTimer);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
