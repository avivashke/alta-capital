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
const { buildArtifact } = await import('../src/platforms.js');

store.load();
store.state.settings.autopilot = true;
if (process.env.GITHUB_TOKEN) store.state.settings.github.token = process.env.GITHUB_TOKEN;
firm.ensureDeskFields();

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
  JSON.stringify({ at: state.updatedAt, summary, stats: state.stats, runner: state.runner }, null, 1),
);

const okCount = summary.filter((s) => s.ok).length;
console.log(`[runner] ${okCount}/${summary.length} cycles ok · ${state.stats.cycles} total cycles · ${state.stats.deployments} published versions`);
console.table(summary.map((s) => ({ desk: s.desk, tf: s.timeframe, ok: s.ok, published: s.published, version: s.version, oos: s.oos, robustness: s.robustness })));
process.exit(0);
