// Fundamental & Macro Analysis Data Stream (100% Free, Zero API Keys):
// - US Stocks: SEC EDGAR XBRL filings (Revenue, Net Income, EPS, P/E, Net Margin, Cash, Debt) + Yahoo Finance
// - Crypto: CoinGecko Public API (Market Cap, 24h Vol, Supply, ATH Drawdown, Community Sentiment)
// - Macro Regime: Yahoo Finance (^VIX Volatility, ^TNX 10Y Treasury Yield, DXY US Dollar Index)

import { store } from './store.js';

const FUNDAMENTAL_ASSETS = ['NVDA', 'AAPL', 'TSLA', 'MSFT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
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
