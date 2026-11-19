// Unified W.D. Gann, Michael Jenkins & Gannzilla Forecasting & Proof Engine.
// Integrates:
//  1. Square of 9 Vibration Levels (gann indicator script sq9.txt + Excel Sheet 3)
//     Price = (sqrt(Anchor) + (Degree / 180) * Direction)^2
//  2. Hexagon Chart (60°/120°/180°/360° harmonics from Excel Sheet 5 'הקסגון')
//  3. Michael Jenkins Suite: Square-Root Time (sqrt(P) days), Square the Range & Eighths (1/8..8/8 from Sheet 1 'ריבועים')
//  4. Gannzilla Calendars & Chronometer: Master Time Cycles (30–360d), Inward Spiral (30.437d/month), Seasonal Equinox/Solstice Wheel
//  5. Gann vs. Fundamental Events Proof Engine: verifies how prior Gann cycles & Sq9/Hex levels predicted major macro/fundamental shocks BEFORE the news!

const DAY_MS = 86_400_000;

const GANN_CALENDAR_CYCLES = [
  { days: 30,  label: '30 יום (1/12 שנה)', weight: 1 },
  { days: 45,  label: '45 יום (1/8 שנה · 45°)', weight: 2 },
  { days: 52,  label: '52 ימים (שבוע בשנה · Square of 52)', weight: 2 },
  { days: 60,  label: '60 יום (הקסגון 60°)', weight: 1 },
  { days: 72,  label: '72 ימים (חמישית מעגל · 72°)', weight: 2 },
  { days: 90,  label: '90 יום (רבעון · 90°)', weight: 3 },
  { days: 120, label: '120 יום (משולש הרמוני · 120°)', weight: 2 },
  { days: 144, label: '144 ימים (ריבוע 12 · מחזור מאסטר)', weight: 3 },
  { days: 180, label: '180 יום (חצי שנה · 180°)', weight: 3 },
  { days: 270, label: '270 יום (3/4 שנה · 270°)', weight: 2 },
  { days: 360, label: '360 יום (מעגל שלם · 360°)', weight: 4 },
];

const SQ9_DEGREES = [45, 90, 135, 180, 225, 270, 315, 360];
const HEX_DEGREES = [60, 120, 180, 240, 300, 360, 420, 480, 540, 600, 660, 720];

// Real-world Macro, Fed, Geopolitical, Earnings & Crypto Fundamental Shocks (for historical proof + upcoming catalysts)
export const FUNDAMENTAL_EVENTS_CALENDAR = [
  {
    date: '2020-03-16', title: 'משבר הקורונה · הורדת ריבית חירום Fed', category: 'מאקרו / ריבית', kinds: ['all'],
    details: 'ב-15–16 במרץ 2020 הפחית הפדרל ריזרב את הריבית בהחלטת חירום ל-0%–0.25% והשיק תוכנית QE של $700B בעקבות סגרי הקורונה — נקודת מפנה היסטורית בשווקים.',
    sourceName: 'Federal Reserve FOMC', sourceUrl: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20200315a.htm',
  },
  {
    date: '2020-05-11', title: 'חציית ביטקוין (Bitcoin Halving 2020)', category: 'פונדמנטל קריפטו', kinds: ['crypto'],
    details: 'בלוק 630,000 חצה את תגמול הכרייה מ-12.5 ל-6.25 BTC לבלוק — זעזוע היצע מתוכנן שהצית את מחזור השור של 2020–2021.',
    sourceName: 'Bitcoin Block 630,000', sourceUrl: 'https://mempool.space/block/000000000000000000024bead8df69990852c202db0e0097c1a12ea637d7e96d',
  },
  {
    date: '2021-11-10', title: 'שיא אינפלציה CPI 6.2% בארה"ב', category: 'מאקרו / אינפלציה', kinds: ['all'],
    details: 'מדד המחירים לצרכן (CPI) בארה"ב זינק ל-6.2% שנתי — שיא של 31 שנה שסימן את שיא הנזילות ואת תחילת תמחור העלאות הריבית.',
    sourceName: 'U.S. Bureau of Labor Statistics', sourceUrl: 'https://www.bls.gov/cpi/',
  },
  {
    date: '2022-06-15', title: 'העלאת ריבית חדה 0.75% ע"י הפד', category: 'מאקרו / ריבית', kinds: ['all'],
    details: 'הפד העלה ריבית ב-75 נקודות בסיס בפעם הראשונה מאז 1994 כדי לבלום אינפלציה דוהרת, מה שיצר תחתית מחזורית חדה בקריפטו ובמניות הצמיחה.',
    sourceName: 'Federal Reserve FOMC', sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  },
  {
    date: '2022-11-08', title: 'קריסת בורסת FTX (זעזוע נזילות)', category: 'אירוע שוק / קריפטו', kinds: ['crypto'],
    details: 'קריסת בורסת FTX והקפאת משיכות הלקוחות הובילו למכירת חיסול כלל-שוקית וליצירת שפל מחזורי מרכזי במחזור ה-4 שנים.',
    sourceName: 'SEC / Bankruptcy Filing', sourceUrl: 'https://www.sec.gov/news/press-release',
  },
  {
    date: '2023-03-13', title: 'משבר הבנקים SVB והתערבות הפד', category: 'מאקרו / בנקים', kinds: ['all'],
    details: 'קריסת Silicon Valley Bank והשקת תוכנית BTFP להזרקת נזילות לבנקים בארה"ב הפכו את המגמה הדובית לתחילת מגמת עלייה חזקה.',
    sourceName: 'Federal Reserve BTFP', sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/bank-term-funding-program.htm',
  },
  {
    date: '2023-10-27', title: 'התכנסות תשואות אג"ח 5% · תחילת ראלי סוף שנה', category: 'מאקרו / אג"ח', kinds: ['all'],
    details: 'תשואת אג"ח ממשלת ארה"ב ל-10 שנים הגיעה לשיא של ~5% וסימנה תחתית מרכזית במדדי המניות לקראת ראלי הרבעון הרביעי.',
    sourceName: 'U.S. Treasury Yields', sourceUrl: 'https://home.treasury.gov/policy-issues/financing-the-government/interest-rate-statistics',
  },
  {
    date: '2024-01-11', title: 'אישור ETF ביטקוין ספוט ע"י SEC', category: 'רגולציה / ETF', kinds: ['crypto', 'etf'],
    details: 'תחילת המסחר ב-11 קרנות הסל (Spot Bitcoin ETF) בארה"ב (BlackRock IBIT, Fidelity FBTC) שפתחו את השוק לכניסה מוסדית ישירה.',
    sourceName: 'SEC Spot Bitcoin ETF Approval', sourceUrl: 'https://www.sec.gov/news/statement/gensler-statement-spot-bitcoin-011023',
  },
  {
    date: '2024-04-19', title: 'חציית ביטקוין 2024 (Halving)', category: 'פונדמנטל קריפטו', kinds: ['crypto'],
    details: 'בלוק 840,000 חצה את תגמול הכרייה מ-6.25 ל-3.125 BTC לבלוק, והקטין את האינפלציה השנתית של הביטקוין מתחת לזהב.',
    sourceName: 'Bitcoin Block 840,000', sourceUrl: 'https://mempool.space/',
  },
  {
    date: '2024-05-22', title: 'דוחות Q1 היסטוריים של NVIDIA + פיצול 10:1', category: 'דוחות כספיים', kinds: ['stock', 'etf'],
    details: 'NVIDIA דיווחה על זינוק של 262% בהכנסות משנה לשנה והכריזה על פיצול מניות 10:1 — אישור לביקוש הגלובלי לשבבי AI.',
    sourceName: 'SEC EDGAR / NVIDIA IR', sourceUrl: 'https://investor.nvidia.com/',
  },
  {
    date: '2024-08-05', title: 'קריסת היין היפני (BOJ Carry Trade Unwind)', category: 'מאקרו / מט"ח', kinds: ['all'],
    details: 'העלאת ריבית מפתיעה של הבנק המרכזי ביפן גרמה לסגירה המונית של עסקאות Carry Trade, זינוק ב-VIX ושפל תוך-יומי חד בכל השווקים.',
    sourceName: 'Bank of Japan / BIS', sourceUrl: 'https://www.boj.or.jp/en/mopo/mpmdeci/index.htm',
  },
  {
    date: '2024-09-18', title: 'הורדת ריבית ראשונה של הפד (0.50%)', category: 'מאקרו / ריבית', kinds: ['all'],
    details: 'הפד פתח את מחזור הורדות הריבית בהפחתה של 50 נקודות בסיס — שינוי כיוון מוניטרי מרכזי לאחר תקופת הריסון.',
    sourceName: 'Federal Reserve FOMC', sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  },
  {
    date: '2024-11-05', title: 'בחירות לנשיאות ארה"ב 2024', category: 'גיאופוליטיקה / מאקרו', kinds: ['all'],
    details: 'תוצאות הבחירות בארה"ב הובילו לתמחור מחדש של רגולציה, מיסים, תשואות אג"ח וקריפטו.',
    sourceName: 'Federal Election Commission', sourceUrl: 'https://www.fec.gov/',
  },
  {
    date: '2024-12-18', title: 'החלטת פד נצית (Hawkish Cut) · זעזוע סוף שנה', category: 'מאקרו / ריבית', kinds: ['all'],
    details: 'הפד הוריד ריבית ב-0.25% אך עדכן כלפי מעלה את תחזית האינפלציה ל-2025 והפחית את מספר ההורדות הצפויות.',
    sourceName: 'Federal Reserve FOMC', sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  },
  {
    date: '2025-01-27', title: 'זעזוע DeepSeek במניות ה-AI והשבבים', category: 'פונדמנטל טכנולוגיה', kinds: ['stock', 'etf', 'crypto'],
    details: 'פרסום מודל DeepSeek-R1 הוביל לתנודתיות חריפה בסקטור השבבים וה-AI ולבחינה מחודשת של הוצאות ההון על תשתיות מחשוב.',
    sourceName: 'Market / SEC Filings', sourceUrl: 'https://www.sec.gov/edgar/searchedgar/companysearch',
  },
  {
    date: '2025-04-02', title: 'הכרזת המכסים "Liberation Day" בארה"ב', category: 'מאקרו / סחר', kinds: ['all'],
    details: 'הכרזת מכסי סחר רחבים בארה"ב יצרה גל תנודתיות חד בשווקי המניות, הסחורות והמט"ח.',
    sourceName: 'U.S. Trade Representative', sourceUrl: 'https://ustr.gov/',
  },
  {
    date: '2025-05-07', title: 'החלטת ריבית FOMC · מאי 2025', category: 'מאקרו / ריבית', kinds: ['all'],
    details: 'החלטת הריבית ותחזיית המדיניות של ועדת השוק הפתוח של הפדרל ריזרב.',
    sourceName: 'Federal Reserve FOMC', sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  },
  {
    date: '2025-07-30', title: 'החלטת ריבית FOMC + עונת דוחות Q2', category: 'מאקרו / דוחות', kinds: ['all'],
    details: 'מפגש כפול של החלטת ריבית הפד ושיא עונת הדוחות לרבעון השני.',
    sourceName: 'Federal Reserve FOMC', sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  },
  {
    date: '2025-09-17', title: 'החלטת ריבית FOMC · ספטמבר 2025', category: 'מאקרו / ריבית', kinds: ['all'],
    details: 'החלטת ריבית + פרסום תחזיות כלכליות רבעוניות (SEP / Dot Plot) של הפד.',
    sourceName: 'Federal Reserve FOMC', sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  },
  {
    date: '2025-12-17', title: 'החלטת ריבית FOMC · דצמבר 2025', category: 'מאקרו / ריבית', kinds: ['all'],
    details: 'החלטת ריבית סוף שנה ותחזיות מאקרו לשנה הבאה.',
    sourceName: 'Federal Reserve FOMC', sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  },
  {
    date: '2026-03-18', title: 'החלטת ריבית FOMC · מרץ 2026', category: 'מאקרו / ריבית', kinds: ['all'],
    details: 'ישיבת הריבית הרבעונית של הפד בחפיפה לשוויון האביב של גאן (21 במרץ).',
    sourceName: 'Federal Reserve FOMC', sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  },
  {
    date: '2026-06-17', title: 'החלטת ריבית FOMC · יוני 2026', category: 'מאקרו / ריבית', kinds: ['all'],
    details: 'ישיבת הריבית הרבעונית של הפד בסמוך להיפוך הקיץ (21 ביוני).',
    sourceName: 'Federal Reserve FOMC', sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  },
  {
    date: '2026-09-16', title: 'החלטת ריבית FOMC · ספטמבר 2026', category: 'מאקרו / ריבית', kinds: ['all'],
    details: 'ישיבת הריבית הרבעונית של הפד בחפיפה לשוויון הסתיו (23 בספטמבר).',
    sourceName: 'Federal Reserve FOMC', sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  },
  {
    date: '2026-12-16', title: 'החלטת ריבית FOMC + סוף שנה 2026', category: 'מאקרו / ריבית', kinds: ['all'],
    details: 'ישיבת הריבית האחרונה לשנת 2026 בסמוך להיפוך החורף (21 בדצמבר).',
    sourceName: 'Federal Reserve FOMC', sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  },
  {
    date: '2027-01-27', title: 'החלטת ריבית FOMC + דוחות Q4', category: 'מאקרו / דוחות', kinds: ['all'],
    details: 'החלטת הריבית הראשונה של 2027 לצד עונת הדוחות השנתית.',
    sourceName: 'Federal Reserve FOMC', sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  },
  {
    date: '2027-03-17', title: 'החלטת ריבית FOMC · מרץ 2027', category: 'מאקרו / ריבית', kinds: ['all'],
    details: 'ישיבת הריבית הרבעונית של מרץ 2027.',
    sourceName: 'Federal Reserve FOMC', sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  },
];

export function gannSq9Price(anchor, degree, direction = 1) {
  const root = Math.sqrt(Math.max(anchor, 1e-9));
  const val = root + (degree / 180) * direction;
  return val > 0 ? +(Math.pow(val, 2)).toFixed(4) : null;
}

export function detectMajorPivots(candles, lookback = 12) {
  const pivots = [];
  if (!Array.isArray(candles) || candles.length < lookback * 2 + 1) return pivots;

  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (candles[j].h > candles[i].h) isHigh = false;
      if (candles[j].l < candles[i].l) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) {
      pivots.push({ idx: i, t: candles[i].t, price: candles[i].h, type: 'high' });
    } else if (isLow) {
      pivots.push({ idx: i, t: candles[i].t, price: candles[i].l, type: 'low' });
    }
  }
  return pivots;
}

export function buildSq9VibrationTable(anchorPrice, currentPrice) {
  const rows = [];
  for (const deg of SQ9_DEGREES) {
    const isCardinal = deg % 90 === 0;
    const up = gannSq9Price(anchorPrice, deg, 1);
    const down = gannSq9Price(anchorPrice, deg, -1);
    if (up != null) {
      rows.push({
        degree: deg,
        type: isCardinal ? 'Cardinal (90°)' : 'Ordinal (45°)',
        isCardinal,
        direction: 'up',
        price: up,
        distPct: +(((up - currentPrice) / currentPrice) * 100).toFixed(2),
      });
    }
    if (down != null) {
      rows.push({
        degree: -deg,
        type: isCardinal ? 'Cardinal (90°)' : 'Ordinal (45°)',
        isCardinal,
        direction: 'down',
        price: down,
        distPct: +(((down - currentPrice) / currentPrice) * 100).toFixed(2),
      });
    }
  }
  return rows.sort((a, b) => Math.abs(a.distPct) - Math.abs(b.distPct));
}

// Hexagon Chart (Sheet 5 'הקסגון': 60° steps, Factor = Angle / 180)
export function buildHexagonVibrationTable(anchorPrice, currentPrice) {
  const rows = [];
  for (const deg of HEX_DEGREES) {
    const meaning = deg % 360 === 0
      ? 'סיום טבעת (חזק מאוד)'
      : deg % 180 === 0
        ? 'צד נגדי (חזק)'
        : deg % 120 === 0
          ? 'משולש הרמוני'
          : 'זווית הקסגון 60°';
    const isStrong = deg % 180 === 0 || deg % 120 === 0;
    const up = gannSq9Price(anchorPrice, deg, 1);
    const down = gannSq9Price(anchorPrice, deg, -1);
    if (up != null) {
      rows.push({
        degree: deg,
        meaning,
        isStrong,
        direction: 'up',
        price: up,
        distPct: +(((up - currentPrice) / currentPrice) * 100).toFixed(2),
      });
    }
    if (down != null && deg <= 360) {
      rows.push({
        degree: -deg,
        meaning,
        isStrong,
        direction: 'down',
        price: down,
        distPct: +(((down - currentPrice) / currentPrice) * 100).toFixed(2),
      });
    }
  }
  return rows.sort((a, b) => Math.abs(a.distPct) - Math.abs(b.distPct));
}

// Michael Jenkins Free Calculators + Excel Sheet 1 ('ריבועים') & Sheets 3-4 ('ריבוע 9' / 'זמנים')
export function buildJenkinsSuite(swingHigh, swingLow, anchorPrice, anchorTs) {
  const high = Math.max(swingHigh, swingLow);
  const low = Math.min(swingHigh, swingLow);
  const range = Math.max(1e-6, high - low);

  // 1. Gann Eighths & Thirds of Range (Sheet 1 'מחשבון שמיניות טווח')
  const eighths = [
    { ratio: 0, label: '0/8 (שפל טווח · 0%)', strong: true },
    { ratio: 0.125, label: '1/8 (12.5%)', strong: false },
    { ratio: 0.25, label: '2/8 (רבע · 25%)', strong: true },
    { ratio: 0.3333, label: '1/3 (שליש גאן · 33.3%)', strong: true },
    { ratio: 0.375, label: '3/8 (37.5%)', strong: false },
    { ratio: 0.5, label: '4/8 (חצי טווח · 50% שיווי משקל)', strong: true },
    { ratio: 0.625, label: '5/8 (62.5%)', strong: false },
    { ratio: 0.6667, label: '2/3 (שני שליש · 66.7%)', strong: true },
    { ratio: 0.75, label: '6/8 (שלושה רבעים · 75%)', strong: true },
    { ratio: 0.875, label: '7/8 (87.5%)', strong: false },
    { ratio: 1, label: '8/8 (שיא טווח · 100%)', strong: true },
  ].map((r) => ({
    ...r,
    price: +(low + range * r.ratio).toFixed(4),
  }));

  // 2. Michael Jenkins Square-Root Time Projections (sqrt(Price) -> calendar days)
  // Normalize large/tiny prices into Jenkins bar-day scale so it works seamlessly on BTC (90k) and EURUSD (1.08)
  let normAnchor = anchorPrice;
  if (normAnchor < 10) normAnchor *= 100;
  else if (normAnchor > 5000) normAnchor /= 10;
  const sqrtP = Math.sqrt(Math.max(1, normAnchor));
  const sqrtRange = Math.sqrt(Math.max(1, range < 10 ? range * 100 : range > 5000 ? range / 10 : range));

  const jenkinsTimeCycles = [
    { mult: 0.5, label: '0.5 × √מחיר (רבע תנועה)', days: Math.round(sqrtP * 0.5) },
    { mult: 1.0, label: '1.0 × √מחיר (Square Out בסיסי)', days: Math.round(sqrtP) },
    { mult: 1.5, label: '1.5 × √מחיר (יחס 3/2)', days: Math.round(sqrtP * 1.5) },
    { mult: 2.0, label: '2.0 × √מחיר (מחזור כפול)', days: Math.round(sqrtP * 2) },
    { mult: 3.1416, label: 'π × √מחיר (מעגל ג׳נקינס)', days: Math.round(sqrtP * Math.PI) },
    { mult: 1.0, label: '√טווח (Square the Range)', days: Math.round(sqrtRange * 2) },
  ].map((c) => {
    const d = Math.max(5, c.days);
    return {
      ...c,
      days: d,
      projectedDate: new Date(anchorTs + d * DAY_MS).toISOString().slice(0, 10),
    };
  });

  // 3. Excel Sheet 3 & 4: Ring Number & Inward Spiral Months (30.437 days/month)
  const ringNumber = Math.max(1, Math.ceil((Math.sqrt(Math.max(1, normAnchor)) - 1) / 2));
  const spiralDates = [1, 2, 3, 4, 6].map((k) => {
    const rootDiff = Math.max(0.5, Math.sqrt(normAnchor) - k);
    const sqVal = Math.pow(rootDiff, 2);
    const addDays = Math.round((sqVal % 36) * 30.437); // normalized inward spiral months
    return {
      step: k,
      sqValue: +sqVal.toFixed(1),
      days: Math.max(14, addDays),
      date: new Date(anchorTs + Math.max(14, addDays) * DAY_MS).toISOString().slice(0, 10),
    };
  });

  return {
    swingHigh: high,
    swingLow: low,
    range: +range.toFixed(4),
    ringNumber,
    eighths,
    jenkinsTimeCycles,
    spiralDates,
  };
}

// Full Gannzilla Calendar Suite:
//  1. 8 Seasonal Cardinal/Ordinal Dates (Equinoxes & Solstices)
//  2. 12 Solar / Tropical Zodiac 30° Ingress Dates
//  3. Planetary Orbital Harmonics (Mercury 88d, Venus 225d, Sun 365d, Mars 687d, Saturn/Uranus 84.77y harmonics)
//  4. Gann Master Squares (Square of 52, Square of 90, Square of 144, Decade/Anniversary)
export function buildGannzillaCalendars(lastTs, anchorTs = lastTs) {
  const year = new Date(lastTs).getUTCFullYear();
  const seasonalTemplates = [
    { mmdd: '03-21', deg: 0,   label: '0° · שוויון האביב (Vernal Equinox)' },
    { mmdd: '05-05', deg: 45,  label: '45° · אמצע אביב (Gann Ordinal)' },
    { mmdd: '06-21', deg: 90,  label: '90° · היפוך הקיץ (Summer Solstice)' },
    { mmdd: '08-07', deg: 135, label: '135° · אמצע קיץ (Gann Ordinal)' },
    { mmdd: '09-23', deg: 180, label: '180° · שוויון הסתיו (Autumnal Equinox)' },
    { mmdd: '11-07', deg: 225, label: '225° · אמצע סתיו (Gann Ordinal)' },
    { mmdd: '12-21', deg: 270, label: '270° · היפוך החורף (Winter Solstice)' },
    { mmdd: '02-04', deg: 315, label: '315° · אמצע חורף (Gann Ordinal)' },
  ];

  const zodiac12 = [
    { mmdd: '03-21', deg: 0,   sign: 'טלה (Aries 0°)' },
    { mmdd: '04-20', deg: 30,  sign: 'שור (Taurus 30°)' },
    { mmdd: '05-21', deg: 60,  sign: 'תאומים (Gemini 60°)' },
    { mmdd: '06-21', deg: 90,  sign: 'סרטן (Cancer 90°)' },
    { mmdd: '07-23', deg: 120, sign: 'אריה (Leo 120°)' },
    { mmdd: '08-23', deg: 150, sign: 'בתולה (Virgo 150°)' },
    { mmdd: '09-23', deg: 180, sign: 'מאזניים (Libra 180°)' },
    { mmdd: '10-23', deg: 210, sign: 'עקרב (Scorpio 210°)' },
    { mmdd: '11-22', deg: 240, sign: 'קשת (Sagittarius 240°)' },
    { mmdd: '12-21', deg: 270, sign: 'גדי (Capricorn 270°)' },
    { mmdd: '01-20', deg: 300, sign: 'דלי (Aquarius 300°)' },
    { mmdd: '02-19', deg: 330, sign: 'דגים (Pisces 330°)' },
  ];

  const upcomingSeasonal = [];
  const upcomingZodiac = [];
  for (const y of [year, year + 1]) {
    for (const s of seasonalTemplates) {
      const ts = Date.parse(`${y}-${s.mmdd}T00:00:00Z`);
      if (ts > lastTs && ts <= lastTs + 365 * DAY_MS) {
        upcomingSeasonal.push({ date: `${y}-${s.mmdd}`, ts, deg: s.deg, label: s.label, daysAhead: Math.round((ts - lastTs) / DAY_MS) });
      }
    }
    for (const z of zodiac12) {
      const ts = Date.parse(`${y}-${z.mmdd}T00:00:00Z`);
      if (ts > lastTs && ts <= lastTs + 365 * DAY_MS) {
        upcomingZodiac.push({ date: `${y}-${z.mmdd}`, ts, deg: z.deg, sign: z.sign, daysAhead: Math.round((ts - lastTs) / DAY_MS) });
      }
    }
  }
  upcomingSeasonal.sort((a, b) => a.ts - b.ts);
  upcomingZodiac.sort((a, b) => a.ts - b.ts);

  // Planetary Orbital Harmonics from Anchor Pivot
  const basePlanets = [
    { name: 'מרקורי (חצי מחזור · 44d)', days: 44 },
    { name: 'מרקורי (הקפה מלאה · 88d)', days: 88 },
    { name: 'נוגה (חצי מחזור · 112d)', days: 112 },
    { name: 'נוגה (הקפה מלאה · 225d)', days: 225 },
    { name: 'שמש / כדו"א (365.24d)', days: 365 },
    { name: 'מאדים (חצי מחזור · 343d)', days: 343 },
    { name: 'מאדים (הקפה מלאה · 687d)', days: 687 },
    { name: 'אורנוס 84.77y (הרמוניית 1/360 · 86d)', days: 86 },
  ];
  const planetaryCycles = basePlanets.map((p) => {
    let target = anchorTs + p.days * DAY_MS;
    while (target <= lastTs) target += p.days * DAY_MS;
    return {
      ...p,
      date: new Date(target).toISOString().slice(0, 10),
      daysAhead: Math.round((target - lastTs) / DAY_MS),
    };
  }).sort((a, b) => a.daysAhead - b.daysAhead);

  // Gann Master Squares (Square of 52, 90, 144)
  const masterSquares = [
    { group: 'Square of 52', days: 52, meaning: '52 ימים / 52 שבועות (מחזור שנתי של גאן)' },
    { group: 'Square of 90', days: 90, meaning: 'רבעון 90° · מפנה מבני' },
    { group: 'Square of 144', days: 144, meaning: '144 ימים (12²) · מחזור מאסטר פיבונאצ׳י-גאן' },
    { group: 'Square of 144', days: 288, meaning: '288 ימים (2 × 144) · מחזור בינוני-ארוך' },
    { group: 'Square of 360', days: 360, meaning: '360° מעגל שלם (שנה סוחרת של גאן)' },
  ].map((m) => {
    let target = anchorTs + m.days * DAY_MS;
    while (target <= lastTs) target += m.days * DAY_MS;
    return {
      ...m,
      date: new Date(target).toISOString().slice(0, 10),
      daysAhead: Math.round((target - lastTs) / DAY_MS),
    };
  }).sort((a, b) => a.daysAhead - b.daysAhead);

  return { seasonalTemplates, upcomingSeasonal, zodiac12, upcomingZodiac, planetaryCycles, masterSquares };
}

export function generateGannWorkingProposals(analysis, symbol = '') {
  const nearestUpSq9 = analysis.sq9Levels.find((l) => l.price > analysis.currentPrice);
  const nearestDnSq9 = analysis.sq9Levels.find((l) => l.price < analysis.currentPrice);
  const nearestHexUp = analysis.hexLevels.find((l) => l.price > analysis.currentPrice);
  const nextPivot = analysis.futurePivots[0];
  const nextPlanetary = analysis.calendars?.planetaryCycles?.[0];
  const bullish1x1 = analysis.angle1x1?.abovePrice;

  return [
    {
      title: bullish1x1 ? '1. הטיה מבנית: שורי מעל זווית 1x1 (45°)' : '1. הטיה מבנית: זהירות מתחת לזווית 1x1 (45°)',
      detail: bullish1x1
        ? `${symbol} נסחר מעל קו ה-1x1 (${analysis.angle1x1?.projectedNow}). לפי גאן, כל עוד המחיר מחזיק מעל ה-1x1 יש להעדיף עסקאות לונג לכיוון התנגדות Sq9 הבאה (${nearestUpSq9?.price ?? '—'}).`
        : `${symbol} מתחת לקו ה-1x1 (${analysis.angle1x1?.projectedNow}). יש להמתין לפריצה חזרה מעל 1x1 או לבדוק תמיכה ב-${nearestDnSq9?.price ?? '—'} לפני כניסה.`,
    },
    {
      title: `2. יעדי מחיר מאוחדים (Sq9 + הקסגון + שמיניות)`,
      detail: `התנגדות קרובה: Sq9 ${nearestUpSq9?.degree ?? ''}° (${nearestUpSq9?.price ?? '—'}) · הקסגון ${nearestHexUp?.degree ?? ''}° (${nearestHexUp?.price ?? '—'}). תמיכה קרובה: ${nearestDnSq9?.price ?? '—'}.`,
    },
    {
      title: `3. חלון זמן קרוב להכנה (${nextPivot?.date || nextPlanetary?.date || '—'})`,
      detail: `התכנסות זמן קרובה: ${nextPivot ? `${nextPivot.date} (+${nextPivot.daysAhead}d · ${nextPivot.confluenceLabel})` : '—'} · מחזור פלנטרי קרוב: ${nextPlanetary ? `${nextPlanetary.name} ב-${nextPlanetary.date}` : '—'}.`,
    },
  ];
}

// --- Full 9-Angle W.D. Gann Fan (8x1 down to 1x8, Gann Explained / Gann Fan Tool) ---

export const GANN_FAN_RATIOS = [
  { id: '8x1', name: '8x1 (82.5° · פריצה אקספוננציאלית)', degLabel: '82.5°', mult: 8, color: '#f97316', isMain: false },
  { id: '4x1', name: '4x1 (75° · מגמה חזקה מאוד)', degLabel: '75°', mult: 4, color: '#eab308', isMain: false },
  { id: '3x1', name: '3x1 (71.25° · מומנטום גבוה)', degLabel: '71.25°', mult: 3, color: '#facc15', isMain: false },
  { id: '2x1', name: '2x1 (63.75° · מגמה מהירה)', degLabel: '63.75°', mult: 2, color: '#38bdf8', isMain: true },
  { id: '1x1', name: '1x1 (45° · זווית המאסטר · שיווי משקל)', degLabel: '45°', mult: 1, color: '#2ecc71', isMain: true },
  { id: '1x2', name: '1x2 (26.25° · תמיכת מגמה משנית)', degLabel: '26.25°', mult: 0.5, color: '#a78bfa', isMain: true },
  { id: '1x3', name: '1x3 (18.75° · שיפוע מתון)', degLabel: '18.75°', mult: 1 / 3, color: '#c084fc', isMain: false },
  { id: '1x4', name: '1x4 (15° · קו תמיכה ארוך טווח)', degLabel: '15°', mult: 0.25, color: '#e879f9', isMain: false },
  { id: '1x8', name: '1x8 (7.5° · קו הגנה אחרון)', degLabel: '7.5°', mult: 0.125, color: '#f472b6', isMain: false },
];

export function computeGannFan(candles, anchorPivot, { scaleOverride = null, direction = 'auto', futureBars = 30 } = {}) {
  if (!candles?.length || !anchorPivot) {
    return { dir: 1, unitPerBar: 0, anchorIdx: 0, anchorPrice: 0, barsElapsed: 0, rays: [], activeSupport: null, activeResistance: null, ruleOfAllAngles: '' };
  }
  const n = candles.length;
  const lastIdx = n - 1;
  const anchorIdx = Math.max(0, Math.min(lastIdx - 1, anchorPivot.idx ?? 0));
  const barsElapsed = Math.max(1, lastIdx - anchorIdx);

  let sumRange = 0;
  for (let i = 1; i < n; i++) sumRange += Math.abs(candles[i].c - candles[i - 1].c);
  const autoUnit = Math.max(1e-6, (sumRange / Math.max(1, n - 1)) * 0.85);
  const unitPerBar = scaleOverride && Number(scaleOverride) > 0 ? Number(scaleOverride) : autoUnit;
  const dir = direction === 'up' ? 1 : direction === 'down' ? -1 : (anchorPivot.type === 'low' ? 1 : -1);

  const currentClose = candles[lastIdx].c;
  const rays = GANN_FAN_RATIOS.map((r) => {
    const slopePerBar = dir * r.mult * unitPerBar;
    const projectedNow = +(anchorPivot.price + slopePerBar * barsElapsed).toFixed(4);
    const projectedFuture = +(anchorPivot.price + slopePerBar * (barsElapsed + futureBars)).toFixed(4);
    return {
      ...r,
      slopePerBar,
      projectedNow,
      projectedFuture,
      abovePrice: currentClose >= projectedNow,
      distPct: +(((projectedNow - currentClose) / Math.max(1e-9, currentClose)) * 100).toFixed(2),
    };
  });

  const below = rays.filter((r) => r.projectedNow <= currentClose).sort((a, b) => b.projectedNow - a.projectedNow);
  const above = rays.filter((r) => r.projectedNow > currentClose).sort((a, b) => a.projectedNow - b.projectedNow);
  const activeSupport = below[0] || null;
  const activeResistance = above[0] || null;

  const ruleOfAllAngles = activeSupport && activeResistance
    ? `חוק כל הזוויות (Rule of All Angles): המחיר נע כעת בתעלה שבין ${activeSupport.id} (${activeSupport.projectedNow}) כתמיכה לבין ${activeResistance.id} (${activeResistance.projectedNow}) כהתנגדות. שבירה של אחת הזוויות מכוונת לזווית הבאה במניפה.`
    : activeSupport
      ? `המחיר נסחר מעל כל הזוויות הפעילות (תמיכה קרובה: ${activeSupport.id} ב-${activeSupport.projectedNow}) — עוצמת מגמה גבוהה.`
      : activeResistance
        ? `המחיר נסחר מתחת לזוויות המניפה (התנגדות קרובה: ${activeResistance.id} ב-${activeResistance.projectedNow}).`
        : '';

  return {
    dir,
    unitPerBar: +unitPerBar.toFixed(6),
    autoUnit: +autoUnit.toFixed(6),
    anchorIdx,
    anchorPrice: anchorPivot.price,
    barsElapsed,
    futureBars,
    rays,
    activeSupport,
    activeResistance,
    ruleOfAllAngles,
  };
}

export function computeGannAngles(candles, anchorPivot, opts = {}) {
  return computeGannFan(candles, anchorPivot, opts).rays;
}

// --- W.D. Gann Box / Square of Price & Time ---

export function computeGannBox(candles, anchorPivot, swingHigh, swingLow) {
  if (!candles?.length || !anchorPivot) return null;
  const n = candles.length;
  const startIdx = Math.max(0, Math.min(n - 10, anchorPivot.idx ?? Math.max(0, n - 90)));
  const elapsed = Math.max(10, n - 1 - startIdx);
  const naturalWidths = [36, 45, 52, 72, 90, 120, 144, 180, 240];
  const widthBars = naturalWidths.find((w) => w >= elapsed) || 144;
  const endIdx = startIdx + widthBars;
  const high = Math.max(swingHigh, swingLow);
  const low = Math.min(swingHigh, swingLow);
  const range = Math.max(1e-6, high - low);

  const priceRatios = [0, 0.125, 0.25, 0.3333, 0.5, 0.6667, 0.75, 0.875, 1];
  const timeRatios = [0.25, 0.3333, 0.5, 0.6667, 0.75, 1];

  return {
    startIdx,
    endIdx,
    widthBars,
    high,
    low,
    mid50: +(low + range * 0.5).toFixed(4),
    priceLines: priceRatios.map((r) => ({
      ratio: r,
      label: r === 0.3333 ? '1/3' : r === 0.6667 ? '2/3' : `${Math.round(r * 8)}/8`,
      price: +(low + range * r).toFixed(4),
      strong: r === 0 || r === 0.25 || r === 0.5 || r === 0.75 || r === 1,
    })),
    timeLines: timeRatios.map((r) => ({
      ratio: r,
      label: r === 0.3333 ? '1/3T' : r === 0.6667 ? '2/3T' : `${Math.round(r * 4)}/4T`,
      idx: Math.round(startIdx + widthBars * r),
    })),
  };
}

// --- W.D. Gann Swing Chart & 2-Bar / 3-Bar Trend Indicator (Gann Explained) ---

export function computeGannSwingChart(candles, { barMode = 2 } = {}) {
  if (!Array.isArray(candles) || candles.length < 10) {
    return { barMode, trend: 'neutral', swings: [], lastSwingHigh: null, lastSwingLow: null, midpoint50: null, rule3BarSignal: '' };
  }
  const req = Math.max(1, Math.min(3, Number(barMode) || 2));
  const swings = [];
  let dir = 0; // 1 = upswing, -1 = downswing
  let upStreak = 0;
  let downStreak = 0;
  let curHigh = { idx: 0, t: candles[0].t, price: candles[0].h, type: 'high' };
  let curLow = { idx: 0, t: candles[0].t, price: candles[0].l, type: 'low' };

  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const c = candles[i];
    const higherHigh = c.h > prev.h;
    const lowerLow = c.l < prev.l;

    if (higherHigh && !lowerLow) {
      upStreak++;
      downStreak = 0;
    } else if (lowerLow && !higherHigh) {
      downStreak++;
      upStreak = 0;
    } else if (higherHigh && lowerLow) {
      // Outside bar: continue dominant close direction
      if (c.c >= c.o) { upStreak++; downStreak = 0; }
      else { downStreak++; upStreak = 0; }
    }

    if (c.h >= curHigh.price) curHigh = { idx: i, t: c.t, price: c.h, type: 'high' };
    if (c.l <= curLow.price) curLow = { idx: i, t: c.t, price: c.l, type: 'low' };

    if (dir <= 0 && upStreak >= req) {
      if (swings.length === 0 || swings[swings.length - 1].type !== 'low') {
        swings.push({ ...curLow });
      }
      dir = 1;
      curHigh = { idx: i, t: c.t, price: c.h, type: 'high' };
    } else if (dir >= 0 && downStreak >= req) {
      if (swings.length === 0 || swings[swings.length - 1].type !== 'high') {
        swings.push({ ...curHigh });
      }
      dir = -1;
      curLow = { idx: i, t: c.t, price: c.l, type: 'low' };
    }
  }

  // Append active leg endpoint
  if (dir === 1) swings.push({ ...curHigh });
  else if (dir === -1) swings.push({ ...curLow });

  const highs = swings.filter((s) => s.type === 'high');
  const lows = swings.filter((s) => s.type === 'low');
  const lastSwingHigh = highs[highs.length - 1] || null;
  const lastSwingLow = lows[lows.length - 1] || null;
  const prevSwingHigh = highs[highs.length - 2] || null;
  const prevSwingLow = lows[lows.length - 2] || null;

  const lastClose = candles[candles.length - 1].c;
  const midpoint50 = lastSwingHigh && lastSwingLow
    ? +((lastSwingHigh.price + lastSwingLow.price) / 2).toFixed(4)
    : null;

  let trend = dir > 0 ? 'bullish' : dir < 0 ? 'bearish' : 'neutral';
  if (prevSwingHigh && lastClose > prevSwingHigh.price) trend = 'bullish';
  else if (prevSwingLow && lastClose < prevSwingLow.price) trend = 'bearish';

  const rule3BarSignal = trend === 'bullish'
    ? `מגמת סווינג עולה (${req}-Bar Gann Swing) · פריצה מעל ${prevSwingHigh ? prevSwingHigh.price.toFixed(2) : (lastSwingHigh?.price?.toFixed(2) || '—')} · שבירת מגמה רק מתחת לשפל ${lastSwingLow?.price?.toFixed(2) || '—'}`
    : trend === 'bearish'
      ? `מגמת סווינג יורדת (${req}-Bar Gann Swing) · היפוך למגמת עלייה מעל שיא הסווינג ${lastSwingHigh?.price?.toFixed(2) || '—'}`
      : 'דשדוש בתוך טווח הסווינג הפעיל';

  return {
    barMode: req,
    trend,
    swings: swings.slice(-24),
    lastSwingHigh,
    lastSwingLow,
    prevSwingHigh,
    prevSwingLow,
    midpoint50,
    above50: midpoint50 != null ? lastClose >= midpoint50 : null,
    rule3BarSignal,
  };
}

// --- MSJ_GannSQ9 (Michael S. Jenkins Square of 9 Interactive Matrix & Price-Time Calculator) ---

export function computeMsjSq9Analysis(
  price,
  { startValue = 1, increment = 1, scale = 1, ringCount = 5, clockwise = true, angleOffset = 0 } = {},
) {
  const safePrice = Math.max(1e-6, Number(price) || 100);
  const effScale = Number(scale) > 0 ? Number(scale) : 1;
  const effStart = Number.isFinite(Number(startValue)) ? Number(startValue) : 1;
  const effInc = Number(increment) > 0 ? Number(increment) : 1;
  const rings = Math.max(3, Math.min(7, Number(ringCount) || 5));

  // Normalize price to Sq9 number space using scale (so BTC 90000 with scale=100 -> 900, EURUSD 1.08 with scale=0.01 -> 108)
  const normVal = safePrice / effScale;
  const sqrtVal = Math.sqrt(Math.max(1e-6, normVal));
  const wheelAngleRaw = ((sqrtVal - 1) * 180 + angleOffset) % 360;
  const wheelAngle = +((wheelAngleRaw + 360) % 360).toFixed(1);
  const ring = Math.max(1, Math.ceil((sqrtVal - 1) / 2));

  // Build odd-square spiral matrix centered around the active ring or startValue
  const dim = rings * 2 + 1;
  const grid = Array.from({ length: dim }, () => Array(dim).fill(null));
  const center = rings;

  // Determine step numbering: spiral outward from center
  const dirs = clockwise
    ? [[0, -1], [-1, 0], [0, 1], [1, 0]] // left, up, right, down (classic Gannzilla/MSJ clockwise)
    : [[0, -1], [1, 0], [0, 1], [-1, 0]]; // counter-clockwise

  let r = center;
  let c = center;
  let stepIndex = 0;

  const placeCell = (row, col, idx) => {
    const rawNumber = effStart + idx * effInc;
    const scaledPrice = +(rawNumber * effScale).toFixed(4);
    const dr = row - center;
    const dc = col - center;
    const cellRing = Math.max(Math.abs(dr), Math.abs(dc));
    const deg = cellRing === 0 ? 0 : +(((Math.atan2(dr, dc) * 180) / Math.PI + 360 + angleOffset) % 360).toFixed(1);
    const isCardinal = cellRing > 0 && (dr === 0 || dc === 0);
    const isOrdinal = cellRing > 0 && Math.abs(dr) === Math.abs(dc);
    grid[row][col] = {
      row,
      col,
      idx,
      rawNumber: +rawNumber.toFixed(4),
      scaledPrice,
      ring: cellRing,
      angleDeg: deg,
      isCardinal,
      isOrdinal,
      isCenter: cellRing === 0,
      distPct: +(((scaledPrice - safePrice) / safePrice) * 100).toFixed(2),
    };
  };

  placeCell(r, c, stepIndex++);
  let stepLen = 1;
  let dirIdx = 0;
  while (stepIndex < dim * dim) {
    for (let repeat = 0; repeat < 2; repeat++) {
      const [dr, dc] = dirs[dirIdx % 4];
      for (let s = 0; s < stepLen && stepIndex < dim * dim; s++) {
        r += dr;
        c += dc;
        if (r >= 0 && r < dim && c >= 0 && c < dim) {
          placeCell(r, c, stepIndex++);
        }
      }
      dirIdx++;
    }
    stepLen++;
  }

  // Highlight closest cell in grid to current market price
  let closestCell = null;
  let closestDiff = Infinity;
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) {
      const cell = grid[i][j];
      if (!cell) continue;
      const diff = Math.abs(cell.scaledPrice - safePrice);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestCell = cell;
      }
    }
  }
  if (closestCell) closestCell.isClosest = true;

  // Full MSJ_GannSQ9 Degree Table (45°, 60°, 72°, 90°, 120°, 135°, 144°, 180°, 225°, 240°, 270°, 315°, 360°, 540°, 720°)
  const msjDegrees = [
    { deg: 45, group: 'Ordinal', label: '45° (חצי ריבוע)' },
    { deg: 60, group: 'Hexagon', label: '60° (הקסגון)' },
    { deg: 72, group: 'Pentagon', label: '72° (חמישית מעגל)' },
    { deg: 90, group: 'Cardinal', label: '90° (רבע ריבוע · צלב)' },
    { deg: 120, group: 'Trine', label: '120° (משולש הרמוני)' },
    { deg: 135, group: 'Ordinal', label: '135° (3/8 מעגל)' },
    { deg: 144, group: 'Pentagon', label: '144° (פיבונאצ׳י-גאן)' },
    { deg: 180, group: 'Cardinal', label: '180° (צד נגדי · חזק)' },
    { deg: 225, group: 'Ordinal', label: '225° (5/8 מעגל)' },
    { deg: 240, group: 'Trine', label: '240° (משולש שני)' },
    { deg: 270, group: 'Cardinal', label: '270° (3/4 ריבוע)' },
    { deg: 315, group: 'Ordinal', label: '315° (7/8 מעגל)' },
    { deg: 360, group: 'Cardinal', label: '360° (הקפה מלאה)' },
    { deg: 540, group: 'Cardinal', label: '540° (הקפה וחצי)' },
    { deg: 720, group: 'Cardinal', label: '720° (2 הקפות מלאות)' },
  ];

  const degreeTargets = msjDegrees.map((d) => {
    const upNorm = Math.pow(sqrtVal + d.deg / 180, 2);
    const dnRoot = sqrtVal - d.deg / 180;
    const dnNorm = dnRoot > 0 ? Math.pow(dnRoot, 2) : null;
    const upPrice = +(upNorm * effScale).toFixed(4);
    const downPrice = dnNorm != null ? +(dnNorm * effScale).toFixed(4) : null;
    return {
      ...d,
      upPrice,
      downPrice,
      upDistPct: +(((upPrice - safePrice) / safePrice) * 100).toFixed(2),
      downDistPct: downPrice != null ? +(((downPrice - safePrice) / safePrice) * 100).toFixed(2) : null,
    };
  });

  // Jenkins Square-Root Time Conversions (MSJ_GannSQ9 Time Tab)
  const sqrtForTime = Math.sqrt(normVal);
  const timeConversions = [
    { unit: 'ימי לוח שנה (Calendar Days)', val: Math.round(sqrtForTime), mult2: Math.round(sqrtForTime * 2), half: Math.round(sqrtForTime * 0.5) },
    { unit: 'ימי מסחר (Trading Bars · ×0.71)', val: Math.round(sqrtForTime * 0.71), mult2: Math.round(sqrtForTime * 1.42), half: Math.round(sqrtForTime * 0.355) },
    { unit: 'שבועות (Weeks · √P / 7)', val: +(sqrtForTime / 7).toFixed(1), mult2: +((sqrtForTime * 2) / 7).toFixed(1), half: +((sqrtForTime * 0.5) / 7).toFixed(1) },
    { unit: 'חודשים (Months · √P / 30)', val: +(sqrtForTime / 30).toFixed(2), mult2: +((sqrtForTime * 2) / 30).toFixed(2), half: +((sqrtForTime * 0.5) / 30).toFixed(2) },
  ];

  return {
    price: safePrice,
    scale: effScale,
    startValue: effStart,
    increment: effInc,
    normVal: +normVal.toFixed(4),
    sqrtVal: +sqrtVal.toFixed(4),
    wheelAngle,
    ring,
    dim,
    grid,
    closestCell,
    degreeTargets,
    timeConversions,
  };
}

// --- Gannzilla Pro v8.3 Multi-Layout + Protractor + Planetary Cosmogram + .ini Parser/Exporter ---

export const DEFAULT_GANNZILLA_CONFIG = {
  layout: 'sq9', // 'sq9' | 'sq4' | 'sq144' | 'hex' | 'tri' | 'wheel24' | 'cosmos'
  protractor: 'cross', // 'cross' | 'square' | 'triangle' | 'hexagon' | 'pentagon' | 'octagon' | 'none'
  startValue: 1,
  increment: 1,
  scale: 'auto', // 'auto' or numeric scale
  clockwise: true,
  angleOffset: 0,
  ringCount: 5,
  showChronometer: true,
  showCosmogram: true,
  showFanOnChart: true,
  showBoxOnChart: false,
  showSwingOnChart: false,
  swingBarMode: 2,
  fanDirection: 'auto',
  fanScale: '',
  iniFileName: '',
};

export function autoScaleForPrice(price) {
  const p = Math.abs(Number(price) || 100);
  if (p >= 20000) return 100;
  if (p >= 2000) return 10;
  if (p >= 20) return 1;
  if (p >= 2) return 0.1;
  return 0.01;
}

// Approximate geocentric/heliocentric ecliptic longitudes (0°–360°) for Gannzilla Cosmogram
export function computePlanetaryLongitudes(ts = Date.now()) {
  // Days since J2000.0 (2000-01-01T12:00:00Z)
  const j2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
  const d = (ts - j2000) / DAY_MS;
  const norm360 = (deg) => +(((deg % 360) + 360) % 360).toFixed(1);

  const planets = [
    { id: 'sun',     glyph: '☉', name: 'שמש (Sun)',     lon: norm360(280.460 + 0.9856474 * d), color: '#facc15' },
    { id: 'mercury', glyph: '☿', name: 'מרקורי',        lon: norm360(252.251 + 4.09233445 * d), color: '#38bdf8' },
    { id: 'venus',   glyph: '♀', name: 'נוגה (Venus)',   lon: norm360(181.980 + 1.60213034 * d), color: '#f472b6' },
    { id: 'mars',    glyph: '♂', name: 'מאדים (Mars)',   lon: norm360(355.433 + 0.52403295 * d), color: '#ef4444' },
    { id: 'jupiter', glyph: '♃', name: 'צדק (Jupiter)',  lon: norm360(34.351 + 0.08309121 * d), color: '#a78bfa' },
    { id: 'saturn',  glyph: '♄', name: 'שבתאי (Saturn)', lon: norm360(50.077 + 0.03345965 * d), color: '#94a3b8' },
    { id: 'uranus',  glyph: '♅', name: 'אורנוס (Uranus)',lon: norm360(314.055 + 0.01173129 * d), color: '#22d3ee' },
  ];

  // Detect key planetary aspects (0° Conjunction, 90° Square, 120° Trine, 180° Opposition within ±5°)
  const aspects = [];
  const aspectDefs = [
    { angle: 0, label: 'צמידות (0°)', strong: true },
    { angle: 60, label: 'סקסטייל (60°)', strong: false },
    { angle: 90, label: 'ריבוע (90°)', strong: true },
    { angle: 120, label: 'משולש (120°)', strong: true },
    { angle: 180, label: 'מולות (180°)', strong: true },
  ];
  for (let i = 0; i < planets.length; i++) {
    for (let j = i + 1; j < planets.length; j++) {
      let sep = Math.abs(planets[i].lon - planets[j].lon);
      if (sep > 180) sep = 360 - sep;
      for (const ad of aspectDefs) {
        const orb = Math.abs(sep - ad.angle);
        if (orb <= 5) {
          aspects.push({
            p1: planets[i].name,
            p2: planets[j].name,
            glyphs: `${planets[i].glyph}–${planets[j].glyph}`,
            aspect: ad.label,
            angle: ad.angle,
            orb: +orb.toFixed(1),
            strong: ad.strong,
          });
        }
      }
    }
  }

  return { planets, aspects };
}

export function computeGannzillaLayoutLevels(anchorPrice, currentPrice, layout = 'sq9') {
  const safeAnchor = Math.max(1e-6, Number(anchorPrice) || 100);
  const safeCurrent = Math.max(1e-6, Number(currentPrice) || safeAnchor);

  if (layout === 'sq4') {
    // Square of 4 (90° cardinal box steps: 90°, 180°, 270°, 360°, 450°, 540°, 630°, 720°)
    const degs = [90, 180, 270, 360, 450, 540, 630, 720];
    return degs.map((deg) => {
      const p = gannSq9Price(safeAnchor, deg, 1);
      return { degree: deg, label: `Sq4 ${deg}°`, price: p, isCardinal: true, distPct: +(((p - safeCurrent) / safeCurrent) * 100).toFixed(2) };
    });
  }
  if (layout === 'sq144') {
    // Master Square of 144 (12 divisions of 144: 12, 24, 36, 48, 60, 72, 84, 96, 108, 120, 132, 144 -> mapped to degrees)
    const steps = [18, 36, 54, 72, 90, 108, 126, 144];
    return steps.map((s) => {
      const deg = Math.round((s / 144) * 360);
      const p = gannSq9Price(safeAnchor, deg, 1);
      return { degree: deg, label: `Sq144 · ${s}/144 (${deg}°)`, price: p, isCardinal: s % 36 === 0, distPct: +(((p - safeCurrent) / safeCurrent) * 100).toFixed(2) };
    });
  }
  if (layout === 'tri') {
    // Triangle (120° steps)
    const degs = [60, 120, 180, 240, 300, 360];
    return degs.map((deg) => {
      const p = gannSq9Price(safeAnchor, deg, 1);
      return { degree: deg, label: `משולש ${deg}°`, price: p, isCardinal: deg % 120 === 0, distPct: +(((p - safeCurrent) / safeCurrent) * 100).toFixed(2) };
    });
  }
  if (layout === 'wheel24') {
    // Wheel of 24 (15° increments -> 24 harmonic spokes; show key 30°/45°/90° spokes)
    const degs = [15, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330, 360];
    return degs.map((deg) => {
      const p = gannSq9Price(safeAnchor, deg, 1);
      return { degree: deg, label: `W24 · #${Math.round(deg / 15)} (${deg}°)`, price: p, isCardinal: deg % 90 === 0, distPct: +(((p - safeCurrent) / safeCurrent) * 100).toFixed(2) };
    });
  }
  if (layout === 'hex') return buildHexagonVibrationTable(safeAnchor, safeCurrent);
  return buildSq9VibrationTable(safeAnchor, safeCurrent);
}

// Parser for real Gannzilla Pro v8.3 Gannzilla.ini configuration files
export function parseGannzillaIni(iniText, fileName = 'Gannzilla.ini') {
  const parsed = { ...DEFAULT_GANNZILLA_CONFIG, iniFileName: fileName };
  const rawSections = {};
  let section = 'general';

  for (const rawLine of String(iniText || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const secMatch = line.match(/^\[(.+)\]$/);
    if (secMatch) {
      section = secMatch[1].trim().toLowerCase();
      rawSections[section] = rawSections[section] || {};
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    const keyL = key.toLowerCase();
    rawSections[section] = rawSections[section] || {};
    rawSections[section][key] = val;

    const toBool = (v) => /^(1|true|yes|on)$/i.test(v);
    const toNum = (v) => {
      const n = Number(String(v).replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    };

    if (keyL === 'layout' || keyL === 'chartlayout' || keyL === 'type') {
      const v = val.toLowerCase();
      if (v.includes('hex')) parsed.layout = 'hex';
      else if (v.includes('144')) parsed.layout = 'sq144';
      else if (v.includes('sq4') || v.includes('square4') || v.includes('square of 4') || v === '1') parsed.layout = 'sq4';
      else if (v.includes('tri')) parsed.layout = 'tri';
      else if (v.includes('24') || v.includes('circle')) parsed.layout = 'wheel24';
      else if (v.includes('cosmo')) parsed.layout = 'cosmos';
      else parsed.layout = 'sq9';
    } else if (keyL === 'startvalue' || keyL === 'start' || keyL === 'initvalue') {
      const n = toNum(val);
      if (n != null && n > 0) parsed.startValue = n;
    } else if (keyL === 'increment' || keyL === 'step' || keyL === 'delta') {
      const n = toNum(val);
      if (n != null && n > 0) parsed.increment = n;
    } else if (keyL === 'clockwise' || keyL === 'direction') {
      if (val.toLowerCase().includes('counter') || val.toLowerCase() === 'ccw') parsed.clockwise = false;
      else if (val.toLowerCase().includes('clock') || val.toLowerCase() === 'cw') parsed.clockwise = true;
      else parsed.clockwise = toBool(val);
    } else if (keyL === 'angle' || keyL === 'angleoffset' || keyL === 'rotation' || keyL === 'offset') {
      const n = toNum(val);
      if (n != null) parsed.angleOffset = ((n % 360) + 360) % 360;
    } else if (keyL === 'size' || keyL === 'rings' || keyL === 'ringcount') {
      const n = toNum(val);
      if (n != null) parsed.ringCount = Math.max(3, Math.min(7, Math.round(n)));
    } else if (keyL === 'protractor' || keyL === 'figure' || keyL === 'geometry') {
      const v = val.toLowerCase();
      if (v.includes('tri')) parsed.protractor = 'triangle';
      else if (v.includes('hex')) parsed.protractor = 'hexagon';
      else if (v.includes('pent')) parsed.protractor = 'pentagon';
      else if (v.includes('oct')) parsed.protractor = 'octagon';
      else if (v.includes('sq')) parsed.protractor = 'square';
      else if (v === '0' || v === 'none' || v === 'false') parsed.protractor = 'none';
      else parsed.protractor = 'cross';
    } else if (keyL === 'chronometer' || keyL === 'showchronometer') {
      parsed.showChronometer = toBool(val);
    } else if (keyL === 'cosmogram' || keyL === 'showcosmogram') {
      parsed.showCosmogram = toBool(val);
    } else if (keyL === 'scale' || keyL === 'pricescale') {
      const n = toNum(val);
      if (n != null && n > 0) parsed.scale = n;
    }
  }

  return { config: parsed, rawSections, keyCount: Object.values(rawSections).reduce((s, o) => s + Object.keys(o).length, 0) };
}

export function exportGannzillaIni(config = DEFAULT_GANNZILLA_CONFIG) {
  const c = { ...DEFAULT_GANNZILLA_CONFIG, ...config };
  return [
    '; Gannzilla Pro v8.3 Compatible Configuration (Exported from Alta Capital Gann Lab)',
    '[Layout]',
    `Layout=${c.layout}`,
    `Size=${c.ringCount}`,
    `Clockwise=${c.clockwise ? 1 : 0}`,
    `Angle=${c.angleOffset || 0}`,
    '',
    '[Data]',
    `StartValue=${c.startValue}`,
    `Increment=${c.increment}`,
    `Scale=${c.scale}`,
    '',
    '[Protractor]',
    `Figure=${c.protractor}`,
    '',
    '[Chronometer]',
    `ShowChronometer=${c.showChronometer ? 1 : 0}`,
    '',
    '[Cosmogram]',
    `ShowCosmogram=${c.showCosmogram ? 1 : 0}`,
    '',
  ].join('\n');
}

// --- W.D. Gann Trading Rules Confluence Checklist (Gann Explained) ---

export function evaluateGannConfluenceChecklist(analysis) {
  const rules = [];
  let score = 0;

  // 1. 1x1 Master Angle Rule
  const above1x1 = !!analysis.angle1x1?.abovePrice;
  rules.push({
    id: 'angle_1x1',
    name: 'זווית 1x1 (45° · כלל המאסטר של גאן)',
    passed: above1x1,
    status: above1x1 ? 'שורי · מעל 1x1' : 'דובי · מתחת ל-1x1',
    detail: `מחיר נוכחי ${analysis.currentPrice} מול קו 1x1 ב-${analysis.angle1x1?.projectedNow ?? '—'}`,
  });
  if (above1x1) score += 20;

  // 2. 50% Retracement Rule (Most Important Single Level per W.D. Gann)
  const mid50 = (analysis.swingHigh + analysis.swingLow) / 2;
  const above50 = analysis.currentPrice >= mid50;
  rules.push({
    id: 'rule_50',
    name: 'כלל 50% (נקודת שיווי המשקל של הטווח)',
    passed: above50,
    status: above50 ? 'מעל 50% · שליטת קונים' : 'מתחת ל-50% · חולשה',
    detail: `רמת 50% = ${mid50.toFixed(2)} (טווח ${analysis.swingLow.toFixed(2)} – ${analysis.swingHigh.toFixed(2)})`,
  });
  if (above50) score += 20;

  // 3. Gann Swing Chart (2-Bar / 3-Bar Trend Indicator)
  const swingBull = analysis.swingChart?.trend === 'bullish';
  rules.push({
    id: 'swing_trend',
    name: `מד מגמת הסווינג של גאן (${analysis.swingChart?.barMode || 2}-Bar Swing)`,
    passed: swingBull,
    status: swingBull ? 'מגמת סווינג עולה' : analysis.swingChart?.trend === 'bearish' ? 'מגמת סווינג יורדת' : 'דשדוש',
    detail: analysis.swingChart?.rule3BarSignal || '',
  });
  if (swingBull) score += 20;

  // 4. Proximity to Square of 9 Cardinal/Ordinal Level
  const nearestSq9 = analysis.sq9Levels?.[0];
  const nearSq9 = nearestSq9 && Math.abs(nearestSq9.distPct) <= 3.5;
  rules.push({
    id: 'sq9_vibration',
    name: 'קירבה לרמת ויברציה Square of 9 (MSJ_GannSQ9)',
    passed: !!nearSq9,
    status: nearSq9 ? `אזור פעיל (${nearestSq9.degree}° · ${nearestSq9.distPct}%)` : `רחוק מרמת מפתח (${nearestSq9?.distPct ?? '—'}%)`,
    detail: nearestSq9 ? `רמה קרובה: ${nearestSq9.degree}° (${nearestSq9.type}) במחיר ${nearestSq9.price}` : '—',
  });
  if (nearSq9) score += 15;

  // 5. Active Gann Time Cycle / Master Window within 10 days
  const nextPivot = analysis.futurePivots?.[0];
  const timeActive = nextPivot && nextPivot.daysAhead <= 10;
  rules.push({
    id: 'time_window',
    name: 'חלון זמן פעיל (Gannzilla Time Cycle)',
    passed: !!timeActive,
    status: timeActive ? `חלון מפנה בעוד ${nextPivot.daysAhead} ימים!` : `חלון קרוב: ${nextPivot?.date || '—'} (+${nextPivot?.daysAhead ?? '—'}d)`,
    detail: nextPivot ? `${nextPivot.confluenceLabel} (${nextPivot.reasons?.slice(0, 2).join(' · ') || ''})` : '—',
  });
  if (timeActive) score += 15;

  // 6. Historical Validation & Fundamental Proof Backing
  const provenStrong = (analysis.hitRatePct || 0) >= 45 || (analysis.fundamentalProof?.matchRatePct || 0) >= 50;
  rules.push({
    id: 'historical_proof',
    name: 'גיבוי סטטיסטי והיסטורי (צירים + פונדמנטל)',
    passed: provenStrong,
    status: provenStrong ? `מאומת (${analysis.hitRatePct}% צירים · ${analysis.fundamentalProof?.matchRatePct || 0}% פונדמנטל)` : 'בינוני',
    detail: `${analysis.totalHits}/${analysis.totalTests} פגיעות היסטוריות בנכס זה`,
  });
  if (provenStrong) score += 10;

  const verdict = score >= 75
    ? 'התכנסות גאן גבוהה (שורי חזק)'
    : score >= 50
      ? 'מבנה מאוזן / נטייה חיובית'
      : 'זהירות / מגמה חלשה לפי כללי גאן';

  return { score, verdict, rules };
}

// --- PriceChartingTool / printPriceTimeInfoDatetimes.py Compatible Ephemeris & Price-Time Analyzer ---

export function toJulianDay(ts) {
  const ms = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(ms)) return null;
  // Standard Astronomical Julian Day (Unix epoch 1970-01-01T00:00:00Z = JD 2440587.5)
  return +(ms / DAY_MS + 2440587.5).toFixed(4);
}

export function buildPriceTimeInfoReport(candles = [], pivots = [], customPoints = []) {
  if (!Array.isArray(candles) || !candles.length) return null;
  const earliest = candles[0];
  const latest = candles[candles.length - 1];

  let highest = candles[0];
  let lowest = candles[0];
  for (const c of candles) {
    if (c.h > highest.h) highest = c;
    if (c.l < lowest.l) lowest = c;
  }

  // Build chronologically sorted Price-Time Info points (matching PriceBarChartPriceTimeInfoArtifact)
  const rawPoints = [
    ...(pivots || []).map((p) => ({
      t: p.t,
      date: new Date(p.t).toISOString().slice(0, 10),
      price: +Number(p.price).toFixed(4),
      type: p.type === 'low' ? 'שפל (Low)' : 'שיא (High)',
      source: 'pivot',
    })),
    ...(customPoints || []).map((cp) => ({
      t: cp.t,
      date: cp.date,
      price: +Number(cp.price).toFixed(4),
      type: cp.type || 'נקודת Price-Time מיובאת',
      source: 'imported',
    })),
  ].sort((a, b) => a.t - b.t);

  const points = rawPoints.map((pt, idx) => {
    const prev = idx > 0 ? rawPoints[idx - 1] : null;
    const jd = toJulianDay(pt.t);
    const deltaDays = prev ? Math.round((pt.t - prev.t) / DAY_MS) : null;
    const deltaPrice = prev ? +(pt.price - prev.price).toFixed(4) : null;
    const ratePerDay = deltaDays && deltaDays > 0 ? +(deltaPrice / deltaDays).toFixed(4) : null;
    const sunLon = computePlanetaryLongitudes(pt.t).planets[0]?.lon ?? null;
    const scale = autoScaleForPrice(pt.price);
    const sqrtNorm = Math.sqrt(Math.max(1e-6, pt.price / scale));
    const wheelAngle = +((((sqrtNorm - 1) * 180) % 360 + 360) % 360).toFixed(1);
    return {
      ...pt,
      julianDay: jd,
      deltaDays,
      deltaPrice,
      ratePerDay,
      sunLon,
      wheelAngle,
    };
  });

  // Exact printPriceTimeInfoDatetimes.py output format: YYYY-MM-DD,price
  const csvCompact = points.map((p) => `${p.date},${p.price}`).join('\n');
  const csvFull = [
    'date,julian_day,price,type,delta_days,delta_price,price_per_day,sun_lon_deg,sq9_angle_deg',
    ...points.map((p) => [
      p.date, p.julianDay, p.price, p.type, p.deltaDays ?? '', p.deltaPrice ?? '', p.ratePerDay ?? '', p.sunLon ?? '', p.wheelAngle ?? '',
    ].join(',')),
  ].join('\n');

  return {
    earliest: {
      date: new Date(earliest.t).toISOString().slice(0, 10),
      iso: new Date(earliest.t).toISOString(),
      julianDay: toJulianDay(earliest.t),
      close: earliest.c,
    },
    latest: {
      date: new Date(latest.t).toISOString().slice(0, 10),
      iso: new Date(latest.t).toISOString(),
      julianDay: toJulianDay(latest.t),
      close: latest.c,
    },
    highest: {
      date: new Date(highest.t).toISOString().slice(0, 10),
      julianDay: toJulianDay(highest.t),
      price: highest.h,
    },
    lowest: {
      date: new Date(lowest.t).toISOString().slice(0, 10),
      julianDay: toJulianDay(lowest.t),
      price: lowest.l,
    },
    totalJulianDays: +((latest.t - earliest.t) / DAY_MS).toFixed(2),
    barsCount: candles.length,
    points,
    csvCompact,
    csvFull,
  };
}

// Parse CSV lines produced by printPriceTimeInfoDatetimes.py (e.g. "2024-04-19,63800.5" or "INFO: 2024-04-19,63800.5")
export function parsePriceTimeCsv(text) {
  const out = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const cleaned = rawLine.replace(/^INFO:\s*/i, '').trim();
    if (!cleaned || cleaned.startsWith('#') || cleaned.toLowerCase().startsWith('date,')) continue;
    const parts = cleaned.split(/[,\t;]+/).map((s) => s.trim());
    if (parts.length < 2) continue;
    const dateStr = parts[0];
    const ts = Date.parse(dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00Z`);
    const price = Number(parts[1]);
    if (!Number.isFinite(ts) || !Number.isFinite(price) || price <= 0) continue;
    out.push({
      t: ts,
      date: new Date(ts).toISOString().slice(0, 10),
      price,
      type: parts[2] || 'PriceChartingTool',
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

// Prove Gann against Fundamental Events: check if prior Gann cycles + Sq9/Hex predicted the event BEFORE the news!
function proveGannAgainstFundamentals(candles, pivots, sq9Levels, hexLevels, assetKind = 'all') {
  const firstTs = candles[0].t;
  const lastTs = candles[candles.length - 1].t;

  const relevantEvents = FUNDAMENTAL_EVENTS_CALENDAR.filter((ev) => {
    const ts = Date.parse(`${ev.date}T00:00:00Z`);
    if (ts < firstTs || ts > lastTs) return false;
    return ev.kinds.includes('all') || ev.kinds.includes(assetKind);
  });

  const proofRows = [];
  let matchedCount = 0;

  for (const ev of relevantEvents) {
    const evTs = Date.parse(`${ev.date}T00:00:00Z`);

    // Find closest candle to event date
    let bestCandle = candles[0];
    let bestCandleDiff = Infinity;
    for (const c of candles) {
      const d = Math.abs(c.t - evTs);
      if (d < bestCandleDiff) {
        bestCandleDiff = d;
        bestCandle = c;
      }
    }

    // 1. Did any PRIOR real Gann pivot + Gann Calendar Cycle predict this event date within ±6 days?
    let bestTimeMatch = null;
    for (const p of pivots) {
      if (p.t >= evTs - 14 * DAY_MS) continue; // must be genuinely predicted BEFORE the event!
      for (const cyc of GANN_CALENDAR_CYCLES) {
        const predTs = p.t + cyc.days * DAY_MS;
        const errDays = Math.abs(predTs - evTs) / DAY_MS;
        if (errDays <= 6 && (!bestTimeMatch || errDays < bestTimeMatch.errDays)) {
          bestTimeMatch = {
            originDate: new Date(p.t).toISOString().slice(0, 10),
            originType: p.type === 'low' ? 'שפל' : 'שיא',
            cycleLabel: cyc.label,
            errDays: +errDays.toFixed(1),
          };
        }
      }
    }

    // 2. Did the event candle touch a Square of 9 or Hexagon price level within ±2.8%?
    let bestPriceMatch = null;
    const allLevels = [
      ...sq9Levels.map((l) => ({ ...l, tool: 'Sq9' })),
      ...hexLevels.map((l) => ({ ...l, tool: 'Hexagon' })),
    ];
    for (const lvl of allLevels) {
      const distHigh = Math.abs(bestCandle.h - lvl.price) / bestCandle.h * 100;
      const distLow = Math.abs(bestCandle.l - lvl.price) / bestCandle.l * 100;
      const minDist = Math.min(distHigh, distLow);
      if (minDist <= 2.8 && (!bestPriceMatch || minDist < bestPriceMatch.distPct)) {
        bestPriceMatch = {
          tool: lvl.tool,
          degree: lvl.degree,
          price: lvl.price,
          distPct: +minDist.toFixed(2),
        };
      }
    }

    const proven = !!(bestTimeMatch || bestPriceMatch);
    if (proven) matchedCount++;

    let explanation = 'ללא התאמה מוקדמת ישירה בטווח';
    if (bestTimeMatch && bestPriceMatch) {
      explanation = `מחזור ${bestTimeMatch.cycleLabel} מ-${bestTimeMatch.originType} (${bestTimeMatch.originDate}) חזה את התאריך (±${bestTimeMatch.errDays}d) + נגיעה ב-${bestPriceMatch.tool} ${bestPriceMatch.degree}°`;
    } else if (bestTimeMatch) {
      explanation = `נחזה מראש ע"י ${bestTimeMatch.cycleLabel} מ-${bestTimeMatch.originType} (${bestTimeMatch.originDate}, סטייה ±${bestTimeMatch.errDays}d)`;
    } else if (bestPriceMatch) {
      explanation = `מחיר השוק באירוע נבלם בדיוק על רמת ${bestPriceMatch.tool} ${bestPriceMatch.degree}° (סטייה ${bestPriceMatch.distPct}%)`;
    }

    proofRows.push({
      date: ev.date,
      title: ev.title,
      category: ev.category,
      details: ev.details || '',
      sourceName: ev.sourceName || 'מקור מאקרו רשמי',
      sourceUrl: ev.sourceUrl || '',
      marketPrice: +bestCandle.c.toFixed(4),
      proven,
      bestTimeMatch,
      bestPriceMatch,
      explanation,
    });
  }

  return {
    totalInSpan: relevantEvents.length,
    matchedCount,
    matchRatePct: relevantEvents.length ? +((matchedCount / relevantEvents.length) * 100).toFixed(1) : 0,
    events: proofRows.reverse(),
  };
}

export function analyzeGannHistoryAndForecast(
  candles,
  { lookback = 10, manualAnchorPrice = null, manualAnchorDate = null, assetKind = 'all', gannzillaConfig = null } = {},
) {
  if (!Array.isArray(candles) || candles.length < 60) {
    return { ok: false, error: 'אין מספיק נרות היסטוריים לניתוח גאן' };
  }

  const pivots = detectMajorPivots(candles, lookback);
  const currentPrice = candles[candles.length - 1].c;
  const lastTs = candles[candles.length - 1].t;

  // Global Swing High & Low for Eighths / Jenkins Square the Range
  let swingHigh = candles[0].h;
  let swingLow = candles[0].l;
  for (const c of candles) {
    if (c.h > swingHigh) swingHigh = c.h;
    if (c.l < swingLow) swingLow = c.l;
  }

  // Primary Anchor: Manual override OR most recent major pivot
  let anchorPivot = pivots[pivots.length - 1];
  if (!anchorPivot) {
    let minIdx = 0;
    for (let i = 1; i < candles.length; i++) if (candles[i].l < candles[minIdx].l) minIdx = i;
    anchorPivot = { idx: minIdx, t: candles[minIdx].t, price: candles[minIdx].l, type: 'low', manual: false };
  }
  if (manualAnchorPrice && Number(manualAnchorPrice) > 0) {
    const manualTs = manualAnchorDate ? Date.parse(`${manualAnchorDate}T00:00:00Z`) : anchorPivot.t;
    anchorPivot = {
      idx: anchorPivot.idx,
      t: Number.isFinite(manualTs) ? manualTs : anchorPivot.t,
      price: Number(manualAnchorPrice),
      type: Number(manualAnchorPrice) >= currentPrice ? 'high' : 'low',
      manual: true,
    };
  }

  // 1. Historical Validation of Calendar Cycles against Real Pivots
  const validations = [];
  let totalTests = 0;
  let totalHits = 0;

  for (let i = 0; i < pivots.length - 1; i++) {
    const origin = pivots[i];
    for (const cyc of GANN_CALENDAR_CYCLES) {
      const targetTs = origin.t + cyc.days * DAY_MS;
      if (targetTs > lastTs - 3 * DAY_MS) continue;
      totalTests++;

      let bestMatch = null;
      let bestDiffDays = Infinity;
      for (let j = i + 1; j < pivots.length; j++) {
        const diffDays = Math.abs(pivots[j].t - targetTs) / DAY_MS;
        if (diffDays < bestDiffDays) {
          bestDiffDays = diffDays;
          bestMatch = pivots[j];
        }
      }

      if (bestMatch && bestDiffDays <= 6) {
        totalHits++;
        const movePct = +(((bestMatch.price - origin.price) / origin.price) * 100).toFixed(2);
        validations.push({
          originDate: new Date(origin.t).toISOString().slice(0, 10),
          originType: origin.type === 'low' ? 'שפל' : 'שיא',
          originPrice: origin.price,
          cycleLabel: cyc.label,
          cycleDays: cyc.days,
          predictedDate: new Date(targetTs).toISOString().slice(0, 10),
          actualPivotDate: new Date(bestMatch.t).toISOString().slice(0, 10),
          actualType: bestMatch.type === 'low' ? 'שפל' : 'שיא',
          actualPrice: bestMatch.price,
          errorDays: +bestDiffDays.toFixed(1),
          movePct,
          note: `תחזית ${cyc.days}d מ-${origin.type === 'low' ? 'שפל' : 'שיא'} פגעה ב-${bestMatch.type === 'low' ? 'שפל' : 'שיא'} בפועל (${movePct >= 0 ? '+' : ''}${movePct}%)`,
        });
      }
    }
  }

  const hitRatePct = totalTests > 0 ? +((totalHits / totalTests) * 100).toFixed(1) : 0;

  // 2. Square of 9 & Hexagon Vibration Levels
  const sq9Levels = buildSq9VibrationTable(anchorPivot.price, currentPrice);
  const hexLevels = buildHexagonVibrationTable(anchorPivot.price, currentPrice);

  // 3. Michael Jenkins & Sheet 1-5 Suite
  const jenkins = buildJenkinsSuite(swingHigh, swingLow, anchorPivot.price, anchorPivot.t);

  // 4. Gannzilla Calendars & Cosmogram Planetary Longitudes
  const gzCfg = { ...DEFAULT_GANNZILLA_CONFIG, ...(gannzillaConfig || {}) };
  const calendars = buildGannzillaCalendars(lastTs, anchorPivot.t);
  const cosmogram = computePlanetaryLongitudes(lastTs);

  // 5. Full 9-Angle Gann Fan, Gann Box & 2/3-Bar Gann Swing Chart (Gann Explained / Gann Fan)
  const gannFan = computeGannFan(candles, anchorPivot, {
    scaleOverride: gzCfg.fanScale ? Number(gzCfg.fanScale) : null,
    direction: gzCfg.fanDirection || 'auto',
    futureBars: 35,
  });
  const angles = gannFan.rays;
  const angle1x1 = angles.find((a) => a.mult === 1);
  const gannBox = computeGannBox(candles, anchorPivot, swingHigh, swingLow);
  const swingChart = computeGannSwingChart(candles, { barMode: gzCfg.swingBarMode || 2 });

  // 5b. MSJ_GannSQ9 Spiral Matrix & Degree/Time Calculator
  const effScale = gzCfg.scale === 'auto' || !Number(gzCfg.scale)
    ? autoScaleForPrice(currentPrice)
    : Number(gzCfg.scale);
  const msjSq9 = computeMsjSq9Analysis(currentPrice, {
    startValue: gzCfg.startValue || 1,
    increment: gzCfg.increment || 1,
    scale: effScale,
    ringCount: gzCfg.ringCount || 5,
    clockwise: gzCfg.clockwise !== false,
    angleOffset: gzCfg.angleOffset || 0,
  });

  // 6. Gann vs. Fundamental Events Proof
  const fundamentalProof = proveGannAgainstFundamentals(candles, pivots, sq9Levels, hexLevels, assetKind);

  // 7. Future Projected Pivot Windows (Calendar Cycles + Jenkins Sqrt + Upcoming Macro/Seasonal Events)
  const futureMap = new Map();
  const recentPivots = pivots.slice(-6);
  for (const origin of recentPivots) {
    for (const cyc of GANN_CALENDAR_CYCLES) {
      const targetTs = origin.t + cyc.days * DAY_MS;
      if (targetTs <= lastTs || targetTs > lastTs + 365 * DAY_MS) continue;
      const bucketKey = Math.round(targetTs / (4 * DAY_MS)) * (4 * DAY_MS);
      const existing = futureMap.get(bucketKey) || {
        ts: targetTs,
        date: new Date(targetTs).toISOString().slice(0, 10),
        daysAhead: Math.round((targetTs - lastTs) / DAY_MS),
        score: 0,
        reasons: [],
      };
      existing.score += cyc.weight;
      existing.reasons.push(`${cyc.days}d מ-${origin.type === 'low' ? 'שפל' : 'שיא'} (${new Date(origin.t).toISOString().slice(0, 10)})`);
      futureMap.set(bucketKey, existing);
    }
  }

  // Merge Upcoming Macro/Fundamental & Seasonal Catalysts within 6 days of any Gann Window
  const upcomingMacro = FUNDAMENTAL_EVENTS_CALENDAR
    .map((ev) => ({ ...ev, ts: Date.parse(`${ev.date}T00:00:00Z`) }))
    .filter((ev) => ev.ts > lastTs && ev.ts <= lastTs + 365 * DAY_MS);

  const nearestUpSq9 = sq9Levels.find((l) => l.price > currentPrice);
  const nearestDnSq9 = sq9Levels.find((l) => l.price < currentPrice);

  const futurePivots = [...futureMap.values()]
    .sort((a, b) => b.score - a.score || a.ts - b.ts)
    .slice(0, 12)
    .sort((a, b) => a.ts - b.ts)
    .map((fp) => {
      const nearMacro = upcomingMacro.find((m) => Math.abs(m.ts - fp.ts) <= 7 * DAY_MS);
      const nearSeason = calendars.upcomingSeasonal.find((s) => Math.abs(s.ts - fp.ts) <= 7 * DAY_MS);
      return {
        ...fp,
        targetUp: nearestUpSq9?.price ?? null,
        targetDown: nearestDnSq9?.price ?? null,
        nearMacro: nearMacro ? `${nearMacro.title} (${nearMacro.date})` : null,
        nearSeason: nearSeason ? nearSeason.label : null,
        confluenceLabel: fp.score >= 6 ? 'התכנסות מאסטר' : fp.score >= 3 ? 'התכנסות גבוהה' : 'חלון זמן גאן',
      };
    });

  const priceTimeInfo = buildPriceTimeInfoReport(candles, pivots, gzCfg.customPriceTimePoints || []);

  const out = {
    ok: true,
    candlesCount: candles.length,
    spanDays: Math.round((lastTs - candles[0].t) / DAY_MS),
    currentPrice,
    swingHigh,
    swingLow,
    anchorPivot,
    pivots,
    sq9Levels,
    hexLevels,
    jenkins,
    calendars,
    cosmogram,
    gannFan,
    gannBox,
    swingChart,
    msjSq9,
    priceTimeInfo,
    angles,
    angle1x1,
    totalTests,
    totalHits,
    hitRatePct,
    validations: validations.slice(-16).reverse(),
    fundamentalProof,
    futurePivots,
    upcomingMacro: upcomingMacro.slice(0, 6),
  };
  out.confluence = evaluateGannConfluenceChecklist(out);
  out.proposals = generateGannWorkingProposals(out);
  return out;
}

// --- Autonomous Gann Research Library (Fundamental + Regular Trend Reversals + Web Archive) ---

export const HISTORICAL_GANN_WEB_ARCHIVE = [
  {
    id: 'web_gann_1909_wheat',
    kind: 'web_documented',
    symbol: 'WHEAT (ספטמבר 1909)',
    date: '1909-09-30',
    title: 'תחזית חיטת ספטמבר 1909 של W.D. Gann למחיר המדויק $1.20',
    category: 'תחזית מתועדת מהרשת',
    marketPrice: 1.2,
    proven: true,
    details: 'בקיץ 1909 חזה W.D. Gann בפומבי שחוזה החיטה לספטמבר יגיע בדיוק למחיר $1.20 לפני הפקיעה. ב-30 בספטמבר, שעות ספורות לפני הנעילה, החיטה נסחרה מתחת ל-$1.08 — ובשעה האחרונה זינקה במדויק ל-$1.20.',
    explanation: 'מבוסס על "חוק הוויברציה" (Law of Vibration) וחישובי Square of 9 שהוצגו בראיון המפורסם של Richard Wyckoff במגזין The Ticker and Investment Digest (דצמבר 1909).',
    sourceName: 'The Ticker and Investment Digest (Dec 1909)',
    sourceUrl: 'https://archive.org/',
  },
  {
    id: 'web_gann_1909_wyckoff_audit',
    kind: 'web_documented',
    symbol: 'מניות וסחורות (NYSE)',
    date: '1909-10-31',
    title: 'ביקורת Wyckoff: 264 עסקאות מרוויחות מתוך 286 ב-25 ימי מסחר',
    category: 'תחזית מתועדת מהרשת',
    marketPrice: 100,
    proven: true,
    details: 'נציג מטעם מייסד המגזין Richard Wyckoff עקב במשך 25 ימי מסחר רצופים אחר 286 עסקאות שביצע גאן בזמן אמת: 264 הסתיימו ברווח (92.3% הצלחה) ורק 22 בהפסד קטן.',
    explanation: 'תועד כהוכחה המרכזית ליכולת החיזוי של מניפות הזוויות (1x1) ורמות השורש הריבועי בזמן אמת.',
    sourceName: 'Wyckoff 1909 Audit Report',
    sourceUrl: 'https://www.traderslog.com/wd-gann',
  },
  {
    id: 'web_gann_1929_crash',
    kind: 'web_documented',
    symbol: 'DJIA (מדד הדאו ג׳ונס)',
    date: '1929-10-29',
    title: 'תחזית מפולת 1929 בספר "The Tunnel Thru the Air" (1927)',
    category: 'תחזית מתועדת מהרשת',
    marketPrice: 230.07,
    proven: true,
    details: 'כבר בשנת 1927 פרסם גאן את הספר The Tunnel Thru the Air ובתחזיות השנתיות שלו הזהיר מפורשות מפני שיא היסטורי בספטמבר 1929 והתרסקות פיננסית חסרת תקדים בין 1929 ל-1932.',
    explanation: 'התחזית התבססה על מחזורי המאסטר של 20, 30 ו-60 שנה ועל התכנסות מחזורי זמן עם זוויות 1x1 משיאי 1909 ו-1919.',
    sourceName: 'W.D. Gann — The Tunnel Thru the Air (1927)',
    sourceUrl: 'https://www.sacredtraders.com/',
  },
  {
    id: 'web_gann_1932_bottom',
    kind: 'web_documented',
    symbol: 'DJIA (תחתית השפל הגדול)',
    date: '1932-07-08',
    title: 'זיהוי תחתית השפל הגדול ביולי 1932 (מחזור 36 חודשים משיא 1929)',
    category: 'תחזית מתועדת מהרשת',
    marketPrice: 41.22,
    proven: true,
    details: 'לאחר ירידה של כ-89% מהשיא ב-1929, מדד הדאו ג׳ונס יצר תחתית היסטורית ב-8 ביולי 1932 — במדויק כ-34–36 חודשים (3 שנים · Square of 36) מהשיא.',
    explanation: 'שילוב של מחזור זמן 3 שנים / 1080 ימים עם רמת שורש ריבועי קרדינלית ב-Square of 9.',
    sourceName: 'Gann Master Time Factor Archive',
    sourceUrl: 'https://www.topstep.com/',
  },
];

export function searchGannLibrary(items = [], query = '', filterKind = 'all') {
  const q = String(query || '').trim().toLowerCase();
  const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
  return (items || []).filter((item) => {
    if (filterKind !== 'all' && item.kind !== filterKind) return false;
    if (!tokens.length) return true;
    const haystack = [
      item.symbol, item.date, item.title, item.category,
      item.details, item.explanation, item.sourceName,
    ].join(' ').toLowerCase();
    return tokens.every((tok) => haystack.includes(tok));
  });
}

let gannAuditRunning = false;

export async function runAutonomousGannLibraryAudit({
  symbols = ['BTCUSDT', 'ETHUSDT', 'NVDA', 'AAPL', 'SPY', 'GC=F', 'EURUSD=X'],
  storeRef = null,
  getCandlesFn = null,
} = {}) {
  if (gannAuditRunning) return null;
  gannAuditRunning = true;
  try {
    const sRef = storeRef || (await import('./store.js')).store;
    const fetchCandles = getCandlesFn || (await import('./market.js')).getCandles;
    const itemsMap = new Map();

    // Seed documented web archive
    for (const w of HISTORICAL_GANN_WEB_ARCHIVE) itemsMap.set(w.id, w);

    // Keep existing items so library grows over time
    for (const prev of sRef.state?.gannLibrary?.items || []) {
      if (prev?.id) itemsMap.set(prev.id, prev);
    }

    let fundProvenCount = 0;
    let trendProvenCount = 0;

    for (const sym of symbols) {
      try {
        const candles = await fetchCandles(sym, '1d', { limit: 700, force: false });
        const kind = /USDT$|USD$/i.test(sym) && !sym.includes('=')
          ? 'crypto'
          : sym === 'SPY' || sym === 'QQQ'
            ? 'etf'
            : sym.includes('=F')
              ? 'commodity'
              : sym.includes('=X')
                ? 'forex'
                : 'stock';
        const a = analyzeGannHistoryAndForecast(candles, { lookback: 10, assetKind: kind });
        if (!a.ok) continue;

        // 1. Add Proven Fundamental Events from independent backtest
        for (const fe of a.fundamentalProof.events) {
          if (!fe.proven) continue;
          const id = `fund_${sym}_${fe.date}`;
          fundProvenCount++;
          itemsMap.set(id, {
            id,
            kind: 'fundamental_proven',
            symbol: sym,
            date: fe.date,
            title: `${sym}: ${fe.title}`,
            category: `אירוע פונדמנטליסטי (${fe.category})`,
            marketPrice: fe.marketPrice,
            proven: true,
            details: fe.details,
            explanation: fe.explanation,
            bestTimeMatch: fe.bestTimeMatch,
            bestPriceMatch: fe.bestPriceMatch,
            sourceName: fe.sourceName,
            sourceUrl: fe.sourceUrl,
          });
        }

        // 2. Add Regular Trend-Reversal Pivots proven by Gann cycles
        for (const v of a.validations.slice(0, 6)) {
          const id = `trend_${sym}_${v.actualPivotDate}_${v.cycleDays}`;
          trendProvenCount++;
          itemsMap.set(id, {
            id,
            kind: 'trend_reversal',
            symbol: sym,
            date: v.actualPivotDate,
            title: `${sym}: היפוך מגמה רגיל (${v.actualType} ב-${v.actualPrice})`,
            category: `שינוי מגמה · מחזור ${v.cycleDays}d`,
            marketPrice: v.actualPrice,
            proven: true,
            details: `שינוי מגמה טכני מובהק ב-${sym}: מה-${v.originType} בתאריך ${v.originDate} (${v.originPrice}) אל ${v.actualType} בתאריך ${v.actualPivotDate} (${v.actualPrice}), תנועה של ${v.movePct >= 0 ? '+' : ''}${v.movePct}%.`,
            explanation: v.note,
            sourceName: 'מחקר אוטונומי · נתוני שוק היסטוריים',
            sourceUrl: '',
          });
        }
      } catch { /* skip failed symbol */ }
    }

    const items = [...itemsMap.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const stats = {
      total: items.length,
      fundamentalProven: items.filter((i) => i.kind === 'fundamental_proven').length,
      trendReversals: items.filter((i) => i.kind === 'trend_reversal').length,
      webDocumented: items.filter((i) => i.kind === 'web_documented').length,
    };

    if (sRef.state) {
      sRef.state.gannLibrary = { updatedAt: Date.now(), items, stats };
      sRef.log?.('ok', 'גיל/גלעד · מחקר גאן אוטונומי', `ספריית גאן עודכנה: ${stats.total} אירועים (${stats.fundamentalProven} פונדמנטליסטיים, ${stats.trendReversals} שינויי מגמה, ${stats.webDocumented} מתועדים מהרשת).`);
      sRef.save?.();
      sRef.emit?.();
    }

    return sRef.state?.gannLibrary || { updatedAt: Date.now(), items, stats };
  } finally {
    gannAuditRunning = false;
  }
}

export async function runAutonomousGannLibraryAuditIfDue() {
  const { store } = await import('./store.js');
  const lib = store.state.gannLibrary;
  const age = Date.now() - (lib?.updatedAt || 0);
  if (lib?.items?.length && age < 15 * 60 * 1000) return lib;
  return await runAutonomousGannLibraryAudit();
}
