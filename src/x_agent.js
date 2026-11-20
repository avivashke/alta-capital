// Frontend Bridge for Roni ("רוני" · x_fundamental) — Local Real-Browser X Fundamental Research Agent.
// Auto-discovers the user's running Alta Capital Base Server (same origin, configured baseServerUrl,
// or http://localhost:8181) to inspect status, launch the visible X login browser window on the PC,
// trigger live fundamental X scans, save watchlist settings, and sync verified reports into store.

import { store } from './store.js';
import { scheduleDatabasePush } from './db.js';

let discoveredOrigin = null;

function getCandidateOrigins() {
  const out = [];
  const push = (u) => {
    const clean = String(u || '').trim().replace(/\/+$/, '');
    if (clean && /^https?:\/\//i.test(clean) && !out.includes(clean)) out.push(clean);
  };
  if (discoveredOrigin) push(discoveredOrigin);
  if (typeof window !== 'undefined' && /^https?:/.test(window.location.origin)) {
    push(window.location.origin);
  }
  const cfgBase = store.state?.settings?.db?.baseServerUrl;
  if (cfgBase) push(cfgBase);
  push('http://localhost:8181');
  push('http://127.0.0.1:8181');
  return out;
}

function authHeaders() {
  const token = (store.state?.settings?.db?.baseServerToken || '').trim();
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 4000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function syncXResearchToStore(report) {
  if (!report || typeof report !== 'object') return;
  const prevAt = store.state.xResearch?.scannedAt || 0;
  if ((report.scannedAt || 0) >= prevAt) {
    store.state.xResearch = report;
    const roni = (store.state.agents || []).find((a) => a.id === 'x_fundamental');
    if (roni) {
      roni.status = 'idle';
      roni.lastActive = report.scannedAt || Date.now();
      roni.task = `סריקת X: ${report.totalPosts || 0} ציוצי אמת (${report.overallBias || 'מאוזן'})`;
      roni.speech = `סרקתי ${report.totalPosts || 0} ציוצים אמיתיים ב-X (${report.loggedInHandle || ''}) · ${report.overallBias || ''}`;
    }
    store.save();
    store.emit();
    scheduleDatabasePush(1200);
  }
}

export async function fetchXAgentStatus() {
  const candidates = getCandidateOrigins();
  for (const origin of candidates) {
    try {
      const res = await fetchWithTimeout(`${origin}/api/x-agent/status`, { headers: { Accept: 'application/json' } }, 2800);
      if (!res.ok) continue;
      const data = await res.json();
      if (data && data.agentId === 'x_fundamental') {
        discoveredOrigin = origin;
        if (data.latestReport) syncXResearchToStore(data.latestReport);
        return { connected: true, origin, ...data };
      }
    } catch { /* try next origin */ }
  }
  return {
    connected: false,
    origin: null,
    playwrightInstalled: false,
    loggedIn: false,
    loggedInHandle: null,
    detectedBrowsers: [],
    config: null,
    job: { busy: false, mode: null },
    latestReport: store.state.xResearch || null,
  };
}

async function resolveOrigin() {
  if (discoveredOrigin) return discoveredOrigin;
  const st = await fetchXAgentStatus();
  return st.connected ? st.origin : null;
}

export async function launchXAgentLogin() {
  const origin = await resolveOrigin();
  if (!origin) {
    return {
      ok: false,
      error: 'לא זוהה שרת בסיס מקומי פעיל על המחשב (http://localhost:8181). הפעל את Alta Capital Base Server על המחשב כדי שרוני יוכל לפתוח דפדפן.',
    };
  }
  try {
    const res = await fetchWithTimeout(`${origin}/api/x-agent/login`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    }, 10000);
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function runXAgentScan(options = {}) {
  const origin = await resolveOrigin();
  if (!origin) {
    return {
      ok: false,
      error: 'לא זוהה שרת בסיס מקומי פעיל על המחשב (http://localhost:8181).',
    };
  }
  const roni = (store.state.agents || []).find((a) => a.id === 'x_fundamental');
  if (roni) {
    roni.status = 'busy';
    roni.task = 'גולש בדפדפן X ואוסף מודיעין פונדמנטלי חי…';
    roni.speech = 'נכנס לדפדפן X שלך לסריקת ציוצי אמת על מאקרו, דוחות, מניות וקריפטו!';
    store.emit();
  }
  try {
    // Live browser scan + optional local AI synthesis can take up to 3 minutes
    const res = await fetchWithTimeout(`${origin}/api/x-agent/scan`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(options),
    }, 210000);
    const data = await res.json();
    if (data?.ok && data.report) {
      syncXResearchToStore(data.report);
      store.log('ok', 'רוני · חוקר X', `הושלמה סריקת מחקר פונדמנטלי ב-X (${data.report.totalPosts} ציוצי אמת · ${data.report.overallBias})`);
    } else if (roni) {
      roni.status = 'idle';
      roni.task = data?.error || data?.reason || 'ממתין לסריקת X';
      store.emit();
    }
    return data;
  } catch (err) {
    if (roni) {
      roni.status = 'idle';
      roni.task = 'שגיאה בסריקת X: ' + err.message;
      store.emit();
    }
    return { ok: false, error: err.message };
  }
}

export async function saveXAgentConfig(patch = {}) {
  const origin = await resolveOrigin();
  if (!origin) return { ok: false, error: 'שרת הבסיס המקומי אינו מחובר' };
  try {
    const res = await fetchWithTimeout(`${origin}/api/x-agent/config`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(patch),
    }, 6000);
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
