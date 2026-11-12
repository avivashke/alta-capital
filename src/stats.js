// Statistical hardening: walk-forward folds, Monte Carlo bootstrap, parameter sensitivity,
// and a single 0-100 robustness score used by the promotion gates.

import { runBacktest, evaluate } from './backtest.js';
import { mutateParams } from './optimizer.js';
import { STRATEGIES } from './strategies.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function stdev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
}

/**
 * Anchored walk-forward: each fold retrains on history up to the fold start,
 * then trades the unseen slice. Returns per-fold results + consistency.
 */
export function walkForward({ candles, strategyId, params, cfg, folds = 4, retrainSamples = 4 }) {
  const n = candles.length;
  const warmup = Math.min(220, Math.floor(n * 0.2));
  const usable = n - warmup;
  const foldSize = Math.floor(usable / folds);
  if (!params || foldSize < 50) {
    return {
      folds: [], consistency: 0, positiveFolds: 0, totalFolds: 0,
      avgReturn: 0, worstReturn: 0, dispersion: 0,
      note: 'נתונים קצרים מדי ל-walk-forward (צריך יותר נרות)',
    };
  }
  const results = [];
  for (let f = 0; f < folds; f++) {
    const testStart = warmup + f * foldSize;
    const testEnd = f === folds - 1 ? n : testStart + foldSize;
    const train = candles.slice(0, testStart);
    const test = candles.slice(Math.max(0, testStart - warmup), testEnd);
    let bestParams = params;
    let bestScore = -Infinity;
    const candidates = [params];
    for (let i = 0; i < retrainSamples; i++) candidates.push(mutateParams(strategyId, params, 0.25));
    for (const candidate of candidates) {
      const ev = evaluate(train, strategyId, candidate, cfg);
      const sc = (ev.full?.returnPct ?? -1e9) + (ev.full?.profitFactor ?? 0) * 2 - (ev.full?.maxDrawdownPct ?? 0) * 0.4;
      if (sc > bestScore) {
        bestScore = sc;
        bestParams = candidate;
      }
    }
    const res = runBacktest(test, strategyId, bestParams, cfg);
    results.push({
      fold: f + 1,
      from: candles[testStart]?.t || null,
      to: candles[testEnd - 1]?.t || null,
      returnPct: res.metrics.returnPct,
      trades: res.metrics.trades,
      profitFactor: res.metrics.profitFactor,
      maxDrawdownPct: res.metrics.maxDrawdownPct,
    });
  }
  const returns = results.map((r) => r.returnPct);
  const positiveFolds = results.filter((r) => r.returnPct > 0).length;
  return {
    folds: results,
    consistency: +(positiveFolds / results.length).toFixed(2),
    positiveFolds,
    totalFolds: results.length,
    avgReturn: +(returns.reduce((a, b) => a + b, 0) / returns.length).toFixed(2),
    worstReturn: +Math.min(...returns).toFixed(2),
    dispersion: +stdev(returns).toFixed(2),
  };
}

/** Bootstrap the trade sequence to see how much of the result is luck. */
export function monteCarlo(trades, { iterations = 700, ruinDD = 35 } = {}) {
  if (!trades || trades.length < 5) {
    return { available: false, note: 'פחות מ־5 עסקאות — אין בסיס סטטיסטי ל-Monte Carlo' };
  }
  const pcts = trades.map((t) => t.pnlPct);
  const returns = [];
  const dds = [];
  for (let i = 0; i < iterations; i++) {
    let equity = 100;
    let peak = 100;
    let dd = 0;
    for (let k = 0; k < pcts.length; k++) {
      equity *= 1 + pcts[Math.floor(Math.random() * pcts.length)] / 100;
      if (equity > peak) peak = equity;
      const cur = ((peak - equity) / peak) * 100;
      if (cur > dd) dd = cur;
    }
    returns.push(equity - 100);
    dds.push(dd);
  }
  returns.sort((a, b) => a - b);
  dds.sort((a, b) => a - b);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  return {
    available: true,
    iterations,
    p05: +q(returns, 0.05).toFixed(2),
    p50: +q(returns, 0.5).toFixed(2),
    p95: +q(returns, 0.95).toFixed(2),
    ddP95: +q(dds, 0.95).toFixed(2),
    probProfit: +(returns.filter((r) => r > 0).length / returns.length).toFixed(2),
    ruinProb: +(dds.filter((d) => d > ruinDD).length / dds.length).toFixed(2),
    histogram: buildHistogram(returns, 18),
  };
}

function buildHistogram(values, bins) {
  if (!values.length) return [];
  const min = values[0];
  const max = values[values.length - 1];
  const width = (max - min) / bins || 1;
  const out = new Array(bins).fill(0);
  for (const v of values) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((v - min) / width)));
    out[idx]++;
  }
  return out.map((count, i) => ({ from: +(min + i * width).toFixed(2), to: +(min + (i + 1) * width).toFixed(2), count }));
}

/** Nudge every parameter by ±15% and measure how fragile the result is. */
export function parameterSensitivity({ candles, strategyId, params, cfg }) {
  const space = STRATEGIES[strategyId]?.space;
  if (!space || !params) return { available: false, sensitivity: 1, samples: [], note: 'אין פרמטרים לבדיקה' };
  const base = runBacktest(candles, strategyId, params, cfg);
  const samples = [];
  for (const [key, spec] of Object.entries(space)) {
    for (const factor of [0.85, 1.15]) {
      const p = { ...params };
      if (spec.type === 'int') {
        p[key] = Math.max(spec.min, Math.min(spec.max, Math.round((params[key] || spec.min) * factor)));
      } else if (spec.type === 'float') {
        p[key] = Math.max(spec.min, Math.min(spec.max, +((params[key] || spec.min) * factor).toFixed(2)));
      } else {
        p[key] = !params[key];
      }
      const res = runBacktest(candles, strategyId, p, cfg);
      samples.push({ key, factor, returnPct: res.metrics.returnPct, profitFactor: res.metrics.profitFactor, trades: res.metrics.trades });
    }
  }
  const returns = samples.map((s) => s.returnPct);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const sd = stdev(returns);
  return {
    available: true,
    baseReturn: base.metrics.returnPct,
    mean: +mean.toFixed(2),
    sd: +sd.toFixed(2),
    sensitivity: +clamp(sd / (Math.abs(base.metrics.returnPct) + 1), 0, 3).toFixed(2),
    brokenSamples: samples.filter((s) => s.trades < 3).length,
    samples,
  };
}

/** 0-100: how much of the edge survives folds, resampling and parameter noise. */
export function robustnessScore({ isMetrics, oosMetrics, walkForward: wf, monteCarlo: mc, sensitivity }) {
  const oosRatio = isMetrics && oosMetrics
    ? clamp(oosMetrics.returnPct / Math.max(Math.abs(isMetrics.returnPct), 1), -0.5, 1.2)
    : 0;
  const consistency = wf?.consistency ?? 0;
  const mcProb = mc?.available ? mc.probProfit : 0;
  const sens = 1 - clamp(sensitivity?.sensitivity ?? 1, 0, 1);
  const ddOk = oosMetrics ? clamp(1 - oosMetrics.maxDrawdownPct / 40, 0, 1) : 0;
  const raw = 100 * (
    0.28 * clamp(consistency, 0, 1) +
    0.26 * mcProb +
    0.18 * clamp(oosRatio, 0, 1) +
    0.16 * sens +
    0.12 * ddOk
  );
  return Math.round(clamp(raw, 0, 100));
}

export function assessStrategy({ candles, strategyId, params, cfg, isMetrics = null, oosMetrics = null, folds = 4, mcIterations = 700 }) {
  const wf = walkForward({ candles, strategyId, params, cfg, folds });
  const base = runBacktest(candles, strategyId, params, cfg);
  const mc = monteCarlo(base.trades, { iterations: mcIterations });
  const sens = parameterSensitivity({ candles, strategyId, params, cfg });
  const robustness = robustnessScore({ isMetrics, oosMetrics, walkForward: wf, monteCarlo: mc, sensitivity: sens });
  return {
    robustness,
    walkForward: wf,
    monteCarlo: mc,
    sensitivity: sens,
    trades: base.trades.length,
    assessedAt: Date.now(),
  };
}
