// Live check that every historical and real-time feed actually answers from this browser.

export const HISTORY_FEEDS = [
  {
    id: 'binance', label: 'Binance · נרות', kind: 'היסטורי',
    url: 'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=5',
    valid: (j) => Array.isArray(j) && j.length >= 5,
  },
  {
    id: 'kraken', label: 'Kraken · נרות', kind: 'היסטורי',
    url: 'https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=60',
    valid: (j) => !!(j?.result && Object.keys(j.result).length),
  },
  {
    id: 'coinbase', label: 'Coinbase · נרות', kind: 'היסטורי',
    url: 'https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600',
    valid: (j) => Array.isArray(j) && j.length > 0,
  },
];

export const LIVE_FEEDS = [
  {
    id: 'binance-ticker', label: 'Binance · מחיר בזמן אמת', kind: 'זמן אמת',
    url: 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
    valid: (j) => !!(j?.price && Number(j.price) > 0),
  },
];

export const CONTEXT_FEEDS = [
  {
    id: 'feargreed', label: 'Alternative.me · פחד/חמדנות', kind: 'סנטימנט',
    url: 'https://api.alternative.me/fng/?limit=1',
    valid: (j) => !!(j?.data && j.data.length),
  },
  {
    id: 'coingecko', label: 'CoinGecko · trending', kind: 'סנטימנט',
    url: 'https://api.coingecko.com/api/v3/search/trending',
    valid: (j) => !!j?.coins,
  },
  {
    id: 'github', label: 'GitHub Search API', kind: 'מחקר',
    url: 'https://api.github.com/rate_limit',
    valid: (j) => !!j?.rate,
  },
];

async function timedFetch(feed) {
  const started = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(feed.url, { signal: ctrl.signal, cache: 'no-store' });
    const json = await res.json();
    return {
      id: feed.id, label: feed.label, kind: feed.kind,
      ok: res.ok && feed.valid(json),
      status: res.status,
      ms: Math.round(performance.now() - started),
    };
  } catch (err) {
    return {
      id: feed.id, label: feed.label, kind: feed.kind,
      ok: false, status: 0, ms: Math.round(performance.now() - started),
      error: err.name === 'AbortError' ? 'timeout' : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function testWebSocket(url, timeoutMs = 7000) {
  return new Promise((resolve) => {
    const started = performance.now();
    let done = false;
    let socket = null;
    const finish = (ok, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket?.close(); } catch { /* noop */ }
      resolve({ ok, ms: Math.round(performance.now() - started), error });
    };
    const timer = setTimeout(() => finish(false, 'timeout'), timeoutMs);
    try {
      socket = new WebSocket(url);
    } catch (err) {
      finish(false, err.message);
      return;
    }
    socket.onopen = () => finish(true);
    socket.onerror = () => finish(false, 'handshake failed');
  });
}

export async function testAllFeeds() {
  const results = [];
  for (const feed of [...HISTORY_FEEDS, ...LIVE_FEEDS, ...CONTEXT_FEEDS]) {
    results.push(await timedFetch(feed));
  }
  const ws = await testWebSocket('wss://stream.binance.com:9443/ws/btcusdt@miniTicker');
  results.push({
    id: 'binance-ws', label: 'Binance · WebSocket', kind: 'זמן אמת',
    ok: ws.ok, status: ws.ok ? 101 : 0, ms: ws.ms, error: ws.error,
  });
  return results;
}
