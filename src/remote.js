// Cloud & Database sync: reads from the connected database (Netlify DB / Supabase / Cloudflare D1)
// and falls back to ./data/state.json when available.

import { store } from './store.js';
import { pullFromDatabase } from './db.js';

const REMOTE_URL = './data/state.json';

export async function fetchRemoteState() {
  // 1. Try real database first
  try {
    const dbRes = await pullFromDatabase();
    if (dbRes?.ok && dbRes.state && Array.isArray(dbRes.state.desks)) {
      return {
        ...dbRes.state,
        updatedAt: dbRes.updatedAt || dbRes.state.updatedAt || new Date().toISOString(),
        source: dbRes.provider || 'database',
      };
    }
  } catch (err) {
    console.warn('[remote] db pull failed:', err.message);
  }

  // 2. Fallback to static ./data/state.json
  try {
    const res = await fetch(`${REMOTE_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || !Array.isArray(json.desks) || !json.updatedAt) return null;
    return json;
  } catch {
    return null;
  }
}

export function remoteIsNewer(state, remote) {
  if (!remote?.updatedAt) return false;
  const remoteTs = Date.parse(remote.updatedAt) || 0;
  const localTs = state.remote?.updatedAt ? Date.parse(state.remote.updatedAt) : (state.lastTickAt || 0);
  return remoteTs > localTs;
}

export function mergeRemote(state, remote) {
  const settings = { ...state.settings };
  const advisor = { ...state.advisor };
  const desks = remote.desks;
  state.desks = desks;
  state.stats = { ...state.stats, ...(remote.stats || {}) };
  state.events = remote.events?.length ? remote.events : state.events;
  state.ideas = remote.ideas?.length ? remote.ideas : state.ideas;
  state.sentiment = remote.sentiment || state.sentiment;
  state.budget = remote.budget || state.budget;
  state.knowledge = remote.knowledge || state.knowledge;
  if (remote.paperPortfolio && typeof remote.paperPortfolio === 'object') {
    state.paperPortfolio = remote.paperPortfolio;
  }
  state.lastTickAt = Date.parse(remote.updatedAt) || Date.now();
  state.remote = {
    updatedAt: remote.updatedAt,
    source: remote.source || 'netlify-db',
    cycles: remote.stats?.cycles ?? 0,
    desks: desks.length,
  };
  // Personal things stay local: API keys, model choice, advisor chat, selections.
  state.settings = settings;
  state.advisor = advisor;
}

export async function syncFromCloud({ force = false } = {}) {
  const remote = await fetchRemoteState();
  if (!remote) return { ok: false, reason: 'לא נמצא מצב שמור במסד הנתונים או ב-data/state.json' };
  if (!force && !remoteIsNewer(store.state, remote)) {
    return { ok: false, reason: 'המצב המקומי כבר מעודכן מול מסד הנתונים' };
  }
  mergeRemote(store.state, remote);
  store.save();
  store.emit();
  return { ok: true, updatedAt: remote.updatedAt, cycles: remote.stats?.cycles || 0, source: remote.source };
}

export function cloudBadge(state) {
  if (!state.remote?.updatedAt) return null;
  return {
    updatedAt: Date.parse(state.remote.updatedAt),
    label: state.remote.source || 'ענן',
    source: state.remote.source,
    cycles: state.remote.cycles,
  };
}
