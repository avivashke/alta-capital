// Prop Firm / Nostro Challenge Autonomous Engine & Proof Reporter.
// Evaluates multiple strategy bots on LIVE real-time market data against real Prop Firm rules:
//  - FTMO, The5ers, FundedNext, Topstep, Apex Trader Funding
//  - Tracks exact pass dates, drawdown compliance, live data provider, and trade-level proof
//  - Supports autonomous auto-refresh + multi-sheet Excel (.xls) report export

import { BARS_PER_YEAR } from './config.js';
import { store } from './store.js';
import { getCandles, marketState } from './market.js';
import { runBacktest } from './backtest.js';
import { optimize } from './optimizer.js';
import { STRATEGIES, defaultsFor } from './strategies.js';
import { scheduleDatabasePush } from './db.js';

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
    profitSplitPct: 80,
    focus: 'קריפטו, מדדים, מט"ח, סחורות',
    sourceUrl: 'https://ftmo.com/en/objectives/',
    sourceNote: 'חוקי FTMO הרשמיים: יעד שלב 1 (10%), שלב 2 (5%), הפסד יומי מקס׳ 5% (Equity/Balance), הפסד כולל 10%, חלוקת רווחים 80%–90%.',
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
    profitSplitPct: 80,
    focus: 'רב-נכסי (קריפטו, מדדים, מניות, מט"ח)',
    sourceUrl: 'https://fundednext.com/stellar-challenge',
    sourceNote: 'חוקי FundedNext Stellar: יעד שלב 1 (8%), שלב 2 (5%), הפסד יומי 5%, הפסד כולל 10%, חלוקת רווחים 80% (+15% בונוס שלב מבחן).',
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
    profitSplitPct: 90,
    focus: 'חוזים עתידיים, מדדים (SPY/QQQ) וסחורות (זהב)',
    sourceUrl: 'https://www.topstep.com/trading-combine/',
    sourceNote: 'חוקי Topstep Combine: שלב אחד (6% יעד רווח), מגבלת הפסד מקסימלית 3%–4% (EOD Trailing), משמעת יומית 2.5%, חלוקת רווחים 90%.',
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
    profitSplitPct: 90,
    focus: 'מדדים וסחורות (S&P 500, Nasdaq, Gold)',
    sourceUrl: 'https://apextraderfunding.com/',
    sourceNote: 'חוקי Apex 1-Step: יעד רווח 6%, סף נגרר (Trailing Threshold) של 3%–4%, ללא מגבלת ימים מינימלית קשיחה, חלוקת רווחים 90%–100%.',
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
  profitSplitPct: 80,
};

function fmtDate(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toISOString().slice(0, 10); } catch { return '—'; }
}

export function evaluateCurveAgainstNostro(curve, trades, rules) {
  const startCap = rules.accountSize;
  let peak = startCap;
  let maxTotalDdPct = 0;
  let maxDailyLossPct = 0;
  let worstDailyLossDate = null;
  let breached = null;
  let phase1PassedAt = null;
  let phase2PassedAt = null;

  const p1Target = startCap * (1 + rules.phase1TargetPct / 100);
  const p2Target = startCap * (1 + (rules.phase1TargetPct + (rules.phase2TargetPct || 0)) / 100);

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
    if (dailyDrop > maxDailyLossPct) {
      maxDailyLossPct = dailyDrop;
      worstDailyLossDate = dayKey;
    }

    if (!breached) {
      if (dailyDrop >= rules.maxDailyLossPct) {
        breached = `חריגה מהפסד יומי מקסימלי (${dailyDrop.toFixed(2)}% ≥ ${rules.maxDailyLossPct}%) בתאריך ${dayKey}`;
      } else if (effectiveDd >= rules.maxTotalDdPct) {
        breached = `חריגה מ-Drawdown כולל (${effectiveDd.toFixed(2)}% ≥ ${rules.maxTotalDdPct}%)`;
      }
    }

    if (!breached) {
      if (!phase1PassedAt && eq >= p1Target) phase1PassedAt = pt.t || i;
      if (phase1PassedAt && !phase2PassedAt && (rules.phase2TargetPct <= 0 || eq >= p2Target)) {
        phase2PassedAt = pt.t || i;
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

export async function runNostroBot(botTemplate, rules = DEFAULT_NOSTRO_RULES, { doOptimize = false, forceLive = true } = {}) {
  const s = store.state.settings;
  const candles = await getCandles(botTemplate.symbol, botTemplate.tf, { limit: 700, force: forceLive });
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

export async function runNostroFleetSimulation(customRules = {}, { doOptimize = false, forceLive = true } = {}) {
  const rules = { ...DEFAULT_NOSTRO_RULES, ...(store.state.nostro?.rules || {}), ...customRules };
  const existingBots = store.state.nostro?.bots || [];
  const deskClones = buildNostroBotsFromExistingDesks(store.state.desks || []);
  const allTemplates = [...NOSTRO_BOT_TEMPLATES, ...deskClones];
  const results = [];

  for (const tpl of allTemplates) {
    const prev = existingBots.find((b) => b.id === tpl.id);
    const botInput = prev?.params ? { ...tpl, params: prev.params, riskPerTrade: prev.riskPerTrade ?? tpl.riskPerTrade } : tpl;
    try {
      const res = await runNostroBot(botInput, rules, { doOptimize, forceLive });
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

  store.state.nostro = {
    rules,
    bots: results,
    autoMode: store.state.nostro?.autoMode ?? true,
    updatedAt: Date.now(),
  };

  const readyBots = results.filter((r) => (r.readyFirms || []).length > 0);
  if (readyBots.length) {
    const summaryText = readyBots.map((b) => `${b.name} -> ${b.readyFirms.join('/')}`).join(' · ');
    store.log('ok', 'מערך נוסטרו אוטומטי', `נמצאו ${readyBots.length} בוטים מוכנים למעבר נוסטרו על נתוני אמת: ${summaryText}`);
  } else {
    store.log('info', 'מערך נוסטרו אוטומטי', `הושלמה בדיקת ${results.length} בוטים בזמן אמת`);
  }

  store.save();
  store.emit();
  scheduleDatabasePush();
  return store.state.nostro;
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
