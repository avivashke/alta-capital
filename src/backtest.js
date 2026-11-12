// Event-driven bar backtester with ATR stops, fees, risk-based sizing and walk-forward split.

import { atr } from './indicators.js';
import { STRATEGIES } from './strategies.js';

const DEFAULT_CFG = {
  capital: 25000,
  riskPerTrade: 0.015,
  feeRate: 0.0004,
  makerFee: 0.00025,
  takerFee: 0.0004,
  spread: 0.001,
  impactFactor: 1.0,
  exchangeFee: 0,
  minTrades: 10,
  barsPerYear: 8760,
};

function closingSideFee(price, units, fee) {
  return price * units * fee;
}

function impactCost(units, avgDailyVolume, dailyVolatility, impactFactor) {
  if (avgDailyVolume <= 0 || dailyVolatility <= 0) return 0;
  const orderRatio = Math.abs(units) / avgDailyVolume;
  return impactFactor * dailyVolatility * Math.sqrt(Math.max(0, orderRatio / 20));
}

function tradeFee(isTaker, price, units, cfg) {
  const baseFee = isTaker ? cfg.takerFee : cfg.makerFee;
  const spreadCost = price * cfg.spread * Math.abs(units);
  const impact = impactCost(
    units,
    1000000,
    0.02,
    cfg.impactFactor
  );
  const exchange = cfg.exchangeFee * price * Math.abs(units);
  return baseFee * price * Math.abs(units) + spreadCost + impact + exchange;
}

export function runBacktest(candles, strategyId, params, cfg = {}) {
  const conf = { ...DEFAULT_CFG, ...cfg };
  const strat = STRATEGIES[strategyId];
  if (!strat || !candles || candles.length < 80) {
    return { metrics: emptyMetrics(), curve: [], trades: [] };
  }
  const desired = strat.positions(candles, params);
  const atrArr = atr(candles, 14);
  const warmup = Math.min(Math.max(strat.warmup || 60, 30), Math.floor(candles.length * 0.4));
  const stopMult = Number(params.atrStop) > 0 ? Number(params.atrStop) : 2;

  let cash = conf.capital;
  let pos = null;
  let barsInMarket = 0;
  const trades = [];
  const curve = [];
  let totalFees = 0;

  const closePosition = (i, price, reason, isTaker) => {
    const gross = pos.dir * (price - pos.entry) * pos.units;
    const fee = tradeFee(isTaker, price, pos.units, conf);
    const fees = closingSideFee(pos.entry, pos.units, conf.feeRate) + closingSideFee(price, pos.units, conf.feeRate);
    const pnl = gross - fee;
    totalFees += fee;
    cash += pnl;
    const riskAmount = pos.risk;
    trades.push({
      dir: pos.dir,
      entryIdx: pos.entryIdx,
      exitIdx: i,
      entry: +pos.entry.toFixed(6),
      exit: +price.toFixed(6),
      bars: i - pos.entryIdx,
      pnl: +pnl.toFixed(4),
      pnlPct: +((pnl / conf.capital) * 100).toFixed(3),
      rMultiple: riskAmount > 0 ? +(pnl / riskAmount).toFixed(3) : 0,
      reason,
      at: candles[i]?.t || null,
      fee: +fee.toFixed(4),
    });
    pos = null;
  };

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    let closedThisBar = false;

    if (pos) {
      barsInMarket++;
      const hitStop = pos.dir > 0 ? c.l <= pos.stop : c.h >= pos.stop;
      const hitTarget = pos.dir > 0 ? c.h >= pos.target : c.l <= pos.target;
      if (hitStop) {
        closePosition(i, pos.stop, 'stop', true);
        closedThisBar = true;
      } else if (hitTarget) {
        closePosition(i, pos.target, 'target', true);
        closedThisBar = true;
      } else if (desired[i] !== pos.dir && desired[i] !== 0) {
        closePosition(i, c.c, 'flip', true);
        closedThisBar = true;
      } else if (desired[i] === 0 && i > pos.entryIdx + 1) {
        closePosition(i, c.c, 'signal', true);
        closedThisBar = true;
      }
    }

    if (!pos && !closedThisBar && i >= warmup && desired[i] !== 0) {
      const a = atrArr[i];
      if (a && Number.isFinite(a) && a > 0) {
        const stopDist = stopMult * a;
        const riskAmount = conf.riskPerTrade * cash;
        const byRisk = riskAmount / stopDist;
        const byCash = (cash * 0.99) / c.c;
        const units = Math.min(byRisk, byCash);
        if (units > 0 && Number.isFinite(units)) {
          const dir = desired[i];
          pos = {
            dir,
            units,
            entry: c.c,
            stop: dir > 0 ? c.c - stopDist : c.c + stopDist,
            target: dir > 0 ? c.c + stopDist * Number(params.rr || 2) : c.c - stopDist * Number(params.rr || 2),
            entryIdx: i,
            risk: riskAmount,
          };
        }
      }
    }

    const mtm = cash + (pos ? pos.dir * (c.c - pos.entry) * pos.units : 0);
    curve.push({ t: c.t, v: +mtm.toFixed(2) });
  }

  if (pos) closePosition(candles.length - 1, candles[candles.length - 1].c, 'eod', true);

  const metrics = summarize(trades, curve, conf, totalFees);
  metrics.barsInMarket = barsInMarket;
  metrics.exposurePct = +(100 * barsInMarket / candles.length).toFixed(1);
  metrics.totalFees = +totalFees.toFixed(4);
  return { metrics, curve, trades };
}

function emptyMetrics() {
  return {
    returnPct: 0, maxDrawdownPct: 0, sharpe: 0, profitFactor: 0, winRate: 0,
    trades: 0, avgR: 0, expectancy: 0, exposurePct: 0, barsInMarket: 0,
    bestTradePct: 0, worstTradePct: 0, finalEquity: DEFAULT_CFG.capital, curvePoints: 0,
    totalFees: 0,
  };
}

function summarize(trades, curve, conf, totalFees = 0) {
  const capital = conf.capital;
  const finalEquity = curve.length ? curve[curve.length - 1].v : capital;
  const returnPct = ((finalEquity / capital) - 1) * 100;

  let peak = capital;
  let maxDD = 0;
  const barReturns = [];
  let prev = capital;
  for (const p of curve) {
    if (p.v > peak) peak = p.v;
    const dd = peak > 0 ? ((peak - p.v) / peak) * 100 : 0;
    if (dd > maxDD) maxDD = dd;
    barReturns.push(prev > 0 ? p.v / prev - 1 : 0);
    prev = p.v;
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss === 0 ? (grossWin > 0 ? 99 : 0) : grossWin / grossLoss;

  const mean = barReturns.length ? barReturns.reduce((a, b) => a + b, 0) / barReturns.length : 0;
  const variance = barReturns.length
    ? barReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / barReturns.length
    : 0;
  const sd = Math.sqrt(variance);
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(conf.barsPerYear || 8760) : 0;

  const avgR = trades.length ? trades.reduce((s, t) => s + t.rMultiple, 0) / trades.length : 0;
  const expectancy = trades.length ? trades.reduce((s, t) => s + t.pnl, 0) / trades.length : 0;

  return {
    returnPct: +returnPct.toFixed(2),
    maxDrawdownPct: +maxDD.toFixed(2),
    sharpe: +sharpe.toFixed(2),
    profitFactor: +Math.min(profitFactor, 99).toFixed(2),
    winRate: +(trades.length ? (wins.length / trades.length) * 100 : 0).toFixed(1),
    trades: trades.length,
    avgR: +avgR.toFixed(3),
    expectancy: +expectancy.toFixed(2),
    exposurePct: 0,
    bestTradePct: trades.length ? Math.max(...trades.map((t) => t.pnlPct)) : 0,
    worstTradePct: trades.length ? Math.min(...trades.map((t) => t.pnlPct)) : 0,
    finalEquity: +finalEquity.toFixed(2),
    curvePoints: curve.length,
    totalFees: +totalFees.toFixed(4),
  };
}

// Walk-forward: first 70% in-sample, last 30% out-of-sample (with a small warmup overlap).
export function evaluate(candles, strategyId, params, cfg = {}) {
  const n = candles.length;
  const split = Math.floor(n * 0.7);
  const overlap = Math.min(180, Math.floor(split * 0.25));
  const isCandles = candles.slice(0, split);
  const oosCandles = candles.slice(split - overlap);
  const is = runBacktest(isCandles, strategyId, params, cfg);
  const oos = runBacktest(oosCandles, strategyId, params, cfg);
  const full = runBacktest(candles, strategyId, params, cfg);
  return {
    is: is.metrics,
    oos: oos.metrics,
    full: full.metrics,
    curve: full.curve,
    trades: full.trades,
    oosTrades: oos.trades,
    splitIndex: split,
    splitTime: candles[split - 1]?.t || null,
  };
}

export function passesGates(metrics, settings) {
  if (!metrics) return { ok: false, reasons: ['אין תוצאות'] };
  const reasons = [];
  if (metrics.returnPct <= 0) reasons.push('תשואה לא חיובית');
  if (metrics.trades < settings.minTrades) reasons.push(`מעט מדי עסקאות (${metrics.trades}/${settings.minTrades})`);
  if (metrics.profitFactor < settings.minProfitFactor) reasons.push(`profit factor נמוך (${metrics.profitFactor})`);
  if (metrics.maxDrawdownPct > settings.maxDrawdown * 100) reasons.push(`drawdown חורג (${metrics.maxDrawdownPct}%)`);
  return { ok: reasons.length === 0, reasons };
}
