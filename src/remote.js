// Cloud sync: the GitHub Actions runner publishes data/state.json, the dashboard reads it.

import { store } from './store.js';

const REMOTE_URL = './data/state.json';

export async function fetchRemoteState() {
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
  const localTs = state.remote?.updatedAt ? Date.parse(state.remote.updatedAt) : 0;
  return remoteTs > localTs;
}

export function mergeRemote(state, remote) {
  const settings = { ...state.settings };
  const advisor = { ...state.advisor };
  const desks = remote.desks;
  state.desks = desks;
  state.stats = { ...state.stats, ...(remote.stats || {}) };
  state.events = remote.events || [];
  state.ideas = remote.ideas?.length ? remote.ideas : state.ideas;
  state.sentiment = remote.sentiment || state.sentiment;
  state.budget = remote.budget || state.budget;
  state.knowledge = remote.knowledge || state.knowledge;
  state.lastTickAt = Date.parse(remote.updatedAt) || Date.now();
  state.remote = {
    updatedAt: remote.updatedAt,
    source: remote.source || 'github-actions',
    cycles: remote.stats?.cycles ?? 0,
    desks: desks.length,
  };
  // Personal things stay local: API keys, model choice, advisor chat, selections.
  state.settings = settings;
  state.advisor = advisor;
}

export async function syncFromCloud({ force = false } = {}) {
  const remote = await fetchRemoteState();
  if (!remote) return { ok: false, reason: 'לא נמצא data/state.json — הריצו את ה־runner או דחפו repo' };
  if (!force && !remoteIsNewer(store.state, remote)) {
    return { ok: false, reason: 'אין עדכון חדש מהענן' };
  }
  mergeRemote(store.state, remote);
  store.save();
  store.emit();
  return { ok: true, updatedAt: remote.updatedAt, cycles: remote.stats?.cycles || 0 };
}

export function cloudBadge(state) {
  if (!state.remote?.updatedAt) return null;
  return {
    updatedAt: Date.parse(state.remote.updatedAt),
    label: 'ענן',
    source: state.remote.source,
    cycles: state.remote.cycles,
  };
}
