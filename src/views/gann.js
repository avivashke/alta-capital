// Dedicated Educational & Interactive Gannzilla / Michael Jenkins Forecasting Lab (#/gann)
// Integrates Square of 9, Hexagon (60°), Jenkins Square-Root Time & Eighths, Gannzilla Seasonal Wheel,
// Multi-Asset Proof Scanner, and Gann vs. Fundamental Events Historical Proof.

import { store } from '../store.js';
import { h, mount, num, pct, tag, notice, empty, toast, openModal, timeAgo, downloadFile, copyText } from '../ui.js';
import { getCandles, marketState, ASSET_CATALOG } from '../market.js';
import { scheduleDatabasePush } from '../db.js';
import {
  analyzeGannHistoryAndForecast,
  generateGannWorkingProposals,
  searchGannLibrary,
  runAutonomousGannLibraryAudit,
  runAutonomousGannLibraryAuditIfDue,
  DEFAULT_GANNZILLA_CONFIG,
  computeGannzillaLayoutLevels,
  computeMsjSq9Analysis,
  autoScaleForPrice,
  parseGannzillaIni,
  exportGannzillaIni,
  parsePriceTimeCsv,
  computePriceCircleAngles,
} from '../gann.js';
import { chatDetailed } from '../llm.js';
import { gannExplainButton, openGannMasterGuideModal } from '../gann_guide.js';

let gannViewState = {
  symbol: 'BTCUSDT',
  customSymbol: '',
  tf: '1d',
  manualPrice: '',
  manualDate: '',
  calcTab: 'fan', // 'fan' | 'msj_grid' | 'msj_deg' | 'jenkins' | 'eighths' | 'hex'
  calendarTab: 'zodiac12', // 'zodiac12' | 'planetary' | 'squares' | 'seasonal'
  pctTab: 'circles', // 'circles' | 'musical' | 'lookback'
  customCircleInput: '',
  musicalSystem: 'just', // 'just' | 'pythagorean'
  msjCustomPrice: '',
  selectedMsjCell: null,
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

function getGannzillaConfig() {
  return { ...DEFAULT_GANNZILLA_CONFIG, ...(store.state.gannConfig || {}) };
}

function updateGannzillaConfig(patch, ui, { reloadAnalysis = false } = {}) {
  store.state.gannConfig = {
    ...getGannzillaConfig(),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  store.save(true);
  scheduleDatabasePush(1500);
  if (reloadAnalysis && gannViewState.candles) {
    const lookback = gannViewState.tf === '1w' ? 5 : 10;
    const analysis = analyzeGannHistoryAndForecast(gannViewState.candles, {
      lookback,
      manualAnchorPrice: gannViewState.manualPrice ? Number(gannViewState.manualPrice) : null,
      manualAnchorDate: gannViewState.manualDate || null,
      assetKind: assetKindFor(gannViewState.symbol),
      gannzillaConfig: store.state.gannConfig,
    });
    if (analysis.ok) gannViewState.analysis = analysis;
  }
  ui.rerender();
}

async function askAiForGannProposal(a, ui) {
  if (gannViewState.aiLoading || !a) return;
  gannViewState.aiLoading = true;
  ui.rerender();
  const prompt = [
    `נתח את הנכס ${gannViewState.symbol} (${gannViewState.tf}) לפי נתוני Gannzilla Pro, מניפת גאן ו-MSJ_GannSQ9 בזמן אמת:`,
    `- מחיר נוכחי: ${a.currentPrice}, עוגן: ${a.anchorPivot.price} (${a.anchorPivot.type}), טבעת Sq9 #${a.jenkins.ringNumber}, זווית גלגל MSJ: ${a.msjSq9?.wheelAngle ?? '—'}°`,
    `- מניפת גאן (1x1): ${a.angle1x1?.abovePrice ? 'מעל 1x1 (שורי)' : 'מתחת ל-1x1 (דובי)'} (${a.angle1x1?.projectedNow}) · תמיכה ${a.gannFan?.activeSupport?.id || '—'} · התנגדות ${a.gannFan?.activeResistance?.id || '—'}`,
    `- סווינג גאן (${a.swingChart?.barMode || 2}-Bar): ${a.swingChart?.trend || '—'} · ציון התכנסות גאן: ${a.confluence?.score ?? '—'}/100`,
    `- רמות Sq9 קרובות: ${a.sq9Levels.slice(0, 4).map((l) => `${l.degree}°=${l.price}`).join(', ')}`,
    `- חלון ציר עתידי קרוב: ${a.futurePivots[0]?.date || '—'} (${a.futurePivots[0]?.confluenceLabel || ''})`,
    `- הוכחה מול אירועים פונדמנטליסטיים: ${a.fundamentalProof.matchedCount}/${a.fundamentalProof.totalInSpan} (${a.fundamentalProof.matchRatePct}%)`,
    'תן הצעת עבודה תמציתית ומדויקת בעברית: הטיה, תרחיש כניסה, יעדי Sq9 ומניפת גאן, חלון זמן קריטי וניהול סיכון.',
  ].join('\n');
  try {
    const res = await chatDetailed({
      system: 'אתה חוקר גאן בכיר המייעץ למשתמש על בסיס Gannzilla Pro v8.3, MSJ_GannSQ9 (מייקל ג׳נקינס), מניפת גאן ו-W.D. Gann Trading Tools. השב בעברית מקצועית וברורה.',
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
        h('div', { class: 'tiny muted', text: 'מקור חישובי גאן: Square of 9 (MSJ_GannSQ9), Gannzilla Pro v8.3, Hexagon 60°, מניפת גאן 9 זוויות ומחזורי Master Time Cycles.' }),
      ),
    ),
    { wide: true },
  );
}

function assetKindFor(symbol) {
  if (/USDT$|USD$/i.test(symbol) && !symbol.includes('=')) return 'crypto';
  if (['SPY', 'QQQ', 'DIA', 'IWM'].includes(symbol)) return 'etf';
  if (symbol.includes('=F')) return 'commodity';
  if (symbol.includes('=X')) return 'forex';
  return 'stock';
}

function niceIncrementForPrice(price) {
  const p = Math.abs(Number(price) || 100);
  if (p < 2) return 0.01;
  if (p < 20) return 0.1;
  if (p < 200) return 1;
  if (p < 2000) return 10;
  if (p < 20000) return 50;
  return 100;
}

function fmtPriceSmart(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) < 5) return n.toFixed(4);
  if (Math.abs(n) < 50) return n.toFixed(3);
  return n.toFixed(2);
}

/**
 * Cleanly switches the Gann lab to any asset, clearing stale anchor/scale inputs from
 * the previous asset (e.g., Bitcoin) so the new asset never inherits wrong price scales.
 */
function selectGannAsset(rawSymbol, ui, { keepManual = false } = {}) {
  const sym = String(rawSymbol || '').trim().toUpperCase();
  if (!sym) return;
  const changed = sym !== gannViewState.symbol;
  gannViewState.symbol = sym;
  gannViewState.aiAdvice = null;
  gannViewState.selectedMsjCell = null;
  if (changed && !keepManual) {
    gannViewState.manualPrice = '';
    gannViewState.manualDate = '';
    gannViewState.msjCustomPrice = '';
    gannViewState.customCircleInput = '';
    // Reset asset-specific numeric overrides in gannConfig so BTC scales don't stick on stocks/forex
    const prevCfg = getGannzillaConfig();
    if (prevCfg.fanScale || prevCfg.scale !== 'auto' || prevCfg.startValue !== 1 || prevCfg.increment !== 1) {
      store.state.gannConfig = {
        ...prevCfg,
        fanScale: '',
        fanDirection: 'auto',
        scale: 'auto',
        startValue: 1,
        increment: 1,
        updatedAt: new Date().toISOString(),
      };
      store.save();
    }
  }
  gannViewState.key = null;
  loadGannData(ui, { force: true });
}

/**
 * Computes mathematically grounded recommended values for every Gann input field
 * tailored to the currently loaded asset, with beginner-friendly Hebrew explanations.
 */
function computeGannSmartSuggestions(candles, a, symbol, tf) {
  if (!candles?.length || !a?.anchorPivot) return null;
  const cur = Number(a.currentPrice) || candles[candles.length - 1].c;
  const pivotPrice = Number(a.anchorPivot.price) || cur;
  const pivotDate = a.anchorPivot.date
    || (a.anchorPivot.t ? new Date(a.anchorPivot.t).toISOString().slice(0, 10) : null)
    || new Date(candles[Math.max(0, candles.length - 60)].t).toISOString().slice(0, 10);
  const pivotTypeHe = a.anchorPivot.type === 'low' ? 'שפל מרכזי (Swing Low)' : 'שיא מרכזי (Swing High)';
  const fanDir = a.anchorPivot.type === 'low' ? 'up' : 'down';
  const fanUnit = Number(a.gannFan?.autoUnit || a.gannFan?.unitPerBar) || +(cur * 0.006).toFixed(4);
  const inc = niceIncrementForPrice(cur);
  const startVal = Math.max(inc, Math.floor((pivotPrice * 0.85) / inc) * inc);
  const sq9Scale = autoScaleForPrice(cur);
  const tfLabel = tf === '1w' ? 'שבועי' : tf === '1h' ? 'שעתי' : 'יומי';

  const circleSizes = cur < 10
    ? '0.5, 1, 3.6, 12'
    : cur < 500
      ? '12, 36, 90, 144, 360'
      : cur < 5000
        ? '90, 144, 360, 720, 1440'
        : '360, 1440, 3600, 14400';

  return {
    symbol,
    manualPrice: +fmtPriceSmart(pivotPrice),
    manualDate: pivotDate,
    fanScale: fanUnit,
    fanDirection: fanDir,
    startValue: +Number(startVal).toFixed(4),
    increment: inc,
    scale: sq9Scale,
    msjCustomPrice: +fmtPriceSmart(cur),
    customCircleInput: circleSizes,
    rows: [
      {
        id: 'anchor',
        field: 'מחיר עוגן + תאריך עוגן',
        valueText: `${fmtPriceSmart(pivotPrice)} · ${pivotDate}`,
        why: `זוהה ${pivotTypeHe} משמעותי בהיסטוריית הנרות של ${symbol}. לפי וו.ד. גאן, כל חישוב מחיר וזמן חייב להתחיל מנקודת מפנה אמיתית (שפל או שיא מובהק) — משם סופרים מחזורי זמן (30/45/90/144/180/360 יום) ומעלות ב-Square of 9.`,
        apply: (ui) => {
          gannViewState.manualPrice = String(+fmtPriceSmart(pivotPrice));
          gannViewState.manualDate = pivotDate;
          gannViewState.key = null;
          loadGannData(ui);
          toast(`אוכלסו מחיר ותאריך עוגן עבור ${symbol}`, 'ok');
        },
      },
      {
        id: 'fanScale',
        field: 'קנה מידה למניפת גאן (יחידה/נר 1x1)',
        valueText: `${fanUnit} ליחידה לנר (${tfLabel})`,
        why: `חושב לפי טווח התנועה וה-ATR האמיתי של ${symbol}. גאן קבע שזווית 1x1 (45°) מייצגת איזון מושלם של "יחידת מחיר אחת לכל יחידת זמן". קנה מידה מותאם לנכס מונע מהמניפה להיות שטוחה מדי (כמו שקורה אם משאירים קנה מידה של ביטקוין על מניה!).`,
        apply: (ui) => {
          updateGannzillaConfig({ fanScale: String(fanUnit) }, ui, { reloadAnalysis: true });
          toast(`קנה מידת מניפת 1x1 עודכן ל-${fanUnit} עבור ${symbol}`, 'ok');
        },
      },
      {
        id: 'fanDirection',
        field: 'כיוון מניפת גאן (עולה / יורדת)',
        valueText: fanDir === 'up' ? 'מניפה עולה ↑ (מהשפל)' : 'מניפה יורדת ↓ (מהשיא)',
        why: fanDir === 'up'
          ? `מכיוון שהעוגן הדומיננטי ב-${symbol} הוא שפל, מניפה עולה מקרינה קווי תמיכה אלכסוניים (1x1, 2x1, 1x2) שכל עוד המחיר מעליהם המגמה השורית בריאה.`
          : `מכיוון שהעוגן הדומיננטי ב-${symbol} הוא שיא, מניפה יורדת מקרינה קווי התנגדות אלכסוניים — פריצה שלהם כלפי מעלה מסמנת היפוך מגמה.`,
        apply: (ui) => {
          updateGannzillaConfig({ fanDirection: fanDir }, ui, { reloadAnalysis: true });
          toast(`כיוון המניפה עודכן ל-${fanDir === 'up' ? 'עולה ↑' : 'יורדת ↓'}`, 'ok');
        },
      },
      {
        id: 'gannzillaGrid',
        field: 'Gannzilla · ערך התחלה וצעד (Start / Increment)',
        valueText: `התחלה ${startVal} · צעד ${inc}`,
        why: `במחיר נוכחי של ${fmtPriceSmart(cur)}, צעד של ${inc} והתחלה ב-${startVal} ממקמים את ${symbol} בתוך טבעות הגלגל המרכזיות של Gannzilla כך שכל רבע סיבוב (90°/180°/360°) נותן יעדי תמיכה והתנגדות פרקטיים למסחר.`,
        apply: (ui) => {
          updateGannzillaConfig({ startValue: +Number(startVal).toFixed(4), increment: inc }, ui, { reloadAnalysis: true });
          toast(`גלגל Gannzilla כויל: התחלה ${startVal}, צעד ${inc}`, 'ok');
        },
      },
      {
        id: 'msjSq9',
        field: 'MSJ_GannSQ9 · קנה מידה ומחיר מוקד',
        valueText: `Scale ×${sq9Scale} · מחיר ${fmtPriceSmart(cur)}`,
        why: `לפי שיטת מייקל ג׳נקינס, מנרמלים את מחיר ${symbol} בעזרת מכפיל Scale ×${sq9Scale} כדי ששורש המחיר (√P) ייפול בטווח המדויק של טבלת Square of 9 ויפיק רמות 90°/180°/360° מדויקות.`,
        apply: (ui) => {
          gannViewState.msjCustomPrice = String(+fmtPriceSmart(cur));
          updateGannzillaConfig({ scale: sq9Scale }, ui, { reloadAnalysis: true });
          toast(`מטריצת MSJ Sq9 כוילה ל-Scale ×${sq9Scale}`, 'ok');
        },
      },
      {
        id: 'priceCircles',
        field: 'מעגלי מחיר (rluu Price Circles)',
        valueText: circleSizes,
        why: `גדלי מעגל הרמוניים המותאמים לטווח המחיר של ${symbol} (${fmtPriceSmart(cur)}). חלוקת המחיר בגדלי מעגל אלו חושפת מתי המחיר מתקרב לזווית 90°/180°/360° (סגירת מחזור).`,
        apply: (ui) => {
          gannViewState.customCircleInput = circleSizes;
          ui.rerender();
          toast(`מעגלי המחיר עודכנו ל-${circleSizes}`, 'ok');
        },
      },
    ],
  };
}

function renderSmartAutoFillCard(a, cfg, ui) {
  const sug = computeGannSmartSuggestions(gannViewState.candles, a, gannViewState.symbol, gannViewState.tf);
  if (!sug) return null;

  const applyAll = () => {
    gannViewState.manualPrice = String(sug.manualPrice);
    gannViewState.manualDate = sug.manualDate;
    gannViewState.msjCustomPrice = String(sug.msjCustomPrice);
    gannViewState.customCircleInput = String(sug.customCircleInput);
    updateGannzillaConfig({
      fanScale: String(sug.fanScale),
      fanDirection: sug.fanDirection,
      startValue: sug.startValue,
      increment: sug.increment,
      scale: sug.scale,
    }, ui, { reloadAnalysis: true });
    toast(`✨ כל 7 שדות גאן אוכלסו והותאמו אוטומטית עבור ${sug.symbol}!`, 'ok');
  };

  return h('div', {
    class: 'card',
    style: {
      marginTop: '12px',
      borderColor: 'rgba(56, 189, 248, 0.45)',
      background: 'linear-gradient(180deg, rgba(12, 23, 39, 0.96), rgba(8, 14, 25, 0.96))',
    },
  },
    h('div', { class: 'card-head', style: { flexWrap: 'wrap', gap: '8px' } },
      h('div', {},
        h('h2', { text: `✨ אכלוס חכם של שדות גאן עבור ${sug.symbol} (עם הסבר חינוכי למה)` }),
        h('div', { class: 'card-sub', text: 'המערכת מנתחת את מחיר הנכס, התנודתיות ונקודות המפנה ההיסטוריות שלו ומציעה ערכים מדויקים לכל תא — עם הסבר ברור למתחילים למה דווקא הערך הזה.' }),
      ),
      h('button', {
        class: 'btn btn-sm btn-primary',
        onclick: applyAll,
      }, `✨ אכלס אוטומטית את כל השדות עבור ${sug.symbol}`),
    ),
    h('div', { class: 'table-wrap' },
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', { text: 'שדה / תא במודול גאן' }),
          h('th', { text: 'ערך מומלץ לנכס' }),
          h('th', { text: 'הסבר חינוכי — למה הערך הזה?' }),
          h('th', { text: 'פעולה' }),
        )),
        h('tbody', {}, sug.rows.map((row) => h('tr', {},
          h('td', { class: 'small', style: { fontWeight: '700', color: '#e2e8f0', whiteSpace: 'nowrap' }, text: row.field }),
          h('td', { class: 'mono small', style: { color: '#7dd3fc', fontWeight: '700', whiteSpace: 'nowrap' }, text: row.valueText }),
          h('td', { class: 'small muted', style: { lineHeight: '1.45' }, text: row.why }),
          h('td', {}, h('button', {
            class: 'btn btn-sm',
            onclick: () => row.apply(ui),
          }, '⚡ אכלס')),
        ))),
      ),
    ),
  );
}

async function loadGannData(ui, { force = false } = {}) {
  const key = `${gannViewState.symbol}|${gannViewState.tf}|${gannViewState.manualPrice}|${gannViewState.manualDate}`;
  if (gannViewState.loading && gannViewState.key === key) return;
  gannViewState.key = key;
  gannViewState.loading = true;
  gannViewState.error = null;
  ui.rerender();
  try {
    const candles = await getCandles(gannViewState.symbol, gannViewState.tf, { limit: 700, force });
    const lookback = gannViewState.tf === '1w' ? 5 : 10;
    const analysis = analyzeGannHistoryAndForecast(candles, {
      lookback,
      manualAnchorPrice: gannViewState.manualPrice ? Number(gannViewState.manualPrice) : null,
      manualAnchorDate: gannViewState.manualDate || null,
      assetKind: assetKindFor(gannViewState.symbol),
      gannzillaConfig: getGannzillaConfig(),
    });
    if (!analysis.ok) throw new Error(analysis.error);
    gannViewState.candles = candles;
    gannViewState.analysis = analysis;
    gannViewState.dataProvider = candles.__provider || marketState.provider || 'Live';
    gannViewState.dataSynthetic = !!candles.__synthetic;
    gannViewState.selectedMsjCell = null;
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

function renderGannForecastSvg(candles, analysis, cfg = DEFAULT_GANNZILLA_CONFIG) {
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
  const height = 380;
  const padL = 62;
  const padR = 180;
  const padT = 24;
  const padB = 32;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;
  const futureW = padR - 8;
  const futureBars = analysis.gannFan?.futureBars || 35;

  const xAt = (i) => padL + (i / Math.max(1, show - 1)) * chartW;
  const xAtGlobal = (globalIdx) => {
    const rel = globalIdx - offset;
    if (rel <= show - 1) return padL + (rel / Math.max(1, show - 1)) * chartW;
    const extra = rel - (show - 1);
    return padL + chartW + (extra / Math.max(1, futureBars)) * futureW;
  };
  const yAt = (v) => padT + ((maxV - v) / range) * chartH;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.style.width = '100%';
  svg.style.height = 'auto';
  svg.style.display = 'block';
  svg.style.background = 'linear-gradient(180deg, #0b1220, #070c14)';
  svg.style.borderRadius = '12px';

  // Clip path for Fan/Box overlays so rays never spill outside chart frame
  const clipId = 'gannClip_' + Math.random().toString(36).slice(2, 7);
  const defs = svgEl('defs', {});
  const clip = svgEl('clipPath', { id: clipId });
  clip.appendChild(svgEl('rect', { x: padL, y: padT, width: width - padL - 8, height: chartH }));
  defs.appendChild(clip);
  svg.appendChild(defs);

  // Future Forecast Zone Background
  svg.appendChild(svgEl('rect', {
    x: padL + chartW, y: padT, width: futureW, height: chartH,
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

  // Optional W.D. Gann Box (Square of Price & Time) Overlay
  if (cfg.showBoxOnChart && analysis.gannBox) {
    const box = analysis.gannBox;
    const bx1 = Math.max(padL, xAtGlobal(box.startIdx));
    const bx2 = Math.min(width - 8, xAtGlobal(box.endIdx));
    const by1 = Math.max(padT, yAt(box.high));
    const by2 = Math.min(padT + chartH, yAt(box.low));
    const gBox = svgEl('g', { 'clip-path': `url(#${clipId})` });
    gBox.appendChild(svgEl('rect', {
      x: bx1, y: by1, width: Math.max(4, bx2 - bx1), height: Math.max(4, by2 - by1),
      fill: 'rgba(56, 189, 248, 0.05)', stroke: 'rgba(56, 189, 248, 0.55)', 'stroke-width': 1.2,
    }));
    // 1x1 box diagonals
    gBox.appendChild(svgEl('line', { x1: bx1, y1: by2, x2: bx2, y2: by1, stroke: 'rgba(46, 204, 113, 0.45)', 'stroke-dasharray': '4,3', 'stroke-width': 1 }));
    gBox.appendChild(svgEl('line', { x1: bx1, y1: by1, x2: bx2, y2: by2, stroke: 'rgba(240, 91, 91, 0.45)', 'stroke-dasharray': '4,3', 'stroke-width': 1 }));
    for (const pl of box.priceLines.filter((p) => p.ratio === 0.25 || p.ratio === 0.5 || p.ratio === 0.75)) {
      const py = yAt(pl.price);
      gBox.appendChild(svgEl('line', { x1: bx1, x2: bx2, y1: py, y2: py, stroke: pl.ratio === 0.5 ? 'rgba(242, 204, 96, 0.65)' : 'rgba(56, 189, 248, 0.3)', 'stroke-dasharray': '3,3', 'stroke-width': pl.ratio === 0.5 ? 1.3 : 0.9 }));
    }
    for (const tl of box.timeLines) {
      const tx = xAtGlobal(tl.idx);
      if (tx > bx1 && tx < bx2) {
        gBox.appendChild(svgEl('line', { x1: tx, x2: tx, y1: by1, y2: by2, stroke: 'rgba(56, 189, 248, 0.25)', 'stroke-dasharray': '2,4', 'stroke-width': 0.9 }));
      }
    }
    svg.appendChild(gBox);
  }

  // Optional Full 9-Angle W.D. Gann Fan Overlay (from gannFan.png / Gann Explained)
  if (cfg.showFanOnChart !== false && analysis.gannFan?.rays?.length) {
    const fan = analysis.gannFan;
    const gFan = svgEl('g', { 'clip-path': `url(#${clipId})` });
    const ax = xAtGlobal(fan.anchorIdx);
    const ay = yAt(fan.anchorPrice);
    const endGlobal = candles.length - 1 + futureBars;
    const fxEnd = xAtGlobal(endGlobal);

    for (const ray of fan.rays) {
      const fyEnd = yAt(ray.projectedFuture);
      gFan.appendChild(svgEl('line', {
        x1: ax, y1: ay, x2: fxEnd, y2: fyEnd,
        stroke: ray.color,
        'stroke-opacity': ray.id === '1x1' ? 0.95 : ray.isMain ? 0.68 : 0.36,
        'stroke-width': ray.id === '1x1' ? 2.1 : ray.isMain ? 1.3 : 0.9,
        'stroke-dasharray': ray.id === '1x1' ? '0' : '4,3',
      }));
      const fyNow = yAt(ray.projectedNow);
      if (fyNow >= padT + 10 && fyNow <= padT + chartH - 8) {
        gFan.appendChild(svgEl('text', {
          x: padL + chartW - 32, y: fyNow - 3,
          fill: ray.color, 'font-size': ray.id === '1x1' ? '10' : '8.5',
          'font-weight': ray.id === '1x1' ? '800' : '600',
        }, ray.id));
      }
    }
    // Fan Origin Marker
    gFan.appendChild(svgEl('circle', {
      cx: ax, cy: ay, r: 5.5,
      fill: '#facc15', stroke: '#070c14', 'stroke-width': 1.5,
    }));
    svg.appendChild(gFan);
  }

  // Square of 9 Levels
  for (const lvl of nearbySq9) {
    const y = yAt(lvl.price);
    const col = lvl.isCardinal ? 'rgba(41, 98, 255, 0.85)' : 'rgba(167, 139, 250, 0.45)';
    svg.appendChild(svgEl('line', {
      x1: padL, x2: width - 8, y1: y, y2: y,
      stroke: col, 'stroke-width': lvl.isCardinal ? 1.3 : 0.9, 'stroke-dasharray': lvl.isCardinal ? '0' : '4,4',
    }));
    svg.appendChild(svgEl('text', {
      x: padL + chartW + 8, y: y - 3, fill: lvl.isCardinal ? '#7dd3fc' : '#c4b5fd', 'font-size': '9.5',
    }, `${lvl.degree}° (${lvl.price >= 100 ? lvl.price.toFixed(0) : lvl.price.toFixed(2)})`));
  }

  // Price Polyline
  const pts = closes.map((c, i) => `${xAt(i).toFixed(1)},${yAt(c).toFixed(1)}`).join(' ');
  svg.appendChild(svgEl('polyline', { points: pts, fill: 'none', stroke: '#2ecc71', 'stroke-width': 2 }));

  // Optional W.D. Gann Swing Chart Overlay (2-Bar / 3-Bar Swing Trend Line)
  if (cfg.showSwingOnChart && analysis.swingChart?.swings?.length >= 2) {
    const swingPts = analysis.swingChart.swings
      .filter((s) => s.idx >= offset)
      .map((s) => `${xAt(s.idx - offset).toFixed(1)},${yAt(s.price).toFixed(1)}`)
      .join(' ');
    if (swingPts) {
      svg.appendChild(svgEl('polyline', {
        points: swingPts, fill: 'none', stroke: '#facc15', 'stroke-width': 1.8, 'stroke-linejoin': 'round',
      }));
    }
  }

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

// Interactive Gannzilla Pro v8.3 Wheel (7 Layouts + Protractor Geometry + Chronometer + Planetary Cosmogram)
function renderGannzillaWheelSvg(analysis, cfg = DEFAULT_GANNZILLA_CONFIG) {
  const size = 340;
  const cx = size / 2;
  const cy = size / 2;
  const rot = Number(cfg.angleOffset) || 0;
  const dirSign = cfg.clockwise === false ? -1 : 1;
  const radFor = (deg) => (((deg * dirSign + rot) - 90) * Math.PI) / 180;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.style.width = '100%';
  svg.style.maxWidth = '340px';
  svg.style.height = 'auto';
  svg.style.display = 'block';
  svg.style.margin = '0 auto';
  svg.style.background = 'radial-gradient(circle, #101b30 0%, #070c14 78%)';
  svg.style.borderRadius = '50%';
  svg.style.border = '1px solid #1e2d45';

  // Concentric rings (inner wheel + outer chronometer/cosmogram rings)
  for (const r of [40, 74, 108, 136, 158]) {
    svg.appendChild(svgEl('circle', {
      cx, cy, r, fill: 'none',
      stroke: r === 136 ? '#263a5c' : '#1b2a42',
      'stroke-width': r === 136 ? 1.3 : 1,
    }));
  }

  // Outer Chronometer Date Ring (0° = Mar 21 Vernal Equinox)
  if (cfg.showChronometer !== false || cfg.layout === 'cosmos') {
    const seasonal = analysis.calendars?.seasonalTemplates || [];
    for (const s of seasonal) {
      const rad = radFor(s.deg);
      const tx = cx + Math.cos(rad) * 147;
      const ty = cy + Math.sin(rad) * 147;
      svg.appendChild(svgEl('text', {
        x: tx, y: ty + 3, fill: s.deg % 90 === 0 ? '#f2cc60' : '#7c8ea6',
        'font-size': s.deg % 90 === 0 ? '8.5' : '7.5', 'font-weight': s.deg % 90 === 0 ? '700' : '400',
        'text-anchor': 'middle',
      }, s.mmdd));
    }
  }

  // Outer Cosmogram Planetary Longitude Markers (real approximate ecliptic longitudes)
  if (cfg.showCosmogram !== false && analysis.cosmogram?.planets?.length) {
    for (const pl of analysis.cosmogram.planets) {
      const rad = radFor(pl.lon);
      const px = cx + Math.cos(rad) * 126;
      const py = cy + Math.sin(rad) * 126;
      svg.appendChild(svgEl('circle', { cx: px, cy: py, r: 8.5, fill: '#08101d', stroke: pl.color, 'stroke-width': 1.2 }));
      svg.appendChild(svgEl('text', {
        x: px, y: py + 3.5, fill: pl.color, 'font-size': '10', 'font-weight': '700', 'text-anchor': 'middle',
      }, pl.glyph));
    }
  }

  // Gannzilla Protractor Geometric Figure Overlay
  const prot = cfg.protractor || 'cross';
  const polyR = 108;
  const drawPolygon = (sides, strokeCol, offsetDeg = 0) => {
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const rad = radFor((i * 360) / sides + offsetDeg);
      pts.push(`${(cx + Math.cos(rad) * polyR).toFixed(1)},${(cy + Math.sin(rad) * polyR).toFixed(1)}`);
    }
    svg.appendChild(svgEl('polygon', {
      points: pts.join(' '), fill: 'rgba(56, 189, 248, 0.06)',
      stroke: strokeCol, 'stroke-width': 1.5, 'stroke-dasharray': '4,2',
    }));
  };
  if (prot === 'square') drawPolygon(4, '#38bdf8', 0);
  else if (prot === 'triangle') drawPolygon(3, '#f59e0b', 0);
  else if (prot === 'hexagon') drawPolygon(6, '#2ecc71', 0);
  else if (prot === 'pentagon') drawPolygon(5, '#ec4899', 0);
  else if (prot === 'octagon') drawPolygon(8, '#a78bfa', 0);
  else if (prot === 'cross') {
    for (const d of [0, 90, 180, 270]) {
      const rad = radFor(d);
      svg.appendChild(svgEl('line', {
        x1: cx + Math.cos(rad) * 30, y1: cy + Math.sin(rad) * 30,
        x2: cx + Math.cos(rad) * 134, y2: cy + Math.sin(rad) * 134,
        stroke: 'rgba(59, 130, 246, 0.72)', 'stroke-width': 1.5,
      }));
    }
    for (const d of [45, 135, 225, 315]) {
      const rad = radFor(d);
      svg.appendChild(svgEl('line', {
        x1: cx + Math.cos(rad) * 30, y1: cy + Math.sin(rad) * 30,
        x2: cx + Math.cos(rad) * 134, y2: cy + Math.sin(rad) * 134,
        stroke: 'rgba(167, 139, 250, 0.4)', 'stroke-width': 1, 'stroke-dasharray': '3,3',
      }));
    }
  }

  // Center Anchor
  svg.appendChild(svgEl('circle', { cx, cy, r: 29, fill: 'rgba(41, 98, 255, 0.2)', stroke: '#3b82f6', 'stroke-width': 1.5 }));
  svg.appendChild(svgEl('text', { x: cx, y: cy - 5, fill: '#93c5fd', 'font-size': '8', 'text-anchor': 'middle' }, (cfg.layout || 'sq9').toUpperCase()));
  svg.appendChild(svgEl('text', { x: cx, y: cy + 8, fill: '#fff', 'font-size': '10.5', 'font-weight': '700', 'text-anchor': 'middle' }, num(analysis.anchorPivot.price, 2)));

  if (cfg.layout === 'cosmos') {
    // Highlight current market angle pointer
    const mRad = radFor(analysis.msjSq9?.wheelAngle || 0);
    svg.appendChild(svgEl('line', {
      x1: cx, y1: cy, x2: cx + Math.cos(mRad) * 110, y2: cy + Math.sin(mRad) * 110,
      stroke: '#2ecc71', 'stroke-width': 2,
    }));
    return svg;
  }

  const layoutLevels = computeGannzillaLayoutLevels(analysis.anchorPivot.price, analysis.currentPrice, cfg.layout || 'sq9');
  const degs = cfg.layout === 'hex'
    ? [60, 120, 180, 240, 300, 360]
    : cfg.layout === 'tri'
      ? [120, 240, 360]
      : cfg.layout === 'sq4'
        ? [90, 180, 270, 360]
        : cfg.layout === 'wheel24'
          ? [30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360]
          : [45, 90, 135, 180, 225, 270, 315, 360];

  const nodeR = degs.length > 8 ? 14 : 18;
  const ringR = degs.length > 8 ? 96 : 94;

  degs.forEach((deg) => {
    const rad = radFor(deg);
    const isCard = deg % 90 === 0 || (cfg.layout === 'hex' && deg % 180 === 0) || (cfg.layout === 'tri' && deg % 120 === 0);
    const upLvl = layoutLevels.find((l) => Math.abs(l.degree - deg) <= 2);
    const tx = cx + Math.cos(rad) * ringR;
    const ty = cy + Math.sin(rad) * ringR;
    svg.appendChild(svgEl('circle', { cx: tx, cy: ty, r: nodeR, fill: '#0b1220', stroke: isCard ? '#3b82f6' : '#a78bfa', 'stroke-width': isCard ? 1.4 : 1 }));
    svg.appendChild(svgEl('text', { x: tx, y: ty - 2, fill: '#93c5fd', 'font-size': degs.length > 8 ? '7' : '7.5', 'text-anchor': 'middle' }, `${deg}°`));
    svg.appendChild(svgEl('text', { x: tx, y: ty + 8, fill: '#2ecc71', 'font-size': degs.length > 8 ? '7' : '8', 'font-weight': '700', 'text-anchor': 'middle' },
      upLvl?.price != null ? (upLvl.price >= 100 ? upLvl.price.toFixed(0) : upLvl.price.toFixed(2)) : '—'));
  });

  // Current Price Wheel Angle Needle
  if (analysis.msjSq9?.wheelAngle != null) {
    const pRad = radFor(analysis.msjSq9.wheelAngle);
    svg.appendChild(svgEl('line', {
      x1: cx + Math.cos(pRad) * 30, y1: cy + Math.sin(pRad) * 30,
      x2: cx + Math.cos(pRad) * 112, y2: cy + Math.sin(pRad) * 112,
      stroke: '#facc15', 'stroke-width': 2, 'stroke-linecap': 'round',
    }));
  }

  return svg;
}

// Interactive MSJ_GannSQ9 Odd-Square Spiral Matrix
function renderMsjSq9Matrix(msj, onSelectCell, selectedCell) {
  if (!msj?.grid?.length) return empty('אין נתוני מטריצת MSJ_GannSQ9');
  const dim = msj.dim;
  return h('div', { style: { overflowX: 'auto' } },
    h('div', {
      dir: 'ltr',
      style: {
        display: 'grid',
        gridTemplateColumns: `repeat(${dim}, minmax(42px, 1fr))`,
        gap: '3px',
        padding: '6px',
        background: '#060b13',
        borderRadius: '10px',
        border: '1px solid #1e2d45',
      },
    }, msj.grid.flat().map((cell) => {
      const isSel = selectedCell && selectedCell.row === cell.row && selectedCell.col === cell.col;
      let bg = '#0e1726';
      let border = '1px solid #1a2840';
      let col = '#cbd5e1';
      if (cell.isCenter) { bg = 'rgba(242, 204, 96, 0.25)'; border = '1px solid #f2cc60'; col = '#fde047'; }
      else if (cell.isCardinal) { bg = 'rgba(59, 130, 246, 0.22)'; border = '1px solid rgba(59, 130, 246, 0.65)'; col = '#93c5fd'; }
      else if (cell.isOrdinal) { bg = 'rgba(167, 139, 250, 0.18)'; border = '1px solid rgba(167, 139, 250, 0.5)'; col = '#d8b4fe'; }
      if (cell.isClosest) { bg = 'rgba(46, 204, 113, 0.32)'; border = '2px solid #2ecc71'; col = '#ffffff'; }
      if (isSel) { border = '2px solid #facc15'; }
      const label = cell.scaledPrice >= 1000 ? Math.round(cell.scaledPrice) : cell.scaledPrice >= 10 ? +cell.scaledPrice.toFixed(1) : +cell.scaledPrice.toFixed(3);
      return h('button', {
        type: 'button',
        title: `מחיר: ${cell.scaledPrice} | זווית: ${cell.angleDeg}° | טבעת #${cell.ring} | מרחק: ${cell.distPct}%`,
        onclick: () => onSelectCell(cell),
        style: {
          background: bg,
          border,
          color: col,
          borderRadius: '5px',
          padding: '5px 2px',
          fontSize: '10.5px',
          fontFamily: 'var(--mono, monospace)',
          fontWeight: cell.isClosest || cell.isCenter || cell.isCardinal ? '700' : '400',
          cursor: 'pointer',
          textAlign: 'center',
        },
      }, String(label));
    })),
    h('div', { class: 'row wrap', style: { gap: '10px', marginTop: '8px', fontSize: '11px' } },
      h('span', { style: { color: '#93c5fd' }, text: '■ צלב קרדינלי (0°/90°/180°/270°)' }),
      h('span', { style: { color: '#d8b4fe' }, text: '■ צלב אורדינלי (45°/135°/225°/315°)' }),
      h('span', { style: { color: '#2ecc71' }, text: '■ תא הקרוב למחיר השוק' }),
      h('span', { style: { color: '#fde047' }, text: '■ ערך התחלה (מרכז)' }),
    ),
    selectedCell ? h('div', { class: 'notice', style: { marginTop: '8px', fontSize: '12px' } },
      `תא נבחר: מחיר ${num(selectedCell.scaledPrice, 4)} (מספר ${selectedCell.rawNumber}) · זווית ${selectedCell.angleDeg}° · טבעת #${selectedCell.ring} · מרחק מהשוק ${pct(selectedCell.distPct)} · סוג: ${selectedCell.isCenter ? 'מרכז' : selectedCell.isCardinal ? 'קרדינלי (90°)' : selectedCell.isOrdinal ? 'אורדינלי (45°)' : 'רגיל'}`,
    ) : null,
  );
}

export function renderGann(root, ui) {
  const key = `${gannViewState.symbol}|${gannViewState.tf}|${gannViewState.manualPrice}|${gannViewState.manualDate}`;
  if (gannViewState.key !== key && !gannViewState.loading) {
    setTimeout(() => loadGannData(ui), 0);
  }

  const a = gannViewState.analysis;

  // Build categorized <optgroup> dropdown from ASSET_CATALOG + active custom symbol if typed by user
  const groups = new Map();
  for (const item of ASSET_CATALOG) {
    const g = item.group || 'נכסים זמינים';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(item);
  }
  const hasActiveInCatalog = ASSET_CATALOG.some((x) => x.symbol === gannViewState.symbol);
  const selectChildren = [];
  if (!hasActiveInCatalog && gannViewState.symbol) {
    selectChildren.push(
      h('optgroup', { label: 'נכס מותאם נבחר' },
        h('option', { value: gannViewState.symbol, selected: true }, `${gannViewState.symbol} (מותאם)`),
      ),
    );
  }
  for (const [gLabel, items] of groups.entries()) {
    selectChildren.push(
      h('optgroup', { label: gLabel },
        items.map((item) => h('option', {
          value: item.symbol,
          selected: gannViewState.symbol === item.symbol,
        }, item.label)),
      ),
    );
  }

  mount(root,
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: 'Gannzilla Pro v8.3 · MSJ_GannSQ9 · W.D. Gann Fan & Trading Tools · Fundamental Proof' }),
        h('h1', { text: `מעבדת גאן המלאה · ${gannViewState.symbol}` }),
        h('p', { text: 'בחר כל נכס מהרשימה (30 נכסים עם נתוני אמת: קריפטו, מניות, מדדים, סחורות ומט״ח) או הקלד כל סימול — וקבל אכלוס חכם של כל שדות גאן עם הסבר חינוכי למה.' }),
      ),
      h('div', { class: 'head-actions' },
        h('select', {
          class: 'input',
          value: gannViewState.symbol,
          onchange: (e) => selectGannAsset(e.target.value, ui),
        }, selectChildren),
        h('select', {
          class: 'input',
          value: gannViewState.tf,
          onchange: (e) => {
            gannViewState.tf = e.target.value;
            gannViewState.key = null;
            loadGannData(ui, { force: true });
          },
        }, [['1d', 'יומי (2+ שנים)'], ['1w', 'שבועי (5 שנים)'], ['1h', 'שעתי (3 חודשים)']].map(([v, l]) =>
          h('option', { value: v, selected: gannViewState.tf === v }, l)
        )),
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => loadGannData(ui, { force: true }) }, '⟳ הרץ ניתוח'),
        h('button', {
          class: 'btn btn-sm',
          disabled: gannViewState.multiScanLoading,
          onclick: () => runMultiAssetGannScan(ui),
        }, gannViewState.multiScanLoading ? '⏳ סורק נכסים…' : '🌐 סרוק הוכחת גאן על כל הנכסים'),
        h('button', {
          class: 'btn btn-sm',
          style: { borderColor: 'rgba(125, 211, 252, 0.45)', color: '#7dd3fc' },
          onclick: () => openGannMasterGuideModal(a, getGannzillaConfig(), gannViewState.symbol),
        }, '📖 מדריך הסבר לכל הגלגלים והאינפוגרפיקה'),
      ),
    ),
  );

  // Manual Anchor & Custom Symbol Bar
  const customInputEl = h('input', {
    class: 'input',
    type: 'text',
    placeholder: 'כל סימול אחר (למשל JPM, COIN, LINKUSDT)',
    style: { width: '215px' },
    value: gannViewState.customSymbol,
    oninput: (e) => { gannViewState.customSymbol = e.target.value.trim().toUpperCase(); },
    onkeydown: (e) => {
      if (e.key === 'Enter') {
        const val = e.target.value.trim().toUpperCase();
        if (val) { gannViewState.customSymbol = val; selectGannAsset(val, ui); }
      }
    },
  });
  const manualPriceEl = h('input', {
    class: 'input',
    type: 'number',
    step: 'any',
    placeholder: 'מחיר עוגן ידני (אופציונלי)',
    style: { width: '175px' },
    value: gannViewState.manualPrice,
    oninput: (e) => { gannViewState.manualPrice = e.target.value; },
  });
  const manualDateEl = h('input', {
    class: 'input',
    type: 'date',
    style: { width: '155px' },
    value: gannViewState.manualDate,
    oninput: (e) => { gannViewState.manualDate = e.target.value; },
  });

  mount(root,
    h('div', { class: 'card', style: { marginTop: '12px', padding: '12px 14px' } },
      h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap', alignItems: 'center' } },
        h('span', { class: 'small muted', text: '🎯 התאמה והזנת נכס/עוגן:' }),
        customInputEl,
        h('button', {
          class: 'btn btn-sm btn-primary',
          onclick: () => {
            const val = (customInputEl.value || gannViewState.customSymbol || '').trim().toUpperCase();
            if (!val) { toast('הקלד סימול (למשל AMD, META, GC=F, LINKUSDT)', 'bad'); return; }
            gannViewState.customSymbol = val;
            selectGannAsset(val, ui);
          },
        }, 'טען נכס מותאם'),
        manualPriceEl,
        manualDateEl,
        h('button', {
          class: 'btn btn-sm btn-primary',
          onclick: () => {
            gannViewState.manualPrice = manualPriceEl.value;
            gannViewState.manualDate = manualDateEl.value;
            gannViewState.key = null;
            loadGannData(ui);
          },
        }, 'החל עוגן'),
        h('button', {
          class: 'btn btn-sm',
          onclick: () => { gannViewState.manualPrice = ''; gannViewState.manualDate = ''; gannViewState.key = null; loadGannData(ui); },
        }, 'עוגן אוטומטי'),
        gannViewState.candles?.length
          ? tag(
              `${gannViewState.dataSynthetic ? '⚠ נתוני הדגמה' : '✓ נתוני אמת'}: ${gannViewState.dataProvider || marketState.provider || 'Live'} · ${gannViewState.candles.length} נרות`,
              gannViewState.dataSynthetic ? 'red' : 'live',
            )
          : null,
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
                onclick: () => selectGannAsset(r.symbol, ui),
              }, 'נתח לעומק')),
            ))),
          ),
        ),
      ),
    );
  }

  if (gannViewState.loading) {
    mount(root, h('div', { class: 'card', style: { marginTop: '14px', padding: '40px', textAlign: 'center' } },
      h('div', { text: `⏳ טוען היסטוריית ${gannViewState.symbol}, מחשב Square of 9, הקסגון, נוסחאות מייקל ג׳נקינס ומאמת מול אירועים פונדמנטליסטיים…` }),
    ));
    return;
  }

  if (gannViewState.error || !a) {
    mount(root, h('div', { class: 'card', style: { marginTop: '14px' } }, empty(gannViewState.error || 'בחר נכס ולחץ "הרץ ניתוח"')));
    return;
  }

  const cfg = getGannzillaConfig();

  // Smart Auto-Fill Proposal Card with Educational Explanations for every Gann field
  mount(root, renderSmartAutoFillCard(a, cfg, ui));

  const effScale = cfg.scale === 'auto' || !Number(cfg.scale) ? autoScaleForPrice(a.currentPrice) : Number(cfg.scale);
  const activeMsjPrice = gannViewState.msjCustomPrice && Number(gannViewState.msjCustomPrice) > 0
    ? Number(gannViewState.msjCustomPrice)
    : a.currentPrice;
  const activeMsj = activeMsjPrice === a.currentPrice && a.msjSq9
    ? a.msjSq9
    : computeMsjSq9Analysis(activeMsjPrice, {
      startValue: cfg.startValue || 1,
      increment: cfg.increment || 1,
      scale: effScale,
      ringCount: cfg.ringCount || 5,
      clockwise: cfg.clockwise !== false,
      angleOffset: cfg.angleOffset || 0,
    });

  // Hidden file input for real Gannzilla-Pro-v.8.3\Gannzilla.ini import
  const iniInput = h('input', {
    type: 'file',
    accept: '.ini,.txt',
    style: { display: 'none' },
    onchange: async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const { config, keyCount } = parseGannzillaIni(text, file.name);
        updateGannzillaConfig(config, ui, { reloadAnalysis: true });
        toast(`קובץ ${file.name} יובא בהצלחה (${keyCount} פרמטרים · פריסה ${config.layout.toUpperCase()})`, 'ok');
      } catch (err) {
        toast('ייבוא Gannzilla.ini נכשל: ' + err.message, 'bad');
      } finally {
        e.target.value = '';
      }
    },
  });

  const fanIconEl = h('img', {
    src: './assets/gann-fan-icon.png',
    alt: 'Gann Fan',
    style: { width: '16px', height: '16px', verticalAlign: 'middle', marginInlineEnd: '5px', filter: 'invert(1) brightness(1.3)', borderRadius: '2px' },
  });

  mount(root,
    iniInput,
    // KPI Row
    h('div', { class: 'grid cols-4', style: { marginTop: '14px' } },
      h('div', { class: 'metric' }, h('span', { text: 'ציון התכנסות גאן (Gann Explained)' }), h('b', { class: (a.confluence?.score || 0) >= 65 ? 'green mono' : 'gold mono', text: `${a.confluence?.score ?? 0}/100 · ${a.swingChart?.trend === 'bullish' ? 'סווינג עולה' : a.swingChart?.trend === 'bearish' ? 'סווינג יורד' : 'דשדוש'}` })),
      h('div', { class: 'metric' }, h('span', { text: 'דיוק חיזוי צירים בעבר' }), h('b', { class: a.hitRatePct >= 50 ? 'green mono' : 'gold mono', text: `${a.hitRatePct}% (${a.totalHits}/${a.totalTests})` })),
      h('div', { class: 'metric' }, h('span', { text: 'אירועים פונדמנטליסטיים שנחזו ע"י גאן' }), h('b', { class: 'green mono', text: `${a.fundamentalProof.matchedCount}/${a.fundamentalProof.totalInSpan} (${a.fundamentalProof.matchRatePct}%)` })),
      h('div', { class: 'metric' }, h('span', { text: 'MSJ Sq9 · מניפת 1x1' }), h('b', { class: a.angle1x1?.abovePrice ? 'green' : 'red', text: `טבעת #${a.jenkins.ringNumber} (${a.msjSq9?.wheelAngle ?? 0}°) · ${a.angle1x1?.abovePrice ? 'מעל 1x1' : 'מתחת ל-1x1'}` })),
    ),

    // Main Forecast SVG Chart + Interactive Gann Fan / Gann Box / Gann Swing Overlay Toolbar
    h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'card-head' },
        h('div', {},
          h('h2', { text: `${gannViewState.symbol} · מפת חיזוי ומניפת גאן (${marketState.provider || 'חי'})` }),
          h('div', { class: 'card-sub', text: 'מניפת גאן 9 זוויות (8x1–1x8) · תיבת גאן · סווינג גאן · רמות Sq9 · ★ אירועים פונדמנטליסטיים שאומתו' }),
        ),
        h('div', { class: 'row wrap', style: { gap: '6px' } },
          gannExplainButton('fan_chart', a, cfg, gannViewState.symbol),
          tag(`עוגן: ${num(a.anchorPivot.price, 2)} (${a.anchorPivot.manual ? 'ידני' : a.anchorPivot.type === 'low' ? 'שפל' : 'שיא'})`, 'live'),
        ),
      ),
      h('div', { class: 'row wrap', style: { gap: '8px', marginBottom: '10px', alignItems: 'center' } },
        h('button', {
          class: `btn btn-sm ${cfg.showFanOnChart !== false ? 'btn-primary' : ''}`,
          onclick: () => updateGannzillaConfig({ showFanOnChart: cfg.showFanOnChart === false }, ui),
        }, fanIconEl, 'מניפת גאן (9 זוויות)'),
        h('select', {
          class: 'input',
          style: { width: '120px' },
          value: cfg.fanDirection || 'auto',
          onchange: (e) => updateGannzillaConfig({ fanDirection: e.target.value }, ui, { reloadAnalysis: true }),
        }, [['auto', 'כיוון: אוטומטי'], ['up', 'מניפה עולה ↑'], ['down', 'מניפה יורדת ↓']].map(([v, l]) =>
          h('option', { value: v, selected: (cfg.fanDirection || 'auto') === v }, l)
        )),
        h('input', {
          class: 'input',
          type: 'number',
          step: 'any',
          placeholder: `יחידה/נר (${a.gannFan?.autoUnit || 'אוטו'})`,
          title: 'יחידת מחיר לנר עבור זווית 1x1 (השאר ריק לאוטומטי)',
          style: { width: '150px' },
          value: cfg.fanScale || '',
          onchange: (e) => updateGannzillaConfig({ fanScale: e.target.value.trim() }, ui, { reloadAnalysis: true }),
        }),
        h('button', {
          class: `btn btn-sm ${cfg.showBoxOnChart ? 'btn-primary' : ''}`,
          onclick: () => updateGannzillaConfig({ showBoxOnChart: !cfg.showBoxOnChart }, ui),
        }, '▦ תיבת גאן (Gann Box)'),
        h('button', {
          class: `btn btn-sm ${cfg.showSwingOnChart ? 'btn-primary' : ''}`,
          onclick: () => updateGannzillaConfig({ showSwingOnChart: !cfg.showSwingOnChart }, ui),
        }, `∿ סווינג גאן (${cfg.swingBarMode || 2}-Bar)`),
        h('select', {
          class: 'input',
          style: { width: '115px' },
          value: String(cfg.swingBarMode || 2),
          onchange: (e) => updateGannzillaConfig({ swingBarMode: Number(e.target.value) || 2 }, ui, { reloadAnalysis: true }),
        }, [['1', '1-Bar Swing'], ['2', '2-Bar Swing'], ['3', '3-Bar Swing']].map(([v, l]) =>
          h('option', { value: v, selected: String(cfg.swingBarMode || 2) === v }, l)
        )),
      ),
      renderGannForecastSvg(gannViewState.candles, a, cfg),
      a.gannFan?.ruleOfAllAngles
        ? h('div', { class: 'small muted', style: { marginTop: '8px' }, text: a.gannFan.ruleOfAllAngles })
        : null,
    ),

    // Gannzilla Pro v8.3 Interactive Wheel (+ Gannzilla.ini Import/Export) + MSJ_GannSQ9 / Gann Fan / Jenkins Suite
    h('div', { class: 'grid cols-2', style: { marginTop: '14px' } },
      h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('div', {},
            h('h2', { text: '☸️ Gannzilla Pro v8.3 · גלגל רב-פריסות + מד-זווית + קוסמוגרם' }),
            h('div', { class: 'card-sub', text: cfg.iniFileName ? `נטען קובץ תצורה: ${cfg.iniFileName} · מסונכרן בין מכשירים` : 'תואם Gannzilla Pro v8.3 (Sq9 / Sq4 / Sq144 / הקסגון / משולש / גלגל 24 / קוסמוגרם + ייבוא .ini)' }),
          ),
          h('div', { class: 'row wrap', style: { gap: '6px' } },
            gannExplainButton('gannzilla_wheel', a, cfg, gannViewState.symbol),
            h('button', { class: 'btn btn-sm btn-primary', onclick: () => iniInput.click() }, '⬆ ייבוא Gannzilla.ini'),
            h('button', {
              class: 'btn btn-sm btn-ghost',
              onclick: () => {
                downloadFile('Gannzilla.ini', exportGannzillaIni(cfg), 'text/plain');
                toast('קובץ Gannzilla.ini יוצא בהצלחה', 'ok');
              },
            }, '⬇ ייצוא .ini'),
          ),
        ),
        // Gannzilla Pro Layout Buttons
        h('div', { class: 'row wrap', style: { gap: '5px', marginBottom: '8px' } },
          [
            ['sq9', 'Square of 9'],
            ['sq4', 'Square of 4'],
            ['sq144', 'Square of 144'],
            ['hex', 'הקסגון 60°'],
            ['tri', 'משולש 120°'],
            ['wheel24', 'גלגל 24'],
            ['cosmos', 'Cosmogram'],
          ].map(([id, lbl]) =>
            h('button', {
              class: `btn btn-sm ${(cfg.layout || 'sq9') === id ? 'btn-primary' : ''}`,
              onclick: () => updateGannzillaConfig({ layout: id }, ui),
            }, lbl)
          ),
        ),
        // Gannzilla Pro Protractor, Rotation, Start Value, Increment, Direction Controls
        h('div', { class: 'row wrap', style: { gap: '6px', marginBottom: '10px', alignItems: 'center' } },
          h('select', {
            class: 'input',
            style: { width: '145px' },
            value: cfg.protractor || 'cross',
            onchange: (e) => updateGannzillaConfig({ protractor: e.target.value }, ui),
          }, [
            ['cross', 'מד-זווית: צלב 90°/45°'],
            ['square', 'מד-זווית: ריבוע 90°'],
            ['triangle', 'מד-זווית: משולש 120°'],
            ['hexagon', 'מד-זווית: הקסגון 60°'],
            ['pentagon', 'מד-זווית: מחומש 72°'],
            ['octagon', 'מד-זווית: מתומן 45°'],
            ['none', 'מד-זווית: ללא'],
          ].map(([v, l]) => h('option', { value: v, selected: (cfg.protractor || 'cross') === v }, l))),
          h('input', {
            class: 'input',
            type: 'number',
            title: 'StartValue (ערך התחלה במרכז)',
            placeholder: 'התחלה (1)',
            style: { width: '82px' },
            value: cfg.startValue ?? 1,
            onchange: (e) => updateGannzillaConfig({ startValue: Math.max(0.001, Number(e.target.value) || 1) }, ui, { reloadAnalysis: true }),
          }),
          h('input', {
            class: 'input',
            type: 'number',
            step: 'any',
            title: 'Increment (קפיצת צעד)',
            placeholder: 'צעד (1)',
            style: { width: '74px' },
            value: cfg.increment ?? 1,
            onchange: (e) => updateGannzillaConfig({ increment: Math.max(0.001, Number(e.target.value) || 1) }, ui, { reloadAnalysis: true }),
          }),
          h('input', {
            class: 'input',
            type: 'number',
            title: 'Angle Offset (סיבוב גלגל 0°–359°)',
            placeholder: 'זווית 0°',
            style: { width: '76px' },
            value: cfg.angleOffset ?? 0,
            onchange: (e) => updateGannzillaConfig({ angleOffset: ((Number(e.target.value) || 0) % 360 + 360) % 360 }, ui, { reloadAnalysis: true }),
          }),
          h('button', {
            class: 'btn btn-sm',
            onclick: () => updateGannzillaConfig({ clockwise: cfg.clockwise === false }, ui, { reloadAnalysis: true }),
          }, cfg.clockwise === false ? '↺ נגד השעון' : '↻ עם השעון'),
          h('button', {
            class: `btn btn-sm ${cfg.showChronometer !== false ? 'btn-primary' : ''}`,
            onclick: () => updateGannzillaConfig({ showChronometer: cfg.showChronometer === false }, ui),
          }, 'כרונומטר'),
          h('button', {
            class: `btn btn-sm ${cfg.showCosmogram !== false ? 'btn-primary' : ''}`,
            onclick: () => updateGannzillaConfig({ showCosmogram: cfg.showCosmogram === false }, ui),
          }, 'כוכבים'),
        ),
        renderGannzillaWheelSvg(a, cfg),
        h('div', { class: 'tiny muted', style: { marginTop: '8px', textAlign: 'center' }, text: `פריסה: ${(cfg.layout || 'sq9').toUpperCase()} · מד-זווית: ${cfg.protractor || 'cross'} · זווית מחיר נוכחי (מחט צהובה): ${a.msjSq9?.wheelAngle ?? 0}° · טבעת #${a.jenkins.ringNumber}` }),
        // Active Planetary Longitudes Strip
        a.cosmogram?.planets?.length
          ? h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '8px', justifyContent: 'center' } },
            ...a.cosmogram.planets.map((pl) => tag(`${pl.glyph} ${pl.lon}°`, 'dry')),
          )
          : null,
      ),

      h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('div', {},
            h('h2', { text: '🧮 מנוע MSJ_GannSQ9, מניפת גאן ומחשבוני ג׳נקינס' }),
            h('div', { class: 'card-sub', text: 'מניפת 9 הזוויות · מטריצת Square of 9 האינטראקטיבית של MSJ_GannSQ9 · מעלות 45°–720° · זמני שורש ריבועי ושמיניות' }),
          ),
          gannExplainButton('msj_calc', a, cfg, gannViewState.symbol),
        ),
        h('div', { class: 'row', style: { gap: '6px', marginBottom: '10px', flexWrap: 'wrap' } },
          [
            ['fan', 'מניפת גאן (9 זוויות)'],
            ['msj_grid', 'מטריצת MSJ_GannSQ9'],
            ['msj_deg', 'מעלות וזמני MSJ'],
            ['jenkins', '√Price + ספירלה'],
            ['eighths', 'שמיניות (1/8–8/8)'],
            ['hex', 'הקסגון (60°)'],
          ].map(([id, lbl]) =>
            h('button', {
              class: `btn btn-sm ${gannViewState.calcTab === id ? 'btn-primary' : ''}`,
              onclick: () => { gannViewState.calcTab = id; ui.rerender(); },
            }, lbl)
          ),
        ),
        gannViewState.calcTab === 'fan'
          ? h('div', {},
            h('div', { class: 'table-wrap' },
              h('table', {},
                h('thead', {}, h('tr', {},
                  h('th', { text: 'זווית מניפה' }),
                  h('th', { text: 'מעלה' }),
                  h('th', { text: 'מחיר היום' }),
                  h('th', { text: 'מרחק' }),
                  h('th', { text: 'מעמד' }),
                )),
                h('tbody', {}, (a.gannFan?.rays || []).map((r) => h('tr', {},
                  h('td', { class: 'small', style: { color: r.color, fontWeight: r.isMain ? '700' : '400' }, text: r.name }),
                  h('td', { class: 'mono', text: r.degLabel }),
                  h('td', { class: 'mono', text: num(r.projectedNow, 2) }),
                  h('td', { class: 'mono ' + (r.distPct >= 0 ? 'green' : 'red'), text: pct(r.distPct) }),
                  h('td', {}, tag(r.abovePrice ? 'תמיכה' : 'התנגדות', r.abovePrice ? 'live' : 'red')),
                ))),
              ),
            ),
            h('div', { class: 'tiny muted', style: { marginTop: '8px' }, text: `קנה מידה פעיל: ${a.gannFan?.unitPerBar} ליחידה לנר · ${a.gannFan?.barsElapsed} נרות מהעוגן (${a.gannFan?.dir > 0 ? 'מניפה עולה מהשפל' : 'מניפה יורדת מהשיא'})` }),
          )
          : gannViewState.calcTab === 'msj_grid'
            ? h('div', {},
              h('div', { class: 'row wrap', style: { gap: '6px', marginBottom: '8px', alignItems: 'center' } },
                h('input', {
                  class: 'input',
                  type: 'number',
                  step: 'any',
                  placeholder: `מחיר לחישוב (${num(a.currentPrice, 2)})`,
                  style: { width: '155px' },
                  value: gannViewState.msjCustomPrice,
                  onchange: (e) => { gannViewState.msjCustomPrice = e.target.value; ui.rerender(); },
                }),
                h('select', {
                  class: 'input',
                  style: { width: '125px' },
                  value: String(cfg.scale || 'auto'),
                  onchange: (e) => updateGannzillaConfig({ scale: e.target.value === 'auto' ? 'auto' : Number(e.target.value) }, ui, { reloadAnalysis: true }),
                }, [
                  ['auto', `Scale: אוטו (${effScale})`],
                  ['0.01', 'Scale ×0.01 (מט"ח)'],
                  ['0.1', 'Scale ×0.1'],
                  ['1', 'Scale ×1 (מניות)'],
                  ['10', 'Scale ×10'],
                  ['100', 'Scale ×100 (BTC)'],
                ].map(([v, l]) => h('option', { value: v, selected: String(cfg.scale || 'auto') === v }, l))),
                tag(`√=${activeMsj.sqrtVal} · ${activeMsj.wheelAngle}° · טבעת #${activeMsj.ring}`, 'opt'),
              ),
              renderMsjSq9Matrix(activeMsj, (cell) => {
                gannViewState.selectedMsjCell = cell;
                ui.rerender();
              }, gannViewState.selectedMsjCell),
            )
            : gannViewState.calcTab === 'msj_deg'
              ? h('div', {},
                h('div', { class: 'table-wrap', style: { maxHeight: '260px', overflowY: 'auto' } },
                  h('table', {},
                    h('thead', {}, h('tr', {},
                      h('th', { text: 'מעלת MSJ_GannSQ9' }),
                      h('th', { text: 'יעד למעלה (+)' }),
                      h('th', { text: 'יעד למטה (-)' }),
                      h('th', { text: 'סוג' }),
                    )),
                    h('tbody', {}, (activeMsj.degreeTargets || []).map((d) => h('tr', {},
                      h('td', { class: 'small', text: d.label }),
                      h('td', { class: 'mono green', text: `${num(d.upPrice, 2)} (${pct(d.upDistPct)})` }),
                      h('td', { class: 'mono red', text: d.downPrice != null ? `${num(d.downPrice, 2)} (${pct(d.downDistPct)})` : '—' }),
                      h('td', {}, tag(d.group, d.group === 'Cardinal' ? 'live' : d.group === 'Trine' ? 'opt' : 'dry')),
                    ))),
                  ),
                ),
                h('div', { class: 'table-wrap', style: { marginTop: '10px' } },
                  h('table', {},
                    h('thead', {}, h('tr', {}, h('th', { text: 'המרת זמן √Price (MSJ_GannSQ9)' }), h('th', { text: '0.5×' }), h('th', { text: '1.0× (Square)' }), h('th', { text: '2.0×' }))),
                    h('tbody', {}, (activeMsj.timeConversions || []).map((tc) => h('tr', {},
                      h('td', { class: 'small', text: tc.unit }),
                      h('td', { class: 'mono', text: String(tc.half) }),
                      h('td', { class: 'mono gold', text: String(tc.val) }),
                      h('td', { class: 'mono green', text: String(tc.mult2) }),
                    ))),
                  ),
                ),
              )
              : gannViewState.calcTab === 'jenkins'
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
                  : h('div', { class: 'table-wrap' },
                    h('table', {},
                      h('thead', {}, h('tr', {}, h('th', { text: 'זווית' }), h('th', { text: 'משמעות גיאומטרית' }), h('th', { text: 'מחיר' }), h('th', { text: 'מרחק' }))),
                      h('tbody', {}, a.hexLevels.slice(0, 10).map((l) => h('tr', {},
                        h('td', { class: 'mono', text: `${l.degree}°` }),
                        h('td', { class: 'small', text: l.meaning }),
                        h('td', { class: 'mono', text: num(l.price, 2) }),
                        h('td', { class: 'mono ' + (l.distPct >= 0 ? 'green' : 'red'), text: pct(l.distPct) }),
                      ))),
                    ),
                  ),
      ),
    ),

    // W.D. Gann Trading Tools — Gann Explained Confluence Checklist + Swing Trend & Cosmogram Aspects
    h('div', { class: 'grid cols-2', style: { marginTop: '14px' } },
      h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('div', {},
            h('h2', { text: '📐 צ׳ק-ליסט כללי המסחר של W.D. Gann (Gann Explained)' }),
            h('div', { class: 'card-sub', text: 'בדיקה אוטומטית של 6 חוקי הליבה של גאן: זווית 1x1, כלל 50%, מד סווינג, Sq9, חלון זמן וגיבוי היסטורי' }),
          ),
          h('div', { class: 'row wrap', style: { gap: '6px' } },
            gannExplainButton('gann_rules', a, cfg, gannViewState.symbol),
            tag(`${a.confluence?.score ?? 0}/100 · ${a.confluence?.verdict || ''}`, (a.confluence?.score || 0) >= 65 ? 'live' : 'opt'),
          ),
        ),
        h('div', { class: 'table-wrap' },
          h('table', {},
            h('thead', {}, h('tr', {}, h('th', { text: 'כלל גאן' }), h('th', { text: 'סטטוס' }), h('th', { text: 'פירוט חי' }))),
            h('tbody', {}, (a.confluence?.rules || []).map((rule) => h('tr', {},
              h('td', { class: 'small', text: rule.name }),
              h('td', {}, tag(rule.status, rule.passed ? 'live' : 'dry')),
              h('td', { class: 'tiny muted', text: rule.detail }),
            ))),
          ),
        ),
      ),

      h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('div', {},
            h('h2', { text: '🔭 סווינג גאן + היבטים פלנטריים פעילים (Cosmogram)' }),
            h('div', { class: 'card-sub', text: 'מבנה הסווינג הפעיל לפי כללי גאן + זוויות גיאומטריות פעילות בין כוכבי הלכת היום' }),
          ),
          h('div', { class: 'row wrap', style: { gap: '6px' } },
            gannExplainButton('swing_cosmos', a, cfg, gannViewState.symbol),
            tag(a.swingChart?.trend === 'bullish' ? 'מגמת סווינג עולה' : a.swingChart?.trend === 'bearish' ? 'מגמת סווינג יורדת' : 'דשדוש', a.swingChart?.trend === 'bullish' ? 'live' : 'red'),
          ),
        ),
        h('div', { class: 'notice', style: { marginBottom: '10px', fontSize: '12px' }, text: a.swingChart?.rule3BarSignal || '—' }),
        h('div', { class: 'grid cols-3', style: { gap: '8px', marginBottom: '10px' } },
          h('div', { class: 'metric' }, h('span', { text: 'שיא סווינג אחרון' }), h('b', { class: 'mono', text: a.swingChart?.lastSwingHigh ? num(a.swingChart.lastSwingHigh.price, 2) : '—' })),
          h('div', { class: 'metric' }, h('span', { text: 'נקודת 50% סווינג' }), h('b', { class: 'mono gold', text: a.swingChart?.midpoint50 != null ? num(a.swingChart.midpoint50, 2) : '—' })),
          h('div', { class: 'metric' }, h('span', { text: 'שפל סווינג אחרון' }), h('b', { class: 'mono', text: a.swingChart?.lastSwingLow ? num(a.swingChart.lastSwingLow.price, 2) : '—' })),
        ),
        (a.cosmogram?.aspects || []).length
          ? h('div', { class: 'table-wrap' },
            h('table', {},
              h('thead', {}, h('tr', {}, h('th', { text: 'זוג פלנטרי' }), h('th', { text: 'היבט (Aspect)' }), h('th', { text: 'סטייה (Orb)' }))),
              h('tbody', {}, a.cosmogram.aspects.slice(0, 6).map((asp) => h('tr', {},
                h('td', { class: 'small', text: `${asp.glyphs} ${asp.p1} · ${asp.p2}` }),
                h('td', {}, tag(asp.aspect, asp.strong ? 'live' : 'dry')),
                h('td', { class: 'mono', text: `±${asp.orb}°` }),
              ))),
            ),
          )
          : h('div', { class: 'small muted', text: 'אין היבט פלנטרי הדוק (±5°) בדיוק היום.' }),
      ),
    ),

    // PriceChartingTool / printPriceTimeInfoDatetimes.py Compatible Ephemeris & Price-Time Info Panel
    a.priceTimeInfo ? (() => {
      const pt = a.priceTimeInfo;
      const ptCsvInput = h('input', {
        type: 'file',
        accept: '.csv,.txt,.log',
        style: { display: 'none' },
        onchange: async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            const pts = parsePriceTimeCsv(await file.text());
            if (!pts.length) {
              toast('לא זוהו שורות בפורמט YYYY-MM-DD,price', 'bad');
              return;
            }
            updateGannzillaConfig({ customPriceTimePoints: pts }, ui, { reloadAnalysis: true });
            toast(`יובאו ${pts.length} נקודות Price-Time (Julian Day) בהצלחה`, 'ok');
          } catch (err) {
            toast('ייבוא Price-Time נכשל: ' + err.message, 'bad');
          } finally {
            e.target.value = '';
          }
        },
      });
      return h('div', { class: 'card', style: { marginTop: '14px' } },
        ptCsvInput,
        h('div', { class: 'card-head' },
          h('div', {},
            h('h2', { text: '🪐 נתוני Price-Time ו-Julian Day (תואם PriceChartingTool · Ephemeris)' }),
            h('div', { class: 'card-sub', text: 'מיישם את printPriceTimeInfoDatetimes.py: תאריך התחלה/סיום ו-Julian Day, שיא/שפל טווח, נקודות Price-Time ממוינות כרונולוגית, אורך שמש (☉) וייצוא/ייבוא CSV' }),
          ),
          h('div', { class: 'row wrap', style: { gap: '6px' } },
            gannExplainButton('ephemeris', a, cfg, gannViewState.symbol),
            h('button', {
              class: 'btn btn-sm btn-primary',
              onclick: () => copyText(pt.csvCompact),
            }, '📋 העתק YYYY-MM-DD,price'),
            h('button', {
              class: 'btn btn-sm',
              onclick: () => {
                downloadFile(`${gannViewState.symbol}-price-time-julian.csv`, pt.csvFull, 'text/csv');
                toast('קובץ CSV עם Julian Day ו-Ephemeris הורד בהצלחה', 'ok');
              },
            }, '⬇ ייצוא CSV (Julian Day)'),
            h('button', {
              class: 'btn btn-sm btn-ghost',
              onclick: () => ptCsvInput.click(),
            }, '⬆ ייבוא פלט PriceChartingTool'),
            (cfg.customPriceTimePoints?.length)
              ? h('button', {
                class: 'btn btn-sm btn-ghost',
                onclick: () => updateGannzillaConfig({ customPriceTimePoints: [] }, ui, { reloadAnalysis: true }),
              }, 'נקה מיובאים')
              : null,
          ),
        ),
        h('div', { class: 'grid cols-4', style: { gap: '8px', marginBottom: '12px' } },
          h('div', { class: 'metric' }, h('span', { text: 'נר ראשון (Earliest · JD)' }), h('b', { class: 'mono', text: `${pt.earliest.date} · JD ${pt.earliest.julianDay}` })),
          h('div', { class: 'metric' }, h('span', { text: 'נר אחרון (Latest · JD)' }), h('b', { class: 'mono', text: `${pt.latest.date} · JD ${pt.latest.julianDay}` })),
          h('div', { class: 'metric' }, h('span', { text: 'שיא טווח (Highest High)' }), h('b', { class: 'mono green', text: `${num(pt.highest.price, 2)} (${pt.highest.date})` })),
          h('div', { class: 'metric' }, h('span', { text: 'שפל טווח (Lowest Low)' }), h('b', { class: 'mono red', text: `${num(pt.lowest.price, 2)} (${pt.lowest.date})` })),
        ),
        h('div', { class: 'table-wrap', style: { maxHeight: '280px', overflowY: 'auto' } },
          h('table', {},
            h('thead', {}, h('tr', {},
              h('th', { text: 'תאריך (UTC)' }),
              h('th', { text: 'Julian Day (JD)' }),
              h('th', { text: 'מחיר' }),
              h('th', { text: 'סוג נקודה' }),
              h('th', { text: 'Δ ימים' }),
              h('th', { text: 'קצב מחיר/יום' }),
              h('th', { text: 'אורך שמש ☉' }),
              h('th', { text: 'זווית Sq9' }),
            )),
            h('tbody', {}, pt.points.slice().reverse().slice(0, 40).map((p) => h('tr', {},
              h('td', { class: 'mono', text: p.date }),
              h('td', { class: 'mono muted', text: String(p.julianDay) }),
              h('td', { class: 'mono', text: num(p.price, 2) }),
              h('td', {}, tag(p.type, p.source === 'imported' ? 'opt' : p.type.includes('Low') ? 'live' : 'red')),
              h('td', { class: 'mono', text: p.deltaDays != null ? `+${p.deltaDays}d` : '—' }),
              h('td', { class: 'mono ' + ((p.ratePerDay || 0) >= 0 ? 'green' : 'red'), text: p.ratePerDay != null ? num(p.ratePerDay, 2) : '—' }),
              h('td', { class: 'mono gold', text: p.sunLon != null ? `${p.sunLon}°` : '—' }),
              h('td', { class: 'mono', text: `${p.wheelAngle}°` }),
            ))),
          ),
        ),
      );
    })() : null,

    // Gann vs. Fundamental Events Proof Section
    h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'card-head' },
        h('div', {},
          h('h2', { text: '⚡ הוכחת גאן מול אירועים פונדמנטליסטיים (ריבית פד, אינפלציה, חצייה, דוחות ומשברים)' }),
          h('div', { class: 'card-sub', text: 'הוכחה כיצד מחזורי גאן ורמות Sq9/Hexagon סימנו מראש את התאריך והמחיר עוד לפני שהחדשות התפרסמו' }),
        ),
        h('div', { class: 'row wrap', style: { gap: '6px' } },
          gannExplainButton('fundamental_proof', a, cfg, gannViewState.symbol),
          tag(`${a.fundamentalProof.matchedCount}/${a.fundamentalProof.totalInSpan} אירועים הוכחו (${a.fundamentalProof.matchRatePct}%)`, a.fundamentalProof.matchRatePct >= 50 ? 'live' : 'opt'),
        ),
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
          gannExplainButton('future_pivots', a, cfg, gannViewState.symbol),
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
          gannExplainButton('future_pivots', a, cfg, gannViewState.symbol),
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
          gannExplainButton('calendars', a, cfg, gannViewState.symbol),
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

    // rluu-pricechartingtool-f05e608 Suite: Price Circles, Musical Octave Ratios & Lookback Multiple
    renderPriceChartingToolPanel(a, ui),

    // Smart AI Working Proposals Panel
    h('div', { class: 'card', style: { marginTop: '14px', borderColor: 'rgba(167, 139, 250, 0.45)' } },
      h('div', { class: 'card-head' },
        h('div', {},
          h('h2', { text: `🤖 הצעות AI לעבודה ומחקר חכם (${gannViewState.symbol})` }),
          h('div', { class: 'card-sub', text: 'סינתזה אוטומטית של Square of 9, הקסגון, זווית 1x1 ולוחות השנה של Gannzilla להמלצת פעולה' }),
        ),
        h('div', { class: 'row wrap', style: { gap: '6px' } },
          gannExplainButton('ai_proposals', a, cfg, gannViewState.symbol),
          h('button', {
            class: 'btn btn-sm btn-primary',
            disabled: gannViewState.aiLoading,
            onclick: () => askAiForGannProposal(a, ui),
          }, gannViewState.aiLoading ? '⏳ מפיק ניתוח AI…' : '✨ הפק הצעת עבודה מעמיקה מ-AI'),
        ),
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
        h('div', { class: 'row wrap', style: { gap: '6px' } },
          gannExplainButton('library', a, cfg, gannViewState.symbol),
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

function renderPriceChartingToolPanel(a, ui) {
  const pctData = a.priceChartingTool || {};
  const customList = gannViewState.customCircleInput
    .split(/[,\s]+/)
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  const circleRows = customList.length
    ? computePriceCircleAngles(a.currentPrice, customList)
    : (pctData.circleAngles || []);
  const musical = gannViewState.musicalSystem === 'pythagorean'
    ? pctData.musicalPythagorean
    : pctData.musicalJust;
  const lookbacks = pctData.lookbackMultiples || [];

  return h('div', { class: 'card', style: { marginTop: '14px', borderColor: 'rgba(56, 189, 248, 0.42)' } },
    h('div', { class: 'card-head', style: { flexWrap: 'wrap', gap: '8px' } },
      h('div', {},
        h('h2', { text: '🎼 PriceChartingTool (rluu) · מעגלי מחיר, אוקטבות מוזיקליות ו-Lookback Multiple' }),
        h('div', { class: 'card-sub', text: 'שילוב אלגוריתמי rluu-pricechartingtool-f05e608: המרת מחיר לזוויות על מעגלים (12–360), מרווחים מוזיקליים (Just Intonation & Pythagorean) ושכפול מחזורי עבר (Lookback Multiple)' }),
      ),
      h('div', { class: 'row wrap', style: { gap: '6px' } },
        gannExplainButton('rluu_suite', a, getGannzillaConfig(), gannViewState.symbol),
        [
          ['circles', '⭕ מעגלי מחיר (Circles)'],
          ['musical', '🎵 אוקטבות מוזיקליות (Ratios)'],
          ['lookback', '🔁 Lookback Multiple'],
        ].map(([id, lbl]) => h('button', {
          class: `btn btn-sm ${gannViewState.pctTab === id ? 'btn-primary' : ''}`,
          onclick: () => { gannViewState.pctTab = id; ui.rerender(); },
        }, lbl)),
      ),
    ),

    gannViewState.pctTab === 'circles'
      ? h('div', {},
        h('div', { class: 'row wrap', style: { gap: '8px', marginBottom: '10px', alignItems: 'center' } },
          h('span', { class: 'small muted', text: `מחיר נוכחי: ${num(a.currentPrice, 4)} · נוסחת convertPriceToAnglesOnCircles: ((price % circle) / circle) × 360°` }),
          h('input', {
            class: 'input',
            type: 'text',
            placeholder: 'מעגלים מותאמים (למשל 3600, 20736)',
            style: { maxWidth: '250px' },
            value: gannViewState.customCircleInput,
            onchange: (e) => { gannViewState.customCircleInput = e.target.value; ui.rerender(); },
          }),
        ),
        h('div', { class: 'table-wrap' },
          h('table', {},
            h('thead', {}, h('tr', {},
              h('th', { text: 'גודל מעגל (Circle)' }),
              h('th', { class: 'num', text: 'מחזורים שלמים' }),
              h('th', { class: 'num', text: 'זווית על המעגל' }),
              h('th', { text: 'היבט הרמוני' }),
              h('th', { class: 'num', text: 'סגירת מחזור הבאה' }),
            )),
            h('tbody', {}, circleRows.map((row) => h('tr', {},
              h('td', { class: 'mono', text: `${row.circleSize}${row.isCustom ? ' (מותאם)' : ''}` }),
              h('td', { class: 'num mono', text: num(row.cyclesCompleted, 0) }),
              h('td', { class: 'num mono ' + (row.isExactAspect ? 'green' : ''), text: `${row.angle}°` }),
              h('td', {}, row.isExactAspect ? tag(row.aspect, 'live') : h('span', { class: 'tiny muted', text: row.aspect })),
              h('td', { class: 'num mono muted', text: num(row.nextFullCyclePrice, 2) }),
            ))),
          ),
        ),
      )
      : gannViewState.pctTab === 'musical'
        ? h('div', {},
          h('div', { class: 'row between wrap', style: { gap: '8px', marginBottom: '10px' } },
            h('div', { class: 'small muted', text: `עוגן פיבוט: ${num(musical?.anchorPrice, 2)} · תמיכה מוזיקלית קרובה: ${musical?.nearestSupport ? `${num(musical.nearestSupport.price, 2)} (${musical.nearestSupport.frac})` : '—'} · התנגדות קרובה: ${musical?.nearestResistance ? `${num(musical.nearestResistance.price, 2)} (${musical.nearestResistance.frac})` : '—'}` }),
            h('div', { class: 'row', style: { gap: '6px' } },
              h('button', {
                class: `btn btn-sm ${gannViewState.musicalSystem === 'just' ? 'btn-primary' : ''}`,
                onclick: () => { gannViewState.musicalSystem = 'just'; ui.rerender(); },
              }, 'Just Intonation (אינטונציה טהורה)'),
              h('button', {
                class: `btn btn-sm ${gannViewState.musicalSystem === 'pythagorean' ? 'btn-primary' : ''}`,
                onclick: () => { gannViewState.musicalSystem = 'pythagorean'; ui.rerender(); },
              }, 'Pythagorean (פיתגוראי)'),
            ),
          ),
          h('div', { class: 'table-wrap' },
            h('table', {},
              h('thead', {}, h('tr', {},
                h('th', { text: 'מרווח מוזיקלי' }),
                h('th', { text: 'יחס' }),
                h('th', { class: 'num', text: 'מכפיל' }),
                h('th', { class: 'num', text: 'יעד מחיר' }),
                h('th', { class: 'num', text: 'מרחק מהשוק' }),
              )),
              h('tbody', {}, (musical?.all || []).map((row) => h('tr', {},
                h('td', { class: 'small', text: `${row.he} · ${row.name}` }),
                h('td', {}, tag(row.frac, row.dir === 'up' ? 'live' : 'dry')),
                h('td', { class: 'num mono', text: String(row.ratioDisplay) }),
                h('td', { class: 'num mono', text: num(row.price, 2) }),
                h('td', { class: 'num mono ' + (row.distPct >= 0 ? 'green' : 'red'), text: pct(row.distPct) }),
              ))),
            ),
          ),
        )
        : h('div', {},
          h('div', { class: 'small muted', style: { marginBottom: '10px' }, text: 'אלגוריתם Lookback Multiple משכפל מקטעי מחיר היסטוריים קדימה במחזורים של 30–365 ימים, מחשב מקדם סקאלה והסטה לטווח המחיר הנוכחי, ומדרג את המחזור הדומה ביותר לקצב השוק היום.' }),
          lookbacks.length
            ? h('div', { class: 'table-wrap' },
              h('table', {},
                h('thead', {}, h('tr', {},
                  h('th', { text: 'מחזור Lookback' }),
                  h('th', { class: 'num', text: 'מתאם צורה (Pearson)' }),
                  h('th', { text: 'קוטביות' }),
                  h('th', { class: 'num', text: 'סקאלה (Scale)' }),
                  h('th', { text: 'תאריך מפנה צפוי משוכפל' }),
                )),
                h('tbody', {}, lookbacks.map((lb) => h('tr', {},
                  h('td', { class: 'small', text: lb.label }),
                  h('td', { class: 'num mono ' + (lb.correlation >= 0.35 ? 'green' : lb.correlation <= -0.35 ? 'red' : 'muted'), text: String(lb.correlation) }),
                  h('td', {}, tag(lb.polarity, Math.abs(lb.correlation) >= 0.35 ? 'live' : 'dry')),
                  h('td', { class: 'num mono', text: `×${lb.scaleFactor}` }),
                  h('td', { class: 'small', text: lb.projectedDate ? `${lb.projectedDate} (+${lb.projectedDaysAhead}d) · ${lb.projectedType}` : '—' }),
                ))),
              ),
            )
            : empty('נדרשת היסטוריה ארוכה יותר לחישוב Lookback Multiple (עבור לטווח יומי 1d).'),
        ),
  );
}
