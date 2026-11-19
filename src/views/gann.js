// Dedicated Educational Gann Research & Forecasting Page (#/gann)
// Combines Square of 9 Vibration Levels, Gann Angles (1x1..4x1), and Master Time & Calendar Cycles.

import { store } from '../store.js';
import { h, mount, num, pct, tag, notice, empty } from '../ui.js';
import { getCandles, marketState, ASSET_CATALOG } from '../market.js';
import { analyzeGannHistoryAndForecast } from '../gann.js';

let gannViewState = {
  symbol: 'BTCUSDT',
  tf: '1d',
  loading: false,
  error: null,
  candles: null,
  analysis: null,
  key: null,
};

async function loadGannData(ui) {
  const key = `${gannViewState.symbol}|${gannViewState.tf}`;
  if (gannViewState.loading && gannViewState.key === key) return;
  gannViewState.key = key;
  gannViewState.loading = true;
  gannViewState.error = null;
  ui.rerender();
  try {
    const candles = await getCandles(gannViewState.symbol, gannViewState.tf, { limit: 700, force: false });
    const lookback = gannViewState.tf === '1w' ? 5 : 10;
    const analysis = analyzeGannHistoryAndForecast(candles, { lookback });
    if (!analysis.ok) throw new Error(analysis.error);
    gannViewState.candles = candles;
    gannViewState.analysis = analysis;
  } catch (err) {
    gannViewState.error = err.message;
  } finally {
    gannViewState.loading = false;
    ui.rerender();
  }
}

function renderGannForecastSvg(candles, analysis) {
  const show = Math.min(candles.length, 220);
  const slice = candles.slice(-show);
  const offset = candles.length - show;
  const closes = slice.map((c) => c.c);
  const highs = slice.map((c) => c.h);
  const lows = slice.map((c) => c.l);

  const nearbySq9 = analysis.sq9Levels
    .filter((l) => Math.abs(l.distPct) <= 25)
    .slice(0, 6);

  const maxV = Math.max(...highs, ...nearbySq9.map((l) => l.price));
  const minV = Math.min(...lows, ...nearbySq9.map((l) => l.price));
  const range = maxV - minV || 1;

  const width = 920;
  const height = 340;
  const padL = 56;
  const padR = 140; // space on right for future time projection zone!
  const padT = 22;
  const padB = 28;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  const xAt = (i) => padL + (i / Math.max(1, show - 1)) * chartW;
  const yAt = (v) => padT + ((maxV - v) / range) * chartH;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.style.width = '100%';
  svg.style.height = 'auto';
  svg.style.display = 'block';
  svg.style.background = 'linear-gradient(180deg, #0b1220, #070c14)';
  svg.style.borderRadius = '12px';

  const el = (tag, attrs, text) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
    if (text != null) node.textContent = text;
    return node;
  };

  // Future Forecast Zone Background
  svg.appendChild(el('rect', {
    x: padL + chartW, y: padT, width: padR - 8, height: chartH,
    fill: 'rgba(167, 139, 250, 0.06)', stroke: 'rgba(167, 139, 250, 0.25)', 'stroke-dasharray': '4,4',
  }));
  svg.appendChild(el('text', {
    x: padL + chartW + 8, y: padT + 14, fill: '#c4b5fd', 'font-size': '10', 'font-weight': '700',
  }, 'אזור חיזוי עתידי'));

  // Grid lines
  for (let i = 0; i <= 4; i++) {
    const val = minV + (range * i) / 4;
    const y = yAt(val);
    svg.appendChild(el('line', { x1: padL, x2: width - 8, y1: y, y2: y, stroke: '#162235', 'stroke-width': 1 }));
    svg.appendChild(el('text', { x: 4, y: y + 4, fill: '#8fa3bf', 'font-size': '10' }, val >= 100 ? val.toFixed(0) : val.toFixed(2)));
  }

  // Square of 9 Cardinal & Ordinal Lines
  for (const lvl of nearbySq9) {
    const y = yAt(lvl.price);
    const col = lvl.isCardinal ? 'rgba(41, 98, 255, 0.85)' : 'rgba(167, 139, 250, 0.5)';
    svg.appendChild(el('line', {
      x1: padL, x2: width - 8, y1: y, y2: y,
      stroke: col, 'stroke-width': lvl.isCardinal ? 1.4 : 1, 'stroke-dasharray': lvl.isCardinal ? '0' : '4,4',
    }));
    svg.appendChild(el('text', {
      x: padL + chartW + 8, y: y - 3, fill: lvl.isCardinal ? '#7dd3fc' : '#c4b5fd', 'font-size': '9.5',
    }, `${lvl.degree}° (${lvl.price >= 100 ? lvl.price.toFixed(0) : lvl.price.toFixed(2)})`));
  }

  // Price Polyline
  const pts = closes.map((c, i) => `${xAt(i).toFixed(1)},${yAt(c).toFixed(1)}`).join(' ');
  svg.appendChild(el('polyline', { points: pts, fill: 'none', stroke: '#2ecc71', 'stroke-width': 2 }));

  // Historical Pivots (dots)
  for (const p of analysis.pivots) {
    const rel = p.idx - offset;
    if (rel < 0 || rel >= show) continue;
    svg.appendChild(el('circle', {
      cx: xAt(rel), cy: yAt(p.price), r: 4,
      fill: p.type === 'low' ? '#2ecc71' : '#f05b5b',
      stroke: '#070c14', 'stroke-width': 1.2,
    }));
  }

  // Future Projected Time Lines inside the forecast zone
  analysis.futurePivots.slice(0, 4).forEach((fp, idx) => {
    const fx = padL + chartW + 16 + idx * 28;
    svg.appendChild(el('line', {
      x1: fx, x2: fx, y1: padT + 20, y2: padT + chartH,
      stroke: fp.score >= 4 ? '#f2cc60' : 'rgba(167, 139, 250, 0.55)',
      'stroke-width': fp.score >= 4 ? 1.8 : 1, 'stroke-dasharray': '3,3',
    }));
    svg.appendChild(el('text', {
      x: fx - 10, y: padT + chartH + 14, fill: '#f2cc60', 'font-size': '9',
    }, `+${fp.daysAhead}d`));
  });

  return svg;
}

export function renderGann(root, ui) {
  const key = `${gannViewState.symbol}|${gannViewState.tf}`;
  if (gannViewState.key !== key && !gannViewState.loading) {
    setTimeout(() => loadGannData(ui), 0);
  }

  const a = gannViewState.analysis;

  mount(root,
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: 'W.D. Gann Lab · Square of 9 · Angles · Master Time Calendar' }),
        h('h1', { text: 'מחקר וחיזויי גאן (Gann Forecasting Lab)' }),
        h('p', { text: 'איחוד 3 השיטות של W.D. Gann על טווח הזמן המקסימלי: רמות השורש הריבועי (Square of 9 Vibration), מניפות זוויות (1x1–4x1) ומחשבון מחזורי הזמן והלוח שנה.' }),
      ),
      h('div', { class: 'head-actions' },
        h('select', {
          class: 'input',
          value: gannViewState.symbol,
          onchange: (e) => {
            gannViewState.symbol = e.target.value;
            gannViewState.key = null;
            loadGannData(ui);
          },
        }, ASSET_CATALOG.map((item) => h('option', { value: item.symbol, selected: gannViewState.symbol === item.symbol }, item.label))),
        h('select', {
          class: 'input',
          value: gannViewState.tf,
          onchange: (e) => {
            gannViewState.tf = e.target.value;
            gannViewState.key = null;
            loadGannData(ui);
          },
        }, [['1d', 'יומי (טווח 2+ שנים)'], ['1w', 'שבועי (טווח 5 שנים)'], ['1h', 'שעתי (3 חודשים)']].map(([v, l]) =>
          h('option', { value: v, selected: gannViewState.tf === v }, l)
        )),
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => loadGannData(ui) }, '⟳ הרץ ניתוח גאן'),
      ),
    ),
  );

  // Honest explanation of the uploaded Gann materials & integrated modules
  mount(root, notice(
    'מקורות גאן שולבו במודול: הסקריפט gann indicator script sq9.txt (נוסחת הוויברציה המלאה של Square of 9), הספר wdgannbook_copy.pdf ומחשבון נקודות הכניסה מ-tools.gannexplained.com. הערה טכנית: קבצי ה-.wmv (MasterTimeCalculator.wmv ו-SquareRootPrices.wmv) הם קבצי וידאו להדרכה ולא תוכנות הרצה, ולכן מימשתי את כל האלגוריתמים המתמטיים שלהם (Square Root Prices + Master Time & Calendar + Angles) ישירות במנוע ה-JavaScript כאן.',
    'blue',
  ));

  if (gannViewState.loading) {
    mount(root, h('div', { class: 'card', style: { marginTop: '14px', padding: '40px', textAlign: 'center' } },
      h('div', { text: '⏳ טוען היסטוריה מקסימלית ומחשב מחזורי גאן, זוויות וריבוע התשע…' }),
    ));
    return;
  }

  if (gannViewState.error || !a) {
    mount(root, h('div', { class: 'card', style: { marginTop: '14px' } },
      empty(gannViewState.error || 'בחר נכס ולחץ "הרץ ניתוח גאן"'),
    ));
    return;
  }

  mount(root,
    // KPI summary row
    h('div', { class: 'grid cols-4', style: { marginTop: '14px' } },
      h('div', { class: 'metric' }, h('span', { text: 'טווח היסטורי נבדק' }), h('b', { text: `${a.spanDays} ימים (${a.candlesCount} נרות)` })),
      h('div', { class: 'metric' }, h('span', { text: 'שיעור פגיעת חיזויי גאן בעבר' }), h('b', { class: a.hitRatePct >= 50 ? 'green mono' : 'gold mono', text: `${a.hitRatePct}% (${a.totalHits}/${a.totalTests})` })),
      h('div', { class: 'metric' }, h('span', { text: 'עוגן ראשי (Anchor Pivot)' }), h('b', { class: 'mono', text: `${num(a.anchorPivot.price, 2)} (${a.anchorPivot.type === 'low' ? 'שפל' : 'שיא'})` })),
      h('div', { class: 'metric' }, h('span', { text: 'יחס לזווית 1x1 (45°)' }), h('b', { class: a.angle1x1?.abovePrice ? 'green' : 'red', text: a.angle1x1?.abovePrice ? 'מעל 1x1 (שורי)' : 'מתחת ל-1x1 (דובי)' })),
    ),

    // Interactive Gann Forecast Chart
    h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'card-head' },
        h('div', {},
          h('h2', { text: `${gannViewState.symbol} · מפת מחיר-זמן וחיזויים עתידיים (${marketState.provider || 'חי'})` }),
          h('div', { class: 'card-sub', text: 'נקודות ירוקות/אדומות = נקודות ציר היסטוריות · קווים אופקיים = רמות Square of 9 · קווים סגולים/זהב מימין = חלונות ציר עתידיים' }),
        ),
        tag(`מחיר נוכחי: ${num(a.currentPrice, 2)}`, 'live'),
      ),
      renderGannForecastSvg(gannViewState.candles, a),
    ),

    // Future Projected Pivot Dates + Square of 9 Table
    h('div', { class: 'grid cols-2', style: { marginTop: '14px' } },
      h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('div', {},
            h('h2', { text: '🔮 נקודות ציר עתידיות אפשריות (תאריך + מחיר)' }),
            h('div', { class: 'card-sub', text: 'מחושב מהתכנסות מחזורי זמן (30–360 יום) ורמות Square of 9' }),
          ),
        ),
        a.futurePivots.length
          ? h('div', { class: 'table-wrap' },
            h('table', {},
              h('thead', {}, h('tr', {},
                h('th', { text: 'תאריך ציר צפוי' }),
                h('th', { text: 'בעוד' }),
                h('th', { text: 'עוצמת התכנסות' }),
                h('th', { text: 'יעדי Sq9 קרובים' }),
              )),
              h('tbody', {}, a.futurePivots.map((fp) => h('tr', {},
                h('td', { class: 'mono', text: fp.date }),
                h('td', { class: 'mono', text: `+${fp.daysAhead} ימים` }),
                h('td', {}, tag(`${fp.confluenceLabel} (${fp.score})`, fp.score >= 5 ? 'live' : fp.score >= 3 ? 'opt' : 'dry')),
                h('td', { class: 'tiny muted', text: `${fp.targetUp ? '↑ ' + num(fp.targetUp, 2) : ''} ${fp.targetDown ? '· ↓ ' + num(fp.targetDown, 2) : ''}` }),
              ))),
            ),
          )
          : empty('אין חלונות עתידיים בטווח שנבחר'),
      ),

      h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('div', {},
            h('h2', { text: '📐 רמות ויברציה Square of 9 + זוויות גאן' }),
            h('div', { class: 'card-sub', text: 'נוסחה: Price = (√Anchor + (Degree / 180) × Dir)²' }),
          ),
        ),
        h('div', { class: 'table-wrap' },
          h('table', {},
            h('thead', {}, h('tr', {},
              h('th', { text: 'מעלה' }),
              h('th', { text: 'סוג' }),
              h('th', { text: 'מחיר יעד' }),
              h('th', { text: 'מרחק' }),
            )),
            h('tbody', {}, a.sq9Levels.slice(0, 10).map((l) => h('tr', {},
              h('td', { class: 'mono', text: `${l.degree}°` }),
              h('td', {}, tag(l.type, l.isCardinal ? 'live' : 'dry')),
              h('td', { class: 'mono', text: num(l.price, 2) }),
              h('td', { class: 'mono ' + (l.distPct >= 0 ? 'green' : 'red'), text: pct(l.distPct) }),
            ))),
          ),
        ),
      ),
    ),

    // Historical Validation Proof Table
    h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'card-head' },
        h('div', {},
          h('h2', { text: '🏆 הוכחת הצלחת החיזויים של גאן בעבר (Historical Backtest)' }),
          h('div', { class: 'card-sub', text: 'כל שורה מציגה נקודת ציר אמיתית בעבר, את מחזור הזמן של גאן שהופעל ממנה, ואת נקודת ההיפוך שקרתה בפועל בשוק' }),
        ),
        tag(`אחוז פגיעה: ${a.hitRatePct}%`, a.hitRatePct >= 50 ? 'live' : 'opt'),
      ),
      a.validations.length
        ? h('div', { class: 'table-wrap' },
          h('table', {},
            h('thead', {}, h('tr', {},
              h('th', { text: 'ציר מקור' }),
              h('th', { text: 'מחזור גאן' }),
              h('th', { text: 'תאריך חזוי' }),
              h('th', { text: 'ציר בפועל בשוק' }),
              h('th', { text: 'סטייה' }),
              h('th', { text: 'תנועה במחיר' }),
            )),
            h('tbody', {}, a.validations.map((v) => h('tr', {},
              h('td', { class: 'small', text: `${v.originDate} (${v.originType} · ${num(v.originPrice, 2)})` }),
              h('td', { class: 'small', text: v.cycleLabel }),
              h('td', { class: 'mono', text: v.predictedDate }),
              h('td', { class: 'small', text: `${v.actualPivotDate} (${v.actualType} · ${num(v.actualPrice, 2)})` }),
              h('td', { class: 'mono green', text: `±${v.errorDays}d` }),
              h('td', { class: 'mono ' + (v.movePct >= 0 ? 'green' : 'red'), text: pct(v.movePct) }),
            ))),
          ),
        )
        : empty('לא נמצאו פגיעות בטווח שנבחר'),
    ),

    // Educational Breakdown of the 3 Gann Pillars
    h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'card-head' },
        h('div', {},
          h('h2', { text: '🎓 מדריך חינוכי: איך 3 הכלים של גאן משתלבים לחיזוי אחד?' }),
          h('div', { class: 'card-sub', text: 'מתוך כתבי W.D. Gann, סקריפט ה-Square of 9 ומחשבוני הזמן והשורש הריבועי' }),
        ),
      ),
      h('div', { class: 'grid cols-3', style: { gap: '12px' } },
        h('div', { class: 'card', style: { background: 'rgba(8, 14, 24, 0.85)' } },
          h('h3', { text: '1. מחירי שורש ריבועי (Square of 9)' }),
          h('p', { class: 'small muted', text: 'המחירים נעים בספירלה מתמטית סביב שורש ריבועי של שיא/שפל מרכזי. סיבוב של 90° (רבע מעגל = ±0.5 בשורש), 180° (±1.0) ו-360° (±2.0) יוצר רמות התנגדות ותמיכה הרמוניות מדויקות.' }),
        ),
        h('div', { class: 'card', style: { background: 'rgba(8, 14, 24, 0.85)' } },
          h('h3', { text: '2. זוויות גאן (1x1, 2x1, 1x2)' }),
          h('p', { class: 'small muted', text: 'זווית ה-1x1 (45°) מייצגת שיווי משקל מושלם בין יחידת מחיר ליחידת זמן. כל עוד המחיר מעל קו ה-1x1 משפל מרכזי, השוק בשליטת קונים; שבירה מתחתיו מאותתת על מעבר מגמה.' }),
        ),
        h('div', { class: 'card', style: { background: 'rgba(8, 14, 24, 0.85)' } },
          h('h3', { text: '3. מחזורי זמן ולוח שנה (Master Time)' }),
          h('p', { class: 'small muted', text: 'לפי גאן "כאשר הזמן מסתיים — המחיר חייב להתהפך". ספירת ימי לוח שנה (45, 90, 144, 180, 360 יום) משיאים ושפלים קודמים מסמנת תאריכי מפנה עתידיים, במיוחד כשכמה מחזורים מתכנסים לאותו שבוע.' }),
        ),
      ),
    ),
  );
}
