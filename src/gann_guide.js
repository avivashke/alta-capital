// Comprehensive Interactive Hebrew Educational Guide & Modal System for the Gann Lab (#/gann).
// Explains every wheel, infographic, chart, color legend, and calculator on the page,
// dynamically binding live numbers from the currently loaded asset + optional AI deep-dive!

import { h, num, tag, openModal } from './ui.js';
import { chatDetailed } from './llm.js';

export const GANN_GUIDE_TOPICS = {
  fan_chart: {
    icon: '📈',
    title: 'מפת חיזוי, מניפת גאן (9 זוויות), תיבת גאן וסווינג',
    short: 'הגרף הראשי: איך קוראים את הקווים האלכסוניים, הרמות האופקיות והכוכבים על הגרף.',
    whatItIs:
      'זהו הגרף הראשי של מעבדת גאן. הוא משלב על גבי נרות המחיר האמיתיים של הנכס את "מניפת גאן" (9 קרניים אלכסוניות שיוצאות מנקודת העוגן), רמות תמיכה והתנגדות אופקיות מ-Square of 9, תיבת גאן (חלוקה גיאומטרית של זמן ומחיר לשמיניות/רבעים) וקו סווינג שמסנן רעש.',
    legend: [
      '🟢 קו 1x1 (45° — קו האיזון המרכזי): קו המגמה החשוב ביותר של גאן. כשהמחיר מעליו — המומנטום שורי; שבירה שלו מסמנת מעבר לקו 1x2.',
      '📐 קווי 2x1 / 4x1 / 8x1 (תלולים יותר): מגמה מואצת וחזקה במיוחד. קווי 1x2 / 1x4 / 1x8 (מתונים יותר): אזורי תמיכה עמוקים יותר במקרה של תיקון.',
      '📏 קווים אופקיים מקווקווים (Sq9): רמות מחיר מרכזיות ב-90° / 180° / 360° מנקודת העוגן שמשמשות יעדי רווח ותמיכה/התנגדות.',
      '▦ תיבת גאן (Gann Box): מחלקת את הטווח ל-25% / 50% / 75% במחיר ובזמן — נקודת ה-50% היא קו שיווי המשקל של גאן.',
      '★ כוכבים מוזהבים על הגרף: אירועים פונדמנטליסטיים היסטוריים (החלטות ריבית פד, CPI, חצייה) שמחזורי גאן סימנו את התאריך שלהם מראש.',
    ],
    howToUse:
      'חפש "התכנסות" (Confluence): נקודה שבה המחיר פוגש גם קו מניפה (כמו 1x1 או 1x2), גם רמת Sq9 אופקית וגם חלון זמן עתידי. אף פעם אל תיכנס לעסקה רק בגלל קו אחד — המתן לאישור נר היפוך והצב סטופ-לוס מוגדר.',
    liveReadout: (a, symbol) => [
      `נכס פעיל: ${symbol} · מחיר נוכחי: ${num(a.currentPrice, 2)}`,
      `עוגן המניפה: ${num(a.anchorPivot?.price, 2)} (${a.anchorPivot?.type === 'low' ? 'שפל מרכזי' : 'שיא מרכזי'})`,
      `מיקום מול זווית 1x1: ${a.angle1x1?.abovePrice ? 'מעל 1x1 (יתרון שורי)' : 'מתחת ל-1x1 (יתרון דובי/תיקון)'} (1x1 כרגע ב-${num(a.angle1x1?.projectedNow, 2)})`,
      `תמיכה קרובה במניפה: ${a.gannFan?.activeSupport?.id || '—'} · התנגדות קרובה: ${a.gannFan?.activeResistance?.id || '—'}`,
    ],
  },

  gannzilla_wheel: {
    icon: '☸️',
    title: 'גלגל Gannzilla Pro v8.3 (Square of 9, הקסגון, מד-זווית וקוסמוגרם)',
    short: 'מה אומר הגלגל העגול, הטבעות, הצלב הצהוב, המחט והסמלים החיצוניים?',
    whatItIs:
      'גלגל Gannzilla הוא מחשבון גיאומטרי מעגלי שהמציא וו.ד. גאן (במקור על נייר משבצות — "Square of 9"). המספרים גדלים בספירלה מהמרכז החוצה: כל סיבוב שלם (360°) הוא "טבעת" חדשה. רעיון הליבה של גאן הוא שנקודות שיושבות על אותה זווית (90°, 180°, 270°, 360°) מהדהדות אחת עם השנייה ויוצרות אזורי בלימה והיפוך מחיר.',
    legend: [
      '🟡 המחט הצהובה: מצביעה על הזווית הנוכחית של מחיר השוק על הגלגל (0° עד 359°).',
      '➕ הצלב המרכזי (Cardinal Cross — 0°/90°/180°/270°): הזוויות החזקות ביותר בגלגל — רמות התנגדות ותמיכה עיקריות.',
      '✖️ האלכסונים (Ordinal Cross — 45°/135°/225°/315°): זוויות משנה חשובות שבהן מתרחשים תיקונים קצרים.',
      '🗓️ הטבעת החיצונית (כרונומטר / תאריכים): ממפה את 365 ימי השנה ל-360° (מ-21 במרץ = 0°). כשמחט המחיר והתאריך מתיישרות — זהו "ריבוע מחיר וזמן".',
      '🪐 סמלי הכוכבים מסביב (קוסמוגרם): מציגים את האורך האסטרונומי (0°–360°) של השמש וכוכבי הלכת. ניתן לכבות/להדליק בכפתור "כוכבים".',
      '🔷 פריסות נוספות (Sq4, Sq144, הקסגון 60°, משולש 120°, גלגל 24): משנות את המבנה הגיאומטרי — למשל הקסגון מחלק סיבוב לקפיצות של 60° (מעולה לקריפטו ומניות תנודתיות).',
    ],
    howToUse:
      'שים לב לזווית המחט הצהובה: כשהמחיר מגיע ל-90° או 180° מנקודת העוגן (אחד מקווי מד-הזווית שבחרת), הסיכוי לעצירה או היפוך עולה משמעותית. שחק עם כפתור "מד-זווית" (צלב / משולש / הקסגון) כדי לראות איזו צורה חותכת את השיאים והשפלים ההיסטוריים של הנכס.',
    liveReadout: (a, symbol, cfg) => [
      `פריסה פעילה: ${(cfg?.layout || 'sq9').toUpperCase()} · מד-זווית: ${cfg?.protractor || 'cross'}`,
      `זווית המחיר הנוכחי של ${symbol} (מחט צהובה): ${a.msjSq9?.wheelAngle ?? 0}°`,
      `טבעת Square of 9 נוכחית: טבעת #${a.jenkins?.ringNumber ?? '—'}`,
      `StartValue=${cfg?.startValue ?? 1} · Increment=${cfg?.increment ?? 1} · AngleOffset=${cfg?.angleOffset ?? 0}°`,
    ],
  },

  msj_calc: {
    icon: '🧮',
    title: 'מנוע MSJ_GannSQ9, מניפת גאן, מחשבוני ג׳נקינס, שמיניות והקסגון',
    short: '6 טאבים של מחשבונים מספריים מדויקים ליעדי מחיר, תמיכות ותזמון.',
    whatItIs:
      'כאן נמצאים החישובים המספריים המדויקים שמאחורי הגרפים והגלגל, מחולקים ל-6 לשוניות כדי שתוכל לקרוא מספרים מדויקים להצבת פקודות ויעדים:',
    legend: [
      '📐 מניפת גאן (9 זוויות): מציגה את המחיר המדויק של כל אחת מ-9 הזוויות (8x1 עד 1x8) בנר הנוכחי — ירוק = תמיכה מתחת למחיר, אדום = התנגדות מעל המחיר.',
      '🔢 מטריצת MSJ_GannSQ9: טבלת ספירלה אינטראקטיבית לפי שיטת מייקל ג׳נקינס — לחיצה על כל תא צובעת אותו ומראה את זוויתו. תאים מודגשים הם זוויות 90°/180°/360°.',
      '🎯 מעלות וזמני MSJ: טבלה ישירה של יעדי מחיר למעלה (+) ולמטה (-) עבור 45°, 90°, 120°, 180°, 270°, 360°, 540° ו-720°.',
      '√ √Price + ספירלה (ג׳נקינס): הנוסחה המפורסמת (√P ± k)² — שורש המחיר פלוס/מינוס 0.25 (90°), 0.5 (180°), 1.0 (360°), בריבוע.',
      '🍰 שמיניות (1/8–8/8): חוק השמיניות של גאן — מחלק את טווח השיא-שפל ל-8 חלקים שווים. רמת 4/8 (50%) היא החזקה ביותר, ו-2/8 (25%) ו-6/8 (75%) הן אזורי היפוך משניים.',
      '⬡ הקסגון (60°): יעדי מחיר המבוססים על צמיחה הקסגונלית של 60°/120°/180°/360°.',
    ],
    howToUse:
      'התחל בלשונית "מעלות וזמני MSJ" או "שמיניות" כדי לזהות את 2 רמות התמיכה הקרובות ו-2 יעדי הרווח הקרובים לנכס שלך. אם ה-Scale לא מתאים למחיר, השתמש בכרטיס "אכלוס חכם" למעלה.',
    liveReadout: (a, symbol) => [
      `שורש המחיר (√P): ${a.msjSq9?.sqrtVal ?? '—'} · זווית: ${a.msjSq9?.wheelAngle ?? 0}°`,
      `יעד Sq9 קרוב למעלה/למטה: ${(a.sq9Levels || []).slice(0, 3).map((l) => `${l.degree}°=${num(l.price, 2)}`).join(' · ') || '—'}`,
      `יחידת מניפה פעילה: ${a.gannFan?.unitPerBar ?? '—'} ליחידה לנר (${a.gannFan?.barsElapsed ?? 0} נרות מהעוגן)`,
    ],
  },

  gann_rules: {
    icon: '📐',
    title: 'צ׳ק-ליסט 6 כללי המסחר של W.D. Gann (ציון התכנסות)',
    short: 'איך המערכת משקללת 6 חוקים של גאן לציון אחד של 0–100.',
    whatItIs:
      'במקום לנחש האם התמונה הכללית של גאן חיובית או שלילית, הצ׳ק-ליסט בודק אוטומטית 6 כללי ברזל שגאן לימד בספריו ("Gann Explained") ונותן ציון התכנסות (Confluence Score) מ-0 עד 100.',
    legend: [
      '🟢 ירוק (עבר): הכלל תומך במגמה הפעילה כרגע.',
      '⚪ אפור (ממתין/לא התקיים): התנאי עדיין לא הבשיל או נמצא בניגוד למגמה.',
      '📊 6 הכללים הנבדקים: (1) מחיר מעל/מתחת לזווית 1x1, (2) חוק ה-50% של הטווח, (3) מבנה הסווינג, (4) קרבה לרמת Square of 9, (5) חלון זמן קרוב, (6) שיעור הפגיעה ההיסטורי על הנכס.',
    ],
    howToUse:
      'ציון מעל 65/100 מעיד על התאמה חזקה בין מחיר, זמן וזוויות. ציון נמוך מ-45/100 הוא תמרור אזהרה להימנע מכניסה נמהרת ולהמתין להתכנסות ברורה יותר.',
    liveReadout: (a, symbol) => [
      `ציון התכנסות נוכחי עבור ${symbol}: ${a.confluence?.score ?? 0}/100 (${a.confluence?.verdict || '—'})`,
      `כללים שעברו: ${(a.confluence?.rules || []).filter((r) => r.passed).length}/${(a.confluence?.rules || []).length}`,
    ],
  },

  swing_cosmos: {
    icon: '🔭',
    title: 'סווינג גאן (1/2/3-Bar Swing) + היבטים פלנטריים (Cosmogram)',
    short: 'זיהוי מגמה נקי בלי רעש + היבטים זוויתיים אסטרונומיים.',
    whatItIs:
      'בחלק העליון מוצג "סווינג גאן" — שיטה מכנית לחלוטין שבה המגמה משנה כיוון רק אחרי 1, 2 או 3 נרות רצופים ששוברים שיא או שפל קודם (מסנן פריצות שווא). בחלק התחתון מוצגים היבטים גיאומטריים (0° צמידות, 90° ריבוע, 120° משולש, 180° ניגוד) בין כוכבי הלכת היום, תחום שגאן חקר בספרו "Tunnel Thru The Air".',
    legend: [
      '📈 שיא/שפל סווינג אחרון: הגבולות המדויקים שפריצתם מאשרת המשך מגמה או היפוך.',
      '🟡 נקודת 50% סווינג: מחצית הגל האחרון — אחד מאזורי התמיכה/התנגדות האמינים ביותר של גאן.',
      '🪐 סטייה (Orb): ככל שהסטייה קרובה יותר ל-0° (למשל ±1°), ההיבט הגיאומטרי מדויק וחזק יותר.',
    ],
    howToUse:
      'השתמש בנקודת ה-50% ובשיא/שפל הסווינג לקביעת סטופ-לוס טכני נקי. התייחס להיבטים הפלנטריים כתזמון משלים בלבד לתנודתיות צפויה — תמיד ודא אישור במחיר.',
    liveReadout: (a, symbol) => [
      `מגמת סווינג ב-${symbol}: ${a.swingChart?.trend === 'bullish' ? 'עולה (Bullish)' : a.swingChart?.trend === 'bearish' ? 'יורדת (Bearish)' : 'דשדוש'}`,
      `שיא סווינג: ${num(a.swingChart?.lastSwingHigh?.price, 2)} · אמצע 50%: ${num(a.swingChart?.midpoint50, 2)} · שפל סווינג: ${num(a.swingChart?.lastSwingLow?.price, 2)}`,
      `היבטים פלנטריים פעילים היום: ${(a.cosmogram?.aspects || []).length}`,
    ],
  },

  ephemeris: {
    icon: '🪐',
    title: 'טבלת Price-Time, Julian Day ואורך שמש (Ephemeris)',
    short: 'איך מחברים בין תאריך קלנדרי, מספר יוליאני (JD), קצב מחיר/יום ואורך השמש.',
    whatItIs:
      'טבלה זו מרכזת את כל נקודות המפנה ההיסטוריות (שיאים ושפלים) של הנכס עם חישוב מדויק של Julian Day (מספר ימים רציף באסטרונומיה שמאפשר לחסר תאריכים בלי תלות באורך החודשים), מספר הימים שעברו בין כל שני צירים (Δ ימים), קצב שינוי המחיר ליום, ואורך השמש (☉ במעלות 0°–360°).',
    legend: [
      '📆 Julian Day (JD): ספירת ימים אוניברסלית — הפרש ה-JD בין שתי נקודות מראה מיד אם עבר מחזור גאן (45, 90, 144, 180, 360 יום).',
      '⚡ קצב מחיר/יום: המהירות האמיתית של הגל בדולרים ליום — עוזרת לבחור קנה מידה מדויק למניפת 1x1.',
      '☀️ אורך שמש ☉: מיקום השמש במעלות (כ-1° ליום). גאן בדק האם הנכס נוטה להתהפך כשהשמש חוזרת לאותה מעלה או ל-90°/180° ממנה.',
      '⬆⬇ ייבוא/ייצוא CSV: מאפשר להעביר נתונים הלוך-חזור עם תוכנת PriceChartingTool החיצונית.',
    ],
    howToUse:
      'חפש בעמודת "Δ ימים" חזרות של מספרים זהים (למשל גלים בני 45 או 90 יום) ובעמודת "זווית Sq9" האם שיאים חוזרים סביב אותן מעלות.',
    liveReadout: (a, symbol) => [
      `טווח נרות ב-${symbol}: ${a.priceTimeInfo?.earliest?.date || '—'} עד ${a.priceTimeInfo?.latest?.date || '—'}`,
      `שיא טווח: ${num(a.priceTimeInfo?.highest?.price, 2)} (${a.priceTimeInfo?.highest?.date || '—'})`,
      `שפל טווח: ${num(a.priceTimeInfo?.lowest?.price, 2)} (${a.priceTimeInfo?.lowest?.date || '—'})`,
    ],
  },

  fundamental_proof: {
    icon: '⚡',
    title: 'הוכחת גאן מול אירועים פונדמנטליסטיים',
    short: 'בדיקה עובדתית: האם תאריכי המחזור של גאן התיישרו מראש עם החלטות פד, CPI ואירועי שוק?',
    whatItIs:
      'גאן טען ש"הזמן הוא החשוב ביותר" וששינויי מגמה משמעותיים מתוזמנים לפי מחזורי עבר — והחדשות הפונדמנטליות הן רק הזרז שמופיע כשהמחזור מגיע לבשלות. טבלה זו לוקחת אירועי אמת היסטוריים (החלטות ריבית פד, אינפלציה, חציית ביטקוין, דוחות) ובודקת מתמטית האם ציר עבר + מחזור גאן סימנו את התאריך הזה מראש.',
    legend: [
      '🟢 ✓ נחזה ע"י גאן: נמצא מחזור זמן או רמת מחיר Sq9 שיצאה מציר מוקדם יותר ופגעה בתאריך האירוע בטווח סטייה קטן.',
      '🔍 לחיצה על שורה: פותחת חלון הוכחה מלא עם תאריך ציר המקור, שם המחזור, הסטייה בימים וקישור למקור החדשות הרשמי.',
    ],
    howToUse:
      'בדוק את אחוז ההתאמה של הנכס. אם נכס מציג אחוז התאמה גבוה (>60%), חלונות הזמן העתידיים שלו אמינים יותר לתכנון סיכונים לפני אירועי מאקרו.',
    liveReadout: (a, symbol) => [
      `אירועים שנחזו מראש עבור ${symbol}: ${a.fundamentalProof?.matchedCount ?? 0} מתוך ${a.fundamentalProof?.totalInSpan ?? 0} (${a.fundamentalProof?.matchRatePct ?? 0}%)`,
    ],
  },

  future_pivots: {
    icon: '🔮',
    title: 'חיזוי עתידי של נקודות ציר + תיעוד חיזויי עבר שאומתו',
    short: 'אילו תאריכים קרובים הם "חלונות מפנה" פוטנציאליים ואיך הטכניקה עבדה בעבר.',
    whatItIs:
      'הכרטיס השמאלי מקרין קדימה את תאריכי המפנה העתידיים החזקים ביותר לפי צבירת מחזורי זמן (כמה מחזורים שונים — למשל 90 יום מהשפל + 144 יום מהשיא + תאריך עונתי — נופלים על אותו תאריך!). הכרטיס הימני מציג את תוצאות האמת של אותה שיטה על נתוני העבר.',
    legend: [
      '🟢 עוצמה גבוהה (ציון ≥ 5): התכנסות של מספר מחזורים יחד + לעתים חפיפה עם FOMC או תאריך עונתי.',
      '±Xd (סטייה בימים): בהיסטוריה, ככל שהסטייה קרובה יותר ל-0–2 ימים, כך התזמון היה חד יותר.',
      '🎯 יעד ↑: רמת Sq9 פוטנציאלית אם השוק יגיע לתאריך הזה במומנטום עולה.',
    ],
    howToUse:
      'סמן ביומן את התאריכים עם הציון הגבוה ביותר. יומיים לפני ועד יומיים אחרי תאריך כזה, היזהר מכניסות מאוחרות בסוף מהלך וחפש תבנית היפוך או פריצה נקייה.',
    liveReadout: (a, symbol) => [
      `חלון ציר עתידי קרוב ל-${symbol}: ${a.futurePivots?.[0]?.date || '—'} (בעוד ${a.futurePivots?.[0]?.daysAhead ?? '—'} ימים · ${a.futurePivots?.[0]?.confluenceLabel || ''})`,
      `דיוק היסטורי מדוד: ${a.hitRatePct ?? 0}% (${a.totalHits ?? 0}/${a.totalTests ?? 0} בדיקות)`,
    ],
  },

  calendars: {
    icon: '📅',
    title: 'לוחות השנה של Gannzilla וגאן (Calendars Suite)',
    short: '12 המזלות (30°), מחזורים פלנטריים, ריבועי 52/90/144 ו-8 התאריכים העונתיים.',
    whatItIs:
      'גאן עקב אחרי ארבעה לוחות זמן קבועים בשנה כדי לזהות תאריכי מפנה עונתיים ומחזוריים שמתרחשים כמעט כל שנה בשווקים:',
    legend: [
      '♈ 12 המזלות (30°): מחלקים את השנה ל-12 מקטעים שווים של ~30.4 ימים לפי תנועת השמש (למשל 21 במרץ = 0°, 21 ביוני = 90°, 23 בספטמבר = 180°, 21 בדצמבר = 270°).',
      '🪐 מחזורים פלנטריים: זמני הקפה קבועים (מרקורי 88 יום, נוגה 225 יום, מאדים 687 יום, אורנוס 84.77 שנים).',
      '🔢 ריבועי מאסטר (52 / 90 / 144): 52 שבועות בשנה, 90 יום לרבעון ו-144 (12×12) — "מספר המאסטר" של גאן.',
      '🍂 8 תאריכים עונתיים: 4 ימי השוויון וההיפוך + 4 נקודות האמצע (45° ביניהם — תחילת פברואר, מאי, אוגוסט, נובמבר).',
    ],
    howToUse:
      'בדוק אם התאריך של היום או השבוע הקרוב נופל על תאריך עונתי (כמו 21 במרץ / 21 ביוני / 5 במאי / 7 בנובמבר) — גאן ראה בהם נקודות לשינוי כיוון משמעותי בשוק.',
    liveReadout: (a) => [
      `תאריך עונתי / חלון קרוב: ${a.futurePivots?.[0]?.nearSeason || a.futurePivots?.[0]?.date || 'בדוק בטאב 8 תאריכים עונתיים'}`,
    ],
  },

  rluu_suite: {
    icon: '🎼',
    title: 'PriceChartingTool (rluu): מעגלי מחיר, אוקטבות מוזיקליות ו-Lookback Multiple',
    short: 'המרת מחיר לזוויות על מעגל, יחסים מוזיקליים (הרמוניות) ושכפול מחזורי עבר.',
    whatItIs:
      'חבילת הכלים המתמטיים המתקדמת של PriceChartingTool המבוססת על הרעיון ששווקים נעים ביחסים הרמוניים בדיוק כמו תווים באוקטבה מוזיקלית וכמו סיבובים על מעגל:',
    legend: [
      '⭕ מעגלי מחיר (Price Circles): מחלקים את המחיר בגודל מעגל (למשל 360 או 144) ובודקים באיזו זווית (0°–360°) הוא נמצא כרגע. זוויות 90°/180°/270°/360° מודגשות בירוק כי הן נקודות עצירה הרמוניות.',
      '🎵 אוקטבות מוזיקליות (Just Intonation & Pythagorean): מבוסס על חוק האוקטבות של גאן — לוקח מחיר עוגן ומכפיל ביחסי תווים מוזיקליים (9/8, 5/4, 4/3, 3/2, 5/3, 2/1) כדי לגלות רמות תמיכה והתנגדות טבעיות.',
      '🔁 Lookback Multiple: לוקח משך של גל עבר אמיתי ומכפיל אותו (×1, ×1.5, ×2) קדימה בזמן כדי לחזות מתי הגל הנוכחי צפוי להסתיים.',
    ],
    howToUse:
      'השתמש בלשונית "אוקטבות מוזיקליות" לראות את יחס 3/2 (קווינטה — 1.5×) ו-4/3 (קווארטה — 1.33×) מהשפל, ובלשונית "מעגלי מחיר" בדוק אם המחיר קרוב לסגירת מחזור (360°).',
    liveReadout: (a, symbol) => [
      `נכס: ${symbol} · מחיר נוכחי: ${num(a.currentPrice, 4)}`,
      `מעגלים עם היבט מדויק כרגע: ${(a.priceChartingTool?.circleAngles || []).filter((r) => r.isExactAspect).length}`,
    ],
  },

  ai_proposals: {
    icon: '🤖',
    title: 'הצעות AI לעבודה ומחקר חכם',
    short: 'סיכום אוטומטי שמתרגם את כל כלי גאן לתכנית עבודה ברורה בעברית.',
    whatItIs:
      'במקום שתצטרך לחבר לבד בין הגלגל, המניפה, הסווינג ולוחות השנה, המערכת מסנתזת את כל הנתונים החיים ל-3 כרטיסי תובנה מיידיים, ובלחיצה על "הפק הצעת עבודה מעמיקה מ-AI" שולחת את כל הנתונים למודל ה-AI (Ollama המקומי שלך או AI בענן) לתדרוך מקצועי מותאם אישית.',
    legend: [
      '🧠 3 הכרטיסים: מסכמים הטיה כיוונית, אזורי כניסה/יעדים וניהול סיכון.',
      '✨ כפתור AI מעמיק: משתמש במודלים המקומיים שלך (`qwen2.5:7b` / `deepseek-r1:7b`) להסבר ותכנית עבודה מלאה.',
    ],
    howToUse:
      'אחרי שבחרת נכס והפעלת "אכלוס חכם", לחץ על "הפק הצעת עבודה מעמיקה מ-AI" כדי לקבל סיכום אנושי ברור שמחבר את כל האינפוגרפיקות לתמונה אחת.',
    liveReadout: (a, symbol) => [
      `נכס מנותח: ${symbol} · ציון התכנסות: ${a.confluence?.score ?? 0}/100`,
    ],
  },

  library: {
    icon: '📚',
    title: 'ספריית האירועים ושינויי המגמה של גאן',
    short: 'ארכיון חי של אירועי מאקרו ושינויי מגמה שהמערכת חוקרת ומאמתת עצמאית.',
    whatItIs:
      'מאגר מחקר מתעדכן שבו המערכת סורקת היסטוריה רב-שנתית של נכסים ומתעדת כל שינוי מגמה או אירוע מאקרו שבו מחזור גאן פגע בזמן ובמחיר — כולל אירועים היסטוריים מפורסמים של גאן (כמו קריסת 1929 ומחזורי חיטה) ואירועי שוק מודרניים.',
    legend: [
      '🟢 פונדמנטליסטיים: אירועי מאקרו אמיתיים (פד, אינפלציה, חצייה) שנחזו מראש.',
      '⚪ שינויי מגמה רגילים: נקודות היפוך טכניות שזוהו במחקר העצמאי של הצוות.',
      '🟡 מתועדים מהרשת: מקרי מפתח היסטוריים מהספרות של W.D. Gann.',
    ],
    howToUse:
      'השתמש בתיבת החיפוש (למשל הקלד `NVDA`, `144d`, `ריבית` או `BTC`) ולחץ על כל שורה כדי ללמוד ממקרי עבר אמיתיים.',
    liveReadout: (a, symbol) => [
      `טיפ: הקלד "${symbol}" בתיבת החיפוש כדי לסנן אירועים היסטוריים ספציפית לנכס הזה.`,
    ],
  },
  forecast_summary: {
    icon: '🧭',
    title: 'תמצות תחזית משוקללת לפי כל הנתונים',
    short: 'איך המערכת משלבת גאן, מניפת 1x1, Sq9, חלונות זמן, פונדמנטל, סנטימנט ו-X לתחזית אחת שקופה.',
    whatItIs:
      'כרטיס זה מרכז במקום אחד את כל שכבות המחקר האמיתיות של Alta Capital על הנכס שבחרת: מניפת גאן (1x1), סווינג וכלל 50%, רמות Square of 9 ואוקטבות מוזיקליות, חלונות זמן עתידיים, דוחות פונדמנטל ומאקרו (SEC/VIX/תשואות), סנטימנט מ-News RSS/Reddit/YouTube, דוח X של רוני (אם נסרק) וקבוצת הוואטסאפ המחוברת שלך.',
    legend: [
      '🟢 הטיה שורית (62–100): רוב האינדיקטורים הגיאומטריים והפונדמנטליים מצביעים על עדיפות לתרחיש עליות.',
      '🟡 נייטרלי / המתנה (39–61): כוחות מעורבים — עדיף להמתין לפריצת ההתנגדות או שבירת התמיכה לפני פעולה.',
      '🔴 הטיה דובית / זהירות (0–38): המחיר מתחת לאיזון 1x1 או בסביבת סיכון מוגבר — עדיפות להגנה או שורט טקטי.',
      '🛡️ קו ביטול (Invalidation): רמת המחיר שבה התרחיש המרכזי מתבטל — חשוב תמיד לדעת מראש איפה טעינו.',
    ],
    howToUse:
      'התחל כל ניתוח בקריאת הכרטיס הזה: בדוק את ההטיה הכוללת, סמן את 2 יעדי העלייה, את רמת הביטול (Invalidation) ואת תאריך חלון הזמן הקרוב. לאחר מכן תוכל ללחוץ על כפתור ה-AI המקומי לסיכום מילולי קצר.',
    liveReadout: (a, symbol) => [
      `נכס: ${symbol} · מחיר: ${num(a.currentPrice, 2)} · ציון התכנסות גאן: ${a.confluence?.score ?? 0}/100`,
      `חלון זמן קרוב: ${a.futurePivots?.[0]?.date || '—'} (בעוד ${a.futurePivots?.[0]?.daysAhead ?? '—'} ימים)`,
    ],
  },
  whatsapp_gann: {
    icon: '💬',
    title: 'מודיעין קבוצת וואטסאפ משולב בגאן (WhatsApp Web)',
    short: 'שילוב חי ומבוקר (קריאה בלבד) של קבוצת וואטסאפ אחת ספציפית שלך לתוך חישובי הגאן והתחזית.',
    whatItIs:
      'המערכת מתחברת ל-WhatsApp Web בדפדפן Chrome המקומי שלך (בסריקת QR חד-פעמית, בדיוק כמו סוכן X של רוני), קוראת אך ורק את הקבוצה האחת שהגדרת — ללא שליחת הודעות — ומחלצת ממנה אוטומטית: ניתוחי גאן (תאריכי היפוך, מעלות Sq9, זוויות, עוגנים), איתותי מסחר (כניסות, יעדים, תמיכות, סטופים) וחדשות/מאקרו.',
    legend: [
      '📐 גאן: הודעות הכוללות מעלות Sq9, תאריכי ציר/היפוך, מניפת 1x1, מחזורים או מחירי עוגן.',
      '🎯 איתות/רמות: הודעות הכוללות מחירי כניסה, יעד (TP), תמיכה, התנגדות או סטופ (SL).',
      '📰 מאקרו/חדשות: הודעות על ריבית, Fed, CPI, דוחות או סנטימנט שוק כללי.',
      '💬 כפתור "הודעת מקור + קונטקסט": פותח את ההודעה המקורית עם שם הכותב, שעה מדויקת ו-3 הודעות לפני ו-3 אחרי — מסונכרן גם לטלפון ולענן.',
    ],
    howToUse:
      '1) לחץ "📱 חבר WhatsApp Web (QR)" וסרוק מהטלפון פעם אחת. 2) בחר את שם הקבוצה הספציפית ולחץ "שמור קבוצה". 3) לחץ "🔍 סרוק קבוצה ושלב בגאן". הרמות, התאריכים וההטיה יוזרמו אוטומטית לכרטיס התחזית המשוקללת ותוכל להחיל מחיר/תאריך עוגן מהקבוצה בלחיצה אחת.',
    liveReadout: (a, symbol) => [
      `הנכס הפעיל במעבדת גאן כרגע: ${symbol} (מחיר: ${num(a.currentPrice, 2)})`,
      'רמות ותאריכים שיוזכרו בקבוצה על נכס זה ישוקללו אוטומטית בתחזית העליונה ויושוו ל-Sq9 ולמניפת 1x1.',
    ],
  },
  realtime_radar: {
    icon: '🎯',
    title: 'מכ"ם גאן בזמן אמת, התנגדויות היסטוריות שהוכחו וחיזוי עתידי (Time-Price Squaring)',
    short: 'ניתוח זוויות רב-ציריות (שפלים ושיאים), סולם התנגדויות מוכחות עם שיעור בלימות, וחיזוי ריבוע זמן-מחיר.',
    whatItIs:
      'מערכת זו משכללת את מודל גאן על פי שיטות מודרניות מיוטיוב ומחקר מקצועי: היא מותחת בו-זמנית זוויות גאן משפלי מפתח (מניפה עולה) ומשיאי מפתח (מניפה יורדת), בודקת אימות היסטורי של בלימות נרות אמיתיות מול כל זווית ורמת Square of 9 / הקסגון / שמיניות, ומחשבת את התאריך והמחיר המדויקים שבהם תתרחש התאפסות זמן-מחיר הבאה (Squaring).',
    legend: [
      '🧭 משטר שוק נוכחי (Market Regime): האם השוק בתאוצה שורית (>2x1), מגמה בריאה (>1x1), שיווי משקל (Gann Equilibrium), לחץ זוויות (Squeeze) או שבירה דובית (<1x1).',
      '🧱 סולם רמות מוכחות (Proven S/R Ladder): כל רמה נבדקה מול היסטוריית הנרות — כמה פעמים נגעה ונבלמה בדיוק, מה ציון האמינות (0-100) ורשימת הבלימות המאומתות.',
      '✖️ צמתי התכנסות זוויות (Cross Confluences): נקודות המפגש במחיר ובזמן שבין קרן עולה (משפל) לקרן יורדת (משיא) — נקודות אלו מייצרות תגובות מחיר אלימות במיוחד.',
      '⏳ מפת דרכים לריבוע זמן-מחיר (Forward Squaring Roadmap): חישוב מדויק של התאריך והמחיר שבו זווית 1x1 פוגשת את רמת ה-Sq9 הקרדינלית הבאה (90°, 180°, 270°, 360°), לצד מחזורי גאן מובחרים (30, 45, 60, 90, 144, 180, 270, 360 יום).',
    ],
    howToUse:
      'בדוק תחילה את ה-Radar Banner לקבלת תמונת מצב מילולית ברורה. לאחר מכן עיין בסולם ההתנגדויות/תמיכות כדי לראות את הרמה המוכחת הקרובה ביותר עם מספר הבלימות הגבוה ביותר. הצב יעדי זמן סביב תאריכי ה-Squaring של מפת הדרכים.',
    liveReadout: (a, symbol) => [
      `משטר שוק: ${a.realTimeRadar?.regimeLabel || '—'} · מחיר חי: ${num(a.currentPrice, 2)}`,
      `מרחק מקרן 1x1 שורית: ${a.realTimeRadar?.distBull1x1Pct != null ? `${Math.abs(a.realTimeRadar.distBull1x1Pct)}% ${a.realTimeRadar.distBull1x1Pct >= 0 ? 'מעל' : 'מתחת ל'}` : '—'}`,
      `התנגדות מוכחת קרובה: ${a.realTimeRadar?.nearestProvenResistance ? `${num(a.realTimeRadar.nearestProvenResistance.price, 2)} (${a.realTimeRadar.nearestProvenResistance.source} · ציון ${a.realTimeRadar.nearestProvenResistance.score}/100)` : 'אין'}`,
      `תמיכה מוכחת קרובה: ${a.realTimeRadar?.nearestProvenSupport ? `${num(a.realTimeRadar.nearestProvenSupport.price, 2)} (${a.realTimeRadar.nearestProvenSupport.source} · ציון ${a.realTimeRadar.nearestProvenSupport.score}/100)` : 'אין'}`,
      `ריבוע זמן-מחיר הבא: ${a.realTimeRadar?.nextSquaring?.targetDate || '—'} במחיר ${num(a.realTimeRadar?.nextSquaring?.targetPrice, 2)} (${a.realTimeRadar?.nextSquaring?.daysAhead || 0} ימים)`,
    ],
  },
};

function fmtSmart(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) < 5) return n.toFixed(4);
  if (Math.abs(n) < 50) return n.toFixed(3);
  return n.toFixed(2);
}

/**
 * Fuse ALL real data layers (Gann 1x1 Fan, Swing/50%, Sq9 Levels, Musical Octaves,
 * Master Time Windows, Historical Proof, Fundamentals/Macro, Multi-Source Sentiment,
 * and Roni X Research) into a single transparent weighted forecast summary.
 */
export function buildGannExecutiveForecast(a, symbol, state = {}) {
  const cur = Number(a?.currentPrice) || 0;
  const pillars = [];
  let weightedSum = 0;
  let weightTotal = 0;

  const pushPillar = (label, score0to100, weight, detail, tone) => {
    const sc = Math.max(0, Math.min(100, Math.round(score0to100)));
    pillars.push({ label, score: sc, weight, detail, tone: tone || (sc >= 60 ? 'live' : sc <= 40 ? 'red' : 'opt') });
    weightedSum += sc * weight;
    weightTotal += weight;
  };

  // 1. Gann 1x1 Balance Angle
  if (a?.angle1x1) {
    const above = !!a.angle1x1.abovePrice;
    pushPillar(
      'מניפת גאן 1x1',
      above ? 76 : 26,
      2.2,
      above ? `מעל קו 1x1 (${fmtSmart(a.angle1x1.projectedNow)})` : `מתחת לקו 1x1 (${fmtSmart(a.angle1x1.projectedNow)})`,
    );
  }

  // 2. Gann Swing + 50% Midpoint Rule
  if (a?.swingChart) {
    const tr = a.swingChart.trend;
    const aboveMid = a.swingChart.midpoint50 != null && cur > a.swingChart.midpoint50;
    const sc = tr === 'bullish' ? (aboveMid ? 82 : 64) : tr === 'bearish' ? (aboveMid ? 42 : 22) : (aboveMid ? 56 : 44);
    pushPillar(
      'סווינג + חוק 50%',
      sc,
      2.0,
      `${tr === 'bullish' ? 'מגמה עולה' : tr === 'bearish' ? 'מגמה יורדת' : 'דשדוש'} · 50% ב-${fmtSmart(a.swingChart.midpoint50)}`,
    );
  }

  // 3. Gann 6-Rule Confluence Score
  if (a?.confluence?.score != null) {
    pushPillar(
      'התכנסות 6 כללי גאן',
      a.confluence.score,
      1.8,
      `${a.confluence.score}/100 · ${a.confluence.verdict || ''}`,
    );
  }

  // 4. Fundamentals + Macro Regime (if loaded in state)
  const fundAsset = state?.fundamentals?.assets?.[symbol] || null;
  const macro = state?.fundamentals?.macro || null;
  if (fundAsset?.score != null) {
    pushPillar(
      'פונדמנטל (SEC/CoinGecko)',
      fundAsset.score,
      1.5,
      `${fundAsset.score}/100 · ${fundAsset.bias || ''}`,
    );
  } else if (macro?.ok) {
    const vix = macro.vix ?? 18;
    const tnx = macro.us10yYield ?? 4.2;
    const mSc = vix > 26 || tnx > 4.8 ? 32 : vix < 17 && tnx < 4.4 ? 72 : 52;
    pushPillar('מאקרו (VIX / 10Y)', mSc, 1.0, `VIX ${vix} · 10Y ${tnx}%`);
  }

  // 5. Multi-Source Sentiment (News RSS + Reddit + YouTube + HN + Fear & Greed)
  const sentAsset = state?.sentiment?.assets?.[symbol] || null;
  const fg = state?.sentiment?.fearGreed || null;
  if (sentAsset && Number.isFinite(Number(sentAsset.score))) {
    const sSc = Math.round(50 + Number(sentAsset.score) * 42);
    pushPillar('סנטימנט וחדשות (RSS/Reddit/YT)', sSc, 1.2, `${sentAsset.bias || ''} (${sentAsset.score > 0 ? '+' : ''}${sentAsset.score})`);
  } else if (fg?.value != null) {
    pushPillar('מדד פחד/חמדנות', Number(fg.value), 0.8, `${fg.value}/100 (${fg.label || ''})`);
  }

  // 6. Roni X Browser Fundamental Research (if scanned)
  const xAsset = state?.xResearch?.assetSignals?.[symbol] || state?.xResearch?.assetSignals?.MACRO || null;
  if (xAsset?.score != null) {
    pushPillar(`מחקר X · רוני (${xAsset.symbol})`, xAsset.score, 1.2, `${xAsset.score}/100 · ${xAsset.bias} (${xAsset.mentions} ציוצים)`);
  }

  // 7. WhatsApp Group Live Intelligence (Gann + Signals + Macro)
  const waReport = state?.whatsappGann || null;
  const waExact = waReport?.assetSignals?.[symbol] || null;
  const waAsset = waExact || waReport?.assetSignals?.MACRO || null;
  if (waAsset?.score != null) {
    const waLabel = waExact
      ? `💬 וואטסאפ (${waReport.groupName || symbol})`
      : `💬 וואטסאפ מאקרו (${waReport.groupName || 'קבוצה'})`;
    pushPillar(
      waLabel,
      waAsset.score,
      waExact ? 1.6 : 0.85,
      `${waAsset.score}/100 · ${waAsset.bias} (${waAsset.mentions} הודעות${waExact && waExact.levels?.length ? ` · ${waExact.levels.length} רמות` : ''})`,
    );
  }

  const combinedScore = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 50;
  const direction = combinedScore >= 62 ? 'bullish' : combinedScore <= 38 ? 'bearish' : 'neutral';
  const directionLabel = direction === 'bullish'
    ? '🟢 תחזית שורית (נטייה לעליות)'
    : direction === 'bearish'
      ? '🔴 תחזית דובית (נטייה לירידות / זהירות)'
      : '🟡 תחזית נייטרלית (המתנה להכרעה)';

  // Extract concrete Upward Targets & Downward Supports from Sq9 + Fan + Musical Octaves + WhatsApp Group
  const sq9 = Array.isArray(a?.sq9Levels) ? a.sq9Levels : [];
  const mus = a?.priceChartingTool?.musicalJust || null;
  const waLevels = Array.isArray(waExact?.levels) ? waExact.levels : [];

  const upCandidates = [
    ...sq9.filter((l) => l.price > cur * 1.004).map((l) => ({ price: l.price, src: `Sq9 ${l.degree}°` })),
    ...(a?.gannFan?.activeResistance?.price > cur * 1.004 ? [{ price: a.gannFan.activeResistance.price, src: `מניפה ${a.gannFan.activeResistance.id}` }] : []),
    ...(mus?.nearestResistance?.price > cur * 1.004 ? [{ price: mus.nearestResistance.price, src: `אוקטבה ${mus.nearestResistance.frac}` }] : []),
    ...waLevels
      .filter((l) => l.price > cur * 1.004 && l.price < cur * 2.2 && ['target', 'resistance', 'anchor'].includes(l.role))
      .map((l) => ({ price: l.price, src: `💬 וואטסאפ · ${l.author || 'קבוצה'}` })),
  ].sort((x, y) => x.price - y.price);

  const downCandidates = [
    ...sq9.filter((l) => l.price < cur * 0.996).map((l) => ({ price: l.price, src: `Sq9 ${l.degree}°` })),
    ...(a?.gannFan?.activeSupport?.price < cur * 0.996 ? [{ price: a.gannFan.activeSupport.price, src: `מניפה ${a.gannFan.activeSupport.id}` }] : []),
    ...(mus?.nearestSupport?.price < cur * 0.996 ? [{ price: mus.nearestSupport.price, src: `אוקטבה ${mus.nearestSupport.frac}` }] : []),
    ...(a?.swingChart?.midpoint50 && a.swingChart.midpoint50 < cur * 0.996 ? [{ price: a.swingChart.midpoint50, src: 'אמצע 50% סווינג' }] : []),
    ...waLevels
      .filter((l) => l.price < cur * 0.996 && l.price > cur * 0.4 && ['support', 'stop', 'entry', 'anchor'].includes(l.role))
      .map((l) => ({ price: l.price, src: `💬 וואטסאפ · ${l.author || 'קבוצה'}` })),
  ].sort((x, y) => y.price - x.price);

  const target1 = upCandidates[0] || null;
  const target2 = upCandidates.find((x) => !target1 || x.price > target1.price * 1.015) || upCandidates[1] || null;
  const support1 = downCandidates[0] || null;
  const support2 = downCandidates.find((x) => !support1 || x.price < support1.price * 0.985) || downCandidates[1] || null;

  const todayIso = new Date().toISOString().slice(0, 10);
  const waUpcomingDate = (waExact?.dates || []).find((d) => d.dateIso >= todayIso) || waExact?.dates?.[0] || null;

  const nextPivot = a?.futurePivots?.[0] || null;
  const nextPivotText = nextPivot
    ? `${nextPivot.date} (בעוד ${nextPivot.daysAhead} ימים · עוצמה ${nextPivot.score}${nextPivot.nearMacro ? ` · ${nextPivot.nearMacro}` : ''}${nextPivot.nearSeason ? ` · ${nextPivot.nearSeason}` : ''})${waUpcomingDate ? ` · 💬 תאריך מהוואטסאפ: ${waUpcomingDate.dateIso} (${waUpcomingDate.author})` : ''}`
    : (waUpcomingDate ? `💬 תאריך מהוואטסאפ: ${waUpcomingDate.dateIso} (${waUpcomingDate.author})` : 'אין חלון זמן קרוב');

  // Primary & Alternative scenario narratives in plain Hebrew
  const primaryScenario = direction === 'bullish'
    ? `שקלול ${pillars.length} שכבות הנתונים נותן יתרון שורי (${combinedScore}/100) ל-${symbol}. כל עוד המחיר מחזיק מעל אזור התמיכה ${support1 ? `${fmtSmart(support1.price)} (${support1.src})` : fmtSmart(cur * 0.96)}, היעד הקרוב הוא ${target1 ? `${fmtSmart(target1.price)} (${target1.src})` : 'שיא הסווינג'}${target2 ? ` והיעד המורחב ${fmtSmart(target2.price)} (${target2.src})` : ''}. חלון הזמן הקרוב לבחינת המשכיות או שיא מקומי: ${nextPivot?.date || '—'}${waUpcomingDate ? ` (ובוואטסאפ סומן גם ${waUpcomingDate.dateIso})` : ''}.`
    : direction === 'bearish'
      ? `שקלול ${pillars.length} שכבות הנתונים מציג לחץ דובי/תיקון (${combinedScore}/100) ב-${symbol}. כל עוד המחיר נותר מתחת להתנגדות ${target1 ? `${fmtSmart(target1.price)} (${target1.src})` : fmtSmart(cur * 1.04)}, צפויה בחינה של התמיכה ${support1 ? `${fmtSmart(support1.price)} (${support1.src})` : 'שפל הסווינג'}${support2 ? ` ולאחריה ${fmtSmart(support2.price)} (${support2.src})` : ''}. חלון תזמון אפשרי להיפוך/תחתית: ${nextPivot?.date || '—'}${waUpcomingDate ? ` (ובוואטסאפ סומן גם ${waUpcomingDate.dateIso})` : ''}.`
      : `הנתונים על ${symbol} מאוזנים/מעורבים כרגע (${combinedScore}/100) — השוק באזור הכרעה בין תמיכה ב-${support1 ? `${fmtSmart(support1.price)} (${support1.src})` : '—'} לבין התנגדות ב-${target1 ? `${fmtSmart(target1.price)} (${target1.src})` : '—'}. מומלץ להמתין לפריצה מובהקת מעל ההתנגדות (ללונג) או שבירה מתחת לתמיכה, במיוחד סביב חלון הזמן ${nextPivot?.date || '—'}${waUpcomingDate ? ` / ${waUpcomingDate.dateIso}` : ''}.`;

  const invalidationText = direction === 'bullish'
    ? `ביטול התרחיש השורי (Invalidation): סגירה ברורה מתחת ל-${support1 ? `${fmtSmart(support1.price)} (${support1.src})` : fmtSmart(cur * 0.95)} תבטל את יתרון הקונים ותפתח ירידה ל-${support2 ? fmtSmart(support2.price) : 'אזור התמיכה הבא'}.`
    : direction === 'bearish'
      ? `ביטול התרחיש הדובי (Invalidation): פריצה וסגירה מעל ${target1 ? `${fmtSmart(target1.price)} (${target1.src})` : fmtSmart(cur * 1.05)} תבטל את הלחץ הדובי ותעביר את המומנטום ליעד ${target2 ? fmtSmart(target2.price) : 'העליון'}.`
      : `נקודות ההכרעה: פריצה מעל ${target1 ? fmtSmart(target1.price) : '—'} מאשרת כיוון עולה; שבירה מתחת ל-${support1 ? fmtSmart(support1.price) : '—'} מאשרת כיוון יורד.`;

  return {
    symbol,
    currentPrice: cur,
    combinedScore,
    direction,
    directionLabel,
    pillars,
    target1,
    target2,
    support1,
    support2,
    nextPivot,
    waUpcomingDate,
    nextPivotText,
    primaryScenario,
    invalidationText,
    historicalAccuracyPct: a?.hitRatePct ?? 0,
    fundamentalProofPct: a?.fundamentalProof?.matchRatePct ?? 0,
  };
}

export function renderGannExecutiveForecastCard(a, cfg, symbol, state) {
  const fc = buildGannExecutiveForecast(a, symbol, state);
  const borderCol = fc.direction === 'bullish'
    ? 'rgba(46, 204, 113, 0.55)'
    : fc.direction === 'bearish'
      ? 'rgba(240, 91, 91, 0.55)'
      : 'rgba(245, 158, 11, 0.5)';
  const scoreCol = fc.direction === 'bullish' ? '#4ade80' : fc.direction === 'bearish' ? '#f87171' : '#fbbf24';

  const aiBriefBox = h('div', { style: { display: 'none', marginTop: '10px' } });
  const aiBriefBtn = h('button', {
    class: 'btn btn-sm btn-primary',
    onclick: async () => {
      aiBriefBtn.disabled = true;
      aiBriefBtn.textContent = '⏳ מסנתז תחזית AI מכל הנתונים…';
      try {
        const res = await chatDetailed({
          system: 'אתה אנליסט שוק בכיר ב-Alta Capital. כתוב תמצות תחזית חד, ברור ונטול הזיות בעברית (5 שורות קצרות) המבוסס אך ורק על הנתונים האמיתיים שסופקו. אל תמציא שום מספר.',
          messages: [{
            role: 'user',
            content: [
              `תמצת תחזית ברורה למתחיל ולסוחר עבור ${fc.symbol} במחיר ${fmtSmart(fc.currentPrice)}:`,
              `ציון משוקלל מכל השכבות: ${fc.combinedScore}/100 (${fc.directionLabel})`,
              `שכבות הנתונים:\n${fc.pillars.map((p) => `- ${p.label}: ${p.score}/100 (${p.detail})`).join('\n')}`,
              `יעדי עלייה: ${fc.target1 ? `${fmtSmart(fc.target1.price)} (${fc.target1.src})` : '—'}${fc.target2 ? `, ${fmtSmart(fc.target2.price)} (${fc.target2.src})` : ''}`,
              `תמיכות: ${fc.support1 ? `${fmtSmart(fc.support1.price)} (${fc.support1.src})` : '—'}${fc.support2 ? `, ${fmtSmart(fc.support2.price)} (${fc.support2.src})` : ''}`,
              `חלון זמן קרוב: ${fc.nextPivotText}`,
              `דיוק גאן היסטורי על הנכס: ${fc.historicalAccuracyPct}% · הוכחה פונדמנטלית: ${fc.fundamentalProofPct}%`,
            ].join('\n'),
          }],
          maxTokens: 480,
        });
        aiBriefBox.style.display = 'block';
        aiBriefBox.className = 'notice ok';
        aiBriefBox.style.whiteSpace = 'pre-wrap';
        aiBriefBox.style.lineHeight = '1.6';
        aiBriefBox.textContent = `🤖 תמצות תחזית AI (${res.model || 'Local/Cloud AI'}):\n\n${res.text}`;
        aiBriefBtn.textContent = '✓ תמצות AI מוכן';
      } catch (err) {
        aiBriefBox.style.display = 'block';
        aiBriefBox.className = 'notice bad';
        aiBriefBox.textContent = `שגיאה בקריאה ל-AI: ${err.message}`;
        aiBriefBtn.disabled = false;
        aiBriefBtn.textContent = '🤖 נסה שוב תמצות AI';
      }
    },
  }, '🤖 הרחב תמצות תחזית עם AI');

  return h('div', {
    class: 'card',
    style: {
      marginTop: '14px',
      borderColor: borderCol,
      background: 'linear-gradient(180deg, rgba(13, 24, 41, 0.97), rgba(8, 13, 24, 0.97))',
    },
  },
    h('div', { class: 'card-head', style: { flexWrap: 'wrap', gap: '8px' } },
      h('div', {},
        h('h2', { text: `🧭 תמצות תחזית משוקללת לפי כל הנתונים · ${fc.symbol}` }),
        h('div', { class: 'card-sub', text: `שקלול בזמן אמת של ${fc.pillars.length} שכבות אמת: מניפת גאן 1x1, סווינג 50%, התכנסות Sq9, חלונות זמן, פונדמנטל/מאקרו, סנטימנט, X ווואטסאפ` }),
      ),
      h('div', { class: 'row wrap', style: { gap: '6px' } },
        gannExplainButton('forecast_summary', a, cfg, symbol),
        aiBriefBtn,
        tag(`${fc.directionLabel} · ${fc.combinedScore}/100`, fc.direction === 'bullish' ? 'live' : fc.direction === 'bearish' ? 'red' : 'opt'),
      ),
    ),

    // Visual Weighted Bias Meter (0..100, explicit LTR so 0=red left and 100=green right match needle)
    h('div', { dir: 'ltr', style: { marginBottom: '12px' } },
      h('div', { class: 'row between', style: { fontSize: '11.5px', marginBottom: '4px' } },
        h('span', { class: 'red', text: 'דובי (0)' }),
        h('span', { class: 'mono', style: { color: scoreCol, fontWeight: '700' }, text: `ציון תחזית משוקלל: ${fc.combinedScore}/100` }),
        h('span', { class: 'green', text: 'שורי (100)' }),
      ),
      h('div', { style: { position: 'relative', height: '9px', borderRadius: '999px', background: 'linear-gradient(90deg, rgba(240,91,91,0.55) 0%, rgba(245,158,11,0.45) 50%, rgba(46,204,113,0.6) 100%)' } },
        h('div', {
          style: {
            position: 'absolute',
            top: '-3px',
            left: `calc(${Math.max(2, Math.min(98, fc.combinedScore))}% - 7px)`,
            width: '14px',
            height: '15px',
            borderRadius: '4px',
            background: '#ffffff',
            border: `2px solid ${scoreCol}`,
            boxShadow: '0 0 8px rgba(0,0,0,0.6)',
          },
        }),
      ),
    ),

    // 4 Concrete Forecast Key-Level Cards
    h('div', { class: 'grid cols-4', style: { gap: '8px', marginBottom: '12px' } },
      h('div', { class: 'metric' },
        h('span', { text: 'מחיר חי · דיוק גאן היסטורי' }),
        h('b', { class: 'mono', text: `${fmtSmart(fc.currentPrice)} · ${fc.historicalAccuracyPct}%` }),
      ),
      h('div', { class: 'metric' },
        h('span', { text: '🎯 יעדי עלייה קרובים' }),
        h('b', { class: 'green mono small', text: fc.target1 ? `${fmtSmart(fc.target1.price)}${fc.target2 ? ` / ${fmtSmart(fc.target2.price)}` : ''}` : '—' }),
      ),
      h('div', { class: 'metric' },
        h('span', { text: '🛡️ תמיכות וקו ביטול' }),
        h('b', { class: 'red mono small', text: fc.support1 ? `${fmtSmart(fc.support1.price)}${fc.support2 ? ` / ${fmtSmart(fc.support2.price)}` : ''}` : '—' }),
      ),
      h('div', { class: 'metric' },
        h('span', { text: '📅 חלון תזמון קרוב' }),
        h('b', { class: 'gold mono small', text: fc.nextPivot ? `${fc.nextPivot.date} (+${fc.nextPivot.daysAhead}d)` : '—' }),
      ),
    ),

    // Contributing Data Pillars Strip
    h('div', { class: 'row wrap', style: { gap: '6px', marginBottom: '10px' } },
      ...fc.pillars.map((p) => tag(`${p.label}: ${p.score}/100 (${p.detail})`, p.tone)),
    ),

    // Plain-Hebrew Primary Scenario + Invalidation Box
    h('div', { class: 'grid cols-2', style: { gap: '10px' } },
      h('div', { class: 'card', style: { background: 'rgba(9, 17, 30, 0.9)', padding: '10px 12px', borderColor: borderCol } },
        h('div', { style: { fontWeight: '700', fontSize: '13px', color: scoreCol, marginBottom: '4px' }, text: '📌 תמצית התחזית המרכזית' }),
        h('div', { class: 'small', style: { lineHeight: '1.55', color: '#e2e8f0' }, text: fc.primaryScenario }),
      ),
      h('div', { class: 'card', style: { background: 'rgba(9, 17, 30, 0.9)', padding: '10px 12px', borderColor: 'rgba(148, 163, 184, 0.3)' } },
        h('div', { style: { fontWeight: '700', fontSize: '13px', color: '#fbbf24', marginBottom: '4px' }, text: '⚠️ תרחיש נגדי ונקודת ביטול (Invalidation)' }),
        h('div', { class: 'small', style: { lineHeight: '1.55', color: '#cbd5e1' }, text: fc.invalidationText }),
        h('div', { class: 'tiny muted', style: { marginTop: '6px' }, text: 'תמצות מחקרי משוקלל מנתוני אמת בלבד — אינו ייעוץ השקעות; יש לאמת בתנועת מחיר ולהציב סטופ-לוס.' }),
      ),
    ),
    aiBriefBox,
  );
}

export function openGannExplainModal(topicId, a, cfg, symbol) {
  const topic = GANN_GUIDE_TOPICS[topicId];
  if (!topic) return;

  const liveLines = (a && typeof topic.liveReadout === 'function') ? topic.liveReadout(a, symbol, cfg) : [];
  const aiBox = h('div', { style: { display: 'none', marginTop: '8px' } });
  const aiBtn = h('button', {
    class: 'btn btn-sm btn-primary',
    onclick: async () => {
      aiBtn.disabled = true;
      aiBtn.textContent = '⏳ ה-AI מנסח הסבר פשוט למתחילים…';
      try {
        const res = await chatDetailed({
          system: 'אתה מורה סבלני וברור לניתוח שוק ההון ולשיטות W.D. Gann. הסבר בעברית פשוטה מאוד למתחיל מוחלט, בלי ז׳רגון מסובך, עם דוגמה מספרית קצרה על הנכס הנוכחי.',
          messages: [{
            role: 'user',
            content: [
              `הסבר בפשטות למתחיל מה רואים ואיך משתמשים בחלק הזה במודול גאן: "${topic.title}".`,
              `תיאור: ${topic.whatItIs}`,
              liveLines.length ? `נתונים חיים כרגע על ${symbol}:\n${liveLines.join('\n')}` : '',
              'כתוב 4–5 נקודות קצרות וברורות, כולל "מה לבדוק קודם" ו"ממה להיזהר".',
            ].join('\n\n'),
          }],
          maxTokens: 550,
        });
        aiBox.style.display = 'block';
        aiBox.className = 'notice ok';
        aiBox.style.whiteSpace = 'pre-wrap';
        aiBox.style.lineHeight = '1.6';
        aiBox.textContent = `🤖 הסבר AI פשוט (${res.model || 'AI'}):\n\n${res.text}`;
        aiBtn.textContent = '✓ הסבר AI נוצר';
      } catch (err) {
        aiBox.style.display = 'block';
        aiBox.className = 'notice bad';
        aiBox.textContent = `לא ניתן להתחבר ל-AI כרגע (${err.message}) — ההסבר המלא למעלה זמין תמיד גם ללא AI.`;
        aiBtn.disabled = false;
        aiBtn.textContent = '🤖 נסה שוב הסבר AI';
      }
    },
  }, `🤖 בקש מה-AI הסבר עוד יותר פשוט על "${symbol}"`);

  openModal(
    `${topic.icon} הסבר: ${topic.title}`,
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
      h('div', { class: 'card', style: { background: 'rgba(10, 18, 32, 0.92)' } },
        h('h3', { text: '📖 מה רואים כאן? (הסבר פשוט)' }),
        h('p', { class: 'small', style: { lineHeight: '1.65', marginTop: '6px' }, text: topic.whatItIs }),
      ),
      h('div', { class: 'card', style: { background: 'rgba(10, 18, 32, 0.92)' } },
        h('h3', { text: '🎨 מקרא צבעים, קווים, טבעות וסמלים' }),
        h('ul', { class: 'list-clean', style: { marginTop: '6px', display: 'grid', gap: '6px' } },
          topic.legend.map((line) => h('li', { class: 'small', style: { lineHeight: '1.5' }, text: line })),
        ),
      ),
      liveLines.length
        ? h('div', { class: 'card', style: { background: 'rgba(14, 29, 48, 0.92)', borderColor: 'rgba(56, 189, 248, 0.4)' } },
            h('h3', { style: { color: '#7dd3fc' }, text: `📊 קריאה חיה כרגע על ${symbol}` }),
            h('ul', { class: 'list-clean', style: { marginTop: '6px', display: 'grid', gap: '4px' } },
              liveLines.map((line) => h('li', { class: 'small mono', text: `• ${line}` })),
            ),
          )
        : null,
      h('div', { class: 'card', style: { background: 'rgba(10, 18, 32, 0.92)', borderColor: 'rgba(46, 204, 113, 0.35)' } },
        h('h3', { text: '🧭 איך משתמשים בזה נכון (ומה לא לעשות)' }),
        h('p', { class: 'small', style: { lineHeight: '1.6', marginTop: '6px' }, text: topic.howToUse }),
      ),
      h('div', { class: 'row wrap', style: { gap: '8px', alignItems: 'center' } }, aiBtn),
      aiBox,
    ),
    { wide: true },
  );
}

export function openGannMasterGuideModal(a, cfg, symbol) {
  openModal(
    `📖 מדריך ההסברים המלא למעבדת גאן (${symbol})`,
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
      h('div', { class: 'notice', text: 'לחץ על כל אינפוגרפיקה, גלגל או מחשבון למטה כדי לפתוח הסבר מפורט בעברית עם מקרא צבעים, קריאה חיה על הנכס הנוכחי ואפשרות להסבר AI פשוט למתחילים.' }),
      h('div', { class: 'grid cols-2', style: { gap: '10px' } },
        Object.entries(GANN_GUIDE_TOPICS).map(([id, t]) => h('div', {
          class: 'card',
          style: { background: 'rgba(10, 18, 32, 0.92)', cursor: 'pointer', padding: '10px 12px' },
          onclick: () => openGannExplainModal(id, a, cfg, symbol),
        },
          h('div', { class: 'row between', style: { gap: '6px', marginBottom: '4px' } },
            h('strong', { style: { fontSize: '13.5px', color: '#f1f5f9' }, text: `${t.icon} ${t.title}` }),
            tag('❓ פתח הסבר', 'opt'),
          ),
          h('div', { class: 'tiny muted', style: { lineHeight: '1.45' }, text: t.short }),
        )),
      ),
    ),
    { wide: true },
  );
}

export function gannExplainButton(topicId, a, cfg, symbol, label = '❓ הסבר') {
  return h('button', {
    class: 'btn btn-sm btn-ghost',
    style: { borderColor: 'rgba(125, 211, 252, 0.35)', color: '#7dd3fc' },
    title: 'פתח הסבר מפורט בעברית + מקרא צבעים על חלק זה',
    onclick: (e) => {
      e.stopPropagation();
      openGannExplainModal(topicId, a, cfg, symbol);
    },
  }, label);
}
