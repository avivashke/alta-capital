import { mount, h, num, notice } from '../ui.js';
import { store } from '../store.js';
import { marketState, getCandles, lastPrice } from '../market.js';
import { ema, rsi, macd, donchian } from '../indicators.js';

const MAX_BARS = 120;
const PANEL_HEIGHT = 160;
const CANDLE_WIDTH = 10;
const GAP = 4;

let chartState = { key: null, loading: false, error: null, candles: null };

async function loadCandles(ui, symbol, tf) {
  const key = `${symbol}|${tf}`;
  if (chartState.loading && chartState.key === key) return;
  chartState = { key, loading: true, error: null, candles: null };
  ui.rerender();
  try {
    const candles = await getCandles(symbol, tf, { limit: MAX_BARS, force: true });
    chartState = { key, loading: false, error: null, candles };
  } catch (err) {
    chartState = { key, loading: false, error: err?.message || String(err), candles: null };
  }
  ui.rerender();
}

export function renderCharts(root, ui) {
  const state = store.state;
  const deskId = ui.selectedDesk || (state.desks[0]?.id || null);
  const desk = deskId ? state.desks.find((d) => d.id === deskId) : null;
  const symbol = desk ? desk.symbol : 'BTCUSDT';
  const tf = desk ? desk.tf : '1h';
  const key = `${symbol}|${tf}`;

  if (chartState.key !== key && !chartState.loading) {
    loadCandles(ui, symbol, tf);
  }

  const selectDesk = (id) => {
    ui.selectedDesk = id;
    chartState = { key: null, loading: false, error: null, candles: null };
    ui.rerender();
  };

  const { loading, error, candles } = chartState;

  mount(root,
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: 'תרשים גרפי · ניתוח טכני' }),
        h('h1', { text: 'גרפי מחיר ואינדיקטורים' }),
        h('p', { text: 'נתוני שוק עם אינדיקטורים טכניים — EMA, RSI, MACD, Donchian. לכל שולחן טווח זמן וסמל משלו.' }),
      ),
      h('div', { class: 'head-actions' },
        h('span', { class: marketState.synthetic ? 'pill pill-warn' : 'pill pill-sim', text: marketState.synthetic ? 'נתוני הדגמה' : 'חיבור חי לשוק' }),
        h('select', {
          class: 'input',
          value: deskId || '',
          onchange: (e) => selectDesk(e.target.value),
        }, state.desks.map((d) => h('option', { value: d.id }, `${d.label} · ${d.symbol} · ${d.tf}`))),
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => loadCandles(ui, symbol, tf) }, 'רענן נתונים'),
      ),
    ),

    loading ? h('div', { class: 'empty-portfolio', style: { padding: '60px 20px' } },
      h('div', { class: 'ic' }, '⏳'),
      h('div', { text: 'טוען נרות היסטוריים…' }),
    ) : null,

    error ? h('div', { class: 'notice bad' },
      h('span', { class: 'ic' }, '⚠️'),
      h('span', { text: 'שגיאה בטעינת נתונים: ' + error }),
    ) : null,

    !loading && candles && candles.length
      ? h('div', { class: 'chart-wrap' },
        h('div', { class: 'chart-panel' },
          h('div', { class: 'chart-panel-head' },
            h('h3', { text: `${symbol} · ${tf} · נר יפני` }),
            h('div', { class: 'chart-live-price' },
              h('span', { class: 'live-dot' }),
              h('span', { text: num(lastPrice(symbol), 2) }),
            ),
          ),
          h('div', { class: 'chart-canvas-wrap' }, renderCandlesChart(candles)),
          h('div', { class: 'chart-meta' },
            h('span', { text: 'סגירה: ' + num(candles[candles.length - 1].c, 2) }),
            h('span', { text: 'גבוה: ' + num(candles[candles.length - 1].h, 2) }),
            h('span', { text: 'נמוך: ' + num(candles[candles.length - 1].l, 2) }),
          ),
        ),
        h('div', { class: 'chart-panel' },
          h('div', { class: 'chart-panel-head' }, h('h3', { text: 'RSI (14)' })),
          h('div', { class: 'chart-canvas-wrap' }, renderOscillatorPanel(candles, rsi, 70, 30, 50)),
          h('div', { class: 'chart-meta' }, h('span', { text: 'קניית יתר > 70 · מכירת יתר < 30' })),
        ),
        h('div', { class: 'chart-panel' },
          h('div', { class: 'chart-panel-head' }, h('h3', { text: 'MACD' })),
          h('div', { class: 'chart-canvas-wrap' }, renderMACDPanel(candles)),
          h('div', { class: 'chart-meta' }, h('span', { text: 'חיתוך מעלה = קנייה · חיתוך מטה = מכירה' })),
        ),
        h('div', { class: 'chart-panel' },
          h('div', { class: 'chart-panel-head' }, h('h3', { text: 'Donchian Channel' })),
          h('div', { class: 'chart-canvas-wrap' }, renderDonchianPanel(candles, 20)),
          h('div', { class: 'chart-meta' }, h('span', { text: 'פריצת ערוץ עליון/תחתון' })),
        ),
      )
      : null,

    notice('האינדיקטורים מחושבים בצד הלקוח על נתוני השוק. אינם המלצת השקעה.', 'blue'),
  );
}

function renderCandlesChart(candles) {
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
  const width = show * (CANDLE_WIDTH + GAP) + 50;
  const height = PANEL_HEIGHT;
  const pad = 24;
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', width.toString());
  svg.setAttribute('height', height.toString());
  svg.setAttribute('style', 'display:block; background:#0b1017; border-radius:8px;');

  const gridY = [minPrice, (minPrice + maxPrice) / 2, maxPrice];
  for (const yPrice of gridY) {
    const y = pad + ((maxPrice - yPrice) / priceRange) * (height - 2 * pad);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '30'); line.setAttribute('x2', String(width));
    line.setAttribute('y1', String(y)); line.setAttribute('y2', String(y));
    line.setAttribute('stroke', '#16202c'); svg.appendChild(line);
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', '2'); label.setAttribute('y', String(y + 4));
    label.setAttribute('fill', '#64748b'); label.setAttribute('font-size', '9');
    label.textContent = yPrice.toFixed(0); svg.appendChild(label);
  }

  const drawLine = (arr, color) => {
    const pts = [];
    for (let i = 0; i < show; i++) {
      if (arr[i] == null) continue;
      const x = 30 + i * (CANDLE_WIDTH + GAP) + CANDLE_WIDTH / 2;
      const y = pad + ((maxPrice - arr[i]) / priceRange) * (height - 2 * pad);
      pts.push(`${x},${y}`);
    }
    if (pts.length > 1) {
      const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      pl.setAttribute('points', pts.join(' '));
      pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', color); pl.setAttribute('stroke-width', '1.5');
      svg.appendChild(pl);
    }
  };
  drawLine(e20, '#58a6ff');
  drawLine(e50, '#a78bfa');

  for (let i = 0; i < show; i++) {
    const o = opens[i], c = closes[i], h0 = highs[i], l = lows[i];
    const x = 30 + i * (CANDLE_WIDTH + GAP);
    const up = c >= o;
    const color = up ? '#2ecc71' : '#f05b5b';
    const topY = pad + ((maxPrice - Math.max(o, c)) / priceRange) * (height - 2 * pad);
    const botY = pad + ((maxPrice - Math.min(o, c)) / priceRange) * (height - 2 * pad);
    const highY = pad + ((maxPrice - h0) / priceRange) * (height - 2 * pad);
    const lowY = pad + ((maxPrice - l) / priceRange) * (height - 2 * pad);
    const wick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    wick.setAttribute('x1', String(x + CANDLE_WIDTH / 2)); wick.setAttribute('x2', String(x + CANDLE_WIDTH / 2));
    wick.setAttribute('y1', String(highY)); wick.setAttribute('y2', String(lowY));
    wick.setAttribute('stroke', color); svg.appendChild(wick);
    const body = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    body.setAttribute('x', String(x)); body.setAttribute('y', String(topY));
    body.setAttribute('width', String(Math.max(1, CANDLE_WIDTH - 2)));
    body.setAttribute('height', String(Math.max(1, botY - topY)));
    body.setAttribute('fill', color); svg.appendChild(body);
  }

  const wrap = h('div', { class: 'chart-canvas', style: { width: '100%', overflowX: 'auto' } });
  wrap.appendChild(svg);
  return wrap;
}

function renderOscillatorPanel(candles, fn, upper, lower, middle) {
  const closes = candles.map((c) => c.c);
  const values = fn(closes);
  const n = values.length;
  const show = Math.min(n, MAX_BARS);
  const start = n - show;
  const slice = values.slice(start);
  const width = show * (CANDLE_WIDTH + GAP) + 40;
  const height = PANEL_HEIGHT;
  const pad = 20;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
  svg.setAttribute('style', 'display:block; background:#0b1017; border-radius:8px;');

  for (const ln of [{ val: upper, color: '#f05b5b' }, { val: middle, color: '#64748b' }, { val: lower, color: '#2ecc71' }]) {
    const y = pad + ((upper - ln.val) / (upper - lower || 1)) * (height - 2 * pad);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '30'); line.setAttribute('x2', String(width));
    line.setAttribute('y1', String(y)); line.setAttribute('y2', String(y));
    line.setAttribute('stroke', ln.color); line.setAttribute('stroke-dasharray', '4,4');
    svg.appendChild(line);
  }

  const pts = [];
  for (let i = 0; i < show; i++) {
    if (slice[i] == null) continue;
    const x = 30 + i * (CANDLE_WIDTH + GAP) + CANDLE_WIDTH / 2;
    const y = pad + ((upper - slice[i]) / (upper - lower || 1)) * (height - 2 * pad);
    pts.push(`${x},${y}`);
  }
  if (pts.length > 1) {
    const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    pl.setAttribute('points', pts.join(' '));
    pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', '#58a6ff'); pl.setAttribute('stroke-width', '2');
    svg.appendChild(pl);
  }
  const wrap = h('div', { class: 'chart-canvas', style: { width: '100%', overflowX: 'auto' } });
  wrap.appendChild(svg);
  return wrap;
}

function renderMACDPanel(candles) {
  const closes = candles.map((c) => c.c);
  const m = macd(closes);
  const n = m.hist.length;
  const show = Math.min(n, MAX_BARS);
  const start = n - show;
  const hist = m.hist.slice(start), macdLine = m.macd.slice(start), signal = m.signal.slice(start);
  const allVals = [...hist, ...macdLine, ...signal].filter((v) => v != null);
  const maxVal = Math.max(...allVals, 1), minVal = Math.min(...allVals, -1);
  const valRange = maxVal - minVal || 1;
  const width = show * (CANDLE_WIDTH + GAP) + 40;
  const height = PANEL_HEIGHT; const pad = 20;
  const zeroY = pad + ((maxVal - 0) / valRange) * (height - 2 * pad);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
  svg.setAttribute('style', 'display:block; background:#0b1017; border-radius:8px;');
  const zl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  zl.setAttribute('x1', '30'); zl.setAttribute('x2', String(width));
  zl.setAttribute('y1', String(zeroY)); zl.setAttribute('y2', String(zeroY));
  zl.setAttribute('stroke', '#16202c'); svg.appendChild(zl);

  for (let i = 0; i < show; i++) {
    const h0 = hist[i]; if (h0 == null) continue;
    const x = 30 + i * (CANDLE_WIDTH + GAP);
    const y2 = pad + ((maxVal - h0) / valRange) * (height - 2 * pad);
    const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bar.setAttribute('x', String(x)); bar.setAttribute('y', String(Math.min(zeroY, y2)));
    bar.setAttribute('width', String(Math.max(1, CANDLE_WIDTH - 2)));
    bar.setAttribute('height', String(Math.max(1, Math.abs(zeroY - y2))));
    bar.setAttribute('fill', h0 >= 0 ? '#2ecc71' : '#f05b5b'); bar.setAttribute('opacity', '0.6');
    svg.appendChild(bar);
  }
  const drawLine = (arr, color) => {
    const pts = [];
    for (let i = 0; i < show; i++) {
      if (arr[i] == null) continue;
      const x = 30 + i * (CANDLE_WIDTH + GAP) + CANDLE_WIDTH / 2;
      const y = pad + ((maxVal - arr[i]) / valRange) * (height - 2 * pad);
      pts.push(`${x},${y}`);
    }
    if (pts.length > 1) {
      const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      pl.setAttribute('points', pts.join(' ')); pl.setAttribute('fill', 'none');
      pl.setAttribute('stroke', color); pl.setAttribute('stroke-width', '1.5'); svg.appendChild(pl);
    }
  };
  drawLine(macdLine, '#58a6ff'); drawLine(signal, '#f05b5b');
  const wrap = h('div', { class: 'chart-canvas', style: { width: '100%', overflowX: 'auto' } });
  wrap.appendChild(svg); return wrap;
}

function renderDonchianPanel(candles, period) {
  const { upper, lower } = donchian(candles, period);
  const closes = candles.map((c) => c.c);
  const n = upper.length, show = Math.min(n, MAX_BARS), start = n - show;
  const up = upper.slice(start), lo = lower.slice(start), cl = closes.slice(start);
  const allVals = [...up, ...lo, ...cl].filter((v) => v != null);
  const maxPrice = Math.max(...allVals, 1), minPrice = Math.min(...allVals, 0);
  const priceRange = maxPrice - minPrice || 1;
  const width = show * (CANDLE_WIDTH + GAP) + 40; const height = PANEL_HEIGHT; const pad = 20;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
  svg.setAttribute('style', 'display:block; background:#0b1017; border-radius:8px;');
  const drawLine = (arr, color) => {
    const pts = [];
    for (let i = 0; i < show; i++) {
      if (arr[i] == null) continue;
      const x = 30 + i * (CANDLE_WIDTH + GAP) + CANDLE_WIDTH / 2;
      const y = pad + ((maxPrice - arr[i]) / priceRange) * (height - 2 * pad);
      pts.push(`${x},${y}`);
    }
    if (pts.length > 1) {
      const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      pl.setAttribute('points', pts.join(' ')); pl.setAttribute('fill', 'none');
      pl.setAttribute('stroke', color); pl.setAttribute('stroke-width', '1.5'); svg.appendChild(pl);
    }
  };
  drawLine(up, '#f05b5b'); drawLine(lo, '#2ecc71'); drawLine(cl, '#58a6ff');
  const wrap = h('div', { class: 'chart-canvas', style: { width: '100%', overflowX: 'auto' } });
  wrap.appendChild(svg); return wrap;
}
