// Autonomous AI Research Analyst (runs on the Base Server, uses the local Ollama compute).
// Every few minutes it studies the firm's desks + paper portfolio, asks the local model for
// findings / parameter ideas / risk flags aimed at improving profit, and stores the notes in
// the local SQLite DB so the whole team (and the UI) can read them.
import { readDbFile, getSqlDb, isLocalSql } from './netlify/functions/db.mjs';
import { buildResearchDigest, buildSystemPrompt, parseJson, normalizeNote } from './src/research_digest.js';

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
          { role: 'system', content: buildSystemPrompt('en') },
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
    const note = normalizeNote(parsed, digest);
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
