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

export function buildResearchDigest(state) {
  const st = state || {};
  const desks = (st.desks || []).slice(0, 12).map((d) => ({
    desk: d.id,
    timeframe: d.tf,
    strategy: d.strategyId || d.strategy || d.lockedStrategy || null,
    version: d.version ?? null,
    oosReturnPct: d.oosMetrics?.returnPct ?? null,
    oosSharpe: d.oosMetrics?.sharpe ?? null,
    maxDrawdownPct: d.oosMetrics?.maxDrawdownPct ?? d.oosMetrics?.maxDD ?? null,
    robustness: d.assessment?.robustness ?? null,
    verdict: d.assessment?.verdict ?? d.assessment?.label ?? null,
  }));
  const pf = st.paperPortfolio || {};
  const trades = (pf.trades || []).slice(-30);
  const wins = trades.filter((t) => Number(t.pnl ?? t.pnlPct ?? 0) > 0).length;
  return {
    desks,
    portfolio: {
      initialBalance: pf.initialBalance ?? null,
      cash: pf.cash ?? null,
      openPositions: Array.isArray(pf.positions) ? pf.positions.length : (pf.openPositions ?? null),
      totalTrades: pf.totalTradesCount ?? (pf.trades || []).length,
      recentWinRatePct: trades.length ? +((wins / trades.length) * 100).toFixed(1) : null,
    },
    stats: st.stats ? { cycles: st.stats.cycles, backtests: st.stats.backtests, deployments: st.stats.deployments } : null,
    xBias: st.xResearch?.overallBias ?? null,
    whatsappBias: st.whatsappGann?.overallBias ?? null,
  };
}

const SYSTEM = 'אתה ראש מחקר כמותי בחברת מסחר אלגוריתמית. אתה מקבל תקציר ביצועים של שולחנות המסחר והתיק. '
  + 'השתמש רק בנתונים שניתנו, אל תמציא מספרים. המטרה: לשפר רווחיות ולהקטין סיכון. '
  + 'החזר JSON תקין בלבד, בעברית, במבנה: '
  + '{"summary":"2-3 משפטים","findings":[{"desk":"","issue":"","suggestion":""}],'
  + '"parameterIdeas":[{"desk":"","param":"","change":"","reason":""}],'
  + '"riskFlags":["..."],"priorityActions":["..."]}. עד 5 פריטים בכל רשימה.';

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
    if (!digest.desks.length) throw new Error('no desks yet');
    const raw = await askLocalModel(digest);
    const parsed = parseJson(raw);
    if (!parsed) throw new Error('model returned non-JSON');
    const note = {
      summary: String(parsed.summary || '').slice(0, 900),
      findings: (parsed.findings || []).slice(0, 5),
      parameterIdeas: (parsed.parameterIdeas || []).slice(0, 5),
      riskFlags: (parsed.riskFlags || []).slice(0, 5),
      priorityActions: (parsed.priorityActions || []).slice(0, 5),
      digestStats: { desks: digest.desks.length, ...digest.portfolio },
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
