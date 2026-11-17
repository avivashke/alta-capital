// The firm: orchestration of desks, agents, optimization cycles, versioning and paper execution.

import { BARS_PER_YEAR, DESKS, BINANCE_TESTNET, PAPER_TRADING } from './config.js';
import { store } from './store.js';
import { getCandles, lastPrice, startQuotes } from './market.js';
import { STRATEGIES } from './strategies.js';
import { optimize } from './optimizer.js';
import { runBacktest, passesGates } from './backtest.js';
import { buildArtifact } from './platforms.js';
import { atr } from './indicators.js';
import { assessStrategy } from './stats.js';
import { analyze } from './ta.js';
import { scanIfDue, refreshSentiment } from './research.js';
import { createBinanceClient } from './binance_testnet.js';
import { createPaperPortfolio } from './paper_portfolio.js';

const LIMITS = { '5m': 800, '15m': 800, '1h': 800, '1d': 600, '1w': 420 };
const ROUNDS = { intraday: { rounds: 26, climb: 12 }, swing: { rounds: 30, climb: 14 } };

let lastEmit = 0;
let ticking = false;

// ×ž× ×•×¢ ×ª×™×§ ×“×ž×” ×’×œ×•×‘×œ×™ â€” ×ž×•×¤×¢×œ ×¨×§ ×œ××—×¨ ×‘×“×™×§×ª ×¢×‘×¨ ×¨×•×•×—×™×ª
let paperPortfolio = null;
// ×œ×§×•×— Binance Testnet â€” ×ž×•×’×“×¨ ×¨×§ ×× ×™×© ×ž×¤×ª×—×•×ª API ×‘×”×’×“×¨×•×ª
let binanceClient = null;

export function ensurePaperPortfolio() {
  if (!paperPortfolio) {
    const s = store.state.settings;
    paperPortfolio = createPaperPortfolio(s);
    binanceClient = createBinanceClient(s);
    if (binanceClient.apiKey && binanceClient.apiSecret) {
      console.log('[firm] Binance Testnet client initialized');
    } else {
      console.log('[firm] Binance Testnet client running in simulation mode (no API keys)');
    }
  }
  return paperPortfolio;
}

export function getPaperPortfolio() {
  return paperPortfolio;
}

export function getBinanceClient() {
  return binanceClient;
}

function isBacktestProfitableAfterFeesAndTax(metrics) {
  if (!metrics) return false;
  const s = store.state.settings;
  const returnPct = metrics.returnPct || 0;
  const totalFees = metrics.totalFees || 0;
  const trades = metrics.trades || 0;

  // ×‘×“×™×§×ª ×¡×£ ×¨×•×•×—×™×•×ª ××—×¨×™ ×¢×ž×œ×•×ª (××•×ž×“×Ÿ ×ž×¡)
  const estimatedTax = Math.max(0, returnPct) * (PAPER_TRADING.taxRate / 100);
  const netReturnPct = returnPct - (totalFees * 100) - estimatedTax;

  return (
    netReturnPct > PAPER_TRADING.minBacktestReturnPct &&
    trades >= PAPER_TRADING.minBacktestTrades &&
    (metrics.profitFactor || 0) >= PAPER_TRADING.minProfitFactor &&
    (metrics.maxDrawdownPct || 100) <= PAPER_TRADING.maxDrawdownPct
  );
}


function liveEmit(force = false) {
  const now = Date.now();
  if (force || now - lastEmit > 420) {
    lastEmit = now;
    store.emit();
  }
}

export function allocationFor(desk, capital = store.state.settings.capital) {
  return Math.max(500, capital * (desk.weight || 1 / DESKS.length));
}

export function gateSettings(desk) {
  const s = store.state.settings;
  const factor = desk.tf === '1w' ? 0.4 : desk.tf === '1d' ? 0.6 : 1;
  return { ...s, minTrades: Math.max(4, Math.round(s.minTrades * factor)) };
}

function cfgFor(desk) {
  const s = store.state.settings;
  return {
    capital: allocationFor(desk),
    riskPerTrade: s.riskPerTrade,
    feeRate: s.feeRate,
    makerFee: s.makerFee,
    takerFee: s.takerFee,
    spread: s.spread,
    impactFactor: s.impactFactor,
    exchangeFee: s.exchangeFee,
    minTrades: gateSettings(desk).minTrades,
    barsPerYear: BARS_PER_YEAR[desk.tf] || 8760,
  };
}

function setAgent(id, patch) {
  const agent = store.state.agents.find((a) => a.id === id);
  if (!agent) return;
  Object.assign(agent, patch);
  agent.lastActive = Date.now();
  // keep visible thought/action for UI: if task/progress updated during busy work, reflect as speech when no explicit speech
  if (agent.status === 'busy' && !agent.speech && agent.task) {
    agent.speech = agent.task;
    agent.speechType = 'status';
  }
  if (agent.thinking) agent.speechType = 'think';
}

function idleAgents() {
  const now = Date.now();
  for (const a of store.state.agents) {
        if (a.status === 'busy') {
      a.completed = (a.completed || 0) + 1;
      a.progress = 100;
      a.speech = a.task ? ('סיים: ' + a.task) : 'פנוי למשימה הבאה';
      a.speechType = 'speak';
      a.thinking = null;
      a.thoughtUntil = now + 45000;
      a.lastActive = now;
    } else {
      // fade old completed thought after window
      if (a.thoughtUntil && now > a.thoughtUntil) {
        a.speech = null;
        a.thinking = null;
        a.thoughtUntil = 0;
      }
    }
    a.status = 'idle';
    if (!a.task || a.task.indexOf('�~�~ת�"�x') === 0) a.task = 'ס�"רק ש�"ק, �~�קר �"�~�"���"� �~ת�~ש�a';
  }
}
function downsample(values, maxPoints = 160) {
  if (!values || values.length <= maxPoints) return values || [];
  const step = values.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i++) out.push(values[Math.floor(i * step)]);
  out.push(values[values.length - 1]);
  return out;
}

function pickStrategy(desk) {
  const intraday = ['ema_trend', 'breakout', 'momentum', 'rsi_reversion', 'macd_swing'];
  const swing = ['macd_swing', 'ema_trend', 'breakout', 'momentum'];
  const pool = desk.kind === 'intraday' ? intraday : swing;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function ensureDeskFields() {
  for (const desk of store.state.desks) {
    desk.history = desk.history || [];
    desk.equity = desk.equity || [];
    desk.liveTrades = desk.liveTrades || [];
    desk.dryRunCycles = desk.dryRunCycles || 0;
    desk.openTrade = desk.openTrade || null;
    desk.status = desk.status || 'research';
    desk.ideas = desk.ideas || [];
  }
}

export function nextDesk(state) {
  const desks = state.desks;
  const idx = (state.stats.cycles || 0) % desks.length;
  return desks[idx];
}

// --- one full agent cycle on one desk -------------------------------------

export async function runDeskCycle(desk, opts = {}) {
  const state = store.state;
  const s = state.settings;
  const cfg = cfgFor(desk);
  const gates = gateSettings(desk);

  desk.lastRunAt = Date.now();
  if (desk.status !== 'live') desk.status = 'optimizing';
  setAgent('quant', { status: 'busy', task: `בונה השערת מסחר · ${desk.label}`, progress: 20, speech: `סורקת דפוסים ומבנה שוק ב-${desk.label}`, speechType: 'speak' });
  setAgent('backtest', { status: 'busy', task: `טוען נתונים ${desk.symbol} ${desk.tf} ומריץ walk-forward`, progress: 10, thinking: `מכין חלונות בדיקה, מודד תשואה/Sharpe/DD ובודק יציבות`, speech: `מריץ בקטסט ואימות על ${desk.tf}`, speechType: 'speak' });
  setAgent('optimizer', { status: 'busy', task: 'מיטוב פרמטרים מתמטי', progress: 8, thinking: 'חיפוש פרמטרים (grid/random) + hill-climb, בדיקת רגישות ומניעת התאמת-יתר מול OOS', speech: 'מכייל פרמטרים לשיפור ביצועים', speechType: 'think' });
  setAgent('intel', { status: 'busy', task: 'סורק GitHub/חדשות לאסטרטגיות ומיטוב', progress: 30, thinking: 'מחפש שיפורי אופטימיזציה, Walk-Forward ושיטות גאן ליישום ברובוטים', speech: 'אוסף מודיעין ומחקר מהמקורות', speechType: 'speak' });
  setAgent('gann_time', { status: 'busy', task: `מנתח מחזורי זמן גאן רב-שנתיים · ${desk.symbol}`, progress: 18, thinking: `סורק גרפים היסטוריים ב-${desk.tf}, מזהה מחזורי זמן, תאריכי מפנה ולוח שנה מסחרי`, speech: 'ממפה מחזורי זמן היסטוריים בשיטת גאן', speechType: 'speak' });
  setAgent('gann_geometry', { status: 'busy', task: `ממפה זוויות ורמות גאן · ${desk.symbol}`, progress: 22, thinking: 'מחשב זוויות מחיר/זמן, רמות תמיכה/התנגדות ומבנה גאומטרי רב-שנתי', speech: 'בונה רשת זוויות ורמות גאן', speechType: 'think' });
  setAgent('gann_patterns', { status: 'busy', task: `מזהה תבניות גאן חוזרות · ${desk.symbol}`, progress: 16, thinking: 'משווה דפוסי מחיר ונפח לאורך שנים, מחפש חזרות והרמוניות סטטיסטיות', speech: 'מחפש דפוסים היסטוריים חוזרים', speechType: 'speak' });
  setAgent('gann_square', { status: 'busy', task: `חוקר ריבוע התשע ומחיר-זמן · ${desk.symbol}`, progress: 14, thinking: 'מחשב רמות ריבוע התשע, איזוני מחיר/זמן ואזורי מפנה פוטנציאליים לשיפור אסטרטגיה', speech: 'מיישם חישובי ריבוע התשע במחקר', speechType: 'think' });
  setAgent('gann_master', { status: 'busy', task: `חוקרת מחזורי שוק ומיטוב גאן · ${desk.symbol}`, progress: 12, thinking: 'בוחנת מחזורי שוק היסטוריים ומתרגמת ממצאי גאן לפרמטרים ואופטימיזציה לרובוטים', speech: 'משלבת ממצאי גאן במיטוב האסטרטגיות', speechType: 'speak' });

  store.log('info', 'א�"ר�"� · CIO', `פ�"ת� �~���"ר ע�S ${desk.label} (${desk.symbol} · ${desk.tf})`);
  liveEmit(true);

  try {
    const candles = await getCandles(desk.symbol, desk.tf, {
      limit: LIMITS[desk.tf] || 700,
      force: !!opts.focus,
    });

    // AI director decision, consumed once by the next cycle on this desk.
    const aiPlan = desk.aiPlan && !desk.aiPlan.consumed ? desk.aiPlan : null;
    if (aiPlan?.strategyId && STRATEGIES[aiPlan.strategyId] && aiPlan.strategyId !== desk.strategyId) {
      store.log('info', 'א�"ר�"� · CIO',
        `${desk.label}: ע�"�ר�"ם �S�~שפ�� ${STRATEGIES[aiPlan.strategyId].label} �Sפ�" ���S��ת �ס�"�:�x ���:ם`);
      desk.strategyId = aiPlan.strategyId;
      desk.params = null;
      desk.version = null;
      desk.bestReturn = null;
      desk.baselineReturn = null;
      desk.metrics = null;
      desk.oosMetrics = null;
      desk.assessment = null;
      desk.equity = [];
      desk.dryRunCycles = 0;
    }
    if (!desk.strategyId) desk.strategyId = pickStrategy(desk);

    const baseRounds = ROUNDS[desk.kind] || ROUNDS.intraday;
    const result = await optimize({
      candles,
      strategyId: desk.strategyId,
      cfg,
      seed: desk.params,
      spaceOverride: aiPlan?.paramBias || null,
      rounds: opts.deep ? baseRounds.rounds * 2 : baseRounds.rounds,
      climb: opts.deep ? baseRounds.climb * 2 : baseRounds.climb,
      onProgress: ({ done, total }) => {
        const pct = Math.round((done / total) * 100);
        setAgent('optimizer', { progress: pct });
        setAgent('backtest', { progress: pct, task: `��"�ק ${done}/${total} �"ר�"אצ�"�"ת` });
        if (done % 6 === 0) liveEmit();
      },
    });

    state.stats.backtests = (state.stats.backtests || 0) + (result.backtests || 0);

    if (!result.best) {
      desk.status = desk.status === 'live' ? 'live' : (desk.metrics ? 'optimizing' : 'research');
      store.log('warn', '�S�"� · א�"פ���"�~�"�צ�"�', `${desk.label}: �Sא נ�~צא� �"ר�"אצ�"� עם �~ספ�"ק עסקא�"ת �נת�"נ�"ם �ק�"�"�~�"ם`);
      idleAgents();
      liveEmit(true);
      return { ok: false, reason: 'no-candidate' };
    }

    const ev = result.best.evaluation;

    // Statistical hardening before anything is allowed to become a version.
    setAgent('ta', { status: 'busy', task: `מנתח מגמה ומבנה מחיר · ${desk.tf}`, progress: 45, thinking: 'מזהה תמיכה/התנגדות, מומנטום ותנודתיות לאימות האות', speechType: 'think' });
    const assessment = assessStrategy({
      candles,
      strategyId: desk.strategyId,
      params: result.best.params,
      cfg,
      isMetrics: ev.is,
      oosMetrics: ev.oos,
      folds: 4,
      mcIterations: desk.kind === 'swing' ? 500 : 700,
    });
    desk.assessment = assessment;
    desk.robustness = assessment.robustness;
    desk.technical = analyze(candles) || desk.technical;

    const prevReturn = desk.bestReturn;
    const threshold = s.promotionDelta;
    const hasVersion = desk.version != null;
    const robustEnough = assessment.robustness >= (s.minRobustness ?? 50);
    const publish = ev.oos.returnPct > 0 && robustEnough && (
      desk.version == null || ev.oos.returnPct >= (prevReturn ?? ev.oos.returnPct) + threshold
    );

    setAgent('risk', {
      status: 'busy',
      task: `��"�ק DD ${ev.full.maxDrawdownPct}% · PF ${ev.full.profitFactor}`,
      progress: 60,
      speech: `�~��x ע�S ���"�x · ��"�ק.Drawdown ${ev.full.maxDrawdownPct}% �"-Profit Factor ${ev.full.profitFactor}`, speechType: 'speak' });

    if (publish) {
      const improvement = prevReturn == null ? null : +(ev.oos.returnPct - prevReturn).toFixed(2);
      const minor = desk.version ? Number(desk.version.split('.')[1]) + 1 : 0;
      desk.version = `v1.${minor}`;
      desk.params = result.best.params;
      desk.strategyId = result.best.strategyId || desk.strategyId;
      desk.bestReturn = +ev.oos.returnPct.toFixed(2);
      desk.baselineReturn = desk.baselineReturn ?? +ev.oos.returnPct.toFixed(2);
      desk.metrics = ev.full;
      desk.oosMetrics = ev.oos;
      desk.isMetrics = ev.is;
      desk.equity = downsample(ev.curve.map((p) => p.v));
      desk.fitness = +result.best.score.toFixed(2);
      desk.lastCandles = candles.length;
      desk.dataProvider = candles.__provider || null;

      setAgent('dev', {
        status: 'busy',
        task: `א�"ר� ${desk.version} �S־${s.platform}`,
        progress: 70,
        speech: `�~�"�"צא ק�"� �S��"�� ${desk.version} �Sפ�S��פ�"ר�~� ${s.platform}`, speechType: 'speak' });
      const artifact = buildArtifact(desk, s.platform);
      desk.generatedCode = artifact.code;
      desk.artifactName = artifact.filename;
      desk.history.unshift({
        version: desk.version,
        at: Date.now(),
        strategyId: desk.strategyId,
        params: { ...desk.params },
        oosReturn: desk.oosMetrics.returnPct,
        isReturn: desk.isMetrics.returnPct,
        fullReturn: ev.full.returnPct,
        profitFactor: ev.full.profitFactor,
        trades: ev.full.trades,
        maxDrawdownPct: ev.full.maxDrawdownPct,
        platform: s.platform,
        filename: artifact.filename,
        bytes: artifact.code.length,
        improvement,
        robustness: assessment.robustness,
        note: improvement == null
          ? '�רס� ראש�"נ� שע�ר� את סף �ר�"�"��"�"ת'
          : `ש�"פ�"ר ש�S ${improvement}% �־out-of-sample`,
      });
      if (desk.history.length > 40) desk.history.length = 40;
      state.stats.deployments = (state.stats.deployments || 0) + 1;

      store.log(
        'ok',
        '��"א · פ�"ת�"�',
        `${desk.label}: פ�"רס�~� ${desk.version} (${desk.strategyId}) · OOS ${ev.oos.returnPct}% · PF ${ev.full.profitFactor}`,
      );

    } else if (!hasVersion) {
      // Working hypothesis: keep the best candidate so the desk is measurable, but publish
      // nothing until out-of-sample turns positive.
      desk.params = result.best.params;
      desk.strategyId = result.best.strategyId || desk.strategyId;
      desk.metrics = ev.full;
      desk.oosMetrics = ev.oos;
      desk.isMetrics = ev.is;
      desk.fitness = +result.best.score.toFixed(2);
      desk.equity = downsample(ev.curve.map((p) => p.v));
      desk.lastCandles = candles.length;
      store.log('info', 'נ�"ע� · אנ�S�"ס���"ת', `${desk.label}: נש�~רת �שערת ע��"�� (${desk.strategyId}) � �~�~ת�"נ�"ם �S-OOS ��"�"��" �Sפנ�" פרס�"ם �רס�`);
    } else {
      const current = runBacktest(candles, desk.strategyId, desk.params, cfg);
      desk.metrics = current.metrics;
      desk.equity = downsample(current.curve.map((p) => p.v));
      desk.fitness = +result.best.score.toFixed(2);
      desk.lastCandles = candles.length;
      store.log(
        'warn',
        '�S�"� · א�"פ���"�~�"�צ�"�',
        `${desk.label}: ��~�"ע�~� ����"� (${result.best.strategyId || desk.strategyId}) �ש�"� OOS ${ev.oos.returnPct}% · ��"ס�x ${assessment.robustness}/100 � �Sא ע�"�~� �סף (ש�"פ�"ר ${threshold}% · ��"ס�x ${s.minRobustness ?? 50})`,
      );
    }

    // Promotion ladder, decided from the desk's own frozen parameters.
    const gateCheck = desk.metrics ? passesGates(desk.metrics, gates) : { ok: false };
    const oosPositive = (desk.oosMetrics?.returnPct ?? 0) > 0;
    const robustOk = (desk.assessment?.robustness ?? 0) >= (s.minRobustness ?? 50);
    if (desk.status === 'live') {
      if (!gateCheck.ok || !oosPositive || !robustOk) {
        desk.status = 'optimizing';
        desk.dryRunCycles = 0;
        desk.openTrade = null;
        store.log('warn', '×“× ×™××œ Â· ×¡×™×›×•× ×™×', `${desk.label}: ��~���"ם �"ר��" �~ת�ת �Sשער�"ם � ��ר� �S�:�"�"�S �"ס��"רת פ�"��"צ�"�"ת �נ�"�"ר`);
      }
    } else if (desk.version && gateCheck.ok && oosPositive && robustOk) {
      desk.dryRunCycles = (desk.dryRunCycles || 0) + 1;
      desk.status = 'dry-run';
      setAgent('exec', { status: 'busy', task: `dry-run ${desk.dryRunCycles}/3 · ${desk.version}`, progress: 80, speech: `�~ר�"צת dry-run �S�~���"ר ${desk.dryRunCycles}/3 �Sפנ�" א�"ש�"ר �~ס�ר ��" ע�S נ�"�"ר`, speechType: 'speak' });
      store.log('info', '×ª×ž×¨ Â· ×‘×™×¦×•×¢', `${desk.label}: dry-run ${desk.dryRunCycles}/3 Â· ${desk.version}`);
      if (desk.dryRunCycles >= 3) {
        desk.status = 'live';
        desk.liveSince = Date.now();
        store.log('ok', '××•×¨×™×” Â· CIO', `${desk.label}: א�"שר� �רצ� ��"� ע�S נ�"�"ר · ${desk.version}`);
      }
    } else {
      desk.status = desk.metrics ? 'optimizing' : 'research';
      desk.dryRunCycles = 0;
    }

    setAgent('cio', {
      status: 'busy',
      task: publish ? `�~אשר ${desk.version} �"�~קצ� ��"�x` : '×ž×¢×“×™×£ ×œ×”×ž×ª×™×Ÿ ×œ×©×™×¤×•×¨ ×ž×•×‘×”×§',
      progress: 90,
      speech: publish ? `�~אשר ${desk.version} �"�~קצ� ��"�x �Sש�"�S��x ${desk.label}` : '×ž×¢×“×™×£ ×œ×”×ž×ª×™×Ÿ ×œ×©×™×¤×•×¨ ×ž×•×‘×”×§ ×œ×¤× ×™ ×§×™×“×•× ×’×¨×¡×”', speechType: 'speak' });
    if (aiPlan) {
      desk.aiPlan = { ...aiPlan, consumed: true, appliedAt: Date.now() };
    }

    idleAgents();
    liveEmit(true);
    return { ok: true, published: publish, evaluation: ev };
  } catch (err) {
    console.error('[firm] cycle failed', err);
    desk.status = desk.status === 'live' ? 'live' : 'research';
    store.log('bad', '×ž×¢×¨×š ×”×¡×•×›× ×™×', `${desk.label}: ��~���"ר נ�:ש�S � ${err.message}`);
    idleAgents();
    liveEmit(true);
    return { ok: false, error: err.message };
  }
}

// --- live paper execution -------------------------------------------------

async function closePaperTrade(desk, price, reason) {
  const t = desk.openTrade;
  if (!t) return;
  const pct = t.dir > 0 ? ((price - t.entry) / t.entry) * 100 : ((t.entry - price) / t.entry) * 100;
  const sized = pct * (t.sizeFactor || 1);
  desk.livePnl = +(desk.livePnl + sized).toFixed(3);
  desk.liveTrades.unshift({
    at: Date.now(), dir: t.dir, entry: +t.entry.toFixed(4), exit: +price.toFixed(4),
    pct: +sized.toFixed(3), reason, bars: 0,
  });
  if (desk.liveTrades.length > 25) desk.liveTrades.length = 25;

  // �¡��"����¨�⬝ ��"� ���-Binance Testnet �� ����© ���§�⬢�� �ž�⬢��"��S�¨ �⬢�¤�§�⬢��S�⬝ �¤�ª�⬢���⬝ �©�
  const pf = ensurePaperPortfolio();
  if (binanceClient && binanceClient.apiKey && binanceClient.apiSecret && t.binanceOrderId) {
    try {
      const side = t.dir > 0 ? 'SELL' : 'BUY';
      const qty = t.binanceQuantity;
      await binanceClient.createMarketOrder({
        symbol: desk.symbol,
        side,
        quantity: qty,
      });
      pf.sell({
        symbol: desk.symbol,
        price,
        quantity: qty,
        timestamp: Date.now(),
        isTaker: true,
      });
      store.log('info', 'Ã—ÂªÃ—Å¾Ã—Â¨ Ã‚Â· Ã—â€˜Ã—â„¢Ã—Â¦Ã—â€¢Ã—Â¢',
        `${desk.label}: Ã—Â¤Ã—Â§Ã—â€¢Ã—â€œÃ—Âª Ã—Â¡Ã—â€™Ã—â„¢Ã—Â¨Ã—â€ Ã—â€˜Ã—â€¢Ã—Â¦Ã—Â¢Ã—â€ Ã—â€˜-Binance Testnet Ã‚Â· ${side} ${qty}`);
    } catch (err) {
      console.warn('[firm] binance close failed', desk.id, err.message);
    }
  }

  store.log(sized >= 0 ? 'ok' : 'warn', 'Ã—ÂªÃ—Å¾Ã—Â¨ Ã‚Â· Ã—â€˜Ã—â„¢Ã—Â¦Ã—â€¢Ã—Â¢',
    `${desk.label}: Ã—Â¡Ã—â€™Ã—â„¢Ã—Â¨Ã—Âª Ã—Â¤Ã—â€¢Ã—â€“Ã—â„¢Ã—Â¦Ã—â„¢Ã—â„¢Ã—Âª Ã—Â Ã—â„¢Ã—â„¢Ã—Â¨ ${t.dir > 0 ? 'Ã—Å“Ã—â€¢Ã—Â Ã—â€™' : 'Ã—Â©Ã—â€¢Ã—Â¨Ã—Ëœ'} Ã‚Â· ${sized.toFixed(2)}% (${reason})`);
  desk.openTrade = null;
}

export async function analyzeManualClose(deskId) {
  const desk = store.state.desks.find((d) => d.id === deskId);
  if (!desk || !desk.openTrade) return { ok: false, error: '××™×Ÿ ×¤×•×–×™×¦×™×” ×¤×ª×•×—×”' };
  let price = lastPrice(desk.symbol);
  try {
    const candles = await getCandles(desk.symbol, desk.tf, { limit: 120 });
    if (!price && candles.length) price = candles[candles.length - 1].c;
    if (!price) price = desk.openTrade.entry;
    let desired = 0;
    if (desk.strategyId && desk.params && STRATEGIES[desk.strategyId]) {
      const pos = STRATEGIES[desk.strategyId].positions(candles, desk.params);
      desired = pos[pos.length - 1] || 0;
    }
    const t = desk.openTrade;
    const pnlPct = t.dir > 0 ? ((price - t.entry) / t.entry) * 100 : ((t.entry - price) / t.entry) * 100;
    const contradicts = desired === t.dir && desired !== 0;
    const reasons = [];
    if (contradicts) {
      reasons.push(`�Sפ�" �אס��ר����"� (${STRATEGIES[desk.strategyId]?.label || desk.strategyId || '× ×•×›×—×™×ª'}) �א�"ת �נ�"�:��" ע��"�"�x ת�"�~�a ��:�"�"�"�x ${t.dir > 0 ? '×œ×•× ×’' : '×©×•×¨×˜'}. �"צ�"א� �~�"ק��~ת ע�S�"�S� �Sפספס ��~ש�a �~��S�a ש�אס��ר����"� �~נס� �S�S�:�"�.`);
    }
    if (t.target != null && ((t.dir > 0 && price < t.target) || (t.dir < 0 && price > t.target))) {
      reasons.push(`�"ע� �ר�"�"� (${t.target.toFixed(2)}) ע��"�"�x �Sא ��"ש� � ��~תנ� �~אפשרת �Sאס��ר����"� �S�~�~ש את ��"�ס ס�"�:�"�x/ס�"�:�"�" שת�"�:נ�x.`);
    }
    if (t.stop != null && ((t.dir > 0 && price > t.stop) || (t.dir < 0 && price < t.stop))) {
      reasons.push(`ס���"פ ��פס� (${t.stop.toFixed(2)}) �Sא ��"פע�S � נ�"��"�S �ס�"�:�"�x ��~ק�"ר�" ע��"�"�x �~��x ע�S �פ�"��"צ�"�.`);
    }
    if (pnlPct < 0) {
      reasons.push(`�פ�"��"צ�"� �:ר�ע ��פס� (${pnlPct.toFixed(2)}%). ס��"ר� ע�:ש�"�" תק�ע �פס�; �Sפ�" ר�"� �אס��ר����"�"ת ע��"ף �Sתת �Sס���"פ/א�"ת ��"צ�"א� �Sנ��S את �עסק� א�Sא אם �שתנ�" �תנא�"ם.`);
    } else {
      reasons.push(`�פ�"��"צ�"� �:ר�ע �ר�"�"� (${pnlPct.toFixed(2)}%). ס��"ר� �~�"ק��~ת עש�"�"� �S�ק���"�x ר�"�"� אם ��~��S�a ע�"� �Sא ���"ע �S�"ע� א�" �Sא�"ת �"צ�"א� ש�S �אס��ר����"�.`);
    }
    return { ok: true, desk, price, pnlPct, contradicts, desired, reasons };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function manualCloseDesk(deskId, reason = 'manual') {
  const desk = store.state.desks.find((d) => d.id === deskId);
  if (!desk || !desk.openTrade) return { ok: false, error: '××™×Ÿ ×¤×•×–×™×¦×™×” ×¤×ª×•×—×”' };
  let price = lastPrice(desk.symbol);
  if (!price) {
    try {
      const candles = await getCandles(desk.symbol, desk.tf, { limit: 5 });
      if (candles.length) price = candles[candles.length - 1].c;
    } catch {}
  }
  if (!price) price = desk.openTrade.entry;
  await closePaperTrade(desk, price, reason);
  store.save();
  store.emit();
  return { ok: true, price };
}

export async function refreshTechnicals({ force = false } = {}) {
  for (const desk of store.state.desks) {
    const age = Date.now() - (desk.technical?.at || 0);
    if (!force && age < 4 * 60 * 1000) continue;
    try {
      const candles = await getCandles(desk.symbol, desk.tf, { limit: 320 });
      const ta = analyze(candles);
      if (ta) desk.technical = ta;
    } catch (err) {
      console.warn('[ta] desk failed', desk.id, err.message);
    }
  }
  store.save();
  store.emit();
}

export async function tickLive() {
  const live = store.state.desks.filter((d) => d.status === 'live');
  const s = store.state.settings;
  for (const desk of live) {
    try {
      const candles = await getCandles(desk.symbol, desk.tf, { limit: 320 });
      const price = lastPrice(desk.symbol) || candles[candles.length - 1].c;
      if (!desk.strategyId || !desk.params) continue;
      const desired = STRATEGIES[desk.strategyId].positions(candles, desk.params);
      const dir = desired[desired.length - 1] || 0;
      const atrSeries = atr(candles, 14).filter((v) => v != null);
      const a = atrSeries[atrSeries.length - 1] || price * 0.01;
      const stopMult = Number(desk.params.atrStop) || 2;
      const rr = Number(desk.params.rr) || 2;

      if (desk.openTrade) {
        const t = desk.openTrade;
        const hitStop = t.dir > 0 ? price <= t.stop : price >= t.stop;
        const hitTarget = t.dir > 0 ? price >= t.target : price <= t.target;
        if (hitStop) closePaperTrade(desk, t.stop, 'stop');
        else if (hitTarget) closePaperTrade(desk, t.target, 'target');
        else if (dir !== t.dir) closePaperTrade(desk, price, 'signal');
        else {
          const pct = t.dir > 0 ? ((price - t.entry) / t.entry) * 100 : ((t.entry - price) / t.entry) * 100;
          desk.openTrade.markPct = +pct.toFixed(3);
        }
      } else if (dir !== 0 && s.autopilot) {
        const stopDist = stopMult * a;
        const pf = ensurePaperPortfolio();
        const capitalUsdt = Math.min(s.capital || 100000, pf.cash);
        const riskAmount = capitalUsdt * Number(s.riskPerTrade || 0.015);
        const stopDistance = Math.abs(price - (dir > 0 ? price - stopDist : price + stopDist));
        const quantity = stopDistance > 0 ? riskAmount / stopDistance : 0;

        let binanceOrderId = null;
        let binanceQuantity = 0;

        // ��"צ�"ע פק�"�� א�~ת �-Binance Testnet אם �~�"��ר�" �~פת��"ת API
        if (binanceClient && binanceClient.apiKey && binanceClient.apiSecret && quantity > 0) {
          try {
            const side = dir > 0 ? 'BUY' : 'SELL';
            const order = await binanceClient.createMarketOrder({
              symbol: desk.symbol,
              side,
              quantity: Number(quantity).toFixed(6),
            });
            binanceOrderId = order.orderId || null;
            binanceQuantity = Number(order.executedQty || quantity);
            pf.buy({
              symbol: desk.symbol,
              price,
              quantity: binanceQuantity,
              timestamp: Date.now(),
              isTaker: true,
            });
            store.log('info', '×ª×ž×¨ Â· ×‘×™×¦×•×¢',
              `${desk.label}: פק�"�ת קנ�"�"� ��"צע� �-Binance Testnet · ${side} ${binanceQuantity} @ ${price.toFixed(2)}`);
          } catch (err) {
            console.warn('[firm] binance open failed', desk.id, err.message);
          }
        }

        desk.openTrade = {
          dir,
          entry: price,
          stop: dir > 0 ? price - stopDist : price + stopDist,
          target: dir > 0 ? price + stopDist * rr : price - stopDist * rr,
          at: Date.now(),
          sizeFactor: Math.min(1, s.riskPerTrade / 0.015),
          markPct: 0,
          binanceOrderId,
          binanceQuantity,
        };
        store.log('info', '×ª×ž×¨ Â· ×‘×™×¦×•×¢', `${desk.label}: פת�"�ת פ�"��"צ�"�"ת נ�"�"ר ${dir > 0 ? '×œ×•× ×’' : '×©×•×¨×˜'} �־${price.toFixed(2)}`);
      }
    } catch (err) {
      console.warn('[firm] live tick failed', desk.id, err);
    }
  }
}

export async function promoteDryRuns() {
  const s = store.state.settings;
  const pf = ensurePaperPortfolio();

  for (const desk of store.state.desks) {
    if (desk.status !== 'dry-run') continue;

    const gatesOk = passesGates(desk.metrics, gateSettings(desk)).ok;
    const profitableAfterFees = isBacktestProfitableAfterFeesAndTax(desk.metrics);

    if (desk.dryRunCycles >= PAPER_TRADING.dryRunCyclesBeforeLive && gatesOk && profitableAfterFees) {
      desk.status = 'live';
      desk.liveSince = Date.now();
      pf.activate({
        reason: `אס��ר����"� ${desk.strategyId} ע�S ${desk.label} �ר�"�"�"�� ${desk.metrics.returnPct}% ��ק��ס�� א�ר�" ע�~�S�"ת`,
      });
      store.log('ok', '××•×¨×™×” Â· CIO',
        `${desk.label}: א�"שר� �S�~ס�ר ��~� ע�S Binance Testnet � ${desk.version} · ${desk.metrics.returnPct}% נ���" ��ק��ס��`);
    } else if (desk.dryRunCycles >= PAPER_TRADING.dryRunCyclesBeforeLive && gatesOk && !profitableAfterFees) {
      store.log('warn', '××•×¨×™×” Â· CIO',
        `${desk.label}: ע�ר� ��ר�"ת א�a א�"נ� ר�"�"��"ת א�ר�" ע�~�S�"ת �"�~ס � �Sא ת�"פע�S ��~ס�ר ��~�`);
    }
  }
}

// --- orchestration --------------------------------------------------------

export async function tick({ reason = 'auto' } = {}) {
  if (ticking) return { skipped: true };
  ticking = true;
  try {
    const state = store.state;
    if (reason === 'auto' && !state.settings.autopilot) return { skipped: true };
    ensureDeskFields();
    const desk = nextDesk(state);
    state.stats.cycles = (state.stats.cycles || 0) + 1;
    state.lastTickAt = Date.now();
    const result = await runDeskCycle(desk, { deep: (state.stats.cycles||0) % 4 === 0 });
    await tickLive();
    await promoteDryRuns();
    // ע��"�� רצ�"פ�: �~�קר, נ�"ת�"� ���:נ�", סנ���"�~נ�� �"א�"פ���"�~�"�צ�"� ��:�S �~���"ר
    refreshTechnicals({ force: true }).catch((e) => console.warn('[ta]', e));
    scanIfDue().catch((e) => console.warn('[research]', e));
    refreshSentiment().catch((e) => console.warn('[sentiment]', e));
    store.save();
    store.emit();
    return { ok: true, desk: desk.id, ...result };
  } finally {
    ticking = false;
  }
}

export async function catchUp() {
  const state = store.state;
  if (!state.settings.autopilot) return;
  const gap = Date.now() - (state.lastTickAt || Date.now());
  const missed = Math.min(3, Math.floor(gap / (state.settings.tickSeconds * 1000)) - 1);
  for (let i = 0; i < missed; i++) {
    await tick({ reason: 'catchup' });
  }
}

export function switchStrategy(deskId, strategyId) {
  store.mutate((state) => {
    const desk = state.desks.find((d) => d.id === deskId);
    if (!desk) return;
    desk.strategyId = strategyId;
    desk.params = null;
    desk.version = null;
    desk.history = [];
    desk.bestReturn = null;
    desk.baselineReturn = null;
    desk.metrics = null;
    desk.oosMetrics = null;
    desk.equity = [];
    desk.status = 'optimizing';
    desk.dryRunCycles = 0;
    desk.livePnl = 0;
    desk.openTrade = null;
    store.log('info', '× ×•×¢×” Â· ×× ×œ×™×¡×˜×™×ª', `${desk.label}: ע�"�ר�"ם �S�~שפ�ת אס��ר����"�"ת ${STRATEGIES[strategyId]?.label || strategyId}`);
  });
}

export function resetDesk(deskId) {
  store.mutate((state) => {
    const desk = state.desks.find((d) => d.id === deskId);
    if (!desk) return;
    Object.assign(desk, {
      status: 'research', strategyId: null, params: null, version: null, bestReturn: null,
      baselineReturn: null, metrics: null, oosMetrics: null, equity: [], history: [],
      dryRunCycles: 0, livePnl: 0, openTrade: null, liveTrades: [], fitness: null,
    });
    store.log('info', '××•×¨×™×” Â· CIO', `${desk.label}: א�"פס ש�"�S��x ��~ס�ר`);
  });
}

export function setDeskStatus(deskId, status) {
  store.mutate((state) => {
    const desk = state.desks.find((d) => d.id === deskId);
    if (!desk) return;
    desk.status = status;
    if (status === 'live') desk.liveSince = Date.now();
    if (status !== 'live') desk.openTrade = null;
    store.log('info', '××•×¨×™×” Â· CIO', `${desk.label}: ס�����"ס ש�"נ� �S־${status}`);
  });
}

export function startMarketFeed() {
  const symbols = [...new Set(store.state.desks.map((d) => d.symbol))];
  startQuotes(symbols);
}

export async function testIdea(ideaId, deskId) {
  const state = store.state;
  const idea = state.ideas.find((i) => i.id === ideaId);
  const desk = state.desks.find((d) => d.id === deskId) || state.desks[0];
  if (!idea || !desk) return;
  idea.tested = true;
  idea.testedAt = Date.now();
  if (idea.suggestedStrategy && idea.suggestedStrategy !== desk.strategyId) {
    switchStrategy(desk.id, idea.suggestedStrategy);
  }
  store.log('info', '×¢×•×ž×¨ Â· ×ž×•×“×™×¢×™×Ÿ', `ש�"�S� את "${idea.title}" �S���"ק� ע�S ${desk.label}`);
  const res = await runDeskCycle(desk, { focus: true, deep: false });
  idea.result = res?.evaluation?.oos ? `${res.evaluation.oos.returnPct}% OOS` : '×œ× ×¢×‘×¨';
  store.save();
  store.emit();
}
