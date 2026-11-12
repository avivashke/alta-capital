// Key pool: many free keys, one polite client.
//
// Modeled on the rotating-pool idea used by open source gateways such as
// DeepakSilaych/free-api-gateway and HalfEmptyDrum/Key-Carousel, but kept as a
// pure function set so the same code runs in the browser and in the 24/7 runner:
//   * least-recently-used pick, so one key is not hammered into a 429
//   * per-minute and per-day budgets derived from each provider's free tier
//   * cooldown with exponential backoff on 429/5xx, permanent disable on 401/403
//   * fallback: the caller walks the list until a model answers

import { PROVIDERS, PROVIDER_ORDER, providerBaseUrl } from './providers.js';

const MINUTE = 60_000;
const MAX_COOLDOWN = 60 * MINUTE;

export const dayKey = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 10);

export function poolEntries(state) {
  const entries = state?.settings?.pool?.entries;
  return Array.isArray(entries) ? entries : [];
}

export function ensurePool(state) {
  if (!state.settings.pool || !Array.isArray(state.settings.pool.entries)) {
    state.settings.pool = { entries: [], updatedAt: null };
  }
  return state.settings.pool;
}

function makeId() {
  return 'k_' + Math.random().toString(36).slice(2, 9);
}

export function addPoolEntry(state, input = {}, now = Date.now()) {
  const pool = ensurePool(state);
  const provider = PROVIDERS[input.provider] ? input.provider : 'custom';
  const def = PROVIDERS[provider];
  const key = String(input.key || '').trim();
  const model = String(input.model || def.models?.[0] || '').trim();
  const accountId = String(input.accountId || '').trim();
  const entry = {
    id: makeId(),
    provider,
    // Several Cloudflare accounts can coexist; the label tells them apart.
    label: input.label || (provider === 'cloudflare' && accountId
      ? `Cloudflare · ${accountId.slice(0, 8)}`
      : def.label),
    shape: def.shape || 'openai',
    baseUrl: String(input.baseUrl || providerBaseUrl(provider, input.accountId) || '').trim(),
    accountId,
    model,
    key,
    enabled: input.enabled !== false,
    valid: true,
    weight: Math.max(1, Number(input.weight) || 1),
    addedAt: now,
    lastUsedAt: null,
    uses: 0,
    day: dayKey(now),
    dayCount: 0,
    minuteStart: 0,
    minuteCount: 0,
    cooldownUntil: 0,
    failStreak: 0,
    lastError: '',
  };
  const duplicate = pool.entries.find((e) => e.provider === provider && e.model === model
    && (e.accountId || '') === accountId && e.key && e.key === key);
  if (duplicate) return { entry: duplicate, duplicate: true };
  pool.entries.push(entry);
  pool.updatedAt = now;
  return { entry, duplicate: false };
}

function refreshCounter(entry, now) {
  const today = dayKey(now);
  if (entry.day !== today) {
    entry.day = today;
    entry.dayCount = 0;
    entry.failStreak = 0;
    if (entry.cooldownUntil && entry.cooldownUntil - now > MAX_COOLDOWN) entry.cooldownUntil = 0;
  }
  if (!entry.minuteStart || now - entry.minuteStart >= MINUTE) {
    entry.minuteStart = now;
    entry.minuteCount = 0;
  }
}

export function limitsFor(entry) {
  const def = PROVIDERS[entry.provider] || {};
  return { rpm: def.limits?.rpm || 0, rpd: def.limits?.rpd || 0 };
}

export function entryStatus(entry, now = Date.now()) {
  refreshCounter(entry, now);
  if (!entry.enabled) return 'disabled';
  if (!entry.valid) return 'invalid';
  if (entry.cooldownUntil > now) return 'cooling';
  const lim = limitsFor(entry);
  if (lim.rpd && entry.dayCount >= lim.rpd) return 'exhausted';
  if (lim.rpm && entry.minuteCount >= lim.rpm) return 'throttled';
  return 'ready';
}

export function availableEntries(state, now = Date.now()) {
  return poolEntries(state)
    .filter((e) => entryStatus(e, now) === 'ready')
    .sort((a, b) => {
      // least recently used first; ties broken by how much daily budget is left
      const la = a.lastUsedAt || 0;
      const lb = b.lastUsedAt || 0;
      if (la !== lb) return la - lb;
      return (b.weight || 1) - (a.weight || 1);
    });
}

export function markUsed(state, entry, now = Date.now()) {
  refreshCounter(entry, now);
  entry.uses = (entry.uses || 0) + 1;
  entry.dayCount = (entry.dayCount || 0) + 1;
  entry.minuteCount = (entry.minuteCount || 0) + 1;
  entry.lastUsedAt = now;
  entry.failStreak = 0;
  entry.lastError = '';
  ensurePool(state).updatedAt = now;
}

export function markFailure(state, entry, { status = 0, message = '' } = {}, now = Date.now()) {
  refreshCounter(entry, now);
  entry.failStreak = (entry.failStreak || 0) + 1;
  entry.lastError = String(message || `HTTP ${status}`).slice(0, 200);
  const streak = entry.failStreak;

  if (status === 401 || status === 403) {
    entry.valid = false;
    entry.enabled = false;
  } else if (status === 402 || status === 429) {
    const base = status === 402 ? 6 * 60 * MINUTE : MINUTE;
    entry.cooldownUntil = now + Math.min(MAX_COOLDOWN * 6, base * Math.pow(2, Math.min(streak - 1, 5)));
  } else {
    entry.cooldownUntil = now + Math.min(MAX_COOLDOWN, 15_000 * Math.pow(2, Math.min(streak - 1, 4)));
  }
  ensurePool(state).updatedAt = now;
}

export function resetCooldowns(state, now = Date.now()) {
  for (const entry of poolEntries(state)) {
    entry.cooldownUntil = 0;
    entry.failStreak = 0;
    entry.lastError = '';
  }
  ensurePool(state).updatedAt = now;
}

export function poolStats(state, now = Date.now()) {
  const entries = poolEntries(state);
  const counts = { ready: 0, cooling: 0, exhausted: 0, throttled: 0, invalid: 0, disabled: 0 };
  let requestsToday = 0;
  for (const entry of entries) {
    refreshCounter(entry, now);
    counts[entryStatus(entry, now)] = (counts[entryStatus(entry, now)] || 0) + 1;
    requestsToday += entry.dayCount || 0;
  }
  return {
    total: entries.length,
    ...counts,
    requestsToday,
    providers: [...new Set(entries.map((e) => e.provider))].length,
  };
}

export function removePoolEntry(state, id, now = Date.now()) {
  const pool = ensurePool(state);
  const before = pool.entries.length;
  pool.entries = pool.entries.filter((e) => e.id !== id);
  pool.updatedAt = now;
  return pool.entries.length < before;
}

export function movePoolEntry(state, id, delta) {
  const pool = ensurePool(state);
  const idx = pool.entries.findIndex((e) => e.id === id);
  const next = idx + delta;
  if (idx === -1 || next < 0 || next >= pool.entries.length) return false;
  const [item] = pool.entries.splice(idx, 1);
  pool.entries.splice(next, 0, item);
  pool.updatedAt = Date.now();
  return true;
}

// Env → pool. Every key the workflow can see becomes an entry, so free tiers from
// several providers stack instead of one provider being the single point of 429.
const ENV_KEYS = [
  ['GROQ_API_KEY', 'groq'],
  ['GEMINI_API_KEY', 'gemini'],
  ['GOOGLE_API_KEY', 'gemini'],
  ['ZAI_API_KEY', 'zai'],
  ['ZHIPU_API_KEY', 'zai'],
  ['OPENROUTER_API_KEY', 'openrouter'],
  ['MISTRAL_API_KEY', 'mistral'],
  ['NVIDIA_API_KEY', 'nvidia'],
  ['COHERE_API_KEY', 'cohere'],
  ['CEREBRAS_API_KEY', 'custom'],
  ['XAI_API_KEY', 'xai'],
  ['DEEPSEEK_API_KEY', 'deepseek'],
  ['TOGETHER_API_KEY', 'together'],
  ['ANTHROPIC_API_KEY', 'anthropic'],
  ['OPENAI_API_KEY', 'openai'],
];

export function buildPoolFromEnv(env = {}, now = Date.now()) {
  const state = { settings: { pool: { entries: [], updatedAt: now } } };
  const add = (input) => addPoolEntry(state, input, now);

  for (const [name, provider] of ENV_KEYS) {
    const value = String(env[name] || '').trim();
    if (!value) continue;
    if (provider === 'custom') {
      // Cerebras speaks OpenAI but its model catalogue is its own.
      add({ provider: 'custom', key: value, baseUrl: 'https://api.cerebras.ai/v1', model: env.CEREBRAS_MODEL || 'llama-3.3-70b' });
      continue;
    }
    add({ provider, key: value, model: env[`${provider.toUpperCase()}_MODEL`] || '' });
  }

  // Cloudflare: one free allowance per account, so several accounts are supported.
  // CLOUDFLARE_KEYS='[{"accountId":"abc","token":"cf_..."},{"accountId":"def","token":"cf_..."}]'
  // or plain lines: "abc,cf_...,@cf/meta/llama-3.3-70b-instruct-fp8-fast"
  const cfList = parseCloudflareKeys(env.CLOUDFLARE_KEYS || '');
  for (const item of cfList) {
    add({ provider: 'cloudflare', accountId: item.accountId, key: item.key, model: item.model });
  }
  const cfToken = String(env.CLOUDFLARE_API_TOKEN || env.CF_API_TOKEN || '').trim();
  if (cfToken) {
    add({
      provider: 'cloudflare',
      key: cfToken,
      accountId: env.CLOUDFLARE_ACCOUNT_ID || '',
      model: env.CLOUDFLARE_MODEL || '',
    });
  }

  // A local model has no key and no quota, which is the only way to get a truly
  // unlimited 24/7 loop: point the runner at Ollama (or any local server).
  const ollamaUrl = String(env.OLLAMA_BASE_URL || '').trim();
  if (ollamaUrl) {
    add({
      provider: 'ollama',
      key: '',
      baseUrl: ollamaUrl.replace(/\/+$/, '') + '/v1',
      model: env.OLLAMA_MODEL || 'llama3.1',
    });
  }

  if (env.LLM_GATEWAY_URL) {
    add({
      provider: 'gateway',
      key: env.LLM_GATEWAY_KEY || '',
      baseUrl: env.LLM_GATEWAY_URL,
      model: env.LLM_GATEWAY_MODEL || 'auto',
    });
  }

  // Explicit list wins: LLM_KEYS='[{"provider":"groq","key":"gsk_...","model":"..."}]'
  if (env.LLM_KEYS) {
    try {
      const parsed = JSON.parse(env.LLM_KEYS);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (!item || !item.key) continue;
          add({
            provider: item.provider || 'custom',
            key: item.key,
            model: item.model || '',
            baseUrl: item.baseUrl || '',
            accountId: item.accountId || '',
          });
        }
      }
    } catch (err) {
      console.warn('[pool] LLM_KEYS is not valid JSON:', err.message);
    }
  }

  return state.settings.pool.entries;
}

// The published state keeps the pool with blank keys, so the next CI run can inherit
// yesterday's usage: without this every fresh env pool would restart at the first key
// and the Cloudflare accounts would never rotate.
export const poolIdentity = (entry) => `${entry.provider}|${entry.accountId || ''}|${entry.model}`;

export function mergePoolUsage(state, fresh, now = Date.now()) {
  const previous = new Map(poolEntries(state).map((e) => [poolIdentity(e), e]));
  const today = dayKey(now);
  for (const entry of fresh) {
    const old = previous.get(poolIdentity(entry));
    if (!old) continue;
    entry.lastUsedAt = old.lastUsedAt ?? null;
    entry.uses = old.uses || 0;
    entry.day = today;
    entry.dayCount = old.day === today ? (old.dayCount || 0) : 0;
    entry.minuteStart = old.minuteStart || 0;
    entry.minuteCount = old.minuteCount || 0;
    entry.cooldownUntil = (old.cooldownUntil || 0) > now ? old.cooldownUntil : 0;
    entry.failStreak = old.failStreak || 0;
    entry.valid = old.valid !== false;
    entry.enabled = old.enabled !== false;
    entry.lastError = old.lastError || '';
  }
  return fresh;
}

// Accepts both a JSON array and line based input, because pasting two accounts from
// the Cloudflare dashboard should not require hand-writing JSON.
export function parseCloudflareKeys(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return [];
  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list
        .map((x) => ({
          accountId: String(x.accountId || x.account || x.id || '').trim(),
          key: String(x.token || x.key || x.apiToken || '').trim(),
          model: String(x.model || '').trim(),
        }))
        .filter((x) => x.accountId && x.key);
    } catch {
      return [];
    }
  }
  const out = [];
  for (const line of raw.split(/[\n;]+/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/[,\t]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const [accountId, key, model] = parts;
    if (!accountId || !key) continue;
    out.push({ accountId, key, model: model || '' });
  }
  return out;
}

export function poolProviderOrder() {
  return PROVIDER_ORDER;
}
