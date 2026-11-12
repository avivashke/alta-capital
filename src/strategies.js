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
  gann_swing_sq9: {
    label: 'גאן רמות מחיר (Square of 9)',
    blurb: 'מסחר סביב רמות תמיכה/התנגדות בסגנון גאן Square-of-9 עם אישור כיוון וניהול סיכון ATR.',
    warmup: 140,
    space: { lookback: int(20, 90), stepDiv: int(4, 16), atrStop: flt(1.0, 3.5), rr: flt(1.2, 3.8) },
    positions(candles, p) {
      const closes = candles.map(c=>c.c);
      const out = new Array(closes.length).fill(0);
      const lb = Math.round(p.lookback);
      for(let i=lb+2;i<closes.length;i++){
        let hh=-Infinity,ll=Infinity;
        for(let j=i-lb;j<i;j++){ hh=Math.max(hh,candles[j].h); ll=Math.min(ll,candles[j].l); }
        const pivot=(hh+ll+closes[i-1]+closes[i])/4;
        const root=Math.sqrt(Math.max(pivot,1e-9));
        const sd=Math.max(4,Math.round(p.stepDiv));
        const up1=Math.pow(root+1/sd,2), dn1=Math.pow(Math.max(root-1/sd,0.05),2);
        const c=closes[i], prev=closes[i-1];
        if(prev <= up1 && c > up1) out[i]=1;
        else if(prev >= dn1 && c < dn1) out[i]=-1;
        else out[i]=out[i-1];
        if(out[i]===1 && c < pivot) out[i]=0;
        if(out[i]===-1 && c > pivot) out[i]=0;
      }
      return out;
    }
  },
  gann_time_cycle: {
    label: 'גאן מחזורי זמן ומומנטום',
    blurb: 'חלונות זמן מחזוריים (סגנון גאן/לוח שנה מסחרי) בשילוב מגמה ומומנטום.',
    warmup: 240,
    space: { cycle: int(21, 144), mom: int(5, 34), emaFast: int(8, 34), emaSlow: int(34, 130), atrStop: flt(1.0, 3.5), rr: flt(1.2, 4.0) },
    positions(candles, p) {
      const closes = candles.map(c=>c.c);
      const ef = ind.ema(closes, Math.round(p.emaFast));
      const es = ind.ema(closes, Math.round(p.emaSlow));
      const rocArr = ind.roc(closes, Math.round(p.mom));
      const cycle = Math.max(10, Math.round(p.cycle));
      const out = new Array(closes.length).fill(0);
      for(let i=2;i<closes.length;i++){
        const phase = (i % cycle) / cycle;
        const inWindow = phase < 0.2 || phase > 0.8;
        const trendUp = ef[i]!=null && es[i]!=null && ef[i] > es[i];
        const trendDn = ef[i]!=null && es[i]!=null && ef[i] < es[i];
        const m = rocArr[i];
        if(inWindow){
          if(trendUp && m!=null && m>0) out[i]=1;
          else if(trendDn && m!=null && m<0) out[i]=-1;
          else out[i]=out[i-1];
        } else {
          out[i]=out[i-1];
          if(out[i]===1 && trendDn && m!=null && m<0) out[i]=0;
          if(out[i]===-1 && trendUp && m!=null && m>0) out[i]=0;
        }
      }
      return out;
    }
  },
  supertrend_adx: {
    label: 'Supertrend + ADX',
    blurb: 'מעקב מגמה עם Supertrend וסינון חוזק מגמה ב-ADX.',
    warmup: 140,
    space: { period: int(7, 21), mult: flt(1.5, 4.5), adxPeriod: int(10, 20), adxMin: int(15, 35), atrStop: flt(1.0, 3.5), rr: flt(1.2, 3.8) },
    positions(candles, p) {
      const st = ind.supertrend(candles, Math.round(p.period), Number(p.mult));
      const adxArr = ind.adx(candles, Math.round(p.adxPeriod));
      return candles.map((_,i)=>{
        const d = st.dir[i]; const a = adxArr[i];
        if(!d || a==null || a < Number(p.adxMin)) return 0;
        return d>0?1:-1;
      });
    }
  },
  mean_reversion_z: {
    label: 'Mean Reversion (Z-Score)',
    blurb: 'חזרה לממוצע כמותית באמצעות סטיות Z-score ורצועות בולינגר.',
    warmup: 120,
    space: { period: int(14, 50), z: flt(1.2, 3.0), atrStop: flt(0.8, 3.0), rr: flt(1.0, 3.2) },
    positions(candles, p) {
      const closes = candles.map(c=>c.c);
      const z = ind.zscore(closes, Math.round(p.period));
      const bb = ind.bollinger(closes, Math.round(p.period), 2);
      const out = new Array(closes.length).fill(0);
      let st=0;
      for(let i=1;i<closes.length;i++){
        const zi=z[i], c=closes[i], mid=bb.mid?bb.mid[i]:null;
        if(zi==null||mid==null){ out[i]=st; continue; }
        if(st===0){ if(zi <= -Number(p.z) && c < mid) st=1; else if(zi >= Number(p.z) && c > mid) st=-1; }
        else if(st===1 && zi >= -0.15) st=0;
        else if(st===-1 && zi <= 0.15) st=0;
        out[i]=st;
      }
      return out;
    }
  },
  vol_breakout: {
    label: 'פריצת תנודתיות (ATR/ER)',
    blurb: 'פריצה מטווח דינמי מבוסס ATR עם Efficiency Ratio לסינון מגמות איכותיות.',
    warmup: 120,
    space: { emaP: int(14, 40), atrP: int(10, 20), mult: flt(1.0, 3.0), erP: int(8, 20), erMin: flt(0.2, 0.6), atrStop: flt(1.0, 3.5), rr: flt(1.2, 4.0) },
    positions(candles, p) {
      const closes=candles.map(c=>c.c);
      const e=ind.ema(closes, Math.round(p.emaP));
      const a=ind.atr(candles, Math.round(p.atrP));
      const er=ind.efficiencyRatio(closes, Math.round(p.erP));
      const out=new Array(closes.length).fill(0); let st=0;
      for(let i=1;i<closes.length;i++){
        if(e[i]==null||a[i]==null) { out[i]=st; continue; }
        const up=e[i]+Number(p.mult)*a[i], dn=e[i]-Number(p.mult)*a[i];
        const eff = er[i]==null?1:er[i];
        if(st===0){
          if(closes[i]>up && eff>=Number(p.erMin)) st=1;
          else if(closes[i]<dn && eff>=Number(p.erMin)) st=-1;
        } else if(st===1 && closes[i]<e[i]) st=0;
        else if(st===-1 && closes[i]>e[i]) st=0;
        out[i]=st;
      }
      return out;
    }
  }
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
