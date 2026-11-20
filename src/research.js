// Research radar: free public APIs for strategy mining, market sentiment and context building.

import { RESEARCH_SOURCES } from './config.js';
import { store, uid } from './store.js';
import { getCandles } from './market.js';
import { rsi, sma } from './indicators.js';

const EXTRA_SOURCES = {};

const POSITIVE = [
  'surge', 'rally', 'bullish', 'gain', 'record', 'approval', 'inflow', 'buy', 'adoption', 'breakout',
  'upgrade', 'profit', 'soar', 'jump', 'optimistic', 'accumulate', 'strong', 'partnership', 'launch',
  'beat', 'raises guidance', 'rate cut', 'cooling inflation', 'outperform', 'buyback',
  'עלייה', 'זינוק', 'פריצה', 'חיובי', 'אופטימי', 'ביקוש', 'אישור', 'שיא', 'צמיחה',
];
const NEGATIVE = [
  'crash', 'plunge', 'bearish', 'sell-off', 'selloff', 'hack', 'outflow', 'ban', 'lawsuit', 'liquidation',
  'fear', 'downgrade', 'loss', 'drop', 'dump', 'recession', 'warning', 'fraud', 'bankrupt', 'exploit',
  'miss', 'cuts guidance', 'rate hike', 'tariff', 'hot inflation', 'layoff', 'probe',
  'ירידה', 'קריסה', 'חשש', 'שלילי', 'האק', 'חקירה', 'אזהרה', 'פלישה', 'הפסד', 'מכירה',
];

const ASSET_WORDS = {
  BTCUSDT: ['btc', 'bitcoin', 'ביטקוין', 'ביטקויין'],
  ETHUSDT: ['eth', 'ethereum', 'אתריום', 'אתרי'],
  SOLUSDT: ['sol', 'solana', 'סולנה'],
  NVDA: ['nvda', 'nvidia', 'blackwell', 'cuda', 'ai chip'],
  AAPL: ['aapl', 'apple', 'iphone', 'macbook'],
  SPY: ['spy', 's&p 500', 's&p500', 'wall street', 'stocks', 'fed', 'fomc', 'cpi'],
  TSLA: ['tsla', 'tesla'],
  MSFT: ['msft', 'microsoft', 'azure'],
};

function budget(key) {
  const spec = RESEARCH_SOURCES[key] || EXTRA_SOURCES[key];
  const state = store.state;
  let b = state.budget[key];
  if (!b) {
    b = state.budget[key] = { used: 0, total: spec?.limit || 10, resetAt: Date.now() + (spec?.windowMs || 3600000), calls: 0 };
  }
  if (Date.now() > b.resetAt) {
    b.used = 0;
    b.resetAt = Date.now() + (spec?.windowMs || 3600000);
  }
  b.total = spec?.limit || b.total || 10;
  return b;
}

export function budgetSnapshot() {
  return Object.keys({ ...RESEARCH_SOURCES, ...EXTRA_SOURCES }).map((key) => {
    const spec = RESEARCH_SOURCES[key] || EXTRA_SOURCES[key];
    const b = budget(key);
    return { key, label: spec.label, note: spec.note, used: b.used, total: b.total, resetAt: b.resetAt, calls: b.calls || 0 };
  });
}

function canUse(key) {
  return budget(key).used < budget(key).total;
}

function noteUse(key) {
  const b = budget(key);
  b.used++;
  b.calls = (b.calls || 0) + 1;
  store.state.stats.scans = (store.state.stats.scans || 0) + 1;
}

async function fetchJson(url, headers = {}, timeout = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 120)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

function guessStrategy(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('rsi') || t.includes('mean reversion') || t.includes('revers')) return 'rsi_reversion';
  if (t.includes('macd')) return 'macd_swing';
  if (t.includes('breakout') || t.includes('donchian') || t.includes('channel')) return 'breakout';
  if (t.includes('momentum') || t.includes('trend')) return 'ema_trend';
  if (t.includes('scalp') || t.includes('grid')) return 'momentum';
  return null;
}

function guessTimeframe(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('scalp') || t.includes('1m') || t.includes('5m') || t.includes('high frequency')) return '5m';
  if (t.includes('15m') || t.includes('intraday') || t.includes('day trad')) return '15m';
  if (t.includes('4h') || t.includes('1h')) return '1h';
  if (t.includes('swing') || t.includes('daily') || t.includes('1d')) return '1d';
  if (t.includes('invest') || t.includes('long term') || t.includes('weekly')) return '1w';
  return null;
}

function addIdea(idea) {
  const state = store.state;
  if (state.ideas.some((i) => i.url === idea.url)) return false;
  state.ideas.unshift({ id: uid('idea'), at: Date.now(), tested: false, ...idea });
  if (state.ideas.length > 80) state.ideas.length = 80;
  return true;
}

// --- GitHub ---------------------------------------------------------------

export async function scanGitHub(query = 'freqtrade strategy', { quiet = false } = {}) {
  if (!canUse('github')) throw new Error('מכסת GitHub נוצלה לחלון הזה');
  const token = store.state.settings.github.token;
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=10`;
  noteUse('github');
  const json = await fetchJson(url, token ? { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' } : {});
  let added = 0;
  for (const repo of json.items || []) {
    const haystack = `${repo.name} ${repo.description || ''} ${(repo.topics || []).join(' ')}`;
    const strategy = guessStrategy(haystack);
    const tf = guessTimeframe(haystack);
    const ok = addIdea({
      title: repo.full_name,
      url: repo.html_url,
      desc: (repo.description || 'ללא תיאור').slice(0, 200),
      source: 'GitHub',
      stars: repo.stargazers_count,
      lang: repo.language,
      strategy: strategy,
      timeframe: tf,
      suggestedStrategy: strategy || 'breakout',
      tags: (repo.topics || []).slice(0, 3),
    });
    if (ok) added++;
  }
  store.log('ok', 'עומר · מודיעין', `סריקת GitHub ("${query}") החזירה ${added} רעיונות חדשים`);
  store.save();
  if (!quiet) store.emit();
  return { added, remaining: json.items?.length || 0 };
}

// --- Fear & Greed ---------------------------------------------------------

export async function scanFearGreed({ quiet = false } = {}) {
  if (!canUse('feargreed')) throw new Error('מכסת Fear & Greed נוצלה');
  noteUse('feargreed');
  const json = await fetchJson('https://api.alternative.me/fng/?limit=14&format=json');
  const rows = (json.data || []).map((r) => ({
    value: Number(r.value),
    label: r.value_classification,
    at: Number(r.timestamp) * 1000,
  }));
  if (!rows.length) throw new Error('אין נתוני מדד');
  store.state.sentiment.fearGreed = {
    value: rows[0].value,
    label: rows[0].label,
    at: rows[0].at,
    history: rows.map((r) => r.value).reverse(),
  };
  store.state.sentiment.source = 'Alternative.me Fear & Greed';
  store.log('ok', 'עומר · מודיעין', `מדד פחד/חמדנות: ${rows[0].value} (${rows[0].label})`);
  store.save();
  if (!quiet) store.emit();
  return rows[0];
}

// --- CoinGecko trending ---------------------------------------------------

export async function scanTrending({ quiet = false } = {}) {
  if (!canUse('coingecko')) throw new Error('מכסת CoinGecko נוצלה');
  noteUse('coingecko');
  const json = await fetchJson('https://api.coingecko.com/api/v3/search/trending');
  const coins = (json.coins || []).map((c) => c.item).filter(Boolean);
  store.state.sentiment.trending = coins.slice(0, 10).map((c) => ({
    name: c.name, symbol: c.symbol, rank: c.market_cap_rank,
  }));
  store.log('ok', 'עומר · מודיעין', `מטבעות במגמת חיפוש: ${coins.slice(0, 3).map((c) => c.symbol).join(', ') || '—'}`);
  store.save();
  if (!quiet) store.emit();
  return coins.length;
}

// --- Unified Market/Research Proxy Helper (Browser + Node 24/7 Runner) ----

async function callMarketProxy(params = {}) {
  // In Node (runner/run.mjs or Base Server cron), call handleMarketRequest directly in-process
  if (typeof window === 'undefined') {
    const mod = await import('../netlify/functions/market.mjs');
    return await mod.handleMarketRequest(params);
  }
  const qs = new URLSearchParams(params).toString();
  const candidates = [`/api/market?${qs}`];
  const baseUrl = (store.state?.settings?.db?.baseServerUrl || '').trim().replace(/\/+$/, '');
  if (baseUrl) candidates.push(`${baseUrl}/api/market?${qs}`);
  let lastErr = null;
  for (const url of candidates) {
    try {
      const json = await fetchJson(url, {}, 12000);
      if (json && json.ok !== false) return json;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('פרוקסי השוק לא זמין');
}

function mergeHeadlines(incoming = [], maxKeep = 80) {
  const existing = store.state.sentiment.headlines || [];
  const seen = new Set();
  const out = [];
  for (const h of [...incoming, ...existing]) {
    const title = String(h?.title || '').trim();
    if (!title) continue;
    const key = title.toLowerCase().slice(0, 72);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...h,
      title,
      at: h.at || (h.pubDate ? Date.parse(h.pubDate) || Date.now() : Date.now()),
      score: h.score ?? scoreText(`${title} ${h.body || ''}`),
    });
    if (out.length >= maxKeep) break;
  }
  store.state.sentiment.headlines = out;
  return out;
}

// --- Reddit (via server proxy: direct RSS/JSON + indexed fallback, zero CORS) ---

export async function scanReddit({ quiet = false } = {}) {
  if (!canUse('reddit')) throw new Error('מכסת Reddit נוצלה');
  noteUse('reddit');
  const data = await callMarketProxy({ action: 'reddit', subs: 'algotrading,CryptoCurrency,stocks,investing' });
  const raw = Array.isArray(data?.items) ? data.items : [];
  const headlines = raw.map((it) => ({
    title: it.title,
    url: it.link || '',
    source: it.source || 'Reddit',
    channelKind: 'reddit',
    body: it.summary || '',
    at: it.pubDate ? Date.parse(it.pubDate) || Date.now() : Date.now(),
  })).filter((h) => h.title);

  if (!headlines.length) throw new Error('Reddit לא החזיר פוסטים כרגע');
  mergeHeadlines(headlines);

  // Also feed algotrading discussions into the team's Research Ideas
  let ideasAdded = 0;
  for (const h of headlines) {
    if (/algotrading|quant|strategy|backtest|gann|indicator/i.test(`${h.source} ${h.title}`)) {
      const strat = guessStrategy(h.title);
      if (addIdea({
        title: h.title.slice(0, 120),
        url: h.url || 'https://www.reddit.com/r/algotrading/',
        desc: (h.body || `פוסט קהילתי מ-${h.source}`).slice(0, 200),
        source: h.source || 'Reddit',
        strategy: strat,
        timeframe: guessTimeframe(h.title),
        suggestedStrategy: strat || 'ema_trend',
        tags: ['Reddit', h.source],
      })) ideasAdded++;
    }
  }

  store.log('ok', 'עומר · מודיעין', `Reddit (${data.source || 'Proxy'}): נאספו ${headlines.length} פוסטים${ideasAdded ? ` + ${ideasAdded} רעיונות אסטרטגיה` : ''}`);
  store.save();
  if (!quiet) store.emit();
  return headlines.length;
}

// --- Multi-Source Financial & Crypto News RSS (+ optional custom endpoint) ---

export async function scanNews({ quiet = false } = {}) {
  if (!canUse('news')) throw new Error('מכסת החדשות נוצלה');
  noteUse('news');
  const headlines = [];
  const sourcesUsed = [];

  // 1. Always pull from built-in zero-key multi-source RSS aggregator (Yahoo, CNBC, MarketWatch, Fed, CoinDesk, Cointelegraph, Decrypt, SeekingAlpha, Google News)
  try {
    const rssData = await callMarketProxy({ action: 'news', symbol: 'ALL' });
    const items = Array.isArray(rssData?.items) ? rssData.items : [];
    for (const a of items) {
      if (!a?.title) continue;
      headlines.push({
        title: a.title,
        url: a.link || a.url || '',
        source: a.source || 'News RSS',
        channelKind: 'news',
        body: a.summary || '',
        at: a.pubDate ? Date.parse(a.pubDate) || Date.now() : Date.now(),
      });
    }
    if (items.length) sourcesUsed.push(rssData.source || 'News RSS');
  } catch (err) {
    store.log('warn', 'עומר · חדשות RSS', `שגיאה בפיד RSS מובנה: ${err.message}`);
  }

  // 2. Also pull from user's custom News endpoint if configured in Settings
  const { endpoint, apiKey } = store.state.settings.news || {};
  if (endpoint) {
    try {
      const sep = endpoint.includes('?') ? '&' : '?';
      const url = apiKey ? `${endpoint}${sep}apiKey=${encodeURIComponent(apiKey)}` : endpoint;
      const json = await fetchJson(url);
      const raw = json.articles || json.items || json.data || json.news || [];
      for (const a of raw.slice(0, 15)) {
        const title = a.title || a.headline || '';
        if (!title) continue;
        headlines.push({
          title,
          url: a.url || a.link || '',
          source: a.source?.name || a.source || 'חדשות מותאם',
          channelKind: 'news',
          at: Date.now(),
          body: a.description || a.summary || '',
        });
      }
      if (raw.length) sourcesUsed.push('Custom Endpoint');
    } catch { /* keep built-in RSS headlines */ }
  }

  if (!headlines.length) throw new Error('לא התקבלו כותרות מפיד החדשות RSS');
  mergeHeadlines(headlines);
  store.log('ok', 'עומר · חדשות RSS', `נקראו ${headlines.length} כותרות חדשות בזמן אמת (${sourcesUsed.join(' + ')})`);
  store.save();
  if (!quiet) store.emit();
  return headlines.length;
}

// --- YouTube Finance, Macro, Quant & Crypto Official Channels --------------

export async function scanYouTube({ quiet = false } = {}) {
  if (!canUse('youtube')) throw new Error('מכסת YouTube נוצלה');
  noteUse('youtube');
  const data = await callMarketProxy({ action: 'youtube' });
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) throw new Error('לא התקבלו סרטונים מערוצי YouTube');

  const videos = items.map((v) => ({
    title: v.title,
    url: v.link || (v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : ''),
    videoId: v.videoId || null,
    thumbnail: v.thumbnail || null,
    channel: v.channel || v.author || 'YouTube',
    category: v.category || 'שוק ומחקר',
    summary: v.summary || '',
    pubDate: v.pubDate || '',
    at: v.pubDate ? Date.parse(v.pubDate) || Date.now() : Date.now(),
    score: scoreText(`${v.title} ${v.summary || ''}`),
  }));

  store.state.sentiment.youtubeVideos = videos.slice(0, 20);
  store.state.sentiment.youtubeUpdatedAt = Date.now();

  // Feed top videos into headlines for asset sentiment scoring as well
  mergeHeadlines(videos.slice(0, 12).map((v) => ({
    title: `📺 ${v.title}`,
    url: v.url,
    source: `YouTube · ${v.channel}`,
    channelKind: 'youtube',
    body: v.summary,
    at: v.at,
    score: v.score,
  })));

  store.log('ok', 'עומר · YouTube מחקר', `נאספו ${videos.length} סרטוני חדשות ומחקר מ-${(data.channels || []).length} ערוצי YouTube (${(data.channels || []).slice(0, 3).join(', ')})`);
  store.save();
  if (!quiet) store.emit();
  return videos.length;
}

// --- arXiv Quantitative Finance (q-fin) Research Papers --------------------

export async function scanArxivQuant({ quiet = false } = {}) {
  if (!canUse('arxiv')) throw new Error('מכסת arXiv נוצלה');
  noteUse('arxiv');
  const data = await callMarketProxy({ action: 'arxiv' });
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) throw new Error('לא התקבלו מאמרים מ-arXiv q-fin');

  const papers = items.map((p) => ({
    title: p.title,
    url: p.link || '',
    summary: p.summary || '',
    pubDate: p.pubDate || '',
    at: p.pubDate ? Date.parse(p.pubDate) || Date.now() : Date.now(),
    strategy: guessStrategy(`${p.title} ${p.summary || ''}`),
  }));

  store.state.sentiment.arxivPapers = papers.slice(0, 15);
  store.state.sentiment.arxivUpdatedAt = Date.now();

  let addedIdeas = 0;
  for (const p of papers.slice(0, 8)) {
    const ok = addIdea({
      title: `[arXiv] ${p.title.slice(0, 110)}`,
      url: p.url,
      desc: (p.summary || 'מאמר מחקר אקדמי ב-arXiv Quantitative Finance').slice(0, 200),
      source: 'arXiv q-fin',
      strategy: p.strategy,
      timeframe: guessTimeframe(`${p.title} ${p.summary}`),
      suggestedStrategy: p.strategy || 'ema_trend',
      tags: ['arXiv', 'Quant Paper'],
    });
    if (ok) addedIdeas++;
  }

  store.log('ok', 'נועה · מחקר arXiv', `נאספו ${papers.length} מאמרי קוונט מ-arXiv q-fin (${addedIdeas} נוספו לרעיונות)`);
  store.save();
  if (!quiet) store.emit();
  return papers.length;
}

// --- Hacker News (Quant, AI, Crypto & Macro Tech Discussions) --------------

export async function scanHackerNews({ quiet = false } = {}) {
  if (!canUse('hackernews')) throw new Error('מכסת Hacker News נוצלה');
  noteUse('hackernews');
  const data = await callMarketProxy({ action: 'hackernews' });
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) throw new Error('לא התקבלו כותרות מ-Hacker News');

  const headlines = items.map((it) => ({
    title: it.title,
    url: it.link || '',
    source: 'Hacker News',
    channelKind: 'hackernews',
    body: it.summary || '',
    at: it.pubDate ? Date.parse(it.pubDate) || Date.now() : Date.now(),
  }));
  mergeHeadlines(headlines);
  store.log('ok', 'עומר · Hacker News', `נאספו ${headlines.length} דיוני AI, מסחר וקריפטו מ-Hacker News`);
  store.save();
  if (!quiet) store.emit();
  return headlines.length;
}

// --- sentiment scoring ----------------------------------------------------

export function scoreText(text) {
  const lower = (text || '').toLowerCase();
  let pos = 0;
  let neg = 0;
  for (const w of POSITIVE) if (lower.includes(w)) pos++;
  for (const w of NEGATIVE) if (lower.includes(w)) neg++;
  const total = pos + neg;
  if (!total) return 0;
  return (pos - neg) / Math.max(1, Math.sqrt(total));
}

export async function refreshSentiment() {
  const scanners = [
    scanFearGreed,
    scanTrending,
    scanNews,
    scanReddit,
    scanYouTube,
    scanArxivQuant,
    scanHackerNews,
  ];
  const settled = await Promise.allSettled(scanners.map((fn) => fn({ quiet: true })));
  const results = settled.map((r) => r.status === 'fulfilled');

  const state = store.state;
  const headlines = state.sentiment.headlines || [];
  const scored = headlines.map((h) => ({ ...h, score: scoreText(`${h.title} ${h.body || ''}`) }));
  state.sentiment.headlines = scored;
  const newsScore = scored.length ? scored.reduce((s, h) => s + h.score, 0) / scored.length : 0;
  const fg = state.sentiment.fearGreed;
  const fgScore = fg ? (fg.value - 50) / 50 : 0;

  for (const desk of state.desks) {
    const words = ASSET_WORDS[desk.symbol] || [desk.symbol.slice(0, 3).toLowerCase()];
    const relevant = scored.filter((h) => words.some((w) => `${h.title} ${h.body || ''}`.toLowerCase().includes(w)));
    const assetNews = relevant.length ? relevant.reduce((s, h) => s + h.score, 0) / relevant.length : newsScore;
    let technical = 0;
    let price = null;
    try {
      const candles = await getCandles(desk.symbol, '1h', { limit: 300 });
      const closes = candles.map((c) => c.c);
      price = closes[closes.length - 1];
      const fast = sma(closes, 20).filter((v) => v != null).pop();
      const slow = sma(closes, 100).filter((v) => v != null).pop();
      const r = rsi(closes, 14).filter((v) => v != null).pop();
      technical = (price > fast ? 0.35 : -0.35) + (price > slow ? 0.35 : -0.35) + (r > 68 ? -0.2 : r < 32 ? 0.2 : 0);
    } catch { /* keep neutral */ }
    const score = +(0.4 * technical + 0.3 * assetNews + 0.2 * fgScore + 0.1 * Math.sign(assetNews)).toFixed(2);
    state.sentiment.assets[desk.symbol] = {
      score: Math.max(-1, Math.min(1, score)),
      bias: score > 0.15 ? 'שורי' : score < -0.15 ? 'דובי' : 'ניטרלי',
      technical: +technical.toFixed(2),
      news: +assetNews.toFixed(2),
      drivers: relevant.slice(0, 3).map((h) => h.title),
      price: price ? +price.toFixed(2) : null,
    };
  }
  state.sentiment.updatedAt = Date.now();
  state.sentiment.newsScore = +newsScore.toFixed(2);
  store.save();
  store.emit();
  return results;
}

export async function scanIfDue() {
  const b = budget('github');
  if (b.used >= b.total) return { skipped: true };
  const queries = [
    'freqtrade strategy profitable', 'trading strategy backtest walk forward', 'algorithmic trading bot optimization', 'crypto quant strategy sharpe',
    'hyperopt strategy optimization', 'portfolio optimization trading python', 'walk forward analysis trading github', 'bayesian optimization trading strategy',
    'trading bot risk management position sizing kelly', 'mean reversion momentum breakout strategy backtest',
    'wd gann trading strategy', 'gann square of 9 trading algorithm', 'gann fan angles crypto trading', 'gann time cycles calendar trading',
    'gann swing chart technique', 'gann price time geometry tradingview', 'gann seasonal time cycles', 'gann box square indicator github',
    'supertrend indicator strategy', 'vwap trading strategy', 'ichimoku cloud strategy', 'stochastic rsi strategy crypto',
    'order flow volume profile trading', 'machine learning trading signals feature engineering', 'open source quantitative trading framework'
  ];
  const q = queries[(store.state.stats.scans || 0) % queries.length];
  try {
    return await scanGitHub(q, { quiet: true });
  } catch (err) {
    store.log('warn', 'עומר · מודיעין', `סריקת GitHub דולגה: ${err.message}`);
    return { error: err.message };
  }
}

// --- persistent context (export / commit) ---------------------------------

export function buildContextDocument() {
  const s = store.state;
  return {
    generatedAt: new Date().toISOString(),
    firm: 'Alta Capital (agent-run research desk)',
    disclaimer: 'Backtest and paper-trading research only. Not investment advice.',
    settings: {
      capital: s.settings.capital,
      riskPerTrade: s.settings.riskPerTrade,
      maxDrawdown: s.settings.maxDrawdown,
      platform: s.settings.platform,
    },
    desks: s.desks.map((d) => ({
      id: d.id, label: d.label, timeframe: d.tf, symbol: d.symbol, status: d.status,
      version: d.version, strategyId: d.strategyId, params: d.params,
      metrics: d.metrics, oos: d.oosMetrics, bestReturn: d.bestReturn,
      versions: d.history.slice(0, 8).map((h) => ({ version: h.version, at: h.at, oos: h.oosReturn })),
    })),
    ideas: s.ideas.slice(0, 30).map((i) => ({ title: i.title, source: i.source, url: i.url, strategy: i.strategy, tested: i.tested })),
    sentiment: s.sentiment,
    lessons: s.knowledge.lessons,
  };
}

export async function saveContextToGitHub() {
  const { token, owner, repo, path } = store.state.settings.github;
  if (!token || !owner || !repo) throw new Error('צריך טוקן, owner ו־repo בהגדרות');
  const doc = buildContextDocument();
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
  let sha = null;
  try {
    const existing = await fetch(api, { headers });
    if (existing.ok) {
      const meta = await existing.json();
      sha = meta.sha;
    }
  } catch { /* new file */ }
  const body = {
    message: `chore(context): update firm context ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    content: btoa(unescape(encodeURIComponent(JSON.stringify(doc, null, 2)))),
    ...(sha ? { sha } : {}),
  };
  const res = await fetch(api, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${res.status}: ${text.slice(0, 140)}`);
  }
  const out = await res.json();
  store.log('ok', 'גיא · פיתוח', `הקונטקסט נשמר ל־${owner}/${repo}/${path}`);
  store.save();
  store.emit();
  return out.commit?.html_url || null;
}

// --- Nadav: Continuous GitHub & Web Research Scout (Gann, Indicators & System Optimization) ---

export const CURATED_GITHUB_INTEL = [
  {
    name: 'allanninal/gann-toolkit-pro-pine',
    url: 'https://github.com/allanninal/gann-toolkit-pro-pine',
    category: 'גאן (Gann)',
    benefit: 'יישום Pine Script v6 של Square of 9, מניפות זוויות, תיבות גאן וניתוח רב-נכסי — מקור לחידוד זיהוי נקודות מפנה.',
  },
  {
    name: 'Galarius/gann-square',
    url: 'https://github.com/Galarius/gann-square',
    category: 'גאן (Gann)',
    benefit: 'אלגוריתם Python לבניית תתי-ריבועים של גאן ויחסי מחיר-תאריך פרוגרמטיים.',
  },
  {
    name: 'monch1962/gann-swing',
    url: 'https://github.com/monch1962/gann-swing',
    category: 'גאן (Gann)',
    benefit: 'מבנה Gann Swings לזיהוי נקי יותר של שיאים ושפלים היסטוריים עבור עוגני Square of 9.',
  },
  {
    name: 'polakowo/vectorbt',
    url: 'https://github.com/polakowo/vectorbt',
    category: 'ייעול מערכת ובקטסט',
    benefit: 'השראה לבקטסט וקטורי מהיר של אלפי קומבינציות פרמטרים בו-זמנית להאצת מנוע האופטימיזציה.',
  },
  {
    name: 'twopirllc/pandas-ta',
    url: 'https://github.com/twopirllc/pandas-ta',
    category: 'אינדיקטורים ואסטרטגיות',
    benefit: 'מעל 130 אינדיקטורים טכניים מתקדמים (ADX, SuperTrend, Efficiency Ratio, Z-Score) להרחבת תפריט האסטרטגיות.',
  },
  {
    name: 'freqtrade/freqtrade-strategies',
    url: 'https://github.com/freqtrade/freqtrade-strategies',
    category: 'אסטרטגיות מסחר',
    benefit: 'מאגר קהילתי של אסטרטגיות מוכחות לחיזוק ביצועי הבוטים במבחני הנוסטרו.',
  },
];

export async function runNadavGitHubScout({ quiet = false } = {}) {
  const queries = ['"square of 9" OR "wd gann"', 'freqtrade strategy indicators', 'vectorbt backtesting'];
  let totalAdded = 0;
  for (const q of queries) {
    if (!canUse('github')) break;
    try {
      const r = await scanGitHub(q, { quiet: true });
      totalAdded += r.added || 0;
    } catch { /* respect quota/network */ }
  }
  const latestIdeas = (store.state.ideas || []).filter((i) => i.source === 'GitHub').slice(0, 12);
  store.state.githubScout = {
    updatedAt: Date.now(),
    curated: CURATED_GITHUB_INTEL,
    liveReposCount: latestIdeas.length,
    lastAdded: totalAdded,
  };
  store.log('ok', 'נדב · חוקר GitHub', `סריקת GitHub ואינטרנט הושלמה: ${CURATED_GITHUB_INTEL.length} ריפואי ליבה + ${totalAdded} ריפואים חדשים מהרשת לעדכון גאן ואינדיקטורים.`);
  store.save();
  if (!quiet) store.emit();
  return store.state.githubScout;
}
