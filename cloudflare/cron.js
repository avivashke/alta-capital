// Cloudflare Autonomous Firm Runner: /api/firm-cron
// Runs 24/7 on Cloudflare Workers via Scheduled Triggers (crons = ["*/15 * * * *"])
// or on-demand via POST /api/firm-cron.
// 1. Pulls state from Cloudflare D1 / KV / Supabase
// 2. Builds AI pool (Cloudflare Workers AI + configured keys)
// 3. Runs AI Director & walk-forward desk cycles
// 4. Executes live tick, risk controls & Nostro fleet
// 5. Monotonically saves all updated balances, trades, and versions

import { handleCloudflareDbRequest } from './db.js';

const STORAGE_KEY = 'alta-capital-firm-v1';

// In-memory localStorage polyfill for edge environments
export function installMemoryStorage({ seedState = null, key = STORAGE_KEY } = {}) {
  const mem = {};
  if (seedState) {
    mem[key] = typeof seedState === 'string' ? seedState : JSON.stringify(seedState);
  }
  globalThis.localStorage = {
    get length() {
      return Object.keys(mem).length;
    },
    key(i) {
      return Object.keys(mem)[i] ?? null;
    },
    getItem(k) {
      return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
    },
    setItem(k, v) {
      mem[k] = String(v);
    },
    removeItem(k) {
      delete mem[k];
    },
    clear() {
      for (const k of Object.keys(mem)) delete mem[k];
    },
  };
  return {
    getRaw: () => mem[key] || null,
    getState: () => {
      try { return JSON.parse(mem[key]); } catch { return null; }
    },
  };
}

export async function runFirmCronJob({ cycles = 2, deep = false, env = {} } = {}) {
  const started = Date.now();

  // 1. Pull latest canonical state from Cloudflare D1 / KV / Supabase
  const pulled = await handleCloudflareDbRequest('GET', { action: 'pull' }, env);
  const initialState = pulled?.state || null;

  // 2. Polyfill storage with state
  installMemoryStorage({ seedState: initialState });

  // 3. Dynamically import firm modules
  const { store } = await import('../src/store.js');
  const firm = await import('../src/firm.js');
  const ai = await import('../src/ai.js');
  const { buildPoolFromEnv, mergePoolUsage } = await import('../src/keypool.js');
  const { mergeFirmStates } = await import('../src/state_merge.js');

  store.load();

  if (pulled?.state && Array.isArray(pulled.state.desks) && pulled.state.desks.length) {
    const merged = mergeFirmStates(store.state, pulled.state);
    store.state = {
      ...store.state,
      ...merged,
      settings: { ...store.state.settings, ...(pulled.state.settings || {}) },
    };
    store.markReloaded();
  }

  store.ensureTeam();
  store.ensureCloudflareProxy();
  firm.ensureDeskFields();
  firm.rehydratePaperPortfolio();

  // 4. Inject Cloudflare Workers AI & environment keys into pool
  const envPool = buildPoolFromEnv(env);
  if (env.AI) {
    envPool.unshift({
      id: 'cf-workers-ai',
      provider: 'cloudflare_workers_ai',
      label: 'Cloudflare Workers AI (Edge GPU)',
      model: env.CF_AI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      baseUrl: 'internal://workers-ai',
      key: '',
      enabled: true,
      valid: true,
      weight: 3,
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
  }

  if (envPool.length) {
    mergePoolUsage(store.state, envPool);
    const existingGateways = (store.state.settings.pool?.entries || []).filter((e) => e.provider === 'gateway');
    store.state.settings.pool = {
      entries: [...existingGateways, ...envPool],
      updatedAt: Date.now(),
    };
  }

  // 5. Run AI Director
  let aiResult = null;
  try {
    aiResult = await ai.runAiDirector({ useFallback: true });
  } catch (err) {
    aiResult = { ok: false, reason: err.message };
  }

  // 6. Execute autonomous trading cycles
  const summary = [];
  for (let i = 0; i < cycles; i++) {
    const desk = firm.nextDesk(store.state);
    try {
      const result = await firm.runDeskCycle(desk, { deep: deep && i === 0 });
      store.state.stats.cycles = (store.state.stats.cycles || 0) + 1;
      store.state.lastTickAt = Date.now();
      const cycleLog = {
        id: `cyc_${Date.now()}_${i}`,
        desk_id: desk.id,
        tf: desk.tf,
        strategy_id: desk.strategyId,
        ok: !!result?.ok,
        published: !!result?.published,
        version: desk.version || null,
        oos_return: desk.oosMetrics?.returnPct ?? null,
        robustness: desk.assessment?.robustness ?? null,
        ai_provider: aiResult?.provider || aiResult?.source || null,
        ai_model: aiResult?.model || null,
        created_at: new Date().toISOString(),
      };
      summary.push(cycleLog);
      await handleCloudflareDbRequest('POST', { action: 'record_cycle', record: cycleLog }, env);
    } catch (err) {
      summary.push({ desk_id: desk.id, tf: desk.tf, ok: false, error: err.message });
    }
  }

  // 7. Risk governing, live tick & Nostro fleet
  try { firm.enforceLiveRiskControls(); } catch { /* ignore */ }
  try { await firm.tickLive(); } catch { /* ignore */ }
  try { await firm.promoteDryRuns(); } catch { /* ignore */ }
  try {
    const nostro = await import('../src/nostro.js');
    await nostro.runNostroFleetSimulation({}, { doOptimize: false, forceLive: true, maxBars: 800 });
  } catch { /* ignore */ }
  try { await firm.promoteNostroWinnersToLive(); } catch { /* ignore */ }
  try {
    const gann = await import('../src/gann.js');
    await gann.runAutonomousGannLibraryAuditIfDue();
  } catch { /* ignore */ }

  firm.savePaperPortfolio();
  store.state.updatedAt = new Date().toISOString();
  store.state.remote = {
    updatedAt: store.state.updatedAt,
    source: 'cloudflare-edge-24-7',
    cycles: store.state.stats.cycles || 0,
    desks: store.state.desks.length,
  };
  store.save(true);

  // 8. Persist merged state to Cloudflare D1 / KV / Supabase
  const dbSave = await handleCloudflareDbRequest('POST', { action: 'push_state', state: store.state }, env);

  return {
    ok: true,
    durationMs: Date.now() - started,
    ai: aiResult,
    summary,
    stats: store.state.stats,
    counts: dbSave.counts,
    updatedAt: store.state.updatedAt,
    provider: dbSave.provider,
  };
}
