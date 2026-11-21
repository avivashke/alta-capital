// Cross-market validation: run one desk's winning strategy + parameters over a
// universe of symbols and rank them, so the team can see which stock (or coin)
// the strategy actually works best on instead of trusting a single symbol.

import { getCandles } from './market.js';
import { runBacktest } from './backtest.js';

const DAY = 86_400_000;

function compositeScore(m) {
  // Risk-adjusted ranking: return matters most, but a fragile PF or a deep
  // drawdown should not win just because one trade was huge.
  return m.returnPct * 0.6
    + Math.min(m.profitFactor, 3) * 8
    + Math.min(m.trades, 40) * 0.15
    - m.maxDrawdownPct * 0.5;
}

function yearsBetween(from, to) {
  if (!from || !to || to <= from) return 0;
  return +((to - from) / (365.25 * DAY)).toFixed(2);
}

/**
 * @returns {{ rows: Array, best: object|null, worst: object|null, scanned: number, ok: number, years: number }}
 */
export async function scanUniverse({
  symbols = [],
  tf,
  strategyId,
  params,
  cfg,
  limit,
  minTrades = 6,
  concurrency = 3,
  onProgress,
}) {
  const rows = [];
  const queue = [...new Set(symbols)];
  const total = queue.length;

  const worker = async () => {
    while (queue.length) {
      const symbol = queue.shift();
      try {
        const candles = await getCandles(symbol, tf, { limit });
        if (!candles || candles.length < 120) {
          rows.push({ symbol, error: `נתונים קצרים (${candles?.length || 0} נרות)` });
        } else {
          const res = runBacktest(candles, strategyId, params, cfg);
          const m = res.metrics;
          if (!m || m.trades < minTrades) {
            rows.push({ symbol, error: `מעט עסקאות (${m?.trades || 0})`, trades: m?.trades || 0 });
          } else {
            const from = candles[0]?.t || null;
            const to = candles[candles.length - 1]?.t || null;
            rows.push({
              symbol,
              returnPct: m.returnPct,
              profitFactor: m.profitFactor,
              maxDrawdownPct: m.maxDrawdownPct,
              winRate: m.winRate,
              sharpe: m.sharpe,
              trades: m.trades,
              exposurePct: m.exposurePct,
              bars: candles.length,
              years: yearsBetween(from, to),
              from,
              to,
              provider: candles.__provider || null,
              synthetic: !!candles.__synthetic,
              score: +compositeScore(m).toFixed(2),
            });
          }
        }
      } catch (err) {
        rows.push({ symbol, error: err.message });
      }
      if (onProgress) onProgress({ done: rows.length, total });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, total)) }, worker),
  );

  const ranked = rows
    .filter((r) => !r.error)
    .sort((a, b) => b.score - a.score);
  const failed = rows.filter((r) => r.error).sort((a, b) => a.symbol.localeCompare(b.symbol));

  return {
    rows: [...ranked, ...failed],
    best: ranked[0] || null,
    worst: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    scanned: total,
    ok: ranked.length,
    years: ranked.length ? Math.max(...ranked.map((r) => r.years || 0)) : 0,
  };
}
