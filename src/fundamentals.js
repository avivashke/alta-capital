// Fundamental & Macro Analysis Data Stream + Multi-Methodology Engine (100% Free, Zero API Keys):
// - US Stocks: SEC EDGAR XBRL filings (Revenue, Net Income, EPS, P/E, Net Margin, Cash, Debt) + Yahoo Finance
// - Crypto: CoinGecko Public API (Market Cap, 24h Vol, Supply, ATH Drawdown, Community Sentiment)
// - Macro Regime: Yahoo Finance (^VIX Volatility, ^TNX 10Y Treasury Yield, DXY US Dollar Index)
// - News Stream: Yahoo Finance RSS / Google News RSS via /api/market?action=news

import { store } from './store.js';

export const FUNDAMENTAL_ASSETS = ['NVDA', 'AAPL', 'TSLA', 'MSFT', 'AMZN', 'GOOGL', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const REFRESH_TTL_MS = 10 * 60 * 1000;

function scoreFundamental(item) {
  if (!item || !item.ok) return { score: 50, bias: 'נייטרלי' };
  let score = 50;
  if (item.kind === 'stock') {
    if (item.netMarginPct != null) {
      if (item.netMarginPct >= 20) score += 18;
      else if (item.netMarginPct >= 10) score += 10;
      else if (item.netMarginPct < 0) score -= 15;
    }
    if (item.pe != null) {
      if (item.pe > 0 && item.pe <= 28) score += 12;
      else if (item.pe > 55) score -= 6;
    }
    if (item.debtToAssetsPct != null) {
      if (item.debtToAssetsPct < 30) score += 10;
      else if (item.debtToAssetsPct > 65) score -= 10;
    }
  } else if (item.kind === 'crypto') {
    if (item.change30dPct != null) {
      if (item.change30dPct > 10) score += 14;
      else if (item.change30dPct < -15) score -= 10;
    }
    if (item.sentimentUpPct != null) {
      if (item.sentimentUpPct >= 70) score += 12;
      else if (item.sentimentUpPct < 45) score -= 8;
    }
    if (item.athDrawdownPct != null && item.athDrawdownPct > -25) score += 6;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const bias = score >= 62 ? 'חזק פונדמנטלית' : score <= 40 ? 'חולשה פונדמנטלית' : 'מאוזן';
  return { score, bias };
}

function macroRegime(macro) {
  if (!macro || !macro.ok) return 'לא נסרק';
  const vix = macro.vix ?? 18;
  const tnx = macro.us10yYield ?? 4.2;
  if (vix > 26 || tnx > 4.8) return 'זהירות מאקרו (Risk-Off · VIX/תשואות גבוהים)';
  if (vix < 17 && tnx < 4.4) return 'סביבה תומכת סיכון (Risk-On)';
  return 'מאקרו מאוזן';
}

export function analyzeFundamentalMethodologies(item, macro) {
  const isStock = item?.kind === 'stock';

  // 1. Benjamin Graham (Value & Balance Sheet Safety)
  let grahamScore = 50;
  let grahamText = 'יחס מכפיל רווח (P/E) ויציבות חוב מאוזנים.';
  if (isStock) {
    if (item.pe != null && item.pe > 0 && item.pe <= 22) { grahamScore += 25; grahamText = `מכפיל P/E אטרקטיבי (${item.pe}) לפי עקרון מרווח הביטחון של גרהאם.`; }
    else if (item.pe > 45) { grahamScore -= 18; grahamText = `מכפיל P/E גבוה (${item.pe}) — מתומחר עם פרמיית צמיחה וללא מרווח ביטחון קלאסי.`; }
    if (item.debtToAssetsPct != null && item.debtToAssetsPct < 30) grahamScore += 15;
    else if (item.debtToAssetsPct > 60) grahamScore -= 15;
  } else if (item) {
    if (item.athDrawdownPct != null && item.athDrawdownPct < -35) { grahamScore += 18; grahamText = `דיסקאונט של ${item.athDrawdownPct}% מהשיא ההיסטורי (ATH) יוצר מרווח ערך יחסי.`; }
    else grahamText = 'בקריפטו אין תזרים מזומנים קלאסי; הערכת הערך מתבססת על נזילות, שווי שוק ומרחק מ-ATH.';
  }

  // 2. Warren Buffett (Economic Moat & Profitability)
  let buffettScore = 50;
  let buffettText = 'רווחיות תפעולית יציבה.';
  if (isStock) {
    if (item.netMarginPct >= 25) { buffettScore = 88; buffettText = `שולי רווח נקי יוצאי דופן (${item.netMarginPct}%) המעידים על חפיר תחרותי (Moat) חזק במיוחד.`; }
    else if (item.netMarginPct >= 12) { buffettScore = 70; buffettText = `שולי רווח נקי בריאים (${item.netMarginPct}%) ותמחור תזרימי חיובי.`; }
    else if (item.netMarginPct != null && item.netMarginPct < 5) { buffettScore = 35; buffettText = `שולי רווח נמוכים (${item.netMarginPct}%) — תחרותיות גבוהה ומרווח תפעולי דק.`; }
  } else if (item) {
    buffettScore = (item.marketCap || 0) > 50e9 ? 76 : 55;
    buffettText = 'דומיננטיות רשת (Network Effect) ונפח מסחר גבוה משמשים כ"חפיר" של פרוטוקולים מובילים.';
  }

  // 3. Peter Lynch (GARP - Growth at a Reasonable Price)
  let lynchScore = 55;
  let lynchText = 'איזון בין קצב הצמיחה למחיר השוק.';
  if (isStock) {
    if (item.eps > 0 && item.netMarginPct >= 15) { lynchScore = 80; lynchText = `רווח למניה חיובי ($${item.eps}) בשילוב שולי רווח גבוהים תומך בצמיחה איכותית.`; }
    else if (item.eps != null && item.eps <= 0) { lynchScore = 35; lynchText = 'רווח למניה שלילי/אפסי — דורש מעקב צמוד אחר קצב שריפת המזומנים.'; }
  } else if (item) {
    lynchScore = (item.change30dPct || 0) > 0 ? 74 : 46;
    lynchText = `שינוי חודשי של ${item.change30dPct ?? 0}% לצד סנטימנט קהילה חיובי של ${item.sentimentUpPct ?? 50}%.`;
  }

  // 4. Ray Dalio (All-Weather Macro Regime)
  let dalioScore = 60;
  let dalioText = 'סביבת מאקרו מאוזנת.';
  const vix = macro?.vix ?? 18;
  const tnx = macro?.us10yYield ?? 4.2;
  if (vix < 18 && tnx < 4.4) {
    dalioScore = 82;
    dalioText = `תנודתיות שוק נמוכה (VIX ${vix}) ותשואות אג"ח מתונות (${tnx}%) תומכים בנכסי סיכון (Risk-On).`;
  } else if (vix > 25 || tnx > 4.7) {
    dalioScore = 38;
    dalioText = `לחץ מאקרו (VIX ${vix}, תשואת 10Y ${tnx}%) — דליו ממליץ על הקטנת מינוף וגידור בזהב/אג"ח.`;
  } else {
    dalioText = `משטר מאקרו בינוני: VIX ברמה ${vix} ותשואת 10 שנים ${tnx}%.`;
  }

  const clamp = (v) => Math.max(5, Math.min(98, Math.round(v)));
  return [
    { id: 'graham', name: 'בנג׳מין גרהאם (ערך)', score: clamp(grahamScore), text: grahamText },
    { id: 'buffett', name: 'וורן באפט (חפיר ואיכות)', score: clamp(buffettScore), text: buffettText },
    { id: 'lynch', name: 'פיטר לינץ׳ (GARP)', score: clamp(lynchScore), text: lynchText },
    { id: 'dalio', name: 'ריי דליו (מאקרו All-Weather)', score: clamp(dalioScore), text: dalioText },
  ];
}

export function explainNewsHeadline(title) {
  const t = String(title || '').toLowerCase();
  if (/earnings|revenue|eps|beat|guidance|profit|quarter/.test(t)) {
    return 'השפעה ישירה על דוחות כספיים, מכפיל הרווח (P/E) ותזרים המזומנים העתידי.';
  }
  if (/fed|rate|inflation|cpi|fomc|yield|powell|cut|hike/.test(t)) {
    return 'חדשות מאקרו/ריבית המשפיעות על עלות ההון (Discount Rate) ועל תיאבון הסיכון בשווקים.';
  }
  if (/ai|chip|gpu|cloud|data center|launch|product|partnership/.test(t)) {
    return 'זרז צמיחה אסטרטגי המחזק את החפיר העסקי (Moat) ואת תחזית ההכנסות.';
  }
  if (/sec|etf|regulation|lawsuit|ban|tariff|probe/.test(t)) {
    return 'אירוע רגולטורי/משפטי המשפיע על פרמיית הסיכון ועל זרימת כספים מוסדיים.';
  }
  return 'עדכון שוק שוטף — מומלץ להצליב מול מגמת המחיר ומצב המאקרו הכללי.';
}

export async function fetchAssetNews(symbol) {
  if (typeof window === 'undefined') return [];
  try {
    const res = await fetch(`/api/market?action=news&symbol=${encodeURIComponent(symbol)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.items || []).map((item) => ({
      ...item,
      impactNote: explainNewsHeadline(item.title),
    }));
  } catch {
    return [];
  }
}

export async function refreshFundamentals({ force = false } = {}) {
  if (typeof window === 'undefined') return null;
  const fState = store.state.fundamentals || { updatedAt: null, macro: null, assets: {} };
  const age = Date.now() - (fState.updatedAt || 0);
  if (!force && age < REFRESH_TTL_MS && Object.keys(fState.assets || {}).length >= 3) {
    return fState;
  }

  try {
    const macroRes = await fetch('/api/market?action=macro').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const assets = { ...(fState.assets || {}) };

    await Promise.all(FUNDAMENTAL_ASSETS.map(async (sym) => {
      try {
        const res = await fetch(`/api/market?action=fundamentals&symbol=${encodeURIComponent(sym)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data?.ok) {
          const { score, bias } = scoreFundamental(data);
          assets[sym] = { ...data, score, bias, updatedAt: Date.now() };
        }
      } catch { /* skip single asset */ }
    }));

    const macro = macroRes?.ok
      ? { ...macroRes, regime: macroRegime(macroRes) }
      : fState.macro;

    store.state.fundamentals = {
      updatedAt: Date.now(),
      macro,
      assets,
    };
    store.log('info', 'עומר · פונדמנטל', `זרם נתונים פונדמנטליסטי עודכן (${Object.keys(assets).length} נכסים · ${macro?.regime || 'מאקרו'})`);
    store.save();
    store.emit();
    return store.state.fundamentals;
  } catch (err) {
    console.warn('[fundamentals] refresh failed:', err.message);
    return fState;
  }
}

export function formatCompactUsd(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}
