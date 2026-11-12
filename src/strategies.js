// Strategy families. Each returns a "desired position" series: 1 long, -1 short, 0 flat.

import * as ind from './indicators.js';

const int = (min, max) => ({ type: 'int', min, max });
const flt = (min, max, step = 0.1) => ({ type: 'float', min, max, step });
const bool = () => ({ type: 'bool' });

function closed(closes, i) {
  return closes.slice(0, i + 1);
}

export const STRATEGIES = {
  ema_trend: {
    label: 'מגמת ממוצעים נעים (EMA)',
    blurb: 'חוצה מהיר/איטי עם פילטר מגמה רחב. קלאסיקה עמידה לתוך מגמות.',
    warmup: 210,
    space: {
      fast: int(4, 30),
      slow: int(24, 110),
      atrStop: flt(1, 3.6),
      rr: flt(1.2, 3.2),
      trendFilter: bool(),
    },
    positions(candles, p) {
      const closes = candles.map((c) => c.c);
      const fast = ind.sma(closes, Math.round(p.fast));
      const slow = ind.sma(closes, Math.round(p.slow));
      const trend = ind.ema(closes, 200);
      return closes.map((c, i) => {
        if (fast[i] == null || slow[i] == null) return 0;
        const above = p.trendFilter ? trend[i] == null || c > trend[i] : true;
        const below = p.trendFilter ? trend[i] == null || c < trend[i] : true;
        if (fast[i] > slow[i] && above) return 1;
        if (fast[i] < slow[i] && below) return -1;
        return 0;
      });
    },
  },

  rsi_reversion: {
    label: 'חזרה לממוצע (RSI)',
    blurb: 'כניסה בקיצוניות RSI ויציאה בחזרה לאמצע. מתאים לשווקים מתכנסים.',
    warmup: 120,
    space: {
      period: int(7, 22),
      oversold: int(15, 35),
      overbought: int(65, 85),
      atrStop: flt(1, 3.2),
      rr: flt(1.1, 2.8),
    },
    positions(candles, p) {
      const closes = candles.map((c) => c.c);
      const rsi = ind.rsi(closes, Math.round(p.period));
      const out = new Array(closes.length).fill(0);
      let state = 0;
      for (let i = 1; i < closes.length; i++) {
        const r = rsi[i];
        if (r == null) continue;
        if (state === 0) {
          if (r <= p.oversold) state = 1;
          else if (r >= p.overbought) state = -1;
        } else if (state === 1 && r >= 50) state = 0;
        else if (state === -1 && r <= 50) state = 0;
        out[i] = state;
      }
      return out;
    },
  },

  breakout: {
    label: 'פריצת ערוץ (Donchian)',
    blurb: 'פריצת שיא/שפל של N נרות, יציאה בחזרה לאמצע הערוץ.',
    warmup: 90,
    space: {
      period: int(10, 60),
      atrStop: flt(1, 3.8),
      rr: flt(1.2, 4),
      filter: bool(),
    },
    positions(candles, p) {
      const closes = candles.map((c) => c.c);
      const n = Math.round(p.period);
      const { upper, lower } = ind.donchian(candles, n);
      const mid = closes.map((_, i) => (upper[i] != null ? (upper[i] + lower[i]) / 2 : null));
      const trend = ind.sma(closes, 200);
      const out = new Array(closes.length).fill(0);
      let state = 0;
      for (let i = 1; i < closes.length; i++) {
        if (upper[i - 1] == null) continue;
        const c = closes[i];
        if (state === 0) {
          if (c > upper[i - 1] && (!p.filter || trend[i] == null || c > trend[i])) state = 1;
          else if (c < lower[i - 1] && (!p.filter || trend[i] == null || c < trend[i])) state = -1;
        } else if (state === 1 && mid[i] != null && c < mid[i]) state = 0;
        else if (state === -1 && mid[i] != null && c > mid[i]) state = 0;
        out[i] = state;
      }
      return out;
    },
  },

  momentum: {
    label: 'מומנטום (ROC)',
    blurb: 'שיעור שינוי מחיר עם היסטרזיס. עוקב אחרי דחיפות כיוון.',
    warmup: 80,
    space: {
      period: int(3, 28),
      threshold: flt(0.1, 2.4),
      atrStop: flt(1, 3.6),
      rr: flt(1.2, 3.6),
    },
    positions(candles, p) {
      const closes = candles.map((c) => c.c);
      const roc = ind.roc(closes, Math.round(p.period));
      return roc.map((r) => {
        if (r == null) return 0;
        if (r > p.threshold) return 1;
        if (r < -p.threshold) return -1;
        return 0;
      });
    },
  },

  macd_swing: {
    label: 'MACD + פילטר מגמה',
    blurb: 'היסטוגרמת MACD חוצה אפס בכיוון המגמה הרחבה. אופי סווינג.',
    warmup: 210,
    space: {
      fast: int(6, 18),
      slow: int(20, 42),
      signal: int(6, 14),
      atrStop: flt(1.2, 4),
      rr: flt(1.2, 4),
    },
    positions(candles, p) {
      const closes = candles.map((c) => c.c);
      const m = ind.macd(closes, Math.round(p.fast), Math.round(p.slow), Math.round(p.signal));
      const trend = ind.ema(closes, 200);
      return closes.map((c, i) => {
        if (m.hist[i] == null) return 0;
        const up = m.hist[i] > 0 && (trend[i] == null || c > trend[i]);
        const down = m.hist[i] < 0 && (trend[i] == null || c < trend[i]);
        if (up) return 1;
        if (down) return -1;
        return 0;
      });
    },
  },
};

export const STRATEGY_IDS = Object.keys(STRATEGIES);

export function strategyLabel(id) {
  return STRATEGIES[id]?.label || id;
}

export function defaultsFor(id) {
  const s = STRATEGIES[id];
  if (!s) return null;
  const out = {};
  for (const [key, spec] of Object.entries(s.space)) {
    if (spec.type === 'bool') out[key] = true;
    else if (spec.type === 'int') out[key] = Math.round((spec.min + spec.max) / 2);
    else out[key] = Math.round(((spec.min + spec.max) / 2) * 10) / 10;
  }
  return out;
}

export function describeParams(id, params) {
  if (!params) return '—';
  const s = STRATEGIES[id];
  return Object.entries(params)
    .map(([k, v]) => {
      const label = { fast: 'מהיר', slow: 'איטי', atrStop: 'סטופ ATR', rr: 'יעד R:R', period: 'תקופה', oversold: 'קניית יתר', overbought: 'מכירת יתר', threshold: 'סף %', trendFilter: 'פילטר מגמה', filter: 'פילטר', signal: 'סיגנל' }[k] || k;
      return `${label}=${typeof v === 'boolean' ? (v ? 'כן' : 'לא') : v}`;
    })
    .join(' · ') || (s ? 'ברירת מחדל' : '—');
}
