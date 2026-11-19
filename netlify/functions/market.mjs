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
