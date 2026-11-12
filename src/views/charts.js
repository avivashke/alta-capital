import { mount } from '../ui.js';
import { store } from '../store.js';
import { h, pct, num, money, section, notice, empty, tag, timeAgo, chart } from '../ui.js';
import { marketState, quotes, getCandles, lastPrice } from '../market.js';
import { STRATEGIES, DESKS, STRATEGY_LABELS } from '../config.js';
import { ema, rsi, macd, atr, donchian, bollinger } from '../indicators.js';

const MAX_BARS = 400;
const PANEL_HEIGHT = 160;
const CANDLE_WIDTH = 10;
const GAP = 4;

export function renderCharts(root, ui) {
  const state = store.state;
  const s = state.settings;
  const deskId = ui.selectedDesk || (state.desks[0]?.id || null);
  const desk = deskId ? state.desks.find((d) => d.id === deskId) : null;
  const symbol = desk ? desk.symbol : 'BTCUSDT';
  const tf = desk ? desk.tf : '1h';

  const [candles, setCandles] = (() => {
    // נטען נרות לפי דרישה (לא retenu.state כדי לא להעמיס על ה-store)
    return [null, () => {}];
  })();

  // טעינת נרות
  let candlesData = null;
  let loading = true;
  let error = null;

  (async () => {
    try {
      candlesData = await getCandles(symbol, tf, { limit: MAX_BARS, force: true });
      loading = false;
      ui.rerender();
    } catch (err) {
      error = err.message;
      loading = false;
      ui.rerender();
    }
  })();

  // בחירת שולחן
  const selectDesk = (id) => { ui.selectedDesk = id; ui.rerender(); };

  mount(root,
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: 'תרשים גרפי · ניתוח טכני' }),
        h('h1', { text: 'גרפי מחיר ואינדיקטורים' }),
        h('p', { text: 'נתוני שוק חיים מביננס עם אינדיקטורים טכניים — EMA, RSI, MACD, Donchian Channel, Bollinger Bands. לכל שולחן מסחר יש גרף נפרד בטווח הזמן שלו.' }),
      ),
      h('div', { class: 'head-actions' },
        h('span', { class: marketState.synthetic ? 'pill pill-warn' : 'pill pill-sim', text: marketState.synthetic ? 'נתוני הדגמה' : 'חיבור חי ל-Binance' }),
        h('select', {
          class: 'input',
          value: deskId || '',
          onchange: (e) => selectDesk(e.target.value),
        },
          state.desks.map((d) => h('option', { value: d.id }, `${d.label} · ${d.symbol} · ${d.tf}`)),
        ),
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => ui.rerender() }, 'רענן נתונים'),
      ),
    ),

    loading ? h('div', { class: 'empty-portfolio', style: { padding: '60px 20px' } },
      h('div', { class: 'ic' }, '⏳'),
      h('div', { text: 'מטען נרות היסטוריים מביננס…' }),
    ) : error ? h('div', { class: 'notice bad' },
      h('span', { class: 'ic' }, '⚠️'),
      h('span', { text: 'שגיאה בטעינת נתונים: ' + error + '. המערכת תשתמש בנתוני הדגמה אם החיבור לא זמין.' }),
    ) : null,

    !loading && candlesData
      ? h('div', { class: 'chart-wrap' },
        // נר יפני ראשי עם EMA
        h('div', { class: 'chart-panel' },
          h('div', { class: 'chart-panel-head' },
            h('h3', { text: `${symbol} · ${tf} · נר יפני` }),
            h('div', { class: 'chart-live-price' },
              h('span', { class: 'live-dot' }),
              h('span', { text: num(lastPrice(symbol), 2) }),
            ),
          ),
          h('div', { class: 'chart-canvas-wrap' },
            renderCandlesChart(candlesData, desk),
          ),
          h('div', { class: 'chart-meta' },
            h('span', { text: 'סגירה אחרונה: ' + num(candlesData[candlesData.length - 1].c, 2) }),
            h('span', { text: 'גבוה: ' + num(candlesData[candlesData.length - 1].h, 2) }),
            h('span', { text: 'נמוך: ' + num(candlesData[candlesData.length - 1].l, 2) }),
            h('span', { text: 'נפח: ' + num(candlesData[candlesData.length - 1].v, 2) }),
          ),
        ),

        // פאנל RSI
        h('div', { class: 'chart-panel' },
          h('div', { class: 'chart-panel-head' },
            h('h3', { text: 'RSI (14) · מומנטום' }),
          ),
          h('div', { class: 'chart-canvas-wrap' },
            renderOscillatorPanel(candlesData, 'RSI', rsi, 70, 30, 50),
          ),
          h('div', { class: 'chart-meta' },
            h('span', { text: 'קניית יתר > 70 · מכירת יתר < 30' }),
          ),
        ),

        // פאנל MACD
        h('div', { class: 'chart-panel' },
          h('div', { class: 'chart-panel-head' },
            h('h3', { text: 'MACD · היסטוגרמה וסיגנל' }),
          ),
          h('div', { class: 'chart-canvas-wrap' },
            renderMACDPanel(candlesData),
          ),
          h('div', { class: 'chart-meta' },
            h('span', { text: 'חיתוך מעלה = אות קנייה · חיתוך מטה = אות מכירה' }),
          ),
        ),

        // פאנל Donchian Channel
        h('div', { class: 'chart-panel' },
          h('div', { class: 'chart-panel-head' },
            h('h3', { text: 'Donchian Channel · פריצות' }),
          ),
          h('div', { class: 'chart-canvas-wrap' },
            renderDonchianPanel(candlesData, 20),
          ),
          h('div', { class: 'chart-meta' },
            h('span', { text: 'פריצת ערוץ עליון = לונג · פריצת ערוץ תחתון = שורט' }),
          ),
        )
      : null,
      notice('האינדיקטורים מחושבים בצד הלקוח על גבי נתוני השוק. הם לא מהווים המלצת השקעה או אות מסחר.', 'blue'),
  );
}

/* ============================================================
   גרף נרות יפני עם EMA 20 ו-EMA 50 (SVG)
   ============================================================ */

function renderCandlesChart(candles, desk) {
  const n = candles.length;
  const show = Math.min(n, MAX_BARS);
  const start = n - show;
  const slice = candles.slice(start);

  const highs = slice.map((c) => c.h);
  const lows = slice.map((c) => c.l);
  const closes = slice.map((c) => c.c);
  const opens = slice.map((c) => c.o);

  const maxPrice = Math.max(...highs);
  const minPrice = Math.min(...lows);
  const priceRange = maxPrice - minPrice || 1;

  const width = show * (CANDLE_WIDTH + GAP) + 40;
  const height = PANEL_HEIGHT;
  const pad = 40;

  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', width.toString());
  svg.setAttribute('height', height.toString());
  svg.setAttribute('style', 'display:block; background: #0b1017; border-radius: 8px; overflow: hidden;');

  const gridY = [minPrice, (minPrice + maxPrice) / 2, maxPrice];
  for (const yPrice of gridY) {
    const y = pad + ((maxPrice - yPrice) / priceRange) * (height - 2 * pad);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '20');
    line.setAttribute('x2', width.toString());
    line.setAttribute('y1', y.toString());
    line.setAttribute('y2', y.toString());
    line.setAttribute('stroke', '#16202c');
    line.setAttribute('stroke-width', '1');
    svg.appendChild(line);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', '8');
    label.setAttribute('y', (y + 4).toString());
    label.setAttribute('fill', '#64748b');
    label.setAttribute('font-size', '10');
    label.setAttribute('font-family', 'monospace');
    label.textContent = yPrice.toFixed(2);
    svg.appendChild(label);
  }

  const e20Path = [];
  for (let i = 0; i < show; i++) {
    if (e20[i] == null) continue;
    const x = 20 + i * (CANDLE_WIDTH + GAP) + CANDLE_WIDTH / 2;
    const y = pad + ((maxPrice - e20[i]) / priceRange) * (height - 2 * pad);
    e20Path.push(`${x},${y}`);
  }
  if (e20Path.length > 1) {
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', e20Path.join(' '));
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', '#58a6ff');
    polyline.setAttribute('stroke-width', '1.5');
    svg.appendChild(polyline);
  }

  const e50Path = [];
  for (let i = 0; i < show; i++) {
    if (e50[i] == null) continue;
    const x = 20 + i * (CANDLE_WIDTH + GAP) + CANDLE_WIDTH / 2;
    const y = pad + ((maxPrice - e50[i]) / priceRange) * (height - 2 * pad);
    e50Path.push(`${x},${y}`);
  }
  if (e50Path.length > 1) {
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', e50Path.join(' '));
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', '#a78bfa');
    polyline.setAttribute('stroke-width', '1.5');
    svg.appendChild(polyline);
  }

  for (let i = 0; i < show; i++) {
    const o = opens[i];
    const c = closes[i];
    const h = highs[i];
    const l = lows[i];
    const x = 20 + i * (CANDLE_WIDTH + GAP);
    const isUp = c >= o;

    const topY = pad + ((maxPrice - Math.max(o, c)) / priceRange) * (height - 2 * pad);
    const bottomY = pad + ((maxPrice - Math.min(o, c)) / priceRange) * (height - 2 * pad);
    const highY = pad + ((maxPrice - h) / priceRange) * (height - 2 * pad);
    const lowY = pad + ((maxPrice - l) / priceRange) * (height - 2 * pad);

    const wick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    wick.setAttribute('x1', (x + CANDLE_WIDTH / 2).toString());
    wick.setAttribute('x2', (x + CANDLE_WIDTH / 2).toString());
    wick.setAttribute('y1', highY.toString());
    wick.setAttribute('y2', lowY.toString());
    wick.setAttribute('stroke', isUp ? '#2ecc71' : '#f05b5b');
    wick.setAttribute('stroke-width', '1');
    svg.appendChild(wick);

    const body = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    body.setAttribute('x', x.toString());
    body.setAttribute('y', topY.toString());
    body.setAttribute('width', Math.max(1, CANDLE_WIDTH - 2).toString());
    body.setAttribute('height', Math.max(1, bottomY - topY).toString());
    body.setAttribute('fill', isUp ? '#2ecc71' : '#f05b5b');
    body.setAttribute('opacity', '0.9');
    svg.appendChild(body);
  }

  const wrap = h('div', { class: 'chart-canvas', style: { width: '100%', overflowX: 'auto' } });
  wrap.appendChild(svg);
  return wrap;
}

/* ============================================================
   פאנל מתנודת (RSI דוגמה)
   ============================================================ */

function renderOscillatorPanel(candles, name, fn, upper, lower, middle) {
  const closes = candles.map((c) => c.c);
  const values = fn(closes);
  const n = values.length;
  const show = Math.min(n, MAX_BARS);
  const start = n - show;
  const slice = values.slice(start);

  const width = show * (CANDLE_WIDTH + GAP) + 40;
  const height = PANEL_HEIGHT;
  const pad = 30;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', width.toString());
  svg.setAttribute('height', height.toString());
  svg.setAttribute('style', 'display:block; background: #0b1017; border-radius: 8px; overflow: hidden;');

  const lines = [
    { val: upper, color: '#f05b5b', label: upper.toString() },
    { val: middle, color: '#64748b', label: middle.toString() },
    { val: lower, color: '#2ecc71', label: lower.toString() },
  ];
  for (const ln of lines) {
    const y = pad + ((upper - ln.val) / (upper - lower)) * (height - 2 * pad);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '20');
    line.setAttribute('x2', width.toString());
    line.setAttribute('y1', y.toString());
    line.setAttribute('y2', y.toString());
    line.setAttribute('stroke', ln.color);
    line.setAttribute('stroke-width', '1');
    line.setAttribute('stroke-dasharray', '4,4');
    svg.appendChild(line);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', '6');
    label.setAttribute('y', (y + 4).toString());
    label.setAttribute('fill', '#64748b');
    label.setAttribute('font-size', '10');
    label.setAttribute('font-family', 'monospace');
    label.textContent = ln.label;
    svg.appendChild(label);
  }

  const path = [];
  for (let i = 0; i < show; i++) {
    if (slice[i] == null) continue;
    const x = 20 + i * (CANDLE_WIDTH + GAP) + CANDLE_WIDTH / 2;
    const y = pad + ((upper - slice[i]) / (upper - lower)) * (height - 2 * pad);
    path.push(`${x},${y}`);
  }
  if (path.length > 1) {
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', path.join(' '));
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', '#58a6ff');
    polyline.setAttribute('stroke-width', '2');
    svg.appendChild(polyline);
  }

  const wrap = h('div', { class: 'chart-canvas', style: { width: '100%', overflowX: 'auto' } });
  wrap.appendChild(svg);
  return wrap;
}

/* ============================================================
   פאנל MACD (קו MACD, סיגנל, היסטוגרמה)
   ============================================================ */

function renderMACDPanel(candles) {
  const closes = candles.map((c) => c.c);
  const m = macd(closes);
  const n = m.hist.length;
  const show = Math.min(n, MAX_BARS);
  const start = n - show;
  const hist = m.hist.slice(start);
  const macdLine = m.macd.slice(start);
  const signal = m.signal.slice(start);

  const allVals = [...hist, ...macdLine, ...signal].filter((v) => v != null);
  const maxVal = Math.max(...allVals);
  const minVal = Math.min(...allVals);
  const valRange = maxVal - minVal || 1;

  const width = show * (CANDLE_WIDTH + GAP) + 40;
  const height = PANEL_HEIGHT;
  const pad = 30;
  const zeroY = pad + ((maxVal - 0) / valRange) * (height - 2 * pad);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', width.toString());
  svg.setAttribute('height', height.toString());
  svg.setAttribute('style', 'display:block; background: #0b1017; border-radius: 8px; overflow: hidden;');

  const zeroLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  zeroLine.setAttribute('x1', '20');
  zeroLine.setAttribute('x2', width.toString());
  zeroLine.setAttribute('y1', zeroY.toString());
  zeroLine.setAttribute('y2', zeroY.toString());
  zeroLine.setAttribute('stroke', '#16202c');
  zeroLine.setAttribute('stroke-width', '1');
  svg.appendChild(zeroLine);

  for (let i = 0; i < show; i++) {
    const h = hist[i];
    if (h == null) continue;
    const x = 20 + i * (CANDLE_WIDTH + GAP);
    const y1 = zeroY;
    const y2 = pad + ((maxVal - h) / valRange) * (height - 2 * pad);
    const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bar.setAttribute('x', x.toString());
    bar.setAttribute('y', Math.min(y1, y2).toString());
    bar.setAttribute('width', Math.max(1, CANDLE_WIDTH - 2).toString());
    bar.setAttribute('height', Math.abs(y1 - y2).toString());
    bar.setAttribute('fill', h >= 0 ? '#2ecc71' : '#f05b5b');
    bar.setAttribute('opacity', '0.6');
    svg.appendChild(bar);
  }

  const drawLine = (arr, color) => {
    const path = [];
    for (let i = 0; i < show; i++) {
      if (arr[i] == null) continue;
      const x = 20 + i * (CANDLE_WIDTH + GAP) + CANDLE_WIDTH / 2;
      const y = pad + ((maxVal - arr[i]) / valRange) * (height - 2 * pad);
      path.push(`${x},${y}`);
    }
    if (path.length > 1) {
      const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      polyline.setAttribute('points', path.join(' '));
      polyline.setAttribute('fill', 'none');
      polyline.setAttribute('stroke', color);
      polyline.setAttribute('stroke-width', '1.5');
      svg.appendChild(polyline);
    }
  };
  drawLine(macdLine, '#58a6ff');
  drawLine(signal, '#f05b5b');

  const wrap = h('div', { class: 'chart-canvas', style: { width: '100%', overflowX: 'auto' } });
  wrap.appendChild(svg);
  return wrap;
}

/* ============================================================
   פאנל Donchian Channel
   ============================================================ */

function renderDonchianPanel(candles, period) {
  const { upper, lower } = donchian(candles, period);
  const closes = candles.map((c) => c.c);
  const n = upper.length;
  const show = Math.min(n, MAX_BARS);
  const start = n - show;
  const up = upper.slice(start);
  const lo = lower.slice(start);
  const cl = closes.slice(start);

  const allVals = [...up, ...lo, ...cl].filter((v) => v != null);
  const maxPrice = Math.max(...allVals);
  const minPrice = Math.min(...allVals);
  const priceRange = maxPrice - minPrice || 1;

  const width = show * (CANDLE_WIDTH + GAP) + 40;
  const height = PANEL_HEIGHT;
  const pad = 30;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', width.toString());
  svg.setAttribute('height', height.toString());
  svg.setAttribute('style', 'display:block; background: #0b1017; border-radius: 8px; overflow: hidden;');

  const drawLine = (arr, color, dashed = false) => {
    const path = [];
    for (let i = 0; i < show; i++) {
      if (arr[i] == null) continue;
      const x = 20 + i * (CANDLE_WIDTH + GAP) + CANDLE_WIDTH / 2;
      const y = pad + ((maxPrice - arr[i]) / priceRange) * (height - 2 * pad);
      path.push(`${x},${y}`);
    }
    if (path.length > 1) {
      const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      polyline.setAttribute('points', path.join(' '));
      polyline.setAttribute('fill', 'none');
      polyline.setAttribute('stroke', color);
      polyline.setAttribute('stroke-width', '1.5');
      if (dashed) polyline.setAttribute('stroke-dasharray', '4,4');
      svg.appendChild(polyline);
    }
  };
  drawLine(up, '#f05b5b');
  drawLine(lo, '#2ecc71');

  for (let i = 0; i < show; i++) {
    const c = cl[i];
    if (c == null) continue;
    const x = 20 + i * (CANDLE_WIDTH + GAP);
    const y = pad + ((maxPrice - c) / priceRange) * (height - 2 * pad);
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    dot.setAttribute('x', (x + 2).toString());
    dot.setAttribute('y', (y - 1).toString());
    dot.setAttribute('width', Math.max(1, CANDLE_WIDTH - 4).toString());
    dot.setAttribute('height', '2');
    dot.setAttribute('fill', '#58a6ff');
    svg.appendChild(dot);
  }

  const wrap = h('div', { class: 'chart-canvas', style: { width: '100%', overflowX: 'auto' } });
  wrap.appendChild(svg);
  return wrap;
}