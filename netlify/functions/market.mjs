// Netlify Serverless Function: /api/market (/.netlify/functions/market)
// Free, zero-key market data proxy for Stocks, ETFs, Commodities & Forex via Yahoo Finance.
// Supports:
//   GET /api/market?symbol=NVDA&tf=1d&limit=500  -> OHLCV candles + live quote
//   GET /api/market?action=quotes&symbols=NVDA,AAPL,SPY -> live quotes batch

// Yahoo hard limits: 5m/15m ~60d, 60m ~730d, 1d/1wk can span a decade or more.
// Deep history is what lets the backtests look years back instead of months.
const TF_MAP = {
  '5m':  { interval: '5m',  range: '3mo' },
  '15m': { interval: '15m', range: '3mo' },
  '1h':  { interval: '60m', range: '1y' },
  '1d':  { interval: '1d',  range: '10y' },
  '1w':  { interval: '1wk', range: '10y' },
};

const MAX_CANDLES = 6000;

const SEC_CIKS = {
  NVDA: '0001045810',
  AAPL: '0000320193',
  TSLA: '0001318605',
  MSFT: '0000789019',
  AMZN: '0001018724',
  GOOGL: '0001652044',
};

const COINGECKO_IDS = {
  BTCUSDT: 'bitcoin',
  ETHUSDT: 'ethereum',
  SOLUSDT: 'solana',
};

function latestSecFact(facts, tags) {
  const usGaap = facts?.['us-gaap'] || {};
  for (const tag of tags) {
    const units = usGaap[tag]?.units;
    if (!units) continue;
    const arr = units.USD || units['USD/shares'] || Object.values(units)[0];
    if (!Array.isArray(arr) || !arr.length) continue;
    const annual = arr.filter((x) => x.form === '10-K' || x.form === '10-Q').sort((a, b) => (b.end || '').localeCompare(a.end || ''));
    const best = annual[0] || arr[arr.length - 1];
    if (best && best.val != null) return { val: Number(best.val), end: best.end, form: best.form };
  }
  return null;
}

async function fetchStockFundamentals(symbol) {
  const cik = SEC_CIKS[symbol];
  const [chartRes, secRes] = await Promise.all([
    fetchYahooChart(symbol, '1d', 10).catch(() => null),
    cik
      ? fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
          headers: { 'User-Agent': 'AltaCapital research@altacapital.local', Accept: 'application/json' },
        }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      : Promise.resolve(null),
  ]);

  const facts = secRes?.facts || {};
  const rev = latestSecFact(facts, ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet']);
  const netInc = latestSecFact(facts, ['NetIncomeLoss']);
  const eps = latestSecFact(facts, ['EarningsPerShareDiluted', 'EarningsPerShareBasic']);
  const cash = latestSecFact(facts, ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents']);
  const assets = latestSecFact(facts, ['Assets']);
  const debt = latestSecFact(facts, ['LongTermDebtNoncurrent', 'LongTermDebt']);
  const shares = secRes?.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares?.slice(-1)[0]?.val || null;

  const price = chartRes?.price || null;
  const pe = price && eps?.val > 0 ? +(price / eps.val).toFixed(2) : null;
  const netMarginPct = rev?.val > 0 && netInc?.val != null ? +((netInc.val / rev.val) * 100).toFixed(2) : null;
  const debtToAssets = assets?.val > 0 && debt?.val != null ? +((debt.val / assets.val) * 100).toFixed(1) : null;
  const marketCap = price && shares ? Math.round(price * Number(shares)) : null;

  return {
    ok: true,
    kind: 'stock',
    source: cik ? 'SEC EDGAR + Yahoo Finance' : 'Yahoo Finance',
    symbol,
    entityName: secRes?.entityName || symbol,
    price,
    changePct: chartRes?.changePct || 0,
    marketCap,
    revenue: rev?.val ?? null,
    netIncome: netInc?.val ?? null,
    eps: eps?.val ?? null,
    pe,
    netMarginPct,
    cash: cash?.val ?? null,
    debtToAssetsPct: debtToAssets,
    filingPeriod: rev?.end || netInc?.end || null,
  };
}

async function fetchCryptoFundamentals(symbol) {
  const cgId = COINGECKO_IDS[symbol];
  if (!cgId) return { ok: false, error: 'Unsupported crypto symbol' };
  const url = `https://api.coingecko.com/api/v3/coins/${cgId}?localization=false&tickers=false&community_data=true&developer_data=false&sparkline=false`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const d = await res.json();
  const md = d.market_data || {};
  return {
    ok: true,
    kind: 'crypto',
    source: 'CoinGecko Public API',
    symbol,
    entityName: d.name || symbol,
    price: md.current_price?.usd ?? null,
    changePct: md.price_change_percentage_24h ?? 0,
    change30dPct: md.price_change_percentage_30d ?? null,
    marketCap: md.market_cap?.usd ?? null,
    volume24h: md.total_volume?.usd ?? null,
    circulatingSupply: md.circulating_supply ?? null,
    maxSupply: md.max_supply ?? null,
    athDrawdownPct: md.ath_change_percentage?.usd ?? null,
    sentimentUpPct: d.sentiment_votes_up_percentage ?? null,
  };
}

async function fetchFrankfurterForex() {
  try {
    const res = await fetch('https://api.frankfurter.dev/v1/latest?from=USD&to=EUR,GBP,JPY,ILS');
    if (!res.ok) return null;
    const d = await res.json();
    const r = d?.rates || {};
    return {
      eurusd: r.EUR ? +(1 / r.EUR).toFixed(4) : null,
      gbpusd: r.GBP ? +(1 / r.GBP).toFixed(4) : null,
      usdjpy: r.JPY ? +Number(r.JPY).toFixed(2) : null,
      usdils: r.ILS ? +Number(r.ILS).toFixed(4) : null,
      date: d?.date || null,
    };
  } catch {
    return null;
  }
}

async function fetchMacroSnapshot() {
  const [vix, tnx, dxy, forex] = await Promise.all([
    fetchYahooChart('^VIX', '1d', 5).catch(() => null),
    fetchYahooChart('^TNX', '1d', 5).catch(() => null),
    fetchYahooChart('DX-Y.NYB', '1d', 5).catch(() => null),
    fetchFrankfurterForex().catch(() => null),
  ]);
  return {
    ok: true,
    source: 'Yahoo Finance + Frankfurter ECB',
    vix: vix?.price ?? null,
    vixChangePct: vix?.changePct ?? 0,
    us10yYield: tnx?.price ?? null,
    dxy: dxy?.price ?? null,
    dxyChangePct: dxy?.changePct ?? 0,
    forex,
    at: Date.now(),
  };
}

async function fetchYahooChart(symbol, tf = '1d', limit = 500) {
  const spec = TF_MAP[tf] || TF_MAP['1d'];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${spec.interval}&range=${spec.range}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; AltaCapital/2.0)',
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`Yahoo Finance HTTP ${res.status} for ${symbol}`);
  }
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) {
    throw new Error(json?.chart?.error?.description || `No Yahoo Finance data for ${symbol}`);
  }
  const meta = result.meta || {};
  const ts = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const closes = quote.close || [];
  const vols = quote.volume || [];

  const candles = [];
  for (let i = 0; i < ts.length; i++) {
    const o = opens[i], h = highs[i], l = lows[i], c = closes[i];
    if (o == null || h == null || l == null || c == null) continue;
    candles.push({
      t: ts[i] * 1000,
      o: +Number(o).toFixed(4),
      h: +Number(h).toFixed(4),
      l: +Number(l).toFixed(4),
      c: +Number(c).toFixed(4),
      v: Number(vols[i] || 0),
    });
  }

  return {
    ok: true,
    provider: 'Yahoo Finance',
    symbol: meta.symbol || symbol,
    tf,
    price: meta.regularMarketPrice ?? candles[candles.length - 1]?.c ?? null,
    changePct: meta.regularMarketChangePercent ?? 0,
    currency: meta.currency || 'USD',
    candles: candles.slice(-Math.max(60, Math.min(MAX_CANDLES, Number(limit) || 500))),
  };
}

async function fetchStooqDaily(symbol, limit = 500) {
  const clean = symbol.replace('=X', '').replace('=F', '');
  const stooqSym = symbol.includes('=X') ? clean.toLowerCase() : `${clean.toLowerCase()}.us`;
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSym)}&i=d`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`);
  const csv = await res.text();
  const lines = csv.trim().split('\n').slice(1);
  const candles = [];
  for (const line of lines) {
    const [dt, o, h, l, c, v] = line.split(',');
    const ts = Date.parse(`${dt}T00:00:00Z`);
    if (!Number.isFinite(ts) || !Number.isFinite(Number(c))) continue;
    candles.push({ t: ts, o: +o, h: +h, l: +l, c: +c, v: +(v || 0) });
  }
  if (candles.length < 30) throw new Error('Stooq: insufficient candles');
  const sliced = candles.slice(-Math.max(60, Math.min(MAX_CANDLES, Number(limit) || 500)));
  return {
    ok: true,
    provider: 'Stooq (Zero-Key)',
    symbol,
    tf: '1d',
    price: sliced[sliced.length - 1]?.c ?? null,
    changePct: 0,
    currency: 'USD',
    candles: sliced,
  };
}

function decodeXmlEntities(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFeedItems(xml, sourceName, max = 6) {
  const items = [];
  if (!xml) return items;

  // 1. RSS 2.0 <item> blocks
  const itemRe = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null && items.length < max) {
    const block = m[1];
    const title = decodeXmlEntities(block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
    const link = decodeXmlEntities(block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] || '');
    const pubDate = decodeXmlEntities(block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] || block.match(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i)?.[1] || '');
    const summary = decodeXmlEntities(block.match(/<description[^>]*>([\s\S]*?)<\/description>/i)?.[1] || '').slice(0, 260);
    if (title) items.push({ title, link, pubDate, summary, source: sourceName });
  }
  if (items.length) return items;

  // 2. Atom <entry> blocks (YouTube, Reddit .rss, arXiv)
  const entryRe = /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi;
  while ((m = entryRe.exec(xml)) !== null && items.length < max) {
    const block = m[1];
    const title = decodeXmlEntities(block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
    const linkAttr = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i)?.[1] || '';
    const linkTag = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] || '';
    const link = decodeXmlEntities(linkAttr || linkTag);
    const pubDate = decodeXmlEntities(
      block.match(/<published[^>]*>([\s\S]*?)<\/published>/i)?.[1]
      || block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i)?.[1]
      || '',
    );
    const summary = decodeXmlEntities(
      block.match(/<media:description[^>]*>([\s\S]*?)<\/media:description>/i)?.[1]
      || block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1]
      || block.match(/<content[^>]*>([\s\S]*?)<\/content>/i)?.[1]
      || '',
    ).slice(0, 260);
    const videoId = (block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/i)?.[1] || '').trim() || null;
    const thumbnail = (block.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i)?.[1] || '').trim()
      || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null);
    const author = decodeXmlEntities(block.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/i)?.[1] || '') || sourceName;
    if (title) {
      items.push({ title, link, pubDate, summary, author, videoId, thumbnail, source: sourceName });
    }
  }
  return items;
}

async function fetchTextTimeout(url, headers = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AltaCapitalResearch/2.1)', ...headers },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAssetNews(symbol) {
  const isAll = !symbol || symbol.toUpperCase() === 'ALL';
  const cleanSym = isAll ? 'NVDA,AAPL,SPY,BTC-USD,ETH-USD' : symbol.replace(/USDT$/i, '-USD');
  const feeds = [
    { name: 'Yahoo Finance', url: `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(cleanSym)}&region=US&lang=en-US`, max: 4 },
    { name: 'CNBC Finance', url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html', max: 4 },
    { name: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', max: 4 },
    { name: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml', max: 3 },
    { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', max: 4 },
    { name: 'Cointelegraph', url: 'https://cointelegraph.com/rss', max: 4 },
    { name: 'Decrypt', url: 'https://decrypt.co/feed', max: 3 },
    { name: 'SeekingAlpha', url: 'https://seekingalpha.com/market_currents.xml', max: 3 },
    {
      name: 'Google News',
      url: `https://news.google.com/rss/search?q=${encodeURIComponent((isAll ? 'stock market bitcoin federal reserve' : symbol.replace('USDT', '') + ' market finance'))}&hl=en-US&gl=US&ceid=US:en`,
      max: 4,
    },
  ];
  const all = [];
  const activeSources = [];
  await Promise.all(feeds.map(async (f) => {
    try {
      const xml = await fetchTextTimeout(f.url, { Accept: 'application/rss+xml, application/xml, text/xml' }, 7500);
      const parsed = parseFeedItems(xml, f.name, f.max || 3);
      if (parsed.length) {
        activeSources.push(f.name);
        all.push(...parsed);
      }
    } catch { /* skip single feed */ }
  }));
  const seen = new Set();
  const dedup = all.filter((it) => {
    const k = (it.title || '').toLowerCase().slice(0, 70);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return {
    ok: dedup.length > 0,
    symbol: isAll ? 'ALL' : symbol,
    source: activeSources.join(' + ') || 'News RSS',
    sourcesCount: activeSources.length,
    items: dedup.slice(0, isAll ? 28 : 16),
  };
}

async function fetchRedditFeed(subsParam) {
  const subs = String(subsParam || 'algotrading,CryptoCurrency,stocks,investing')
    .split(',')
    .map((s) => s.replace(/^r\//i, '').trim())
    .filter((s) => /^[A-Za-z0-9_]{2,30}$/.test(s))
    .slice(0, 6);

  const items = [];
  const usedMethod = new Set();
  const ua = 'node:alta-capital-research:v2.1 (by /u/altacapital_quant)';

  // 1. Try direct Reddit RSS & JSON first (works natively on home/residential IPs like Base Server)
  await Promise.all(subs.map(async (sub) => {
    try {
      const xml = await fetchTextTimeout(`https://www.reddit.com/r/${sub}/.rss?limit=8`, { 'User-Agent': ua }, 6500);
      const parsed = parseFeedItems(xml, `r/${sub}`, 6);
      if (parsed.length) {
        usedMethod.add('Reddit RSS');
        items.push(...parsed);
        return;
      }
    } catch { /* try JSON fallback */ }
    try {
      const raw = await fetchTextTimeout(`https://www.reddit.com/r/${sub}/hot.json?limit=8`, { 'User-Agent': ua, Accept: 'application/json' }, 6500);
      const json = JSON.parse(raw);
      for (const child of json?.data?.children || []) {
        const d = child?.data;
        if (!d?.title || d.stickied) continue;
        usedMethod.add('Reddit JSON');
        items.push({
          title: d.title,
          link: `https://www.reddit.com${d.permalink}`,
          pubDate: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : '',
          summary: String(d.selftext || '').slice(0, 240),
          source: `r/${sub}`,
          score: d.score || 0,
          comments: d.num_comments || 0,
        });
      }
    } catch { /* will fall back to Google News Reddit index below */ }
  }));

  // 2. Fallback for datacenter/cloud IPs where Reddit returns 403/429: indexed Reddit posts via Google News RSS
  if (items.length < 4) {
    try {
      const q = subs.map((s) => `site:reddit.com/r/${s}`).join(' OR ');
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
      const xml = await fetchTextTimeout(url, { Accept: 'application/rss+xml, text/xml' }, 7500);
      const parsed = parseFeedItems(xml, 'Reddit', 16).map((it) => {
        const subMatch = `${it.title} ${it.link}`.match(/r\/([A-Za-z0-9_]+)/i);
        return {
          ...it,
          source: subMatch ? `r/${subMatch[1]}` : 'Reddit (Indexed)',
        };
      });
      if (parsed.length) {
        usedMethod.add('Reddit Index RSS');
        items.push(...parsed);
      }
    } catch { /* ignore */ }
  }

  const seen = new Set();
  const dedup = items.filter((it) => {
    const k = (it.title || '').toLowerCase().slice(0, 70);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    ok: dedup.length > 0,
    source: [...usedMethod].join(' + ') || 'Reddit',
    subreddits: subs,
    items: dedup.slice(0, 24),
  };
}

const YOUTUBE_FINANCE_CHANNELS = [
  { id: 'UCrp_UI8XtuYfpiqluWLD7Lw', name: 'CNBC Television', category: 'חדשות שוק ומניות' },
  { id: 'UCIALMKvObZNtJ6AmdCLP7Lg', name: 'Bloomberg Television', category: 'מאקרו ושווקים גלובליים' },
  { id: 'UCEAZeUIeJs0IjQiqTCdVSIg', name: 'Yahoo Finance', category: 'דוחות, פד ומניות' },
  { id: 'UCqK_GSMbpiV8spgD3ZGloSw', name: 'Coin Bureau', category: 'מחקר קריפטו פונדמנטלי' },
  { id: 'UCRvqjQPSeaWn-uEx-w0XOIg', name: 'Benjamin Cowen', category: 'מחזורי שוק וקוונט קריפטו' },
  { id: 'UCASM0cgfkJxQ1ICmRilfHLw', name: 'Patrick Boyle', category: 'קוונט, קרנות גידור ומאקרו' },
];

async function fetchYouTubeResearch() {
  const all = [];
  const activeChannels = [];
  await Promise.all(YOUTUBE_FINANCE_CHANNELS.map(async (ch) => {
    try {
      const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`;
      const xml = await fetchTextTimeout(url, { Accept: 'application/atom+xml, text/xml' }, 7500);
      const parsed = parseFeedItems(xml, `YouTube · ${ch.name}`, 4).map((v) => ({
        ...v,
        channel: ch.name,
        channelId: ch.id,
        category: ch.category,
      }));
      if (parsed.length) {
        activeChannels.push(ch.name);
        all.push(...parsed);
      }
    } catch { /* skip single channel */ }
  }));
  all.sort((a, b) => (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0));
  return {
    ok: all.length > 0,
    source: `YouTube Official Feeds (${activeChannels.length} ערוצים)`,
    channels: activeChannels,
    items: all.slice(0, 20),
  };
}

const YOUTUBE_STRATEGY_CHANNELS = [
  { id: 'UC9rktCIORe44eBzRFR68_gQ', name: 'Silvia & Doug', track: 'creator', tag: 'Doug & Silvia Rumer' },
  { id: 'UCUr9f3IUTTQKssZaAg4pgeA', name: 'Silvia Rumer', track: 'creator', tag: 'Doug & Silvia Rumer' },
  { id: 'UCfc6BgQNeIofBan0aewiYQQ', name: 'Wd Gann Trader', track: 'gann', tag: 'W.D. Gann Sq9 & Angles' },
  { id: 'UCllze4XDBfSqsimOf2Vcqrw', name: 'BACKTEST THE HYPE', track: 'creator', tag: 'Backtest Verification' },
];

const DEFAULT_YT_SCOUT_QUERIES = [
  { q: 'W.D. Gann Square of 9 trading strategy', track: 'gann', tag: 'Gann Square of 9' },
  { q: 'Michael Jenkins Gann square of 9 time cycles', track: 'gann', tag: 'Michael Jenkins Gann' },
  { q: 'Gann Fan 1x1 angle swing chart trading', track: 'gann', tag: 'Gann Fan 1x1 & Swing' },
  { q: 'Doug and Silvia Rumer trading strategy', track: 'creator', tag: 'Doug & Silvia Rumer' },
  { q: 'TradingLab tested 100 times trading strategy', track: 'creator', tag: 'TradingLab 100x' },
  { q: 'quant algorithmic trading strategy backtest profitable', track: 'creator', tag: 'Quant Backtests' },
];

function extractYouTubeSearchVideos(html, { track = 'creator', tag = '' } = {}, max = 6) {
  const marker = 'var ytInitialData = ';
  const idx = html.indexOf(marker);
  if (idx < 0) return [];
  const sub = html.slice(idx + marker.length);
  const end = sub.indexOf(';</script>');
  if (end < 0) return [];
  let data;
  try {
    data = JSON.parse(sub.slice(0, end));
  } catch {
    return [];
  }
  const videos = [];
  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object' || videos.length >= max) return;
    if (node.videoRenderer?.videoId) {
      const v = node.videoRenderer;
      const vid = v.videoId;
      if (!seen.has(vid)) {
        seen.add(vid);
        const title = (v.title?.runs || []).map((r) => r.text).join('').trim();
        const channel = v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || '';
        const channelId = v.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || '';
        const snippet = (v.detailedMetadataSnippets?.[0]?.snippetText?.runs || []).map((r) => r.text).join('').trim();
        if (title) {
          videos.push({
            videoId: vid,
            title,
            channel,
            channelId,
            url: `https://www.youtube.com/watch?v=${vid}`,
            views: v.viewCountText?.simpleText || v.shortViewCountText?.simpleText || '',
            published: v.publishedTimeText?.simpleText || '',
            duration: v.lengthText?.simpleText || '',
            snippet: snippet.slice(0, 260),
            track,
            queryTag: tag,
            source: 'YouTube Search',
          });
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
    } else {
      for (const val of Object.values(node)) walk(val);
    }
  };
  walk(data);
  return videos;
}

async function fetchYouTubeStrategyScout(customQueryStr = '') {
  const customList = String(customQueryStr || '')
    .split(/[|,\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
    .slice(0, 6)
    .map((q) => ({
      q,
      track: /gann|גאן|sq9|jenkins|cycle|square of 9/i.test(q) ? 'gann' : 'creator',
      tag: q.slice(0, 32),
    }));

  const searchSpecs = [...DEFAULT_YT_SCOUT_QUERIES, ...customList];
  const all = [];
  const activeSources = new Set();

  // 1. Official Atom feeds of tracked strategy & Gann creators (Silvia & Doug, Wd Gann Trader, BACKTEST THE HYPE)
  await Promise.all(YOUTUBE_STRATEGY_CHANNELS.map(async (ch) => {
    try {
      const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`;
      const xml = await fetchTextTimeout(url, { Accept: 'application/atom+xml, text/xml' }, 7000);
      const parsed = parseFeedItems(xml, `YouTube · ${ch.name}`, 5).map((v) => {
        const vidMatch = String(v.link || '').match(/[?&]v=([A-Za-z0-9_-]{8,16})/);
        return {
          videoId: vidMatch?.[1] || '',
          title: v.title,
          channel: ch.name,
          channelId: ch.id,
          url: v.link,
          views: '',
          published: v.pubDate || '',
          duration: '',
          snippet: v.summary || '',
          track: ch.track,
          queryTag: ch.tag,
          source: `YouTube Channel · ${ch.name}`,
        };
      });
      if (parsed.length) {
        activeSources.add(ch.name);
        all.push(...parsed);
      }
    } catch { /* skip channel on timeout */ }
  }));

  // 2. Live YouTube Search across Gann mastery + strategy creator queries
  await Promise.all(searchSpecs.map(async (spec) => {
    try {
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(spec.q)}`;
      const html = await fetchTextTimeout(url, {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      }, 8500);
      const vids = extractYouTubeSearchVideos(html, spec, 5);
      if (vids.length) {
        activeSources.add(spec.tag);
        all.push(...vids);
      }
    } catch { /* skip single query error */ }
  }));

  // Deduplicate by videoId or title
  const seen = new Set();
  const dedup = [];
  for (const v of all) {
    const k = v.videoId || v.title.toLowerCase().slice(0, 65);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    dedup.push(v);
  }

  return {
    ok: dedup.length > 0,
    source: `YouTube Gann & Strategy Scout (${activeSources.size} מקורות)`,
    activeSources: [...activeSources],
    total: dedup.length,
    videos: dedup.slice(0, 42),
    fetchedAt: Date.now(),
  };
}

async function fetchArxivQuantPapers() {
  const xml = await fetchTextTimeout('https://rss.arxiv.org/rss/q-fin', { Accept: 'application/rss+xml, text/xml' }, 8000);
  const items = parseFeedItems(xml, 'arXiv q-fin', 15);
  return {
    ok: items.length > 0,
    source: 'arXiv Quantitative Finance (q-fin RSS)',
    items,
  };
}

async function fetchHackerNewsFinance() {
  const queries = ['trading', 'bitcoin', 'nvidia'];
  const all = [];
  await Promise.all(queries.map(async (q) => {
    try {
      const raw = await fetchTextTimeout(`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=6`, { Accept: 'application/json' }, 7000);
      const json = JSON.parse(raw);
      for (const hit of json?.hits || []) {
        if (!hit?.title) continue;
        all.push({
          title: hit.title,
          link: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
          pubDate: hit.created_at || '',
          summary: `HN Points: ${hit.points || 0} · Comments: ${hit.num_comments || 0}`,
          points: hit.points || 0,
          comments: hit.num_comments || 0,
          source: 'Hacker News',
        });
      }
    } catch { /* skip query */ }
  }));
  const seen = new Set();
  const dedup = all.filter((it) => {
    const k = it.title.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0));
  return {
    ok: dedup.length > 0,
    source: 'Hacker News (Algolia API)',
    items: dedup.slice(0, 15),
  };
}

export async function handleMarketRequest(query = {}) {
  if (query.action === 'macro') {
    return await fetchMacroSnapshot();
  }

  if (query.action === 'news') {
    const sym = String(query.symbol || 'ALL').trim();
    return await fetchAssetNews(sym);
  }

  if (query.action === 'reddit') {
    return await fetchRedditFeed(query.subs || '');
  }

  if (query.action === 'youtube') {
    return await fetchYouTubeResearch();
  }

  if (query.action === 'youtube_scout') {
    return await fetchYouTubeStrategyScout(query.queries || '');
  }

  if (query.action === 'arxiv') {
    return await fetchArxivQuantPapers();
  }

  if (query.action === 'hackernews') {
    return await fetchHackerNewsFinance();
  }

  if (query.action === 'fundamentals') {
    const sym = String(query.symbol || 'NVDA').trim();
    if (COINGECKO_IDS[sym]) {
      return await fetchCryptoFundamentals(sym);
    }
    return await fetchStockFundamentals(sym);
  }

  if (query.action === 'quotes') {
    const list = String(query.symbols || 'NVDA,AAPL,TSLA,SPY,QQQ,MSFT,GC=F')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 15);
    const quotes = {};
    await Promise.all(list.map(async (sym) => {
      try {
        const d = await fetchYahooChart(sym, '1d', 5);
        if (d.price != null) {
          quotes[sym] = { price: d.price, changePct: d.changePct || 0, at: Date.now(), provider: 'Yahoo Finance' };
        }
      } catch { /* skip single symbol error */ }
    }));
    return { ok: true, provider: 'Yahoo Finance', quotes };
  }

  const symbol = String(query.symbol || 'NVDA').trim();
  const tf = String(query.tf || '1d').trim();
  const limit = Number(query.limit || 500);
  try {
    return await fetchYahooChart(symbol, tf, limit);
  } catch (err) {
    if (tf === '1d' || tf === '1w') {
      return await fetchStooqDaily(symbol, limit);
    }
    throw err;
  }
}

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  try {
    const out = await handleMarketRequest(event.queryStringParameters || {});
    return { statusCode: 200, headers, body: JSON.stringify(out) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
