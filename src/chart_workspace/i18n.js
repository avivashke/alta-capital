// Bidi & Localization helper for TradingView Chart Workspace (#/charts, #/gann)
// Ensures RTL for UI controls while strictly isolating LTR numbers, tickers, prices, and dates.

export const I18N = {
  he: {
    symbolSearch: 'חיפוש סימול',
    timeframe: 'טיים פריים',
    chartType: 'סוג גרף',
    candlestick: 'נרות יפניים (Candles)',
    heikinAshi: 'הייקין אשי (Heikin Ashi)',
    line: 'קו סגירה (Line)',
    area: 'אזור (Area)',
    bars: 'עמודות (Bars)',
    indicators: 'אינדיקטורים',
    layers: 'שכבות (Layers)',
    templates: 'תבניות (Templates)',
    alerts: 'התראות (Alerts)',
    replay: 'הרצה לאחור (Replay)',
    measure: 'מדוד (Measure)',
    fullscreen: 'מסך מלא',
    settings: 'הגדרות',
    camera: 'צילום מסך',
    hideAllOverlays: 'הסתר את כל השכבות',
    removeAllDrawings: 'מחק את כל הציורים',
    resetChart: 'איפוס גרף לברירת מחדל',
    gannLevels: 'רמות גאן (שמיניות 1/8–8/8)',
    swingMarkers: 'איתותי תתי-מגמה (Signal Top/Bottom)',
    forecastZone: 'אזור תחזית עתידי וזמני ריבוע',
    subTrendBull: 'תת-מגמה עולה',
    subTrendBear: 'תת-מגמה יורדת',
    strengthThreshold: 'סף עוצמת איתות',
    undo: 'בטל ציור (Ctrl+Z)',
    redo: 'שחזר ציור (Ctrl+Y)',
    magnetMode: 'מגנט (היצמדות לנרות)',
    lockDrawings: 'נעל ציורים',
    aiExplain: 'הסבר ניתוח עם AI',
    proFeatures: 'פיצ׳רים מתקדמים',
    upgradeToPro: 'שדרוג למסלול Pro',
    saveTemplate: 'שמור תבנית גרף',
    loadTemplate: 'טען תבנית',
    exportJson: 'ייצוא JSON',
    importJson: 'ייבוא JSON',
    logScale: 'סולם לוגריתמי',
    autoScale: 'התאמה אוטומטית',
    linearScale: 'סולם ליניארי',
  },
  en: {
    symbolSearch: 'Search Symbol',
    timeframe: 'Timeframe',
    chartType: 'Chart Type',
    candlestick: 'Candlesticks',
    heikinAshi: 'Heikin Ashi',
    line: 'Line',
    area: 'Area',
    bars: 'Bars',
    indicators: 'Indicators',
    layers: 'Layers',
    templates: 'Templates',
    alerts: 'Alerts',
    replay: 'Replay Mode',
    measure: 'Measure Tool',
    fullscreen: 'Fullscreen',
    settings: 'Settings',
    camera: 'Screenshot',
    hideAllOverlays: 'Hide All Overlays',
    removeAllDrawings: 'Remove All Drawings',
    resetChart: 'Reset Chart to Defaults',
    gannLevels: 'Gann Levels (1/8–8/8 Eighths)',
    swingMarkers: 'Swing Markers (ST/SB)',
    forecastZone: 'Forecast Zone & Time Squaring',
    subTrendBull: 'Bullish Sub-Trend',
    subTrendBear: 'Bearish Sub-Trend',
    strengthThreshold: 'Signal Strength Threshold',
    undo: 'Undo (Ctrl+Z)',
    redo: 'Redo (Ctrl+Y)',
    magnetMode: 'Magnet Mode (Snap to OHLC)',
    lockDrawings: 'Lock Drawings',
    aiExplain: 'Explain with AI',
    proFeatures: 'Pro Features',
    upgradeToPro: 'Upgrade to Pro',
    saveTemplate: 'Save Template',
    loadTemplate: 'Load Template',
    exportJson: 'Export JSON',
    importJson: 'Import JSON',
    logScale: 'Logarithmic Scale',
    autoScale: 'Auto Scale',
    linearScale: 'Linear Scale',
  },
};

/**
 * Creates an isolated LTR text node/span preventing punctuation inversion in mixed Hebrew-English strings.
 */
export function bidiText(content, { dir = 'ltr', className = 'mono ltr-isolate' } = {}) {
  const span = document.createElement('bdi');
  span.setAttribute('dir', dir);
  if (className) span.className = className;
  span.textContent = String(content ?? '');
  return span;
}

export function formatPrice(v, decimals = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) < 1) return n.toFixed(4);
  if (Math.abs(n) < 10) return n.toFixed(3);
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatPercent(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0.00%';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}
