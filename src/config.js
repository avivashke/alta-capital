// Static configuration: desks (trading units), agents, model providers, bot platforms.

export const BARS_PER_YEAR = { '5m': 105120, '15m': 35040, '1h': 8760, '4h': 2190, '1d': 365, '1w': 52 };

// How deep each backtest looks, in bars. 1d ≈ 10+ years, 1w ≈ 10 years, 1h ≈ a year.
// Providers page back as far as they allow and the rest is sliced to these limits.
// Deeper history = a more meaningful dry-run / walk-forward verdict (5m ~28d, 15m ~94d, 1h ~500d, 1d ~8y).
// The deep window runs ONLY on the local Base Server (its cycles run in a worker thread). The browser, Cloudflare Workers
// and GitHub Actions keep the light window so pages never freeze and edge CPU/time limits are respected.
const IS_LOCAL_BASE_SERVER = typeof process !== 'undefined' && process.env?.ALTA_BASE_SERVER === '1';
export const BACKTEST_HISTORY = IS_LOCAL_BASE_SERVER
  ? { '5m': 8000, '15m': 9000, '1h': 12000, '1d': 3000, '1w': 800 }
  : { '5m': 2000, '15m': 3000, '1h': 4000, '1d': 3000, '1w': 800 };

// Symbols each desk's winning strategy is cross-tested on, so the team can see
// which stock (or coin) the strategy actually works best on.
export const SCAN_UNIVERSE = {
  stock: ['NVDA', 'AAPL', 'MSFT', 'TSLA', 'AMZN', 'GOOGL', 'META', 'AMD', 'NFLX', 'PLTR', 'SPY', 'QQQ'],
  crypto: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOGEUSDT'],
};

export function scanUniverseFor(symbol) {
  return /USDT$/i.test(symbol || '') ? SCAN_UNIVERSE.crypto : SCAN_UNIVERSE.stock;
}

export const DESKS = [
  {
    id: 'desk_5m', label: 'תוך־יומי · 5 דקות', short: '5m', tf: '5m', kind: 'intraday',
    symbol: 'BTCUSDT', venue: 'Binance / Kraken', weight: 0.15, horizon: 'דקות עד שעות',
    mandate: 'סקאלפינג מבוקר: פריצות ומומנטום קצר עם סטופ צמוד.',
  },
  {
    id: 'desk_15m', label: 'תוך־יומי · 15 דקות', short: '15m', tf: '15m', kind: 'intraday',
    symbol: 'ETHUSDT', venue: 'Binance / Kraken', weight: 0.2, horizon: 'שעות',
    mandate: 'מסחר תוך־יומי עם פילטר מגמה וניהול סיכון לפי ATR.',
  },
  {
    id: 'desk_1h', label: 'תוך־יומי · נר שעה', short: '1h', tf: '1h', kind: 'intraday',
    symbol: 'BTCUSDT', venue: 'Binance / Kraken', weight: 0.25, horizon: '1–3 ימים',
    mandate: 'מגמה והמשכיות: אחזקות של שעות בודדות עם יעד רווח מוגדר.',
  },
  {
    id: 'desk_1d', label: 'סווינג · חודשי (יומי)', short: '1d', tf: '1d', kind: 'swing',
    symbol: 'BTCUSDT', venue: 'Binance / Kraken', weight: 0.2, horizon: 'שבועות עד חודש',
    mandate: 'סווינג על נרות יומיים: כניסה על פריצות וממוצעים נעים.',
  },
  {
    id: 'desk_1w', label: 'סווינג · שנתי (שבועי)', short: '1w', tf: '1w', kind: 'swing',
    symbol: 'ETHUSDT', venue: 'Binance / Kraken', weight: 0.14, horizon: 'חודשים עד שנה',
    mandate: 'פוזיציות ארוכות טווח עם פילטר מומנטום רחב וסטופ רחב.',
  },
  {
    id: 'desk_nvda', label: 'מניות · NVIDIA (שעתי)', short: 'NVDA', tf: '1h', kind: 'intraday',
    symbol: 'NVDA', venue: 'Yahoo Finance · NASDAQ', weight: 0.12, horizon: 'תוך־יומי / סווינג',
    mandate: 'בדיקת אסטרטגיות גאן ומומנטום על מניית NVDA מנתוני Yahoo Finance.',
  },
  {
    id: 'desk_spy', label: 'מדדים · S&P 500 (יומי)', short: 'SPY', tf: '1d', kind: 'swing',
    symbol: 'SPY', venue: 'Yahoo Finance · NYSE', weight: 0.12, horizon: 'סווינג רב־שבועי',
    mandate: 'אימות חוסן אסטרטגיות גאן ומגמה על מדד השוק הרחב SPY.',
  },
  {
    id: 'desk_aapl', label: 'מניות · Apple (יומי)', short: 'AAPL', tf: '1d', kind: 'swing',
    symbol: 'AAPL', venue: 'Yahoo Finance · NASDAQ', weight: 0.12, horizon: 'סווינג רב־שבועי',
    mandate: 'בחינת מחזורי זמן וריבוע התשע של גאן על מניית AAPL.',
  },
];

export const AGENT_ROSTER = [
  { id: 'cio', name: 'אוריה', role: 'סמנכ״ל השקעות', icon: '♠', focus: 'ניהול תיק הסוכנים, החלטות קידום והקצאת הון' },
  { id: 'quant', name: 'נועה', role: 'אנליסטית קוונטית', icon: '∑', focus: 'סריקת אסטרטגיות ובניית השערות מסחר' },
  { id: 'backtest', name: 'איתי', role: 'מהנדס בקטסט', icon: '⌛', focus: 'הרצות עבר, חלוקת in-sample / out-of-sample' },
  { id: 'optimizer', name: 'ליה', role: 'סוכנת אופטימיזציה', icon: '⚙', focus: 'כיול פרמטרים עד מעבר לסף רווחיות' },
  { id: 'risk', name: 'דניאל', role: 'מנהל סיכונים', icon: '⛨', focus: 'מגבלות drawdown, חשיפה ומינוף' },
  { id: 'dev', name: 'גיא', role: 'סוכן פיתוח וגרסאות', icon: '⌥', focus: 'אריזת גרסאות וקוד לבוטים בקוד פתוח' },
  { id: 'exec', name: 'תמר', role: 'סוכנת ביצוע', icon: '▶', focus: 'מעבר מ-dry-run להרצה חיה על הפלטפורמה' },
  { id: 'intel', name: 'עומר', role: 'אנליסט מודיעין', icon: '⌁', focus: 'GitHub, רשתות חברתיות וחדשות' },
  { id: 'ta', name: 'יעל', role: 'מנתחת טכנית', icon: '∿', focus: 'מגמה, מומנטום, תנודתיות ומבנה מחיר' },
  { id: 'gann_time', name: 'גדעון', role: 'אנליסט מחזורי זמן גאן', icon: '⏱', focus: 'מומחה מחזורי זמן של גאן: ניתוח רב-שנתי של גרפים ונתונים היסטוריים לזיהוי מחזורים, תאריכי מפנה ולוח שנה מסחרי' },
  { id: 'gann_geometry', name: 'גליה', role: 'אנליסטית זוויות ומבנה גאן', icon: '⌖', focus: 'ניתוח זוויות גאן, רמות מחיר/זמן, ריבועי גאן ומבנה גאומטרי לזיהוי אזורי תמיכה/התנגדות ודפוסים' },
  { id: 'gann_patterns', name: 'גיל', role: 'אנליסט תבניות גאן', icon: '◈', focus: 'זיהוי תבניות חוזרות, הרמוניות ומחזוריות בגרפים רב-שנתיים ושילוב מחקר גאן עם אסטרטגיות מסחר' },
  { id: 'gann_square', name: 'גלעד', role: 'אנליסט ריבוע התשע ומחיר-זמן', icon: '▣', focus: 'חוקר שיטות גאן: ריבוע התשע, חישובי מחיר/זמן, רמות קרדינליות ויישום במציאת אזורי מפנה ואופטימיזציה' },
  { id: 'gann_master', name: 'גנית', role: 'אנליסטית מחזורי שוק ויישום גאן', icon: '⌬', focus: 'חוקרת מחזורי שוק היסטוריים, מניפות/זוויות מאסטר ותרגום שיטות גאן לאסטרטגיות ומיטוב פרמטרים לרובוטים' },
  { id: 'github_scout', name: 'נדב', role: 'חוקר GitHub וחדשנות קוד', icon: '⌘', focus: 'סורק תדיר ריפואים ב-GitHub וברשת על גאן, אינדיקטורים, אסטרטגיות וייעול קוד כדי לשמור על המערכת עדכנית' },
  { id: 'auditor', name: 'אמיר', role: 'מבקר אמת ואימות נתונים', icon: '⚖', focus: 'סוכן ביקורתי המונע הזיות, מוודא עבודה אך ורק על נתוני אמת של השוק וחוסם קידום אסטרטגיות עם Overfitting, עמלות חסרות או מדדים לא ריאליים' },
  { id: 'x_fundamental', name: 'רוני', role: 'חוקר פונדמנטלי בדפדפן X', icon: '𝕏', focus: 'נכנס לדפדפן האמיתי במחשב עם משתמש ה-X הייעודי, סורק ציוצי אמת על מאקרו, דוחות, מניות וקריפטו ומפיק מודיעין פונדמנטלי מאומת עם קישורים ישירים למקור' },
  { id: 'yt_strategy_scout', name: 'יונתן', role: 'חוקר יוטיוב · גאן ואסטרטגיות', icon: '▶', focus: 'סורק יוטיוב אחר סרטוני גאן לשיפור המודול ויוצרי אסטרטגיות מוכחות (כמו Doug & Silvia, TradingLab, Michael Jenkins), מפיק בלופרינטים ומקים בוטים ייעודיים עד הוכחת רווחיות ויישום' },
];

export const STRATEGY_LABELS = {
  ema_trend: 'מגמת ממוצעים נעים (EMA)',
  rsi_reversion: 'חזרה לממוצע (RSI)',
  breakout: 'פריצת ערוץ (Donchian)',
  momentum: 'מומנטום (ROC)',
  macd_swing: 'MACD + פילטר מגמה',
  structure_pullback: 'משיכה למבנה מגמה (Price Action · Pullback)',
  gann_swing_sq9: 'גאן סווינג + Square of 9',
  gann_time_cycle: 'מחזורי זמן גאן (Time Cycle)',
  supertrend_adx: 'Supertrend + ADX',
  mean_reversion_z: 'Mean Reversion (Z-Score)',
  vol_breakout: 'פריצת תנודתיות (ATR/ER)',
};

export const LLM_PROVIDERS = {
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: '', shape: 'openai', keyHint: 'sk-...', free: false },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: '', shape: 'openai', keyHint: 'sk-or-...', free: true },
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: '', shape: 'openai', keyHint: 'gsk_...', free: true },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: '', shape: 'openai', keyHint: 'sk-...', free: false },
  together: { label: 'Together', baseUrl: 'https://api.together.xyz/v1', model: '', shape: 'openai', keyHint: '...', free: false },
  mistral: { label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', model: '', shape: 'openai', keyHint: '...', free: true },
  anthropic: { label: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com/v1', model: '', shape: 'anthropic', keyHint: 'sk-ant-...', free: false },
  gemini: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: '', shape: 'gemini', keyHint: 'AIza...', free: true },
  ollama: { label: 'Ollama (מקומי)', baseUrl: 'http://localhost:11434/v1', model: '', shape: 'openai', keyHint: 'ללא מפתח', free: true },
  custom: { label: 'OpenAI-compatible מותאם', baseUrl: '', model: '', shape: 'openai', keyHint: '...', free: false },
};

export const BINANCE_TESTNET = {
  baseUrl: 'https://testnet.binance.vision/api/v3',
  wsBaseUrl: 'wss://testnet.binance.vision/ws',
  makerFee: 0.001,
  takerFee: 0.001,
  symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'ADAUSDT', 'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT'],
};

export const PAPER_TRADING = {
  initialBalance: 100000,
  taxRate: 0.25, // מס רווחי הון בישראל
  minBacktestReturnPct: 0, // סף רווח מינימלי בבדיקת עבר לפני הפעלת תיק דמה
  minBacktestTrades: 10, // מינימום עסקאות בבדיקת עבר
  minProfitFactor: 1.1,
  maxDrawdownPct: 30,
  dryRunCyclesBeforeLive: 3, // כמה מחזורי דריי-ראן לפני מעבר לנייר חי
};

export const PLATFORMS = {
  freqtrade: {
    label: 'Freqtrade', lang: 'Python', license: 'GPL-3.0',
    repo: 'https://github.com/freqtrade/freqtrade',
    blurb: 'בוט קריפטו בקוד פתוח עם ממשק וובהוק, Hyperopt ו-backtesting. הפורמט הנפוץ ביותר לקהילה.',
  },
  jesse: {
    label: 'Jesse', lang: 'Python', license: 'MIT',
    repo: 'https://github.com/jesse-ai/jesse',
    blurb: 'סביבת מחקר ובקטסט מהירה עם תחביר אסטרטגיה תמציתי.',
  },
  octobot: {
    label: 'OctoBot', lang: 'Python', license: 'GPL-3.0',
    repo: 'https://github.com/Drakkar-Software/OctoBot',
    blurb: 'פלטפורמת בוטים עם ארכיטקטורת Evaluator/Trading mode.',
  },
  superalgos: {
    label: 'Superalgos', lang: 'JS', license: 'Apache-2.0',
    repo: 'https://github.com/Superalgos/Superalgos',
    blurb: 'מערכת מסחר ויזואלית עם ייצוא הגדרות JSON.',
  },
  generic: {
    label: 'JSON כללי', lang: 'JSON', license: '—',
    repo: '',
    blurb: 'מפרט ניטרלי שאפשר לחבר לכל מנוע שרץ על השרת שלך.',
  },
  tradingview: {
    label: 'TradingView (Pine Script)', lang: 'Pine Script', license: 'MPL-2.0',
    repo: 'https://www.tradingview.com',
    blurb: 'ייצוא אסטרטגיה כ-Pine Script להרצה על TradingView (backtest + paper trading ב-UI).',
  },
};

export const RESEARCH_SOURCES = {
  github: {
    label: 'GitHub Search API', url: 'https://api.github.com/search/repositories',
    limit: 10, windowMs: 60_000,
    note: '10 בקשות בדקה ללא אימות, 30 עם טוקן. סורק ריפואים של אסטרטגיות ובוטים.',
  },
  feargreed: {
    label: 'Alternative.me Fear & Greed', url: 'https://api.alternative.me/fng/',
    limit: 20, windowMs: 3_600_000,
    note: 'מדד סנטימנט יומי חינמי ללא מפתח, CORS פתוח.',
  },
  coingecko: {
    label: 'CoinGecko Trending', url: 'https://api.coingecko.com/api/v3/search/trending',
    limit: 15, windowMs: 3_600_000,
    note: 'מטבעות במגמת חיפוש — פרוקסי לעניין ציבורי.',
  },
  news: {
    label: 'חדשות RSS (Yahoo · CNBC · CoinDesk · Fed)', url: '/api/market?action=news&symbol=ALL',
    limit: 30, windowMs: 3_600_000,
    note: 'סריקה אוטומטית חינמית מ-9 פידים פיננסיים (Yahoo Finance, CNBC, MarketWatch, Fed, CoinDesk, Cointelegraph, Decrypt, SeekingAlpha, Google News).',
  },
  reddit: {
    label: 'Reddit (r/algotrading · Crypto · Stocks)', url: '/api/market?action=reddit',
    limit: 20, windowMs: 3_600_000,
    note: 'שאיבת פוסטים חמים מ-r/algotrading, r/CryptoCurrency, r/stocks ו-r/investing דרך פרוקסי השרת ללא חסימת CORS.',
  },
  youtube: {
    label: 'YouTube (Bloomberg · CNBC · Coin Bureau · Cowen)', url: '/api/market?action=youtube',
    limit: 20, windowMs: 3_600_000,
    note: 'ערוצי YouTube רשמיים (Atom RSS) למחקר מאקרו, דוחות, קוונט וקריפטו: Bloomberg, CNBC, Yahoo Finance, Coin Bureau, Benjamin Cowen, Patrick Boyle.',
  },
  arxiv: {
    label: 'arXiv Quant Finance (q-fin)', url: '/api/market?action=arxiv',
    limit: 15, windowMs: 3_600_000,
    note: 'מאמרי מחקר אקדמיים יומיים במימון כמותי (אלגוטריידינג, ניהול תיקים וסיכונים) להזנת רעיונות אסטרטגיה לצוות.',
  },
  hackernews: {
    label: 'Hacker News (Tech · Quant · AI)', url: '/api/market?action=hackernews',
    limit: 20, windowMs: 3_600_000,
    note: 'דיוני הנדסת מסחר, AI, NVIDIA וקריפטו בזמן אמת דרך Algolia HN API.',
  },
};

export const NAV = [
  { id: 'overview', label: 'סקירה', icon: '◧' },
  { id: 'desks', label: 'שולחנות מסחר', icon: '▤' },
  { id: 'agents', label: 'הצוות', icon: '☻' },
  { id: 'lab', label: 'מעבדת אסטרטגיות', icon: '⚗' },
  { id: 'bots', label: 'גרסאות ובוטים', icon: '⌥' },
  { id: 'research', label: 'מחקר וסריקה', icon: '⌁' },
  { id: 'sentiment', label: 'סנטימנט וחדשות', icon: '◉' },
  { id: 'portfolio', label: 'תיק מסחר', icon: '💼' },
  { id: 'charts', label: 'גרפי TradingView ואינדיקטורים', icon: '📈' },
  { id: 'gann', label: 'מחקר וחיזויי גאן', icon: '◬' },
  { id: 'fundamentals', label: 'ניתוח פונדמנטלי', icon: '🏛' },
  { id: 'nostro', label: 'מבחני נוסטרו', icon: '🏆' },
  { id: 'invo', label: 'חדרי מסחר וחיקוי Invo', icon: '👥' },
  { id: 'academy', label: 'צ׳אט חינוכי ואסטרטגיות', icon: '🎓' },
  { id: 'advisor', label: 'יועץ AI', icon: '✦' },
  { id: 'settings', label: 'הגדרות ומפתחות', icon: '⚙' },
  { id: 'docs', label: 'מדריך הקמה', icon: '❯' },
];

export const DISCLAIMER =
  'המערכת מריצה בקטסטים ומסחר על נייר בלבד. אין כאן ביצוע פקודות, חיבור לבורסה או הבטחת רווח. ' +
  'ביצועים היסטוריים אינם מנבאים תשואה עתידית, ומסחר ממונף עלול להפסיד את כל ההון.';
