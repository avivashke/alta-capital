// Prop Firm / Nostro Challenge Simulator & Bot Fleet.
// Evaluates multiple strategy bots against strict Nostro rules:
//  - Phase 1 Profit Target (e.g. +8% / +10%)
//  - Phase 2 Profit Target (e.g. +5%)
//  - Max Daily Loss Limit (e.g. -5%)
//  - Max Overall Drawdown Limit (e.g. -10%)
//  - Minimum Trades & Consistency Check
//  - Simulated Funded Account (80% profit split)

import { BARS_PER_YEAR } from './config.js';
import { store } from './store.js';
import { getCandles } from './market.js';
import { runBacktest } from './backtest.js';
import { optimize } from './optimizer.js';
import { STRATEGIES, defaultsFor } from './strategies.js';
import { scheduleDatabasePush } from './db.js';

export const NOSTRO_BOT_TEMPLATES = [
  {
    id: 'nostro_ema_btc',
    name: 'Nostro Alpha · Trend Guard',
    strategyId: 'ema_trend',
    symbol: 'BTCUSDT',
    tf: '1h',
    riskPerTrade: 0.0075,
    note: 'מעקב מגמה עם סיכון מופחת (0.75% לעסקה) לשמירה על תקרת Drawdown של נוסטרו.',
  },
  {
    id: 'nostro_gann_nvda',
    name: 'Nostro Beta · Gann Sq9 Sniper',
    strategyId: 'gann_swing_sq9',
    symbol: 'NVDA',
    tf: '1h',
    riskPerTrade: 0.006,
    note: 'כניסות לפי רמות השורש הריבועי של גאן (Square of 9) עם יחס סיכוי/סיכון גבוה.',
  },
  {
    id: 'nostro_supertrend_eth',
    name: 'Nostro Gamma · Supertrend ADX',
    strategyId: 'supertrend_adx',
    symbol: 'ETHUSDT',
    tf: '15m',
    riskPerTrade: 0.007,
    note: 'סינון דשדוש אגרסיבי באמצעות ADX למניעת הפסדים יומיים רצופים.',
  },
  {
    id: 'nostro_vol_sol',
    name: 'Nostro Delta · Vol Breakout ER',
    strategyId: 'vol_breakout',
    symbol: 'SOLUSDT',
    tf: '1h',
    riskPerTrade: 0.0065,
    note: 'פריצות תנודתיות נקיות בלבד לפי Kauffman Efficiency Ratio.',
  },
  {
    id: 'nostro_zscore_spy',
    name: 'Nostro Epsilon · Z-Score Steady',
    strategyId: 'mean_reversion_z',
    symbol: 'SPY',
    tf: '1d',
    riskPerTrade: 0.0055,
    note: 'חזרה לממוצע סטטיסטית על מדד S&P 500 עם תנודתיות נמוכה ויציבות גבוהה.',
  },
];

export const DEFAULT_NOSTRO_RULES = {
  accountSize: 100000,
  phase1TargetPct: 8,
  phase2TargetPct: 5,
  maxDailyLossPct: 5,
  maxTotalDdPct: 10,
  minTrades: 8,
  profitSplitPct: 80,
};

function evaluateCurveAgainstNostro(curve, trades, rules) {
  const startCap = rules.accountSize;
  let peak = startCap;
  let maxTotalDdPct = 0;
  let maxDailyLossPct = 0;
  let breached = null;
  let phase1PassedAt = null;
  let phase2PassedAt = null;

  const p1Target = startCap * (1 + rules.phase1TargetPct / 100);
  const p2Target = startCap * (1 + (rules.phase1TargetPct + rules.phase2TargetPct) / 100);

  // Track rolling daily/session drops (~24h or step-to-step)
  const dayBuckets = new Map();
  for (let i = 0; i < curve.length; i++) {
    const pt = curve[i];
    const eq = pt.v;
    if (eq > peak) peak = eq;
    const ddFromPeak = ((peak - eq) / peak) * 100;
    const ddFromStart = ((startCap - eq) / startCap) * 100;
    const effectiveDd = Math.max(ddFromPeak, ddFromStart);
    if (effectiveDd > maxTotalDdPct) maxTotalDdPct = effectiveDd;

    const dayKey = new Date(pt.t || Date.now()).toISOString().slice(0, 10);
    if (!dayBuckets.has(dayKey)) dayBuckets.set(dayKey, { start: eq, min: eq });
    const b = dayBuckets.get(dayKey);
    if (eq < b.min) b.min = eq;
    const dailyDrop = ((b.start - b.min) / b.start) * 100;
    if (dailyDrop > maxDailyLossPct) maxDailyLossPct = dailyDrop;

    if (!breached) {
      if (dailyDrop >= rules.maxDailyLossPct) {
        breached = `חריגה מהפסד יומי מקסימלי (${dailyDrop.toFixed(2)}% ≥ ${rules.maxDailyLossPct}%)`;
      } else if (effectiveDd >= rules.maxTotalDdPct) {
        breached = `חריגה מ-Drawdown כולל (${effectiveDd.toFixed(2)}% ≥ ${rules.maxTotalDdPct}%)`;
      }
    }

    if (!breached) {
      if (!phase1PassedAt && eq >= p1Target) phase1PassedAt = pt.t || i;
      if (phase1PassedAt && !phase2PassedAt && eq >= p2Target) phase2PassedAt = pt.t || i;
    }
  }

  const finalEq = curve[curve.length - 1]?.v ?? startCap;
  const totalReturnPct = +(((finalEq - startCap) / startCap) * 100).toFixed(2);
  const enoughTrades = (trades?.length || 0) >= rules.minTrades;

  // Consistency: best single trade share of positive gross profit
  const posTrades = (trades || []).filter((t) => (t.pnl || 0) > 0);
  const sumPos = posTrades.reduce((s, t) => s + t.pnl, 0);
  const maxSingle = posTrades.reduce((m, t) => Math.max(m, t.pnl || 0), 0);
  const bestTradeSharePct = sumPos > 0 ? +((maxSingle / sumPos) * 100).toFixed(1) : 0;

  let status = 'in_progress';
  let statusLabel = '⏳ בתהליך מבחן';
  if (breached) {
    status = 'failed';
    statusLabel = '❌ נפסל (חריגת סיכון)';
  } else if (phase1PassedAt && phase2PassedAt && enoughTrades) {
    status = 'funded';
    statusLabel = '🏆 עבר שלב 1 + 2 (Funded!)';
  } else if (phase1PassedAt && enoughTrades) {
    status = 'phase2';
    statusLabel = '✅ עבר שלב 1 · בשלב 2';
  } else if (!enoughTrades) {
    status = 'in_progress';
    statusLabel = '⏳ מעט מדי עסקאות';
  }

  const fundedProfitUsd = status === 'funded'
    ? Math.max(0, Math.round((finalEq - p2Target) * (rules.profitSplitPct / 100)))
    : 0;

  return {
    status,
    statusLabel,
    breached,
    totalReturnPct,
    finalEquity: Math.round(finalEq),
    maxTotalDdPct: +maxTotalDdPct.toFixed(2),
    maxDailyLossPct: +maxDailyLossPct.toFixed(2),
    phase1Passed: !!phase1PassedAt && !breached,
    phase2Passed: !!phase2PassedAt && !breached,
    bestTradeSharePct,
    fundedProfitUsd,
  };
}

export async function runNostroBot(botTemplate, rules = DEFAULT_NOSTRO_RULES, { doOptimize = false } = {}) {
  const s = store.state.settings;
  const candles = await getCandles(botTemplate.symbol, botTemplate.tf, { limit: 700, force: false });
  const cfg = {
    capital: rules.accountSize,
    riskPerTrade: botTemplate.riskPerTrade,
    feeRate: s.feeRate ?? 0.0004,
    makerFee: s.makerFee ?? 0.00025,
    takerFee: s.takerFee ?? 0.0004,
    spread: s.spread ?? 0.001,
    impactFactor: s.impactFactor ?? 1.0,
    exchangeFee: s.exchangeFee ?? 0,
    minTrades: rules.minTrades,
    barsPerYear: BARS_PER_YEAR[botTemplate.tf] || 8760,
  };

  let params = botTemplate.params || defaultsFor(botTemplate.strategyId);
  if (doOptimize) {
    const opt = await optimize({
      candles,
      strategyId: botTemplate.strategyId,
      cfg,
      seed: params,
      rounds: 24,
      climb: 10,
    });
    if (opt?.best?.params) {
      params = opt.best.params;
    }
  }

  const bt = runBacktest(candles, botTemplate.strategyId, params, cfg);
  const evalRes = evaluateCurveAgainstNostro(bt.curve || [], bt.trades || [], rules);

  return {
    ...botTemplate,
    params,
    metrics: bt.metrics,
    curve: (bt.curve || []).filter((_, idx, arr) => idx % Math.max(1, Math.floor(arr.length / 80)) === 0).map((p) => p.v),
    ...evalRes,
    testedAt: Date.now(),
  };
}

export async function runNostroFleetSimulation(customRules = {}, { doOptimize = false } = {}) {
  const rules = { ...DEFAULT_NOSTRO_RULES, ...(store.state.nostro?.rules || {}), ...customRules };
  const existingBots = store.state.nostro?.bots || [];
  const results = [];

  for (const tpl of NOSTRO_BOT_TEMPLATES) {
    const prev = existingBots.find((b) => b.id === tpl.id);
    const botInput = prev?.params ? { ...tpl, params: prev.params } : tpl;
    try {
      const res = await runNostroBot(botInput, rules, { doOptimize });
      results.push(res);
    } catch (err) {
      results.push({
        ...tpl,
        status: 'failed',
        statusLabel: '⚠️ שגיאה בטעינה',
        breached: err.message,
        totalReturnPct: 0,
        maxTotalDdPct: 0,
        maxDailyLossPct: 0,
        fundedProfitUsd: 0,
        metrics: null,
        curve: [],
      });
    }
  }

  store.state.nostro = {
    rules,
    bots: results,
    updatedAt: Date.now(),
  };
  const fundedCount = results.filter((r) => r.status === 'funded').length;
  store.log('ok', 'מערך נוסטרו', `הושלם מבחן דמה ל-${results.length} בוטים · ${fundedCount} עברו לשלב Funded`);
  store.save();
  store.emit();
  scheduleDatabasePush();
  return store.state.nostro;
}
