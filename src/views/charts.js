// TradingView-Grade Professional Charting & Analysis Workstation (#/charts)
// Includes full interactive candlestick/Heikin-Ashi/Line chart, one-click "Clear Chart",
// dynamic Indicator Engine (EMA, SMA, VWAP, Bollinger, SuperTrend, Donchian),
// Analysis & Drawing Tools (Fibonacci Retracement & Golden Pocket, Gann Fan, Risk/Reward Box,
// Order Blocks / SMC FVG, Trendlines, Custom S/R Lines), Sub-Chart Oscillators (RSI, MACD, Stoch, ATR),
// and a comprehensive interactive educational guide on Fibonacci, Gann, and proven trading tools!

import { mount, h, num, pct, notice, tag, openModal, closeModal, toast } from '../ui.js';
import { store } from '../store.js';
import { marketState, getCandles, lastPrice, quotes, ASSET_CATALOG } from '../market.js';
import { ema, sma, rsi, macd, donchian, bollinger, atr, supertrend, vwap, stochastic } from '../indicators.js';
import { createChartWorkspace } from '../chart_workspace/workspace.js';

const MAX_BARS = 180;
const BAR_W = 11;
const BAR_GAP = 3;

let chartState = {
  key: null,
  loading: false,
  error: null,
  candles: null,
  symbol: 'BTCUSDT',
  tf: '1h',
  engineMode: 'lw', // 'lw' (Lightweight Charts 60fps canvas) | 'classic'
  chartType: 'candles', // 'candles' | 'heikin' | 'line' | 'area'
  // Indicator Overlay Toggles
  indicators: {
    ema20: true,
    ema50: true,
    ema200: true,
    sma50: false,
    vwap: false,
    bollinger: true,
    donchian: false,
    supertrend: false,
    gannLevels: false,
    gannFan: false,
    orderBlocks: false,
    volume: true,
  },
  // Sub-chart Oscillators
  oscillators: {
    rsi: true,
    macd: true,
    stoch: false,
    atr: false,
  },
  // Drawing & Analysis Tools
  tools: {
    fibonacci: false,
    riskReward: false,
    trendlines: false,
  },
  // Custom user-drawn horizontal support/resistance lines: [{ id, price, label, color }]
  customLines: [],
  // Hovered bar index for crosshair & dynamic HUD
  hoverIdx: null,
};

function safe(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

function last(arr) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null && Number.isFinite(arr[i])) return arr[i];
  }
  return null;
}

function fmtPriceSmart(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) < 1) return n.toFixed(4);
  if (Math.abs(n) < 10) return n.toFixed(3);
  if (Math.abs(n) < 1000) return n.toFixed(2);
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function loadCandles(ui, symbol, tf) {
  const key = `${symbol}|${tf}`;
  if (chartState.loading && chartState.key === key) return;
  chartState.key = key;
  chartState.loading = true;
  chartState.error = null;
  chartState.symbol = symbol;
  chartState.tf = tf;
  ui.rerender();

  try {
    const raw = await getCandles(symbol, tf, { limit: MAX_BARS, force: false });
    if (!Array.isArray(raw) || !raw.length) throw new Error('לא התקבלו נרות שוק');
    chartState.candles = raw;
    chartState.loading = false;
  } catch (err) {
    chartState.error = err?.message || String(err);
    chartState.loading = false;
  }
  ui.rerender();
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) el.setAttribute(k, String(v));
  }
  return el;
}

function xAt(i) {
  return 52 + i * (BAR_W + BAR_GAP) + BAR_W / 2;
}

function yScale(val, minV, maxV, pad, height) {
  const r = (maxV - minV) || 1;
  return pad + ((maxV - val) / r) * (height - pad * 2);
}

function drawGrid(svg, width, height, minV, maxV, pad = 20) {
  const ticks = 6;
  for (let i = 0; i < ticks; i++) {
    const v = minV + (maxV - minV) * (i / (ticks - 1 || 1));
    const y = yScale(v, minV, maxV, pad, height);
    svg.appendChild(svgEl('line', {
      x1: 46, x2: width, y1: y, y2: y,
      stroke: 'rgba(30, 41, 59, 0.45)', 'stroke-width': 1, 'stroke-dasharray': '3,3',
    }));
    const t = svgEl('text', {
      x: 6, y: y + 4, fill: '#64748b', 'font-size': '10', 'font-family': 'IBM Plex Mono, monospace',
    });
    t.textContent = fmtPriceSmart(v);
    svg.appendChild(t);
  }
}

function polyline(svg, arr, start, show, minV, maxV, pad, height, color, width = 1.8, dash = null) {
  const pts = [];
  for (let i = 0; i < show; i++) {
    const v = arr[start + i];
    if (v == null || !Number.isFinite(v)) continue;
    pts.push(`${xAt(i).toFixed(1)},${yScale(v, minV, maxV, pad, height).toFixed(1)}`);
  }
  if (pts.length > 1) {
    const p = svgEl('polyline', {
      points: pts.join(' '), fill: 'none', stroke: color, 'stroke-width': width,
    });
    if (dash) p.setAttribute('stroke-dasharray', dash);
    svg.appendChild(p);
  }
}

function computeHeikinAshi(candles) {
  if (!candles?.length) return [];
  const ha = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const prev = ha[i - 1];
    const haClose = (c.o + c.h + c.l + c.c) / 4;
    const haOpen = prev ? (prev.o + prev.c) / 2 : (c.o + c.c) / 2;
    const haHigh = Math.max(c.h, haOpen, haClose);
    const haLow = Math.min(c.l, haOpen, haClose);
    ha.push({ ...c, o: haOpen, h: haHigh, l: haLow, c: haClose });
  }
  return ha;
}

function findSwingExtremes(candles, lookback = 45) {
  const n = candles.length;
  const start = Math.max(0, n - lookback);
  const slice = candles.slice(start);
  let maxIdx = 0, minIdx = 0;
  for (let i = 0; i < slice.length; i++) {
    if (slice[i].h > slice[maxIdx].h) maxIdx = i;
    if (slice[i].l < slice[minIdx].l) minIdx = i;
  }
  const isUptrend = minIdx < maxIdx;
  return {
    high: slice[maxIdx].h,
    highIdx: start + maxIdx,
    low: slice[minIdx].l,
    lowIdx: start + minIdx,
    isUptrend,
    range: Math.max(1e-6, slice[maxIdx].h - slice[minIdx].l),
  };
}

function computeFibonacciLevels(swingHigh, swingLow, isUptrend = true) {
  const range = Math.max(1e-6, swingHigh - swingLow);
  const defs = [
    { ratio: 0.0, label: '0.0% (שיא)', color: '#94a3b8' },
    { ratio: 0.236, label: '23.6%', color: '#f43f5e' },
    { ratio: 0.382, label: '38.2%', color: '#f59e0b' },
    { ratio: 0.50, label: '50.0% (איזון)', color: '#10b981' },
    { ratio: 0.618, label: '61.8% (Golden Ratio)', color: '#fbbf24', isGolden: true },
    { ratio: 0.65, label: '65.0% (Golden Pocket)', color: '#eab308', isGolden: true },
    { ratio: 0.786, label: '78.6% (הגנה אחרונה)', color: '#818cf8' },
    { ratio: 1.0, label: '100.0% (שפל)', color: '#94a3b8' },
    { ratio: 1.618, label: '161.8% (הרחבה Target)', color: '#38bdf8' },
  ];

  return defs.map((d) => {
    const p = d.ratio === 1.618
      ? (isUptrend ? swingHigh + 0.618 * range : swingLow - 0.618 * range)
      : (isUptrend ? swingHigh - d.ratio * range : swingLow + d.ratio * range);
    return { ...d, price: +p.toFixed(4) };
  });
}

function detectOrderBlocksAndFvgs(candles, count = 3) {
  const fvgs = [];
  const orderBlocks = [];
  const n = candles.length;
  for (let i = n - 2; i >= Math.max(2, n - 45); i--) {
    const prev2 = candles[i - 2];
    const curr = candles[i];
    if (curr.l > prev2.h) {
      fvgs.push({ type: 'bullish', top: curr.l, bottom: prev2.h, barIdx: i - 1 });
      if (fvgs.length >= count) break;
    } else if (curr.h < prev2.l) {
      fvgs.push({ type: 'bearish', top: prev2.l, bottom: curr.h, barIdx: i - 1 });
      if (fvgs.length >= count) break;
    }
  }

  for (let i = n - 3; i >= Math.max(3, n - 55); i--) {
    const body = Math.abs(candles[i].c - candles[i].o);
    const avgBody = (Math.abs(candles[i - 1].c - candles[i - 1].o) + Math.abs(candles[i - 2].c - candles[i - 2].o)) / 2;
    if (body > avgBody * 1.8) {
      const ob = candles[i - 1];
      const isBull = candles[i].c > candles[i].o;
      orderBlocks.push({
        type: isBull ? 'bullish' : 'bearish',
        top: Math.max(ob.o, ob.c),
        bottom: Math.min(ob.o, ob.c),
        barIdx: i - 1,
      });
      if (orderBlocks.length >= count) break;
    }
  }
  return { fvgs, orderBlocks };
}

function gannVibrationPrice(anchor, degree, direction = 1) {
  const root = Math.sqrt(Math.max(anchor, 1e-9));
  const val = root + (degree / 180) * direction;
  return val > 0 ? Math.pow(val, 2) : 0;
}

function gannLevels(anchor, currentPrice) {
  const degrees = [45, 90, 135, 180, 225, 270, 315, 360];
  const levels = [];
  for (const deg of degrees) {
    const isCardinal = deg % 90 === 0;
    const up = gannVibrationPrice(anchor, deg, 1);
    const dn = gannVibrationPrice(anchor, deg, -1);
    if (up > 0 && Math.abs(up - currentPrice) / currentPrice < 0.4) {
      levels.push({ degree: deg, v: up, isCardinal, dir: 1 });
    }
    if (dn > 0 && Math.abs(dn - currentPrice) / currentPrice < 0.4) {
      levels.push({ degree: -deg, v: dn, isCardinal, dir: -1 });
    }
  }
  return levels;
}

function clearChart(ui) {
  // Clear all indicator overlays and tools back to a pristine, clean candlestick chart
  chartState.indicators = {
    ema20: false,
    ema50: false,
    ema200: false,
    sma50: false,
    vwap: false,
    bollinger: false,
    donchian: false,
    supertrend: false,
    gannLevels: false,
    gannFan: false,
    orderBlocks: false,
    volume: true,
  };
  chartState.tools = {
    fibonacci: false,
    riskReward: false,
    trendlines: false,
  };
  chartState.customLines = [];
  ui.rerender();
  toast('🧹 הגרף נוקה בהצלחה (תצוגת נרות נקייה)', 'ok');
}

function resetDefaultSetup(ui) {
  chartState.chartType = 'candles';
  chartState.indicators = {
    ema20: true,
    ema50: true,
    ema200: true,
    sma50: false,
    vwap: false,
    bollinger: true,
    donchian: false,
    supertrend: false,
    gannLevels: false,
    gannFan: false,
    orderBlocks: false,
    volume: true,
  };
  chartState.tools = {
    fibonacci: false,
    riskReward: false,
    trendlines: false,
  };
  chartState.oscillators = {
    rsi: true,
    macd: true,
    stoch: false,
    atr: false,
  };
  ui.rerender();
  toast('🔄 שוחזרה תצורת מסחר מקצועית (EMA + בולינגר + RSI/MACD)', 'ok');
}

function clearDrawingsOnly(ui) {
  chartState.tools = {
    fibonacci: false,
    riskReward: false,
    trendlines: false,
  };
  chartState.customLines = [];
  ui.rerender();
  toast('🗑️ כל הסימונים והקווים נוקו מהגרף', 'ok');
}

function renderMainTradingViewSvg(candles, ui) {
  const n = candles.length;
  const show = Math.min(n, MAX_BARS);
  const start = n - show;

  // Active candlestick data (normal or Heikin-Ashi)
  const isHeikin = chartState.chartType === 'heikin';
  const displayCandles = isHeikin ? computeHeikinAshi(candles) : candles;
  const slice = displayCandles.slice(start);
  const rawSlice = candles.slice(start);

  const highs = slice.map((c) => c.h);
  const lows = slice.map((c) => c.l);
  const opens = slice.map((c) => c.o);
  const closes = slice.map((c) => c.c);
  const rawCloses = rawSlice.map((c) => c.c);

  const curPrice = rawCloses[rawCloses.length - 1] || 1;
  const extremes = findSwingExtremes(rawSlice, 50);

  // Indicators math
  const e20 = ema(rawCloses, 20);
  const e50 = ema(rawCloses, 50);
  const e200 = ema(rawCloses, 200);
  const s50 = sma(rawCloses, 50);
  const bb = bollinger(rawCloses, 20, 2);
  const don = donchian(rawSlice, 20);
  const st = supertrend(rawSlice, 10, 3);
  const vw = vwap(rawSlice);
  const smc = detectOrderBlocksAndFvgs(rawSlice, 3);

  // Fibonacci levels
  const fibLevels = computeFibonacciLevels(extremes.high, extremes.low, extremes.isUptrend);

  // Gann levels from swing low
  const gLevels = gannLevels(extremes.low, curPrice);

  // Dynamic price range calculation
  let allPricePoints = [...highs, ...lows];
  if (chartState.tools.fibonacci) {
    allPricePoints.push(...fibLevels.map((f) => f.price));
  }
  if (chartState.customLines?.length) {
    allPricePoints.push(...chartState.customLines.map((l) => l.price));
  }
  const maxV = Math.max(...allPricePoints);
  const minV = Math.min(...allPricePoints);

  const pad = 24;
  const height = 420;
  const width = 64 + show * (BAR_W + BAR_GAP);

  const svg = svgEl('svg', {
    width, height, viewBox: `0 0 ${width} ${height}`,
  });
  svg.style.display = 'block';
  svg.style.background = 'linear-gradient(180deg, #070d18 0%, #0a1324 100%)';
  svg.style.cursor = 'crosshair';

  drawGrid(svg, width, height, minV, maxV, pad);

  // 1. Shaded Channels: Bollinger Bands & Donchian
  if (chartState.indicators.bollinger && bb.upper && bb.lower) {
    const upPts = [];
    const loPts = [];
    for (let i = 0; i < show; i++) {
      const u = bb.upper[i];
      const l = bb.lower[i];
      if (u != null && l != null) {
        upPts.push(`${xAt(i).toFixed(1)},${yScale(u, minV, maxV, pad, height).toFixed(1)}`);
        loPts.unshift(`${xAt(i).toFixed(1)},${yScale(l, minV, maxV, pad, height).toFixed(1)}`);
      }
    }
    if (upPts.length > 1) {
      svg.appendChild(svgEl('polygon', {
        points: `${upPts.join(' ')} ${loPts.join(' ')}`,
        fill: 'rgba(56, 189, 248, 0.06)',
      }));
    }
    polyline(svg, bb.upper, 0, show, minV, maxV, pad, height, 'rgba(56, 189, 248, 0.4)', 1.1, '3,3');
    polyline(svg, bb.mid, 0, show, minV, maxV, pad, height, 'rgba(56, 189, 248, 0.55)', 1.2, null);
    polyline(svg, bb.lower, 0, show, minV, maxV, pad, height, 'rgba(56, 189, 248, 0.4)', 1.1, '3,3');
  }

  if (chartState.indicators.donchian && don.upper && don.lower) {
    polyline(svg, don.upper, 0, show, minV, maxV, pad, height, 'rgba(168, 85, 247, 0.5)', 1.2, '4,4');
    polyline(svg, don.lower, 0, show, minV, maxV, pad, height, 'rgba(168, 85, 247, 0.5)', 1.2, '4,4');
  }

  // 2. Order Blocks & FVG (Smart Money Concepts)
  if (chartState.indicators.orderBlocks) {
    for (const ob of smc.orderBlocks) {
      const bx = xAt(ob.barIdx);
      const by1 = yScale(ob.top, minV, maxV, pad, height);
      const by2 = yScale(ob.bottom, minV, maxV, pad, height);
      const isBull = ob.type === 'bullish';
      svg.appendChild(svgEl('rect', {
        x: bx, y: Math.min(by1, by2), width: width - bx, height: Math.max(3, Math.abs(by2 - by1)),
        fill: isBull ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
        stroke: isBull ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)',
        'stroke-width': 1, 'stroke-dasharray': '2,2',
      }));
      const t = svgEl('text', {
        x: width - 110, y: Math.min(by1, by2) - 3,
        fill: isBull ? '#4ade80' : '#f87171', 'font-size': '9', 'font-weight': '700',
      });
      t.textContent = isBull ? 'Bullish OB' : 'Bearish OB';
      svg.appendChild(t);
    }
  }

  // 3. Fibonacci Retracement & Golden Pocket (61.8% - 65%)
  if (chartState.tools.fibonacci) {
    const f618 = fibLevels.find((f) => f.ratio === 0.618);
    const f650 = fibLevels.find((f) => f.ratio === 0.65);
    if (f618 && f650) {
      const y618 = yScale(f618.price, minV, maxV, pad, height);
      const y650 = yScale(f650.price, minV, maxV, pad, height);
      svg.appendChild(svgEl('rect', {
        x: 48, y: Math.min(y618, y650), width: width - 48, height: Math.max(2, Math.abs(y650 - y618)),
        fill: 'rgba(250, 204, 21, 0.18)', stroke: 'rgba(250, 204, 21, 0.65)', 'stroke-width': 1,
      }));
      const gt = svgEl('text', {
        x: width - 180, y: Math.min(y618, y650) - 4,
        fill: '#fde047', 'font-size': '10', 'font-weight': '800',
      });
      gt.textContent = '★ Golden Pocket (61.8% - 65%)';
      svg.appendChild(gt);
    }

    for (const fl of fibLevels) {
      const fy = yScale(fl.price, minV, maxV, pad, height);
      svg.appendChild(svgEl('line', {
        x1: 48, x2: width, y1: fy, y2: fy,
        stroke: fl.color, 'stroke-width': fl.isGolden ? 1.6 : 1,
        'stroke-dasharray': fl.ratio === 0 || fl.ratio === 1 ? '0' : '4,3',
      }));
      const t = svgEl('text', {
        x: 54, y: fy - 3, fill: fl.color, 'font-size': '9.5', 'font-weight': '700',
      });
      t.textContent = `${fl.label} — ${fmtPriceSmart(fl.price)}`;
      svg.appendChild(t);
    }
  }

  // 4. Gann Octaves / Square of 9 Levels
  if (chartState.indicators.gannLevels) {
    for (const gl of gLevels) {
      const gy = yScale(gl.v, minV, maxV, pad, height);
      svg.appendChild(svgEl('line', {
        x1: 48, x2: width, y1: gy, y2: gy,
        stroke: gl.isCardinal ? 'rgba(56, 189, 248, 0.8)' : 'rgba(192, 132, 252, 0.55)',
        'stroke-width': gl.isCardinal ? 1.5 : 1,
        'stroke-dasharray': gl.isCardinal ? '0' : '5,3',
      }));
      const t = svgEl('text', {
        x: width - 140, y: gy - 3,
        fill: gl.isCardinal ? '#7dd3fc' : '#c084fc', 'font-size': '9.5',
      });
      t.textContent = `Sq9 ${gl.degree}° (${fmtPriceSmart(gl.v)})`;
      svg.appendChild(t);
    }
  }

  // 5. Gann Fan (9 Angles) from recent swing low
  if (chartState.indicators.gannFan || chartState.tools.gannFan) {
    const ax = xAt(Math.max(0, extremes.lowIdx - start));
    const ay = yScale(extremes.low, minV, maxV, pad, height);
    const angles = [82.5, 75, 71.25, 63.75, 45, 26.25, 18.75, 15, 7.5];
    const angleLabels = ['8x1', '4x1', '3x1', '2x1', '1x1', '1x2', '1x3', '1x4', '1x8'];
    angles.forEach((deg, idx) => {
      const is1x1 = idx === 4;
      const rad = (deg * Math.PI) / 180;
      const dx = width - ax;
      const dy = Math.tan(rad) * dx * 0.12;
      const y2 = Math.max(pad, Math.min(height - pad, ay - dy));
      svg.appendChild(svgEl('line', {
        x1: ax, y1: ay, x2: width, y2,
        stroke: is1x1 ? '#2ecc71' : 'rgba(242, 204, 96, 0.45)',
        'stroke-width': is1x1 ? 2.0 : 1.0,
        'stroke-dasharray': is1x1 ? '0' : '4,3',
      }));
      const lbl = svgEl('text', {
        x: width - 36, y: y2 - 3,
        fill: is1x1 ? '#4ade80' : '#facc15', 'font-size': '9', 'font-weight': is1x1 ? '800' : '600',
      });
      lbl.textContent = angleLabels[idx];
      svg.appendChild(lbl);
    });
    svg.appendChild(svgEl('circle', {
      cx: ax, cy: ay, r: 5, fill: '#facc15', stroke: '#070d18', 'stroke-width': 1.5,
    }));
  }

  // 6. Trendlines (High-to-High & Low-to-Low)
  if (chartState.tools.trendlines && show >= 10) {
    const hx = xAt(Math.max(0, extremes.highIdx - start));
    const hy = yScale(extremes.high, minV, maxV, pad, height);
    const lx = xAt(Math.max(0, extremes.lowIdx - start));
    const ly = yScale(extremes.low, minV, maxV, pad, height);
    svg.appendChild(svgEl('line', {
      x1: lx, y1: ly, x2: width, y2: ly - (extremes.isUptrend ? 40 : -40),
      stroke: '#34d399', 'stroke-width': 1.8, 'stroke-dasharray': '5,3',
    }));
    svg.appendChild(svgEl('line', {
      x1: hx, y1: hy, x2: width, y2: hy + (extremes.isUptrend ? -40 : 40),
      stroke: '#f87171', 'stroke-width': 1.8, 'stroke-dasharray': '5,3',
    }));
  }

  // 7. Risk / Reward Simulation Box (TradingView Style)
  if (chartState.tools.riskReward) {
    const entryY = yScale(curPrice, minV, maxV, pad, height);
    const tpPrice = curPrice * 1.045;
    const slPrice = curPrice * 0.982;
    const tpY = yScale(tpPrice, minV, maxV, pad, height);
    const slY = yScale(slPrice, minV, maxV, pad, height);
    const boxX = width - 170;
    const boxW = 160;

    // Green Profit Zone
    svg.appendChild(svgEl('rect', {
      x: boxX, y: tpY, width: boxW, height: Math.max(3, entryY - tpY),
      fill: 'rgba(34, 197, 94, 0.22)', stroke: '#22c55e', 'stroke-width': 1.2,
    }));
    // Red Risk Zone
    svg.appendChild(svgEl('rect', {
      x: boxX, y: entryY, width: boxW, height: Math.max(3, slY - entryY),
      fill: 'rgba(239, 68, 68, 0.22)', stroke: '#ef4444', 'stroke-width': 1.2,
    }));
    // Entry separator line
    svg.appendChild(svgEl('line', {
      x1: boxX, x2: boxX + boxW, y1: entryY, y2: entryY,
      stroke: '#ffffff', 'stroke-width': 1.6,
    }));

    const rrText = svgEl('text', {
      x: boxX + 6, y: entryY - 6, fill: '#ffffff', 'font-size': '10', 'font-weight': '800',
    });
    rrText.textContent = `🎯 R:R = 1:2.50 (רווח: +4.5% / סיכון: -1.8%)`;
    svg.appendChild(rrText);
  }

  // 8. Custom User-Drawn Lines
  for (const cl of (chartState.customLines || [])) {
    const cy = yScale(cl.price, minV, maxV, pad, height);
    svg.appendChild(svgEl('line', {
      x1: 48, x2: width, y1: cy, y2: cy,
      stroke: cl.color || '#f59e0b', 'stroke-width': 1.6, 'stroke-dasharray': '4,3',
    }));
    const t = svgEl('text', {
      x: width - 110, y: cy - 4, fill: cl.color || '#f59e0b', 'font-size': '10', 'font-weight': '700',
    });
    t.textContent = `${cl.label}: ${fmtPriceSmart(cl.price)}`;
    svg.appendChild(t);
  }

  // 9. Moving Averages & Overlays
  if (chartState.indicators.ema20) {
    polyline(svg, e20, 0, show, minV, maxV, pad, height, '#38bdf8', 1.8, null);
  }
  if (chartState.indicators.ema50) {
    polyline(svg, e50, 0, show, minV, maxV, pad, height, '#a855f7', 1.8, null);
  }
  if (chartState.indicators.ema200) {
    polyline(svg, e200, 0, show, minV, maxV, pad, height, '#facc15', 1.5, '5,3');
  }
  if (chartState.indicators.sma50) {
    polyline(svg, s50, 0, show, minV, maxV, pad, height, '#fb923c', 1.6, '3,3');
  }
  if (chartState.indicators.vwap) {
    polyline(svg, vw, 0, show, minV, maxV, pad, height, '#ec4899', 1.8, '6,2');
  }
  if (chartState.indicators.supertrend && st.line) {
    for (let i = 1; i < show; i++) {
      const v1 = st.line[i - 1];
      const v2 = st.line[i];
      const d = st.dir[i];
      if (v1 != null && v2 != null) {
        svg.appendChild(svgEl('line', {
          x1: xAt(i - 1), y1: yScale(v1, minV, maxV, pad, height),
          x2: xAt(i), y2: yScale(v2, minV, maxV, pad, height),
          stroke: d === 1 ? '#10b981' : '#f43f5e', 'stroke-width': 2.0,
        }));
      }
    }
  }

  // 10. Candlesticks / Line / Area
  if (chartState.chartType === 'line' || chartState.chartType === 'area') {
    const isArea = chartState.chartType === 'area';
    const pts = slice.map((c, i) => `${xAt(i).toFixed(1)},${yScale(c.c, minV, maxV, pad, height).toFixed(1)}`);
    if (isArea && pts.length > 1) {
      const basePoints = `${pts.join(' ')} ${xAt(show - 1)},${height - pad} ${xAt(0)},${height - pad}`;
      svg.appendChild(svgEl('polygon', {
        points: basePoints,
        fill: 'rgba(56, 189, 248, 0.15)',
      }));
    }
    polyline(svg, closes, 0, show, minV, maxV, pad, height, '#38bdf8', 2.2);
  } else {
    // Japanese Candlesticks or Heikin-Ashi
    for (let i = 0; i < show; i++) {
      const o = opens[i];
      const c = closes[i];
      const hi = highs[i];
      const lo = lows[i];
      const x = 52 + i * (BAR_W + BAR_GAP);
      const isUp = c >= o;
      const color = isUp ? '#22c55e' : '#ef4444';

      const yHi = yScale(hi, minV, maxV, pad, height);
      const yLo = yScale(lo, minV, maxV, pad, height);
      const yO = yScale(o, minV, maxV, pad, height);
      const yC = yScale(c, minV, maxV, pad, height);

      // Wick
      svg.appendChild(svgEl('line', {
        x1: x + BAR_W / 2, x2: x + BAR_W / 2, y1: yHi, y2: yLo,
        stroke: color, 'stroke-width': 1.2,
      }));

      // Body
      svg.appendChild(svgEl('rect', {
        x, y: Math.min(yO, yC),
        width: Math.max(2, BAR_W - 1),
        height: Math.max(1.5, Math.abs(yC - yO)),
        fill: color, rx: 1,
      }));
    }
  }

  // 11. Volume Bars at Base
  if (chartState.indicators.volume) {
    const vols = slice.map((c) => c.v || 0);
    const maxVol = Math.max(...vols, 1);
    const vBase = height - 4;
    const vMaxH = 55;
    for (let i = 0; i < show; i++) {
      const hBar = (vols[i] / maxVol) * vMaxH;
      const isUp = closes[i] >= opens[i];
      svg.appendChild(svgEl('rect', {
        x: 52 + i * (BAR_W + BAR_GAP),
        y: vBase - hBar,
        width: Math.max(2, BAR_W - 1),
        height: Math.max(1, hBar),
        fill: isUp ? 'rgba(34, 197, 94, 0.28)' : 'rgba(239, 68, 68, 0.28)',
      }));
    }
  }

  // 12. Interactive Pointer & Crosshair tracking Overlay
  const crossGroup = svgEl('g', { id: 'crosshair', style: 'display: none;' });
  const crossV = svgEl('line', {
    x1: 0, x2: 0, y1: pad, y2: height - pad,
    stroke: 'rgba(255, 255, 255, 0.4)', 'stroke-width': 1, 'stroke-dasharray': '3,3',
  });
  const crossH = svgEl('line', {
    x1: 48, x2: width, y1: 0, y2: 0,
    stroke: 'rgba(255, 255, 255, 0.4)', 'stroke-width': 1, 'stroke-dasharray': '3,3',
  });
  crossGroup.appendChild(crossV);
  crossGroup.appendChild(crossH);
  svg.appendChild(crossGroup);

  // Overlay rect to capture mouse clicks (add S/R line) and mousemove (crosshair)
  const hitRect = svgEl('rect', {
    x: 0, y: 0, width, height, fill: 'transparent',
  });

  hitRect.onmousemove = (e) => {
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    crossGroup.style.display = 'block';
    crossV.setAttribute('x1', mx);
    crossV.setAttribute('x2', mx);
    crossH.setAttribute('y1', my);
    crossH.setAttribute('y2', my);

    const bIdx = Math.max(0, Math.min(show - 1, Math.floor((mx - 52) / (BAR_W + BAR_GAP))));
    const c = slice[bIdx];
    if (c) {
      const hudEl = document.getElementById('tv-chart-hud');
      if (hudEl) {
        const chg = c.o > 0 ? (((c.c - c.o) / c.o) * 100).toFixed(2) : 0;
        const chgCol = chg >= 0 ? '#4ade80' : '#f87171';
        hudEl.innerHTML = `
          <span style="color:#94a3b8">${c.t ? new Date(c.t).toISOString().slice(0, 16).replace('T', ' ') : ''}</span>
          <span>O: <b>${fmtPriceSmart(c.o)}</b></span>
          <span>H: <b>${fmtPriceSmart(c.h)}</b></span>
          <span>L: <b>${fmtPriceSmart(c.l)}</b></span>
          <span>C: <b>${fmtPriceSmart(c.c)}</b></span>
          <span style="color:${chgCol}; font-weight:700">(${chg >= 0 ? '+' : ''}${chg}%)</span>
          ${c.v ? `<span>Vol: <b>${Number(c.v).toLocaleString()}</b></span>` : ''}
          ${e20[bIdx] ? `<span style="color:#38bdf8">EMA20: ${fmtPriceSmart(e20[bIdx])}</span>` : ''}
          ${vw[bIdx] ? `<span style="color:#ec4899">VWAP: ${fmtPriceSmart(vw[bIdx])}</span>` : ''}
        `;
      }
    }
  };

  hitRect.onmouseleave = () => {
    crossGroup.style.display = 'none';
  };

  hitRect.onclick = (e) => {
    const rect = svg.getBoundingClientRect();
    const my = e.clientY - rect.top;
    const clickedPrice = maxV - ((my - pad) / (height - pad * 2)) * (maxV - minV);
    if (clickedPrice > 0) {
      chartState.customLines.push({
        id: Date.now(),
        price: +clickedPrice.toFixed(4),
        label: 'קו אופקי',
        color: '#f59e0b',
      });
      ui.rerender();
      toast(`➕ נוסף קו אופקי ב-$${fmtPriceSmart(clickedPrice)}`, 'ok');
    }
  };

  svg.appendChild(hitRect);

  const wrapper = h('div', {
    class: 'chart-canvas',
    style: { width: '100%', overflowX: 'auto', overflowY: 'hidden', position: 'relative' },
  });
  wrapper.appendChild(svg);
  return wrapper;
}

function renderOscillatorSvg(candles, type = 'rsi') {
  const n = candles.length;
  const show = Math.min(n, MAX_BARS);
  const start = n - show;
  const rawCloses = candles.map((c) => c.c);

  const width = 64 + show * (BAR_W + BAR_GAP);
  const height = 150;
  const pad = 16;

  const svg = svgEl('svg', {
    width, height, viewBox: `0 0 ${width} ${height}`,
  });
  svg.style.display = 'block';
  svg.style.background = '#080f1e';

  if (type === 'rsi') {
    const vals = rsi(rawCloses, 14);
    drawGrid(svg, width, height, 0, 100, pad);
    [30, 50, 70].forEach((v) => {
      const y = yScale(v, 0, 100, pad, height);
      svg.appendChild(svgEl('line', {
        x1: 48, x2: width, y1: y, y2: y,
        stroke: v === 50 ? '#64748b' : 'rgba(239, 68, 68, 0.45)',
        'stroke-dasharray': '4,4',
      }));
    });
    polyline(svg, vals, start, show, 0, 100, pad, height, '#38bdf8', 2.0);
  } else if (type === 'macd') {
    const m = macd(rawCloses);
    const hist = m.hist || [];
    const vals = [...hist, ...(m.line || []), ...(m.signal || [])].filter((v) => v != null && Number.isFinite(v));
    const maxV = Math.max(1e-4, ...vals.map((v) => Math.abs(v)));
    drawGrid(svg, width, height, -maxV, maxV, pad);
    const zy = yScale(0, -maxV, maxV, pad, height);
    svg.appendChild(svgEl('line', {
      x1: 48, x2: width, y1: zy, y2: zy, stroke: '#475569',
    }));
    for (let i = 0; i < show; i++) {
      const v = hist[start + i];
      if (v == null) continue;
      const x = 52 + i * (BAR_W + BAR_GAP);
      const y = yScale(v, -maxV, maxV, pad, height);
      svg.appendChild(svgEl('rect', {
        x, y: Math.min(y, zy), width: Math.max(2, BAR_W - 1), height: Math.max(1, Math.abs(zy - y)),
        fill: v >= 0 ? 'rgba(34, 197, 94, 0.65)' : 'rgba(239, 68, 68, 0.65)',
      }));
    }
    polyline(svg, m.line, start, show, -maxV, maxV, pad, height, '#38bdf8', 1.8);
    polyline(svg, m.signal, start, show, -maxV, maxV, pad, height, '#fbbf24', 1.8);
  } else if (type === 'stoch') {
    const st = stochastic(candles);
    drawGrid(svg, width, height, 0, 100, pad);
    [20, 80].forEach((v) => {
      const y = yScale(v, 0, 100, pad, height);
      svg.appendChild(svgEl('line', {
        x1: 48, x2: width, y1: y, y2: y, stroke: 'rgba(239, 68, 68, 0.45)', 'stroke-dasharray': '3,3',
      }));
    });
    polyline(svg, st.k, start, show, 0, 100, pad, height, '#38bdf8', 1.8);
    polyline(svg, st.d, start, show, 0, 100, pad, height, '#f59e0b', 1.8);
  } else if (type === 'atr') {
    const vals = atr(candles, 14);
    const maxV = Math.max(...vals.filter(Boolean), 1);
    drawGrid(svg, width, height, 0, maxV, pad);
    polyline(svg, vals, start, show, 0, maxV, pad, height, '#eab308', 2.0);
  }

  const wrapper = h('div', {
    class: 'chart-canvas',
    style: { width: '100%', overflowX: 'auto', overflowY: 'hidden' },
  });
  wrapper.appendChild(svg);
  return wrapper;
}

export function openIndicatorSelectorModal(ui) {
  const ind = chartState.indicators;
  const osc = chartState.oscillators;

  const content = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
    h('div', { class: 'small muted', text: 'בחר אילו אינדיקטורים וממוצעים נעים יוצגו על גבי הגרף הראשי ובתחתיתו:' }),

    h('div', { class: 'card', style: { background: 'rgba(12, 19, 32, 0.95)', padding: '12px' } },
      h('b', { style: { color: '#38bdf8', marginBottom: '8px', display: 'block' }, text: '📈 ממוצעים נעים ומגמה (Overlays)' }),
      h('div', { class: 'grid cols-2', style: { gap: '10px' } },
        createCheckboxItem('EMA 20 (קצר · מומנטום)', ind.ema20, (v) => { ind.ema20 = v; ui.rerender(); }),
        createCheckboxItem('EMA 50 (בינוני · מגמה)', ind.ema50, (v) => { ind.ema50 = v; ui.rerender(); }),
        createCheckboxItem('EMA 200 (ארוך · גבול שוורים/דובים)', ind.ema200, (v) => { ind.ema200 = v; ui.rerender(); }),
        createCheckboxItem('SMA 50 (ממוצע פשוט קלאסי)', ind.sma50, (v) => { ind.sma50 = v; ui.rerender(); }),
        createCheckboxItem('VWAP (מחיר משוקלל נפח מוסדי)', ind.vwap, (v) => { ind.vwap = v; ui.rerender(); }),
        createCheckboxItem('סופרטרנד (SuperTrend ATR)', ind.supertrend, (v) => { ind.supertrend = v; ui.rerender(); }),
      ),
    ),

    h('div', { class: 'card', style: { background: 'rgba(12, 19, 32, 0.95)', padding: '12px' } },
      h('b', { style: { color: '#facc15', marginBottom: '8px', display: 'block' }, text: '⚡ תנודתיות, גאן ומבנה שוק חכם' }),
      h('div', { class: 'grid cols-2', style: { gap: '10px' } },
        createCheckboxItem('רצועות בולינגר (20, 2)', ind.bollinger, (v) => { ind.bollinger = v; ui.rerender(); }),
        createCheckboxItem('ערוצי דונצ׳יאן (20)', ind.donchian, (v) => { ind.donchian = v; ui.rerender(); }),
        createCheckboxItem('מניפת גאן 9 זוויות (Gann Fan)', ind.gannFan, (v) => { ind.gannFan = v; ui.rerender(); }),
        createCheckboxItem('רמות Square of 9 (שמיניות גאן)', ind.gannLevels, (v) => { ind.gannLevels = v; ui.rerender(); }),
        createCheckboxItem('בלוקי פקודות (SMC Order Blocks & FVG)', ind.orderBlocks, (v) => { ind.orderBlocks = v; ui.rerender(); }),
        createCheckboxItem('עמודות נפח מסחר (Volume)', ind.volume, (v) => { ind.volume = v; ui.rerender(); }),
      ),
    ),

    h('div', { class: 'card', style: { background: 'rgba(12, 19, 32, 0.95)', padding: '12px' } },
      h('b', { style: { color: '#4ade80', marginBottom: '8px', display: 'block' }, text: '📊 מתנדים תחתונים (Sub-Chart Oscillators)' }),
      h('div', { class: 'grid cols-2', style: { gap: '10px' } },
        createCheckboxItem('RSI (14) מדד עוצמה יחסית', osc.rsi, (v) => { osc.rsi = v; ui.rerender(); }),
        createCheckboxItem('MACD (12, 26, 9) היסטוגרמה', osc.macd, (v) => { osc.macd = v; ui.rerender(); }),
        createCheckboxItem('סטוכסטיק (14, 3, 3)', osc.stoch, (v) => { osc.stoch = v; ui.rerender(); }),
        createCheckboxItem('ATR (14) תנודתיות', osc.atr, (v) => { osc.atr = v; ui.rerender(); }),
      ),
    ),

    h('div', { class: 'row between', style: { marginTop: '8px' } },
      h('button', { class: 'btn btn-sm btn-ghost red', onclick: () => { clearChart(ui); closeModal(); } }, '🧹 נקה את כל האינדיקטורים'),
      h('button', { class: 'btn btn-sm btn-primary', onclick: () => closeModal() }, 'סגור ועדכן גרף'),
    ),
  );

  openModal('📊 בחירת אינדיקטורים ורצועות מסחר', content);
}

function createCheckboxItem(label, checked, onChange) {
  const box = h('input', {
    type: 'checkbox',
    checked: !!checked,
    onchange: (e) => onChange(e.target.checked),
    style: { cursor: 'pointer' },
  });
  return h('label', {
    class: 'row',
    style: { gap: '8px', cursor: 'pointer', alignItems: 'center', fontSize: '13px' },
  }, box, h('span', { text: label }));
}

export function openAdvancedToolsGuideModal(candles, symbol, currentPrice) {
  let activeTab = 'fibonacci';
  const modalContainer = h('div', {});

  const renderTabs = () => {
    modalContainer.innerHTML = '';

    const tabsNav = h('div', { class: 'row wrap', style: { gap: '6px', marginBottom: '14px', borderBottom: '1px solid #1e293b', paddingBottom: '10px' } },
      [
        ['fibonacci', '🌀 סרגל פיבונאצ׳י וכיס הזהב (Golden Pocket)'],
        ['gann', '📐 כלי גאן, זווית 1x1 ו-Square of 9'],
        ['institutional', '🏛️ אינדיקטורים מוסדיים (VWAP, SuperTrend, בולינגר)'],
        ['smc', '⚡ מבנה שוק חכם (Order Blocks) ויחס סיכוי/סיכון (R:R)'],
        ['live', `📊 קריאה ומספרים חיים של ${symbol}`],
      ].map(([id, label]) => h('button', {
        class: `btn btn-sm ${activeTab === id ? 'btn-primary' : 'btn-ghost'}`,
        onclick: () => { activeTab = id; renderTabs(); },
      }, label)),
    );

    let body = null;
    if (activeTab === 'fibonacci') {
      body = h('div', { style: { lineHeight: '1.7', fontSize: '13.5px' } },
        h('h3', { style: { color: '#fbbf24', marginTop: '0' }, text: '🌀 סרגל פיבונאצ׳י: יחס הזהב וכיס הזהב (The Golden Pocket)' }),
        h('p', {}, 'סרגל פיבונאצ׳י (Fibonacci Retracement) הוא אחד הכלים הנפוצים והמוכחים ביותר בעולם המסחר המקצועי. הוא מבוסס על היחס ההרמוני בטבע (יחס הזהב 1.618 ו-0.618) שמנחה פסיכולוגיה של המוני סוחרים ואלגוריתמים מוסדיים.'),
        h('div', { class: 'grid cols-2', style: { gap: '10px', margin: '12px 0' } },
          h('div', { class: 'card', style: { background: 'rgba(15, 23, 42, 0.8)' } },
            h('b', { style: { color: '#facc15' }, text: 'רמות המפתח בסרגל:' }),
            h('ul', { style: { paddingRight: '18px', margin: '6px 0' } },
              h('li', {}, '23.6% / 38.2%: תיקון שטחי במגמה מהירה מאוד.'),
              h('li', {}, '50.0%: חוק שיווי המשקל הקלאסי (איזון דאו וגאן).'),
              h('li', { style: { fontWeight: '700', color: '#fde047' } }, '61.8% עד 65.0% — The Golden Pocket: אזור ההיפוך הסטטיסטי הרווחי ביותר!'),
              h('li', {}, '78.6%: קו ההגנה האחרון (שבירה שלו מבטלת את המבנה).'),
              h('li', {}, '161.8% (Extension): יעד רווח מורחב לפריצה לשיא חדש.'),
            ),
          ),
          h('div', { class: 'card', style: { background: 'rgba(15, 23, 42, 0.8)' } },
            h('b', { style: { color: '#4ade80' }, text: 'איך סוחרים נכון עם פיבונאצ׳י?' }),
            h('ol', { style: { paddingRight: '18px', margin: '6px 0' } },
              h('li', {}, 'מותחים את הסרגל מהשפל המשמעותי (0%) לשיא המשמעותי (100%) במגמה עולה.'),
              h('li', {}, 'ממתינים בסבלנות לכניסת המחיר ל-Golden Pocket (61.8%–65%).'),
              h('li', {}, 'לעולם לא נכנסים "על עיוור": ממתינים לנר היפוך מאשר (Pinbar או נר עוטף ירוק).'),
              h('li', {}, 'מציבים סטופ-לוס קצר מעבר ל-78.6% או מתחת ל-100%.'),
            ),
          ),
        ),
      );
    } else if (activeTab === 'gann') {
      body = h('div', { style: { lineHeight: '1.7', fontSize: '13.5px' } },
        h('h3', { style: { color: '#38bdf8', marginTop: '0' }, text: '📐 כלי גאן: זווית האיזון 1x1, מניפת 9 הזוויות ו-Square of 9' }),
        h('p', {}, 'וו.ד. גאן (W.D. Gann) לימד ששווקים נעים לפי חוקיות מתמטית וגיאומטרית שמשלבת מחיר וזמן. הכלים שלו נחשבים לאבני יסוד בניתוח טכני מתקדם:'),
        h('div', { class: 'grid cols-2', style: { gap: '10px', margin: '12px 0' } },
          h('div', { class: 'card', style: { background: 'rgba(15, 23, 42, 0.8)' } },
            h('b', { style: { color: '#4ade80' }, text: 'זווית 1x1 (45°) — קו שיווי המשקל:' }),
            h('div', { class: 'small', text: 'קו המגמה החשוב ביותר. מייצג יחידת מחיר אחת ליחידת זמן אחת. כל עוד הנכס נסחר מעל 1x1 — המומנטום שורי מובהק; שבירה מתחת לקו מאותתת על מעבר לזווית 1x2 והאטת מגמה.' }),
          ),
          h('div', { class: 'card', style: { background: 'rgba(15, 23, 42, 0.8)' } },
            h('b', { style: { color: '#7dd3fc' }, text: 'Square of 9 והצלב הקרדינלי:' }),
            h('div', { class: 'small', text: 'רמות מחיר המבוססות על שורש המחיר (√P ± deg/180)². מעלות קרדינליות של 90°, 180°, 270°, 360° משמשות כיעדי בלימה מגנטיים שפועלים פעם אחר פעם.' }),
          ),
        ),
      );
    } else if (activeTab === 'institutional') {
      body = h('div', { style: { lineHeight: '1.7', fontSize: '13.5px' } },
        h('h3', { style: { color: '#4ade80', marginTop: '0' }, text: '🏛️ אינדיקטורים מוסדיים מוכחים: VWAP, SuperTrend ובולינגר' }),
        h('ul', { style: { paddingRight: '20px', display: 'grid', gap: '8px' } },
          h('li', {}, '🌊 VWAP (Volume Weighted Average Price): מדד המפתח של קרנות גידור ובנקים. מוסדות נמדדים על קנייה מתחת ל-VWAP ומכירה מעל. חזרה ל-VWAP במגמה עולה היא אזור כניסה אידיאלי.'),
          h('li', {}, '⚡ SuperTrend: אלגוריתם חכם מבוסס ATR לסינון רעשים. מאפשר לרכוב על מגמות עליות ארוכות בלי לצאת מוקדם בגלל תיקון תוך-יומי קל.'),
          h('li', {}, '📊 רצועות בולינגר: התכווצות (Squeeze) של הרצועות מעידה על צבירת אנרגיה לקראת תנועה חדה ואלימה.'),
          h('li', {}, '🎯 RSI Divergence: כשהמחיר יוצר שפל חדש אך ה-RSI יוצר שפל גבוה יותר — זהו איתות היפוך שורי בעל אמינות גבוהה.'),
        ),
      );
    } else if (activeTab === 'smc') {
      body = h('div', { style: { lineHeight: '1.7', fontSize: '13.5px' } },
        h('h3', { style: { color: '#f87171', marginTop: '0' }, text: '⚡ Smart Money Concepts (SMC) & יחס סיכוי/סיכון (R:R)' }),
        h('p', {}, 'מוסדות פיננסיים גדולים מותירים עקבות ברורים על הגרף. זיהוי נכון של עקבות אלו בשילוב יחס סיכוי/סיכון קפדני הוא ההבדל בין סוחר חובב למקצוען:'),
        h('div', { class: 'grid cols-2', style: { gap: '10px', margin: '12px 0' } },
          h('div', { class: 'card', style: { background: 'rgba(15, 23, 42, 0.8)' } },
            h('b', { style: { color: '#fbbf24' }, text: 'בלוקי פקודות (Order Blocks & FVG):' }),
            h('div', { class: 'small', text: 'נר אחרון בכיוון הנגדי לפני פריצה מתפרצת שמשאיר "פער שווי הוגן" (Fair Value Gap). השוק חוזר לבחון את הבלוק הזה, ושם בדיוק ממוקם הטריגר שלנו.' }),
          ),
          h('div', { class: 'card', style: { background: 'rgba(15, 23, 42, 0.8)' } },
            h('b', { style: { color: '#34d399' }, text: 'כלל הברזל: יחס סיכוי/סיכון 1:2 ומעלה:' }),
            h('div', { class: 'small', text: 'לעולם אל תיכנס לעסקה עם יחס של פחות מ-1:2. ביחס של 1:2.5, גם אם תצדק רק ב-40% מהטריידים שלך — עדיין תסיים ברווח משמעותי!' }),
          ),
        ),
      );
    } else {
      // Live numbers on active symbol
      const slice = candles.slice(-50);
      const extremes = findSwingExtremes(slice, 45);
      const fibs = computeFibonacciLevels(extremes.high, extremes.low, extremes.isUptrend);
      const v = vwap(slice);
      const curVwap = v[v.length - 1];
      const cur = currentPrice || slice[slice.length - 1]?.c || 0;

      body = h('div', { style: { lineHeight: '1.6', fontSize: '13px' } },
        h('h3', { style: { color: '#38bdf8', marginTop: '0' }, text: `📊 רמות אמת מחושבות כעת עבור ${symbol} (מחיר: $${fmtPriceSmart(cur)})` }),
        h('div', { class: 'notice ok', style: { marginBottom: '10px' } },
          `הגל האחרון נמדד משפל $${fmtPriceSmart(extremes.low)} לשיא $${fmtPriceSmart(extremes.high)} (מגמה: ${extremes.isUptrend ? 'עולה' : 'יורדת'}). להלן רמות הפיבונאצ׳י והעוגנים המוסדיים:`,
        ),
        h('div', { class: 'table-wrap', style: { maxHeight: '240px', overflowY: 'auto' } },
          h('table', {},
            h('thead', {}, h('tr', {},
              h('th', { text: 'רמה' }),
              h('th', { text: 'מחיר יעד' }),
              h('th', { text: 'מרחק ממחיר שוק' }),
              h('th', { text: 'משמעות' }),
            )),
            h('tbody', {},
              fibs.map((f) => {
                const dist = cur > 0 ? ((f.price - cur) / cur) * 100 : 0;
                return h('tr', {},
                  h('td', { style: { fontWeight: '700', color: f.color }, text: f.label }),
                  h('td', { class: 'mono', style: { fontWeight: '700' }, text: `$${fmtPriceSmart(f.price)}` }),
                  h('td', { class: 'mono ' + (dist >= 0 ? 'red' : 'green'), text: `${dist >= 0 ? '+' : ''}${dist.toFixed(2)}%` }),
                  h('td', {}, tag(f.isGolden ? '★ כיס הזהב' : f.ratio === 0.5 ? 'איזון 50%' : 'תמיכה/התנגדות', f.isGolden ? 'live' : 'opt')),
                );
              }),
              curVwap ? h('tr', {},
                h('td', { style: { fontWeight: '700', color: '#ec4899' }, text: 'VWAP מוסדי' }),
                h('td', { class: 'mono', style: { fontWeight: '700' }, text: `$${fmtPriceSmart(curVwap)}` }),
                h('td', { class: 'mono ' + (curVwap >= cur ? 'red' : 'green'), text: `${(((curVwap - cur) / cur) * 100).toFixed(2)}%` }),
                h('td', {}, tag('עוגן קרנות', 'live')),
              ) : null,
            ),
          ),
        ),
      );
    }

    modalContainer.appendChild(tabsNav);
    modalContainer.appendChild(body);
  };

  renderTabs();
  openModal('💡 מדריך כלי מסחר מתקדמים ומקצועיים (TradingView & Gann Tools Guide)', modalContainer, { wide: true });
}

function signalSummary(candles) {
  const closes = candles.map((c) => c.c);
  const r = last(rsi(closes, 14));
  const m = macd(closes);
  const mh = last(m.hist || []);
  const mLine = last(m.line || []);
  const mSig = last(m.signal || []);
  const e20 = last(ema(closes, 20));
  const e50 = last(ema(closes, 50));
  const e200 = last(ema(closes, 200));
  const bb = bollinger(closes, 20, 2);
  const bbUp = last(bb.upper || []);
  const bbLo = last(bb.lower || []);
  const atrVal = last(atr(candles, 14) || []);
  const p = closes[closes.length - 1];

  let score = 0;
  const notes = [];
  if (r != null) {
    if (r < 32) { score++; notes.push('RSI מכירת-יתר'); }
    else if (r > 68) { score--; notes.push('RSI קניית-יתר'); }
    else notes.push('RSI תקין');
  }
  if (mh != null) {
    if (mh > 0) { score++; notes.push('MACD חיובי'); }
    else { score--; notes.push('MACD שלילי'); }
  }
  if (e20 != null && e50 != null) {
    if (e20 > e50) { score++; notes.push('EMA20 מעל EMA50'); }
    else { score--; notes.push('EMA20 מתחת EMA50'); }
  }
  if (p != null && e20 != null) {
    if (p > e20) score++; else score--;
  }
  const bias = score >= 2 ? 'שורי' : score <= -2 ? 'דובי' : 'נייטרלי';
  return { bias, score, notes, r, mh, mLine, mSig, e20, e50, e200, bbUp, bbLo, atrVal, p };
}

export function renderCharts(root, ui) {
  const state = store.state;
  const deskId = ui.selectedDesk || (state.desks[0] && state.desks[0].id) || null;
  const desk = deskId ? state.desks.find((d) => d.id === deskId) : state.desks[0];
  const symbol = ui.customChartSymbol || (desk ? desk.symbol : 'BTCUSDT');
  const tf = ui.customChartTf || (desk ? desk.tf : '1h');
  const key = `${symbol}|${tf}`;

  if (chartState.key !== key && !chartState.loading) {
    setTimeout(() => loadCandles(ui, symbol, tf), 0);
  }

  const { loading, error, candles } = chartState.key === key
    ? chartState
    : { loading: !chartState.candles, error: null, candles: chartState.candles };

  const live = (quotes && quotes[symbol] && quotes[symbol].price)
    || (candles && candles.length ? candles[candles.length - 1].c : lastPrice(symbol));

  const quickAssets = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'NVDA', 'TSLA', 'SPY', 'GC=F'];

  // Top Page Header
  mount(root,
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: 'TradingView-Style Workstation · Advanced Analysis & Indicators' }),
        h('h1', { text: `גרפים ואינדיקטורים מקצועיים · ${symbol}` }),
        h('p', { text: 'תחנת מסחר אינטראקטיבית מלאה בסגנון TradingView: ניקוי גרף, סרגל פיבונאצ׳י, כלי גאן, אינדיקטורים מוסדיים ומדריך מעשי מקיף.' }),
      ),
      h('div', { class: 'head-actions', style: { flexWrap: 'wrap', gap: '6px' } },
        h('span', { class: marketState.synthetic ? 'pill pill-warn' : 'pill pill-sim', text: marketState.synthetic ? 'נתוני הדגמה' : `שוק חי · ${marketState.provider || 'Live'}` }),
        h('select', {
          class: 'input',
          style: { width: '135px' },
          value: symbol,
          onchange: (e) => {
            ui.customChartSymbol = e.target.value;
            chartState = { ...chartState, key: null, loading: false, error: null, candles: null };
            ui.rerender();
          },
        }, ASSET_CATALOG.map((a) => h('option', { value: a.symbol, selected: symbol === a.symbol }, a.label))),
        h('select', {
          class: 'input',
          style: { width: '85px' },
          value: tf,
          onchange: (e) => {
            ui.customChartTf = e.target.value;
            chartState = { ...chartState, key: null, loading: false, error: null, candles: null };
            ui.rerender();
          },
        }, ['5m', '15m', '1h', '4h', '1d', '1w'].map((t) => h('option', { value: t, selected: tf === t }, t))),
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => loadCandles(ui, symbol, tf) }, 'רענן'),
      ),
    ),

    // Quick Chips for popular assets
    h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '8px', alignItems: 'center' } },
      h('span', { class: 'small muted', text: 'נכסים מובילים:' }),
      ...quickAssets.map((sym) => h('button', {
        class: `btn btn-sm ${symbol === sym ? 'btn-primary' : 'btn-ghost'}`,
        style: { padding: '2px 8px', fontSize: '11.5px' },
        onclick: () => {
          ui.customChartSymbol = sym;
          chartState = { ...chartState, key: null, loading: false, error: null, candles: null };
          ui.rerender();
        },
      }, sym.replace('=F', ' Gold'))),
    ),
  );

  if (loading) {
    mount(root, h('div', { class: 'card', style: { marginTop: '14px', padding: '40px', textAlign: 'center' } },
      h('div', { class: 'ic', text: '⏳' }),
      h('div', { text: `טוען נתוני שוק ונרות עבור ${symbol} (${tf})…` }),
    ));
    return;
  }
  if (error) {
    mount(root, h('div', { class: 'notice bad', style: { marginTop: '14px' } },
      h('span', { class: 'ic', text: '⚠️' }),
      h('span', { text: 'שגיאה בטעינת נרות: ' + error }),
    ));
  }
  if (!candles || !candles.length) {
    mount(root, h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'empty', text: 'אין נתוני נרות להצגה כרגע. לחץ רענן או בחר נכס אחר.' }),
    ));
    return;
  }

  const sig = safe(() => signalSummary(candles), { bias: '—', notes: [] });

  // Main TradingView Workstation Card
  mount(root,
    h('div', {
      class: 'card',
      style: {
        marginTop: '14px',
        padding: '12px 14px',
        background: '#070d18',
        borderColor: 'rgba(56, 189, 248, 0.35)',
      },
    },
      // TradingView Toolbar Row 1: Actions, Clean Chart, Guides, Indicators
      h('div', {
        class: 'row between wrap',
        style: { gap: '8px', marginBottom: '10px', borderBottom: '1px solid rgba(30, 41, 59, 0.7)', paddingBottom: '10px' },
      },
        // Chart style toggles
        h('div', { class: 'row wrap', style: { gap: '5px' } },
          [
            ['candles', '🕯️ נרות'],
            ['heikin', '🎋 הייקן-אשי'],
            ['line', '📈 קו'],
            ['area', '🌊 שטח'],
          ].map(([type, label]) => h('button', {
            class: `btn btn-sm ${chartState.chartType === type ? 'btn-primary' : 'btn-ghost'}`,
            onclick: () => { chartState.chartType = type; ui.rerender(); },
          }, label)),
        ),

        // Quick Workstation Action Buttons (Clear Chart, Reset, Indicators, Guide)
        h('div', { class: 'row wrap', style: { gap: '6px' } },
          h('button', {
            class: 'btn btn-sm btn-ghost',
            style: { color: '#f87171', borderColor: 'rgba(239, 68, 68, 0.4)' },
            title: 'נקה את כל האינדיקטורים והקווים מהגרף לקבלת תצוגת נרות נקייה',
            onclick: () => clearChart(ui),
          }, '🧹 נקה גרף'),
          h('button', {
            class: 'btn btn-sm btn-ghost',
            title: 'שחזר תצורת עבודה ברירת מחדל (EMA, בולינגר, RSI)',
            onclick: () => resetDefaultSetup(ui),
          }, '🔄 ברירת מחדל'),
          h('button', {
            class: 'btn btn-sm btn-ghost',
            title: 'מחק את כל הסימונים והקווים המותאמים אישית',
            onclick: () => clearDrawingsOnly(ui),
          }, '🗑️ נקה סימונים'),
          h('button', {
            class: `btn btn-sm ${chartState.engineMode !== 'classic' ? 'btn-primary' : 'btn-ghost'}`,
            onclick: () => { chartState.engineMode = 'lw'; ui.rerender(); },
          }, '🕯️ מנוע TradingView Canvas (60fps)'),
          h('button', {
            class: `btn btn-sm ${chartState.engineMode === 'classic' ? 'btn-primary' : 'btn-ghost'}`,
            onclick: () => { chartState.engineMode = 'classic'; ui.rerender(); },
          }, '📈 תצוגת SVG מהירה'),
          h('button', {
            class: 'btn btn-sm btn-primary',
            onclick: () => openIndicatorSelectorModal(ui),
          }, '📊 אינדיקטורים'),
          h('button', {
            class: 'btn btn-sm btn-primary',
            style: { background: 'linear-gradient(135deg, #f59e0b, #d97706)', borderColor: '#fbbf24' },
            onclick: () => openAdvancedToolsGuideModal(candles, symbol, live),
          }, '💡 מדריך כלים מתקדמים (פיבונאצ׳י, גאן ואינדיקטורים)'),
        ),
      ),

      // TradingView Toolbar Row 2: Direct Interactive Overlay Tool Toggles
      h('div', {
        class: 'row wrap',
        style: { gap: '6px', marginBottom: '8px', alignItems: 'center' },
      },
        h('span', { class: 'small muted', style: { marginInlineEnd: '4px' }, text: 'כלי ניתוח מהירים:' }),
        h('button', {
          class: `btn btn-sm ${chartState.tools.fibonacci ? 'btn-primary' : 'btn-ghost'}`,
          title: 'הצג/הסתר סרגל פיבונאצ׳י וכיס הזהב (Golden Pocket 61.8%-65%)',
          onclick: () => { chartState.tools.fibonacci = !chartState.tools.fibonacci; ui.rerender(); },
        }, '🌀 פיבונאצ׳י (Golden Pocket)'),
        h('button', {
          class: `btn btn-sm ${chartState.tools.riskReward ? 'btn-primary' : 'btn-ghost'}`,
          title: 'הצג/הסתר כלי הדמיית יחס סיכוי/סיכון (R:R Box)',
          onclick: () => { chartState.tools.riskReward = !chartState.tools.riskReward; ui.rerender(); },
        }, '🎯 יחס סיכוי/סיכון (R:R)'),
        h('button', {
          class: `btn btn-sm ${chartState.indicators.gannFan ? 'btn-primary' : 'btn-ghost'}`,
          title: 'הצג מניפת גאן 9 זוויות (כולל קו איזון 1x1)',
          onclick: () => { chartState.indicators.gannFan = !chartState.indicators.gannFan; ui.rerender(); },
        }, '📐 מניפת גאן'),
        h('button', {
          class: `btn btn-sm ${chartState.indicators.vwap ? 'btn-primary' : 'btn-ghost'}`,
          title: 'מחיר ממוצע משוקלל נפח (עוגן מוסדי)',
          onclick: () => { chartState.indicators.vwap = !chartState.indicators.vwap; ui.rerender(); },
        }, '🌊 VWAP'),
        h('button', {
          class: `btn btn-sm ${chartState.indicators.supertrend ? 'btn-primary' : 'btn-ghost'}`,
          title: 'SuperTrend מבוסס תנודתיות ATR',
          onclick: () => { chartState.indicators.supertrend = !chartState.indicators.supertrend; ui.rerender(); },
        }, '⚡ SuperTrend'),
        h('button', {
          class: `btn btn-sm ${chartState.indicators.bollinger ? 'btn-primary' : 'btn-ghost'}`,
          title: 'רצועות בולינגר (20, 2)',
          onclick: () => { chartState.indicators.bollinger = !chartState.indicators.bollinger; ui.rerender(); },
        }, '📊 בולינגר'),
        h('button', {
          class: `btn btn-sm ${chartState.indicators.orderBlocks ? 'btn-primary' : 'btn-ghost'}`,
          title: 'בלוקי פקודות מוסדיים ו-FVG',
          onclick: () => { chartState.indicators.orderBlocks = !chartState.indicators.orderBlocks; ui.rerender(); },
        }, '🏛️ Order Blocks (SMC)'),
        h('button', {
          class: `btn btn-sm ${chartState.tools.trendlines ? 'btn-primary' : 'btn-ghost'}`,
          title: 'קווי מגמה אוטומטיים בין שיאים ושפלים',
          onclick: () => { chartState.tools.trendlines = !chartState.tools.trendlines; ui.rerender(); },
        }, '📉 קווי מגמה'),
      ),

      // Dynamic Interactive HUD Header (shows Open, High, Low, Close, Volume, and active indicators on hover)
      h('div', {
        id: 'tv-chart-hud',
        class: 'row wrap mono',
        style: {
          gap: '12px',
          padding: '4px 8px',
          fontSize: '11px',
          background: 'rgba(15, 23, 42, 0.75)',
          borderRadius: '4px',
          marginBottom: '6px',
          color: '#cbd5e1',
          minHeight: '22px',
          alignItems: 'center',
        },
      },
        h('span', { style: { color: '#94a3b8' }, text: `${symbol} · ${tf}` }),
        h('span', { text: `מחיר נוכחי: $${fmtPriceSmart(live)}` }),
        h('span', { style: { color: '#64748b' }, text: '(העבר עכבר על הנרות לקריאת ערכים מדויקים / לחץ להוספת קו אופקי)' }),
      ),

      // Main Chart Canvas (TradingView Lightweight Charts 60fps canvas or classic SVG)
      chartState.engineMode !== 'classic'
        ? createChartWorkspace({
            symbol,
            tf,
            candles,
            onSymbolChange: (newSym) => {
              ui.customChartSymbol = newSym;
              chartState = { ...chartState, key: null, loading: false, error: null, candles: null };
              ui.rerender();
            },
            onTfChange: (newTf) => {
              ui.customChartTf = newTf;
              chartState = { ...chartState, key: null, loading: false, error: null, candles: null };
              ui.rerender();
            },
          }).element
        : safe(() => renderMainTradingViewSvg(candles, ui), h('div', { class: 'empty', text: 'שגיאה ברינדור הגרף' })),
    ),

    // Sub-Charts Section (Oscillators: RSI, MACD, Stochastic, ATR)
    h('div', { style: { marginTop: '14px' } },
      h('div', { class: 'row between wrap', style: { marginBottom: '8px', alignItems: 'center' } },
        h('b', { style: { color: '#94a3b8' }, text: 'מתנדים תחתונים (Oscillators):' }),
        h('div', { class: 'row', style: { gap: '6px' } },
          [['rsi', 'RSI (14)'], ['macd', 'MACD'], ['stoch', 'סטוכסטיק'], ['atr', 'ATR']].map(([id, label]) => h('button', {
            class: `btn btn-sm ${chartState.oscillators[id] ? 'btn-primary' : 'btn-ghost'}`,
            style: { padding: '2px 8px', fontSize: '11px' },
            onclick: () => { chartState.oscillators[id] = !chartState.oscillators[id]; ui.rerender(); },
          }, label)),
        ),
      ),

      chartState.oscillators.rsi
        ? h('div', { class: 'card', style: { marginBottom: '10px', padding: '10px 14px' } },
            h('div', { class: 'row between', style: { marginBottom: '6px' } },
              h('b', { style: { fontSize: '12px', color: '#38bdf8' }, text: 'RSI (14) · מדד עוצמה יחסית' }),
              sig.r != null ? tag(`RSI: ${sig.r.toFixed(1)}`, sig.r >= 70 ? 'red' : sig.r <= 30 ? 'live' : 'opt') : null,
            ),
            safe(() => renderOscillatorSvg(candles, 'rsi'), h('div', { class: 'empty', text: 'שגיאה ב-RSI' })),
          )
        : null,

      chartState.oscillators.macd
        ? h('div', { class: 'card', style: { marginBottom: '10px', padding: '10px 14px' } },
            h('div', { class: 'row between', style: { marginBottom: '6px' } },
              h('b', { style: { fontSize: '12px', color: '#38bdf8' }, text: 'MACD (12, 26, 9) · מומנטום והיסטוגרמה' }),
              sig.mh != null ? tag(sig.mh >= 0 ? 'מומנטום חיובי' : 'מומנטום שלילי', sig.mh >= 0 ? 'live' : 'red') : null,
            ),
            safe(() => renderOscillatorSvg(candles, 'macd'), h('div', { class: 'empty', text: 'שגיאה ב-MACD' })),
          )
        : null,

      chartState.oscillators.stoch
        ? h('div', { class: 'card', style: { marginBottom: '10px', padding: '10px 14px' } },
            h('div', { class: 'row between', style: { marginBottom: '6px' } },
              h('b', { style: { fontSize: '12px', color: '#f59e0b' }, text: 'סטוכסטיק (14, 3, 3) · מומנטום קצר' }),
            ),
            safe(() => renderOscillatorSvg(candles, 'stoch'), h('div', { class: 'empty', text: 'שגיאה בסטוכסטיק' })),
          )
        : null,

      chartState.oscillators.atr
        ? h('div', { class: 'card', style: { marginBottom: '10px', padding: '10px 14px' } },
            h('div', { class: 'row between', style: { marginBottom: '6px' } },
              h('b', { style: { fontSize: '12px', color: '#eab308' }, text: 'ATR (14) · תנודתיות ממוצעת לנר' }),
              sig.atrVal != null ? tag(`±${fmtPriceSmart(sig.atrVal)}`, 'opt') : null,
            ),
            safe(() => renderOscillatorSvg(candles, 'atr'), h('div', { class: 'empty', text: 'שגיאה ב-ATR' })),
          )
        : null,
    ),

    // Live Technical Summary Card
    h('div', { class: 'card', style: { marginTop: '14px', background: 'rgba(11, 18, 32, 0.95)' } },
      h('div', { class: 'card-head' },
        h('div', {},
          h('h2', { text: `🧭 תמצות טכני חי עבור ${symbol} (${tf})` }),
          h('div', { class: 'card-sub', text: 'שקלול רמות פיבונאצ׳י, ממוצעים נעים, בולינגר, תנודתיות ומומנטום' }),
        ),
        tag(`הטיה כוללת: ${sig.bias}`, sig.bias === 'שורי' ? 'live' : sig.bias === 'דובי' ? 'red' : 'opt'),
      ),
      h('div', { class: 'row wrap', style: { gap: '8px', marginBottom: '10px' } },
        ...(sig.notes || []).map((n) => tag(n, 'opt')),
      ),
      h('div', { class: 'small', style: { color: '#cbd5e1', lineHeight: '1.6' } },
        `המחיר הנוכחי הוא $${fmtPriceSmart(live)}. `,
        sig.e20 && live > sig.e20
          ? `הנכס נסחר מעל ממוצע EMA20 ($${fmtPriceSmart(sig.e20)}) מה שמעיד על עדיפות לקונים בטווח הקצר. `
          : sig.e20
            ? `הנכס נסחר מתחת לממוצע EMA20 ($${fmtPriceSmart(sig.e20)}) מה שמצביע על לחץ מוכרים. `
            : '',
        `תנודתיות ממוצעת לנר (ATR): ±$${fmtPriceSmart(sig.atrVal || 0)}. `,
        'ללמידה מעמיקה על מציאת תזמוני כניסה מושלמים עם יחס סיכוי/סיכון גבוה — לחץ על כפתור המדריך בראש העמוד.',
      ),
    ),
  );
}
