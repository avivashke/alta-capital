// Educational Strategy Academy & Chat Tutor.
// Teaches the user how the firm's most successful trading strategies work,
// explains live parameters, Walk-Forward / OOS metrics, Gann methods, and risk management.

import { store } from './store.js';
import { STRATEGIES, describeParams } from './strategies.js';
import { chatDetailed, hasModelKey } from './llm.js';

export const STRATEGY_GUIDES = {
  ema_trend: {
    id: 'ema_trend',
    title: 'מגמת ממוצעים נעים (EMA Trend)',
    category: 'מעקב מגמה (Trend Following)',
    bestFor: 'שווקים בעלי כיוון ברור (טרנדיים) בטיים-פריים של 15m, 1h ו-1d',
    howItWorks: 'האסטרטגיה עוקבת אחרי חצייה של ממוצע נע מהיר (Fast) מעל או מתחת לממוצע נע איטי (Slow), יחד עם פילטר מגמה ארוך-טווח (EMA 200). כאשר המהיר מעל האיטי והמחיר מעל EMA 200 — נפתחת פוזיציית לונג.',
    mathAndParams: 'פרמטרים מרכזיים: fast (4-30 נרות), slow (24-110 נרות), atrStop (מרחק סטופ בכפולות ATR), ו-rr (יחס סיכוי/סיכון Take-Profit מול Stop-Loss).',
    prosAndCons: 'יתרון: תופסת מהלכים גדולים ומונעת כניסה נגד המגמה הראשית. חיסרון: בשוק מדשדש (אופקי) עלולה לייצר כניסות שווא קטנות.',
  },
  breakout: {
    id: 'breakout',
    title: 'פריצת ערוץ דונצ׳יאן (Donchian Breakout)',
    category: 'פריצות מומנטום (Breakout)',
    bestFor: 'תפיסת פריצות חזקות לאחר התכנסות ב-1h, 1d ו-1w',
    howItWorks: 'בונה ערוץ מהשיא הגבוה ביותר והשפל הנמוך ביותר ב-N הנרות האחרונים. כאשר מחיר הסגירה פורץ מעל השיא הקודם (בכיוון מגמת ה-SMA 200) נפתחת עסקת לונג, והיציאה מתבצעת בחזרה לקו האמצע של הערוץ או ביעד ה-ATR.',
    mathAndParams: 'פרמטרים: period (אורך הערוץ, 10-60 נרות), filter (הפעלת פילטר מגמה 200), atrStop ו-rr.',
    prosAndCons: 'יתרון: לעולם לא תפספס מהלך פריצה ענק ("טרנד שבורח"). חיסרון: אחוז פגיעה (Win Rate) בינוני שמפוצה על ידי עסקאות מנצחות גדולות מאוד (Profit Factor גבוה).',
  },
  rsi_reversion: {
    id: 'rsi_reversion',
    title: 'חזרה לממוצע (RSI Mean Reversion)',
    category: 'חזרה לממוצע (Mean Reversion)',
    bestFor: 'שווקים תנודתיים או מתכנסים (Range) ב-5m, 15m ו-1h',
    howItWorks: 'נכנסת לפוזיציה כאשר השוק מגיע למצב קיצון של מכירת-יתר (RSI נמוך מ-oversold, למשל 25) או קניית-יתר (RSI גבוה מ-overbought, למשל 75), וסוגרת את העסקה ברגע שה-RSI חוזר לקו שיווי המשקל (50).',
    mathAndParams: 'פרמטרים: period (תקופת RSI, 7-22), oversold (15-35), overbought (65-85), atrStop ו-rr.',
    prosAndCons: 'יתרון: אחוז הצלחה (Win Rate) גבוה מאוד בשווקים נורמליים. חיסרון: דורשת סטופ ATR קפדני כדי לא להילכד במפולת חדה.',
  },
  momentum: {
    id: 'momentum',
    title: 'מומנטום קצב שינוי (ROC Momentum)',
    category: 'מומנטום מהיר',
    bestFor: 'תנועות חדות ואימפולסים מהירים ב-5m, 15m ו-1h',
    howItWorks: 'מודדת את אחוז השינוי במחיר (Rate of Change) על פני N נרות. רק כאשר עוצמת הדחיפה עוברת סף אחוזי מוגדר (threshold) — האסטרטגיה מצטרפת לתנועה.',
    mathAndParams: 'פרמטרים: period (3-28 נרות), threshold (0.1%-2.4% סף כניסה), atrStop ו-rr.',
    prosAndCons: 'יתרון: מסננת תנועות חלשות ונכנסת רק כשיש כוח קנייה/מכירה מובהק.',
  },
  macd_swing: {
    id: 'macd_swing',
    title: 'סווינג MACD + פילטר מגמה',
    category: 'סווינג ומגמה',
    bestFor: 'מסחר סווינג ב-1h, 1d ו-1w',
    howItWorks: 'משלבת את היסטוגרמת ה-MACD (ההפרש בין קו ה-MACD לקו הסיגנל) עם ממוצע EMA 200. כניסה ללונג מתבצעת רק כשההיסטוגרמה חיובית וגם המחיר מעל EMA 200.',
    mathAndParams: 'פרמטרים: fast (6-18), slow (20-42), signal (6-14), atrStop ו-rr.',
    prosAndCons: 'יתרון: שילוב קלאסי בין מומנטום למגמה שמקטין משמעותית עסקאות סרק.',
  },
  gann_swing_sq9: {
    id: 'gann_swing_sq9',
    title: 'גאן רמות ויברציה וריבוע התשע (Gann Square of 9 Vibration)',
    category: 'גאומטריית גאן ומחיר',
    bestFor: 'זיהוי רמות מפנה מתמטיות (45°–360°) ופריצות הרמוניות בכל טווחי הזמן',
    howItWorks: 'מזהה נקודת עוגן (Auto Pivot High/Low) ומחשבת את רמות הוויברציה לפי הנוסחה הקלאסית של גאן: Price = (√Anchor + (Degree / 180) × Direction)². רמות קרדינליות (90°, 180°, 270°, 360°) משמשות כהתנגדות/תמיכה ראשית ורמות אורדינליות (45°, 135°, 225°, 315°) כיעדי ביניים.',
    mathAndParams: 'פרמטרים: lookback (20-90 נרות לזיהוי הפיבוט העוגן), stepDiv (4-16 — חלוקת זוויות במעגל 180°/360°), atrStop ו-rr.',
    prosAndCons: 'יתרון: ממפה מראש רמות שורש ריבועי של מחיר וזמן שלרוב הסוחרים אין על הגרף, עם יחס סיכוי/סיכון מצוין.',
  },
  gann_time_cycle: {
    id: 'gann_time_cycle',
    title: 'גאן מחזורי זמן ומומנטום (Gann Time Cycles)',
    category: 'מחזורי זמן של גאן',
    bestFor: 'תיזמון כניסות בחלונות מפנה מחזוריים (1h, 1d, 1w)',
    howItWorks: 'לפי תורת גאן, הזמן הוא הגורם הדומיננטי בשוק. האסטרטגיה מחלקת את ציר הזמן למחזורים קבועים (למשל 21, 45, 90 או 144 נרות) ופותחת פוזיציות חדשות בחלונות המפנה של המחזור כשכיוון ה-EMA והמומנטום (ROC) מתלכדים.',
    mathAndParams: 'פרמטרים: cycle (21-144 נרות), mom (תקופת מומנטום), emaFast, emaSlow, atrStop ו-rr.',
    prosAndCons: 'יתרון: מונעת מסחר-יתר באמצע תנועה אקראית וממקדת כניסות בחלונות זמן בעלי הסתברות גבוהה.',
  },
  supertrend_adx: {
    id: 'supertrend_adx',
    title: 'Supertrend + עוצמת מגמה ADX',
    category: 'מעקב מגמה כמותי',
    bestFor: 'מגמות חזקות ב-15m, 1h ו-1d',
    howItWorks: 'משתמשת באינדיקטור Supertrend (מבוסס ATR) לקביעת כיוון וסטופ נגרר, אך מוסיפה תנאי סף קריטי: מדד ה-ADX חייב להיות מעל adxMin (למשל 22) כדי להבטיח שהשוק אכן במגמה ולא בדשדוש.',
    mathAndParams: 'פרמטרים: period (7-21), mult (מכפיל ATR ל-Supertrend, 1.5-4.5), adxPeriod (10-20), adxMin (15-35).',
    prosAndCons: 'יתרון: ה-ADX מסנן כ-60% מהאותות השגויים של Supertrend בזמן דשדוש.',
  },
  mean_reversion_z: {
    id: 'mean_reversion_z',
    title: 'חזרה לממוצע סטטיסטית (Z-Score + Bollinger)',
    category: 'ארביטראז׳ סטטיסטי / קוונט',
    bestFor: 'מסחר כמותי תוך-יומי (5m, 15m, 1h)',
    howItWorks: 'מחשבת כמה סטיות תקן (Z-Score) המחיר התרחק מהממוצע שלו. כאשר Z ≤ -z (למשל 2 סטיות תקן מתחת לממוצע) נפתחת עסקת לונג, והיציאה מתבצעת כשהמחיר מתכנס חזרה לאזור הממוצע (Z ≈ 0).',
    mathAndParams: 'פרמטרים: period (14-50 נרות), z (סף סטיות תקן לכניסה, 1.2-3.0), atrStop ו-rr.',
    prosAndCons: 'יתרון: מבוססת על התפלגות נורמלית וסטטיסטיקה טהורה; יעילה מאוד בתיקוני יתר.',
  },
  vol_breakout: {
    id: 'vol_breakout',
    title: 'פריצת תנודתיות + יחס יעילות (ATR + Kauffman ER)',
    category: 'קוונט ופריצת תנודתיות',
    bestFor: 'שווקים מתפרצים בקריפטו (BTC, ETH, SOL)',
    howItWorks: 'בונה מעטפת תנודתיות סביב EMA באמצעות מכפיל ATR, ובודקת את מדד היעילות של קאופמן (Efficiency Ratio = שינוי נטו חלקי סך התנודות). פריצה מאושרת רק כשהתנועה "נקייה" ויעילה (ER ≥ erMin).',
    mathAndParams: 'פרמטרים: emaP (14-40), atrP (10-20), mult (1.0-3.0), erP (8-20), erMin (0.2-0.6).',
    prosAndCons: 'יתרון: מדד ה-Efficiency Ratio מונע כניסה לפריצות רועשות ומתמקד בתנועות מוסדיות חלקות.',
  },
};

export function getTopDesks(state = store.state) {
  const desks = [...(state.desks || [])];
  return desks.sort((a, b) => {
    const scoreA = (a.oosMetrics?.returnPct ?? a.bestReturn ?? -999) + ((a.assessment?.robustness ?? 0) * 0.15);
    const scoreB = (b.oosMetrics?.returnPct ?? b.bestReturn ?? -999) + ((b.assessment?.robustness ?? 0) * 0.15);
    return scoreB - scoreA;
  });
}

export const EDUCATIONAL_PROMPTS = [
  '🏆 נתח לי את האסטרטגיה הכי מוצלחת כרגע בחדר המסחר ואיך היא עובדת',
  '📚 למד אותי שילוב ניתוח טכני + פונדמנטליסטי (מכפילים, מאקרו, VIX ותזרים)',
  '📐 איך עובדות אסטרטגיות גאן (Square of 9 ומחזורי זמן) במערכת?',
  '🔬 מה זה Walk-Forward ומונטה-קרלו ואיך הם מונעים Overfitting?',
  '📈 הסבר לי על Supertrend + ADX ועל פריצת תנודתיות (ATR/ER)',
  '🛡 איך עובד ניהול הסיכונים, Stop-Loss ב-ATR וחישוב גודל פוזיציה?',
];

export function buildLocalEducationalReply(question, state = store.state) {
  const q = String(question || '').toLowerCase();
  const ranked = getTopDesks(state);
  const best = ranked[0];
  const bestGuide = best?.strategyId ? STRATEGY_GUIDES[best.strategyId] : null;

  // 1. Specific strategy match
  for (const [id, guide] of Object.entries(STRATEGY_GUIDES)) {
    const matchId = q.includes(id.toLowerCase()) || q.includes(guide.title.toLowerCase());
    if (matchId) {
      const liveDesks = (state.desks || []).filter((d) => d.strategyId === id);
      const liveText = liveDesks.length
        ? liveDesks.map((d) => `• ${d.label} (${d.symbol} · ${d.tf}): תשואת OOS ${d.oosMetrics?.returnPct ?? d.bestReturn ?? '—'}% · Profit Factor ${d.metrics?.profitFactor ?? '—'} · חוסן ${d.assessment?.robustness ?? '—'}/100 · פרמטרים: ${describeParams(id, d.params)}`).join('\n')
        : '• כרגע לא מוצמדת לשולחן פעיל, אך זמינה במעבדת האסטרטגיות ובאופטימייזר.';
      return `🎓 שיעור מעמיק: ${guide.title}
קטגוריה: ${guide.category}
מתאימה במיוחד ל: ${guide.bestFor}

איך האסטרטגיה עובדת צעד אחר צעד?
- ${guide.howItWorks}

המתמטיקה והפרמטרים שמכוילים על ידי הסוכנים:
- ${guide.mathAndParams}

יתרונות וניהול סיכונים:
- ${guide.prosAndCons}

ביצועים חיים כרגע בשולחנות החברה:
${liveText}`;
    }
  }

  // 1b. Technical + Fundamental Analysis Masterclass
  if (/פונדמנט|מכפיל|מאקרו|vix|sec|תזרים|טכני \+/.test(q)) {
    const f = state.fundamentals || {};
    const m = f.macro;
    const macroLine = m
      ? `VIX: ${m.vix?.toFixed?.(2) ?? '—'} · תשואת אג"ח 10Y: ${m.us10yYield?.toFixed?.(2) ?? '—'}% · דולר DXY: ${m.dxy?.toFixed?.(2) ?? '—'} (${m.regime || 'מאוזן'})`
      : 'לחץ "רענן זרם פונדמנטליסטי" במסך סנטימנט כדי לטעון נתוני מאקרו חיים.';
    return `📚 שיעור משולב: ניתוח טכני + ניתוח פונדמנטליסטי + מאקרו
איך משלבים את שני העולמות כמו קרן גידור מקצועית?

1. הניתוח הפונדמנטליסטי (מה לקנות — איכות הנכס):
- מניות (נשאב אצלנו חינם מ-SEC EDGAR 10-K/10-Q):
  • מכפיל רווח (P/E = מחיר / EPS): בודק כמה משלמים על כל דולר רווח.
  • שולי רווח נקי (Net Margin % = רווח נקי / הכנסות): מודד רווחיות אמיתית וכוח תמחור.
  • יחס חוב לנכסים (Debt / Assets %): בודק עמידות בסביבת ריבית גבוהה.
- קריפטו (נשאב מ-CoinGecko): שווי שוק, נפח מסחר 24h, היצע במחזור מול מקסימלי ומרחק משיא כל הזמנים (ATH).

2. סביבת המאקרו (הקשר השוק — חי מ-Yahoo Finance):
- ${macroLine}
- כלל אצבע: כשמדד הפחד VIX > 25 או תשואת האג"ח עולה חד, השוק במצב Risk-Off ודורש סטופים רחבים יותר ומינוף נמוך.

3. הניתוח הטכני + גאן (מתי להיכנס ולצאת — תזמון מדויק):
- אחרי שהפונדמנטל סינן נכסים איכותיים, הניתוח הטכני (EMA 20/50/200, RSI, MACD, ADX, ATR) ורמות הוויברציה של גאן (Square of 9) קובעים את נקודת הכניסה והיציאה המדויקת עם יחס סיכוי/סיכון מוגדר.`;
  }

  // 2. Gann strategies lesson
  if (/גאן|gann|ריבוע התשע|square|זוויות|מחזורי זמן/.test(q)) {
    const sq9 = STRATEGY_GUIDES.gann_swing_sq9;
    const tc = STRATEGY_GUIDES.gann_time_cycle;
    return `📐 מדריך אסטרטגיות גאן (W.D. Gann) במערכת Alta Capital:
במערכת פועלים 5 אנליסטי גאן ייעודיים (גדעון, גליה, גיל, גלעד וגנית) שמיישמים את נוסחאות הוויברציה והזמן של גאן:

1. ${sq9.title}:
- נוסחת רמות הוויברציה: Price = (√Anchor + (Degree / 180) × Direction)²
- זוויות קרדינליות (Cardinal): 90°, 180°, 270°, 360° — רמות התנגדות/תמיכה ראשיות.
- זוויות אורדינליות (Ordinal): 45°, 135°, 225°, 315° — נקודות מפנה משניות.
- ${sq9.howItWorks}
- פרמטרים: ${sq9.mathAndParams}

2. ${tc.title} (Master Time Calculator):
- ${tc.howItWorks}
- פרמטרים: ${tc.mathAndParams}

למה השילוב שלהן חזק?
- בעוד אינדיקטורים רגילים (כמו RSI או ממוצע נע) מגיבים באיחור למחיר, נוסחת השורש הריבועי של גאן ומחזורי הזמן ממפים מראש את נקודות ההתכנסות שבהן השוק נוטה לבצע היפוך או פריצה.`;
  }

  // 3. Walk-Forward & Overfitting lesson
  if (/walk-forward|overfitting|מונטה|חוסן|אימות|בקטסט/.test(q)) {
    return `🔬 איך המערכת מוודאת שאסטרטגיה באמת מוצלחת ולא "מזייפת" (Overfitting)?
הרבה מערכות מסחר נופלות כי הן מתאימות פרמטרים בדיעבד להיסטוריה. ב-Alta Capital כל אסטרטגיה חייבת לעבור 4 מבחנים קפדניים לפני שהיא מקבלת גרסה:

1. חלוקת In-Sample (70%) מול Out-Of-Sample (30%):
- האופטימייזר של ליה מכייל את הפרמטרים אך ורק על 70% הראשונים של הנרות.
- אחר כך איתי בודק את אותם פרמטרים בדיוק על 30% הנרות האחרונים שהמודל לא ראה מעולם (OOS). רק אם ה-OOS רווחי ומשתפר מעל סף הקידום — הגרסה מאושרת.

2. חלונות Walk-Forward מתגלגלים:
- הסוכנים מחלקים את ההיסטוריה למקטעים עוקבים ובודקים שהאסטרטגיה יציבה לאורך תקופות שוק שונות (עליות, ירידות ודשדוש).

3. סימולציית מונטה-קרלו (Monte Carlo):
- מערבבים באקראי את סדר העסקאות מאות פעמים כדי לבדוק מהו ה-Drawdown הגרוע ביותר הצפוי ב-95% מהמקרים.

4. רגישות פרמטרים (Parameter Sensitivity):
- בודקים ששינוי קטן בפרמטר (למשל EMA מ-20 ל-22) לא מרסק את התשואה. הציון המשוקלל נקרא "חוסן סטטיסטי" (0–100).`;
  }

  // 4. Risk management & ATR lesson
  if (/סיכון|atr|סטופ|stop|פוזיציה|drawdown|עמלות|מס/.test(q)) {
    return `🛡 שיעור בניהול סיכונים, Stop-Loss דינמי ב-ATR ומיסוי:
אסטרטגיה מוצלחת נמדדת קודם כל בכמה מעט היא מפסידה כשהיא טועה:

1. סטופ דינמי לפי תנודתיות (ATR Stop):
- במקום סטופ באחוז קבוע שנתפס ברעשי שוק, הסוכנים מחשבים את ה-ATR (טווח תנועה ממוצע של נר ב-14 נרות אחרונים).
- מרחק הסטופ נקבע כ: \`Stop Distance = atrStop × ATR\`. כשהשוק סוער הסטופ מתרחב אוטומטית, וכשהשוק רגוע הוא מתהדק.

2. גודל פוזיציה אחיד לפי סיכון (Risk-Based Position Sizing):
- בכל עסקה מסכנים רק אחוז קבוע מההון (למשל 1.5%). אם הסטופ רחוק, כמות המטבעות קטנה אוטומטית כך שהפסד מקסימלי בעסקה לא יעבור את תקציב הסיכון.

3. יחס סיכוי/סיכון (R:R — Reward to Risk):
- יעד הרווח (Take Profit) מוגדר ככפולה של מרחק הסטופ (\`Target = Stop Distance × rr\`). ביחס 2:1 מספיק להצליח ב-40% מהעסקאות כדי להיות רווחיים!

4. רווח נטו אחרי עמלות ומס רווחי הון:
- תיק הנייר מנכה עמלות Maker/Taker ו-25% מס רווחי הון (עם קיזוז הפסדים צבורים) כדי לשקף תוחלת אמיתית.`;
  }

  // 5. Compare trend vs mean reversion / all families
  if (/הבדל|מתי עדיף|השווה|משפחות|supertrend|פריצת תנודתיות/.test(q)) {
    return `📊 השוואה בין משפחות האסטרטגיות במערכת ומתי כל אחת מנצחת:

1. אסטרטגיות מעקב מגמה (EMA Trend, MACD Swing, Supertrend + ADX):
- איך מרוויחות: רוכבות על גלים ארוכים בכיוון המגמה הראשית.
- מתי מנצחות: בשווקים כיווניים (Bull / Bear ברור) ובטווחי זמן של 1h, 1d, 1w.

2. אסטרטגיות פריצה (Donchian Breakout, Volatility Breakout ATR/ER):
- איך מרוויחות: נכנסות ברגע שהמחיר פורץ טווח דשדוש או מעטפת תנודתיות עם יעילות תנועה גבוהה (Efficiency Ratio).
- מתי מנצחות: בתחילת ראלי חד או שבירת תמיכה מרכזית.

3. אסטרטגיות חזרה לממוצע (RSI Reversion, Z-Score Mean Reversion):
- איך מרוויחות: קונות בפאניקה (קיצון שלילי) ומוכרות באופוריה (קיצון חיובי).
- מתי מנצחות: בשווקים תנודתיים ללא מגמה חד-כיוונית (5m, 15m, 1h).

4. אסטרטגיות גאן (Gann Square of 9, Gann Time Cycles):
- איך מרוויחות: מזהות נקודות איזון גאומטריות בין מחיר לזמן שבהן מתחלפים מחזורים.`;
  }

  // 6. Default: Deep dive into the current #1 most successful strategy in the firm!
  if (best && bestGuide) {
    const oos = best.oosMetrics?.returnPct ?? best.bestReturn ?? 0;
    const isRet = best.isMetrics?.returnPct ?? best.metrics?.returnPct ?? 0;
    const pf = best.metrics?.profitFactor ?? '—';
    const dd = best.metrics?.maxDrawdownPct ?? '—';
    const rob = best.assessment?.robustness ?? '—';
    const paramsText = describeParams(best.strategyId, best.params);

    const others = ranked.slice(1, 4).map((d, idx) => {
      const g = STRATEGY_GUIDES[d.strategyId] || { title: d.strategyId || 'במחקר' };
      return `${idx + 2}. ${d.label} (${d.symbol} · ${d.tf}) — ${g.title} · OOS: ${d.oosMetrics?.returnPct ?? d.bestReturn ?? '—'}% · PF: ${d.metrics?.profitFactor ?? '—'} · חוסן: ${d.assessment?.robustness ?? '—'}/100`;
    }).join('\n');

    return `🏆 ניתוח האסטרטגיה המובילה כרגע בחדר המסחר:
השולחן המצטיין הוא **${best.label} (${best.symbol} · ${best.tf})** עם האסטרטגיה **${bestGuide.title}** (${best.version || 'בכיול'}).

📊 מדדי הביצועים שנמדדו בבקטסט וב-Walk-Forward:
- תשואת Out-Of-Sample (נתונים חדשים): ${oos}% (תשואת In-Sample: ${isRet}%)
- מקדם רווח (Profit Factor): ${pf} (יחס סך הרווחים לסך ההפסדים)
- נסיגה מקסימלית (Max Drawdown): ${dd}%
- ציון חוסן סטטיסטי (Robustness): ${rob}/100
- פרמטרים מכוילים: ${paramsText}

🧠 למה האסטרטגיה הזו מצליחה ואיך היא פועלת?
- עיקרון פעולה: ${bestGuide.howItWorks}
- התאמה לשוק: ${bestGuide.bestFor}
- ניהול סיכון: ${bestGuide.prosAndCons}

🥈 השולחנות הבאים בדירוג ההצלחה כרגע:
${others || 'הרץ מחזור אופטימיזציה כדי לדרג שולחנות נוספים.'}

💡 רוצה להעמיק? לחץ על אחת המשפחות למעלה או שאל אותי על כל פרמטר (למשל: "איך עובד גאן ריבוע התשע?" או "מה זה Walk-Forward?").`;
  }

  return `🎓 ברוך הבא לצ׳אט החינוכי של Alta Capital!
כאן תוכל ללמוד לעומק על כל 10 משפחות האסטרטגיות של הצוות, להבין למה האסטרטגיות המובילות מנצחות ב-Out-Of-Sample, ואיך עובדים אינדיקטורי גאן, Walk-Forward וניהול סיכונים ב-ATR.
בחר נושא מהכפתורים המהירים או לחץ על אחת האסטרטגיות המובילות כדי לקבל שיעור מפורט.`;
}

export async function askEducationalTutor(question, history = []) {
  const state = store.state;
  const localLesson = buildLocalEducationalReply(question, state);
  if (!hasModelKey()) {
    return localLesson;
  }

  const ranked = getTopDesks(state);
  const topSummary = ranked.map((d) => ({
    desk: d.label,
    symbol: d.symbol,
    tf: d.tf,
    version: d.version,
    strategyId: d.strategyId,
    strategyTitle: STRATEGIES[d.strategyId]?.label || d.strategyId,
    params: d.params,
    oosReturnPct: d.oosMetrics?.returnPct ?? d.bestReturn,
    profitFactor: d.metrics?.profitFactor,
    maxDrawdownPct: d.metrics?.maxDrawdownPct,
    robustness: d.assessment?.robustness,
  }));

  const system = `אתה המנטור והמרצה הראשי באקדמיית המסחר הכמותי של Alta Capital.
תפקידך ללמד את המשתמש בצורה בהירה, מרתקת, מובנית ומעשית על אסטרטגיות המסחר המוצלחות של החברה, אינדיקטורים טכניים, שיטות W.D. Gann (ריבוע התשע, מניפות זוויות, מחזורי זמן), אופטימיזציית Walk-Forward וניהול סיכונים.
השתמש בנתוני האמת של השולחנות המובילים כרגע:
${JSON.stringify(topSummary, null, 2)}

כללי תשובה:
- ענה בעברית ברורה, חינוכית ומסודרת עם נקודות (•).
- הסבר את ההיגיון הכלכלי והמתמטי מאחורי האסטרטגיה והפרמטרים שלה.
- הדגש איך מונעים Overfitting ואיך מנהלים סיכון עם ATR Stop ו-Reward:Risk.`;

  try {
    const res = await chatDetailed({
      system,
      messages: [
        ...history.slice(-6).map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content })),
        { role: 'user', content: question },
      ],
      maxTokens: 1100,
    });
    if (res?.text && res.text.trim().length > 40) {
      return res.text.trim();
    }
  } catch {
    // Fall back cleanly to our rich built-in educational tutor
  }
  return localLesson;
}
