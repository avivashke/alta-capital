// Technical analysis readout: trend, momentum, volatility, structure, volume.
// Used by the analysts, the advisor digest and the UI — not as a trading signal on its own.

import { ema, rsi, atr, adx, macd, roc, bollinger, obv, sma } from './indicators.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function analyze(candles) {
  if (!candles || candles.length < 60) return null;
  const closes = candles.map((c) => c.c);
  const n = closes.length;
  const price = closes[n - 1];

  const e20s = ema(closes, 20);
  const e50s = ema(closes, 50);
  const e200s = ema(closes, Math.min(200, Math.max(30, n - 2)));
  const rsiS = rsi(closes, 14);
  const macdS = macd(closes);
  const atrS = atr(candles, 14);
  const adxS = adx(candles, 14);
  const bb = bollinger(closes, 20, 2);
  const obvS = obv(candles);
  const rocS = roc(closes, 10);

  const last = (arr) => {
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
    return null;
  };

  const e20 = last(e20s);
  const e50 = last(e50s);
  const e200 = last(e200s);
  const rsiV = last(rsiS) ?? 50;
  const macdHist = last(macdS.hist) ?? 0;
  const atrV = last(atrS) ?? 0;
  const adxV = last(adxS);
  const upper = last(bb.upper);
  const lower = last(bb.lower);
  const rocV = last(rocS) ?? 0;

  const lookback = Math.min(120, n);
  const window = closes.slice(-lookback);
  const swingHigh = Math.max(...window);
  const swingLow = Math.min(...window);
  const range = swingHigh - swingLow || 1;
  const position = (price - swingLow) / range;

  const e20Prev = e20s[n - 11] ?? e20;
  const slope = e20Prev ? (e20 - e20Prev) / e20Prev : 0;

  let trend = 0;
  if (e20) trend += price > e20 ? 0.25 : -0.25;
  if (e20 && e50) trend += e20 > e50 ? 0.25 : -0.25;
  if (e50 && e200) trend += e50 > e200 ? 0.25 : -0.25;
  if (adxV != null) trend += adxV > 22 ? 0.15 : adxV < 15 ? -0.1 : 0;
  trend += clamp(slope * 40, -0.2, 0.2);

  let momentum = 0;
  momentum += clamp((rsiV - 50) / 50, -1, 1) * 0.4;
  momentum += clamp(macdHist / (atrV * 0.6 || 1), -1, 1) * 0.35;
  momentum += clamp(rocV / 6, -1, 1) * 0.25;

  const structure = (position - 0.5) * 1.2;
  const obvSlope = obvS[n - 1] - obvS[Math.max(0, n - 21)];
  const avgVol = candles.slice(-20).reduce((s, c) => s + (c.v || 0), 0) / 20 || 1;
  const volumeScore = clamp(obvSlope / (avgVol * 20), -1, 1);

  const bias = clamp(0.45 * trend + 0.3 * momentum + 0.15 * structure + 0.1 * volumeScore, -1, 1);
  const atrPct = price ? (atrV / price) * 100 : 0;
  const bbWidth = price && upper != null && lower != null ? ((upper - lower) / price) * 100 : 0;
  const vols = candles.slice(-100).map((c) => (c.h - c.l) / (c.c || 1) * 100);
  const meanRange = vols.reduce((a, b) => a + b, 0) / (vols.length || 1);
  const volRegime = meanRange ? (atrPct > meanRange * 1.35 ? 'גבוהה' : atrPct < meanRange * 0.7 ? 'נמוכה' : 'רגילה') : '—';

  const confidence = Math.round(clamp(48 + Math.abs(bias) * 42 + (adxV ?? 0) * 0.18, 35, 96));

  return {
    price: +price.toFixed(6),
    bias: +bias.toFixed(2),
    biasLabel: bias > 0.35 ? 'שורי חזק' : bias > 0.12 ? 'שורי' : bias < -0.35 ? 'דובי חזק' : bias < -0.12 ? 'דובי' : 'ניטרלי',
    confidence,
    trend: {
      score: +trend.toFixed(2),
      label: trend > 0.35 ? 'מגמת עלייה' : trend < -0.35 ? 'מגמת ירידה' : 'דשדוש',
      ema20: e20 ? +e20.toFixed(2) : null,
      ema50: e50 ? +e50.toFixed(2) : null,
      ema200: e200 ? +e200.toFixed(2) : null,
      adx: adxV != null ? +adxV.toFixed(1) : null,
      slopePct: +(slope * 100).toFixed(2),
    },
    momentum: {
      score: +momentum.toFixed(2),
      label: momentum > 0.25 ? 'מומנטום חיובי' : momentum < -0.25 ? 'מומנטום שלילי' : 'מומנטום חלש',
      rsi: +rsiV.toFixed(1),
      macdHist: +macdHist.toFixed(4),
      roc10: +rocV.toFixed(2),
      state: rsiV > 70 ? 'קניית יתר' : rsiV < 30 ? 'מכירת יתר' : 'ניטרלי',
    },
    volatility: { atrPct: +atrPct.toFixed(2), bbWidthPct: +bbWidth.toFixed(2), regime: volRegime },
    structure: {
      position: +position.toFixed(2),
      support: +swingLow.toFixed(2),
      resistance: +swingHigh.toFixed(2),
      distToHighPct: +(((swingHigh - price) / price) * 100).toFixed(2),
      distToLowPct: +(((price - swingLow) / price) * 100).toFixed(2),
    },
    volume: { score: +volumeScore.toFixed(2), label: volumeScore > 0.15 ? 'נפח תומך' : volumeScore < -0.15 ? 'נפח מחליש' : 'נפח ניטרלי' },
    summary: [
      `מגמה: ${trend > 0.35 ? 'עלייה' : trend < -0.35 ? 'ירידה' : 'דשדוש'} · ADX ${adxV != null ? adxV.toFixed(0) : '—'}`,
      `מומנטום: RSI ${rsiV.toFixed(0)} · ROC10 ${rocV.toFixed(1)}%`,
      `תנודתיות: ${volRegime} · ATR ${atrPct.toFixed(1)}% מהמחיר`,
      `מבנה: ${(position * 100).toFixed(0)}% מהטווח · תמיכה ${swingLow.toFixed(2)} · התנגדות ${swingHigh.toFixed(2)}`,
      `נפח: ${volumeScore > 0.15 ? 'תומך בכיוון' : volumeScore < -0.15 ? 'מתנגד לכיוון' : 'ניטרלי'}`,
    ],
    at: Date.now(),
  };
}

export function taBiasForDesk(desk) {
  const ta = desk?.technical;
  if (!ta) return { score: 0, label: '—' };
  return {
    score: ta.bias,
    label: ta.biasLabel,
    confidence: ta.confidence,
    note: ta.summary?.[0] || '',
  };
}

export function multiTimeframe(candlesByTf) {
  const out = {};
  for (const [tf, candles] of Object.entries(candlesByTf)) {
    const a = analyze(candles);
    if (a) out[tf] = { bias: a.bias, label: a.biasLabel, regime: a.volatility.regime, trend: a.trend.label };
  }
  const scores = Object.values(out).map((x) => x.bias);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  return { byTimeframe: out, consensus: +avg.toFixed(2) };
}
