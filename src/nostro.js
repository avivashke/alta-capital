// Prop Firm / Nostro Challenge Autonomous Engine & Proof Reporter.
// Evaluates multiple strategy bots on LIVE real-time market data against real Prop Firm rules:
//  - FTMO, The5ers, FundedNext, Topstep, Apex Trader Funding
//  - Tracks exact pass dates, drawdown compliance, live data provider, and trade-level proof
//  - Supports autonomous auto-refresh + multi-sheet Excel (.xls) report export

import { BACKTEST_HISTORY, BARS_PER_YEAR } from './config.js';
import { store } from './store.js';
import { getCandles, marketState } from './market.js';
import { runBacktest } from './backtest.js';
import { optimize } from './optimizer.js';
import { atr } from './indicators.js';
import { STRATEGIES, defaultsFor } from './strategies.js';
import { scheduleDatabasePush } from './db.js';
import { createPaperPortfolio } from './paper_portfolio.js';

export const PROP_FIRM_PROFILES = [
  {
    id: 'ftmo',
    name: 'FTMO',
    program: '2-Step Standard Challenge',
    phase1TargetPct: 10,
    phase2TargetPct: 5,
    maxDailyLossPct: 5,
    maxTotalDdPct: 10,
    minTrades: 8,
    minTradingDays: 4,
    trailingDd: false,
    payoutCycleDays: 14,
    profitSplitPct: 80,
    focus: 'קריפטו, מדדים, מט"ח, סחורות',
    sourceUrl: 'https://ftmo.com/en/objectives/',
    sourceNote: 'חוקי FTMO הרשמיים: יעד שלב 1 (10%), שלב 2 (5%), הפסד יומי מקס׳ 5% (Equity/Balance), הפסד כולל 10%, מינימום 4 ימי מסחר, חלוקת רווחים 80%–90%.',
  },
  {
    id: 'the5ers',
    name: 'The5ers',
    program: 'High Stakes 2-Step',
    phase1TargetPct: 8,
    phase2TargetPct: 5,
    maxDailyLossPct: 5,
    maxTotalDdPct: 10,
    minTrades: 6,
    minTradingDays: 3,
    trailingDd: false,
    payoutCycleDays: 14,
    profitSplitPct: 80,
    focus: 'מט"ח, זהב, מדדים וקריפטו',
    sourceUrl: 'https://the5ers.com/high-stakes/',
    sourceNote: 'חוקי The5ers High Stakes: יעד שלב 1 (8%), שלב 2 (5%), הפסד יומי 5%, Stop-Out כולל 10%, מינימום 3 ימים רווחיים.',
  },
  {
    id: 'fundednext',
    name: 'FundedNext',
    program: 'Stellar 2-Step Challenge',
    phase1TargetPct: 8,
    phase2TargetPct: 5,
    maxDailyLossPct: 5,
    maxTotalDdPct: 10,
    minTrades: 8,
    minTradingDays: 5,
    trailingDd: false,
    payoutCycleDays: 14,
    profitSplitPct: 80,
    focus: 'רב-נכסי (קריפטו, מדדים, מניות, מט"ח)',
    sourceUrl: 'https://fundednext.com/stellar-challenge',
    sourceNote: 'חוקי FundedNext Stellar: יעד שלב 1 (8%), שלב 2 (5%), הפסד יומי 5%, הפסד כולל 10%, מינימום 5 ימי מסחר, חלוקת רווחים 80%.',
  },
  {
    id: 'topstep',
    name: 'Topstep',
    program: 'Trading Combine (1-Step)',
    phase1TargetPct: 6,
    phase2TargetPct: 0,
    maxDailyLossPct: 2.5,
    maxTotalDdPct: 4,
    minTrades: 6,
    minTradingDays: 2,
    trailingDd: true,
    payoutCycleDays: 10,
    profitSplitPct: 90,
    focus: 'חוזים עתידיים, מדדים (SPY/QQQ) וסחורות (זהב)',
    sourceUrl: 'https://www.topstep.com/trading-combine/',
    sourceNote: 'חוקי Topstep Combine: שלב אחד (6% יעד רווח), מגבלת הפסד מקסימלית 4% (Trailing), משמעת יומית 2.5%, מינימום 2 ימי מסחר, חלוקת רווחים 90%.',
  },
  {
    id: 'apex',
    name: 'Apex Trader Funding',
    program: '1-Step Evaluation',
    phase1TargetPct: 6,
    phase2TargetPct: 0,
    maxDailyLossPct: 3,
    maxTotalDdPct: 4,
    minTrades: 6,
    minTradingDays: 1,
    trailingDd: true,
    payoutCycleDays: 14,
    profitSplitPct: 90,
    focus: 'מדדים וסחורות (S&P 500, Nasdaq, Gold)',
    sourceUrl: 'https://apextraderfunding.com/',
    sourceNote: 'חוקי Apex 1-Step: יעד רווח 6%, סף נגרר (Trailing Threshold) של 4%, חלוקת רווחים 90%–100%.',
  },
];

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
  // Real challenge books require a minimum number of trading days, not only trades.
  minTradingDays: 4,
  profitSplitPct: 80,
};

function fmtDate(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toISOString().slice(0, 10); } catch { return '—'; }
}

export function evaluateCurveAgainstNostro(curve, trades, rules) {
  const startCap = Number(rules.accountSize) || 100000;
  const minTradingDays = Math.max(0, Number(rules.minTradingDays) || 0);
  const dailyLimitPct = Number(rules.maxDailyLossPct) || 0;
  const totalLimitPct = Number(rules.maxTotalDdPct) || 0;
  const trailing = !!rules.trailingDd;
  let peak = startCap;
  let maxTotalDdPct = 0;
  let maxDailyLossPct = 0;
  let worstDailyLossDate = null;
  let breached = null;
  let phase1PassedAt = null;
  let phase2PassedAt = null;
  let tradingDays = 0;

  const p1Target = startCap * (1 + (Number(rules.phase1TargetPct) || 0) / 100);
  // FTMO / The5ers / FundedNext reset the balance after phase 1, so "+5% for phase 2"
  // on one continuous curve means another phase2TargetPct on top of phase 1.
  const p2Target = startCap * (1 + ((Number(rules.phase1TargetPct) || 0) + (Number(rules.phase2TargetPct) || 0)) / 100);

  let dayKey = null;
  let dayStart = startCap;

  for (let i = 0; i < curve.length; i++) {
    const pt = curve[i];
    const eq = Number(pt.v);
    if (!Number.isFinite(eq)) continue;
    const key = new Date(pt.t || Date.now()).toISOString().slice(0, 10);
    if (key !== dayKey) {
      dayKey = key;
      dayStart = eq;
      tradingDays += 1;
    }
    if (eq > peak) peak = eq;

    // Real rule books differ: FTMO/The5ers/FundedNext measure max loss from the initial
    // balance, Topstep/Apex trail it from the high-water mark. Applying trailing to a
    // static firm invented breaches that the firm would never issue.
    const ddAnchor = trailing ? peak : startCap;
    const effectiveDd = ddAnchor > 0 ? Math.max(0, ((ddAnchor - eq) / ddAnchor) * 100) : 0;
    if (effectiveDd > maxTotalDdPct) maxTotalDdPct = effectiveDd;

    const dailyDrop = dayStart > 0 ? Math.max(0, ((dayStart - eq) / dayStart) * 100) : 0;
    if (dailyDrop > maxDailyLossPct) {
      maxDailyLossPct = dailyDrop;
      worstDailyLossDate = key;
    }

    if (!breached) {
      if (dailyLimitPct > 0 && dailyDrop >= dailyLimitPct) {
        breached = `חריגה מהפסד יומי מקסימלי (${dailyDrop.toFixed(2)}% ≥ ${dailyLimitPct}%) בתאריך ${key}`;
      } else if (totalLimitPct > 0 && effectiveDd >= totalLimitPct) {
        breached = `חריגה מ-Drawdown כולל (${effectiveDd.toFixed(2)}% ≥ ${totalLimitPct}%)`;
      }
    }

    // A phase is only passed once the challenge's minimum trading days are behind us,
    // even if the profit target was reached on day one.
    if (!breached && tradingDays >= minTradingDays) {
      if (!phase1PassedAt && eq >= p1Target) phase1PassedAt = pt.t || i;
      if (phase1PassedAt && !phase2PassedAt) {
        if ((Number(rules.phase2TargetPct) || 0) <= 0 || eq >= p2Target) phase2PassedAt = pt.t || i;
      }
    }
  }

  const finalEq = curve[curve.length - 1]?.v ?? startCap;
  const totalReturnPct = +(((finalEq - startCap) / startCap) * 100).toFixed(2);
  const enoughTrades = (trades?.length || 0) >= rules.minTrades;

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
  } else if (minTradingDays > 0 && tradingDays < minTradingDays) {
    status = 'in_progress';
    statusLabel = `⏳ ממתין לימי מסחר (${tradingDays}/${minTradingDays})`;
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
    peakEquity: Math.round(peak),
    maxTotalDdPct: +maxTotalDdPct.toFixed(2),
    maxDailyLossPct: +maxDailyLossPct.toFixed(2),
    worstDailyLossDate,
    tradingDays,
    minTradingDays,
    trailingDd: trailing,
    phase1Passed: !!phase1PassedAt && !breached,
    phase2Passed: !!phase2PassedAt && !breached,
    phase1PassedDate: typeof phase1PassedAt === 'number' ? fmtDate(phase1PassedAt) : null,
    phase2PassedDate: typeof phase2PassedAt === 'number' ? fmtDate(phase2PassedAt) : null,
    bestTradeSharePct,
    fundedProfitUsd,
  };
}

export function buildNostroBotsFromExistingDesks(desks = store.state.desks || []) {
  return (desks || []).map((d) => {
    const latestHist = d.history?.[0];
    const strategyId = latestHist?.strategyId || d.strategyId || 'ema_trend';
    const rawParams = latestHist?.params || d.params || defaultsFor(strategyId);
    const clonedParams = JSON.parse(JSON.stringify(rawParams));
    const safeRisk = d.kind === 'swing' ? 0.0045 : 0.0055;
    return {
      id: `nostro_clone_${d.id}`,
      sourceDeskId: d.id,
      sourceDeskLabel: d.label || d.short || d.id,
      name: `Nostro Pro · ${d.short || d.symbol} (${d.symbol})`,
      strategyId,
      symbol: d.symbol || 'BTCUSDT',
      tf: d.tf || '1h',
      riskPerTrade: safeRisk,
      params: clonedParams,
      note: `בוט נוסטרו ייעודי ומופרד שנבנה מ-${d.label || d.id} ועבר הקשחת סיכון לנוסטרו (${(safeRisk * 100).toFixed(2)}% לעסקה).`,
    };
  });
}

function scoreNostroCandidate(evalRes, btMetrics, rules) {
  if (evalRes.breached) return -1000 - (evalRes.maxTotalDdPct || 0);
  let score = evalRes.totalReturnPct || 0;
  if (evalRes.phase1Passed) score += 200;
  if (evalRes.phase2Passed) score += 400;
  const pf = Number(btMetrics?.profitFactor || 0);
  score += Math.min(30, pf * 10);
  // Reward staying comfortably below Daily (5%) and Total (10%) limits
  score += Math.max(0, (rules.maxDailyLossPct - evalRes.maxDailyLossPct) * 6);
  score += Math.max(0, (rules.maxTotalDdPct - evalRes.maxTotalDdPct) * 3);
  return score;
}

export async function runNostroBot(botTemplate, rules = DEFAULT_NOSTRO_RULES, { doOptimize = false, forceLive = true, maxBars = 0 } = {}) {
  const s = store.state.settings;
  // Deep history, not one month: a 700-bar sample let a bot look fundable on a lucky
  // week. This matches the firm-wide backtest depth and the Yahoo/Binance limits.
  const targetBars = BACKTEST_HISTORY[botTemplate.tf] || 700;
  const candles = await getCandles(botTemplate.symbol, botTemplate.tf, {
    limit: maxBars > 0 ? Math.min(targetBars, maxBars) : targetBars,
    force: forceLive,
  });
  const dataProvider = marketState.provider || 'Live';
  const isSynthetic = !!marketState.synthetic;

  const baseCfg = {
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
  let chosenRisk = botTemplate.riskPerTrade;

  if (doOptimize) {
    const opt = await optimize({
      candles,
      strategyId: botTemplate.strategyId,
      cfg: baseCfg,
      seed: params,
      rounds: 24,
      climb: 10,
    });
    const candidateParams = opt?.best?.params ? [params, opt.best.params] : [params];
    const riskTiers = [0.004, 0.0055, 0.007, botTemplate.riskPerTrade];
    let bestScore = -Infinity;

    for (const candP of candidateParams) {
      for (const rTier of riskTiers) {
        const trialBt = runBacktest(candles, botTemplate.strategyId, candP, { ...baseCfg, riskPerTrade: rTier });
        const trialEval = evaluateCurveAgainstNostro(trialBt.curve || [], trialBt.trades || [], rules);
        const sc = scoreNostroCandidate(trialEval, trialBt.metrics, rules);
        if (sc > bestScore) {
          bestScore = sc;
          params = candP;
          chosenRisk = rTier;
        }
      }
    }
  }

  const cfg = { ...baseCfg, riskPerTrade: chosenRisk };
  const bt = runBacktest(candles, botTemplate.strategyId, params, cfg);
  const evalRes = evaluateCurveAgainstNostro(bt.curve || [], bt.trades || [], rules);

  // Evaluate against every real Prop Firm profile so we know EXACTLY which company this bot can pass
  const firmEvaluations = PROP_FIRM_PROFILES.map((firm) => {
    const firmRules = {
      accountSize: rules.accountSize,
      phase1TargetPct: firm.phase1TargetPct,
      phase2TargetPct: firm.phase2TargetPct,
      maxDailyLossPct: firm.maxDailyLossPct,
      maxTotalDdPct: firm.maxTotalDdPct,
      minTrades: firm.minTrades,
      minTradingDays: firm.minTradingDays || 0,
      trailingDd: !!firm.trailingDd,
      profitSplitPct: firm.profitSplitPct,
    };
    const fEval = evaluateCurveAgainstNostro(bt.curve || [], bt.trades || [], firmRules);
    return {
      firmId: firm.id,
      firmName: firm.name,
      program: firm.program,
      passed: fEval.status === 'funded',
      phase1Passed: fEval.phase1Passed,
      status: fEval.status,
      breached: fEval.breached,
      fundedProfitUsd: fEval.fundedProfitUsd,
      phase1PassedDate: fEval.phase1PassedDate,
      phase2PassedDate: fEval.phase2PassedDate,
      sourceUrl: firm.sourceUrl,
    };
  });

  const readyFirms = firmEvaluations.filter((f) => f.passed).map((f) => f.firmName);
  const trades = bt.trades || [];
  const tradeProofSample = trades.slice(-15).map((tr) => ({
    side: tr.side || 'long',
    entryDate: fmtDate(tr.entryTime || tr.t),
    exitDate: fmtDate(tr.exitTime || tr.t),
    entryPrice: +(tr.entryPrice || 0).toFixed(4),
    exitPrice: +(tr.exitPrice || 0).toFixed(4),
    pnlUsd: +(tr.pnl || 0).toFixed(2),
    retPct: +(tr.retPct || 0).toFixed(2),
  }));

  return {
    ...botTemplate,
    riskPerTrade: chosenRisk,
    params,
    metrics: bt.metrics,
    dataProvider,
    isSynthetic,
    lastPrice: candles[candles.length - 1]?.c ?? null,
    dataFromDate: fmtDate(candles[0]?.t),
    dataToDate: fmtDate(candles[candles.length - 1]?.t),
    candlesCount: candles.length,
    curve: (bt.curve || []).filter((_, idx, arr) => idx % Math.max(1, Math.floor(arr.length / 80)) === 0).map((p) => p.v),
    firmEvaluations,
    readyFirms,
    tradeProofSample,
    ...evalRes,
    testedAt: Date.now(),
  };
}

export async function runNostroFleetSimulation(customRules = {}, { doOptimize = false, forceLive = true, maxBars = 0 } = {}) {
  const rules = { ...DEFAULT_NOSTRO_RULES, ...(store.state.nostro?.rules || {}), ...customRules };
  const existingBots = store.state.nostro?.bots || [];
  const deskClones = buildNostroBotsFromExistingDesks(store.state.desks || []);
  const allTemplates = [...NOSTRO_BOT_TEMPLATES, ...deskClones];
  const results = [];

  for (const tpl of allTemplates) {
    const prev = existingBots.find((b) => b.id === tpl.id);
    const botInput = prev?.params ? { ...tpl, params: prev.params, riskPerTrade: prev.riskPerTrade ?? tpl.riskPerTrade } : tpl;
    try {
      const res = await runNostroBot(botInput, rules, { doOptimize, forceLive, maxBars });
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
        readyFirms: [],
        firmEvaluations: [],
        tradeProofSample: [],
        metrics: null,
        curve: [],
      });
    }
  }

  const prevRoom = store.state.nostro?.tradingRoom || { accounts: [], lastTickAt: null, autoEnroll: true };
  store.state.nostro = {
    rules,
    bots: results,
    autoMode: store.state.nostro?.autoMode ?? true,
    tradingRoom: prevRoom,
    updatedAt: Date.now(),
  };

  const readyBots = results.filter((r) => (r.readyFirms || []).length > 0);
  if (readyBots.length) {
    const summaryText = readyBots.map((b) => `${b.name} -> ${b.readyFirms.join('/')}`).join(' · ');
    store.log('ok', 'מערך נוסטרו אוטומטי', `נמצאו ${readyBots.length} בוטים מוכנים למעבר נוסטרו על נתוני אמת: ${summaryText}`);
    if (prevRoom.autoEnroll !== false) {
      const enrolled = autoEnrollPassedNostroBots(store.state);
      if (enrolled.added > 0) {
        store.log('ok', 'חדר מסחר נוסטרו', `הועברו אוטומטית ${enrolled.added} בוטים שעברו מבחנים לחדר המסחר הדמה על נתוני אמת!`);
      }
    }
  } else {
    store.log('info', 'מערך נוסטרו אוטומטי', `הושלמה בדיקת ${results.length} בוטים בזמן אמת`);
  }

  store.save();
  store.emit();
  scheduleDatabasePush();
  return store.state.nostro;
}

// --- Strict Nostro Prop-Firm Compliance Audit & Withdrawal Engine ----------

export function verifyNostroBotComplianceAndPayout(bot, rules = DEFAULT_NOSTRO_RULES) {
  if (!bot) return null;
  const accountSize = Number(rules?.accountSize) || 100000;
  const isLive = !bot.isSynthetic && !!bot.dataProvider;
  const tradesCount = Number(bot.metrics?.trades ?? bot.trades?.length ?? 0);
  const tradingDays = Number(bot.tradingDays || 0);
  const minDays = Number(rules?.minTradingDays || 4);
  const minTrades = Number(rules?.minTrades || 8);
  const maxDailyLoss = Number(bot.maxDailyLossPct || 0);
  const maxDailyLimit = Number(rules?.maxDailyLossPct || 5);
  const maxTotalDd = Number(bot.maxTotalDdPct || 0);
  const maxTotalLimit = Number(rules?.maxTotalDdPct || 10);
  const returnPct = Number(bot.totalReturnPct || 0);
  const hasFirmPass = (bot.readyFirms || []).length > 0;
  const hasOneStepPass = (bot.firmEvaluations || []).some((fe) => fe.passed);
  const p1Passed = !!bot.phase1Passed;
  const p2Passed = !!bot.phase2Passed || (Number(rules?.phase2TargetPct) <= 0) || hasOneStepPass;
  const bestTradeShare = Number(bot.bestTradeSharePct || 0);
  const consistencyOk = bestTradeShare <= 45;

  const passedDaily = maxDailyLoss < maxDailyLimit;
  const passedTotalDd = maxTotalDd < maxTotalLimit;
  const passedDays = tradingDays >= minDays;
  const passedTrades = tradesCount >= minTrades;
  const passedTargets = (p1Passed && p2Passed) || hasFirmPass;
  const isFunded = (bot.status === 'funded' || passedTargets) && !bot.breached && hasFirmPass;

  const profitSplitPct = Number(rules?.profitSplitPct) || 80;
  const grossProfitUsd = bot.finalEquity ? Math.max(0, bot.finalEquity - accountSize) : Math.max(0, Math.round(accountSize * (returnPct / 100)));
  const withdrawableUsd = isFunded && grossProfitUsd > 0
    ? Math.round(grossProfitUsd * (profitSplitPct / 100))
    : (bot.fundedProfitUsd || 0);

  const canWithdraw = isFunded && isLive && passedDaily && passedTotalDd && consistencyOk && withdrawableUsd > 0;

  const checklist = [
    {
      id: 'live_data',
      label: 'נתוני שוק אמת (Real Exchange Data)',
      passed: isLive,
      detail: isLive ? `מאומת: ${bot.dataProvider} (${bot.candlesCount || 0} נרות אמת)` : 'נתוני הדגמה בלבד',
    },
    {
      id: 'profit_target',
      label: 'עמידה ביעדי רווח שלב 1 ושלב 2',
      passed: passedTargets,
      detail: passedTargets ? `שלב 1 (${bot.phase1PassedDate || 'עבר'}) + שלב 2 (${bot.phase2PassedDate || 'עבר'}) · סה"כ ${returnPct}%` : `טרם הושלמו יעדי הרווח (+${rules.phase1TargetPct}% / +${rules.phase2TargetPct || 0}%)`,
    },
    {
      id: 'daily_loss',
      label: `מגבלת הפסד יומי מקסימלי (<${maxDailyLimit}%)`,
      passed: passedDaily,
      detail: passedDaily ? `הפסד יומי מרבי: ${maxDailyLoss}% (מרווח ביטחון: ${(maxDailyLimit - maxDailyLoss).toFixed(2)}%)` : `חריגה יומית: ${maxDailyLoss}%`,
    },
    {
      id: 'total_dd',
      label: `מגבלת Drawdown כולל (<${maxTotalLimit}%)`,
      passed: passedTotalDd,
      detail: passedTotalDd ? `Drawdown שיא: ${maxTotalDd}% (מרווח ביטחון: ${(maxTotalLimit - maxTotalDd).toFixed(2)}%)` : `חריגת Drawdown: ${maxTotalDd}%`,
    },
    {
      id: 'trading_days',
      label: `מינימום ימי מסחר (${minDays} ימים)`,
      passed: passedDays,
      detail: `${tradingDays} ימי מסחר בפועל (נדרש לפחות ${minDays})`,
    },
    {
      id: 'consistency',
      label: 'חוק העקביות (Consistency <= 45%)',
      passed: consistencyOk,
      detail: `עסקה בודדת מקס׳: ${bestTradeShare}% מסך הרווח (תקרת חוק עקביות: 45%)`,
    },
    {
      id: 'trades_count',
      label: `מדגם עסקאות מינימלי (${minTrades} עסקאות)`,
      passed: passedTrades,
      detail: `${tradesCount} עסקאות שבוצעו במבחן`,
    },
    {
      id: 'withdrawal',
      label: 'זכאות למשיכת רווחי נוסטרו (Funded Payout)',
      passed: canWithdraw,
      detail: canWithdraw
        ? `זכאי למשיכה: $${withdrawableUsd.toLocaleString('en-US')} (${profitSplitPct}% חלוקת רווחים) כל ${rules.payoutCycleDays || 14} יום`
        : 'טרם צבר רווח זכאי למשיכה בסטטוס Funded',
    },
  ];

  const allRulesPassed = checklist.every((c) => c.passed);

  return {
    fullyCompliant: allRulesPassed,
    canWithdraw,
    withdrawableUsd,
    grossProfitUsd,
    profitSplitPct,
    payoutCycleDays: rules?.payoutCycleDays || 14,
    readyFirms: bot.readyFirms || [],
    firmCount: (bot.readyFirms || []).length,
    checklist,
  };
}

export function executeNostroPayoutWithdrawal(botId, state = store.state) {
  const nostro = state.nostro;
  if (!nostro?.bots) return { ok: false, error: 'אין בוטים זמינים' };
  const bot = nostro.bots.find((b) => b.id === botId);
  if (!bot) return { ok: false, error: 'הבוט לא נמצא' };
  const rules = { ...DEFAULT_NOSTRO_RULES, ...(nostro.rules || {}) };
  const audit = verifyNostroBotComplianceAndPayout(bot, rules);
  if (!audit?.canWithdraw) {
    return { ok: false, error: 'הבוט אינו עומד בכל תנאי המשיכה כרגע' };
  }
  const payoutId = `PAYOUT_${Date.now()}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const record = {
    id: payoutId,
    at: Date.now(),
    date: new Date().toISOString().slice(0, 10),
    botId: bot.id,
    botName: bot.name,
    symbol: bot.symbol,
    accountSize: rules.accountSize,
    grossProfitUsd: audit.grossProfitUsd,
    profitSplitPct: audit.profitSplitPct,
    withdrawableUsd: audit.withdrawableUsd,
    readyFirms: audit.readyFirms,
    status: 'approved_cleared',
    statusLabel: 'אושר ונמשך בהצלחה (Cleared & Paid)',
  };
  nostro.payoutHistory = nostro.payoutHistory || [];
  nostro.payoutHistory.unshift(record);
  if (nostro.payoutHistory.length > 50) nostro.payoutHistory = nostro.payoutHistory.slice(0, 50);

  // Transfer into Vault / Side Fund (קופה צדדית / כספת רווחים מובטחת מחוץ לסיכוני השוק)
  state.vault = state.vault || { balance: 0, totalWithdrawn: 0, lastWithdrawalAt: null, withdrawals: [] };
  const prevVaultBalance = Number(state.vault.balance) || 0;
  const newVaultBalance = Math.round((prevVaultBalance + audit.withdrawableUsd) * 100) / 100;
  const newTotalWithdrawn = Math.round(((Number(state.vault.totalWithdrawn) || 0) + audit.withdrawableUsd) * 100) / 100;

  state.vault.balance = newVaultBalance;
  state.vault.totalWithdrawn = newTotalWithdrawn;
  state.vault.lastWithdrawalAt = Date.now();
  state.vault.withdrawals = state.vault.withdrawals || [];
  state.vault.withdrawals.unshift({
    id: payoutId,
    at: Date.now(),
    date: new Date().toISOString().slice(0, 10),
    amount: audit.withdrawableUsd,
    source: 'nostro_payout',
    botId: bot.id,
    botName: bot.name,
    readyFirms: audit.readyFirms,
    vaultBalanceAfter: newVaultBalance,
    note: 'הועבר לקופה צדדית מאושרת — רווח ממומש ומובטח מחוץ לסיכון השוק',
  });
  if (state.vault.withdrawals.length > 100) state.vault.withdrawals = state.vault.withdrawals.slice(0, 100);

  // Update bot metrics
  bot.lastPayoutAt = Date.now();
  bot.totalWithdrawnToVault = Math.round(((Number(bot.totalWithdrawnToVault) || 0) + audit.withdrawableUsd) * 100) / 100;

  // Also reflect the payout in the paper portfolio deposit log
  try {
    const pf = createPaperPortfolio(store.state.settings || {});
    if (store.state.paperPortfolio && typeof store.state.paperPortfolio === 'object') {
      pf.fromJSON(store.state.paperPortfolio);
    }
    const dep = pf.deposit(
      audit.withdrawableUsd,
      `משיכת נוסטרו מהבוט ${bot.name} (${bot.symbol}) · חלוקת רווח ${audit.profitSplitPct}% · הועבר לקופה צדדית`,
      'nostro_payout'
    );
    store.state.paperPortfolio = pf.toJSON();
  } catch (err) {
    console.warn('[nostro] Failed to reflect payout in paper portfolio:', err.message);
  }

  store.log('ok', 'כספת · קופה צדדית',
    `💸 בוצעה משיכה של $${audit.withdrawableUsd.toLocaleString('en-US')} עבור ${bot.name} — הכסף הועבר בהצלחה לקופה צדדית מובטחת (יתרת קופה צדדית: $${newVaultBalance.toLocaleString('en-US')})`);
  store.save(true);
  store.emit();
  scheduleDatabasePush(1000);
  return { ok: true, payout: record, vault: state.vault };
}

// --- Live Nostro Prop-Firm Paper Trading Room (Real Market Data) -----------

const DAY_MS = 86_400_000;

function utcDayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

export function ensureNostroTradingRoom(state = store.state) {
  if (!state.nostro) {
    state.nostro = { rules: { ...DEFAULT_NOSTRO_RULES }, bots: [], autoMode: true, updatedAt: null };
  }
  if (!state.nostro.tradingRoom || typeof state.nostro.tradingRoom !== 'object') {
    state.nostro.tradingRoom = { accounts: [], lastTickAt: null, autoEnroll: true };
  }
  if (!Array.isArray(state.nostro.tradingRoom.accounts)) {
    state.nostro.tradingRoom.accounts = [];
  }
  return state.nostro.tradingRoom;
}

function getFirmProfile(firmIdOrName) {
  if (!firmIdOrName) return PROP_FIRM_PROFILES[0];
  const q = String(firmIdOrName).toLowerCase();
  return PROP_FIRM_PROFILES.find((f) => f.id === q || f.name.toLowerCase() === q) || PROP_FIRM_PROFILES[0];
}

function pushAcctEvent(acct, kind, text) {
  acct.events = acct.events || [];
  acct.events.unshift({ at: Date.now(), kind, text });
  if (acct.events.length > 50) acct.events.length = 50;
}

/**
 * Enroll a passed Nostro bot into its own realistic Prop-Firm Live Paper Account.
 */
export function enrollBotInNostroRoom(bot, { firmId = null, accountSize = null, startPhase = 'phase1', state = store.state } = {}) {
  if (!bot || !bot.strategyId) return null;
  const room = ensureNostroTradingRoom(state);
  const firm = getFirmProfile(firmId || bot.readyFirms?.[0] || 'ftmo');
  const existing = room.accounts.find((a) => a.botId === bot.id && (firmId ? a.firmId === firm.id : true));
  if (existing) {
    // Sync latest optimized params onto active account if not blown
    if (existing.phase !== 'blown' && bot.params) {
      existing.params = JSON.parse(JSON.stringify(bot.params));
      existing.riskPerTrade = bot.riskPerTrade || existing.riskPerTrade;
    }
    return { account: existing, added: false };
  }

  const cap = Number(accountSize || state.nostro?.rules?.accountSize || DEFAULT_NOSTRO_RULES.accountSize || 100000);
  const now = Date.now();
  const today = utcDayKey(now);

  const account = {
    id: `nacc_${bot.id}_${firm.id}`,
    botId: bot.id,
    botName: bot.name,
    symbol: bot.symbol,
    tf: bot.tf || '1h',
    strategyId: bot.strategyId,
    params: JSON.parse(JSON.stringify(bot.params || defaultsFor(bot.strategyId))),
    riskPerTrade: Math.min(0.01, Math.max(0.0025, Number(bot.riskPerTrade) || 0.0055)),
    firmId: firm.id,
    firmName: firm.name,
    program: firm.program,
    rules: {
      phase1TargetPct: firm.phase1TargetPct,
      phase2TargetPct: firm.phase2TargetPct,
      maxDailyLossPct: firm.maxDailyLossPct,
      maxTotalDdPct: firm.maxTotalDdPct,
      minTradingDays: firm.minTradingDays || 3,
      trailingDd: !!firm.trailingDd,
      payoutCycleDays: firm.payoutCycleDays || 14,
      profitSplitPct: firm.profitSplitPct || 80,
    },
    phase: startPhase, // 'phase1' | 'phase2' | 'funded' | 'blown'
    startedAt: now,
    phaseStartedAt: now,
    fundedAt: startPhase === 'funded' ? now : null,
    initialBalance: cap,
    balance: cap,
    equity: cap,
    highWaterMark: cap,
    dayKey: today,
    dayStartEquity: cap,
    dailyRealizedByDay: {},
    tradingDays: [],
    phaseTradingDays: [],
    openTrade: null,
    trades: [],
    equityHistory: [{ t: now, v: cap }],
    totalFees: 0,
    breached: false,
    breachReason: null,
    breachedAt: null,
    dailyLockedKey: null,
    lastPrice: bot.lastPrice || null,
    dataProvider: bot.dataProvider || 'Live',
    lastTickAt: null,
    lastBarTime: null,
    events: [
      { at: now, kind: 'ok', text: `נכנס לחדר מסחר נוסטרו (${firm.name} · ${firm.program}) עם תיק $${cap.toLocaleString('en-US')}` },
    ],
  };

  room.accounts.push(account);
  return { account, added: true };
}

export function autoEnrollPassedNostroBots(state = store.state) {
  const bots = state.nostro?.bots || [];
  let added = 0;
  for (const bot of bots) {
    if ((bot.readyFirms || []).length > 0 && !bot.isSynthetic) {
      const res = enrollBotInNostroRoom(bot, { state });
      if (res?.added) added++;
    }
  }
  return { added, total: ensureNostroTradingRoom(state).accounts.length };
}

/**
 * Compute full real-time Prop Firm health, burn proximity, elapsed days,
 * consistency rule, phase progress, and payout eligibility for an account.
 */
export function computeNostroAccountHealth(acct, now = Date.now()) {
  const init = Number(acct.initialBalance) || 100000;
  const eq = Number.isFinite(Number(acct.equity)) ? Number(acct.equity) : init;
  const bal = Number.isFinite(Number(acct.balance)) ? Number(acct.balance) : init;
  const hwm = Math.max(init, Number(acct.highWaterMark) || init, eq);
  const dayStart = Number(acct.dayStartEquity) || bal || init;
  const rules = acct.rules || {
    phase1TargetPct: 8, phase2TargetPct: 5, maxDailyLossPct: 5, maxTotalDdPct: 10,
    minTradingDays: 4, trailingDd: false, payoutCycleDays: 14, profitSplitPct: 80,
  };

  // Daily drawdown (UTC day, equity vs start-of-day equity)
  const dailyPnlUsd = +(eq - dayStart).toFixed(2);
  const dailyPnlPct = dayStart > 0 ? +(((eq - dayStart) / dayStart) * 100).toFixed(2) : 0;
  const dailyLossLimitUsd = +(dayStart * (rules.maxDailyLossPct / 100)).toFixed(2);
  const dailyLossFloor = +(dayStart - dailyLossLimitUsd).toFixed(2);
  const dailyLossCurrentUsd = Math.max(0, dayStart - eq);
  const dailyLossUsedPct = dailyLossLimitUsd > 0 ? +Math.min(100, (dailyLossCurrentUsd / dailyLossLimitUsd) * 100).toFixed(1) : 0;
  const dailyLossBufferUsd = +Math.max(0, eq - dailyLossFloor).toFixed(2);
  const dailyLossBufferPct = dayStart > 0 ? +Math.max(0, ((eq - dailyLossFloor) / dayStart) * 100).toFixed(2) : 0;

  // Total drawdown (trailing from HWM for Topstep/Apex, or static from initialBalance for FTMO/The5ers/FundedNext)
  const ddAnchor = rules.trailingDd ? hwm : init;
  const totalDdLimitUsd = +(init * (rules.maxTotalDdPct / 100)).toFixed(2);
  const totalDdFloor = +(ddAnchor - totalDdLimitUsd).toFixed(2);
  const totalDdCurrentUsd = Math.max(0, ddAnchor - eq);
  const totalDdCurrentPct = init > 0 ? +((totalDdCurrentUsd / init) * 100).toFixed(2) : 0;
  const totalDdUsedPct = totalDdLimitUsd > 0 ? +Math.min(100, (totalDdCurrentUsd / totalDdLimitUsd) * 100).toFixed(1) : 0;
  const totalDdBufferUsd = +Math.max(0, eq - totalDdFloor).toFixed(2);
  const totalDdBufferPct = init > 0 ? +Math.max(0, ((eq - totalDdFloor) / init) * 100).toFixed(2) : 0;

  const totalPnlUsd = +(eq - init).toFixed(2);
  const totalReturnPct = init > 0 ? +(((eq - init) / init) * 100).toFixed(2) : 0;

  // Burn proximity risk (0..100%)
  const burnRiskPct = acct.breached || acct.phase === 'blown'
    ? 100
    : +Math.max(dailyLossUsedPct, totalDdUsedPct).toFixed(1);

  let healthLevel = 'safe'; // 'safe' | 'warning' | 'critical' | 'burned'
  let healthLabel = '🟢 בטוח ויציב';
  let burnAlert = `מרווח ביטחון רחב: $${totalDdBufferUsd.toLocaleString('en-US')} עד שריפה כוללת · $${dailyLossBufferUsd.toLocaleString('en-US')} עד מגבלה יומית`;

  if (acct.breached || acct.phase === 'blown' || burnRiskPct >= 100) {
    healthLevel = 'burned';
    healthLabel = '🔥 התיק נשרף (Breached)';
    burnAlert = acct.breachReason || 'התיק חצה את מגבלת ההפסד של חברת הנוסטרו ונעצר.';
  } else if (burnRiskPct >= 75) {
    healthLevel = 'critical';
    healthLabel = `🚨 סכנת שריפה מיידית (${burnRiskPct}%)`;
    burnAlert = `אזהרה חמורה! נותרו רק $${Math.min(dailyLossBufferUsd, totalDdBufferUsd).toLocaleString('en-US')} לפני שריפת התיק — סיכון מוקטן אוטומטית.`;
  } else if (burnRiskPct >= 45) {
    healthLevel = 'warning';
    healthLabel = `⚠️ מתקרב למגבלת הפסד (${burnRiskPct}%)`;
    burnAlert = `שימוש של ${burnRiskPct}% ממגבלת ההפסד · נותרו $${dailyLossBufferUsd.toLocaleString('en-US')} ליום ו-$${totalDdBufferUsd.toLocaleString('en-US')} כולל.`;
  }

  // Days elapsed & trading days
  const startedAt = acct.startedAt || now;
  const daysElapsed = Math.max(1, Math.floor((now - startedAt) / DAY_MS) + 1);
  const phaseDaysElapsed = Math.max(1, Math.floor((now - (acct.phaseStartedAt || startedAt)) / DAY_MS) + 1);
  const tradingDaysCount = Array.isArray(acct.phaseTradingDays)
    ? acct.phaseTradingDays.length
    : (Array.isArray(acct.tradingDays) ? acct.tradingDays.length : 0);
  const totalTradingDaysCount = Array.isArray(acct.tradingDays) ? acct.tradingDays.length : tradingDaysCount;
  const minTradingDays = Number(rules.minTradingDays || 3);

  // Daily consistency rule (best single day share of total positive realized days)
  const dayVals = Object.values(acct.dailyRealizedByDay || {}).map(Number).filter(Number.isFinite);
  const profitableDaysCount = dayVals.filter((v) => v > 0).length;
  const sumPosDays = dayVals.filter((v) => v > 0).reduce((s, v) => s + v, 0);
  const bestDayUsd = dayVals.reduce((m, v) => Math.max(m, v), 0);
  const consistencyPct = sumPosDays > 0 ? +((bestDayUsd / sumPosDays) * 100).toFixed(1) : 0;

  // Phase target & payout calculation
  const targetPct = acct.phase === 'phase1'
    ? rules.phase1TargetPct
    : acct.phase === 'phase2'
      ? (rules.phase2TargetPct || 5)
      : 0;
  const targetUsd = +(init * (targetPct / 100)).toFixed(2);
  const targetProgressPct = targetUsd > 0 ? +Math.max(0, Math.min(100, (totalPnlUsd / targetUsd) * 100)).toFixed(1) : 100;
  const remainingToTargetUsd = targetUsd > 0 ? +Math.max(0, targetUsd - totalPnlUsd).toFixed(2) : 0;

  const estimatedPayoutUsd = acct.phase === 'funded' && totalPnlUsd > 0
    ? +(totalPnlUsd * ((rules.profitSplitPct || 80) / 100)).toFixed(2)
    : 0;
  const fundedDays = acct.fundedAt ? Math.floor((now - acct.fundedAt) / DAY_MS) : 0;
  const nextPayoutInDays = acct.phase === 'funded'
    ? Math.max(0, (rules.payoutCycleDays || 14) - (fundedDays % (rules.payoutCycleDays || 14)))
    : null;

  const phaseLabel = acct.phase === 'blown'
    ? '🔥 תיק שרוף (Breached)'
    : acct.phase === 'funded'
      ? '🏆 Funded (חשבון ממומן)'
      : acct.phase === 'phase2'
        ? `🥈 שלב 2 (יעד +${rules.phase2TargetPct}%)`
        : `🥇 שלב 1 (יעד +${rules.phase1TargetPct}%)`;

  const trades = acct.trades || [];
  const wins = trades.filter((t) => (t.pnlUsd || 0) > 0).length;
  const winRate = trades.length ? +((wins / trades.length) * 100).toFixed(1) : 0;

  return {
    phaseLabel,
    healthLevel,
    healthLabel,
    burnRiskPct,
    burnAlert,
    totalPnlUsd,
    totalReturnPct,
    dailyPnlUsd,
    dailyPnlPct,
    dailyLossLimitUsd,
    dailyLossFloor,
    dailyLossUsedPct,
    dailyLossBufferUsd,
    dailyLossBufferPct,
    totalDdLimitUsd,
    totalDdFloor,
    totalDdCurrentUsd: +totalDdCurrentUsd.toFixed(2),
    totalDdCurrentPct,
    totalDdUsedPct,
    totalDdBufferUsd,
    totalDdBufferPct,
    daysElapsed,
    phaseDaysElapsed,
    tradingDaysCount,
    totalTradingDaysCount,
    minTradingDays,
    profitableDaysCount,
    consistencyPct,
    consistencyOk: consistencyPct <= 45 || sumPosDays <= 0,
    targetPct,
    targetUsd,
    targetProgressPct,
    remainingToTargetUsd,
    estimatedPayoutUsd,
    nextPayoutInDays,
    winRate,
    closedTradesCount: trades.length,
    dailyLocked: acct.dailyLockedKey === utcDayKey(now),
  };
}

/**
 * Price at which the account hits whichever loss limit binds first (daily or total),
 * so breach liquidation stops exactly at the firm's floor instead of overshooting it.
 */
export function liquidationPriceFor(acct, health, fallbackPrice) {
  const t = acct?.openTrade;
  if (!t || !t.units || !t.dir) return fallbackPrice;
  const balance = Number(acct.balance) || 0;
  const floor = Math.max(Number(health?.dailyLossFloor) || -Infinity, Number(health?.totalDdFloor) || -Infinity);
  if (!Number.isFinite(floor)) return fallbackPrice;
  const px = t.entry + (floor - balance) / (t.dir * t.units);
  if (!Number.isFinite(px) || px <= 0) return fallbackPrice;
  // Never book a fill better than the market has already traded through.
  if (t.dir > 0 ? px > fallbackPrice : px < fallbackPrice) return fallbackPrice;
  return +px.toFixed(8);
}

function closeAccountPositionInternal(acct, price, reason, feeRate = 0.0005, now = Date.now()) {
  const t = acct.openTrade;
  if (!t) return null;
  const grossUsd = t.dir * (price - t.entry) * t.units;
  const exitFee = Math.abs(price * t.units) * feeRate;
  const netUsd = grossUsd - exitFee - (t.entryFee || 0);
  const pnlPct = acct.initialBalance > 0 ? (netUsd / acct.initialBalance) * 100 : 0;
  const rMult = t.riskUsd > 0 ? netUsd / t.riskUsd : 0;

  acct.balance = +(acct.balance + grossUsd - exitFee).toFixed(2);
  acct.totalFees = +((acct.totalFees || 0) + exitFee).toFixed(2);
  const day = utcDayKey(now);
  acct.dailyRealizedByDay = acct.dailyRealizedByDay || {};
  acct.dailyRealizedByDay[day] = +((acct.dailyRealizedByDay[day] || 0) + netUsd).toFixed(2);
  acct.tradingDays = acct.tradingDays || [];
  if (!acct.tradingDays.includes(day)) acct.tradingDays.push(day);
  acct.phaseTradingDays = acct.phaseTradingDays || [];
  if (!acct.phaseTradingDays.includes(day)) acct.phaseTradingDays.push(day);

  const tradeRecord = {
    id: `ntr_${now}_${Math.random().toString(36).slice(2, 6)}`,
    at: now,
    day,
    dir: t.dir,
    side: t.dir > 0 ? 'LONG' : 'SHORT',
    entry: +t.entry.toFixed(5),
    exit: +price.toFixed(5),
    units: +t.units.toFixed(6),
    pnlUsd: +netUsd.toFixed(2),
    pnlPct: +pnlPct.toFixed(3),
    rMultiple: +rMult.toFixed(2),
    feeUsd: +((t.entryFee || 0) + exitFee).toFixed(2),
    reason,
    phase: acct.phase,
  };
  acct.trades = acct.trades || [];
  acct.trades.push(tradeRecord);
  if (acct.trades.length > 250) acct.trades = acct.trades.slice(-250);
  acct.openTrade = null;
  acct.equity = acct.balance;
  pushAcctEvent(acct, netUsd >= 0 ? 'ok' : 'warn', `סגירת ${tradeRecord.side} @ ${price.toFixed(2)} (${reason}): ${netUsd >= 0 ? '+' : ''}$${netUsd.toFixed(2)}`);
  return tradeRecord;
}

/**
 * Execute one real-market-data tick across all active accounts in the Nostro Paper Trading Room.
 * Strictly skips synthetic candles so accounts only trade on real exchange/Yahoo prices.
 */
export async function tickNostroTradingRoom({ force = false, state = store.state } = {}) {
  const room = ensureNostroTradingRoom(state);
  if (!room.accounts.length) return { ok: true, updated: 0, accounts: 0 };

  const s = state.settings || {};
  const feeRate = Math.max(0.0003, Number(s.takerFee ?? s.feeRate ?? 0.0004)) + (Number(s.spread ?? 0.001) * 0.5);
  const now = Date.now();
  const today = utcDayKey(now);
  let updated = 0;
  let tradesMoved = 0;

  for (const acct of room.accounts) {
    if (acct.phase === 'blown' || acct.breached) continue;
    try {
      const candles = await getCandles(acct.symbol, acct.tf, { limit: 320, force });
      if (!candles?.length || candles.__synthetic) continue;

      const price = candles[candles.length - 1].c;
      if (!Number.isFinite(price) || price <= 0) continue;
      acct.lastPrice = price;
      acct.dataProvider = candles.__provider || marketState.provider || acct.dataProvider || 'Live';
      acct.lastTickAt = now;

      // UTC midnight rollover: reset daily loss anchor just like real FTMO / The5ers / FundedNext
      if (acct.dayKey !== today) {
        acct.dayKey = today;
        acct.dayStartEquity = acct.equity || acct.balance || acct.initialBalance;
        acct.dailyLockedKey = null;
      }

      const strat = STRATEGIES[acct.strategyId];
      if (!strat) continue;
      const desired = strat.positions(candles, acct.params || defaultsFor(acct.strategyId));
      const lastBar = candles[candles.length - 1];
      // A bar-driven bot may only change direction on a closed bar. Acting on every
      // 4s tick against the forming candle produced intrabar churn that no real
      // prop account could execute.
      const newBar = acct.lastBarTime !== lastBar.t;
      acct.lastBarTime = lastBar.t;
      const signalIdx = newBar ? Math.max(0, desired.length - 2) : desired.length - 1;
      const dir = desired[signalIdx] || 0;
      const atrSeries = atr(candles, 14).filter((v) => v != null);
      const barAtr = atrSeries[atrSeries.length - 1] || price * 0.01;
      const stopMult = Number(acct.params?.atrStop) || 2;
      const rr = Math.max(1.2, Number(acct.params?.rr) || 2);

      // Stops and targets are watched live against the range the market actually
      // traded this bar, not only its last print. A bar that pierced the stop and
      // closed back was previously left open, which flattered every account.
      const openedInThisBar = acct.openTrade && Number(acct.openTrade.openedAt) >= Number(lastBar.t);
      const rangeHigh = openedInThisBar ? price : Math.max(price, Number(lastBar.h) || price);
      const rangeLow = openedInThisBar ? price : Math.min(price, Number(lastBar.l) || price);

      // 1. Mark-to-market open position & check Stop / Trail / Target / Signal Exit
      if (acct.openTrade) {
        const t = acct.openTrade;
        t.markPrice = price;
        t.unrealizedUsd = +(t.dir * (price - t.entry) * t.units).toFixed(2);
        t.unrealizedPct = acct.initialBalance > 0 ? +((t.unrealizedUsd / acct.initialBalance) * 100).toFixed(3) : 0;

        const hitStop = t.dir > 0 ? rangeLow <= t.stop : rangeHigh >= t.stop;
        const hitTarget = t.dir > 0 ? rangeHigh >= t.target : rangeLow <= t.target;
        if (hitStop) {
          closeAccountPositionInternal(acct, t.stop, t.trailed ? 'trail' : 'stop', feeRate, now);
          tradesMoved++;
        } else if (hitTarget) {
          closeAccountPositionInternal(acct, t.target, 'target', feeRate, now);
          tradesMoved++;
        } else if (newBar && dir !== t.dir && dir !== 0) {
          closeAccountPositionInternal(acct, price, 'flip', feeRate, now);
          tradesMoved++;
        } else if (newBar && dir === 0) {
          closeAccountPositionInternal(acct, price, 'signal', feeRate, now);
          tradesMoved++;
        } else if (newBar) {
          // Breakeven at +1R, ATR trailing stop at +1.5R
          const initDist = t.stopDist || Math.abs(t.entry - t.stop) || barAtr * stopMult;
          if (t.dir > 0) {
            t.peak = Math.max(t.peak || t.entry, price);
            const gain = t.peak - t.entry;
            if (gain >= initDist * 1.5 && barAtr > 0) {
              const tr = t.peak - Math.max(barAtr * 1.3, initDist * 0.75);
              if (tr > t.stop) { t.stop = tr; t.trailed = true; }
            } else if (gain >= initDist * 1.0) {
              const be = t.entry + initDist * 0.1;
              if (be > t.stop) { t.stop = be; t.trailed = true; }
            }
          } else {
            t.peak = Math.min(t.peak || t.entry, price);
            const gain = t.entry - t.peak;
            if (gain >= initDist * 1.5 && barAtr > 0) {
              const tr = t.peak + Math.max(barAtr * 1.3, initDist * 0.75);
              if (tr < t.stop) { t.stop = tr; t.trailed = true; }
            } else if (gain >= initDist * 1.0) {
              const be = t.entry - initDist * 0.1;
              if (be < t.stop) { t.stop = be; t.trailed = true; }
            }
          }
        }
      }

      // 2. Recompute live Equity & High-Water-Mark
      const openUnrealized = acct.openTrade ? (acct.openTrade.dir * (price - acct.openTrade.entry) * acct.openTrade.units) : 0;
      acct.equity = +(acct.balance + openUnrealized).toFixed(2);
      if (acct.equity > (acct.highWaterMark || acct.initialBalance)) {
        acct.highWaterMark = acct.equity;
      }

      // 3. Enforce Strict Prop Firm Breach Rules (Daily Loss + Total Max Drawdown)
      const health = computeNostroAccountHealth(acct, now);
      if (health.dailyLossUsedPct >= 100 || health.totalDdUsedPct >= 100) {
        if (acct.openTrade) {
          // Fill at the firm's loss limit, not at whatever print arrived after it: a
          // real broker liquidates on the threshold, it does not let the account run
          // past its maximum loss.
          closeAccountPositionInternal(acct, liquidationPriceFor(acct, health, price), 'breach_liquidation', feeRate, now);
          tradesMoved++;
        }
        acct.breached = true;
        acct.phase = 'blown';
        acct.breachedAt = now;
        acct.breachReason = health.dailyLossUsedPct >= 100
          ? `נשרף: חריגה ממגבלת הפסד יומי (${acct.rules.maxDailyLossPct}%) של ${acct.firmName}`
          : `נשרף: חריגה ממגבלת Drawdown כולל (${acct.rules.maxTotalDdPct}%) של ${acct.firmName}`;
        pushAcctEvent(acct, 'bad', `🔥 ${acct.breachReason}`);
        store.log('warn', `נוסטרו · ${acct.firmName}`, `${acct.botName}: ${acct.breachReason}`);
        updated++;
        continue;
      }

      // 4. Daily Loss Circuit Breaker: stop new trades when >= 80% of daily limit used
      if (health.dailyLossUsedPct >= 80 && acct.dailyLockedKey !== today) {
        acct.dailyLockedKey = today;
        pushAcctEvent(acct, 'warn', `🛡️ הגנת שריפה יומית הופעלה (${health.dailyLossUsedPct}% מהמגבלה) — עצירת פתיחת עסקאות עד חצות UTC`);
      }

      // 5. Open new position on real market price if flat & within prop firm risk limits
      if (newBar && !acct.openTrade && dir !== 0 && acct.dailyLockedKey !== today) {
        const stopDist = stopMult * barAtr;
        // Dynamically halve risk when burnRiskPct >= 60% to protect the prop firm account!
        const riskFactor = health.burnRiskPct >= 60 ? 0.5 : 1.0;
        const riskUsd = acct.equity * (acct.riskPerTrade || 0.0055) * riskFactor;
        const maxNotional = acct.equity * 0.5; // realistic prop-firm margin discipline
        const unitsByRisk = stopDist > 0 ? riskUsd / stopDist : 0;
        const unitsByMargin = price > 0 ? maxNotional / price : 0;
        const units = Math.min(unitsByRisk, unitsByMargin);

        if (units > 0 && Number.isFinite(units)) {
          const entryFee = Math.abs(price * units) * feeRate;
          acct.balance = +(acct.balance - entryFee).toFixed(2);
          acct.totalFees = +((acct.totalFees || 0) + entryFee).toFixed(2);
          acct.tradingDays = acct.tradingDays || [];
          if (!acct.tradingDays.includes(today)) acct.tradingDays.push(today);
          acct.phaseTradingDays = acct.phaseTradingDays || [];
          if (!acct.phaseTradingDays.includes(today)) acct.phaseTradingDays.push(today);
          acct.openTrade = {
            dir,
            entry: price,
            markPrice: price,
            peak: price,
            stopDist,
            stop: dir > 0 ? price - stopDist : price + stopDist,
            target: dir > 0 ? price + stopDist * rr : price - stopDist * rr,
            units,
            notional: +(price * units).toFixed(2),
            riskUsd: +riskUsd.toFixed(2),
            entryFee: +entryFee.toFixed(2),
            unrealizedUsd: 0,
            unrealizedPct: 0,
            openedAt: now,
            trailed: false,
          };
          acct.equity = acct.balance;
          tradesMoved++;
          pushAcctEvent(acct, 'info', `פתיחת ${dir > 0 ? 'LONG' : 'SHORT'} על ${acct.symbol} @ ${price.toFixed(2)} (סיכון $${riskUsd.toFixed(0)})`);
        }
      }

      // 6. Check Phase Advancement (Phase 1 -> Phase 2 -> Funded!)
      const postHealth = computeNostroAccountHealth(acct, now);
      if (acct.phase === 'phase1' && postHealth.totalReturnPct >= acct.rules.phase1TargetPct && postHealth.tradingDaysCount >= postHealth.minTradingDays) {
        if (acct.openTrade) closeAccountPositionInternal(acct, price, 'phase1_passed', feeRate, now);
        const nextPhase = (acct.rules.phase2TargetPct || 0) > 0 ? 'phase2' : 'funded';
        acct.phase = nextPhase;
        acct.phaseStartedAt = now;
        acct.phaseTradingDays = [];
        if (nextPhase === 'funded') acct.fundedAt = now;
        // Reset evaluation balance to initialBalance for the next phase (exact FTMO/The5ers behavior)
        acct.balance = acct.initialBalance;
        acct.equity = acct.initialBalance;
        acct.highWaterMark = acct.initialBalance;
        acct.dayStartEquity = acct.initialBalance;
        pushAcctEvent(acct, 'ok', nextPhase === 'funded'
          ? `🏆 עבר מבחן ${acct.firmName} והפך לחשבון Funded אמיתי ($${acct.initialBalance.toLocaleString('en-US')})!`
          : `✅ עבר שלב 1 של ${acct.firmName}! מתקדם לשלב 2 (יעד +${acct.rules.phase2TargetPct}%)`);
        store.log('ok', `נוסטרו · ${acct.firmName}`, `${acct.botName}: קודם ל-${nextPhase === 'funded' ? 'Funded!' : 'שלב 2!'}`);
      } else if (acct.phase === 'phase2' && postHealth.totalReturnPct >= (acct.rules.phase2TargetPct || 5) && postHealth.tradingDaysCount >= postHealth.minTradingDays) {
        if (acct.openTrade) closeAccountPositionInternal(acct, price, 'phase2_passed', feeRate, now);
        acct.phase = 'funded';
        acct.phaseStartedAt = now;
        acct.phaseTradingDays = [];
        acct.fundedAt = now;
        acct.balance = acct.initialBalance;
        acct.equity = acct.initialBalance;
        acct.highWaterMark = acct.initialBalance;
        acct.dayStartEquity = acct.initialBalance;
        pushAcctEvent(acct, 'ok', `🏆 עבר שלב 2 של ${acct.firmName}! החשבון כעת Funded (${acct.rules.profitSplitPct}% חלוקת רווחים)!`);
        store.log('ok', `נוסטרו · ${acct.firmName}`, `${acct.botName}: עבר שלב 2 והפך ל-Funded!`);
      }

      // 7. Record live equity snapshot (throttled to 1 per minute unless trade moved)
      acct.equityHistory = acct.equityHistory || [];
      const lastSnap = acct.equityHistory[acct.equityHistory.length - 1];
      if (!lastSnap || now - lastSnap.t > 60_000 || Math.abs(lastSnap.v - acct.equity) > 1) {
        acct.equityHistory.push({ t: now, v: acct.equity });
        if (acct.equityHistory.length > 240) acct.equityHistory = acct.equityHistory.slice(-240);
      }

      updated++;
    } catch (err) {
      console.warn('[nostro-room] tick failed', acct.id, err.message);
    }
  }

  room.lastTickAt = now;
  if (state === store.state && (updated > 0 || tradesMoved > 0)) {
    if (typeof localStorage !== 'undefined') store.save();
    scheduleDatabasePush(1500);
  }
  return { ok: true, updated, tradesMoved, accounts: room.accounts.length };
}

export async function closeNostroAccountPosition(accountId, reason = 'manual', state = store.state) {
  const room = ensureNostroTradingRoom(state);
  const acct = room.accounts.find((a) => a.id === accountId);
  if (!acct || !acct.openTrade) return { ok: false, error: 'אין פוזיציה פתוחה בחשבון זה' };
  let price = acct.lastPrice || acct.openTrade.markPrice || acct.openTrade.entry;
  try {
    const candles = await getCandles(acct.symbol, acct.tf, { limit: 10, force: true });
    if (candles?.length && !candles.__synthetic) price = candles[candles.length - 1].c;
  } catch { /* use last known real price */ }
  const now = Date.now();
  const s = state.settings || {};
  // Same cost model as the tick loop; a manual close used to charge a different rate.
  const feeRate = Math.max(0.0003, Number(s.takerFee ?? s.feeRate ?? 0.0004)) + (Number(s.spread ?? 0.001) * 0.5);
  const tr = closeAccountPositionInternal(acct, price, reason, feeRate, now);
  if (acct.equity > (acct.highWaterMark || acct.initialBalance)) acct.highWaterMark = acct.equity;
  acct.equityHistory = acct.equityHistory || [];
  acct.equityHistory.push({ t: now, v: acct.equity });
  if (state === store.state) {
    store.save(true);
    store.emit();
    scheduleDatabasePush(1000);
  }
  return { ok: true, trade: tr };
}

export function resetNostroAccount(accountId, state = store.state) {
  const room = ensureNostroTradingRoom(state);
  const acct = room.accounts.find((a) => a.id === accountId);
  if (!acct) return false;
  const now = Date.now();
  acct.phase = 'phase1';
  acct.startedAt = now;
  acct.phaseStartedAt = now;
  acct.fundedAt = null;
  acct.balance = acct.initialBalance;
  acct.equity = acct.initialBalance;
  acct.highWaterMark = acct.initialBalance;
  acct.dayKey = utcDayKey(now);
  acct.dayStartEquity = acct.initialBalance;
  acct.dailyRealizedByDay = {};
  acct.tradingDays = [];
  acct.phaseTradingDays = [];
  acct.openTrade = null;
  acct.trades = [];
  acct.equityHistory = [{ t: now, v: acct.initialBalance }];
  acct.totalFees = 0;
  acct.breached = false;
  acct.breachReason = null;
  acct.breachedAt = null;
  acct.dailyLockedKey = null;
  pushAcctEvent(acct, 'info', `🔄 החשבון אופס מחדש לשלב 1 (${acct.firmName} · $${acct.initialBalance.toLocaleString('en-US')})`);
  if (state === store.state) {
    store.save(true);
    store.emit();
    scheduleDatabasePush(1000);
  }
  return true;
}

export function removeNostroAccount(accountId, state = store.state) {
  const room = ensureNostroTradingRoom(state);
  room.accounts = room.accounts.filter((a) => a.id !== accountId);
  if (state === store.state) {
    store.save(true);
    store.emit();
    scheduleDatabasePush(1000);
  }
}

// Multi-sheet Excel (.xls SpreadsheetML) Export with full Proof + Prop Firm Sources + Trade Log
function xmlEsc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function xmlRow(cells, isHeader = false) {
  const styleAttr = isHeader ? ' ss:StyleID="hdr"' : '';
  return `<Row>${cells.map((c) => {
    const isNum = typeof c === 'number' && Number.isFinite(c);
    return `<Cell${styleAttr}><Data ss:Type="${isNum ? 'Number' : 'String'}">${xmlEsc(c)}</Data></Cell>`;
  }).join('')}</Row>`;
}

export function buildNostroExcelXml(nostroState) {
  const bots = nostroState?.bots || [];
  const rules = nostroState?.rules || DEFAULT_NOSTRO_RULES;

  const sheet1Rows = [
    xmlRow([
      'מזהה בוט', 'שם בוט', 'נכס', 'טיימפריים', 'אסטרטגיה', 'מקור נתונים',
      'מחיר אחרון', 'טווח נתונים', 'תשואה (%)', 'Max Total DD (%)', 'Max Daily Loss (%)',
      'Profit Factor', 'Sharpe', 'מספר עסקאות', 'תאריך מעבר שלב 1', 'תאריך מעבר שלב 2',
      'חברות נוסטרו שהבוט מוכן לעבור', 'רווח Funded משוער ($)', 'סטטוס',
    ], true),
    ...bots.map((b) => xmlRow([
      b.id, b.name, b.symbol, b.tf, STRATEGIES[b.strategyId]?.label || b.strategyId,
      `${b.dataProvider || 'Live'} (${b.isSynthetic ? 'סינתטי' : 'נתוני אמת'})`,
      b.lastPrice ?? '', `${b.dataFromDate || ''} -> ${b.dataToDate || ''}`,
      b.totalReturnPct ?? 0, b.maxTotalDdPct ?? 0, b.maxDailyLossPct ?? 0,
      b.metrics?.profitFactor ?? 0, b.metrics?.sharpe ?? 0, b.metrics?.trades ?? 0,
      b.phase1PassedDate || '—', b.phase2PassedDate || '—',
      (b.readyFirms || []).join(', ') || 'טרם עבר',
      b.fundedProfitUsd || 0, b.statusLabel || '',
    ])),
  ].join('');

  const sheet2Rows = [
    xmlRow([
      'חברת נוסטרו', 'תוכנית מבחן', 'יעד שלב 1 (%)', 'יעד שלב 2 (%)',
      'הפסד יומי מקסימלי (%)', 'Drawdown כולל מקסימלי (%)', 'חלוקת רווחים (%)',
      'מינימום עסקאות', 'נכסים מומלצים', 'קישור למקור החוקים הרשמי', 'תיאור החוקים',
    ], true),
    ...PROP_FIRM_PROFILES.map((f) => xmlRow([
      f.name, f.program, f.phase1TargetPct, f.phase2TargetPct,
      f.maxDailyLossPct, f.maxTotalDdPct, f.profitSplitPct,
      f.minTrades, f.focus, f.sourceUrl, f.sourceNote,
    ])),
    xmlRow(['הגדרת המשתמש הפעילה', 'Custom Fleet Rules', rules.phase1TargetPct, rules.phase2TargetPct, rules.maxDailyLossPct, rules.maxTotalDdPct, rules.profitSplitPct, rules.minTrades, 'כל הנכסים', 'Alta Capital Simulator', 'חוקי המבחן הפעילים בסימולציה הנוכחית']),
  ].join('');

  const sheet3Rows = [
    xmlRow(['שם בוט', 'נכס', 'כיוון', 'תאריך כניסה', 'תאריך יציאה', 'מחיר כניסה', 'מחיר יציאה', 'רווח/הפסד ($)', 'תשואה (%)'], true),
    ...bots.flatMap((b) => (b.tradeProofSample || []).map((tr) => xmlRow([
      b.name, b.symbol, tr.side, tr.entryDate, tr.exitDate, tr.entryPrice, tr.exitPrice, tr.pnlUsd, tr.retPct,
    ]))),
  ].join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="hdr"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1E3A5F" ss:Pattern="Solid"/></Style>
 </Styles>
 <Worksheet ss:Name="דוח מוכנות והוכחות"><Table>${sheet1Rows}</Table></Worksheet>
 <Worksheet ss:Name="מקורות וחוקי חברות נוסטרו"><Table>${sheet2Rows}</Table></Worksheet>
 <Worksheet ss:Name="יומן עסקאות הוכחה"><Table>${sheet3Rows}</Table></Worksheet>
</Workbook>`;
}
