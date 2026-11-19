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
    blurb: 'חוצה EMA מהיר/איטי עם אישור שיפוע ופילטר מגמה רחב. קלאסיקה עמידה לתוך מגמות.',
    warmup: 160,
    space: {
      fast: int(5, 24),
      slow: int(28, 110),
      atrStop: flt(1.2, 3.6),
      rr: flt(1.4, 3.6),
      trendFilter: bool(),
    },
    positions(candles, p) {
      const closes = candles.map((c) => c.c);
      const fLen = Math.max(3, Math.round(p.fast));
      const sLen = Math.max(fLen + 4, Math.round(p.slow));
      const fast = ind.ema(closes, fLen);
      const slow = ind.ema(closes, sLen);
      const trend = ind.ema(closes, 200);
      const out = new Array(closes.length).fill(0);
      let state = 0;
      for (let i = 1; i < closes.length; i++) {
        if (fast[i] == null || slow[i] == null || slow[i - 1] == null) continue;
        const c = closes[i];
        const above = p.trendFilter ? trend[i] == null || c > trend[i] : true;
        const below = p.trendFilter ? trend[i] == null || c < trend[i] : true;
        const slopeUp = slow[i] >= slow[i - 1];
        const slopeDn = slow[i] <= slow[i - 1];
        if (fast[i] > slow[i] && above && (state === 1 || slopeUp)) state = 1;
        else if (fast[i] < slow[i] && below && (state === -1 || slopeDn)) state = -1;
        else if (state === 1 && fast[i] <= slow[i]) state = 0;
        else if (state === -1 && fast[i] >= slow[i]) state = 0;
        out[i] = state;
      }
      return out;
    },
  },

  rsi_reversion: {
    label: 'חזרה לממוצע (RSI)',
    blurb: 'כניסה בהיפוך RSI מקיצוניות (אישור hook) ויציאה בחזרה לאמצע. מתאים לשווקים מתכנסים.',
    warmup: 100,
    space: {
      period: int(7, 22),
      oversold: int(18, 36),
      overbought: int(64, 84),
      atrStop: flt(1.0, 3.2),
      rr: flt(1.2, 3.0),
    },
    positions(candles, p) {
      const closes = candles.map((c) => c.c);
      const rsi = ind.rsi(closes, Math.round(p.period));
      const trend = ind.ema(closes, 100);
      const out = new Array(closes.length).fill(0);
      let state = 0;
      for (let i = 2; i < closes.length; i++) {
        const r = rsi[i];
        const rPrev = rsi[i - 1];
        if (r == null || rPrev == null) continue;
        if (state === 0) {
          // Confirmation hook: wait for RSI to curl back from extreme rather than catching a falling knife
          const notCrash = trend[i] == null || closes[i] >= trend[i] * 0.90;
          const notMeltup = trend[i] == null || closes[i] <= trend[i] * 1.12;
          if (rPrev <= p.oversold && r > rPrev && notCrash) state = 1;
          else if (rPrev >= p.overbought && r < rPrev && notMeltup) state = -1;
        } else if (state === 1 && r >= 52) state = 0;
        else if (state === -1 && r <= 48) state = 0;
        out[i] = state;
      }
      return out;
    },
  },

  breakout: {
    label: 'פריצת ערוץ (Donchian)',
    blurb: 'פריצת שיא/שפל של N נרות עם יציאה אסימטרית (Turtle N/2) המאפשרת למגמות לרוץ.',
    warmup: 90,
    space: {
      period: int(10, 55),
      atrStop: flt(1.2, 3.8),
      rr: flt(1.5, 4.2),
      filter: bool(),
    },
    positions(candles, p) {
      const closes = candles.map((c) => c.c);
      const n = Math.round(p.period);
      const exitN = Math.max(5, Math.round(n * 0.5));
      const { upper, lower } = ind.donchian(candles, n);
      const exitCh = ind.donchian(candles, exitN);
      const trend = ind.ema(closes, 150);
      const out = new Array(closes.length).fill(0);
      let state = 0;
      for (let i = 1; i < closes.length; i++) {
        if (upper[i - 1] == null) continue;
        const c = closes[i];
        if (state === 0) {
          if (c > upper[i - 1] && (!p.filter || trend[i] == null || c > trend[i])) state = 1;
          else if (c < lower[i - 1] && (!p.filter || trend[i] == null || c < trend[i])) state = -1;
        } else if (state === 1 && exitCh.lower[i - 1] != null && c < exitCh.lower[i - 1]) state = 0;
        else if (state === -1 && exitCh.upper[i - 1] != null && c > exitCh.upper[i - 1]) state = 0;
        out[i] = state;
      }
      return out;
    },
  },

  momentum: {
    label: 'מומנטום (ROC)',
    blurb: 'שיעור שינוי מחיר עם היסטרזיס אמיתי (כניסה מעל סף, יציאה רק באובדן מומנטום).',
    warmup: 80,
    space: {
      period: int(5, 28),
      threshold: flt(0.2, 2.4),
      atrStop: flt(1.2, 3.6),
      rr: flt(1.4, 3.8),
    },
    positions(candles, p) {
      const closes = candles.map((c) => c.c);
      const roc = ind.roc(closes, Math.round(p.period));
      const trend = ind.ema(closes, 50);
      const out = new Array(closes.length).fill(0);
      let state = 0;
      for (let i = 1; i < closes.length; i++) {
        const r = roc[i];
        if (r == null) continue;
        if (state === 0) {
          if (r > p.threshold && (trend[i] == null || closes[i] > trend[i])) state = 1;
          else if (r < -p.threshold && (trend[i] == null || closes[i] < trend[i])) state = -1;
        } else if (state === 1 && r < 0) state = 0;
        else if (state === -1 && r > 0) state = 0;
        out[i] = state;
      }
      return out;
    },
  },

  macd_swing: {
    label: 'MACD + פילטר מגמה',
    blurb: 'היסטוגרמת MACD עם אישור תאוצה בכיוון המגמה הרחבה. אופי סווינג.',
    warmup: 160,
    space: {
      fast: int(6, 16),
      slow: int(20, 42),
      signal: int(6, 14),
      atrStop: flt(1.2, 4.0),
      rr: flt(1.5, 4.2),
    },
    positions(candles, p) {
      const closes = candles.map((c) => c.c);
      const fLen = Math.max(4, Math.round(p.fast));
      const sLen = Math.max(fLen + 5, Math.round(p.slow));
      const m = ind.macd(closes, fLen, sLen, Math.round(p.signal));
      const trend = ind.ema(closes, 200);
      const out = new Array(closes.length).fill(0);
      let state = 0;
      for (let i = 1; i < closes.length; i++) {
        const h = m.hist[i];
        const hp = m.hist[i - 1];
        if (h == null || hp == null) continue;
        const c = closes[i];
        const upTrend = trend[i] == null || c > trend[i];
        const dnTrend = trend[i] == null || c < trend[i];
        if (state === 0) {
          if (h > 0 && h >= hp && upTrend) state = 1;
          else if (h < 0 && h <= hp && dnTrend) state = -1;
        } else if (state === 1 && h <= 0) state = 0;
        else if (state === -1 && h >= 0) state = 0;
        out[i] = state;
      }
      return out;
    },
  },

  gann_swing_sq9: {
    label: 'גאן רמות מחיר (Square of 9)',
    blurb: 'מסחר בפריצת רמות ויברציה גאן Square-of-9 עם אישור מגמת EMA וניהול סיכון ATR.',
    warmup: 120,
    space: { lookback: int(20, 85), stepDiv: int(4, 16), atrStop: flt(1.2, 3.5), rr: flt(1.5, 4.0) },
    positions(candles, p) {
      const closes = candles.map((c) => c.c);
      const trend = ind.ema(closes, 50);
      const out = new Array(closes.length).fill(0);
      const lb = Math.round(p.lookback);
      const sd = Math.max(4, Math.round(p.stepDiv));
      for (let i = lb + 2; i < closes.length; i++) {
        let hh = -Infinity;
        let ll = Infinity;
        for (let j = i - lb; j < i; j++) {
          if (candles[j].h > hh) hh = candles[j].h;
          if (candles[j].l < ll) ll = candles[j].l;
        }
        // Clean prior-bar pivot (zero same-bar attenuation)
        const pivot = (hh + ll + closes[i - 1]) / 3;
        const root = Math.sqrt(Math.max(pivot, 1e-9));
        const up1 = Math.pow(root + 1 / sd, 2);
        const dn1 = Math.pow(Math.max(root - 1 / sd, 0.05), 2);
        const c = closes[i];
        const prev = closes[i - 1];
        let st = out[i - 1];
        if (st === 0) {
          if (prev <= up1 && c > up1 && (trend[i] == null || c > trend[i])) st = 1;
          else if (prev >= dn1 && c < dn1 && (trend[i] == null || c < trend[i])) st = -1;
        } else if (st === 1 && c < pivot) st = 0;
        else if (st === -1 && c > pivot) st = 0;
        out[i] = st;
      }
      return out;
    },
  },

  gann_time_cycle: {
    label: 'גאן מחזורי זמן ומומנטום',
    blurb: 'חלונות זמן מחזוריים (סגנון גאן/לוח שנה מסחרי) בשילוב מגמה ומומנטום.',
    warmup: 150,
    space: { cycle: int(21, 144), mom: int(5, 30), emaFast: int(8, 28), emaSlow: int(34, 120), atrStop: flt(1.2, 3.5), rr: flt(1.4, 4.0) },
    positions(candles, p) {
      const closes = candles.map((c) => c.c);
      const fLen = Math.max(5, Math.round(p.emaFast));
      const sLen = Math.max(fLen + 6, Math.round(p.emaSlow));
      const ef = ind.ema(closes, fLen);
      const es = ind.ema(closes, sLen);
      const rocArr = ind.roc(closes, Math.round(p.mom));
      const cycle = Math.max(10, Math.round(p.cycle));
      const out = new Array(closes.length).fill(0);
      for (let i = 2; i < closes.length; i++) {
        const phase = (i % cycle) / cycle;
        const inWindow = phase < 0.22 || phase > 0.78;
        const trendUp = ef[i] != null && es[i] != null && ef[i] > es[i];
        const trendDn = ef[i] != null && es[i] != null && ef[i] < es[i];
        const m = rocArr[i];
        if (inWindow) {
          if (trendUp && m != null && m > 0) out[i] = 1;
          else if (trendDn && m != null && m < 0) out[i] = -1;
          else out[i] = out[i - 1];
        } else {
          out[i] = out[i - 1];
          if (out[i] === 1 && trendDn && m != null && m < 0) out[i] = 0;
          if (out[i] === -1 && trendUp && m != null && m > 0) out[i] = 0;
        }
      }
      return out;
    },
  },

  supertrend_adx: {
    label: 'Supertrend + ADX',
    blurb: 'מעקב מגמה עם Supertrend וסינון כניסה ב-ADX (ללא יציאות שווא על גבול ADX).',
    warmup: 110,
    space: { period: int(7, 21), mult: flt(1.5, 4.5), adxPeriod: int(10, 20), adxMin: int(15, 35), atrStop: flt(1.2, 3.5), rr: flt(1.4, 4.0) },
    positions(candles, p) {
      const st = ind.supertrend(candles, Math.round(p.period), Number(p.mult));
      const adxArr = ind.adx(candles, Math.round(p.adxPeriod));
      const out = new Array(candles.length).fill(0);
      let state = 0;
      for (let i = 1; i < candles.length; i++) {
        const d = st.dir[i];
        const a = adxArr[i];
        if (!d || a == null) { out[i] = state; continue; }
        const desiredDir = d > 0 ? 1 : -1;
        if (state === 0) {
          // Entry-only ADX gate: enter only in confirmed trends, hold until Supertrend flips
          if (a >= Number(p.adxMin)) state = desiredDir;
        } else if (state !== desiredDir) {
          state = a >= Number(p.adxMin) ? desiredDir : 0;
        }
        out[i] = state;
      }
      return out;
    },
  },

  mean_reversion_z: {
    label: 'Mean Reversion (Z-Score)',
    blurb: 'חזרה לממוצע כמותית באמצעות Z-score עם אישור בלימה (Hook) ורצועות בולינגר.',
    warmup: 100,
    space: { period: int(14, 50), z: flt(1.2, 2.8), atrStop: flt(1.0, 3.0), rr: flt(1.2, 3.2) },
    positions(candles, p) {
      const closes = candles.map((c) => c.c);
      const z = ind.zscore(closes, Math.round(p.period));
      const bb = ind.bollinger(closes, Math.round(p.period), 2);
      const out = new Array(closes.length).fill(0);
      let st = 0;
      for (let i = 2; i < closes.length; i++) {
        const zi = z[i];
        const zp = z[i - 1];
        const c = closes[i];
        const mid = bb.mid ? bb.mid[i] : null;
        if (zi == null || zp == null || mid == null) { out[i] = st; continue; }
        if (st === 0) {
          if (zp <= -Number(p.z) && zi > zp && c < mid) st = 1;
          else if (zp >= Number(p.z) && zi < zp && c > mid) st = -1;
        } else if (st === 1 && zi >= 0) st = 0;
        else if (st === -1 && zi <= 0) st = 0;
        out[i] = st;
      }
      return out;
    },
  },

  vol_breakout: {
    label: 'פריצת תנודתיות (ATR/ER)',
    blurb: 'פריצה מטווח דינמי מבוסס ATR עם Efficiency Ratio לסינון מגמות איכותיות.',
    warmup: 100,
    space: { emaP: int(14, 40), atrP: int(10, 20), mult: flt(1.0, 3.0), erP: int(8, 20), erMin: flt(0.2, 0.55), atrStop: flt(1.2, 3.5), rr: flt(1.5, 4.2) },
    positions(candles, p) {
      const closes = candles.map((c) => c.c);
      const e = ind.ema(closes, Math.round(p.emaP));
      const a = ind.atr(candles, Math.round(p.atrP));
      const er = ind.efficiencyRatio(closes, Math.round(p.erP));
      const out = new Array(closes.length).fill(0);
      let st = 0;
      for (let i = 1; i < closes.length; i++) {
        if (e[i] == null || a[i] == null) { out[i] = st; continue; }
        const up = e[i] + Number(p.mult) * a[i];
        const dn = e[i] - Number(p.mult) * a[i];
        const eff = er[i] == null ? 1 : er[i];
        if (st === 0) {
          if (closes[i] > up && eff >= Number(p.erMin)) st = 1;
          else if (closes[i] < dn && eff >= Number(p.erMin)) st = -1;
        } else if (st === 1 && closes[i] < e[i]) st = 0;
        else if (st === -1 && closes[i] > e[i]) st = 0;
        out[i] = st;
      }
      return out;
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
      const label = { fast: 'מהיר', slow: 'איטי', atrStop: 'סטופ ATR', rr: 'יעד R:R', period: 'תקופה', oversold: 'קניית יתר', overbought: 'מכירת יתר', threshold: 'סף %', trendFilter: 'פילטר מגמה', filter: 'פילטר', signal: 'סיגנל', lookback: 'מבט לאחור', stepDiv: 'חלוקת צעד גאן', cycle: 'מחזור זמן', mom: 'מומנטום', emaFast: 'EMA מהיר', emaSlow: 'EMA איטי', mult: 'מכפיל', adxPeriod: 'תקופת ADX', adxMin: 'ADX מינ׳', z: 'Z-score', emaP: 'תקופת EMA', atrP: 'תקופת ATR', erP: 'תקופת ER', erMin: 'ER מינ׳' }[k] || k;
      return `${label}=${typeof v === 'boolean' ? (v ? 'כן' : 'לא') : v}`;
    })
    .join(' · ') || (s ? 'ברירת מחדל' : '—');
}
