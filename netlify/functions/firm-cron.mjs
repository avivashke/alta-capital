// Netlify Scheduled Function & API Endpoint: /api/firm-cron (/.netlify/functions/firm-cron)
// Runs every 15 minutes on Netlify (or on-demand from the dashboard) to:
// 1. Load state from the database
// 2. Build the AI Model Pool + Cloudflare Worker proxies
// 3. Run the AI Director to focus optimization & strategy selection
// 4. Execute walk-forward optimization cycles on the trading desks
// 5. Update paper trading positions & promote validated dry-run strategies
// 6. Save all updated state, published versions, trades, and cycle logs to the database

import path from 'node:path';
import { installFileStorage } from '../../runner/localstorage.mjs';
import { handleDbRequest } from './db.mjs';

const STORAGE_KEY = 'alta-capital-firm-v1';

export async function runFirmCronJob({ cycles = 2, deep = false } = {}) {
  const started = Date.now();
  const dataDir = path.resolve(process.cwd(), 'data');
  installFileStorage({
    cacheFile: '/tmp/alta-localstorage.json',
    seedFile: path.join(dataDir, 'state.json'),
    key: STORAGE_KEY,
  });

  const { store } = await import('../../src/store.js');
  const firm = await import('../../src/firm.js');
  const ai = await import('../../src/ai.js');
  const { buildPoolFromEnv, mergePoolUsage } = await import('../../src/keypool.js');
  const { mergeFirmStates } = await import('../../src/state_merge.js');

  store.load();

  // Pull latest state from DB & merge non-destructively
  const pulled = await handleDbRequest('GET', { action: 'pull' });
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

  // Merge environment model pool if configured on Netlify
  const envPool = buildPoolFromEnv(process.env);
  if (envPool.length) {
    mergePoolUsage(store.state, envPool);
    const existingGateways = (store.state.settings.pool?.entries || []).filter((e) => e.provider === 'gateway');
    store.state.settings.pool = {
      entries: [...existingGateways, ...envPool],
      updatedAt: Date.now(),
    };
  }

  let aiResult = null;
  try {
    aiResult = await ai.runAiDirector({ useFallback: true });
  } catch (err) {
    aiResult = { ok: false, reason: err.message };
  }

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
      await handleDbRequest('POST', { action: 'record_cycle', record: cycleLog });
    } catch (err) {
      summary.push({ desk_id: desk.id, tf: desk.tf, ok: false, error: err.message });
    }
  }

  // The risk governor runs before any new position: a bleeding desk is paused and a
  // 12% book drawdown stops the whole live book in the 24/7 path too, not only in a tab.
  try { firm.enforceLiveRiskControls(); } catch { /* ignore */ }
  try { await firm.tickLive(); } catch { /* ignore */ }
  try { await firm.promoteDryRuns(); } catch { /* ignore */ }
  try {
    const nostro = await import('../../src/nostro.js');
    // The base server can afford the full multi-year history; a 10s function cannot.
    const maxBars = process.env.ALTA_BASE_SERVER === '1' ? 0 : 1200;
    await nostro.runNostroFleetSimulation({}, { doOptimize: false, forceLive: true, maxBars });
  } catch { /* ignore */ }
  try { await firm.promoteNostroWinnersToLive(); } catch { /* ignore */ }
  try {
    const gann = await import('../../src/gann.js');
    await gann.runAutonomousGannLibraryAuditIfDue();
  } catch { /* ignore */ }

  firm.savePaperPortfolio();
  store.state.updatedAt = new Date().toISOString();
  store.state.remote = {
    updatedAt: store.state.updatedAt,
    source: process.env.ALTA_BASE_SERVER === '1' ? 'base-server-24-7' : 'netlify-24-7',
    cycles: store.state.stats.cycles || 0,
    desks: store.state.desks.length,
  };
  store.save(true);

  const dbSave = await handleDbRequest('POST', { action: 'push_state', state: store.state });

  return {
    ok: true,
    durationMs: Date.now() - started,
    ai: aiResult,
    summary,
    stats: store.state.stats,
    counts: dbSave.counts,
    updatedAt: store.state.updatedAt,
  };
}

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (event?.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  try {
    const body = event?.body ? JSON.parse(event.body) : {};
    const cycles = Math.max(1, Math.min(5, Number(body.cycles) || 2));
    const res = await runFirmCronJob({ cycles, deep: !!body.deep });
    return { statusCode: 200, headers, body: JSON.stringify(res) };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
