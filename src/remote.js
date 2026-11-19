// Cloud & Base Server cross-device sync.
// Reads from ALL connected databases (Supabase / Netlify DB / Base Server / Cloudflare D1)
// and falls back to ./data/state.json when available.
// Uses conflict-free merging (src/state_merge.js) and immediately invalidates cached
// singletons (like PaperPortfolio) via store.markReloaded() so every device stays aligned.

import { store } from './store.js';
import { pullFromDatabase, pushStateToDatabase, onCanonicalStateFromServer, dbState } from './db.js';
import { mergeFirmStates, remoteHasMoreOrNewerData, isStateFreshEmpty } from './state_merge.js';

const REMOTE_URL = './data/state.json';

async function fetchStaticStateJson() {
  try {
    const res = await fetch(`${REMOTE_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || !Array.isArray(json.desks) || !json.updatedAt) return null;
    return { ...json, source: json.source || 'github-actions' };
  } catch {
    return null;
  }
}

export async function fetchRemoteState() {
  let dbStateResult = null;
  let dbProvider = null;

  // 1. Try real databases first (Supabase / Netlify / Base Server / Worker)
  try {
    const dbRes = await pullFromDatabase();
    if (dbRes?.ok && dbRes.state && Array.isArray(dbRes.state.desks)) {
      dbStateResult = {
        ...dbRes.state,
        updatedAt: dbRes.updatedAt || dbRes.state.updatedAt || new Date().toISOString(),
        source: dbRes.provider || 'database',
      };
      dbProvider = dbRes.provider || 'database';
    }
  } catch (err) {
    console.warn('[remote] db pull failed:', err.message);
  }

  // 2. Also check static ./data/state.json (GitHub Actions 24/7 artifact) and merge if richer
  const staticState = await fetchStaticStateJson();
  if (dbStateResult && staticState) {
    const merged = mergeFirmStates(staticState, dbStateResult);
    merged.source = dbProvider || staticState.source || 'cloud';
    return merged;
  }
  if (dbStateResult) return dbStateResult;
  if (staticState) {
    dbState.initialSyncDone = true;
    return staticState;
  }
  return null;
}

export function remoteIsNewer(state, remote) {
  return remoteHasMoreOrNewerData(state, remote);
}

export function mergeRemote(state, remote) {
  if (!remote || typeof remote !== 'object') return;
  const personalSettings = JSON.parse(JSON.stringify(state.settings || {}));
  const personalAdvisor = JSON.parse(JSON.stringify(state.advisor || { messages: [] }));

  const merged = mergeFirmStates(state, remote);

  state.stateRevision = merged.stateRevision || state.stateRevision || 0;
  state.desks = merged.desks || state.desks;
  state.agents = merged.agents || state.agents;
  state.stats = merged.stats || state.stats;
  state.events = merged.events || state.events;
  state.ideas = merged.ideas || state.ideas;
  state.sentiment = merged.sentiment || state.sentiment;
  state.budget = merged.budget || state.budget;
  state.knowledge = merged.knowledge || state.knowledge;
  if (merged.paperPortfolio && typeof merged.paperPortfolio === 'object') {
    state.paperPortfolio = merged.paperPortfolio;
  }
  if (merged.nostro && typeof merged.nostro === 'object') {
    state.nostro = merged.nostro;
  }
  if (merged.gannLibrary && typeof merged.gannLibrary === 'object') {
    state.gannLibrary = merged.gannLibrary;
  }
  if (merged.fundamentals && typeof merged.fundamentals === 'object') {
    state.fundamentals = merged.fundamentals;
  }
  if (merged.githubScout && typeof merged.githubScout === 'object') {
    state.githubScout = merged.githubScout;
  }

  state.updatedAt = merged.updatedAt || remote.updatedAt || new Date().toISOString();
  state.lastTickAt = merged.lastTickAt || Date.parse(state.updatedAt) || Date.now();
  state.remote = {
    updatedAt: remote.updatedAt || state.updatedAt,
    source: remote.source || dbState.provider || 'cloud',
    cycles: state.stats?.cycles ?? 0,
    desks: (state.desks || []).length,
    revision: state.stateRevision || 0,
  };

  // Personal credentials & chat stay local
  state.settings = personalSettings;
  state.advisor = personalAdvisor;

  // CRITICAL: notify store that state was reloaded so cached singletons (PaperPortfolio) rehydrate immediately!
  store.ensureTeam();
  store.ensureCloudflareProxy();
  store.markReloaded();
}

// Automatically converge whenever a server push returns richer canonical state from another device
onCanonicalStateFromServer((canonical, provider) => {
  mergeRemote(store.state, { ...canonical, source: provider || canonical.source || 'cloud' });
  store.save(true);
  store.emit();
});

export async function syncFromCloud({ force = false, pushIfLocalAhead = true } = {}) {
  const remote = await fetchRemoteState();
  if (!remote) {
    return { ok: false, reason: 'לא נמצא מצב שמור במסד הנתונים או ב-data/state.json' };
  }

  const localHasProgress = !isStateFreshEmpty(store.state);
  const needsMerge = force || remoteHasMoreOrNewerData(store.state, remote);

  if (needsMerge) {
    mergeRemote(store.state, remote);
    store.save(true);
    store.emit();
  }

  // If local had progress that remote didn't yet have (e.g. offline work on Base Server or phone), push merged state back!
  if (pushIfLocalAhead && localHasProgress && remoteHasMoreOrNewerData(remote, store.state)) {
    pushStateToDatabase(store.state).catch(() => {});
  }

  if (!needsMerge) {
    return {
      ok: false,
      alreadyUpToDate: true,
      reason: 'המצב המקומי כבר מעודכן מול מסד הנתונים',
      source: remote.source,
    };
  }

  return {
    ok: true,
    updatedAt: store.state.updatedAt || remote.updatedAt,
    cycles: store.state.stats?.cycles || 0,
    trades: store.state.paperPortfolio?.totalTradesCount || store.state.paperPortfolio?.trades?.length || 0,
    source: remote.source,
  };
}

export async function syncBidirectional() {
  const pull = await syncFromCloud({ force: true, pushIfLocalAhead: false });
  const push = await pushStateToDatabase(store.state);
  return {
    ok: !!(pull?.ok || push?.ok),
    pull,
    push,
    provider: push?.provider || pull?.source || dbState.provider,
    updatedAt: store.state.updatedAt,
  };
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
