// Pure indicator math. Every function returns an array aligned with candles (null where undefined).

export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function trueRange(candles) {
  const out = new Array(candles.length).fill(null);
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    out[i] = Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c));
  }
  return out;
}

export function atr(candles, period = 14) {
  const tr = trueRange(candles);
  const out = new Array(candles.length).fill(null);
  let sum = 0;
  for (let i = 1; i < candles.length; i++) {
    sum += tr[i] || 0;
    if (i >= period) {
      out[i] = sum / period;
      sum -= tr[i - period + 1] || 0;
    }
  }
  return out;
}

export function bollinger(values, period = 20, mult = 2) {
  const mid = sma(values, period);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += (values[j] - mid[i]) ** 2;
    const sd = Math.sqrt(sum / period);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
  }
  return { mid, upper, lower };
}

export function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  const f = ema(values, fast);
  const s = ema(values, slow);
  const line = values.map((_, i) => (f[i] != null && s[i] != null ? f[i] - s[i] : null));
  const clean = line.map((v) => v ?? 0);
  const sig = ema(clean, signalPeriod);
  return { line, signal: sig, hist: line.map((v, i) => (v != null && sig[i] != null ? v - sig[i] : null)) };
}

export function roc(values, period) {
  return values.map((v, i) => (i >= period && values[i - period] ? ((v - values[i - period]) / values[i - period]) * 100 : null));
}

export function donchian(candles, period) {
  const upper = new Array(candles.length).fill(null);
  const lower = new Array(candles.length).fill(null);
  for (let i = period; i < candles.length; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period; j < i; j++) {
      if (candles[j].h > hi) hi = candles[j].h;
      if (candles[j].l < lo) lo = candles[j].l;
    }
    upper[i] = hi;
    lower[i] = lo;
  }
  return { upper, lower };
}

export function stdev(values) {
  if (!values.length) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(v);
}

export function adx(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  if (candles.length < period * 2 + 2) return out;
  const tr = trueRange(candles);
  const plusDM = new Array(candles.length).fill(0);
  const minusDM = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const up = candles[i].h - candles[i - 1].h;
    const down = candles[i - 1].l - candles[i].l;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
  }
  let trS = 0;
  let pS = 0;
  let mS = 0;
  for (let i = 1; i <= period; i++) {
    trS += tr[i] || 0;
    pS += plusDM[i];
    mS += minusDM[i];
  }
  const dx = [];
  for (let i = period + 1; i < candles.length; i++) {
    trS = trS - trS / period + (tr[i] || 0);
    pS = pS - pS / period + plusDM[i];
    mS = mS - mS / period + minusDM[i];
    const pDI = trS ? (pS / trS) * 100 : 0;
    const mDI = trS ? (mS / trS) * 100 : 0;
    const sum = pDI + mDI;
    dx.push({ i, v: sum ? (Math.abs(pDI - mDI) / sum) * 100 : 0 });
  }
  if (dx.length < period) return out;
  let value = dx.slice(0, period).reduce((s, d) => s + d.v, 0) / period;
  out[dx[period - 1].i] = value;
  for (let k = period; k < dx.length; k++) {
    value = (value * (period - 1) + dx[k].v) / period;
    out[dx[k].i] = value;
  }
  return out;
}

export function obv(candles) {
  const out = new Array(candles.length).fill(0);
  let value = 0;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].c > candles[i - 1].c) value += candles[i].v || 0;
    else if (candles[i].c < candles[i - 1].c) value -= candles[i].v || 0;
    out[i] = value;
  }
  return out;
}

export function highest(values, period) {
  return values.map((_, i) => (i < period - 1 ? null : Math.max(...values.slice(i - period + 1, i + 1))));
}

export function lowest(values, period) {
  return values.map((_, i) => (i < period - 1 ? null : Math.min(...values.slice(i - period + 1, i + 1))));
}
