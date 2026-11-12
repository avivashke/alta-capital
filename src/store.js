// Persistent state in localStorage + a tiny pub/sub.

import { AGENT_ROSTER, DESKS } from './config.js';

const STORAGE_KEY = 'alta-capital-firm-v1';

export const uid = (prefix = 'id') => prefix + '_' + Math.random().toString(36).slice(2, 9);

export function defaults() {
  return {
    schema: 1,
    createdAt: new Date().toISOString(),
    lastTickAt: null,
    settings: {
      autopilot: true,
      tickSeconds: 7,
      capital: 25000,
      riskPerTrade: 0.015,
      maxDrawdown: 0.3,
      minTrades: 10,
      minProfitFactor: 1.15,
      promotionDelta: 0.1,
      minRobustness: 50,
      cloudSync: true,
      feeRate: 0.0004,
      platform: 'freqtrade',
      llm: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '', temperature: 0.4 },
      pool: { entries: [], updatedAt: null },
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
    return this.state;
  },

  ensureTeam() {
    if (!this.state.agents?.length) {
      this.state.agents = AGENT_ROSTER.map((a) => ({
        ...a, status: 'idle', task: 'ממתין למחזור הראשון', progress: 0, completed: 0,
      }));
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
    }
  },

  save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch (err) {
        console.warn('[store] save failed (quota?)', err);
      }
    }, 300);
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
    this.save();
    this.emit();
  },

  log(level, actor, text) {
    this.state.events.unshift({ at: Date.now(), level, actor, text });
    if (this.state.events.length > 350) this.state.events.length = 350;
  },

  reset() {
    localStorage.removeItem(STORAGE_KEY);
    this.state = defaults();
    this.ensureTeam();
    this.save();
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
    this.save();
    this.emit();
  },
};
