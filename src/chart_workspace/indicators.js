// Technical Indicators & Quantitative Computations for Chart Workspace
// Computes SMA, EMA, VWAP, Bollinger Bands, SuperTrend, RSI, MACD, and ATR.

export function calculateSMA(candles, period = 20) {
  const result = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const val = Number(c.c ?? c.close);
    sum += val;
    if (i >= period) {
      sum -= Number(candles[i - period].c ?? candles[i - period].close);
    }
    if (i >= period - 1) {
      let t = c.t || c.time;
      if (typeof t === 'string') t = Math.floor(new Date(t).getTime() / 1000);
      else if (t > 1e11) t = Math.floor(t / 1000);
      result.push({ time: t, value: Number((sum / period).toFixed(2)) });
    }
  }
  return result;
}

export function calculateEMA(candles, period = 20) {
  const result = [];
  if (!candles || candles.length < period) return result;
  const k = 2 / (period + 1);
  let ema = 0;

  // Initial SMA
  for (let i = 0; i < period; i++) {
    ema += Number(candles[i].c ?? candles[i].close);
  }
  ema /= period;

  for (let i = period - 1; i < candles.length; i++) {
    const c = candles[i];
    const val = Number(c.c ?? c.close);
    if (i > period - 1) {
      ema = val * k + ema * (1 - k);
    }
    let t = c.t || c.time;
    if (typeof t === 'string') t = Math.floor(new Date(t).getTime() / 1000);
    else if (t > 1e11) t = Math.floor(t / 1000);
    result.push({ time: t, value: Number(ema.toFixed(2)) });
  }
  return result;
}

export function calculateVWAP(candles) {
  const result = [];
  let cumVol = 0;
  let cumTPVol = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const h = Number(c.h ?? c.high ?? c.c);
    const l = Number(c.l ?? c.low ?? c.c);
    const cl = Number(c.c ?? c.close);
    const v = Number(c.v ?? c.volume ?? 1);
    const tp = (h + l + cl) / 3;

    cumTPVol += tp * v;
    cumVol += v;

    let t = c.t || c.time;
    if (typeof t === 'string') t = Math.floor(new Date(t).getTime() / 1000);
    else if (t > 1e11) t = Math.floor(t / 1000);

    result.push({
      time: t,
      value: cumVol > 0 ? Number((cumTPVol / cumVol).toFixed(2)) : cl,
    });
  }
  return result;
}

export function calculateBollinger(candles, period = 20, multiplier = 2) {
  const upper = [];
  const middle = [];
  const lower = [];

  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1);
    const closes = slice.map((c) => Number(c.c ?? c.close));
    const mean = closes.reduce((a, b) => a + b, 0) / period;
    const variance = closes.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    let t = candles[i].t || candles[i].time;
    if (typeof t === 'string') t = Math.floor(new Date(t).getTime() / 1000);
    else if (t > 1e11) t = Math.floor(t / 1000);

    middle.push({ time: t, value: Number(mean.toFixed(2)) });
    upper.push({ time: t, value: Number((mean + stdDev * multiplier).toFixed(2)) });
    lower.push({ time: t, value: Number((mean - stdDev * multiplier).toFixed(2)) });
  }

  return { upper, middle, lower };
}

export function calculateRSI(candles, period = 14) {
  const result = [];
  if (candles.length <= period) return result;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = Number(candles[i].c ?? candles[i].close) - Number(candles[i - 1].c ?? candles[i - 1].close);
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period; i < candles.length; i++) {
    const c = candles[i];
    if (i > period) {
      const diff = Number(c.c ?? c.close) - Number(candles[i - 1].c ?? candles[i - 1].close);
      const gain = diff >= 0 ? diff : 0;
      const loss = diff < 0 ? Math.abs(diff) : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);

    let t = c.t || c.time;
    if (typeof t === 'string') t = Math.floor(new Date(t).getTime() / 1000);
    else if (t > 1e11) t = Math.floor(t / 1000);

    result.push({ time: t, value: Number(rsi.toFixed(2)) });
  }

  return result;
}

export function calculateMACD(candles, fast = 12, slow = 26, signal = 9) {
  const fastEma = calculateEMA(candles, fast);
  const slowEma = calculateEMA(candles, slow);

  const slowMap = new Map(slowEma.map((item) => [item.time, item.value]));
  const macdLine = [];

  for (const item of fastEma) {
    if (slowMap.has(item.time)) {
      macdLine.push({
        time: item.time,
        value: Number((item.value - slowMap.get(item.time)).toFixed(2)),
      });
    }
  }

  // Signal EMA over MACD line
  const k = 2 / (signal + 1);
  const signalLine = [];
  const histogram = [];

  if (macdLine.length >= signal) {
    let sigEma = macdLine.slice(0, signal).reduce((a, b) => a + b.value, 0) / signal;
    for (let i = signal - 1; i < macdLine.length; i++) {
      const cur = macdLine[i];
      if (i > signal - 1) {
        sigEma = cur.value * k + sigEma * (1 - k);
      }
      const hist = cur.value - sigEma;
      signalLine.push({ time: cur.time, value: Number(sigEma.toFixed(2)) });
      histogram.push({
        time: cur.time,
        value: Number(hist.toFixed(2)),
        color: hist >= 0 ? 'rgba(16, 185, 129, 0.65)' : 'rgba(244, 63, 94, 0.65)',
      });
    }
  }

  return { macdLine, signalLine, histogram };
}
