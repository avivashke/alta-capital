#!/usr/bin/env node
/**
 * Alta Capital — 24/7 firm runner.
 *
 * Runs the exact engine the dashboard uses (src/*.js), writes backtests,
 * version bumps, technical readouts and paper positions, then publishes:
 *   data/state.json      sanitized firm state the dashboard loads
 *   data/context.json    research context (safe to commit)
 *   data/last-run.json   run summary
 *   strategies/*.py|.json  code artifacts for the newest version of each desk
 *
 * Usage: node runner/run.mjs --cycles=5 [--deep]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFileStorage } from './localstorage.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const strategiesDir = path.join(root, 'strategies');
const stateFile = path.join(dataDir, 'state.json');
const cacheFile = path.join(dataDir, '.localstorage.json');
const STORAGE_KEY = 'alta-capital-firm-v1';

installFileStorage({ cacheFile, seedFile: stateFile, key: STORAGE_KEY });

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const cycles = Math.max(1, Math.min(20, Number(readArg('cycles', 5)) || 5));
const deep = args.includes('--deep');

const { store } = await import('../src/store.js');
const firm = await import('../src/firm.js');
const research = await import('../src/research.js');
const ai = await import('../src/ai.js');
const { buildPoolFromEnv, mergePoolUsage } = await import('../src/keypool.js');
const { buildArtifact } = await import('../src/platforms.js');
const { pullFromDatabase, pushStateToDatabase, dbState } = await import('../src/db.js');
const { mergeFirmStates } = await import('../src/state_merge.js');

store.load();

// Sync from Supabase / Cloud API / Base Server before running so GitHub Actions never diverges
try {
  const pulled = await pullFromDatabase();
  if (pulled?.ok && pulled.state && Array.isArray(pulled.state.desks) && pulled.state.desks.length) {
    const merged = mergeFirmStates(store.state, pulled.state);
    store.state = {
      ...store.state,
      ...merged,
      settings: { ...store.state.settings, ...(merged.settings || {}) },
    };
    store.markReloaded();
    console.log(`[runner] synced state from ${pulled.provider} (cycles=${store.state.stats?.cycles || 0}, trades=${store.state.paperPortfolio?.totalTradesCount || store.state.paperPortfolio?.trades?.length || 0})`);
  }
} catch (err) {
  console.warn('[runner] cloud pre-sync skipped:', err.message);
}

store.state.settings.autopilot = true;
if (process.env.GITHUB_TOKEN) store.state.settings.github.token = process.env.GITHUB_TOKEN;

// Model credentials come from GitHub Secrets, never from the repo.
// Every provider key found in the environment joins one pool, so free tiers stack.
const { discoverLocalAiModels, syncLocalModelsToPool } = await import('../src/local_ai.js');
const envPool = buildPoolFromEnv(process.env);
const llmKey = process.env.LLM_API_KEY || '';
if (envPool.length) {
  // Carry yesterday's counters/cooldowns over so rotation continues across runs.
  mergePoolUsage(store.state, envPool);
  store.state.settings.pool = { entries: envPool, updatedAt: Date.now() };
  console.log(`[runner] model pool: ${envPool.map((e) => `${e.label}/${e.model}`).join(' · ')}`);
} else {
  // Never reuse keys persisted by an earlier local run; CI must use secrets only.
  store.state.settings.pool = { entries: [], updatedAt: Date.now() };
}
// Auto-attach free local machine models (Ollama / LM Studio) if running on this host!
try {
  const localFound = await discoverLocalAiModels();
  if (localFound.ok && localFound.models.length) {
    const synced = syncLocalModelsToPool(store.state, localFound.models);
    console.log(`[runner] local compute AI attached: ${localFound.models.map((m) => m.model).join(', ')} (+${synced.addedCount} in pool)`);
  }
} catch { /* ignore if no local engine running */ }
if (llmKey) {
  store.state.settings.llm = {
    provider: process.env.LLM_PROVIDER || 'openai',
    baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    apiKey: llmKey,
    temperature: Number(process.env.LLM_TEMPERATURE || 0.3),
  };
} else if (store.state.settings.llm) {
  store.state.settings.llm.apiKey = '';
}
firm.ensureDeskFields();
firm.rehydratePaperPortfolio();

let aiResult = { ok: false, reason: (llmKey || envPool.length) ? 'not-run' : 'no-model-key' };
try {
  // Without a model key we deliberately skip the AI step: local rules would keep
  // re-picking the same desk every 15 minutes and churn the strategy families.
  aiResult = await ai.runAiDirector({ useFallback: false });
  console.log(`[runner] AI director: ${aiResult.ok ? aiResult.source : aiResult.reason}`);
  if (aiResult.ok) {
    console.log(`[runner] focus: ${aiResult.plan.focusDesk} · ${aiResult.plan.strategyId} · ${aiResult.plan.rationale}`);
    if (aiResult.provider) console.log(`[runner] answered by ${aiResult.entryLabel || aiResult.provider}/${aiResult.model}`);
    for (const attempt of aiResult.attempts || []) console.log(`[runner] fallback from ${attempt.provider}: ${attempt.error}`);
  }
} catch (err) {
  console.warn('[runner] AI director failed:', err.message);
  aiResult = { ok: false, reason: err.message };
}

const started = Date.now();
const summary = [];

for (let i = 0; i < cycles; i++) {
  const desk = firm.nextDesk(store.state);
  try {
    const result = await firm.runDeskCycle(desk, { deep: deep && i === 0 });
    store.state.stats.cycles = (store.state.stats.cycles || 0) + 1;
    store.state.lastTickAt = Date.now();
    summary.push({
      desk: desk.id,
      timeframe: desk.tf,
      ok: !!result?.ok,
      published: !!result?.published,
      version: desk.version || null,
      oos: desk.oosMetrics?.returnPct ?? null,
      robustness: desk.assessment?.robustness ?? null,
    });
  } catch (err) {
    summary.push({ desk: desk.id, timeframe: desk.tf, ok: false, error: err.message });
    console.error('[runner] desk failed', desk.id, err);
  }
}

try {
  await firm.tickLive();
} catch (err) {
  console.warn('[runner] paper execution:', err.message);
}
try {
  await firm.promoteDryRuns();
} catch (err) {
  console.warn('[runner] promotion:', err.message);
}
try {
  firm.savePaperPortfolio();
} catch (err) {
  console.warn('[runner] paper portfolio save:', err.message);
}
try {
  const { runNostroFleetSimulation, autoEnrollPassedNostroBots, tickNostroTradingRoom } = await import('../src/nostro.js');
  const nostroAgeMs = Date.now() - (store.state.nostro?.updatedAt || 0);
  if (!(store.state.nostro?.bots?.length) || nostroAgeMs > 6 * 3600_000) {
    await runNostroFleetSimulation({}, { doOptimize: false, forceLive: true });
  }
  autoEnrollPassedNostroBots(store.state);
  const nRes = await tickNostroTradingRoom({ state: store.state });
  if (nRes?.accounts) console.log(`[runner] Nostro trading room: ${nRes.updated}/${nRes.accounts} accounts ticked (${nRes.tradesMoved || 0} trade moves)`);
} catch (err) {
  console.warn('[runner] nostro room:', err.message);
}
try {
  const { auditSystemTruth } = await import('../src/auditor.js');
  const { marketState } = await import('../src/market.js');
  store.state.truthAudit = auditSystemTruth(store.state, marketState);
  console.log(`[runner] Amir truth audit: ${store.state.truthAudit.score}/100 (${store.state.truthAudit.status})`);
} catch (err) {
  console.warn('[runner] truth audit:', err.message);
}
try {
  await firm.refreshTechnicals({ force: true });
} catch (err) {
  console.warn('[runner] technical analysis:', err.message);
}
try {
  await research.scanIfDue();
} catch (err) {
  console.warn('[runner] research scan:', err.message);
}
try {
  await research.refreshSentiment();
} catch (err) {
  console.warn('[runner] sentiment:', err.message);
}

fs.mkdirSync(strategiesDir, { recursive: true });
for (const desk of store.state.desks) {
  if (!desk.version || !desk.params) continue;
  try {
    const artifact = buildArtifact(desk, store.state.settings.platform);
    fs.writeFileSync(path.join(strategiesDir, artifact.filename), artifact.code);
  } catch (err) {
    console.warn('[runner] artifact failed', desk.id, err.message);
  }
}

function sanitize(state) {
  const out = JSON.parse(JSON.stringify(state));
  if (out.settings?.llm) out.settings.llm.apiKey = '';
  for (const entry of out.settings?.pool?.entries || []) entry.key = '';
  if (out.settings?.github) out.settings.github.token = '';
  if (out.settings?.news) out.settings.news.apiKey = '';
  if (out.settings?.db) {
    out.settings.db.supabaseKey = '';
    out.settings.db.workerDbKey = '';
    out.settings.db.baseServerToken = '';
    out.settings.db.netlifyToken = '';
  }
  out.advisor = { messages: [] };
  out.updatedAt = new Date().toISOString();
  out.source = 'github-actions';
  out.runner = { cycles, deep, durationMs: Date.now() - started, node: process.version };
  return out;
}

fs.mkdirSync(dataDir, { recursive: true });
let state = sanitize(store.state);

// Push merged state to Supabase / Cloud API / Base Server so all devices see GitHub Actions progress immediately
try {
  dbState.initialSyncDone = true;
  const pushRes = await pushStateToDatabase(state);
  if (pushRes?.ok) {
    console.log(`[runner] pushed state to ${pushRes.provider}`);
    if (pushRes.state && Array.isArray(pushRes.state.desks)) {
      state = sanitize(mergeFirmStates(state, pushRes.state));
    }
  }
} catch (err) {
  console.warn('[runner] cloud post-sync skipped:', err.message);
}

fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
fs.writeFileSync(path.join(dataDir, 'context.json'), JSON.stringify(research.buildContextDocument(), null, 1));
fs.writeFileSync(
  path.join(dataDir, 'last-run.json'),
  JSON.stringify({
    at: state.updatedAt,
    summary,
    stats: state.stats,
    runner: state.runner,
    ai: aiResult?.ok
      ? {
        source: aiResult.source,
        focusDesk: aiResult.plan.focusDesk,
        strategyId: aiResult.plan.strategyId,
        rationale: aiResult.plan.rationale,
        provider: aiResult.provider || null,
        model: aiResult.model || null,
        accountId: aiResult.accountId || null,
        fallbacks: (aiResult.attempts || []).map((a) => a.provider),
      }
      : { ok: false, reason: aiResult?.reason },
  }, null, 1),
);

const okCount = summary.filter((s) => s.ok).length;
console.log(`[runner] ${okCount}/${summary.length} cycles ok · ${state.stats.cycles} total cycles · ${state.stats.deployments} published versions`);
console.table(summary.map((s) => ({ desk: s.desk, tf: s.timeframe, ok: s.ok, published: s.published, version: s.version, oos: s.oos, robustness: s.robustness })));
process.exit(0);
