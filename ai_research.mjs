// Autonomous AI Research Analyst (runs on the Base Server, uses the local Ollama compute).
// Every few minutes it studies the firm's desks + paper portfolio, asks the local model for
// findings / parameter ideas / risk flags aimed at improving profit, and stores the notes in
// the local SQLite DB so the whole team (and the UI) can read them.
import { readDbFile, getSqlDb, isLocalSql } from './netlify/functions/db.mjs';

const OLLAMA = () => (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const MODEL = () => process.env.OLLAMA_RESEARCH_MODEL || 'qwen2.5:3b';
const INTERVAL_MIN = () => Math.max(2, Number(process.env.AI_RESEARCH_INTERVAL_MIN) || 10);
const KEEP = 40;

let running = false;
let lastRun = { at: 0, ok: null, error: null, ms: 0 };

function ensureTable() {
  if (!isLocalSql()) return null;
  const d = getSqlDb();
  d.exec(`CREATE TABLE IF NOT EXISTS ai_research (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    model TEXT,
    kind TEXT DEFAULT 'pass',
    data TEXT NOT NULL);`);
  return d;
}

const r1 = (v) => (Number.isFinite(Number(v)) ? +Number(v).toFixed(2) : null);
const toArr = (x) => {
  if (Array.isArray(x)) return x.map((i) => (typeof i === 'string' ? i : JSON.stringify(i))).map((s) => s.trim()).filter(Boolean).slice(0, 5);
  if (typeof x === 'string') return x.split(/\n|(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 3).slice(0, 5);
  return [];
};

export function buildResearchDigest(state) {
  const st = state || {};
  const all = (st.desks || []).filter((d) => d && d.metrics);
  const row = (d) => ({
    desk: d.id,
    symbol: d.symbol,
    tf: d.tf,
    strategy: d.aiPlan?.strategyId || d.strategyId || null,
    status: d.status,
    oosReturnPct: r1(d.metrics?.returnPct),
    isReturnPct: r1(d.isMetrics?.returnPct),
    maxDDPct: r1(d.metrics?.maxDrawdownPct),
    sharpe: r1(d.metrics?.sharpe),
    profitFactor: r1(d.metrics?.profitFactor),
    winRatePct: r1(d.metrics?.winRate),
    trades: d.metrics?.trades ?? null,
    vetoed: !!d.lastAudit?.vetoed,
    vetoReason: d.lastAudit?.vetoReasons?.[0] || null,
  });
  const ranked = [...all].sort((a, b) => (Number(b.metrics?.returnPct) || 0) - (Number(a.metrics?.returnPct) || 0));
  const avg = (arr) => (arr.length ? r1(arr.reduce((s, v) => s + v, 0) / arr.length) : null);
  const oos = all.map((d) => Number(d.metrics.returnPct)).filter(Number.isFinite);
  const veto = all.filter((d) => d.lastAudit?.vetoed).length;
  const byStrategy = {};
  for (const d of all) {
    const k = d.aiPlan?.strategyId || 'unknown';
    (byStrategy[k] = byStrategy[k] || []).push(Number(d.metrics.returnPct) || 0);
  }
  const strategyAvg = Object.entries(byStrategy)
    .map(([k, v]) => ({ strategy: k, desks: v.length, avgOosReturnPct: avg(v) }))
    .sort((a, b) => b.avgOosReturnPct - a.avgOosReturnPct).slice(0, 8);
  const pf = st.paperPortfolio || {};
  const eq = (pf.equityHistory || []).slice(-1)[0];
  return {
    totals: { desks: all.length, vetoedByAuditor: veto, avgOosReturnPct: avg(oos), positiveOosDesks: oos.filter((v) => v > 0).length },
    bestDesks: ranked.slice(0, 5).map(row),
    worstDesks: ranked.slice(-4).map(row),
    strategyAverages: strategyAvg,
    portfolio: {
      initialBalance: pf.initialBalance ?? null,
      cash: r1(pf.cash),
      openPositions: Array.isArray(pf.positions) ? pf.positions.length : null,
      totalTrades: pf.totalTradesCount ?? (pf.trades || []).length,
      realizedPnl: r1(pf.realizedPnLAccumulated),
      feesPaid: r1(pf.totalFeesAccumulated),
      lastEquity: typeof eq === 'number' ? r1(eq) : (eq?.equity ?? eq?.value ?? null),
    },
    bias: { x: st.xResearch?.overallBias ?? null, whatsapp: st.whatsappGann?.overallBias ?? null },
  };
}

const SYSTEM = 'You are the head of quantitative research at an algorithmic trading firm. You receive precomputed facts about trading desks '
  + '(out-of-sample vs in-sample returns, drawdown, auditor vetoes) and a paper portfolio. Use ONLY the given numbers; never invent data. '
  + 'Goal: raise profitability and cut risk. Watch for overfitting (isReturnPct much higher than oosReturnPct), desks vetoed by the auditor, and strategy families that underperform. '
  + 'Reply with valid JSON only, in English, short and concrete: '
  + '{"summary":"2-3 sentences","findings":[{"desk":"id","issue":"...","suggestion":"..."}],'
  + '"parameterIdeas":[{"desk":"id","param":"name","change":"e.g. atrStop 1.9->2.4","reason":"..."}],'
  + '"riskFlags":["..."],"priorityActions":["..."]}. At most 4 items per list.';

function parseJson(text) {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
async function askLocalModel(digest) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 180_000);
  try {
    const res = await fetch(`${OLLAMA()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL(),
        temperature: 0.2,
        max_tokens: 700,
        stream: false,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `תקציר נתונים:\n${JSON.stringify(digest)}` },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const j = await res.json();
    return j?.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

export async function runResearchPass() {
  if (running) return { ok: false, reason: 'busy' };
  const d = ensureTable();
  if (!d) return { ok: false, reason: 'local-sql-disabled' };
  running = true;
  const t0 = Date.now();
  try {
    const digest = buildResearchDigest(readDbFile().state);
    if (!digest.totals.desks) throw new Error('no desks with metrics yet');
    const raw = await askLocalModel(digest);
    const parsed = parseJson(raw);
    if (!parsed) throw new Error('model returned non-JSON');
    const note = {
      summary: String(parsed.summary || '').slice(0, 900),
      findings: (Array.isArray(parsed.findings) ? parsed.findings : []).filter((x) => x && typeof x === 'object').slice(0, 5),
      parameterIdeas: (Array.isArray(parsed.parameterIdeas) ? parsed.parameterIdeas : []).filter((x) => x && typeof x === 'object').slice(0, 5),
      riskFlags: toArr(parsed.riskFlags),
      priorityActions: toArr(parsed.priorityActions),
      digestStats: { ...digest.totals, ...digest.portfolio },
    };
    d.prepare('INSERT INTO ai_research (created_at, model, data) VALUES (?,?,?)')
      .run(new Date().toISOString(), MODEL(), JSON.stringify(note));
    d.exec(`DELETE FROM ai_research WHERE id NOT IN (SELECT id FROM ai_research ORDER BY id DESC LIMIT ${KEEP})`);
    lastRun = { at: Date.now(), ok: true, error: null, ms: Date.now() - t0 };
    return { ok: true, note };
  } catch (err) {
    lastRun = { at: Date.now(), ok: false, error: err.message, ms: Date.now() - t0 };
    return { ok: false, reason: err.message };
  } finally {
    running = false;
  }
}

export function getResearchNotes(limit = 10) {
  const d = ensureTable();
  if (!d) return { ok: false, reason: 'local-sql-disabled', notes: [] };
  const rows = d.prepare('SELECT id, created_at, model, data FROM ai_research ORDER BY id DESC LIMIT ?').all(Math.min(40, limit));
  return {
    ok: true,
    model: MODEL(),
    intervalMin: INTERVAL_MIN(),
    running,
    lastRun,
    notes: rows.map((r) => ({ id: r.id, createdAt: r.created_at, model: r.model, ...JSON.parse(r.data) })),
  };
}

export function startResearchWorker() {
  if (!isLocalSql()) return;
  ensureTable();
  const loop = () => { runResearchPass().catch(() => {}); };
  setTimeout(loop, 60_000);
  setInterval(loop, INTERVAL_MIN() * 60_000);
  console.log(`  AI Research Analyst: ON (local ${MODEL()}, every ${INTERVAL_MIN()}m)`);
}
