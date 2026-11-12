// Parameter search: seeded random sampling + local hill climbing, chunked so the UI stays responsive.

import { STRATEGIES } from './strategies.js';
import { evaluate } from './backtest.js';

const yieldTick = () => new Promise((resolve) => setTimeout(resolve, 0));

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function resolveSpace(strategyIdOrSpace) {
  return typeof strategyIdOrSpace === 'string' ? STRATEGIES[strategyIdOrSpace].space : strategyIdOrSpace;
}

/** Narrow the search space with an AI-proposed range, clamped to the real parameter bounds. */
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

export function score(evaluation) {
  if (!evaluation?.full) return -1e9;
  const { full, oos } = evaluation;
  if (!full.trades || full.trades < 4) return -1e9;
  if (!oos || oos.trades < 2) return -1e9;
  const robust = oos.returnPct * 0.6 + full.returnPct * 0.4;
  return robust - full.maxDrawdownPct * 0.5 + Math.min(full.profitFactor, 3) * 3;
}

/**
 * Optimize a strategy on the given candles.
 * Seeding with the current parameters guarantees the next cycle is never worse than the last.
 */
export async function optimize({ candles, strategyId, cfg, rounds = 34, climb = 14, seed = null, spaceOverride = null, onProgress }) {
  const space = mergeSpace(strategyId, spaceOverride);
  const total = rounds + climb + (seed ? 1 : 0);
  let done = 0;
  let best = null;
  let bestScore = -1e9;

  const consider = async (params) => {
    const evaluation = evaluate(candles, strategyId, params, cfg);
    const s = score(evaluation);
    if (s > bestScore) {
      bestScore = s;
      best = { params, evaluation, score: s };
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
    backtests: done * 3,
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
