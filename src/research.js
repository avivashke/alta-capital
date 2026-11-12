// Research radar: free public APIs for strategy mining, market sentiment and context building.

import { RESEARCH_SOURCES } from './config.js';
import { store, uid } from './store.js';
import { getCandles } from './market.js';
import { rsi, sma } from './indicators.js';

const EXTRA_SOURCES = {
  reddit: { label: 'Reddit (JSON ציבורי)', limit: 10, windowMs: 3_600_000, note: 'פוסטים חמים מ־r/CryptoCurrency ו־r/algotrading. Reddit חוסם בקשות דפדפן (CORS) ולכן הסריקה ידנית ועלולה להיכשל.' },
};

const POSITIVE = [
  'surge', 'rally', 'bullish', 'gain', 'record', 'approval', 'inflow', 'buy', 'adoption', 'breakout',
  'upgrade', 'profit', 'soar', 'jump', 'optimistic', 'accumulate', 'strong', 'partnership', 'launch',
  'עלייה', 'זינוק', 'פריצה', 'חיובי', 'אופטימי', 'ביקוש', 'אישור', 'שיא', 'צמיחה',
];
const NEGATIVE = [
  'crash', 'plunge', 'bearish', 'sell-off', 'selloff', 'hack', 'outflow', 'ban', 'lawsuit', 'liquidation',
  'fear', 'downgrade', 'loss', 'drop', 'dump', 'recession', 'warning', 'fraud', 'bankrupt', 'exploit',
  'ירידה', 'קריסה', 'חשש', 'שלילי', 'האק', 'חקירה', 'אזהרה', 'פלישה', 'הפסד', 'מכירה',
];

const ASSET_WORDS = {
  BTCUSDT: ['btc', 'bitcoin', 'ביטקוין', 'ביטקויין'],
  ETHUSDT: ['eth', 'ethereum', 'אתריום', 'אתרי'],
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

// --- Reddit ---------------------------------------------------------------

export async function scanReddit({ quiet = false } = {}) {
  if (!canUse('reddit')) throw new Error('מכסת Reddit נוצלה');
  noteUse('reddit');
  const subs = ['CryptoCurrency', 'algotrading'];
  const headlines = [];
  for (const sub of subs) {
    try {
      const json = await fetchJson(`https://www.reddit.com/r/${sub}/hot.json?limit=12`);
      for (const child of json.data?.children || []) {
        const d = child.data;
        if (d?.title) headlines.push({ title: d.title, url: `https://reddit.com${d.permalink}`, source: `r/${sub}`, at: Date.now() });
      }
    } catch (err) {
      store.log('warn', 'עומר · מודיעין', `Reddit r/${sub}: ${err.message}`);
    }
  }
  if (!headlines.length) throw new Error('Reddit לא החזיר כותרות (חסימת CORS/קצב)');
  store.state.sentiment.headlines = [...headlines, ...(store.state.sentiment.headlines || [])].slice(0, 40);
  store.log('ok', 'עומר · מודיעין', `נאספו ${headlines.length} כותרות מרשתות חברתיות`);
  store.save();
  if (!quiet) store.emit();
  return headlines.length;
}

// --- custom news endpoint -------------------------------------------------

export async function scanNews({ quiet = false } = {}) {
  const { endpoint, apiKey } = store.state.settings.news;
  if (!endpoint) throw new Error('לא הוגדרה נקודת קצה לחדשות בהגדרות');
  if (!canUse('news')) throw new Error('מכסת החדשות נוצלה');
  noteUse('news');
  const sep = endpoint.includes('?') ? '&' : '?';
  const url = apiKey ? `${endpoint}${sep}apiKey=${encodeURIComponent(apiKey)}` : endpoint;
  const json = await fetchJson(url);
  const raw = json.articles || json.items || json.data || json.news || [];
  const headlines = raw.slice(0, 20).map((a) => ({
    title: a.title || a.headline || String(a),
    url: a.url || a.link || '',
    source: a.source?.name || a.source || 'חדשות',
    at: Date.now(),
    body: a.description || a.summary || '',
  })).filter((h) => h.title);
  if (!headlines.length) throw new Error('הפורמט לא זוהה (צריך articles/items/data עם title)');
  store.state.sentiment.headlines = [...headlines, ...(store.state.sentiment.headlines || [])].slice(0, 40);
  store.log('ok', 'עומר · מודיעין', `נקראו ${headlines.length} כותרות חדשות`);
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
  const results = [];
  for (const fn of [scanFearGreed, scanTrending, scanNews]) {
    try {
      await fn({ quiet: true });
      results.push(true);
    } catch (err) {
      results.push(false);
    }
  }
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
  const queries = ['freqtrade strategy', 'trading strategy backtest', 'algorithmic trading bot', 'crypto quant strategy'];
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
