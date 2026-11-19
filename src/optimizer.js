// Parameter search: seeded random sampling + local hill climbing, chunked so the UI stays responsive.
// Includes continuous live market-regime detection & recent-window adaptation.

import { STRATEGIES } from './strategies.js';
import { evaluate, runBacktest } from './backtest.js';
import { ema, atr } from './indicators.js';

const yieldTick = () => new Promise((resolve) => setTimeout(resolve, 0));

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function resolveSpace(strategyIdOrSpace) {
  return typeof strategyIdOrSpace === 'string' ? STRATEGIES[strategyIdOrSpace].space : strategyIdOrSpace;
}

/**
 * Detect the current live market regime from real OHLCV candles using:
 * - EMA20 vs EMA50 trend slope
 * - Kaufman Efficiency Ratio (ER) over the last 20 bars
 * - Current 14-bar ATR% relative to median 60-bar ATR%
 */
export function detectMarketRegime(candles) {
  if (!Array.isArray(candles) || candles.length < 60) {
    return {
      regime: 'unknown',
      label: 'טוען משטר שוק',
      er: 0,
      volRatio: 1,
      slopePct: 0,
      atrPct: 0,
      recommendedFamilies: ['ema_trend', 'breakout', 'rsi_reversion'],
      paramBias: {},
      updatedAt: Date.now(),
    };
  }

  const closes = candles.map((c) => c.c);
  const n = closes.length;
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const atr14 = atr(candles, 14);

  const lastC = closes[n - 1] || 1;
  const lastE20 = e20[n - 1] ?? lastC;
  const lastE50 = e50[n - 1] ?? lastC;
  const slopePct = lastE50 > 0 ? +(((lastE20 - lastE50) / lastE50) * 100).toFixed(2) : 0;

  // Kaufman Efficiency Ratio (20 bars)
  const erWin = Math.min(20, n - 1);
  const netMove = Math.abs(closes[n - 1] - closes[n - 1 - erWin]);
  let pathLen = 0;
  for (let i = n - erWin; i < n; i++) {
    pathLen += Math.abs(closes[i] - closes[i - 1]);
  }
  const er = pathLen > 0 ? +(netMove / pathLen).toFixed(3) : 0;

  // Relative volatility (current ATR% vs median of last 60 bars)
  const atrPcts = [];
  for (let i = Math.max(14, n - 60); i < n; i++) {
    if (atr14[i] != null && closes[i] > 0) atrPcts.push((atr14[i] / closes[i]) * 100);
  }
  const currentAtrPct = atrPcts.length ? atrPcts[atrPcts.length - 1] : 0;
  const sortedAtr = [...atrPcts].sort((a, b) => a - b);
  const medianAtrPct = sortedAtr.length ? sortedAtr[Math.floor(sortedAtr.length / 2)] : currentAtrPct || 1;
  const volRatio = medianAtrPct > 0 ? +(currentAtrPct / medianAtrPct).toFixed(2) : 1;

  let regime = 'range_mean_revert';
  let label = 'דשדוש / חזרה לממוצע';
  let recommendedFamilies = ['rsi_reversion', 'mean_reversion_z', 'gann_swing_sq9', 'gann_time_cycle'];
  let paramBias = { atrStop: [1.1, 2.4], rr: [1.3, 2.7] };

  if (volRatio >= 1.38) {
    regime = 'high_vol_breakout';
    label = 'תנודתיות גבוהה · פריצות';
    recommendedFamilies = ['vol_breakout', 'breakout', 'supertrend_adx', 'gann_swing_sq9', 'momentum'];
    paramBias = { atrStop: [1.8, 3.6], rr: [1.8, 3.8] };
  } else if (slopePct >= 0.75 && er >= 0.27) {
    regime = 'strong_bull';
    label = 'מגמה עולה חזקה';
    recommendedFamilies = ['ema_trend', 'supertrend_adx', 'breakout', 'macd_swing', 'vol_breakout'];
    paramBias = { atrStop: [1.5, 3.0], rr: [2.0, 4.2] };
  } else if (slopePct <= -0.75 && er >= 0.27) {
    regime = 'strong_bear';
    label = 'מגמה יורדת חזקה';
    recommendedFamilies = ['supertrend_adx', 'vol_breakout', 'momentum', 'ema_trend', 'gann_swing_sq9'];
    paramBias = { atrStop: [1.4, 2.8], rr: [1.8, 3.6] };
  } else if (volRatio <= 0.72) {
    regime = 'low_vol_squeeze';
    label = 'דחיסת תנודתיות · לקראת פריצה';
    recommendedFamilies = ['breakout', 'vol_breakout', 'gann_time_cycle', 'ema_trend'];
    paramBias = { atrStop: [1.2, 2.5], rr: [1.8, 3.5] };
  }

  return {
    regime,
    label,
    er,
    volRatio,
    slopePct,
    atrPct: +currentAtrPct.toFixed(2),
    recommendedFamilies,
    paramBias,
    updatedAt: Date.now(),
  };
}

/** Combine AI Director parameter bias with live market-regime parameter bias. */
export function mergeRegimeBias(aiBias = null, regimeBias = null) {
  if (!aiBias && !regimeBias) return null;
  if (!aiBias) return regimeBias;
  if (!regimeBias) return aiBias;
  return { ...regimeBias, ...aiBias };
}

/** Evaluate strategy performance specifically on the most recent market window (~25% of bars). */
export function evaluateRecentWindow(candles, strategyId, params, cfg) {
  if (!Array.isArray(candles) || candles.length < 100) return null;
  const recentLen = Math.max(80, Math.min(220, Math.floor(candles.length * 0.25)));
  const slice = candles.slice(-recentLen);
  const res = runBacktest(slice, strategyId, params, cfg);
  return res?.metrics || null;
}

/** Narrow the search space with an AI/regime-proposed range, clamped to the real parameter bounds. */
export function mergeSpace(strategyId, override) {
  const base = STRATEGIES[strategyId].space;
  if (!override) return base;
  const out = { ...base };
  for (const [key, range] of Object.entries(override)) {
    const spec = base[key];
    if (!spec || spec.type === 'bool' || !Array.isArray(range) || range.length !== 2) continue;
    const lo = Math.max(spec.min, Math.min(Number(range[0]), Number(range[1])));
    const hi = Math.min(spec.max, Math.max(Number(range[0]), Number(range[1])));
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi - lo < (spec.type === 'int' ? 2 : 0.05)) continue;
    out[key] = { ...spec, min: lo, max: hi };
  }
  return out;
}

function randFloat(min, max, step) {
  const v = min + Math.random() * (max - min);
  return step ? Math.round(v / step) * step : Math.round(v * 100) / 100;
}

export function sampleParams(strategyIdOrSpace) {
  const space = resolveSpace(strategyIdOrSpace);
  const out = {};
  for (const [key, spec] of Object.entries(space)) {
    if (spec.type === 'bool') out[key] = Math.random() > 0.45;
    else if (spec.type === 'int') out[key] = randInt(spec.min, spec.max);
    else out[key] = randFloat(spec.min, spec.max, spec.step);
  }
  return out;
}

export function mutateParams(strategyIdOrSpace, params, strength = 0.35) {
  const space = resolveSpace(strategyIdOrSpace);
  const out = { ...params };
  for (const [key, spec] of Object.entries(space)) {
    if (Math.random() > 0.55) continue;
    if (spec.type === 'bool') {
      out[key] = Math.random() > 0.7 ? !out[key] : out[key];
    } else if (spec.type === 'int') {
      const span = Math.max(1, (spec.max - spec.min) * strength);
      out[key] = Math.max(spec.min, Math.min(spec.max, Math.round(out[key] + (Math.random() - 0.5) * 2 * span)));
    } else {
      const span = Math.max((spec.step || 0.1), (spec.max - spec.min) * strength);
      const v = Math.max(spec.min, Math.min(spec.max, out[key] + (Math.random() - 0.5) * 2 * span));
      out[key] = Math.round(v / (spec.step || 0.1)) * (spec.step || 0.1);
      out[key] = Math.round(out[key] * 100) / 100;
    }
  }
  return out;
}

export function score(evaluation, recentMetrics = null) {
  if (!evaluation?.full) return -1e9;
  const { full, oos } = evaluation;
  if (!full.trades || full.trades < 4) return -1e9;
  if (!oos || oos.trades < 2) return -1e9;
  const robust = oos.returnPct * 0.6 + full.returnPct * 0.4;
  let total = robust - full.maxDrawdownPct * 0.5 + Math.min(full.profitFactor, 3) * 3;
  // Continuous adaptation: reward candidates that perform well in the current live market regime window
  if (recentMetrics && recentMetrics.trades >= 2 && Number.isFinite(recentMetrics.returnPct)) {
    const clampedRecent = Math.max(-25, Math.min(35, recentMetrics.returnPct));
    total += clampedRecent * 0.22 - Math.min(30, recentMetrics.maxDrawdownPct || 0) * 0.15;
  }
  return total;
}

/**
 * Optimize a strategy on the given candles, blending current market-regime bias
 * and recent-window stability into the fitness function.
 */
export async function optimize({
  candles,
  strategyId,
  cfg,
  rounds = 34,
  climb = 14,
  seed = null,
  spaceOverride = null,
  regime = null,
  onProgress,
}) {
  const effectiveBias = mergeRegimeBias(spaceOverride, regime?.paramBias || null);
  const space = mergeSpace(strategyId, effectiveBias);
  const total = rounds + climb + (seed ? 1 : 0);
  let done = 0;
  let best = null;
  let bestScore = -1e9;

  const consider = async (params) => {
    const evaluation = evaluate(candles, strategyId, params, cfg);
    const recentMetrics = evaluation?.oos?.trades >= 2 ? evaluateRecentWindow(candles, strategyId, params, cfg) : null;
    const s = score(evaluation, recentMetrics);
    if (s > bestScore) {
      bestScore = s;
      best = { strategyId, params, evaluation, recentMetrics, score: s };
    }
    done++;
    if (onProgress) onProgress({ done, total, best });
    if (done % 5 === 0) await yieldTick();
  };

  if (seed) await consider(seed);
  for (let i = 0; i < rounds; i++) await consider(sampleParams(space));
  for (let i = 0; i < climb && best; i++) {
    await consider(mutateParams(space, best.params, 0.3 + Math.random() * 0.3));
  }

  return {
    best,
    trials: done,
    backtests: done * 4,
    viable: !!best && best.score > -1e8,
  };
}

export function objectiveSummary(best, settings) {
  if (!best) return { ok: false, reasons: ['לא נמצאה וריאציה יציבה'] };
  const reasons = [];
  const { full, oos } = best.evaluation;
  if (oos.returnPct <= 0) reasons.push('out-of-sample שלילי');
  if (full.profitFactor < settings.minProfitFactor) reasons.push('profit factor מתחת לסף');
  if (full.trades < settings.minTrades) reasons.push(`פחות מ־${settings.minTrades} עסקאות`);
  if (full.maxDrawdownPct > settings.maxDrawdown * 100) reasons.push('drawdown מעל המגבלה');
  return { ok: reasons.length === 0, reasons };
}
