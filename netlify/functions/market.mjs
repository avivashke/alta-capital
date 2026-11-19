// Netlify Serverless Function: /api/market (/.netlify/functions/market)
// Free, zero-key market data proxy for Stocks, ETFs, Commodities & Forex via Yahoo Finance.
// Supports:
//   GET /api/market?symbol=NVDA&tf=1d&limit=500  -> OHLCV candles + live quote
//   GET /api/market?action=quotes&symbols=NVDA,AAPL,SPY -> live quotes batch

const TF_MAP = {
  '5m':  { interval: '5m',  range: '5d' },
  '15m': { interval: '15m', range: '1mo' },
  '1h':  { interval: '60m', range: '3mo' },
  '1d':  { interval: '1d',  range: '2y' },
  '1w':  { interval: '1wk', range: '5y' },
};

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

async function fetchMacroSnapshot() {
  const [vix, tnx, dxy] = await Promise.all([
    fetchYahooChart('^VIX', '1d', 5).catch(() => null),
    fetchYahooChart('^TNX', '1d', 5).catch(() => null),
    fetchYahooChart('DX-Y.NYB', '1d', 5).catch(() => null),
  ]);
  return {
    ok: true,
    source: 'Yahoo Finance Macro',
    vix: vix?.price ?? null,
    vixChangePct: vix?.changePct ?? 0,
    us10yYield: tnx?.price ?? null,
    dxy: dxy?.price ?? null,
    dxyChangePct: dxy?.changePct ?? 0,
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
    candles: candles.slice(-Math.max(60, Math.min(1000, Number(limit) || 500))),
  };
}

export async function handleMarketRequest(query = {}) {
  if (query.action === 'macro') {
    return await fetchMacroSnapshot();
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
  return await fetchYahooChart(symbol, tf, limit);
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
