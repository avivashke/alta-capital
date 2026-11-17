import { mount, h, num, notice } from '../ui.js';
import { store } from '../store.js';
import { marketState, getCandles, lastPrice, quotes } from '../market.js';
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

function gannLevels(price){
  // Square of 9 style cardinal levels around current price (approximation)
  const root=Math.sqrt(Math.max(price,1)); const levels=[];
  [-2,-1,-0.5,0,0.5,1,2].forEach(k=>{ const v=Math.pow(root+k*0.25,2); if(v>0) levels.push({k,v}); });
  return levels;
}

function renderGann(candles){
  const n=candles.length, show=Math.min(n,MAX_BARS), start=n-show;
  const slice=candles.slice(start); const closes=slice.map(c=>c.c);
  const highs=slice.map(c=>c.h), lows=slice.map(c=>c.l);
  const lastP=closes[closes.length-1]||1; const lv=gannLevels(lastP).map(x=>x.v);
  const maxV=Math.max(...highs, ...lv), minV=Math.min(...lows, ...lv);
  const width=60+show*(W+GAP), height=280, pad=20;
  const svg=svgEl('svg',{width,height,viewBox:`0 0 ${width} ${height}`}); svg.style.display='block'; svg.style.background='#0b1220';
  drawGrid(svg,width,height,minV,maxV,pad);
  // price line
  polyline(svg, closes, 0, show, minV,maxV,pad,height,'#58a6ff',2);
  // Gann horizontal levels
  lv.forEach((v,idx)=>{ const y=yScale(v,minV,maxV,pad,height); const major=Math.abs(v-lastP)/lastP < 0.001 || idx%3===0;
    svg.appendChild(svgEl('line',{x1:40,x2:width,y1:y,y2:y,stroke:major?'rgba(242,204,96,.75)':'rgba(242,204,96,.28)','stroke-width':major?1.6:1,'stroke-dasharray':major?'0':'6,5'}));
    const t=svgEl('text',{x:width-120,y:y-3,fill:'#f2cc60','font-size':'10'}); t.textContent='Gann '+v.toFixed(2); svg.appendChild(t);
  });
  // Gann fan rays from pivot (recent low)
  let pIdx=0; for(let i=1;i<slice.length;i++) if(slice[i].l < slice[pIdx].l) pIdx=i;
  const px=xAt(pIdx), py=yScale(slice[pIdx].l,minV,maxV,pad,height);
  const angles=[82.5,75,71.25,63.75,45,26.25,18.75,15,7.5];
  angles.forEach((ang,i)=>{ const rad=ang*Math.PI/180; const dir = i<4? -1 : (i===4? -0.2: 1);
    const x2=width, dx=x2-px; const y2=py + dir*Math.tan(rad)*dx*0.15; // scaled for readability
    svg.appendChild(svgEl('line',{x1:px,y1:py,x2,y2,stroke:i===4?'rgba(46,204,113,.6)':'rgba(167,139,250,.35)','stroke-width':i===4?1.5:1}));
  });
  return chartWrap(svg,width);
}

function signalSummary(candles){
  const closes=candles.map(c=>c.c); const r=last(rsi(closes,14)); const m=macd(closes);
  const mh = last(m.hist||[]); const e20=last(ema(closes,20)), e50=last(ema(closes,50)); const p=closes[closes.length-1];
  let score=0; const notes=[];
  if(r!=null){ if(r<35){score++; notes.push('RSI מכירת־יתר');} else if(r>70){score--; notes.push('RSI קניית־יתר');} else notes.push('RSI נייטרלי'); }
  if(mh!=null){ if(mh>0){score++; notes.push('MACD חיובי');} else {score--; notes.push('MACD שלילי');} }
  if(e20!=null&&e50!=null){ if(e20>e50){score++; notes.push('EMA20 מעל EMA50');} else {score--; notes.push('EMA20 מתחת EMA50');} }
  if(p!=null&&e20!=null){ if(p>e20){score++;} else {score--; } }
  const bias = score>=2?'שורי':score<=-2?'דובי':'נייטרלי';
  return { bias, notes, r, mh, e20, e50, p };
}

export function renderCharts(root, ui) {
  const state = store.state;
  const deskId = ui.selectedDesk || (state.desks[0] && state.desks[0].id) || null;
  const desk = deskId ? state.desks.find(d=>d.id===deskId) : state.desks[0];
  const symbol = desk ? desk.symbol : 'BTCUSDT';
  const tf = desk ? desk.tf : '1h';
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
        h('select', { class: 'input', value: deskId || '', onchange: (e)=>{ ui.selectedDesk=e.target.value; chartState={key:null,loading:false,error:null,candles:null}; ui.rerender(); } },
          state.desks.map(d=>h('option',{value:d.id}, d.label + ' · ' + d.symbol + ' · ' + d.tf))
        ),
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
  mount(root,
    h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'card-head' },
        h('div', {}, h('h2', { text: symbol + ' · ' + tf + ' · גרף ראשי' }), h('div', { class: 'card-sub', text: 'נרות + EMA20/50/200 + בולינגר + רמות גאן + נפח' })),
        h('span', { class: 'pill ' + (sig.bias==='שורי'?'pill-live':sig.bias==='דובי'?'pill-warn':'pill-sim'), text: 'הטיה: ' + sig.bias }),
      ),
      safe(()=>renderCandles(candles), h('div', { class: 'empty', text: 'שגיאה ברינדור הגרף הראשי' })),
      h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '8px' } }, ...(sig.notes||[]).map(n=>h('span',{class:'tag',text:n}))),
    ),
    h('div', { class: 'grid cols-2', style: { marginTop: '14px' } },
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('div', {}, h('h2', { text: 'RSI (14)' }), h('div', { class: 'card-sub', text: 'מומנטום · 30/70' }))),
        safe(()=>renderRSI(candles), h('div',{class:'empty',text:'שגיאה ב-RSI'})),
      ),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('div', {}, h('h2', { text: 'MACD (12,26,9)' }), h('div', { class: 'card-sub', text: 'היסטוגרמה + קו MACD/סיגנל' }))),
        safe(()=>renderMACD(candles), h('div',{class:'empty',text:'שגיאה ב-MACD'})),
      ),
    ),
    h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', { text: 'אינדיקטורי גאן — מחיר וזמן' }), h('div', { class: 'card-sub', text: 'רמות גאן (Square of 9) ומניפות זווית (Gann Fan) על גבי מחיר — שימוש למחקר אסטרטגיות גאן טכניות ומחזורי זמן' }))),
      safe(()=>renderGann(candles), h('div',{class:'empty',text:'שגיאה ברינדור גאן'})),
      notice('רמות וזוויות גאן מחושבות אלגוריתמית מנתוני המחיר (הערכה/מחקר). לשילוב עם מחזורי זמן/לוח שנה — הסוכנים חוקרים ומטמיעים אסטרטגיות גאן במחקר ובמעבדת האסטרטגיות.', 'blue'),
    ),
  );
}

function metric(label, value){
  return h('div',{class:'metric'}, h('span',{text:label}), h('b',{class:'mono',text:value==null?'—':String(value)}));
}
