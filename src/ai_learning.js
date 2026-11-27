// AI Team Learning & Continuous Optimization Engine
// Supercharges the free web LLMs (Gemini, Groq, Claude, OpenRouter) into a persistent
// learning, diagnostic, and parameter-tuning powerhouse for the firm's trading agents.

import { store } from './store.js';
import { STRATEGIES, STRATEGY_IDS } from './strategies.js';
import { chatDetailed, hasModelKey } from './llm.js';
import { parseJsonReply, sanitizePlan } from './ai.js';
import { toast } from './ui.js';

/**
 * Ensures the firm's persistent AI learning memory structure exists in state.
 */
export function ensureFirmMemory(state = store.state) {
  if (!state.aiLessons || !Array.isArray(state.aiLessons)) {
    state.aiLessons = [];
  }
  if (!state.aiLearningMetrics || typeof state.aiLearningMetrics !== 'object') {
    state.aiLearningMetrics = {
      totalAnalyzed: 0,
      lastRunAt: null,
      activeProvider: null,
      successRatePct: 100,
    };
  }
  return state.aiLessons;
}

/**
 * Retrieves applicable parameter biases and constraints from the team's persistent AI memory
 * for a specific desk and market regime.
 */
export function getApplicableAiLessons(desk, state = store.state) {
  ensureFirmMemory(state);
  const lessons = state.aiLessons || [];
  const relevant = lessons.filter(
    (l) => l.deskId === desk.id || l.symbol === desk.symbol || l.strategyId === desk.strategyId
  );

  const combinedBias = {};
  for (const l of relevant) {
    if (l.paramBias && typeof l.paramBias === 'object') {
      for (const [k, v] of Object.entries(l.paramBias)) {
        if (Array.isArray(v) && v.length === 2) {
          combinedBias[k] = v;
        }
      }
    }
  }

  return {
    relevantLessons: relevant,
    paramBias: combinedBias,
    latestLessonText: relevant[0]?.lessonLearned || null,
  };
}

/**
 * Deeply analyzes a single trading desk using free web LLMs (Gemini / Groq / Claude),
 * producing an actionable root-cause diagnostic, regime-aligned parameter bounds,
 * and a persistent lesson for the team's knowledge base.
 */
export async function analyzeDeskWithFreeAi(desk, state = store.state) {
  if (!desk) return { ok: false, reason: 'no-desk' };
  ensureFirmMemory(state);

  const m = desk.metrics || {};
  const is = desk.isMetrics || {};
  const oos = desk.oosMetrics || {};
  const assessment = desk.assessment || {};
  const regime = desk.marketRegime || {};
  const macro = state.fundamentals?.macro || {};
  const strategyInfo = STRATEGIES[desk.strategyId] || {};

  const allowedParams = strategyInfo.space || {};
  const allowedRanges = Object.entries(allowedParams)
    .filter(([, spec]) => spec.type !== 'bool')
    .map(([k, spec]) => `${k}: [${spec.min}, ${spec.max}] (${spec.type})`)
    .join(', ');

  const system = `אתה סמנכ"ל טכנולוגיות ומיטוב כמותי (Chief AI Optimization Scientist) ב-Alta Capital.
תפקידך לנתח לעומק את ביצועי שולחן המסחר "${desk.label}" (${desk.symbol} · ${desk.tf}), לאבחן מדוע הוא מרוויח או מפסיד,
ולהגדיר טווחי פרמטרים ממוקדים (Parameter Biases) ולקח למידה מתמשך עבור ליה (האופטימייזרית) ואיתי (מנהל הבקטסט).

כללים מחמירים:
1. החזר JSON תקין בלבד, בלי code fences ובלי שום טקסט נוסף מסביב.
2. התבסס אך ורק על המספרים והנתונים שסופקו. אל תמציא נתונים.
3. בחר טווחי פרמטרים בתוך הטווחים המותרים בלבד: ${allowedRanges}.
4. כתוב בעברית מקצועית, חדה, מתמטית ומעשית.`;

  const userPrompt = `נתח את נתוני האמת של שולחן המסחר והפק המלצת מיטוב ולמידה:
נתוני השולחן:
- מזהה: ${desk.id} · נכס: ${desk.symbol} · טווח: ${desk.tf}
- אסטרטגיה נוכחית: ${strategyInfo.label || desk.strategyId} (${desk.version || 'ללא גרסה'})
- פרמטרים נוכחיים: ${JSON.stringify(desk.params || {})}
- תשואת In-Sample (כיול): ${is.returnPct ?? '—'}%
- תשואת Out-Of-Sample (אימות עיוור): ${oos.returnPct ?? '—'}%
- Profit Factor: ${m.profitFactor ?? '—'} · עסקאות: ${m.trades ?? 0} · Win Rate: ${m.winRate ? (m.winRate * 100).toFixed(1) + '%' : '—'}
- Max Drawdown: ${m.maxDrawdownPct ?? '—'}% · חוסן סטטיסטי: ${assessment.robustness ?? '—'}/100
- ביקורת אמת (אמיר): ${desk.lastAudit ? (desk.lastAudit.vetoed ? `נפסל: ${desk.lastAudit.summary}` : `אושר (ציון ${desk.lastAudit.score})`) : 'טרם נבדק'}

סביבת השוק והמאקרו:
- משטר שוק נוכחי: ${regime.label || 'דשדוש'} (יחס יעילות ER: ${regime.er ?? '—'}, מכפיל תנודתיות Vol: ×${regime.volRatio ?? 1})
- משפחות מומלצות למשטר: ${(regime.recommendedFamilies || []).join(', ')}
- מאקרו: VIX: ${macro.vix ?? '—'}, DXY: ${macro.dxy ?? '—'}, 10Y Yield: ${macro.us10yYield ?? '—'}%

החזר JSON לפי המבנה הזה בדיוק:
{
  "deskId": "${desk.id}",
  "diagnostic": "משפט אחד או שניים המאבחנים במדויק מדוע השולחן מרוויח או מפסיד ביחס לתנודתיות ולעמלות",
  "regimeFit": "האם האסטרטגיה מתאימה למשטר הנוכחי ואיך כדאי להתאים אותה",
  "recommendedStrategyId": "${desk.strategyId}",
  "paramBias": {
    "atrStop": [1.5, 2.8],
    "rr": [1.8, 3.2]
  },
  "riskManagementAdvice": "המלצה קצרה על ניהול סיכונים וסטופים",
  "lessonLearned": "לקח תמציתי ומדויק לזיכרון המערכת (עד 150 תווים) כדי שהצוות לעולם לא יחזור על אותה טעות",
  "confidenceScore": 88
}`;

  try {
    const res = await chatDetailed({
      system,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 850,
      preferWeb: true,
      preferColibri: false,
    });

    const parsed = parseJsonReply(res.text);
    if (!parsed) {
      throw new Error('AI החזיר תשובה שאינה במבנה JSON תקין');
    }

    // Sanitize paramBias against strategy space
    const targetStrategy = STRATEGY_IDS.includes(parsed.recommendedStrategyId)
      ? parsed.recommendedStrategyId
      : desk.strategyId;
    const space = STRATEGIES[targetStrategy]?.space || {};
    const cleanBias = {};

    if (parsed.paramBias && typeof parsed.paramBias === 'object') {
      for (const [k, rng] of Object.entries(parsed.paramBias)) {
        const spec = space[k];
        if (!spec || spec.type === 'bool' || !Array.isArray(rng) || rng.length !== 2) continue;
        const lo = Math.max(spec.min, Math.min(Number(rng[0]), Number(rng[1])));
        const hi = Math.min(spec.max, Math.max(Number(rng[0]), Number(rng[1])));
        if (hi > lo) {
          cleanBias[k] = spec.type === 'int' ? [Math.round(lo), Math.round(hi)] : [+lo.toFixed(2), +hi.toFixed(2)];
        }
      }
    }

    const lessonItem = {
      id: `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      deskId: desk.id,
      deskLabel: desk.label,
      symbol: desk.symbol,
      tf: desk.tf,
      strategyId: targetStrategy,
      diagnostic: String(parsed.diagnostic || '').slice(0, 300),
      regimeFit: String(parsed.regimeFit || '').slice(0, 200),
      riskManagementAdvice: String(parsed.riskManagementAdvice || '').slice(0, 200),
      paramBias: cleanBias,
      lessonLearned: String(parsed.lessonLearned || '').slice(0, 250),
      confidenceScore: Math.min(100, Math.max(50, Number(parsed.confidenceScore) || 80)),
      provider: res.provider || res.model || 'Gemini',
      at: Date.now(),
    };

    // Store in firm's persistent memory (keep last 30 high-value lessons)
    state.aiLessons.unshift(lessonItem);
    if (state.aiLessons.length > 30) state.aiLessons.pop();

    // Attach to desk as active AI Plan for immediate optimization
    desk.aiPlan = {
      strategyId: targetStrategy,
      paramBias: cleanBias,
      rationale: lessonItem.diagnostic,
      lessonLearned: lessonItem.lessonLearned,
      at: Date.now(),
      consumed: false,
      provider: lessonItem.provider,
    };

    // Update global metrics
    state.aiLearningMetrics.totalAnalyzed = (state.aiLearningMetrics.totalAnalyzed || 0) + 1;
    state.aiLearningMetrics.lastRunAt = Date.now();
    state.aiLearningMetrics.activeProvider = lessonItem.provider;

    store.log(
      'info',
      'אוריה · CIO',
      `🧠 מיטוב ולמידת AI הושלמו עבור ${desk.label}: ${lessonItem.lessonLearned} (סופק ע"י ${lessonItem.provider})`
    );

    store.save();
    return { ok: true, lesson: lessonItem, plan: desk.aiPlan, provider: lessonItem.provider };
  } catch (err) {
    console.warn('[analyzeDeskWithFreeAi] Remote model unavailable, applying quantitative heuristics fallback:', err.message);
    const targetStrategy = desk.strategyId;
    const space = STRATEGIES[targetStrategy]?.space || {};
    const cleanBias = {};
    const vol = Number(regime.volRatio) || 1;
    const er = Number(regime.er) || 0.3;

    if (space.atrStop) {
      const minStop = vol > 1.2 ? Math.max(space.atrStop.min, 1.8) : space.atrStop.min;
      const maxStop = Math.min(space.atrStop.max, minStop + (space.atrStop.max - space.atrStop.min) * 0.5);
      cleanBias.atrStop = [+minStop.toFixed(1), +maxStop.toFixed(1)];
    }
    if (space.rr) {
      const minRr = er > 0.4 ? Math.max(space.rr.min, 2.0) : space.rr.min;
      const maxRr = Math.min(space.rr.max, minRr + 1.2);
      cleanBias.rr = [+minRr.toFixed(1), +maxRr.toFixed(1)];
    }

    const lessonItem = {
      id: `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      deskId: desk.id,
      deskLabel: desk.label,
      symbol: desk.symbol,
      tf: desk.tf,
      strategyId: targetStrategy,
      diagnostic: desk.lastAudit?.vetoed
        ? `ביקורת אמת פסלה קידום: ${desk.lastAudit.summary}`
        : (m.maxDrawdownPct > 10 ? `Drawdown גבוה (${m.maxDrawdownPct}%) — יש להדק ניהול סיכונים ולהרחיב סטופים ביחס לתנודתיות.` : `משטר שוק "${regime.label}" מחייב כיול מחדש ביחס לרמת הרעש והנזילות.`),
      regimeFit: `משטר ${regime.label || 'דשדוש'} (תנודתיות ×${vol.toFixed(2)}, ER ${er.toFixed(2)}).`,
      riskManagementAdvice: 'עבודה ביחס סיכוי/סיכון מינימלי של 1:2.0 והגבלת גודל פוזיציה.',
      paramBias: cleanBias,
      lessonLearned: desk.lastAudit?.vetoed
        ? `חסימת חריגה מסטטיסטיקת אמת: ${desk.lastAudit.summary.slice(0, 100)}`
        : `במשטר ${regime.label || 'דשדוש'} ב-${desk.symbol} (${desk.tf}) יש להגביל את טווח הפרמטרים כדי למנוע התאמת יתר.`,
      confidenceScore: 78,
      provider: 'Quantitative AI Heuristics',
      at: Date.now(),
    };

    state.aiLessons.unshift(lessonItem);
    if (state.aiLessons.length > 30) state.aiLessons.pop();

    desk.aiPlan = {
      strategyId: targetStrategy,
      paramBias: cleanBias,
      rationale: lessonItem.diagnostic,
      lessonLearned: lessonItem.lessonLearned,
      at: Date.now(),
      consumed: false,
      provider: lessonItem.provider,
    };

    state.aiLearningMetrics.totalAnalyzed = (state.aiLearningMetrics.totalAnalyzed || 0) + 1;
    state.aiLearningMetrics.lastRunAt = Date.now();
    state.aiLearningMetrics.activeProvider = lessonItem.provider;
    store.save();
    return { ok: true, lesson: lessonItem, plan: desk.aiPlan, provider: lessonItem.provider };
  }
}

/**
 * Runs a full team learning and optimization cycle across the firm's desks,
 * prioritizing struggling desks or desks vetoed by the truth auditor.
 */
export async function runFullTeamLearningCycle(state = store.state, { maxDesks = 3 } = {}) {
  ensureFirmMemory(state);
  const desks = state.desks || [];
  if (!desks.length) return { ok: false, reason: 'אין שולחנות פעילים' };

  // Rank desks by need of learning (struggling or vetoed first)
  const prioritized = [...desks].sort((a, b) => {
    const scoreA = (a.lastAudit?.vetoed ? -100 : 0) + (a.oosMetrics?.returnPct ?? a.bestReturn ?? 0);
    const scoreB = (b.lastAudit?.vetoed ? -100 : 0) + (b.oosMetrics?.returnPct ?? b.bestReturn ?? 0);
    return scoreA - scoreB;
  });

  const targets = prioritized.slice(0, maxDesks);
  const results = [];

  for (const desk of targets) {
    const res = await analyzeDeskWithFreeAi(desk, state);
    if (res.ok) results.push(res);
  }

  store.save();
  return {
    ok: results.length > 0,
    analyzedCount: results.length,
    results,
    activeProvider: state.aiLearningMetrics?.activeProvider || 'Gemini',
  };
}

/**
 * Deletes a single lesson from the firm's persistent knowledge base.
 */
export function deleteAiLesson(id, state = store.state) {
  ensureFirmMemory(state);
  state.aiLessons = state.aiLessons.filter((l) => l.id !== id);
  store.save();
}

/**
 * Clears all lessons from the firm's persistent knowledge base.
 */
export function clearAllAiLessons(state = store.state) {
  ensureFirmMemory(state);
  state.aiLessons = [];
  store.save();
}
