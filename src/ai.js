// AI director: turns the model into a member of the investment committee.
// It does not compute numbers — it reads the firm digest, picks the desk to focus on,
// proposes a strategy family and a narrowed parameter range for the next optimization cycle.

import { store } from './store.js';
import { STRATEGY_IDS, STRATEGIES } from './strategies.js';
import { chatDetailed, hasModelKey } from './llm.js';

const SYSTEM = `אתה סמנכ"ל ההשקעות של Alta Capital, חברת השקעות שמנוהלת על ידי סוכנים.
אתה מקבל נתוני בקטסט, חלונות walk-forward, Monte Carlo, ניתוח טכני והיסטוריית גרסאות.
תפקידך: לבחור על איזה שולחן להתמקד עכשיו, איזו משפחת אסטרטגיה לנסות, ואיזה טווח פרמטרים יצמצם את החיפוש.

כללים:
- החזר JSON תקין בלבד, בלי טקסט מסביב ובלי code fences.
- אל תמציא מספרים. השתמש רק במה שמופיע בנתונים.
- אל תבטיח תשואות. זו עבודת מחקר ובקטסט.
- אם שולחן כבר חזק ויציב (חוסן גבוה, OOS חיובי), אל תבזבז עליו את המחזור — התמקד בשולחן חלש.
- אם ה-OOS שלילי אבל החלונות מעורבים, הצע משפחה אחרת עם פחות פרמטרים.
- rationale ו-nextActions בעברית, קצרים ומעשיים.`;

function deskSummary(desk) {
  const m = desk.metrics;
  const a = desk.assessment;
  return {
    id: desk.id,
    timeframe: desk.tf,
    kind: desk.kind,
    symbol: desk.symbol,
    status: desk.status,
    version: desk.version,
    strategy: desk.strategyId,
    params: desk.params,
    inSampleReturnPct: desk.isMetrics?.returnPct ?? null,
    outOfSampleReturnPct: desk.oosMetrics?.returnPct ?? null,
    bestReturnPct: desk.bestReturn,
    fullReturnPct: m?.returnPct ?? null,
    profitFactor: m?.profitFactor ?? null,
    trades: m?.trades ?? null,
    maxDrawdownPct: m?.maxDrawdownPct ?? null,
    sharpe: m?.sharpe ?? null,
    robustness: a?.robustness ?? desk.robustness ?? null,
    foldReturns: a?.walkForward?.folds?.map((f) => f.returnPct) ?? [],
    monteCarlo: a?.monteCarlo?.available ? {
      probProfit: a.monteCarlo.probProfit,
      p05: a.monteCarlo.p05,
      ddP95: a.monteCarlo.ddP95,
    } : null,
    technical: desk.technical ? {
      bias: desk.technical.biasLabel,
      confidence: desk.technical.confidence,
      trend: desk.technical.trend?.label,
      rsi: desk.technical.momentum?.rsi,
      volatility: desk.technical.volatility?.regime,
    } : null,
    versions: desk.history.slice(0, 4).map((h) => ({ version: h.version, oos: h.oosReturn, robustness: h.robustness })),
  };
}

export function buildPrompt(state = store.state) {
  const allowed = Object.fromEntries(STRATEGY_IDS.map((id) => [id, Object.fromEntries(
    Object.entries(STRATEGIES[id].space).map(([k, spec]) => [
      k,
      spec.type === 'bool' ? 'bool' : [spec.min, spec.max],
    ]),
  )]));
  return `מצב החברה (JSON):
${JSON.stringify({
    capital: state.settings.capital,
    riskPerTrade: state.settings.riskPerTrade,
    thresholds: {
      promotionDeltaPct: state.settings.promotionDelta,
      minRobustness: state.settings.minRobustness,
      minProfitFactor: state.settings.minProfitFactor,
      minTrades: state.settings.minTrades,
    },
    platform: state.settings.platform,
    desks: state.desks.map(deskSummary),
    recentEvents: state.events.slice(0, 8).map((e) => e.text),
  }, null, 2)}

משפחות האסטרטגיה המותרות והטווחים שלהן:
${JSON.stringify(allowed, null, 2)}

החזר JSON עם הסכימה הזו בדיוק:
{
  "focusDesk": "<אחד מה-id של השולחנות>",
  "strategyId": "<אחד ממשפחות האסטרטגיה>",
  "paramBias": { "<שם פרמטר>": [min, max] },
  "rationale": "משפט אחד שמסביר למה זה הצעד הנכון עכשיו",
  "review": { "verdict": "הערכה קצרה של מצב התיק", "risks": ["סיכון 1", "סיכון 2"], "watch": ["מה לעקוב אחריו"] },
  "nextActions": ["פעולה 1", "פעולה 2", "פעולה 3"]
}`;
}

export function parseJsonReply(text) {
  if (!text) return null;
  let cleaned = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === '{') depth++;
    else if (cleaned[i] === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function pickFocusDesk(desks) {
  const scored = [...desks].sort((a, b) => {
    const ra = a.assessment?.robustness ?? a.robustness ?? -1;
    const rb = b.assessment?.robustness ?? b.robustness ?? -1;
    return ra - rb;
  });
  return scored[0] || desks[0];
}

export function sanitizePlan(raw, state = store.state) {
  const desks = state.desks;
  const focus = desks.find((d) => d.id === raw?.focusDesk) || pickFocusDesk(desks);
  const strategyId = STRATEGY_IDS.includes(raw?.strategyId) ? raw.strategyId : (focus.strategyId || 'ema_trend');
  const space = STRATEGIES[strategyId].space;
  const paramBias = {};

  if (raw?.paramBias && typeof raw.paramBias === 'object') {
    for (const [key, range] of Object.entries(raw.paramBias)) {
      const spec = space[key];
      if (!spec || spec.type === 'bool' || !Array.isArray(range) || range.length !== 2) continue;
      const a = Number(range[0]);
      const b = Number(range[1]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const lo = Math.max(spec.min, Math.min(a, b));
      const hi = Math.min(spec.max, Math.max(a, b));
      if (hi - lo < (spec.type === 'int' ? 2 : 0.05)) continue;
      paramBias[key] = spec.type === 'int'
        ? [Math.round(lo), Math.round(hi)]
        : [+lo.toFixed(2), +hi.toFixed(2)];
    }
  }

  const review = raw?.review && typeof raw.review === 'object' ? {
    verdict: String(raw.review.verdict || '').slice(0, 300),
    risks: Array.isArray(raw.review.risks) ? raw.review.risks.slice(0, 4).map((r) => String(r).slice(0, 160)) : [],
    watch: Array.isArray(raw.review.watch) ? raw.review.watch.slice(0, 4).map((r) => String(r).slice(0, 160)) : [],
  } : null;

  return {
    focusDesk: focus.id,
    strategyId,
    paramBias,
    rationale: String(raw?.rationale || '').slice(0, 400),
    review,
    nextActions: Array.isArray(raw?.nextActions)
      ? raw.nextActions.slice(0, 4).map((a) => String(a).slice(0, 200))
      : [],
  };
}

export function applyPlan(plan, { source = 'model', model = null } = {}) {
  const state = store.state;
  const desk = state.desks.find((d) => d.id === plan.focusDesk);
  if (!desk) return null;
  desk.aiPlan = {
    strategyId: plan.strategyId,
    paramBias: plan.paramBias,
    rationale: plan.rationale,
    at: Date.now(),
    consumed: false,
  };
  desk.aiReview = plan.review ? { ...plan.review, at: Date.now() } : desk.aiReview;
  state.aiDirector = {
    at: Date.now(),
    source,
    model,
    focusDesk: desk.id,
    focusLabel: desk.label,
    plan,
  };
  store.log(
    'info',
    'אוריה · CIO',
    `החלטת AI: להתמקד ב-${desk.label} · ${STRATEGIES[plan.strategyId]?.label || plan.strategyId}${plan.rationale ? ' — ' + plan.rationale.slice(0, 110) : ''}`,
  );
  store.save();
  store.emit();
  return desk;
}

export function localPlan(state = store.state) {
  const desks = state.desks;
  const focus = [...desks].sort((a, b) => {
    const ra = a.assessment?.robustness ?? a.robustness ?? -1;
    const rb = b.assessment?.robustness ?? b.robustness ?? -1;
    return ra - rb;
  })[0];
  const alternatives = ['breakout', 'momentum', 'ema_trend', 'rsi_reversion', 'macd_swing']
    .filter((s) => s !== focus?.strategyId);
  return sanitizePlan({
    focusDesk: focus?.id,
    strategyId: alternatives[0] || focus?.strategyId,
    rationale: 'בחירה מקומית: השולחן עם החוסן הנמוך ביותר עובר למשפחה חלופית עם פחות פרמטרים.',
    review: {
      verdict: 'מצב התיק נבדק בכללים מקומיים (ללא מודל).',
      risks: ['ייתכנו overfitting בפרמטרים', 'פער בין בקטסט לנייר חי'],
      watch: ['חוסן מתחת לסף', 'drawdown עולה'],
    },
    nextActions: ['להריץ מחזור על השולחן החלש', 'לבדוק dry-run של הגרסאות החדשות'],
  }, state);
}

export async function runAiDirector({ useFallback = false } = {}) {
  const state = store.state;
  if (!hasModelKey()) {
    if (!useFallback) return { ok: false, reason: 'no-model-key' };
    const plan = localPlan(state);
    applyPlan(plan, { source: 'local-rules' });
    return { ok: true, source: 'local-rules', plan };
  }
  let reply;
  let used = null;
  try {
    used = await chatDetailed({ system: SYSTEM, messages: [{ role: 'user', content: buildPrompt(state) }], maxTokens: 900 });
    reply = used.text;
  } catch (err) {
    if (!useFallback) return { ok: false, reason: err.message };
    const plan = localPlan(state);
    applyPlan(plan, { source: 'local-rules' });
    return { ok: true, source: 'local-rules', plan, error: err.message };
  }
  const parsed = parseJsonReply(reply);
  if (!parsed) {
    if (!useFallback) return { ok: false, reason: 'invalid-json', raw: String(reply).slice(0, 200) };
    const plan = localPlan(state);
    applyPlan(plan, { source: 'local-rules' });
    return { ok: true, source: 'local-rules', plan, error: 'invalid-json' };
  }
  const plan = sanitizePlan(parsed, state);
  const model = used ? `${used.provider}/${used.model}` : null;
  const desk = applyPlan(plan, { source: 'model', model });
  return {
    ok: true,
    source: 'model',
    plan,
    desk: desk?.id,
    provider: used?.provider || null,
    model: used?.model || null,
    attempts: used?.attempts || [],
  };
}
