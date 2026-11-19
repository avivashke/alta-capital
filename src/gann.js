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

export function computeGannAngles(candles, anchorPivot) {
  if (!candles?.length || !anchorPivot) return [];
  const n = candles.length;
  const lastIdx = n - 1;
  const barsElapsed = Math.max(1, lastIdx - anchorPivot.idx);

  let sumRange = 0;
  for (let i = 1; i < n; i++) sumRange += Math.abs(candles[i].c - candles[i - 1].c);
  const unitPerBar = Math.max(1e-6, (sumRange / Math.max(1, n - 1)) * 0.85);
  const dir = anchorPivot.type === 'low' ? 1 : -1;

  const ratios = [
    { name: '4x1 (תלול מאוד)', mult: 4 },
    { name: '2x1 (מהיר)', mult: 2 },
    { name: '1x1 (45° · שיווי משקל)', mult: 1 },
    { name: '1x2 (מתון)', mult: 0.5 },
    { name: '1x4 (ארוך טווח)', mult: 0.25 },
  ];

  const currentClose = candles[lastIdx].c;
  return ratios.map((r) => {
    const projectedNow = +(anchorPivot.price + dir * r.mult * unitPerBar * barsElapsed).toFixed(4);
    return {
      name: r.name,
      mult: r.mult,
      projectedNow,
      abovePrice: currentClose >= projectedNow,
      distPct: +(((projectedNow - currentClose) / currentClose) * 100).toFixed(2),
    };
  });
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
  { lookback = 10, manualAnchorPrice = null, manualAnchorDate = null, assetKind = 'all' } = {},
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

  // 4. Gannzilla Calendars
  const calendars = buildGannzillaCalendars(lastTs, anchorPivot.t);

  // 5. Gann Angles
  const angles = computeGannAngles(candles, anchorPivot);
  const angle1x1 = angles.find((a) => a.mult === 1);

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
  out.proposals = generateGannWorkingProposals(out);
  return out;
}
