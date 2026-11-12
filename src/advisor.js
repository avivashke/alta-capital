// The advisor: an LLM-grounded analyst with a deterministic local fallback.

import { STRATEGIES } from './strategies.js';
import { PLATFORMS } from './config.js';
import { hasModelKey, chat } from './llm.js';
import { store } from './store.js';
import { marketState } from './market.js';

export function buildDigest(state = store.state) {
  const s = state.settings;
  const desks = state.desks.map((d) => {
    const m = d.metrics;
    return {
      desk: d.label,
      timeframe: d.tf,
      symbol: d.symbol,
      status: d.status,
      version: d.version,
      strategy: STRATEGIES[d.strategyId]?.label || d.strategyId || 'לא נבחרה',
      params: d.params,
      inSample: d.isMetrics ? `${d.isMetrics.returnPct}%` : '—',
      outOfSample: d.oosMetrics ? `${d.oosMetrics.returnPct}%` : '—',
      bestOutOfSample: d.bestReturn,
      profitFactor: m?.profitFactor,
      trades: m?.trades,
      maxDrawdownPct: m?.maxDrawdownPct,
      robustness: d.assessment?.robustness ?? d.robustness ?? null,
      foldConsistency: d.assessment?.walkForward?.consistency ?? null,
      monteCarloProbProfit: d.assessment?.monteCarlo?.probProfit ?? null,
      technical: d.technical
        ? {
          bias: d.technical.biasLabel,
          confidence: d.technical.confidence,
          trend: d.technical.trend?.label,
          rsi: d.technical.momentum?.rsi,
          volatility: d.technical.volatility?.regime,
          support: d.technical.structure?.support,
          resistance: d.technical.structure?.resistance,
        }
        : null,
      livePaperPnlPct: d.livePnl ? +d.livePnl.toFixed(2) : 0,
      openPosition: d.openTrade ? { dir: d.openTrade.dir > 0 ? 'long' : 'short', entry: d.openTrade.entry } : null,
    };
  });
  const versions = state.desks.flatMap((d) => d.history.slice(0, 3).map((h) => `${d.short} ${h.version}: OOS ${h.oosReturn}%`));
  return {
    firm: 'Alta Capital',
    tradingMode: 'backtest + paper trading only (no real order routing)',
    capital: s.capital,
    riskPerTrade: s.riskPerTrade,
    maxDrawdownLimit: s.maxDrawdown,
    platform: PLATFORMS[s.platform]?.label || s.platform,
    dataFeed: marketState.synthetic ? 'SYNTHETIC DEMO DATA (real feed blocked/unavailable)' : marketState.provider,
    desks,
    versions,
    ideasFound: state.ideas.length,
    untestedIdeas: state.ideas.filter((i) => !i.tested).length,
    sentiment: {
      fearGreed: state.sentiment.fearGreed?.value ?? null,
      assets: state.sentiment.assets,
      newsScore: state.sentiment.newsScore ?? null,
      updatedAt: state.sentiment.updatedAt,
    },
    modelKeyConfigured: hasModelKey(),
    totals: state.stats,
  };
}

export function localAdvice(state = store.state) {
  const out = [];
  const s = state.settings;
  const desks = state.desks;
  const live = desks.filter((d) => d.status === 'live');
  const dry = desks.filter((d) => d.status === 'dry-run');
  const stuck = desks.filter((d) => d.status === 'research' || d.status === 'optimizing');
  const synthetic = marketState.synthetic;

  if (!hasModelKey()) {
    out.push({
      title: 'חבר מפתח מודל ליועץ',
      detail: 'בלי מפתח, היועץ עובד במצב כללים מקומי. הוסף מפתח ב"הגדרות ומפתחות" וקבל ניתוח חופשי על מצב התיק.',
      action: { label: 'להגדרות', route: 'settings' },
    });
  }
  if (stuck.length) {
    out.push({
      title: 'הרץ מחזור כיול על השולחנות התקועים',
      detail: `${stuck.map((d) => d.short).join(', ')} עדיין לא עברו את שערי הקידום. כל מחזור מוסיף אופטימיזציה על נתוני out-of-sample.`,
      action: { label: 'למעבדה', route: 'lab' },
    });
  }
  if (dry.length) {
    out.push({
      title: 'השלם dry-run לפני הרצה חיה',
      detail: `${dry.length} שולחנות בהרצה על יבש. צריך 3 מחזורים נקיים ומדדים חיוביים כדי לעבור לנייר חי.`,
      action: { label: 'לגרסאות', route: 'bots' },
    });
  }
  if (live.length) {
    out.push({
      title: 'פקח על פער בין בקטסט לנייר חי',
      detail: `בהרצה חיה: ${live.map((d) => `${d.short} (${d.livePnl.toFixed(2)}%)`).join(', ')}. פער שלילי מתמשך מעיד על overfitting — שקול להחזיר לכיול.`,
      action: { label: 'לשולחנות', route: 'desks' },
    });
  }
  if (synthetic) {
    out.push({
      title: 'נתוני השוק הם הדגמה',
      detail: 'שליפת הנרות האמיתית נחסמה (CORS/geo). כל התוצאות מבוססות על סדרה סינתטית — אל תסיק מהן מסקנות על השוק.',
      action: { label: 'למחקר', route: 'research' },
    });
  }
  if ((state.sentiment.newsScore ?? 0) < -0.3) {
    out.push({
      title: 'סנטימנט שלילי ברשתות',
      detail: 'הכותרות שנאספו נוטות לשלילי. הורד חשיפה או המתן לאישור מחיר לפני פתיחת פוזיציות חדשות.',
      action: { label: 'לסנטימנט', route: 'sentiment' },
    });
  }
  const fragile = desks.filter((d) => d.version && (d.assessment?.robustness ?? 100) < (s.minRobustness ?? 50));
  if (fragile.length) {
    out.push({
      title: 'גרסאות עם חוסן סטטיסטי נמוך',
      detail: `${fragile.map((d) => `${d.short} (${d.assessment?.robustness ?? '—'}/100)`).join(', ')} — לא יקודמו להרצה חיה עד שהחוסן יעלה. שקול צמצום פרמטרים או החלפת משפחה.`,
      action: { label: 'למעבדה', route: 'lab' },
    });
  }
  if (state.ideas.filter((i) => !i.tested).length > 3) {
    out.push({
      title: 'יש רעיונות מחקר שלא נבדקו',
      detail: `${state.ideas.filter((i) => !i.tested).length} רעיונות מ-GitHub/רשתות ממתינים לבדיקה. שלח אותם לשולחן מתאים כדי להרחיב את מאגר האסטרטגיות.`,
      action: { label: 'למחקר', route: 'research' },
    });
  }
  if (!out.length) {
    out.push({
      title: 'המערך יציב — המשך לצבור מחזורים',
      detail: 'כל השולחנות עברו את הספים או נמצאים בהרצה חיה. המשך לנטר את פער הבקטסט מול הנייר.',
      action: { label: 'לסקירה', route: 'overview' },
    });
  }
  return out.slice(0, 5);
}

const SYSTEM = `אתה היועץ הראשי של Alta Capital — חברת השקעות שמנוהלת על ידי סוכנים.
אתה מדבר עברית, בקצרה ובאופן מעשי, כמו שותף בכיר בחדר מסחר.
כל הנתונים שתקבל הם מבקטסטים ומסחר על נייר בלבד; אין ביצוע פקודות אמיתיות. אל תבטיח תשואות.
כשאתה עונה:
1. אבחן את מצב השולחנות (5m/15m/1h/1d/1w), מה עובד ומה לא.
2. פרט סיכונים קונקרטיים: overfitting, drawdown, מספר עסקאות קטן, פער בין in-sample ל-out-of-sample.
3. תן 2-4 פעולות הבאות מדויקות (למשל: להריץ כיול על שולחן X, להעביר לפלטפורמה Y, להוריד סיכון ל-Z%).
4. אם נשאלת על שוק — הפרד בין מה שהנתונים מראים לבין פרשנות, ואזכר שהסנטימנט הוא פרוקסי רעש.
השתמש במספרים מהנתונים. אל תמציא נתונים שלא הופיעו.`;

export function openingMessage() {
  return {
    role: 'ai',
    content:
      'שלום, אני היועץ של המערך. אני רואה את כל השולחנות, הגרסאות, תוצאות הבקטסט והסנטימנט.\n' +
      'אפשר לשאול אותי "מה הפעולה הבאה?", "איזה שולחן מסוכן?", "מה דעתך על הסווינג השבועי?" — ואנתח לפי הנתונים בפועל.',
    at: Date.now(),
  };
}

export async function askAdvisor(question, history = []) {
  const digest = buildDigest();
  const context = `מצב המערך כפי שהוא עכשיו (JSON):\n${JSON.stringify(digest, null, 2)}`;
  const messages = [
    ...history.slice(-8).map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content })),
    { role: 'user', content: `${context}\n\nשאלת המשתמש: ${question}` },
  ];
  if (!hasModelKey()) return localAnswer(question, digest);
  return await chat({ system: SYSTEM, messages, maxTokens: 1400 });
}

export function localAnswer(question, digest = buildDigest()) {
  const q = (question || '').toLowerCase();
  const advice = localAdvice();
  const risky = [...digest.desks].sort((a, b) => (b.maxDrawdownPct || 0) - (a.maxDrawdownPct || 0))[0];
  const best = [...digest.desks].sort((a, b) => (b.bestOutOfSample || -99) - (a.bestOutOfSample || -99))[0];

  const intro = hasModelKey()
    ? ''
    : '⚠️ אין מפתח מודל מוגדר, אז אני עונה במצב כללים מקומי. חבר מפתח ב"הגדרות" לניתוח חופשי.\n\n';

  if (q.includes('סיכון') || q.includes('risk') || q.includes('מסוכן')) {
    return `${intro}השולחן עם ה-drawdown הגבוה ביותר כרגע: ${risky.desk} (${risky.maxDrawdownPct ?? '—'}% מול מגבלה ${(store.state.settings.maxDrawdown * 100).toFixed(0)}%). ` +
      `מספר העסקאות שם: ${risky.trades ?? '—'}.\n\nפעולות מומלצות:\n1. הורד את riskPerTrade ל-1% עד שה-drawdown מתייצב.\n2. דרוש לפחות ${store.state.settings.minTrades} עסקאות לפני קידום.\n3. השווה OOS מול in-sample — פער גדול מעיד על overfitting.`;
  }
  if (q.includes('הבא') || q.includes('next') || q.includes('פעולה') || q.includes('לעשות')) {
    return `${intro}סדר העדיפויות שלי עכשיו:\n` + advice.map((a, i) => `${i + 1}. ${a.title} — ${a.detail}`).join('\n');
  }
  if (q.includes('סווינג') || q.includes('swing') || q.includes('שנתי') || q.includes('חודשי')) {
    const swing = digest.desks.filter((d) => d.timeframe === '1d' || d.timeframe === '1w');
    return `${intro}מצב שולחנות הסווינג:\n` + swing.map((d) =>
      `• ${d.desk}: ${d.status} · גרסה ${d.version || '—'} · OOS ${d.outOfSample} · PF ${d.profitFactor ?? '—'} · עסקאות ${d.trades ?? '—'}`,
    ).join('\n') + `\n\nבסווינג מספר העסקאות קטן מטבעו — אל תקדם גרסה על פחות מ-6 עסקאות ו-3 שנות נתונים.`;
  }
  if (q.includes('רווח') || q.includes('profit') || q.includes('ביצוע')) {
    return `${intro}השולחן המוביל לפי out-of-sample: ${best.desk} עם ${best.bestOutOfSample ?? '—'}% (PF ${best.profitFactor ?? '—'}, ${best.trades ?? 0} עסקאות).\n` +
      `שווי תיק מדומה: ${digest.capital.toLocaleString('en-US')} · מצב: בקטסט ונייר בלבד.\n\n` +
      `שים לב: תשואה גבוהה עם מעט עסקאות אינה סטטיסטית. דרוש profit factor יציב גם ב-OOS וגם בהרצה החיה.`;
  }
  if (q.includes('גיטהאב') || q.includes('github') || q.includes('מחקר') || q.includes('אסטרטגי')) {
    return `${intro}מצב המחקר: ${digest.ideasFound} רעיונות נאספו, ${digest.untestedIdeas} טרם נבדקו. ` +
      `מקורות: GitHub Search, Fear & Greed, CoinGecko, Reddit וחדשות (אם הוגדר endpoint).\n` +
      `הפעולה הבאה: היכנס ל"מחקר וסריקה", שלח 2-3 רעיונות לבדיקה על השולחן המתאים, ואז הרץ כיול מעמיק.`;
  }
  return `${intro}תמונת מצב מהירה:\n` +
    digest.desks.map((d) => `• ${d.desk} — ${d.status} · ${d.strategy} · OOS ${d.outOfSample} · PF ${d.profitFactor ?? '—'}`).join('\n') +
    `\n\nהפעולה הבאה המומלצת: ${advice[0].title}. ${advice[0].detail}`;
}

export function quickPrompts() {
  return ['מה הפעולה הבאה?', 'איזה שולחן מסוכן?', 'מה דעתך על שולחנות הסווינג?', 'איפה אנחנו עומדים ברווחיות?'];
}
