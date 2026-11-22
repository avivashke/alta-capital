import { mount, h, num, notice } from '../ui.js';
import { store } from '../store.js';
import { marketState, getCandles, lastPrice, quotes, ASSET_CATALOG } from '../market.js';
import { ema, sma, rsi, macd, donchian, bollinger, atr } from '../indicators.js';

const MAX_BARS = 160;
const W = 12;
const GAP = 3;

let chartState = { key: null, loading: false, error: null, candles: null, symbol: null, tf: null };

function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }
function last(arr) { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null && Number.isFinite(arr[i])) return arr[i]; return null; }
function clamp(v,a,b){ return Math.max(a, Math.min(b,v)); }

async function loadCandles(ui, symbol, tf) {
  const key = symbol + '|' + tf;
  if (chartState.loading && chartState.key === key) return;
  chartState = { key, loading: true, error: null, candles: chartState.key === key ? chartState.candles : null, symbol, tf };
  ui.rerender();
  try {
    const candles = await getCandles(symbol, tf, { limit: MAX_BARS, force: false });
    if (!Array.isArray(candles) || !candles.length) throw new Error('לא התקבלו נרות');
    chartState = { key, loading: false, error: null, candles, symbol, tf };
  } catch (err) {
    chartState = { key, loading: false, error: err && err.message ? err.message : String(err), candles: null, symbol, tf };
  }
  ui.rerender();
}

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k,v] of Object.entries(attrs||{})) if (v != null) el.setAttribute(k, String(v));
  return el;
}

function chartWrap(svg, minW) {
  const w = h('div', { class: 'chart-canvas', style: { width: '100%', overflowX: 'auto', overflowY: 'hidden' } });
  if (minW) svg.style.minWidth = minW + 'px';
  w.appendChild(svg);
  return w;
}

function xAt(i) { return 46 + i * (W + GAP) + W / 2; }
function yScale(val, minV, maxV, pad, height) { const r = (maxV - minV) || 1; return pad + ((maxV - val) / r) * (height - pad * 2); }

function drawGrid(svg, width, height, minV, maxV, pad=18) {
  const ticks = 5;
  for (let i=0;i<ticks;i++){
    const v = minV + (maxV-minV)*(i/(ticks-1||1));
    const y = yScale(v,minV,maxV,pad,height);
    svg.appendChild(svgEl('line',{x1:40,x2:width,y1:y,y2:y,stroke:'#162235','stroke-width':1}));
    const t = svgEl('text',{x:4,y:y+4,fill:'#8fa3bf','font-size':'11','font-family':'IBM Plex Mono, monospace'});
    t.textContent = Math.abs(v)>=1000 ? v.toFixed(0) : v.toFixed(2);
    svg.appendChild(t);
  }
}

function polyline(svg, arr, start, show, minV, maxV, pad, height, color, width=2, dash=null) {
  const pts=[];
  for(let i=0;i<show;i++){ const v=arr[start+i]; if(v==null||!Number.isFinite(v)) continue; pts.push(xAt(i)+','+yScale(v,minV,maxV,pad,height)); }
  if(pts.length>1){ const p=svgEl('polyline',{points:pts.join(' '),fill:'none',stroke:color,'stroke-width':width}); if(dash) p.setAttribute('stroke-dasharray',dash); svg.appendChild(p); }
}

function renderCandles(candles) {
  const n=candles.length, show=Math.min(n,MAX_BARS), start=n-show;
  const slice=candles.slice(start);
  const highs=slice.map(c=>c.h), lows=slice.map(c=>c.l), opens=slice.map(c=>c.o), closes=slice.map(c=>c.c);
  const maxV=Math.max(...highs), minV=Math.min(...lows);
  const pad=20, height=360, width=60+show*(W+GAP);
  const svg=svgEl('svg',{width,height,viewBox:`0 0 ${width} ${height}`});
  svg.style.display='block'; svg.style.background='linear-gradient(180deg,#0b1220,#0a1018)';
  drawGrid(svg,width,height,minV,maxV,pad);

  const e20=ema(closes,20).slice(0), e50=ema(closes,50).slice(0), e200=ema(closes,200).slice(0);
  const bb=bollinger(closes,20,2);
  // Bollinger band fill approximation via upper/lower polylines
  polyline(svg, bb.upper||[], 0, show, minV,maxV,pad,height,'rgba(88,166,255,.35)',1,'4,4');
  polyline(svg, bb.mid||[], 0, show, minV,maxV,pad,height,'rgba(88,166,255,.55)',1.5,null);
  polyline(svg, bb.lower||[], 0, show, minV,maxV,pad,height,'rgba(88,166,255,.35)',1,'4,4');
  polyline(svg, e20, 0, show, minV,maxV,pad,height,'#58a6ff',1.8,null);
  polyline(svg, e50, 0, show, minV,maxV,pad,height,'#a78bfa',1.8,null);
  polyline(svg, e200, 0, show, minV,maxV,pad,height,'#f2cc60',1.4,'6,4');

  // Gann-like horizontal levels (Square-of-9 style octave levels from recent range)
  const range=maxV-minV || 1; const step=range/8;
  for(let g=0;g<=8;g++){
    const v=minV+g*step; const y=yScale(v,minV,maxV,pad,height);
    const imp=(g===0||g===4||g===8);
    svg.appendChild(svgEl('line',{x1:40,x2:width,y1:y,y2:y,stroke:imp?'rgba(242,204,96,.28)':'rgba(242,204,96,.12)','stroke-width':imp?1.2:1,'stroke-dasharray':'6,6'}));
  }

  for(let i=0;i<show;i++){
    const o=opens[i], c=closes[i], hi=highs[i], lo=lows[i];
    const x=46+i*(W+GAP); const up=c>=o; const color=up?'#2ecc71':'#f05b5b';
    const yHi=yScale(hi,minV,maxV,pad,height), yLo=yScale(lo,minV,maxV,pad,height);
    const yO=yScale(o,minV,maxV,pad,height), yC=yScale(c,minV,maxV,pad,height);
    svg.appendChild(svgEl('line',{x1:x+W/2,x2:x+W/2,y1:yHi,y2:yLo,stroke:color,'stroke-width':1}));
    svg.appendChild(svgEl('rect',{x,y:Math.min(yO,yC),width:Math.max(2,W-1),height:Math.max(1,Math.abs(yC-yO)),fill:color,rx:1}));
  }

  // volume bars
  const vols=slice.map(c=>c.v||0), vmax=Math.max(...vols,1), vH=50, base=height-4;
  for(let i=0;i<show;i++){
    const hBar=(vols[i]/vmax)*vH; const up=closes[i]>=opens[i];
    svg.appendChild(svgEl('rect',{x:46+i*(W+GAP),y:base-hBar,width:Math.max(2,W-1),height:Math.max(1,hBar),fill:up?'rgba(46,204,113,.25)':'rgba(240,91,91,.25)'}));
  }

  return chartWrap(svg, width);
}

function renderRSI(candles){
  const closes=candles.map(c=>c.c); const vals=rsi(closes,14);
  const n=vals.length, show=Math.min(n,MAX_BARS), start=n-show, slice=vals.slice(start);
  const width=60+show*(W+GAP), height=180, pad=18, minV=0, maxV=100;
  const svg=svgEl('svg',{width,height,viewBox:`0 0 ${width} ${height}`}); svg.style.display='block'; svg.style.background='#0b1220';
  drawGrid(svg,width,height,minV,maxV,pad);
  [30,50,70].forEach(v=>{ const y=yScale(v,minV,maxV,pad,height); svg.appendChild(svgEl('line',{x1:40,x2:width,y1:y,y2:y,stroke:v===50?'#64748b':'rgba(240,91,91,.5)','stroke-dasharray':'4,4'})); });
  polyline(svg, vals, start, show, minV,maxV,pad,height,'#58a6ff',2);
  return chartWrap(svg,width);
}

function renderMACD(candles){
  const closes=candles.map(c=>c.c); const m=macd(closes);
  const arr=m.hist||[]; const n=arr.length, show=Math.min(n,MAX_BARS), start=n-show;
  const hist=arr.slice(start), ml=(m.macd||m.line||[]).slice(start), sl=(m.signal||[]).slice(start);
  const vals=[...hist,...ml,...sl].filter(v=>v!=null&&Number.isFinite(v));
  const maxV=Math.max(1,...vals.map(v=>Math.abs(v)));
  const minV=-maxV, width=60+show*(W+GAP), height=180, pad=18;
  const svg=svgEl('svg',{width,height,viewBox:`0 0 ${width} ${height}`}); svg.style.display='block'; svg.style.background='#0b1220';
  drawGrid(svg,width,height,minV,maxV,pad);
  const zy=yScale(0,minV,maxV,pad,height); svg.appendChild(svgEl('line',{x1:40,x2:width,y1:zy,y2:zy,stroke:'#334155'}));
  for(let i=0;i<show;i++){ const v=hist[i]; if(v==null) continue; const x=46+i*(W+GAP); const y=yScale(v,minV,maxV,pad,height);
    svg.appendChild(svgEl('rect',{x,y:Math.min(y,zy),width:Math.max(2,W-1),height:Math.max(1,Math.abs(zy-y)),fill:v>=0?'rgba(46,204,113,.6)':'rgba(240,91,91,.6)'})); }
  polyline(svg,m.macd||m.line||[],start,show,minV,maxV,pad,height,'#58a6ff',1.6);
  polyline(svg,m.signal||[],start,show,minV,maxV,pad,height,'#f2cc60',1.6);
  return chartWrap(svg,width);
}

function gannVibrationPrice(anchor, degree, direction = 1) {
  const root = Math.sqrt(Math.max(anchor, 1e-9));
  const val = root + (degree / 180) * direction;
  return val > 0 ? Math.pow(val, 2) : 0;
}

function detectAutoPivot(slice, lookback = 20) {
  const n = slice.length;
  let anchorIdx = 0;
  let isBullish = true;
  let anchorPrice = slice[0]?.l || 1;
  for (let i = lookback; i < n - 2; i++) {
    let isHi = true;
    let isLo = true;
    for (let j = Math.max(0, i - lookback); j <= Math.min(n - 1, i + lookback); j++) {
      if (slice[j].h > slice[i].h) isHi = false;
      if (slice[j].l < slice[i].l) isLo = false;
    }
    if (isLo) { anchorIdx = i; anchorPrice = slice[i].l; isBullish = true; }
    if (isHi) { anchorIdx = i; anchorPrice = slice[i].h; isBullish = false; }
  }
  if (!anchorIdx) {
    for (let i = 1; i < n; i++) {
      if (slice[i].l < anchorPrice) { anchorPrice = slice[i].l; anchorIdx = i; isBullish = true; }
    }
  }
  return { anchorIdx, anchorPrice, isBullish };
}

function gannLevels(anchor, currentPrice) {
  const degrees = [45, 90, 135, 180, 225, 270, 315, 360];
  const levels = [];
  for (const deg of degrees) {
    const isCardinal = deg % 90 === 0;
    const up = gannVibrationPrice(anchor, deg, 1);
    const dn = gannVibrationPrice(anchor, deg, -1);
    if (up > 0 && Math.abs(up - currentPrice) / currentPrice < 0.35) {
      levels.push({ degree: deg, v: up, isCardinal, dir: 1 });
    }
    if (dn > 0 && Math.abs(dn - currentPrice) / currentPrice < 0.35) {
      levels.push({ degree: -deg, v: dn, isCardinal, dir: -1 });
    }
  }
  return levels;
}

function renderGann(candles) {
  const n = candles.length, show = Math.min(n, MAX_BARS), start = n - show;
  const slice = candles.slice(start);
  const closes = slice.map((c) => c.c);
  const highs = slice.map((c) => c.h), lows = slice.map((c) => c.l);
  const lastP = closes[closes.length - 1] || 1;
  const pivot = detectAutoPivot(slice, 16);
  const levels = gannLevels(pivot.anchorPrice, lastP);
  const lv = levels.map((x) => x.v);
  const maxV = Math.max(...highs, ...lv);
  const minV = Math.min(...lows, ...lv);
  const width = 60 + show * (W + GAP), height = 310, pad = 20;
  const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}` });
  svg.style.display = 'block';
  svg.style.background = '#0b1220';
  drawGrid(svg, width, height, minV, maxV, pad);

  // Price line
  polyline(svg, closes, 0, show, minV, maxV, pad, height, '#58a6ff', 2);

  // Anchor line & marker
  const px = xAt(pivot.anchorIdx), py = yScale(pivot.anchorPrice, minV, maxV, pad, height);
  svg.appendChild(svgEl('circle', { cx: px, cy: py, r: 4.5, fill: pivot.isBullish ? '#2ecc71' : '#f05b5b' }));

  // Gann Square of 9 Vibration Levels (Cardinal 90° solid, Ordinal 45° dashed)
  levels.forEach((lvl) => {
    const y = yScale(lvl.v, minV, maxV, pad, height);
    const stroke = lvl.isCardinal ? 'rgba(41, 98, 255, 0.85)' : 'rgba(167, 139, 250, 0.55)';
    svg.appendChild(svgEl('line', {
      x1: px, x2: width, y1: y, y2: y,
      stroke,
      'stroke-width': lvl.isCardinal ? 1.6 : 1,
      'stroke-dasharray': lvl.isCardinal ? '0' : '5,4',
    }));
    const t = svgEl('text', { x: width - 135, y: y - 3, fill: lvl.isCardinal ? '#7dd3fc' : '#c4b5fd', 'font-size': '10' });
    t.textContent = `${lvl.degree}° (${lvl.isCardinal ? 'Cardinal' : 'Ordinal'}) ${lvl.v.toFixed(2)}`;
    svg.appendChild(t);
  });

  // Gann fan rays from pivot
  const angles = [82.5, 75, 71.25, 63.75, 45, 26.25, 18.75, 15, 7.5];
  angles.forEach((ang, i) => {
    const rad = (ang * Math.PI) / 180;
    const dir = i < 4 ? -1 : (i === 4 ? -0.2 : 1);
    const x2 = width, dx = x2 - px;
    const y2 = py + dir * Math.tan(rad) * dx * 0.15;
    svg.appendChild(svgEl('line', {
      x1: px, y1: py, x2, y2,
      stroke: i === 4 ? 'rgba(46,204,113,.65)' : 'rgba(242,204,96,.24)',
      'stroke-width': i === 4 ? 1.5 : 1,
    }));
  });
  return chartWrap(svg, width);
}

function signalSummary(candles){
  const closes=candles.map(c=>c.c);
  const r=last(rsi(closes,14));
  const m=macd(closes);
  const mh = last(m.hist||[]);
  const mLine = last(m.macd||m.line||[]);
  const mSig = last(m.signal||[]);
  const e20=last(ema(closes,20)), e50=last(ema(closes,50)), e200=last(ema(closes,200));
  const bb = bollinger(closes,20,2);
  const bbUp = last(bb.upper||[]), bbMid = last(bb.mid||[]), bbLo = last(bb.lower||[]);
  const atrVal = last(atr(candles, 14) || []);
  const p=closes[closes.length-1];
  let score=0; const notes=[];
  if(r!=null){ if(r<35){score++; notes.push('RSI מכירת־יתר');} else if(r>70){score--; notes.push('RSI קניית־יתר');} else notes.push('RSI נייטרלי'); }
  if(mh!=null){ if(mh>0){score++; notes.push('MACD חיובי');} else {score--; notes.push('MACD שלילי');} }
  if(e20!=null&&e50!=null){ if(e20>e50){score++; notes.push('EMA20 מעל EMA50');} else {score--; notes.push('EMA20 מתחת EMA50');} }
  if(p!=null&&e20!=null){ if(p>e20){score++;} else {score--; } }
  const bias = score>=2?'שורי':score<=-2?'דובי':'נייטרלי';
  return { bias, score, notes, r, mh, mLine, mSig, e20, e50, e200, bbUp, bbMid, bbLo, atrVal, p };
}

function fmtPrice(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  return num(n, Math.abs(n) >= 100 ? 2 : 4);
}

function legendItem(color, label, dashed = false) {
  return h('span', {
    class: 'tiny',
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      padding: '3px 7px',
      borderRadius: '6px',
      background: 'rgba(15, 23, 42, 0.72)',
      border: '1px solid rgba(148, 163, 184, 0.18)',
      color: '#cbd5e1',
    },
  },
    h('span', {
      style: {
        display: 'inline-block',
        width: '14px',
        height: '0px',
        borderTop: `2.5px ${dashed ? 'dashed' : 'solid'} ${color}`,
      },
    }),
    label,
  );
}

function explainBox(title, liveText, bullets = []) {
  return h('div', {
    style: {
      marginTop: '10px',
      padding: '10px 12px',
      borderRadius: '10px',
      background: 'rgba(11, 18, 32, 0.85)',
      border: '1px solid rgba(88, 166, 255, 0.22)',
      fontSize: '12.5px',
      lineHeight: '1.6',
      color: '#cbd5e1',
    },
  },
    h('div', { style: { fontWeight: 700, color: '#93c5fd', marginBottom: '4px' }, text: title }),
    liveText ? h('div', { style: { color: '#f1f5f9', marginBottom: bullets.length ? '6px' : '0' }, text: liveText }) : null,
    bullets.length
      ? h('ul', { style: { margin: '0', paddingRight: '18px', display: 'grid', gap: '3px' } },
          bullets.map((b) => h('li', { text: b })),
        )
      : null,
  );
}

function buildMainChartReading(sig, symbol) {
  const parts = [];
  if (sig.p != null && sig.e20 != null && sig.e50 != null) {
    if (sig.p > sig.e20 && sig.e20 > sig.e50) {
      parts.push(`המחיר (${fmtPrice(sig.p)}) נמצא מעל EMA20 (${fmtPrice(sig.e20)}) שמעל EMA50 (${fmtPrice(sig.e50)}) — מבנה מגמה עולה תקין.`);
    } else if (sig.p < sig.e20 && sig.e20 < sig.e50) {
      parts.push(`המחיר (${fmtPrice(sig.p)}) נמצא מתחת ל-EMA20 (${fmtPrice(sig.e20)}) שמתחת ל-EMA50 (${fmtPrice(sig.e50)}) — לחץ ירידות / מגמה דובית.`);
    } else {
      parts.push(`המחיר (${fmtPrice(sig.p)}) נע בין הממוצעים EMA20 (${fmtPrice(sig.e20)}) ו-EMA50 (${fmtPrice(sig.e50)}) — אזור דשדוש או מעבר מגמה.`);
    }
  }
  if (sig.p != null && sig.e200 != null) {
    parts.push(sig.p >= sig.e200
      ? `מעל EMA200 (${fmtPrice(sig.e200)}) = מגמה ארוכת טווח חיובית.`
      : `מתחת ל-EMA200 (${fmtPrice(sig.e200)}) = מגמה ארוכת טווח שלילית.`);
  }
  if (sig.p != null && sig.bbUp != null && sig.bbLo != null) {
    if (sig.p >= sig.bbUp) parts.push('המחיר נוגע/פורץ את רצועת בולינגר העליונה — מתיחה חזקה למעלה (זהירות מתיקון קצר או פריצת מומנטום).');
    else if (sig.p <= sig.bbLo) parts.push('המחיר נוגע/שובר את רצועת בולינגר התחתונה — מתיחה חדה למטה (פוטנציאל לריבאונד או האצת ירידה).');
    else parts.push('המחיר בתוך רצועות בולינגר — תנודתיות תקינה.');
  }
  return parts.length ? `${symbol}: ${parts.join(' ')}` : 'טוען ניתוח מגמה וממוצעים נעים…';
}

function buildRsiReading(sig) {
  if (sig.r == null) return 'אין עדיין מספיק נרות לחישוב RSI(14).';
  const val = sig.r.toFixed(1);
  if (sig.r >= 70) return `ערך נוכחי: ${val} — אזור קניית-יתר (Overbought). העליות מהירות מאוד ויש סיכון מוגבר למימוש או תיקון.`;
  if (sig.r <= 30) return `ערך נוכחי: ${val} — אזור מכירת-יתר (Oversold). לחץ המכירות קיצוני ועשוי להיווצר תיקון כלפי מעלה.`;
  if (sig.r >= 55) return `ערך נוכחי: ${val} — מומנטום חיובי (מעל קו ה-50) בלי קיצון של קניית-יתר.`;
  if (sig.r <= 45) return `ערך נוכחי: ${val} — מומנטום חלש/שלילי (מתחת לקו ה-50), המוכרים עדיין בשליטה יחסית.`;
  return `ערך נוכחי: ${val} — אזור מאוזן סביב קו ה-50 (אין הכרעה חזקה בין קונים למוכרים).`;
}

function buildMacdReading(sig) {
  if (sig.mh == null || sig.mLine == null || sig.mSig == null) return 'אין עדיין מספיק נרות לחישוב MACD.';
  const dir = sig.mh >= 0 ? 'חיובית (ירוקה)' : 'שלילית (אדומה)';
  const cross = sig.mLine >= sig.mSig
    ? 'קו ה-MACD נמצא מעל קו ה-Signal — המומנטום נוטה לעליות.'
    : 'קו ה-MACD נמצא מתחת לקו ה-Signal — המומנטום נוטה לירידות.';
  return `היסטוגרמה ${dir} (${sig.mh.toFixed(3)}) · ${cross}`;
}

function buildGannReading(candles) {
  const n = candles.length, show = Math.min(n, MAX_BARS), start = n - show;
  const slice = candles.slice(start);
  const lastP = slice[slice.length - 1]?.c || 0;
  const pivot = detectAutoPivot(slice, 16);
  const levels = gannLevels(pivot.anchorPrice, lastP);
  const above = levels.filter((l) => l.v > lastP).sort((a, b) => a.v - b.v)[0];
  const below = levels.filter((l) => l.v <= lastP).sort((a, b) => b.v - a.v)[0];
  const parts = [
    `עוגן גאן אוטומטי (${pivot.isBullish ? 'שפל' : 'שיא'}): ${fmtPrice(pivot.anchorPrice)}.`,
  ];
  if (below) parts.push(`תמיכת Square of 9 קרובה: ${fmtPrice(below.v)} (${below.degree}° ${below.isCardinal ? 'Cardinal חזקה' : 'Ordinal'}).`);
  if (above) parts.push(`התנגדות Square of 9 קרובה: ${fmtPrice(above.v)} (${above.degree}° ${above.isCardinal ? 'Cardinal חזקה' : 'Ordinal'}).`);
  return parts.join(' ');
}

export function renderCharts(root, ui) {
  const state = store.state;
  const deskId = ui.selectedDesk || (state.desks[0] && state.desks[0].id) || null;
  const desk = deskId ? state.desks.find(d=>d.id===deskId) : state.desks[0];
  const symbol = ui.customChartSymbol || (desk ? desk.symbol : 'BTCUSDT');
  const tf = ui.customChartTf || (desk ? desk.tf : '1h');
  const key = symbol + '|' + tf;

  if (chartState.key !== key && !chartState.loading) {
    setTimeout(()=>loadCandles(ui,symbol,tf),0);
  }

  const { loading, error, candles } = chartState.key===key ? chartState : { loading: !chartState.candles, error: null, candles: chartState.candles };

  const live = (quotes && quotes[symbol] && quotes[symbol].price) || (candles && candles.length ? candles[candles.length-1].c : lastPrice(symbol));

  mount(root,
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: 'Trading workstation · Charts & Indicators' }),
        h('h1', { text: 'גרפים ואינדיקטורים' }),
        h('p', { text: 'תחנת מסחר בסגנון מקצועי: נרות יפניים, EMA/בולינגר, RSI, MACD ורמות/זוויות גאן (מחיר וזמן) לכל שולחן.' }),
      ),
      h('div', { class: 'head-actions' },
        h('span', { class: marketState.synthetic ? 'pill pill-warn' : 'pill pill-sim', text: marketState.synthetic ? 'נתוני הדגמה (fallback)' : ('שוק חי · ' + (marketState.provider || 'Binance')) }),
        h('select', {
          class: 'input',
          value: symbol,
          onchange: (e) => {
            ui.customChartSymbol = e.target.value;
            chartState = { key: null, loading: false, error: null, candles: null };
            ui.rerender();
          },
        }, ASSET_CATALOG.map((a) => h('option', { value: a.symbol, selected: symbol === a.symbol }, a.label))),
        h('select', {
          class: 'input',
          value: tf,
          onchange: (e) => {
            ui.customChartTf = e.target.value;
            chartState = { key: null, loading: false, error: null, candles: null };
            ui.rerender();
          },
        }, ['5m', '15m', '1h', '1d', '1w'].map((t) => h('option', { value: t, selected: tf === t }, t))),
        h('button', { class: 'btn btn-sm btn-primary', onclick: ()=>loadCandles(ui,symbol,tf) }, 'רענן'),
      ),
    ),

    h('div', { class: 'grid cols-4', style: { marginTop: '10px' } },
      metric('סמל', symbol),
      metric('טיים-פריים', tf),
      metric('מחיר נוכחי', live!=null ? num(live, live>100?2:4) : '—'),
      metric('מקור', marketState.synthetic ? 'הדגמה' : (marketState.provider || 'חי')),
    ),
  );

  if (loading) {
    mount(root, h('div', { class: 'card', style: { marginTop: '14px', padding: '40px', textAlign: 'center' } }, h('div', { class: 'ic', text: '⏳' }), h('div', { text: 'טוען נתוני שוק ונרות…' })));
    return;
  }
  if (error) {
    mount(root, h('div', { class: 'notice bad', style: { marginTop: '14px' } }, h('span', { class: 'ic', text: '⚠️' }), h('span', { text: 'שגיאה בטעינת גרפים: ' + error })));
  }
  if (!candles || !candles.length) {
    mount(root, h('div', { class: 'card', style: { marginTop: '14px' } }, h('div', { class: 'empty', text: 'אין נתוני נרות להצגה כרגע. לחץ רענן או בחר שולחן אחר.' })));
    return;
  }

  const sig = safe(()=>signalSummary(candles), {bias:'—', notes:[]});
  const gannReading = safe(()=>buildGannReading(candles), '');
  const biasDesc = sig.bias === 'שורי'
    ? 'רוב האינדיקטורים מצביעים על מומנטום חיובי ומגמת עלייה.'
    : sig.bias === 'דובי'
      ? 'רוב האינדיקטורים מצביעים על חולשה ולחץ מוכרים.'
      : 'האינדיקטורים מעורבים — אין כרגע כיוון חד-משמעי (אזור המתנה/דשדוש).';

  mount(root,
    // Quick Plain-Hebrew Overview of what is currently visible on the charts
    h('div', {
      class: 'notice ' + (sig.bias === 'שורי' ? 'ok' : sig.bias === 'דובי' ? 'bad' : 'blue'),
      style: { marginTop: '14px', lineHeight: '1.6', fontSize: '13px' },
    },
      h('div', {},
        h('strong', { text: `🧭 מה רואים עכשיו ב-${symbol} (${tf}) · הטיה כוללת: ${sig.bias}` }),
        h('div', { text: `${biasDesc}${sig.atrVal != null ? ` · תנודתיות ממוצעת לנר (ATR 14): ±${fmtPrice(sig.atrVal)}.` : ''}` }),
      ),
    ),

    h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'card-head' },
        h('div', {}, h('h2', { text: symbol + ' · ' + tf + ' · גרף ראשי' }), h('div', { class: 'card-sub', text: 'נרות + EMA20/50/200 + בולינגר + רמות גאן + נפח' })),
        h('span', { class: 'pill ' + (sig.bias==='שורי'?'pill-live':sig.bias==='דובי'?'pill-warn':'pill-sim'), text: 'הטיה: ' + sig.bias }),
      ),
      h('div', { class: 'row wrap', style: { gap: '6px', marginBottom: '8px' } },
        legendItem('#2ecc71', 'נר עולה (ירוק)'),
        legendItem('#f05b5b', 'נר יורד (אדום)'),
        legendItem('#58a6ff', 'EMA 20 (קצר)'),
        legendItem('#a78bfa', 'EMA 50 (בינוני)'),
        legendItem('#f2cc60', 'EMA 200 (מגמה ארוכה)', true),
        legendItem('rgba(88,166,255,.75)', 'בולינגר (20,2)', true),
        legendItem('rgba(242,204,96,.6)', 'שמיניות גאן', true),
      ),
      safe(()=>renderCandles(candles), h('div', { class: 'empty', text: 'שגיאה ברינדור הגרף הראשי' })),
      h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '8px' } }, ...(sig.notes||[]).map(n=>h('span',{class:'tag',text:n}))),
      explainBox(
        '📖 מה רואים בגרף הראשי ומה זה אומר?',
        buildMainChartReading(sig, symbol),
        [
          'נרות יפניים + נפח (בתחתית): נר ירוק = המחיר עלה בתוך הנר (הקונים שלטו); נר אדום = המחיר ירד. עמודות גבוהות בתחתית מעידות על נפח מסחר חזק שמאשר את התנועה.',
          'ממוצעים נעים (EMA 20 כחול / EMA 50 סגול / EMA 200 צהוב מקווקו): כש-EMA20 מעל EMA50 והמחיר מעליהם — מגמה עולה. EMA200 משמש קו גבול מרכזי בין שוק שורי (מעליו) לדובי (מתחתיו).',
          'רצועות בולינגר (כחול מקווקו): מודדות תנודתיות סביב ממוצע 20. נגיעה ברצועה העליונה = מתיחה למעלה; נגיעה בתחתונה = מתיחה למטה; התכווצות של הרצועות (Squeeze) מרמזת לרוב על תנועה חדה קרובה.',
          'קווי שמיניות גאן (צהוב אופקי מקווקו): מחלקים את טווח המחיר ל-8 חלקים שווים — קו ה-50% (האמצעי) הוא רמת איזון חשובה לתמיכה והתנגדות.',
        ],
      ),
    ),
    h('div', { class: 'grid cols-2', style: { marginTop: '14px' } },
      h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('div', {}, h('h2', { text: 'RSI (14)' }), h('div', { class: 'card-sub', text: 'מדד עוצמה יחסית (מומנטום) · גבולות 30 / 50 / 70' })),
          sig.r != null ? h('span', { class: 'pill ' + (sig.r >= 70 ? 'pill-warn' : sig.r <= 30 ? 'pill-live' : 'pill-sim'), text: `RSI: ${sig.r.toFixed(1)}` }) : null,
        ),
        safe(()=>renderRSI(candles), h('div',{class:'empty',text:'שגיאה ב-RSI'})),
        explainBox(
          '📖 איך קוראים את RSI (14)?',
          buildRsiReading(sig),
          [
            'מעל 70 (קו אדום עליון): קניית-יתר (Overbought) — הנכס עלה מהר יחסית, ויש סיכון לתיקון או עצירה.',
            'מתחת ל-30 (קו אדום תחתון): מכירת-יתר (Oversold) — ירידה חדה שעשויה להוביל לריבאונד.',
            'קו 50 (אפור באמצע): מעל 50 המומנטום שורי, מתחת ל-50 המומנטום דובי.',
          ],
        ),
      ),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('div', {}, h('h2', { text: 'MACD (12,26,9)' }), h('div', { class: 'card-sub', text: 'זיהוי שינויי מגמה ומומנטום' })),
          sig.mh != null ? h('span', { class: 'pill ' + (sig.mh >= 0 ? 'pill-live' : 'pill-warn'), text: sig.mh >= 0 ? 'מומנטום חיובי' : 'מומנטום שלילי' }) : null,
        ),
        h('div', { class: 'row wrap', style: { gap: '6px', marginBottom: '8px' } },
          legendItem('#58a6ff', 'קו MACD'),
          legendItem('#f2cc60', 'קו Signal'),
          legendItem('#2ecc71', 'היסטוגרמה חיובית'),
          legendItem('#f05b5b', 'היסטוגרמה שלילית'),
        ),
        safe(()=>renderMACD(candles), h('div',{class:'empty',text:'שגיאה ב-MACD'})),
        explainBox(
          '📖 איך קוראים את MACD?',
          buildMacdReading(sig),
          [
            'חציית קו MACD (כחול) מעל קו Signal (צהוב) = איתות מומנטום שורי; חצייה מתחתיו = איתות דובי.',
            'עמודות ההיסטוגרמה מראות את המרחק בין שני הקווים: עמודות ירוקות שגדלות = האצת עליות; עמודות שמתקצרות = היחלשות המומנטום ואפשרות להיפוך.',
            'חצייה של קו ה-0 מאשרת מעבר רחב יותר בין מגמת ירידה למגמת עלייה (ולהפך).',
          ],
        ),
      ),
    ),
    h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', { text: 'אינדיקטורי גאן — מחיר וזמן' }), h('div', { class: 'card-sub', text: 'רמות גאן (Square of 9) ומניפות זווית (Gann Fan) על גבי מחיר — שימוש למחקר אסטרטגיות גאן טכניות ומחזורי זמן' }))),
      h('div', { class: 'row wrap', style: { gap: '6px', marginBottom: '8px' } },
        legendItem('#58a6ff', 'קו מחיר'),
        legendItem('rgba(41, 98, 255, 0.95)', 'Cardinal (90°/180°/270°/360° — חזק)'),
        legendItem('rgba(167, 139, 250, 0.85)', 'Ordinal (45°/135°/225°/315° — ביניים)', true),
        legendItem('rgba(46,204,113,.85)', 'זווית גאן 1x1 (45° — קו האיזון)'),
        legendItem('rgba(242,204,96,.65)', 'שאר קרני מניפת גאן'),
      ),
      safe(()=>renderGann(candles), h('div',{class:'empty',text:'שגיאה ברינדור גאן'})),
      explainBox(
        '📖 מה רואים בגרף גאן (Square of 9 + מניפת זוויות) ומה זה אומר?',
        gannReading,
        [
          'נקודת העוגן (הנקודה הירוקה/אדומה): שפל או שיא משמעותי אחרון שממנו מחושבים כל קווי התמיכה, ההתנגדות והזוויות.',
          'רמות Cardinal (כחול רציף — 90°, 180°, 270°, 360°): רמות תמיכה והתנגדות ראשיות וחזקות לפי ריבוע התשע (Square of 9). מחיר נוטה להיעצר או להתהפך סביבן.',
          'רמות Ordinal (סגול מקווקו — 45°, 135°, 225°, 315°): רמות ביניים משניות — שימושיות ליעדים קצרים או זיהוי בלימה מוקדמת.',
          'מניפת גאן (הקרניים האלכסוניות): הקו הירוק (45° / 1x1) מייצג איזון של יחידת מחיר ליחידת זמן. כל עוד המחיר מעליו — המגמה חזקה; שבירה מתחתיו מאותתת על היחלשות המגמה.',
        ],
      ),
      notice('רמות וזוויות גאן מחושבות אלגוריתמית מנתוני המחיר (הערכה/מחקר). לניתוח גאן מלא כולל תאריכי היפוך, לוח שנה ומודיעין קבוצת הוואטסאפ — עבור לעמוד "גאן".', 'blue'),
    ),
  );
}

function metric(label, value){
  return h('div',{class:'metric'}, h('span',{text:label}), h('b',{class:'mono',text:value==null?'—':String(value)}));
}
