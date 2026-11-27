// Shared, runtime-neutral logic of the AI research analyst (Node Base Server AND Cloudflare Worker).
const r1 = (v) => (Number.isFinite(Number(v)) ? +Number(v).toFixed(2) : null);

export const toArr = (x) => {
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
    overfitGapPct: r1((Number(d.isMetrics?.returnPct) || 0) - (Number(d.metrics?.returnPct) || 0)),
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
  const byStrategy = {};
  for (const d of all) {
    const k = d.aiPlan?.strategyId || 'unknown';
    (byStrategy[k] = byStrategy[k] || []).push(Number(d.metrics.returnPct) || 0);
  }
  const strategyAverages = Object.entries(byStrategy)
    .map(([k, v]) => ({ strategy: k, desks: v.length, avgOosReturnPct: avg(v) }))
    .sort((a, b) => b.avgOosReturnPct - a.avgOosReturnPct).slice(0, 8);
  const overfit = all.filter((d) => (Number(d.isMetrics?.returnPct) || 0) - (Number(d.metrics?.returnPct) || 0) > 25).length;
  const pf = st.paperPortfolio || {};
  return {
    totals: {
      desks: all.length,
      vetoedByAuditor: all.filter((d) => d.lastAudit?.vetoed).length,
      avgOosReturnPct: avg(oos),
      positiveOosDesks: oos.filter((v) => v > 0).length,
      desksWithLargeOverfitGap: overfit,
    },
    bestDesks: ranked.slice(0, 5).map(row),
    worstDesks: ranked.slice(-4).map(row),
    strategyAverages,
    portfolio: {
      initialBalance: pf.initialBalance ?? null,
      cash: r1(pf.cash),
      openPositions: Array.isArray(pf.positions) ? pf.positions.length : null,
      totalTrades: pf.totalTradesCount ?? (pf.trades || []).length,
      realizedPnl: r1(pf.realizedPnLAccumulated),
      feesPaid: r1(pf.totalFeesAccumulated),
    },
    bias: { x: st.xResearch?.overallBias ?? null, whatsapp: st.whatsappGann?.overallBias ?? null },
  };
}

/** lang: 'en' (small local models write English reliably) | 'he' (large cloud models). */
export function buildSystemPrompt(lang = 'en') {
  const schema = '{"summary":"2-3 sentences","findings":[{"desk":"id","issue":"...","suggestion":"..."}],'
    + '"parameterIdeas":[{"desk":"id","param":"name","change":"e.g. atrStop 1.9->2.4","reason":"..."}],'
    + '"riskFlags":["..."],"priorityActions":["..."]}';
  const rules = 'Use ONLY the given numbers; never invent data. overfitGapPct = in-sample return minus out-of-sample return: a large positive gap means overfitting, a negative gap is healthy. '
    + 'Goal: raise profitability and cut risk. Consider desks vetoed by the auditor and strategy families that underperform.';
  if (lang === 'he') {
    return `אתה ראש מחקר כמותי בחברת מסחר אלגוריתמית. מקבל עובדות מחושבות על שולחנות המסחר והתיק. ${rules} `
      + `כתוב את כל הטקסט בעברית קצרה ומדויקת (מזהי שולחנות ושמות פרמטרים נשארים כפי שהם). החזר JSON תקין בלבד במבנה: ${schema}. עד 4 פריטים בכל רשימה.`;
  }
  return `You are the head of quantitative research at an algorithmic trading firm. You receive precomputed facts about trading desks and a paper portfolio. ${rules} `
    + `Reply with valid JSON only, in English, short and concrete: ${schema}. At most 4 items per list.`;
}

export function parseJson(text) {
  if (!text) return null;
  const s = typeof text === 'string' ? text : JSON.stringify(text);
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export function normalizeNote(parsed, digest) {
  const objs = (a) => (Array.isArray(a) ? a : []).filter((x) => x && typeof x === 'object').slice(0, 5);
  return {
    summary: String(parsed?.summary || '').slice(0, 900),
    findings: objs(parsed?.findings),
    parameterIdeas: objs(parsed?.parameterIdeas),
    riskFlags: toArr(parsed?.riskFlags),
    priorityActions: toArr(parsed?.priorityActions),
    digestStats: { ...digest.totals, ...digest.portfolio },
  };
}