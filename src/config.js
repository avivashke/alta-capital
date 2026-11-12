// Static configuration: desks (trading units), agents, model providers, bot platforms.

export const BARS_PER_YEAR = { '5m': 105120, '15m': 35040, '1h': 8760, '4h': 2190, '1d': 365, '1w': 52 };

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
    symbol: 'ETHUSDT', venue: 'Binance / Kraken', weight: 0.2, horizon: 'חודשים עד שנה',
    mandate: 'פוזיציות ארוכות טווח עם פילטר מומנטום רחב וסטופ רחב.',
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
];

export const STRATEGY_LABELS = {
  ema_trend: 'מגמת ממוצעים נעים (EMA)',
  rsi_reversion: 'חזרה לממוצע (RSI)',
  breakout: 'פריצת ערוץ (Donchian)',
  momentum: 'מומנטום (ROC)',
  macd_swing: 'MACD + פילטר מגמה',
};

export const LLM_PROVIDERS = {
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', shape: 'openai', keyHint: 'sk-...' },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', shape: 'openai', keyHint: 'sk-or-...' },
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', shape: 'openai', keyHint: 'gsk_...' },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', shape: 'openai', keyHint: 'sk-...' },
  together: { label: 'Together', baseUrl: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', shape: 'openai', keyHint: '...' },
  mistral: { label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-large-latest', shape: 'openai', keyHint: '...' },
  anthropic: { label: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5', shape: 'anthropic', keyHint: 'sk-ant-...' },
  gemini: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash', shape: 'gemini', keyHint: 'AIza...' },
  ollama: { label: 'Ollama (מקומי)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', shape: 'openai', keyHint: 'ללא מפתח' },
  custom: { label: 'OpenAI-compatible מותאם', baseUrl: '', model: '', shape: 'openai', keyHint: '...' },
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
    label: 'News / RSS מותאם', url: '',
    limit: 30, windowMs: 3_600_000,
    note: 'נקודת קצה שלך (NewsAPI, Finnhub, RSS-to-JSON) שמחזירה כותרות ב-JSON.',
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
  { id: 'advisor', label: 'יועץ AI', icon: '✦' },
  { id: 'settings', label: 'הגדרות ומפתחות', icon: '⚙' },
  { id: 'docs', label: 'מדריך הקמה', icon: '❯' },
];

export const DISCLAIMER =
  'המערכת מריצה בקטסטים ומסחר על נייר בלבד. אין כאן ביצוע פקודות, חיבור לבורסה או הבטחת רווח. ' +
  'ביצועים היסטוריים אינם מנבאים תשואה עתידית, ומסחר ממונף עלול להפסיד את כל ההון.';
