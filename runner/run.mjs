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
const { buildArtifact } = await import('../src/platforms.js');

store.load();
store.state.settings.autopilot = true;
if (process.env.GITHUB_TOKEN) store.state.settings.github.token = process.env.GITHUB_TOKEN;

// Model credentials come from GitHub Secrets, never from the repo.
const llmKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || '';
if (llmKey) {
  store.state.settings.llm = {
    provider: process.env.LLM_PROVIDER || 'openai',
    baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    apiKey: llmKey,
    temperature: Number(process.env.LLM_TEMPERATURE || 0.3),
  };
}
firm.ensureDeskFields();

let aiResult = { ok: false, reason: llmKey ? 'not-run' : 'no-model-key' };
try {
  // Without a model key we deliberately skip the AI step: local rules would keep
  // re-picking the same desk every 15 minutes and churn the strategy families.
  aiResult = await ai.runAiDirector({ useFallback: false });
  console.log(`[runner] AI director: ${aiResult.ok ? aiResult.source : aiResult.reason}`);
  if (aiResult.ok) console.log(`[runner] focus: ${aiResult.plan.focusDesk} · ${aiResult.plan.strategyId} · ${aiResult.plan.rationale}`);
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
  firm.promoteDryRuns();
} catch (err) {
  console.warn('[runner] promotion:', err.message);
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
  if (out.settings?.github) out.settings.github.token = '';
  if (out.settings?.news) out.settings.news.apiKey = '';
  out.advisor = { messages: [] };
  out.updatedAt = new Date().toISOString();
  out.source = 'github-actions';
  out.runner = { cycles, deep, durationMs: Date.now() - started, node: process.version };
  return out;
}

fs.mkdirSync(dataDir, { recursive: true });
const state = sanitize(store.state);
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
      ? { source: aiResult.source, focusDesk: aiResult.plan.focusDesk, strategyId: aiResult.plan.strategyId, rationale: aiResult.plan.rationale }
      : { ok: false, reason: aiResult?.reason },
  }, null, 1),
);

const okCount = summary.filter((s) => s.ok).length;
console.log(`[runner] ${okCount}/${summary.length} cycles ok · ${state.stats.cycles} total cycles · ${state.stats.deployments} published versions`);
console.table(summary.map((s) => ({ desk: s.desk, tf: s.timeframe, ok: s.ok, published: s.published, version: s.version, oos: s.oos, robustness: s.robustness })));
process.exit(0);
