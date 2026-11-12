// Market data: real OHLCV from public CORS-enabled APIs, with a deterministic synthetic fallback.
// Providers are tried in order; anything that fails is skipped.

const TF = {
  '5m': { ms: 300000, binance: '5m', kraken: 5, coinbase: 300 },
  '15m': { ms: 900000, binance: '15m', kraken: 15, coinbase: 900 },
  '1h': { ms: 3600000, binance: '1h', kraken: 60, coinbase: 3600 },
  '1d': { ms: 86400000, binance: '1d', kraken: 1440, coinbase: 86400 },
  '1w': { ms: 604800000, binance: '1w', kraken: 10080, coinbase: null },
};

const SYMBOLS = {
  BTCUSDT: { kraken: 'XBTUSD', coinbase: 'BTC-USD', base: 68000 },
  ETHUSDT: { kraken: 'ETHUSD', coinbase: 'ETH-USD', base: 3400 },
  SOLUSDT: { kraken: 'SOLUSD', coinbase: 'SOL-USD', base: 165 },
};

const VOL_PER_BAR = { '5m': 0.0019, '15m': 0.0033, '1h': 0.0062, '1d': 0.024, '1w': 0.055 };

const cache = new Map();
const TTL = { '5m': 120000, '15m': 180000, '1h': 300000, '1d': 900000, '1w': 1800000 };

export const marketState = { provider: '—', synthetic: false, fetchedAt: null, error: null };

async function fetchJson(url, timeout = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fromBinance(symbol, tf, limit) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${TF[tf].binance}&limit=${limit}`;
  const rows = await fetchJson(url);
  if (!Array.isArray(rows) || rows.length < 60) throw new Error('binance: empty');
  return rows.map((k) => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
}

async function fromKraken(symbol, tf, limit) {
  const meta = SYMBOLS[symbol];
  if (!meta) throw new Error('kraken: symbol');
  const url = `https://api.kraken.com/0/public/OHLC?pair=${meta.kraken}&interval=${TF[tf].kraken}`;
  const json = await fetchJson(url);
  const key = Object.keys(json.result || {}).find((k) => Array.isArray(json.result[k]));
  if (!key) throw new Error('kraken: empty');
  const rows = json.result[key].slice(-limit);
  if (rows.length < 60) throw new Error('kraken: thin');
  return rows.map((r) => ({ t: r[0] * 1000, o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[6] }));
}

async function fromCoinbase(symbol, tf, limit) {
  const meta = SYMBOLS[symbol];
  const gran = TF[tf].coinbase;
  if (!meta || !gran) throw new Error('coinbase: unsupported');
  const out = [];
  let end = Date.now();
  for (let page = 0; page < 5 && out.length < limit; page++) {
    const start = end - gran * 1000 * 290;
    const url = `https://api.exchange.coinbase.com/products/${meta.coinbase}/candles?granularity=${gran}` +
      `&start=${new Date(start).toISOString()}&end=${new Date(end).toISOString()}`;
    const rows = await fetchJson(url);
    if (!Array.isArray(rows) || !rows.length) break;
    for (const r of rows) out.push({ t: r[0] * 1000, o: +r[3], h: +r[2], l: +r[1], c: +r[4], v: +r[5] });
    if (rows.length < 290) break;
    end = start - gran * 1000;
  }
  if (out.length < 60) throw new Error('coinbase: thin');
  const map = new Map(out.map((c) => [c.t, c]));
  return [...map.values()].sort((a, b) => a.t - b.t).slice(-limit);
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function syntheticCandles(symbol, tf, limit) {
  const meta = TF[tf];
  const step = meta.ms;
  const rand = mulberry32(hash(symbol + tf + new Date().toISOString().slice(0, 10)));
  const now = Math.floor(Date.now() / step) * step;
  const start = now - step * (limit - 1);
  const vol = VOL_PER_BAR[tf] || 0.02;
  let price = (SYMBOLS[symbol]?.base || 100) * (0.82 + rand() * 0.3);
  let drift = 0;
  const candles = [];
  for (let i = 0; i < limit; i++) {
    if (i % 90 === 0) drift = (rand() - 0.5) * vol * 0.55;
    const shock = (rand() + rand() + rand() - 1.5) * vol;
    const o = price;
    const c = Math.max(o * (1 + drift + shock), o * 0.9);
    const wick = Math.abs(shock) * o * (0.7 + rand());
    const h = Math.max(o, c) + wick * rand();
    const l = Math.min(o, c) - wick * rand();
    const v = 100 + rand() * 900 + Math.abs(shock) * 20000;
    candles.push({ t: start + i * step, o, h, l, c, v });
    price = c;
  }
  return candles;
}

// --- quote stream ---------------------------------------------------------

export const quotes = {};
let ws = null;
let pollTimer = null;
let quoteSymbols = [];
let listeners = new Set();
let pollTicker = null;

function emitQuotes() {
  for (const fn of listeners) { try { fn(quotes); } catch (err) { console.error(err); } }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    for (const symbol of quoteSymbols) {
      try {
        const rows = await fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`, 6000);
        quotes[symbol] = { price: +rows.lastPrice, changePct: +rows.priceChangePercent, at: Date.now() };
      } catch {
        const prev = quotes[symbol]?.price || SYMBOLS[symbol]?.base || 100;
        quotes[symbol] = { price: prev * (1 + (Math.random() - 0.5) * 0.0008), changePct: 0, at: Date.now(), synthetic: true };
      }
    }
    emitQuotes();
  }, 12000);
}

export function startQuotes(symbols, onChange) {
  if (onChange) listeners.add(onChange);
  const same = symbols.length === quoteSymbols.length && symbols.every((s, i) => s === quoteSymbols[i]);
  quoteSymbols = symbols.slice();
  if (ws || pollTimer) { if (same) return; stopQuotes(); quoteSymbols = symbols.slice(); }
  if (typeof WebSocket === 'undefined') { startPolling(); return; }
  try {
    const streams = symbols.map((s) => s.toLowerCase() + '@miniTicker').join('/');
    ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const d = msg.data || msg;
        if (!d?.s) return;
        quotes[d.s] = { price: +d.c, changePct: d.o ? ((+d.c - +d.o) / +d.o) * 100 : 0, at: Date.now() };
        emitQuotes();
      } catch { /* ignore malformed frame */ }
    };
    ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
    ws.onclose = () => { ws = null; startPolling(); };
  } catch {
    startPolling();
  }
}

export function stopQuotes() {
  try { ws?.close(); } catch { /* noop */ }
  ws = null;
  clearInterval(pollTimer);
  pollTimer = null;
  clearInterval(pollTicker);
}

export function onQuotes(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function lastPrice(symbol) {
  return quotes[symbol]?.price || SYMBOLS[symbol]?.base || 100;
}

// --- candle fetching ------------------------------------------------------

export async function getCandles(symbol, tf, { limit = 700, force = false } = {}) {
  const key = `${symbol}|${tf}|${limit}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < (TTL[tf] || 300000)) {
    Object.assign(marketState, { provider: hit.provider, synthetic: hit.synthetic, fetchedAt: hit.at, error: hit.error || null });
    return hit.candles;
  }
  const errors = [];
  const providers = [
    ['Binance', () => fromBinance(symbol, tf, limit)],
    ['Kraken', () => fromKraken(symbol, tf, limit)],
    ['Coinbase', () => fromCoinbase(symbol, tf, limit)],
  ];
  for (const [name, fn] of providers) {
    try {
      const candles = await fn();
      if (candles.length >= 60) {
        cache.set(key, { at: Date.now(), candles, provider: name, synthetic: false });
        Object.assign(marketState, { provider: name, synthetic: false, fetchedAt: Date.now(), error: null });
        return candles;
      }
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
    }
  }
  const candles = syntheticCandles(symbol, tf, limit);
  cache.set(key, { at: Date.now(), candles, provider: 'נתוני הדגמה', synthetic: true, error: errors.join(' · ') });
  Object.assign(marketState, { provider: 'נתוני הדגמה', synthetic: true, fetchedAt: Date.now(), error: errors.join(' · ') });
  return candles;
}

export function clearCache() {
  cache.clear();
}

export function symbolOf(deskSymbol) {
  return SYMBOLS[deskSymbol]?.coinbase?.replace('-', '') || deskSymbol;
}
