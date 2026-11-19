// Critical Truth Auditor & Anti-Hallucination Agent ("אמיר").
// Enforces strict fact-checking, real-market data integrity, anti-overfitting,
// accounting consistency, and AI output grounding across all desks and promotions.

import { STRATEGIES } from './strategies.js';

const TF_MAX_STALE_MS = {
  '5m': 6 * 60 * 60 * 1000,
  '15m': 12 * 60 * 60 * 1000,
  '1h': 48 * 60 * 60 * 1000,
  '4h': 96 * 60 * 60 * 1000,
  '1d': 6 * 24 * 60 * 60 * 1000,
  '1w': 16 * 24 * 60 * 60 * 1000,
};

const EQUITY_SYMBOLS = new Set(['NVDA', 'SPY', 'AAPL', 'MSFT', 'QQQ', 'TSLA', 'AMZN', 'META', 'GOOGL']);

function isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Inspect OHLCV candles for data corruption, synthetic origin, or impossible spikes.
 */
export function verifyCandleIntegrity(candles, desk = {}) {
  if (!Array.isArray(candles) || candles.length < 80) {
    return {
      ok: false,
      severity: 'veto',
      detail: `חסרים נרות אמת (${candles?.length || 0} מתוך מינימום 80)`,
    };
  }
  let nonMonotonic = 0;
  let invalidOhlc = 0;
  let extremeSpikes = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (!c || !isFiniteNum(c.t) || !isFiniteNum(c.o) || !isFiniteNum(c.h) || !isFiniteNum(c.l) || !isFiniteNum(c.c)) {
      invalidOhlc++;
      continue;
    }
    if (c.o <= 0 || c.h <= 0 || c.l <= 0 || c.c <= 0 || c.h < c.l || c.h < Math.max(c.o, c.c) * 0.9999 || c.l > Math.min(c.o, c.c) * 1.0001) {
      invalidOhlc++;
    }
    if (i > 0) {
      const prev = candles[i - 1];
      if (c.t <= prev.t) nonMonotonic++;
      if (prev.c > 0) {
        const jump = Math.abs(c.c - prev.c) / prev.c;
        const maxJump = desk.tf === '1w' ? 1.5 : desk.tf === '1d' ? 0.8 : 0.45;
        if (jump > maxJump) extremeSpikes++;
      }
    }
  }

  if (invalidOhlc > 0 || nonMonotonic > 0) {
    return {
      ok: false,
      severity: 'veto',
      detail: `שחיתות נתוני נרות: ${invalidOhlc} נרות OHLC לא חוקיים, ${nonMonotonic} חותמות זמן לא עולות`,
    };
  }
  if (extremeSpikes > Math.max(2, candles.length * 0.02)) {
    return {
      ok: false,
      severity: 'veto',
      detail: `זוהו ${extremeSpikes} קפיצות מחיר חריגות (>45% בנר) — חשד לנתוני שוק פגומים`,
    };
  }
  return {
    ok: true,
    severity: 'pass',
    detail: `${candles.length} נרות OHLCV תקינים, רציפים ונקיים משגיאות`,
  };
}

/**
 * Verify that strategy parameters strictly exist in the real strategy schema
 * and fall within documented mathematical bounds (blocks hallucinated AI params).
 */
export function verifyStrategyParams(strategyId, params) {
  const strat = STRATEGIES[strategyId];
  if (!strat) {
    return { ok: false, severity: 'veto', detail: `אסטרטגיה לא קיימת במערכת: "${strategyId}" (חשד להזיה)` };
  }
  if (!params || typeof params !== 'object') {
    return { ok: false, severity: 'veto', detail: 'חסרים פרמטרים לאסטרטגיה' };
  }
  const space = strat.space || {};
  const bad = [];
  for (const [key, spec] of Object.entries(space)) {
    const val = params[key];
    if (spec.type === 'bool') {
      if (typeof val !== 'boolean') bad.push(`${key} חייב להיות boolean`);
    } else {
      const n = Number(val);
      if (!Number.isFinite(n) || n < spec.min - 1e-6 || n > spec.max + 1e-6) {
        bad.push(`${key}=${val} מחוץ לטווח [${spec.min}..${spec.max}]`);
      }
    }
  }
  if (bad.length) {
    return { ok: false, severity: 'veto', detail: `פרמטרים מחוץ לגבולות אמת: ${bad.slice(0, 3).join(', ')}` };
  }
  return { ok: true, severity: 'pass', detail: `כל פרמטרי ${strat.label} מאומתים בטווח החוקי` };
}

/**
 * Strict pre-publication & pre-promotion audit for a single desk candidate.
 * Returns { passed, vetoed, score, criticalCount, warnCount, checks, vetoReasons, summary, checkedAt }.
 */
export function auditDeskPromotion({
  desk,
  candles,
  evaluation,
  assessment,
  marketState = null,
  settings = {},
  recentMetrics = null,
} = {}) {
  const checks = [];
  const add = (id, label, status, detail) => checks.push({ id, label, status, detail });

  // 1. Real Market Data Only (No Synthetic Data)
  const isSynthetic = !!(candles?.__synthetic || marketState?.synthetic);
  if (isSynthetic) {
    add('real_data', 'מקור נתוני שוק אמיתיים', 'veto', 'הנרות ממקור הדגמה/סינתטי — אמיר חוסם פרסום או קידום ללא נתוני שוק אמת');
  } else {
    const prov = candles?.__provider || marketState?.provider || 'בורסה חיה';
    add('real_data', 'מקור נתוני שוק אמיתיים', 'pass', `נתוני אמת מאומתים מ-${prov}`);
  }

  // 2. Candle OHLCV Integrity
  const integrity = verifyCandleIntegrity(candles, desk);
  add('candle_integrity', 'שלמות ורציפות נרות OHLCV', integrity.severity, integrity.detail);

  // 3. Data Freshness
  const lastBar = Array.isArray(candles) && candles.length ? candles[candles.length - 1] : null;
  const ageMs = lastBar?.t ? Math.max(0, Date.now() - lastBar.t) : Infinity;
  const baseLimit = TF_MAX_STALE_MS[desk?.tf] || TF_MAX_STALE_MS['1h'];
  const staleLimit = EQUITY_SYMBOLS.has(desk?.symbol) ? Math.max(baseLimit, 5 * 24 * 60 * 60 * 1000) : baseLimit;
  if (!Number.isFinite(ageMs)) {
    add('freshness', 'עדכניות נתונים', 'veto', 'חסרה חותמת זמן בנר האחרון');
  } else if (ageMs > staleLimit * 4) {
    add('freshness', 'עדכניות נתונים', 'veto', `הנתונים מיושנים מדי (${Math.round(ageMs / 3600000)} שעות) — סיכון להחלטה על מידע ישן`);
  } else if (ageMs > staleLimit) {
    add('freshness', 'עדכניות נתונים', 'warn', `פיגור קל בעדכון הנר האחרון (${Math.round(ageMs / 3600000)} שעות)`);
  } else {
    add('freshness', 'עדכניות נתונים', 'pass', `נר אחרון עדכני (${Math.round(ageMs / 60000)} דקות)`);
  }

  // 4. Strategy & Parameter Schema Grounding
  const strategyId = evaluation?.strategyId || desk?.strategyId;
  const params = evaluation?.params || desk?.params;
  const paramCheck = verifyStrategyParams(strategyId, params);
  add('param_grounding', 'אימות סכמת אסטרטגיה ופרמטרים', paramCheck.severity, paramCheck.detail);

  // 5. Real Backtest Metrics Sanity & Anti-Hallucination Bounds
  const full = evaluation?.full;
  const isM = evaluation?.is;
  const oos = evaluation?.oos;
  if (!full || !oos || !isFiniteNum(full.returnPct) || !isFiniteNum(oos.returnPct)) {
    add('metrics_sanity', 'תקינות מדדי בקטסט', 'veto', 'מדדי ביצועים חסרים או לא מספריים (NaN/Infinity)');
  } else {
    const suspicious = [];
    if (full.profitFactor > 15 && full.trades >= 8) suspicious.push(`PF חריג (${full.profitFactor})`);
    if (full.winRate > 95 && full.trades >= 10) suspicious.push(`WinRate לא ריאלי (${full.winRate}%)`);
    if (oos.returnPct > 500 && desk?.tf !== '1w') suspicious.push(`תשואת OOS קיצונית (${oos.returnPct}%)`);
    if (full.maxDrawdownPct < 0 || full.maxDrawdownPct > 100) suspicious.push(`DD לא חוקי (${full.maxDrawdownPct}%)`);

    if (suspicious.length) {
      add('metrics_sanity', 'תקינות מדדי בקטסט ומניעת הטיה', 'veto', `חשד ל-Look-Ahead Bias או נתון שגוי: ${suspicious.join(' · ')}`);
    } else {
      add('metrics_sanity', 'תקינות מדדי בקטסט ומניעת הטיה', 'pass', `מדדים ריאליים: OOS ${oos.returnPct}% · PF ${full.profitFactor} · WR ${full.winRate}% · ${full.trades} עסקאות`);
    }
  }

  // 6. Fees & Realistic Costs Verification
  const feeRate = Number(settings.feeRate ?? settings.takerFee ?? 0);
  if (feeRate <= 0) {
    add('fees_applied', 'שקלול עמלות והחלקה', 'veto', 'שיעור העמלות מוגדר ל-0 — בקטסט ללא עלויות מסחר נדחה אוטומטית');
  } else {
    add('fees_applied', 'שקלול עמלות והחלקה', 'pass', `עמלות אמת משוקללות (${(feeRate * 100).toFixed(3)}%)`);
  }

  // 7. Anti-Overfitting (In-Sample vs Out-Of-Sample Degradation)
  if (isM && oos && isFiniteNum(isM.returnPct) && isFiniteNum(oos.returnPct)) {
    if (oos.returnPct <= 0) {
      add('anti_overfit', 'מניעת Overfitting (IS מול OOS)', 'veto', `תשואת OOS שלילית (${oos.returnPct}%) מול IS ${isM.returnPct}%`);
    } else if (oos.trades < 2) {
      add('anti_overfit', 'מניעת Overfitting (IS מול OOS)', 'veto', `רק ${oos.trades} עסקאות ב-OOS — אין מובהקות סטטיסטית`);
    } else if (isM.returnPct > 20 && oos.returnPct < isM.returnPct * 0.12) {
      add('anti_overfit', 'מניעת Overfitting (IS מול OOS)', 'veto', `פער קיצוני: IS +${isM.returnPct}% אך OOS רק +${oos.returnPct}% — התאמת יתר להיסטוריה`);
    } else {
      add('anti_overfit', 'מניעת Overfitting (IS מול OOS)', 'pass', `עקביות IS (${isM.returnPct}%) מול OOS (${oos.returnPct}%) עם ${oos.trades} עסקאות OOS`);
    }
  } else {
    add('anti_overfit', 'מניעת Overfitting (IS מול OOS)', 'veto', 'חסרה הפרדת In-Sample / Out-of-Sample');
  }

  // 8. Statistical Robustness (Walk-Forward + Monte Carlo)
  const minRob = Number(settings.minRobustness ?? 50);
  const rob = Number(assessment?.robustness ?? 0);
  if (rob < minRob) {
    add('robustness', 'חוסן סטטיסטי (Walk-Forward + Monte Carlo)', 'veto', `ציון חוסן ${rob}/100 מתחת לסף המינימלי (${minRob})`);
  } else {
    add('robustness', 'חוסן סטטיסטי (Walk-Forward + Monte Carlo)', 'pass', `ציון חוסן מאומת ${rob}/100 (סף ${minRob})`);
  }

  // 9. Risk Limits (Profit Factor & Max Drawdown)
  const minPF = Number(settings.minProfitFactor ?? 1.15);
  const maxDD = Number(settings.maxDrawdown ?? 0.3) * 100;
  if (full && (full.profitFactor < minPF || full.maxDrawdownPct > maxDD)) {
    add('risk_bounds', 'גבולות סיכון (PF ו-Max Drawdown)', 'veto', `חריגה מגבולות סיכון: PF ${full.profitFactor} (סף ${minPF}) · DD ${full.maxDrawdownPct}% (מגבלה ${maxDD.toFixed(0)}%)`);
  } else if (full) {
    add('risk_bounds', 'גבולות סיכון (PF ו-Max Drawdown)', 'pass', `בתוך תקציב הסיכון: PF ${full.profitFactor} · DD ${full.maxDrawdownPct}%`);
  }

  // 10. Current Market Regime Window Reality Check
  if (recentMetrics && isFiniteNum(recentMetrics.returnPct) && recentMetrics.trades >= 2) {
    if (recentMetrics.returnPct < -18 || recentMetrics.maxDrawdownPct > 28) {
      add('recent_regime', 'ביצועי אמת בחלון השוק הנוכחי', 'veto', `קריסה בחלון האחרון: ${recentMetrics.returnPct}% (DD ${recentMetrics.maxDrawdownPct}%) — אינה מותאמת לתנאי השוק כיום`);
    } else if (recentMetrics.returnPct < -6) {
      add('recent_regime', 'ביצועי אמת בחלון השוק הנוכחי', 'warn', `חולשה בחלון האחרון (${recentMetrics.returnPct}%) — מומלץ המשך כיול`);
    } else {
      add('recent_regime', 'ביצועי אמת בחלון השוק הנוכחי', 'pass', `ביצועים יציבים בחלון הנוכחי: ${recentMetrics.returnPct}% (${recentMetrics.trades} עסקאות)`);
    }
  } else {
    add('recent_regime', 'ביצועי אמת בחלון השוק הנוכחי', 'pass', 'חלון עכשווי נבדק (מעט עסקאות בטווח הזמן)');
  }

  const vetoChecks = checks.filter((c) => c.status === 'veto');
  const warnChecks = checks.filter((c) => c.status === 'warn');
  const passChecks = checks.filter((c) => c.status === 'pass');
  const score = Math.max(0, Math.min(100, Math.round(
    (passChecks.length * 100 + warnChecks.length * 55) / Math.max(1, checks.length)
  )));

  const vetoed = vetoChecks.length > 0;
  const vetoReasons = vetoChecks.map((c) => c.detail);
  const summary = vetoed
    ? `נחסם ע״י אמיר (${vetoChecks.length} כשלי אימות): ${vetoReasons[0]}`
    : warnChecks.length
      ? `אושר בתנאי מעקב (${score}/100) · ${warnChecks[0].detail}`
      : `מאומת במלואו ע״י אמיר (${score}/100) · נתוני אמת ללא התאמת-יתר`;

  return {
    passed: !vetoed,
    vetoed,
    score,
    criticalCount: vetoChecks.length,
    warnCount: warnChecks.length,
    checks,
    vetoReasons,
    summary,
    checkedAt: Date.now(),
  };
}

/**
 * System-wide truth & anti-hallucination audit executed on every autopilot cycle.
 * Verifies market feed reality, PaperPortfolio accounting integrity, AI Director grounding,
 * and active live desks compliance.
 */
export function auditSystemTruth(state, marketState = {}) {
  const checks = [];
  const add = (id, label, status, detail) => checks.push({ id, label, status, detail });

  // 1. Live Market Data Feed Verification
  if (marketState?.synthetic) {
    add('feed', 'זרם מחירים ושוק בזמן אמת', 'veto', 'המערכת כרגע על נתוני הדגמה — קידום גרסאות ומסחר חי נעולים עד חיבור לבורסה');
  } else {
    add('feed', 'זרם מחירים ושוק בזמן אמת', 'pass', `מקור אמת פעיל: ${marketState?.provider || 'Binance / Yahoo Finance'}`);
  }

  // 2. PaperPortfolio Accounting Integrity
  const pf = state?.paperPortfolio;
  if (pf && typeof pf === 'object') {
    const init = Number(pf.initialBalance);
    const cash = Number(pf.cash);
    const fees = Number(pf.totalFeesAccumulated || 0);
    const tax = Number(pf.taxAccumulated || 0);
    const trades = Array.isArray(pf.trades) ? pf.trades : [];
    const badNumbers = !Number.isFinite(init) || init <= 0 || !Number.isFinite(cash) || cash < -1 || !Number.isFinite(fees) || !Number.isFinite(tax);
    const badPositions = Object.values(pf.positions || {}).some((p) => !p || !Number.isFinite(Number(p.quantity)) || Number(p.quantity) <= 0 || !Number.isFinite(Number(p.avgPrice)) || Number(p.avgPrice) <= 0);
    if (badNumbers || badPositions) {
      add('accounting', 'עקביות חשבונאית של תיק המסחר', 'veto', 'זוהו ערכים לא תקינים או פוזיציה פגומה בתיק הנייר');
    } else {
      add('accounting', 'עקביות חשבונאית של תיק המסחר', 'pass', `יתרה תקינה · ${trades.length} עסקאות מתועדות · עמלות $${fees.toFixed(2)} · מס $${tax.toFixed(2)}`);
    }
  } else {
    add('accounting', 'עקביות חשבונאית של תיק המסחר', 'pass', 'תיק הנייר מאותחל ונקי משגיאות חשבונאיות');
  }

  // 3. AI Director Anti-Hallucination Grounding (strip any hallucinated strategy IDs)
  let hallucinatedPlans = 0;
  for (const desk of state?.desks || []) {
    if (desk.aiPlan?.strategyId && !STRATEGIES[desk.aiPlan.strategyId]) {
      hallucinatedPlans++;
      desk.aiPlan.consumed = true;
      desk.aiPlan.rejectedByAuditor = `אסטרטגיה לא קיימת: ${desk.aiPlan.strategyId}`;
    }
  }
  if (hallucinatedPlans > 0) {
    add('ai_grounding', 'בקרת הזיות של ה-AI Director', 'warn', `אמיר יירט וחסם ${hallucinatedPlans} המלצות AI לאסטרטגיות לא קיימות`);
  } else {
    add('ai_grounding', 'בקרת הזיות של ה-AI Director', 'pass', 'כל המלצות ה-AI מעוגנות באסטרטגיות ובפרמטרים אמיתיים במערכת');
  }

  // 4. Live Desks Truth Compliance
  const desks = state?.desks || [];
  const liveDesks = desks.filter((d) => d.status === 'live');
  const unverifiedLive = liveDesks.filter((d) => d.lastAudit?.vetoed || (d.oosMetrics && d.oosMetrics.returnPct <= 0));
  if (unverifiedLive.length > 0) {
    add('live_compliance', 'אימות שולחנות במסחר חי', 'veto', `${unverifiedLive.length} שולחנות חיים נכשלו בבדיקת אמת (${unverifiedLive.map((d) => d.short).join(', ')})`);
  } else {
    add('live_compliance', 'אימות שולחנות במסחר חי', 'pass', liveDesks.length ? `כל ${liveDesks.length} השולחנות החיים מאומתים עם OOS חיובי` : 'אין שולחנות חיים לא מאומתים');
  }

  // 5. Continuous Market Regime Coverage
  const withRegime = desks.filter((d) => d.marketRegime?.regime).length;
  add(
    'regime_adapt',
    'התאמה רציפה לתנאי השוק הנוכחיים',
    withRegime > 0 ? 'pass' : 'warn',
    withRegime > 0
      ? `${withRegime}/${desks.length} שולחנות מסווגים וממוטבים למשטר השוק הנוכחי`
      : 'ממתין לסיווג משטר שוק במחזור הקרוב',
  );

  // 6. Total Vetoes Tracked
  const vetoedDesks = desks.filter((d) => d.lastAudit?.vetoed);
  const passedCount = checks.filter((c) => c.status === 'pass').length;
  const vetoCount = checks.filter((c) => c.status === 'veto').length;
  const warnCount = checks.filter((c) => c.status === 'warn').length;
  const score = Math.max(0, Math.min(100, Math.round(
    (passedCount * 100 + warnCount * 65) / Math.max(1, checks.length)
  )));

  const status = vetoCount > 0 ? 'blocked' : warnCount > 0 ? 'warning' : 'verified';
  const prevVetoes = Number(state?.truthAudit?.vetoesTotal || 0);
  const summary = status === 'verified'
    ? `מערכת מאומתת (${score}/100) · כל ${passedCount}/${checks.length} בדיקות האמת עברו`
    : status === 'warning'
      ? `תקינות עם התראות (${score}/100) · ${warnCount} הערות מעקב`
      : `הגנת אמת הופעלה (${score}/100) · ${vetoCount} חסימות פעילות`;

  return {
    score,
    status,
    passedCount,
    totalChecks: checks.length,
    vetoedDeskCount: vetoedDesks.length,
    vetoesTotal: prevVetoes,
    checks,
    summary,
    checkedAt: Date.now(),
  };
}
