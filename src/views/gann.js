// Dedicated Educational & Interactive Gannzilla / Michael Jenkins Forecasting Lab (#/gann)
// Integrates Square of 9, Hexagon (60°), Jenkins Square-Root Time & Eighths, Gannzilla Seasonal Wheel,
// Multi-Asset Proof Scanner, and Gann vs. Fundamental Events Historical Proof.

import { store } from '../store.js';
import { h, mount, num, pct, tag, notice, empty, toast, openModal, timeAgo } from '../ui.js';
import { getCandles, marketState, ASSET_CATALOG } from '../market.js';
import {
  analyzeGannHistoryAndForecast,
  generateGannWorkingProposals,
  searchGannLibrary,
  runAutonomousGannLibraryAudit,
  runAutonomousGannLibraryAuditIfDue,
} from '../gann.js';
import { chatDetailed } from '../llm.js';

let gannViewState = {
  symbol: 'BTCUSDT',
  customSymbol: '',
  tf: '1d',
  manualPrice: '',
  manualDate: '',
  wheelMode: 'sq9', // 'sq9' | 'hex' | 'cosmos'
  calcTab: 'jenkins', // 'jenkins' | 'eighths' | 'sq9' | 'hex'
  calendarTab: 'zodiac12', // 'zodiac12' | 'planetary' | 'squares' | 'seasonal'
  loading: false,
  error: null,
  candles: null,
  analysis: null,
  key: null,
  multiScanLoading: false,
  multiScanResults: null,
  aiLoading: false,
  aiAdvice: null,
  libQuery: '',
  libKind: 'all',
  libLoading: false,
};

async function askAiForGannProposal(a, ui) {
  if (gannViewState.aiLoading || !a) return;
  gannViewState.aiLoading = true;
  ui.rerender();
  const prompt = [
    `נתח את הנכס ${gannViewState.symbol} (${gannViewState.tf}) לפי נתוני Gannzilla בזמן אמת:`,
    `- מחיר נוכחי: ${a.currentPrice}, עוגן: ${a.anchorPivot.price} (${a.anchorPivot.type}), טבעת Sq9 #${a.jenkins.ringNumber}`,
    `- זווית 1x1: ${a.angle1x1?.abovePrice ? 'מעל 1x1 (שורי)' : 'מתחת ל-1x1 (דובי)'} (${a.angle1x1?.projectedNow})`,
    `- רמות Sq9 קרובות: ${a.sq9Levels.slice(0, 4).map((l) => `${l.degree}°=${l.price}`).join(', ')}`,
    `- חלון ציר עתידי קרוב: ${a.futurePivots[0]?.date || '—'} (${a.futurePivots[0]?.confluenceLabel || ''})`,
    `- הוכחה מול אירועים פונדמנטליסטיים: ${a.fundamentalProof.matchedCount}/${a.fundamentalProof.totalInSpan} (${a.fundamentalProof.matchRatePct}%)`,
    'תן הצעת עבודה תמציתית ומדויקת בעברית: הטיה, תרחיש כניסה, יעדי Sq9, חלון זמן קריטי וניהול סיכון.',
  ].join('\n');
  try {
    const res = await chatDetailed({
      system: 'אתה חוקר גאן בכיר המייעץ למשתמש על בסיס Gannzilla, Square of 9, הקסגון ומייקל ג׳נקינס. השב בעברית מקצועית וברורה.',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 700,
    });
    gannViewState.aiAdvice = res.text;
  } catch (err) {
    gannViewState.aiAdvice = null;
    toast('AI בענן לא זמין כרגע — מוצגות הצעות העבודה האוטומטיות למטה.', 'info');
  } finally {
    gannViewState.aiLoading = false;
    ui.rerender();
  }
}

function openFundamentalEventModal(fe) {
  openModal(`${fe.title} (${fe.date})`,
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
      h('div', { class: 'row wrap', style: { gap: '8px' } },
        tag(fe.category, 'opt'),
        tag(`מחיר בשוק: ${num(fe.marketPrice, 2)}`, 'dry'),
        tag(fe.proven ? '✓ נחזה מראש ע"י גאן' : 'ללא פגיעה ישירה בטווח', fe.proven ? 'live' : 'dry'),
      ),
      h('div', { class: 'card', style: { background: 'rgba(10, 17, 30, 0.9)' } },
        h('h3', { text: '📖 הסבר מורחב על האירוע הפונדמנטליסטי' }),
        h('p', { class: 'small', style: { lineHeight: '1.6' }, text: fe.details || fe.title }),
      ),
      h('div', { class: 'card', style: { background: 'rgba(10, 17, 30, 0.9)' } },
        h('h3', { text: '◬ הוכחת החיזוי של גאן (לפני פרסום החדשות)' }),
        h('p', { class: 'small', style: { lineHeight: '1.6' }, text: fe.explanation }),
        fe.bestTimeMatch ? h('div', { class: 'tiny muted', style: { marginTop: '6px' }, text: `• ציר מקור מוקדם: ${fe.bestTimeMatch.originType} בתאריך ${fe.bestTimeMatch.originDate} · מחזור: ${fe.bestTimeMatch.cycleLabel} · סטייה: ±${fe.bestTimeMatch.errDays} ימים` }) : null,
        fe.bestPriceMatch ? h('div', { class: 'tiny muted', style: { marginTop: '4px' }, text: `• רמת מחיר גיאומטרית: ${fe.bestPriceMatch.tool} ${fe.bestPriceMatch.degree}° (${num(fe.bestPriceMatch.price, 2)}, סטייה ${fe.bestPriceMatch.distPct}%)` }) : null,
      ),
      h('div', { class: 'card', style: { background: 'rgba(10, 17, 30, 0.9)' } },
        h('h3', { text: '🔗 מקורות וסימוכין' }),
        h('div', { class: 'small', style: { marginBottom: '4px' } },
          h('span', { class: 'muted', text: 'מקור האירוע הרשמי: ' }),
          fe.sourceUrl
            ? h('a', { href: fe.sourceUrl, target: '_blank', rel: 'noopener noreferrer', style: { color: '#7dd3fc', fontWeight: '600' } }, `${fe.sourceName || 'מקור רשמי'} ↗`)
            : h('span', { text: fe.sourceName || 'מקור מאקרו רשמי' }),
        ),
        h('div', { class: 'tiny muted', text: 'מקור חישובי גאן: Square of 9 (gann indicator script sq9.txt), Hexagon 60° (הקסגון.xlsx) ומחזורי Master Time Cycles (wdgannbook_copy.pdf).' }),
      ),
    ),
    { wide: true },
  );
}

function assetKindFor(symbol) {
  if (/USDT$|USD$/i.test(symbol) && !symbol.includes('=')) return 'crypto';
  if (symbol === 'SPY' || symbol === 'QQQ') return 'etf';
  if (symbol.includes('=F')) return 'commodity';
  if (symbol.includes('=X')) return 'forex';
  return 'stock';
}

async function loadGannData(ui) {
  const key = `${gannViewState.symbol}|${gannViewState.tf}|${gannViewState.manualPrice}|${gannViewState.manualDate}`;
  if (gannViewState.loading && gannViewState.key === key) return;
  gannViewState.key = key;
  gannViewState.loading = true;
  gannViewState.error = null;
  ui.rerender();
  try {
    const candles = await getCandles(gannViewState.symbol, gannViewState.tf, { limit: 700, force: false });
    const lookback = gannViewState.tf === '1w' ? 5 : 10;
    const analysis = analyzeGannHistoryAndForecast(candles, {
      lookback,
      manualAnchorPrice: gannViewState.manualPrice ? Number(gannViewState.manualPrice) : null,
      manualAnchorDate: gannViewState.manualDate || null,
      assetKind: assetKindFor(gannViewState.symbol),
    });
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

async function runMultiAssetGannScan(ui) {
  if (gannViewState.multiScanLoading) return;
  gannViewState.multiScanLoading = true;
  ui.rerender();
  const scanSymbols = ['BTCUSDT', 'ETHUSDT', 'NVDA', 'AAPL', 'SPY', 'GC=F', 'CL=F', 'EURUSD=X'];
  const results = [];
  for (const sym of scanSymbols) {
    try {
      const candles = await getCandles(sym, '1d', { limit: 600, force: false });
      const a = analyzeGannHistoryAndForecast(candles, { lookback: 10, assetKind: assetKindFor(sym) });
      if (a.ok) {
        results.push({
          symbol: sym,
          label: ASSET_CATALOG.find((x) => x.symbol === sym)?.label || sym,
          currentPrice: a.currentPrice,
          hitRatePct: a.hitRatePct,
          totalHits: a.totalHits,
          totalTests: a.totalTests,
          fundMatched: a.fundamentalProof.matchedCount,
          fundTotal: a.fundamentalProof.totalInSpan,
          fundRatePct: a.fundamentalProof.matchRatePct,
          nextPivot: a.futurePivots[0]?.date || '—',
        });
      }
    } catch { /* skip failed asset */ }
  }
  gannViewState.multiScanResults = results;
  gannViewState.multiScanLoading = false;
  ui.rerender();
}

function svgEl(tag, attrs, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
  if (text != null) node.textContent = text;
  return node;
}

function renderGannForecastSvg(candles, analysis) {
  const show = Math.min(candles.length, 240);
  const slice = candles.slice(-show);
  const offset = candles.length - show;
  const closes = slice.map((c) => c.c);
  const highs = slice.map((c) => c.h);
  const lows = slice.map((c) => c.l);

  const nearbySq9 = analysis.sq9Levels.filter((l) => Math.abs(l.distPct) <= 28).slice(0, 6);
  const maxV = Math.max(...highs, ...nearbySq9.map((l) => l.price));
  const minV = Math.min(...lows, ...nearbySq9.map((l) => l.price));
  const range = maxV - minV || 1;

  const width = 940;
  const height = 350;
  const padL = 58;
  const padR = 175;
  const padT = 24;
  const padB = 30;
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

  // Future Forecast Zone Background
  svg.appendChild(svgEl('rect', {
    x: padL + chartW, y: padT, width: padR - 8, height: chartH,
    fill: 'rgba(167, 139, 250, 0.07)', stroke: 'rgba(167, 139, 250, 0.3)', 'stroke-dasharray': '4,4',
  }));
  svg.appendChild(svgEl('text', {
    x: padL + chartW + 8, y: padT + 14, fill: '#c4b5fd', 'font-size': '10', 'font-weight': '700',
  }, 'אזור חיזוי עתידי (גאן + מאקרו)'));

  // Horizontal Grid lines
  for (let i = 0; i <= 4; i++) {
    const val = minV + (range * i) / 4;
    const y = yAt(val);
    svg.appendChild(svgEl('line', { x1: padL, x2: width - 8, y1: y, y2: y, stroke: '#162235', 'stroke-width': 1 }));
    svg.appendChild(svgEl('text', { x: 4, y: y + 4, fill: '#8fa3bf', 'font-size': '10' }, val >= 100 ? val.toFixed(0) : val.toFixed(2)));
  }

  // Square of 9 Levels
  for (const lvl of nearbySq9) {
    const y = yAt(lvl.price);
    const col = lvl.isCardinal ? 'rgba(41, 98, 255, 0.85)' : 'rgba(167, 139, 250, 0.5)';
    svg.appendChild(svgEl('line', {
      x1: padL, x2: width - 8, y1: y, y2: y,
      stroke: col, 'stroke-width': lvl.isCardinal ? 1.4 : 1, 'stroke-dasharray': lvl.isCardinal ? '0' : '4,4',
    }));
    svg.appendChild(svgEl('text', {
      x: padL + chartW + 8, y: y - 3, fill: lvl.isCardinal ? '#7dd3fc' : '#c4b5fd', 'font-size': '9.5',
    }, `${lvl.degree}° (${lvl.price >= 100 ? lvl.price.toFixed(0) : lvl.price.toFixed(2)})`));
  }

  // Price Polyline
  const pts = closes.map((c, i) => `${xAt(i).toFixed(1)},${yAt(c).toFixed(1)}`).join(' ');
  svg.appendChild(svgEl('polyline', { points: pts, fill: 'none', stroke: '#2ecc71', 'stroke-width': 2 }));

  // Proven Fundamental Events Stars on Chart
  for (const fe of analysis.fundamentalProof.events) {
    if (!fe.proven) continue;
    const evTs = Date.parse(`${fe.date}T00:00:00Z`);
    const idxInSlice = slice.findIndex((c) => Math.abs(c.t - evTs) <= 3 * 86_400_000);
    if (idxInSlice < 0) continue;
    const cx = xAt(idxInSlice);
    const cy = yAt(slice[idxInSlice].c);
    svg.appendChild(svgEl('line', { x1: cx, x2: cx, y1: padT, y2: padT + chartH, stroke: 'rgba(242, 204, 96, 0.35)', 'stroke-dasharray': '2,3' }));
    svg.appendChild(svgEl('text', { x: cx - 5, y: cy - 8, fill: '#f2cc60', 'font-size': '13' }, '★'));
  }

  // Historical Pivots
  for (const p of analysis.pivots) {
    const rel = p.idx - offset;
    if (rel < 0 || rel >= show) continue;
    svg.appendChild(svgEl('circle', {
      cx: xAt(rel), cy: yAt(p.price), r: 4,
      fill: p.type === 'low' ? '#2ecc71' : '#f05b5b',
      stroke: '#070c14', 'stroke-width': 1.2,
    }));
  }

  // Future Projected Time Lines
  analysis.futurePivots.slice(0, 5).forEach((fp, idx) => {
    const fx = padL + chartW + 18 + idx * 30;
    svg.appendChild(svgEl('line', {
      x1: fx, x2: fx, y1: padT + 22, y2: padT + chartH,
      stroke: fp.nearMacro ? '#f2cc60' : 'rgba(167, 139, 250, 0.6)',
      'stroke-width': fp.score >= 4 || fp.nearMacro ? 1.8 : 1,
      'stroke-dasharray': '3,3',
    }));
    svg.appendChild(svgEl('text', {
      x: fx - 10, y: padT + chartH + 15, fill: fp.nearMacro ? '#f2cc60' : '#c4b5fd', 'font-size': '9',
    }, `+${fp.daysAhead}d`));
  });

  return svg;
}

// Interactive Gannzilla Wheel (Square of 9 / Hexagon 60° / Cosmogram Seasonal Calendar)
function renderGannzillaWheelSvg(analysis, mode) {
  const size = 310;
  const cx = size / 2;
  const cy = size / 2;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.style.width = '100%';
  svg.style.maxWidth = '310px';
  svg.style.height = 'auto';
  svg.style.display = 'block';
  svg.style.margin = '0 auto';
  svg.style.background = 'radial-gradient(circle, #101b30 0%, #070c14 75%)';
  svg.style.borderRadius = '50%';
  svg.style.border = '1px solid #1e2d45';

  const radii = [42, 78, 114, 142];
  for (const r of radii) {
    svg.appendChild(svgEl('circle', { cx, cy, r, fill: 'none', stroke: '#1b2a42', 'stroke-width': 1 }));
  }

  // Center Anchor
  svg.appendChild(svgEl('circle', { cx, cy, r: 28, fill: 'rgba(41, 98, 255, 0.18)', stroke: '#3b82f6', 'stroke-width': 1.5 }));
  svg.appendChild(svgEl('text', { x: cx, y: cy - 3, fill: '#93c5fd', 'font-size': '9', 'text-anchor': 'middle' }, 'ANCHOR'));
  svg.appendChild(svgEl('text', { x: cx, y: cy + 10, fill: '#fff', 'font-size': '11', 'font-weight': '700', 'text-anchor': 'middle' }, num(analysis.anchorPivot.price, 2)));

  if (mode === 'cosmos') {
    const items = analysis.calendars.seasonalTemplates;
    items.forEach((s) => {
      const rad = ((s.deg - 90) * Math.PI) / 180;
      const x1 = cx + Math.cos(rad) * 30;
      const y1 = cy + Math.sin(rad) * 30;
      const x2 = cx + Math.cos(rad) * 140;
      const y2 = cy + Math.sin(rad) * 140;
      const isCard = s.deg % 90 === 0;
      svg.appendChild(svgEl('line', {
        x1, y1, x2, y2,
        stroke: isCard ? 'rgba(242, 204, 96, 0.75)' : 'rgba(167, 139, 250, 0.45)',
        'stroke-width': isCard ? 1.5 : 1,
      }));
      const tx = cx + Math.cos(rad) * 116;
      const ty = cy + Math.sin(rad) * 116;
      svg.appendChild(svgEl('circle', { cx: tx, cy: ty, r: 15, fill: '#0b1220', stroke: isCard ? '#f2cc60' : '#a78bfa' }));
      svg.appendChild(svgEl('text', { x: tx, y: ty + 3, fill: '#e2e8f0', 'font-size': '8.5', 'text-anchor': 'middle' }, s.mmdd));
    });
    return svg;
  }

  const degs = mode === 'hex' ? [60, 120, 180, 240, 300, 360] : [45, 90, 135, 180, 225, 270, 315, 360];
  const table = mode === 'hex' ? analysis.hexLevels : analysis.sq9Levels;

  degs.forEach((deg) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    const isCard = mode === 'hex' ? deg % 180 === 0 : deg % 90 === 0;
    const x1 = cx + Math.cos(rad) * 30;
    const y1 = cy + Math.sin(rad) * 30;
    const x2 = cx + Math.cos(rad) * 142;
    const y2 = cy + Math.sin(rad) * 142;
    svg.appendChild(svgEl('line', {
      x1, y1, x2, y2,
      stroke: isCard ? 'rgba(41, 98, 255, 0.7)' : 'rgba(167, 139, 250, 0.35)',
      'stroke-width': isCard ? 1.5 : 1,
    }));

    const upLvl = table.find((l) => l.degree === deg);
    const tx = cx + Math.cos(rad) * 110;
    const ty = cy + Math.sin(rad) * 110;
    svg.appendChild(svgEl('circle', { cx: tx, cy: ty, r: 19, fill: '#0b1220', stroke: isCard ? '#3b82f6' : '#a78bfa' }));
    svg.appendChild(svgEl('text', { x: tx, y: ty - 2, fill: '#93c5fd', 'font-size': '8', 'text-anchor': 'middle' }, `${deg}°`));
    svg.appendChild(svgEl('text', { x: tx, y: ty + 9, fill: '#2ecc71', 'font-size': '8.5', 'font-weight': '700', 'text-anchor': 'middle' },
      upLvl ? (upLvl.price >= 100 ? upLvl.price.toFixed(0) : upLvl.price.toFixed(2)) : '—'));
  });

  return svg;
}

export function renderGann(root, ui) {
  const key = `${gannViewState.symbol}|${gannViewState.tf}|${gannViewState.manualPrice}|${gannViewState.manualDate}`;
  if (gannViewState.key !== key && !gannViewState.loading) {
    setTimeout(() => loadGannData(ui), 0);
  }

  const a = gannViewState.analysis;

  mount(root,
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: 'Gannzilla · Michael Jenkins · Square of 9 · Hexagon · Fundamental Proof' }),
        h('h1', { text: 'מעבדת גאן המורחבת (Gannzilla & Jenkins Lab)' }),
        h('p', { text: 'מערכת חיזוי ויזואלית רב-נכסית הממזגת את Square of 9, הקסגון 60°, מחשבוני השורש הריבועי והשמיניות של מייקל ג׳נקינס, לוח השנה של Gannzilla והוכחה היסטורית מול אירועים פונדמנטליסטיים.' }),
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
        }, [['1d', 'יומי (2+ שנים)'], ['1w', 'שבועי (5 שנים)'], ['1h', 'שעתי (3 חודשים)']].map(([v, l]) =>
          h('option', { value: v, selected: gannViewState.tf === v }, l)
        )),
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => loadGannData(ui) }, '⟳ הרץ ניתוח'),
        h('button', {
          class: 'btn btn-sm',
          disabled: gannViewState.multiScanLoading,
          onclick: () => runMultiAssetGannScan(ui),
        }, gannViewState.multiScanLoading ? '⏳ סורק נכסים…' : '🌐 סרוק הוכחת גאן על כל הנכסים'),
      ),
    ),
  );

  // Manual Anchor Bar (like gann indicator script sq9.txt Manual/Auto Anchor)
  mount(root,
    h('div', { class: 'card', style: { marginTop: '12px', padding: '12px 14px' } },
      h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap', alignItems: 'center' } },
        h('span', { class: 'small muted', text: '🎯 התאמה והזנת נכס/עוגן:' }),
        h('input', {
          class: 'input',
          type: 'text',
          placeholder: 'סימול מותאם (למשל AMD, META)',
          style: { width: '175px' },
          value: gannViewState.customSymbol,
          onchange: (e) => { gannViewState.customSymbol = e.target.value.trim().toUpperCase(); },
        }),
        h('button', {
          class: 'btn btn-sm',
          onclick: () => {
            if (!gannViewState.customSymbol) return;
            gannViewState.symbol = gannViewState.customSymbol;
            gannViewState.key = null;
            loadGannData(ui);
          },
        }, 'טען נכס מותאם'),
        h('input', {
          class: 'input',
          type: 'number',
          step: 'any',
          placeholder: 'מחיר עוגן ידני (אופציונלי)',
          style: { width: '175px' },
          value: gannViewState.manualPrice,
          onchange: (e) => { gannViewState.manualPrice = e.target.value; },
        }),
        h('input', {
          class: 'input',
          type: 'date',
          style: { width: '155px' },
          value: gannViewState.manualDate,
          onchange: (e) => { gannViewState.manualDate = e.target.value; },
        }),
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => { gannViewState.key = null; loadGannData(ui); } }, 'החל עוגן'),
        h('button', {
          class: 'btn btn-sm',
          onclick: () => { gannViewState.manualPrice = ''; gannViewState.manualDate = ''; gannViewState.key = null; loadGannData(ui); },
        }, 'עוגן אוטומטי'),
      ),
    ),
  );

  // Multi-Asset Scan Results (when run)
  if (gannViewState.multiScanResults) {
    mount(root,
      h('div', { class: 'card', style: { marginTop: '14px' } },
        h('div', { class: 'card-head' },
          h('div', {},
            h('h2', { text: '🌐 הוכחת גאן רב-נכסית (קריפטו, מניות, מדדים, סחורות ומט"ח)' }),
            h('div', { class: 'card-sub', text: 'הוכחה ששיטות גאן פועלות בעקביות על כל שוק סחיר — לא רק על ביטקוין' }),
          ),
        ),
        h('div', { class: 'table-wrap' },
          h('table', {},
            h('thead', {}, h('tr', {},
              h('th', { text: 'נכס' }),
              h('th', { text: 'מחיר נוכחי' }),
              h('th', { text: 'דיוק צירים היסטורי' }),
              h('th', { text: 'אירועים פונדמנטליסטיים שנחזו ע"י גאן' }),
              h('th', { text: 'חלון ציר קרוב' }),
              h('th', { text: 'פעולה' }),
            )),
            h('tbody', {}, gannViewState.multiScanResults.map((r) => h('tr', {},
              h('td', { class: 'small', text: r.label }),
              h('td', { class: 'mono', text: num(r.currentPrice, 2) }),
              h('td', {}, tag(`${r.hitRatePct}% (${r.totalHits}/${r.totalTests})`, r.hitRatePct >= 50 ? 'live' : 'opt')),
              h('td', {}, tag(`${r.fundMatched}/${r.fundTotal} (${r.fundRatePct}%)`, r.fundRatePct >= 50 ? 'live' : 'dry')),
              h('td', { class: 'mono', text: r.nextPivot }),
              h('td', {}, h('button', {
                class: 'btn btn-sm',
                onclick: () => { gannViewState.symbol = r.symbol; gannViewState.key = null; loadGannData(ui); },
              }, 'נתח לעומק')),
            ))),
          ),
        ),
      ),
    );
  }

  if (gannViewState.loading) {
    mount(root, h('div', { class: 'card', style: { marginTop: '14px', padding: '40px', textAlign: 'center' } },
      h('div', { text: '⏳ טוען היסטוריה, מחשב Square of 9, הקסגון, נוסחאות מייקל ג׳נקינס ומאמת מול אירועים פונדמנטליסטיים…' }),
    ));
    return;
  }

  if (gannViewState.error || !a) {
    mount(root, h('div', { class: 'card', style: { marginTop: '14px' } }, empty(gannViewState.error || 'בחר נכס ולחץ "הרץ ניתוח"')));
    return;
  }

  mount(root,
    // KPI Row
    h('div', { class: 'grid cols-4', style: { marginTop: '14px' } },
      h('div', { class: 'metric' }, h('span', { text: 'טווח היסטורי נבדק' }), h('b', { text: `${a.spanDays} ימים (${a.candlesCount} נרות)` })),
      h('div', { class: 'metric' }, h('span', { text: 'דיוק חיזוי צירים בעבר' }), h('b', { class: a.hitRatePct >= 50 ? 'green mono' : 'gold mono', text: `${a.hitRatePct}% (${a.totalHits}/${a.totalTests})` })),
      h('div', { class: 'metric' }, h('span', { text: 'אירועים פונדמנטליסטיים שנחזו ע"י גאן' }), h('b', { class: 'green mono', text: `${a.fundamentalProof.matchedCount}/${a.fundamentalProof.totalInSpan} (${a.fundamentalProof.matchRatePct}%)` })),
      h('div', { class: 'metric' }, h('span', { text: 'טבעת Sq9 · זווית 1x1' }), h('b', { class: a.angle1x1?.abovePrice ? 'green' : 'red', text: `טבעת #${a.jenkins.ringNumber} · ${a.angle1x1?.abovePrice ? 'מעל 1x1 (שורי)' : 'מתחת ל-1x1 (דובי)'}` })),
    ),

    // Main Forecast SVG Chart
    h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'card-head' },
        h('div', {},
          h('h2', { text: `${gannViewState.symbol} · מפת חיזוי ויזואלית (${marketState.provider || 'חי'})` }),
          h('div', { class: 'card-sub', text: '★ כוכב זהב = אירוע פונדמנטליסטי שנחזה מראש ע"י מחזורי גאן · קווים אופקיים = Square of 9 · אזור סגול מימין = תאריכי מפנה קרובים' }),
        ),
        tag(`עוגן: ${num(a.anchorPivot.price, 2)} (${a.anchorPivot.manual ? 'ידני' : a.anchorPivot.type === 'low' ? 'שפל' : 'שיא'})`, 'live'),
      ),
      renderGannForecastSvg(gannViewState.candles, a),
    ),

    // Gannzilla Interactive Wheel + Michael Jenkins / Excel Suite
    h('div', { class: 'grid cols-2', style: { marginTop: '14px' } },
      h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('div', {},
            h('h2', { text: '☸️ גלגל Gannzilla האינטראקטיבי' }),
            h('div', { class: 'card-sub', text: 'מעבר בין Square of 9, הקסגון (60°) ולוח השנה העונתי-אסטרונומי' }),
          ),
          h('div', { class: 'row', style: { gap: '6px' } },
            [['sq9', 'Square of 9'], ['hex', 'הקסגון 60°'], ['cosmos', 'לוח שנה עונתי']].map(([id, lbl]) =>
              h('button', {
                class: `btn btn-sm ${gannViewState.wheelMode === id ? 'btn-primary' : ''}`,
                onclick: () => { gannViewState.wheelMode = id; ui.rerender(); },
              }, lbl)
            ),
          ),
        ),
        renderGannzillaWheelSvg(a, gannViewState.wheelMode),
        h('div', { class: 'tiny muted', style: { marginTop: '10px', textAlign: 'center' }, text: gannViewState.wheelMode === 'cosmos'
          ? 'תאריכי המפנה העונתיים של גאן (21.3, 5.5, 21.6, 7.8, 23.9, 7.11, 21.12, 4.2)'
          : `טבעת מספר #${a.jenkins.ringNumber} · טווח שיא-שפל: ${num(a.jenkins.swingLow, 2)} – ${num(a.jenkins.swingHigh, 2)}` }),
      ),

      h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('div', {},
            h('h2', { text: '🧮 תוכנת מחשבוני ג׳נקינס וגאן (Jenkins & Excel Suite)' }),
            h('div', { class: 'card-sub', text: 'מיושם מהגיליונות שלך (ריבועים, ריבוע 9, זמנים, הקסגון) + שיטות Michael Jenkins' }),
          ),
        ),
        h('div', { class: 'row', style: { gap: '6px', marginBottom: '10px', flexWrap: 'wrap' } },
          [
            ['jenkins', '√Price ג׳נקינס + ספירלת זמן'],
            ['eighths', 'שמיניות טווח (1/8–8/8)'],
            ['sq9', 'טבלת Square of 9'],
            ['hex', 'טבלת הקסגון (60°)'],
          ].map(([id, lbl]) =>
            h('button', {
              class: `btn btn-sm ${gannViewState.calcTab === id ? 'btn-primary' : ''}`,
              onclick: () => { gannViewState.calcTab = id; ui.rerender(); },
            }, lbl)
          ),
        ),
        gannViewState.calcTab === 'jenkins'
          ? h('div', { class: 'table-wrap' },
            h('table', {},
              h('thead', {}, h('tr', {}, h('th', { text: 'נוסחת מייקל ג׳נקינס / ספירלה' }), h('th', { text: 'ימים' }), h('th', { text: 'תאריך יעד' }))),
              h('tbody', {}, [
                ...a.jenkins.jenkinsTimeCycles.map((c) => h('tr', {},
                  h('td', { class: 'small', text: c.label }),
                  h('td', { class: 'mono', text: `+${c.days}d` }),
                  h('td', { class: 'mono green', text: c.projectedDate }),
                )),
                ...a.jenkins.spiralDates.slice(0, 3).map((s) => h('tr', {},
                  h('td', { class: 'small', text: `ספירלה פנימה (${s.sqValue} × 30.437d)` }),
                  h('td', { class: 'mono', text: `+${s.days}d` }),
                  h('td', { class: 'mono gold', text: s.date }),
                )),
              ]),
            ),
          )
          : gannViewState.calcTab === 'eighths'
            ? h('div', { class: 'table-wrap' },
              h('table', {},
                h('thead', {}, h('tr', {}, h('th', { text: 'חלוקת טווח (גאן)' }), h('th', { text: 'מחיר יעד' }), h('th', { text: 'חשיבות' }))),
                h('tbody', {}, a.jenkins.eighths.map((e) => h('tr', {},
                  h('td', { class: 'small', text: e.label }),
                  h('td', { class: 'mono', text: num(e.price, 2) }),
                  h('td', {}, tag(e.strong ? 'רמת מפתח' : 'משנית', e.strong ? 'live' : 'dry')),
                ))),
              ),
            )
            : gannViewState.calcTab === 'hex'
              ? h('div', { class: 'table-wrap' },
                h('table', {},
                  h('thead', {}, h('tr', {}, h('th', { text: 'זווית' }), h('th', { text: 'משמעות גיאומטרית' }), h('th', { text: 'מחיר' }), h('th', { text: 'מרחק' }))),
                  h('tbody', {}, a.hexLevels.slice(0, 10).map((l) => h('tr', {},
                    h('td', { class: 'mono', text: `${l.degree}°` }),
                    h('td', { class: 'small', text: l.meaning }),
                    h('td', { class: 'mono', text: num(l.price, 2) }),
                    h('td', { class: 'mono ' + (l.distPct >= 0 ? 'green' : 'red'), text: pct(l.distPct) }),
                  ))),
                ),
              )
              : h('div', { class: 'table-wrap' },
                h('table', {},
                  h('thead', {}, h('tr', {}, h('th', { text: 'מעלה' }), h('th', { text: 'סוג' }), h('th', { text: 'מחיר' }), h('th', { text: 'מרחק' }))),
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

    // Gann vs. Fundamental Events Proof Section
    h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'card-head' },
        h('div', {},
          h('h2', { text: '⚡ הוכחת גאן מול אירועים פונדמנטליסטיים (ריבית פד, אינפלציה, חצייה, דוחות ומשברים)' }),
          h('div', { class: 'card-sub', text: 'הוכחה כיצד מחזורי גאן ורמות Sq9/Hexagon סימנו מראש את התאריך והמחיר עוד לפני שהחדשות התפרסמו' }),
        ),
        tag(`${a.fundamentalProof.matchedCount}/${a.fundamentalProof.totalInSpan} אירועים הוכחו (${a.fundamentalProof.matchRatePct}%)`, a.fundamentalProof.matchRatePct >= 50 ? 'live' : 'opt'),
      ),
      a.fundamentalProof.events.length
        ? h('div', { class: 'table-wrap' },
          h('table', {},
            h('thead', {}, h('tr', {},
              h('th', { text: 'תאריך' }),
              h('th', { text: 'האירוע הפונדמנטליסטי' }),
              h('th', { text: 'מחיר בשוק' }),
              h('th', { text: 'אימות גאן מוקדם' }),
              h('th', { text: 'הסבר ההוכחה (לחץ להסבר מורחב ומקורות)' }),
              h('th', { text: 'פירוט' }),
            )),
            h('tbody', {}, a.fundamentalProof.events.map((fe) => h('tr', {
              style: { cursor: 'pointer' },
              onclick: () => openFundamentalEventModal(fe),
            },
              h('td', { class: 'mono', text: fe.date }),
              h('td', { class: 'small', text: `${fe.title} (${fe.category})` }),
              h('td', { class: 'mono', text: num(fe.marketPrice, 2) }),
              h('td', {}, tag(fe.proven ? '✓ נחזה ע"י גאן' : 'ללא פגיעה ישירה', fe.proven ? 'live' : 'dry')),
              h('td', { class: 'small muted', text: fe.explanation }),
              h('td', {}, h('button', {
                class: 'btn btn-sm',
                onclick: (e) => { e.stopPropagation(); openFundamentalEventModal(fe); },
              }, '🔍 הסבר ומקורות')),
            ))),
          ),
        )
        : empty('אין אירועי מאקרו בטווח הזמן של גרף זה (נסה טווח יומי או שבועי)'),
    ),

    // Future Forecast + Historical Pivots with Annotations
    h('div', { class: 'grid cols-2', style: { marginTop: '14px' } },
      h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('div', {},
            h('h2', { text: '🔮 אירועים ונקודות ציר קרובים (חיזוי עתידי)' }),
            h('div', { class: 'card-sub', text: 'חלונות זמן של גאן + חפיפה עם החלטות FOMC ותאריכים עונתיים' }),
          ),
        ),
        a.futurePivots.length
          ? h('div', { class: 'table-wrap' },
            h('table', {},
              h('thead', {}, h('tr', {},
                h('th', { text: 'תאריך צפוי' }),
                h('th', { text: 'בעוד' }),
                h('th', { text: 'עוצמה' }),
                h('th', { text: 'הערות וקטליזטור קרוב' }),
              )),
              h('tbody', {}, a.futurePivots.map((fp) => h('tr', {},
                h('td', { class: 'mono', text: fp.date }),
                h('td', { class: 'mono', text: `+${fp.daysAhead}d` }),
                h('td', {}, tag(`${fp.confluenceLabel} (${fp.score})`, fp.score >= 5 ? 'live' : fp.score >= 3 ? 'opt' : 'dry')),
                h('td', { class: 'tiny muted', text: [fp.nearMacro, fp.nearSeason, fp.targetUp ? `יעד ↑ ${num(fp.targetUp, 2)}` : ''].filter(Boolean).join(' · ') }),
              ))),
            ),
          )
          : empty('אין חלונות עתידיים בטווח'),
      ),

      h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('div', {},
            h('h2', { text: '🏆 הערות על חיזויי עבר שאומתו בשוק' }),
            h('div', { class: 'card-sub', text: 'תיעוד נקודות עבר שבהן מחזורי גאן פגעו בהיפוך אמיתי' }),
          ),
        ),
        a.validations.length
          ? h('div', { class: 'table-wrap' },
            h('table', {},
              h('thead', {}, h('tr', {},
                h('th', { text: 'תאריך חזוי' }),
                h('th', { text: 'בפועל' }),
                h('th', { text: 'סטייה' }),
                h('th', { text: 'הערת מחקר' }),
              )),
              h('tbody', {}, a.validations.slice(0, 10).map((v) => h('tr', {},
                h('td', { class: 'mono', text: v.predictedDate }),
                h('td', { class: 'mono', text: v.actualPivotDate }),
                h('td', { class: 'mono green', text: `±${v.errorDays}d` }),
                h('td', { class: 'tiny muted', text: v.note }),
              ))),
            ),
          )
          : empty('לא נמצאו פגיעות בטווח זה'),
      ),
    ),

    // Expansive Gannzilla Calendars (Zodiac 12, Planetary Harmonics, Master Squares 52/90/144, Seasonal)
    h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'card-head' },
        h('div', {},
          h('h2', { text: '📅 לוחות השנה המלאים של Gannzilla וגאן (Calendars Suite)' }),
          h('div', { class: 'card-sub', text: 'לוח 12 המזלות (30°), מחזורים פלנטריים (מרקורי, נוגה, מאדים, אורנוס 84.77y), ריבועי מאסטר (52 / 90 / 144) ותאריכים עונתיים' }),
        ),
        h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
          [
            ['zodiac12', '12 המזלות (30°)'],
            ['planetary', 'מחזורים פלנטריים'],
            ['squares', 'ריבועי 52 / 90 / 144'],
            ['seasonal', '8 תאריכים עונתיים'],
          ].map(([id, lbl]) =>
            h('button', {
              class: `btn btn-sm ${gannViewState.calendarTab === id ? 'btn-primary' : ''}`,
              onclick: () => { gannViewState.calendarTab = id; ui.rerender(); },
            }, lbl)
          ),
        ),
      ),
      gannViewState.calendarTab === 'zodiac12'
        ? h('div', { class: 'table-wrap' },
          h('table', {},
            h('thead', {}, h('tr', {}, h('th', { text: 'מעלה' }), h('th', { text: 'מזל / קלטת שמש' }), h('th', { text: 'תאריך קרוב' }), h('th', { text: 'בעוד' }))),
            h('tbody', {}, (a.calendars.upcomingZodiac || []).map((z) => h('tr', {},
              h('td', { class: 'mono', text: `${z.deg}°` }),
              h('td', { class: 'small', text: z.sign }),
              h('td', { class: 'mono', text: z.date }),
              h('td', { class: 'mono green', text: `+${z.daysAhead}d` }),
            ))),
          ),
        )
        : gannViewState.calendarTab === 'planetary'
          ? h('div', { class: 'table-wrap' },
            h('table', {},
              h('thead', {}, h('tr', {}, h('th', { text: 'מחזור פלנטרי' }), h('th', { text: 'אורך מחזור' }), h('th', { text: 'תאריך יעד קרוב מהעוגן' }), h('th', { text: 'בעוד' }))),
              h('tbody', {}, (a.calendars.planetaryCycles || []).map((p) => h('tr', {},
                h('td', { class: 'small', text: p.name }),
                h('td', { class: 'mono', text: `${p.days}d` }),
                h('td', { class: 'mono gold', text: p.date }),
                h('td', { class: 'mono', text: `+${p.daysAhead}d` }),
              ))),
            ),
          )
          : gannViewState.calendarTab === 'squares'
            ? h('div', { class: 'table-wrap' },
              h('table', {},
                h('thead', {}, h('tr', {}, h('th', { text: 'ריבוע מאסטר' }), h('th', { text: 'ימים' }), h('th', { text: 'משמעות' }), h('th', { text: 'תאריך יעד' }))),
                h('tbody', {}, (a.calendars.masterSquares || []).map((m) => h('tr', {},
                  h('td', { class: 'small', text: m.group }),
                  h('td', { class: 'mono', text: `${m.days}d` }),
                  h('td', { class: 'tiny muted', text: m.meaning }),
                  h('td', { class: 'mono green', text: `${m.date} (+${m.daysAhead}d)` }),
                ))),
              ),
            )
            : h('div', { class: 'table-wrap' },
              h('table', {},
                h('thead', {}, h('tr', {}, h('th', { text: 'מעלה' }), h('th', { text: 'אירוע עונתי' }), h('th', { text: 'תאריך' }), h('th', { text: 'בעוד' }))),
                h('tbody', {}, (a.calendars.upcomingSeasonal || []).map((s) => h('tr', {},
                  h('td', { class: 'mono', text: `${s.deg}°` }),
                  h('td', { class: 'small', text: s.label }),
                  h('td', { class: 'mono', text: s.date }),
                  h('td', { class: 'mono gold', text: `+${s.daysAhead}d` }),
                ))),
              ),
            ),
    ),

    // Smart AI Working Proposals Panel
    h('div', { class: 'card', style: { marginTop: '14px', borderColor: 'rgba(167, 139, 250, 0.45)' } },
      h('div', { class: 'card-head' },
        h('div', {},
          h('h2', { text: `🤖 הצעות AI לעבודה ומחקר חכם (${gannViewState.symbol})` }),
          h('div', { class: 'card-sub', text: 'סינתזה אוטומטית של Square of 9, הקסגון, זווית 1x1 ולוחות השנה של Gannzilla להמלצת פעולה' }),
        ),
        h('button', {
          class: 'btn btn-sm btn-primary',
          disabled: gannViewState.aiLoading,
          onclick: () => askAiForGannProposal(a, ui),
        }, gannViewState.aiLoading ? '⏳ מפיק ניתוח AI…' : '✨ הפק הצעת עבודה מעמיקה מ-AI'),
      ),
      h('div', { class: 'grid cols-3', style: { gap: '10px', marginBottom: gannViewState.aiAdvice ? '12px' : '0' } },
        ...(a.proposals || generateGannWorkingProposals(a, gannViewState.symbol)).map((pr) => h('div', { class: 'card', style: { background: 'rgba(8, 14, 24, 0.85)' } },
          h('h3', { text: pr.title }),
          h('p', { class: 'small muted', text: pr.detail }),
        )),
      ),
      gannViewState.aiAdvice
        ? h('div', { class: 'notice ok', style: { whiteSpace: 'pre-wrap', lineHeight: '1.6' }, text: gannViewState.aiAdvice })
        : null,
    ),
  );

  // Autonomous Gann Events Library with Smart Search (Fundamental + Regular Trend Reversals + Web Archive)
  const lib = store.state.gannLibrary || { items: [], stats: null, updatedAt: null };
  if (!lib.items?.length && !gannViewState.libLoading) {
    gannViewState.libLoading = true;
    runAutonomousGannLibraryAuditIfDue().finally(() => {
      gannViewState.libLoading = false;
      ui.rerender();
    });
  }
  const filteredLib = searchGannLibrary(lib.items || [], gannViewState.libQuery, gannViewState.libKind);

  mount(root,
    h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'card-head' },
        h('div', {},
          h('h2', { text: '📚 ספריית האירועים ושינויי המגמה של גאן (מחקר עצמאי + חיפוש חכם)' }),
          h('div', { class: 'card-sub', text: `משלבת אירועים פונדמנטליסטיים שנחזו ע"י גאן, שינויי מגמה רגילים ממחקר אוטונומי ותחזיות היסטוריות מתועדות מהרשת · ${lib.updatedAt ? 'עודכן ' + timeAgo(lib.updatedAt) : 'מאתחל סריקה…'}` }),
        ),
        h('button', {
          class: 'btn btn-sm btn-primary',
          disabled: gannViewState.libLoading,
          onclick: async () => {
            gannViewState.libLoading = true;
            ui.rerender();
            try {
              await runAutonomousGannLibraryAudit();
              toast('הבדיקה העצמאית הושלמה וספריית האירועים עודכנה!', 'ok');
            } finally {
              gannViewState.libLoading = false;
              ui.rerender();
            }
          },
        }, gannViewState.libLoading ? '⏳ סורק היסטוריה…' : '🔬 הרץ בדיקה עצמאית אוטומטית'),
      ),
      h('div', { class: 'row wrap', style: { gap: '8px', marginBottom: '12px', alignItems: 'center' } },
        h('input', {
          class: 'input',
          type: 'search',
          placeholder: '🔍 חיפוש חכם: נכס (NVDA, BTC), מחזור (144d, 90d), ריבית, חצייה, 1929, חיטה…',
          style: { flex: '1', minWidth: '240px' },
          value: gannViewState.libQuery,
          oninput: (e) => { gannViewState.libQuery = e.target.value; ui.rerender(); },
        }),
        [
          ['all', `הכל (${lib.items?.length || 0})`],
          ['fundamental_proven', `פונדמנטליסטיים (${lib.stats?.fundamentalProven || 0})`],
          ['trend_reversal', `שינויי מגמה רגילים (${lib.stats?.trendReversals || 0})`],
          ['web_documented', `מתועדים מהרשת (${lib.stats?.webDocumented || 0})`],
        ].map(([k, lbl]) =>
          h('button', {
            class: `btn btn-sm ${gannViewState.libKind === k ? 'btn-primary' : ''}`,
            onclick: () => { gannViewState.libKind = k; ui.rerender(); },
          }, lbl)
        ),
      ),
      filteredLib.length
        ? h('div', { class: 'table-wrap' },
          h('table', {},
            h('thead', {}, h('tr', {},
              h('th', { text: 'תאריך' }),
              h('th', { text: 'נכס' }),
              h('th', { text: 'האירוע / שינוי המגמה' }),
              h('th', { text: 'סיווג' }),
              h('th', { text: 'מקור והוכחת גאן (לחץ לפירוט)' }),
            )),
            h('tbody', {}, filteredLib.slice(0, 35).map((item) => h('tr', {
              style: { cursor: 'pointer' },
              onclick: () => openFundamentalEventModal(item),
            },
              h('td', { class: 'mono', text: item.date }),
              h('td', { class: 'mono', text: item.symbol }),
              h('td', { class: 'small', text: item.title }),
              h('td', {}, tag(item.category, item.kind === 'fundamental_proven' ? 'live' : item.kind === 'web_documented' ? 'opt' : 'dry')),
              h('td', { class: 'tiny muted', text: item.explanation }),
            ))),
          ),
        )
        : empty('לא נמצאו אירועים תואמים לחיפוש.'),
    ),
  );
}
