// Cloudflare AI Research Analyst: runs on Workers AI (edge GPU, no key) and stores notes in D1.
// Shares its digest/prompt/normalisation logic with the local Base Server (src/research_digest.js).
import { handleCloudflareDbRequest } from './db.js';
import { buildResearchDigest, buildSystemPrompt, parseJson, normalizeNote } from '../src/research_digest.js';

const KEEP = 40;
const MIN_GAP_MS = 5 * 60 * 1000; // protects the Workers AI quota from spam on the public endpoint
const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
let lastRun = { at: 0, ok: null, error: null, ms: 0 };

async function ensureTable(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS ai_research (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, model TEXT, data TEXT NOT NULL)').run();
}

export async function getResearchNotesCf(env, limit = 10) {
  if (!env?.DB) return { ok: false, reason: 'no-d1', notes: [] };
  await ensureTable(env.DB);
  const rows = await env.DB.prepare('SELECT id, created_at, model, data FROM ai_research ORDER BY id DESC LIMIT ?').bind(Math.min(40, Number(limit) || 10)).all();
  return {
    ok: true,
    model: env.CF_AI_MODEL || DEFAULT_MODEL,
    intervalMin: 60,
    running: false,
    lastRun,
    notes: (rows.results || []).map((r) => ({ id: r.id, createdAt: r.created_at, model: r.model, ...JSON.parse(r.data) })),
  };
}

export async function runResearchPassCf(env, { force = false } = {}) {
  if (!env?.DB) return { ok: false, reason: 'no-d1' };
  if (!env?.AI) return { ok: false, reason: 'no-workers-ai' };
  const t0 = Date.now();
  try {
    await ensureTable(env.DB);
    if (!force) {
      const last = await env.DB.prepare('SELECT created_at FROM ai_research ORDER BY id DESC LIMIT 1').first();
      if (last && t0 - Date.parse(last.created_at) < MIN_GAP_MS) return { ok: true, cached: true, reason: 'ran less than 5 minutes ago' };
    }
    const pulled = await handleCloudflareDbRequest('GET', { action: 'pull' }, env);
    const digest = buildResearchDigest(pulled?.state);
    if (!digest.totals.desks) throw new Error('no desks with metrics yet');
    const model = env.CF_AI_MODEL || DEFAULT_MODEL;
    const result = await env.AI.run(model, {
      messages: [
        { role: 'system', content: buildSystemPrompt('he') },
        { role: 'user', content: `תקציר נתונים:\n${JSON.stringify(digest)}` },
      ],
      max_tokens: 900,
      temperature: 0.2,
      stream: false,
    });
    const raw = result?.response ?? result?.text ?? result?.choices?.[0]?.message?.content ?? '';
    const parsed = typeof raw === 'object' ? raw : parseJson(raw);
    if (!parsed) throw new Error('model returned non-JSON');
    const note = normalizeNote(parsed, digest);
    await env.DB.prepare('INSERT INTO ai_research (created_at, model, data) VALUES (?, ?, ?)').bind(new Date().toISOString(), model, JSON.stringify(note)).run();
    await env.DB.prepare(`DELETE FROM ai_research WHERE id NOT IN (SELECT id FROM ai_research ORDER BY id DESC LIMIT ${KEEP})`).run();
    lastRun = { at: Date.now(), ok: true, error: null, ms: Date.now() - t0 };
    return { ok: true, note };
  } catch (err) {
    lastRun = { at: Date.now(), ok: false, error: err.message, ms: Date.now() - t0 };
    return { ok: false, reason: err.message };
  }
}