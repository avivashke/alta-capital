// Persistent state in localStorage + a tiny pub/sub.

import { AGENT_ROSTER, DESKS } from './config.js';
import { POLLINATIONS_MODELS } from './providers.js';
import { reviveEntries } from './keypool.js';

const STORAGE_KEY = 'alta-capital-firm-v1';
const FREE_WEB_BASE = 'https://text.pollinations.ai/openai';

// Keyless web AI is part of the pool on every install, so no feature ever reports
// "no model configured" before the user adds a key.
function ensureFreeWebEntries(st) {
  if (!st?.pool || !Array.isArray(st.pool.entries)) return;
  let added = 0;
  // The anonymous Pollinations tier drops and adds models; keep only the ones it serves
  // now so the pool does not retry retired names on every cycle.
  const before = st.pool.entries.length;
  st.pool.entries = st.pool.entries.filter((e) => e.provider !== 'pollinations'
    || POLLINATIONS_MODELS.includes(e.model));
  added += before - st.pool.entries.length;
  for (const model of POLLINATIONS_MODELS) {
    if (st.pool.entries.some((e) => e.provider === 'pollinations' && e.model === model)) continue;
    st.pool.entries.push({
      id: `free_pollinations_${model}`,
      provider: 'pollinations',
      label: `Pollinations · ${model} (חינם מהווב)`,
      shape: 'openai',
      baseUrl: FREE_WEB_BASE,
      accountId: '',
      model,
      key: '',
      enabled: true,
      valid: true,
      weight: 1,
      addedAt: Date.now(),
      lastUsedAt: null,
      uses: 0,
      day: new Date().toISOString().slice(0, 10),
      dayCount: 0,
      minuteStart: 0,
      minuteCount: 0,
      cooldownUntil: 0,
      failStreak: 0,
      lastError: '',
    });
    added += 1;
  }
  if (added) st.pool.updatedAt = Date.now();
}

export const uid = (prefix = 'id') => prefix + '_' + Math.random().toString(36).slice(2, 9);

export function defaults() {
  return {
    schema: 1,
    stateRevision: 0,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    lastTickAt: null,
    paperPortfolio: null,
    settings: {
      autopilot: true,
      tickSeconds: 4,
      capital: 100000,
      riskPerTrade: 0.015,
      maxDrawdown: 0.3,
      minTrades: 10,
      minProfitFactor: 1.15,
      promotionDelta: 0.1,
      minRobustness: 50,
      cloudSync: true,
      autoResearch: true,
      autoOptimize: true,
      autoCreateRobots: true,
      cloudflareProxyUrl: '',
      cloudflareProxyKey: '',
      cloudflareProxyModel: 'openai/gpt-oss-120b',
      feeRate: 0.0004,
      makerFee: 0.00025,
      takerFee: 0.0004,
      spread: 0.001,
      impactFactor: 1.0,
      exchangeFee: 0,
      platform: 'freqtrade',
      llm: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '', temperature: 0.4, preferColibri: true },
      pool: { entries: [], updatedAt: null },
      db: {
        enabled: true,
        mode: 'auto',
        supabaseUrl: '',
        supabaseKey: '',
        netlifyToken: '',
        cloudApiUrl: '',
        baseServerUrl: '',
        baseServerToken: '',
        workerDbUrl: '',
        workerDbKey: '',
        apiEndpoint: '/api/db',
      },
      binance: {
        apiKey: '',
        apiSecret: '',
        proxyUrl: '',
        makerFee: 0.001,
        takerFee: 0.001,
      },
      github: { token: '', owner: '', repo: '', path: 'firm/context.json' },
      news: { endpoint: '', apiKey: '' },
    },
    desks: [],
    agents: [],
    events: [],
    ideas: [],
    knowledge: { strategies: [], lessons: [], facts: [] },
    budget: {},
    sentiment: { updatedAt: null, source: null, fearGreed: null, assets: {}, headlines: [] },
    fundamentals: { updatedAt: null, macro: null, assets: {} },
    xResearch: null,
    whatsappGann: null,
    youtubeScout: null,
    advisor: { messages: [] },
    remote: null,
    stats: { cycles: 0, backtests: 0, deployments: 0, scans: 0, startedAt: Date.now() },
  };
}

function deepMerge(base, extra) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return extra ?? base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(extra)) {
    out[k] = base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k])
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}

const listeners = new Set();
let saveTimer = null;

export const store = {
  state: defaults(),
  _revision: 0,

  markReloaded() {
    this._revision += 1;
  },

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const base = defaults();
        this.state = {
          ...base,
          ...parsed,
          settings: deepMerge(base.settings, parsed.settings || {}),
          knowledge: deepMerge(base.knowledge, parsed.knowledge || {}),
          advisor: deepMerge(base.advisor, parsed.advisor || {}),
        };
      }
    } catch (err) {
      console.warn('[store] load failed, starting fresh', err);
    }
    this.ensureTeam();
    this.ensureCloudflareProxy();
    this.ensureOllamaEntry();
    this.markReloaded();
    return this.state;
  },

  ensureOllamaEntry() {
    const st = this.state?.settings;
    if (!st) return;
    // Ensure Ollama (local) entry exists in the pool, 
    const exists = st.pool.entries.find(e => e.provider === 'ollama');
    if (exists && /:11435\b/.test(exists.baseUrl || '')) { exists.baseUrl = 'http://localhost:11434/v1'; exists.failStreak = 0; exists.cooldownUntil = 0; exists.valid = true; }
    if (!exists) {
      st.pool.entries.unshift({
        id: 'ollama_local',
        provider: 'ollama',
        label: 'Ollama (מקומי, GPU/CPU)',
        shape: 'openai',
        baseUrl: 'http://localhost:11434/v1',
        accountId: '',
        model: 'qwen2.5:3b', // default fast model, can be overridden by UI
        key: '',
        enabled: true,
        valid: true,
        weight: 1,
        addedAt: Date.now(),
        lastUsedAt: null,
        uses: 0,
        day: new Date().toISOString().slice(0, 10),
        dayCount: 0,
        minuteStart: 0,
        minuteCount: 0,
        cooldownUntil: 0,
        failStreak: 0,
        lastError: '',
      });
      st.pool.updatedAt = Date.now();
    }
  },
  ensureCloudflareProxy() {
    const st = this.state?.settings;
    if (!st) return;
    const url = (st.cloudflareProxyUrl || '').trim();
    const model = (st.cloudflareProxyModel || 'openai/gpt-oss-120b').trim() || 'openai/gpt-oss-120b';
    st.cloudflareProxyUrl = url;
    st.cloudflareProxyModel = model;
    if (!st.pool || !Array.isArray(st.pool.entries)) st.pool = { entries: [], updatedAt: null };

    // Two Workers used to be baked in. Both now refuse every caller (403 Origin not
    // allowed / retired Groq model), so drop them instead of retrying dead URLs.
    st.pool.entries = st.pool.entries.filter((e) => !(e.provider === 'gateway'
      && /tight-cake-d704|alta-groq\./i.test(e.baseUrl || '')));

    ensureFreeWebEntries(st);

    if (url) {
      const target = url.replace(/\/+$/, '').toLowerCase();
      const exists = st.pool.entries.find((e) => e.provider === 'gateway'
        && (e.baseUrl || '').replace(/\/+$/, '').toLowerCase() === target);
      if (!exists) {
        st.pool.entries.unshift({
          id: 'cf_proxy_default',
          provider: 'gateway',
          label: 'Cloudflare Worker Proxy',
          shape: 'openai',
          baseUrl: url,
          accountId: '',
          model,
          key: st.cloudflareProxyKey || '',
          enabled: true,
          valid: true,
          weight: 1,
          addedAt: Date.now(),
          lastUsedAt: null,
          uses: 0,
          day: new Date().toISOString().slice(0, 10),
          dayCount: 0,
          minuteStart: 0,
          minuteCount: 0,
          cooldownUntil: 0,
          failStreak: 0,
          lastError: '',
        });
        st.pool.updatedAt = Date.now();
      } else {
        if (st.cloudflareProxyKey) exists.key = exists.key || st.cloudflareProxyKey;
        exists.model = st.cloudflareProxyModel;
      }
    }

    // Old builds permanently disabled a proxy on any 403; bring those entries back.
    reviveEntries(this.state);
  },

  ensureTeam() {
    if (!this.state.agents?.length) {
      this.state.agents = AGENT_ROSTER.map((a) => ({
        ...a, status: 'idle', task: 'ממתין למחזור הראשון', progress: 0, completed: 0,
        speech: null, speechType: 'speak', thinking: null,
      }));
    } else {
      // merge newly added roster agents into existing saved state
      const have = new Set(this.state.agents.map((a) => a.id));
      for (const a of AGENT_ROSTER) {
        if (!have.has(a.id)) {
          this.state.agents.push({
            ...a, status: 'idle', task: 'מצטרף לצוות ומתחיל סריקה', progress: 0, completed: 0,
            speech: null, speechType: 'speak', thinking: null,
          });
        }
      }
    }
    if (!this.state.desks?.length) {
      this.state.desks = DESKS.map((d) => ({
        ...d,
        status: 'research',
        strategyId: null,
        params: null,
        version: null,
        bestReturn: null,
        baselineReturn: null,
        metrics: null,
        fitness: null,
        equity: [],
        history: [],
        dryRunCycles: 0,
        liveTrades: [],
        livePnl: 0,
        lastRunAt: null,
        generatedCode: null,
      }));
    } else {
      const haveDesks = new Set(this.state.desks.map((d) => d.id));
      for (const d of DESKS) {
        if (!haveDesks.has(d.id)) {
          this.state.desks.push({
            ...d,
            status: 'research',
            strategyId: null,
            params: null,
            version: null,
            bestReturn: null,
            baselineReturn: null,
            metrics: null,
            fitness: null,
            equity: [],
            history: [],
            dryRunCycles: 0,
            liveTrades: [],
            livePnl: 0,
            lastRunAt: null,
            generatedCode: null,
          });
        }
      }
    }
  },

  save(immediate = false) {
    clearTimeout(saveTimer);
    const write = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch (err) {
        console.warn('[store] save failed (quota?)', err);
      }
    };
    if (immediate) write();
    else saveTimer = setTimeout(write, 300);
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  emit() {
    for (const fn of listeners) {
      try { fn(this.state); } catch (err) { console.error('[store] listener', err); }
    }
  },

  mutate(fn) {
    fn(this.state);
    this.save(true);
    this.emit();
  },

  log(level, actor, text) {
    this.state.events.unshift({ at: Date.now(), level, actor, text });
    if (this.state.events.length > 350) this.state.events.length = 350;
  },

  setAgentSpeech(agentId, { speech = null, speechType = 'speak', thinking = null, status = null, task = null, progress = null }) {
    const agent = this.state.agents.find((a) => a.id === agentId);
    if (!agent) return;
    if (speech !== null) agent.speech = speech;
    if (speechType !== null) agent.speechType = speechType;
    if (thinking !== null) agent.thinking = thinking;
    if (status !== null) agent.status = status;
    if (task !== null) agent.task = task;
    if (progress !== null) agent.progress = progress;
    this.save();
    this.emit();
  },

  clearAgentSpeech(agentId) {
    const agent = this.state.agents.find((a) => a.id === agentId);
    if (!agent) return;
    agent.speech = null;
    agent.speechType = 'speak';
    agent.thinking = null;
    if (agent.status === 'busy') agent.status = 'idle';
    this.save();
    this.emit();
  },

  reset() {
    localStorage.removeItem(STORAGE_KEY);
    this.state = defaults();
    this.ensureTeam();
    this.ensureCloudflareProxy();
    this.markReloaded();
    this.save(true);
    this.emit();
  },

  exportJson() {
    return JSON.stringify(this.state, null, 2);
  },

  importJson(text) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || !parsed.settings) throw new Error('מבנה קובץ לא תקין');
    const base = defaults();
    this.state = {
      ...base,
      ...parsed,
      settings: deepMerge(base.settings, parsed.settings || {}),
      knowledge: deepMerge(base.knowledge, parsed.knowledge || {}),
    };
    this.ensureTeam();
    this.ensureCloudflareProxy();
    this.markReloaded();
    this.save(true);
    this.emit();
  },
};
