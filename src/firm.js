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

// מנוע תיק דמה גלובלי — מופעל רק לאחר בדיקת עבר רווחית
let paperPortfolio = null;
// לקוח Binance Testnet — מוגדר רק אם יש מפתחות API בהגדרות
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

  // בדיקת סף רווחיות אחרי עמלות (אומדן מס)
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
  for (const a of store.state.agents) {
    if (a.status === 'busy') {
      a.completed = (a.completed || 0) + 1;
      a.progress = 100;
    }
    a.status = 'idle';
    a.task = 'ממתין למחזור הבא';
    a.speech = null;
    a.speechType = 'speak';
    a.thinking = null;
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
  setAgent('quant', { status: 'busy', task: `בונה השערה · ${desk.label}`, progress: 20, speech: `סורקת דפוסים על ${desk.label} · מחפשת כיווני כניסה`, speechType: 'speak' });
  setAgent('backtest', { status: 'busy', task: `טוען ${desk.symbol} ${desk.tf} ומריץ walk-forward`, progress: 10, thinking: `מכין חלונות walk-forward על ${desk.symbol} ${desk.tf}, מחשב תשואה/Sharpe/DD ויציבות בין מקטעים`, speech: `מריץ בקטסט וולידציה על ${desk.tf}`, speechType: 'speak' });
  setAgent('optimizer', { status: 'busy', task: 'מיטוב פרמטרים מתמטי', progress: 4, thinking: 'מריץ חיפוש פרמטרים (grid/random) + hill-climb מקומי, בודק רגישות ומונע overfitting מול OOS', speechType: 'think' });
  setAgent('intel', { status: 'busy', task: 'סורק GitHub/חדשות לאסטרטגיות ומיטוב', progress: 30, thinking: 'מחפש ריפו של אופטימיזציה, Walk-Forward, גאן (זוויות/זמן/לוח שנה) ואסטרטגיות רווחיות ליישום', speech: 'סורק מקורות מידע ומחלץ רעיונות לשיפור', speechType: 'speak' });
  store.log('info', 'אוריה · CIO', `פותח מחזור על ${desk.label} (${desk.symbol} · ${desk.tf})`);
  liveEmit(true);

  try {
    const candles = await getCandles(desk.symbol, desk.tf, {
      limit: LIMITS[desk.tf] || 700,
      force: !!opts.focus,
    });

    // AI director decision, consumed once by the next cycle on this desk.
    const aiPlan = desk.aiPlan && !desk.aiPlan.consumed ? desk.aiPlan : null;
    if (aiPlan?.strategyId && STRATEGIES[aiPlan.strategyId] && aiPlan.strategyId !== desk.strategyId) {
      store.log('info', 'אוריה · CIO',
        `${desk.label}: עוברים למשפחה ${STRATEGIES[aiPlan.strategyId].label} לפי החלטת הסוכן החכם`);
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
        setAgent('backtest', { progress: pct, task: `בודק ${done}/${total} וריאציות` });
        if (done % 6 === 0) liveEmit();
      },
    });

    state.stats.backtests = (state.stats.backtests || 0) + (result.backtests || 0);

    if (!result.best) {
      desk.status = desk.status === 'live' ? 'live' : (desk.metrics ? 'optimizing' : 'research');
      store.log('warn', 'ליה · אופטימיזציה', `${desk.label}: לא נמצאה וריאציה עם מספיק עסקאות בנתונים הקיימים`);
      idleAgents();
      liveEmit(true);
      return { ok: false, reason: 'no-candidate' };
    }

    const ev = result.best.evaluation;

    // Statistical hardening before anything is allowed to become a version.
    setAgent('ta', { status: 'busy', task: `קוראת מגמה, מומנטום ומבנה · ${desk.tf}`, progress: 45, thinking: 'מזהה רמות תמיכה והתנגדות, בודקת מומנטום ומבנה מחיר', speechType: 'think' });
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
      task: `בודק DD ${ev.full.maxDrawdownPct}% · PF ${ev.full.profitFactor}`,
      progress: 60,
      speech: `מגן על ההון · בודק.Drawdown ${ev.full.maxDrawdownPct}% ו-Profit Factor ${ev.full.profitFactor}`, speechType: 'speak' });

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
        task: `אורז ${desk.version} ל־${s.platform}`,
        progress: 70,
        speech: `מייצא קוד לבוט ${desk.version} לפלטפורמה ${s.platform}`, speechType: 'speak' });
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
          ? 'גרסה ראשונה שעברה את סף הרווחיות'
          : `שיפור של ${improvement}% ב־out-of-sample`,
      });
      if (desk.history.length > 40) desk.history.length = 40;
      state.stats.deployments = (state.stats.deployments || 0) + 1;

      store.log(
        'ok',
        'גיא · פיתוח',
        `${desk.label}: פורסמה ${desk.version} (${desk.strategyId}) · OOS ${ev.oos.returnPct}% · PF ${ev.full.profitFactor}`,
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
      store.log('info', 'נועה · אנליסטית', `${desk.label}: נשמרת השערת עבודה (${desk.strategyId}) — ממתינים ל-OOS חיובי לפני פרסום גרסה`);
    } else {
      const current = runBacktest(candles, desk.strategyId, desk.params, cfg);
      desk.metrics = current.metrics;
      desk.equity = downsample(current.curve.map((p) => p.v));
      desk.fitness = +result.best.score.toFixed(2);
      desk.lastCandles = candles.length;
      store.log(
        'warn',
        'ליה · אופטימיזציה',
        `${desk.label}: המועמד הטוב (${result.best.strategyId || desk.strategyId}) השיג OOS ${ev.oos.returnPct}% · חוסן ${assessment.robustness}/100 — לא עומד בסף (שיפור ${threshold}% · חוסן ${s.minRobustness ?? 50})`,
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
        store.log('warn', 'דניאל · סיכונים', `${desk.label}: המדדים ירדו מתחת לשערים — חזרה לכיול וסגירת פוזיציית הנייר`);
      }
    } else if (desk.version && gateCheck.ok && oosPositive && robustOk) {
      desk.dryRunCycles = (desk.dryRunCycles || 0) + 1;
      desk.status = 'dry-run';
      setAgent('exec', { status: 'busy', task: `dry-run ${desk.dryRunCycles}/3 · ${desk.version}`, progress: 80, speech: `מריצת dry-run למחזור ${desk.dryRunCycles}/3 לפני אישור מסחר חי על נייר`, speechType: 'speak' });
      store.log('info', 'תמר · ביצוע', `${desk.label}: dry-run ${desk.dryRunCycles}/3 · ${desk.version}`);
      if (desk.dryRunCycles >= 3) {
        desk.status = 'live';
        desk.liveSince = Date.now();
        store.log('ok', 'אוריה · CIO', `${desk.label}: אושרה הרצה חיה על נייר · ${desk.version}`);
      }
    } else {
      desk.status = desk.metrics ? 'optimizing' : 'research';
      desk.dryRunCycles = 0;
    }

    setAgent('cio', {
      status: 'busy',
      task: publish ? `מאשר ${desk.version} ומקצה הון` : 'מעדיף להמתין לשיפור מובהק',
      progress: 90,
      speech: publish ? `מאשר ${desk.version} ומקצה הון לשולחן ${desk.label}` : 'מעדיף להמתין לשיפור מובהק לפני קידום גרסה', speechType: 'speak' });
    if (aiPlan) {
      desk.aiPlan = { ...aiPlan, consumed: true, appliedAt: Date.now() };
    }

    idleAgents();
    liveEmit(true);
    return { ok: true, published: publish, evaluation: ev };
  } catch (err) {
    console.error('[firm] cycle failed', err);
    desk.status = desk.status === 'live' ? 'live' : 'research';
    store.log('bad', 'מערך הסוכנים', `${desk.label}: המחזור נכשל — ${err.message}`);
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

  // סגירה גם ב-Binance Testnet אם יש לקוח מוגדר ופקודה פתוחה שם
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
      store.log('info', 'תמר · ביצוע',
        `${desk.label}: פקודת סגירה בוצעה ב-Binance Testnet · ${side} ${qty}`);
    } catch (err) {
      console.warn('[firm] binance close failed', desk.id, err.message);
    }
  }

  store.log(sized >= 0 ? 'ok' : 'warn', 'תמר · ביצוע',
    `${desk.label}: סגירת פוזיציית נייר ${t.dir > 0 ? 'לונג' : 'שורט'} · ${sized.toFixed(2)}% (${reason})`);
  desk.openTrade = null;
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

        // ביצוע פקודה אמת ב-Binance Testnet אם מוגדרו מפתחות API
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
            store.log('info', 'תמר · ביצוע',
              `${desk.label}: פקודת קנייה בוצעה ב-Binance Testnet · ${side} ${binanceQuantity} @ ${price.toFixed(2)}`);
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
        store.log('info', 'תמר · ביצוע', `${desk.label}: פתיחת פוזיציית נייר ${dir > 0 ? 'לונג' : 'שורט'} ב־${price.toFixed(2)}`);
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
        reason: `אסטרטגיה ${desk.strategyId} על ${desk.label} הרוויחה ${desk.metrics.returnPct}% בבקטסט אחרי עמלות`,
      });
      store.log('ok', 'אוריה · CIO',
        `${desk.label}: אושרה למסחר דמה על Binance Testnet — ${desk.version} · ${desk.metrics.returnPct}% נטו בבקטסט`);
    } else if (desk.dryRunCycles >= PAPER_TRADING.dryRunCyclesBeforeLive && gatesOk && !profitableAfterFees) {
      store.log('warn', 'אוריה · CIO',
        `${desk.label}: עברה גדרות אך אינה רווחית אחרי עמלות ומס — לא תופעל במסחר דמה`);
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
    // עבודה רציפה: מחקר, ניתוח טכני, סנטימנט ואופטימיזציה בכל מחזור
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
    store.log('info', 'נועה · אנליסטית', `${desk.label}: עוברים למשפחת אסטרטגיות ${STRATEGIES[strategyId]?.label || strategyId}`);
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
    store.log('info', 'אוריה · CIO', `${desk.label}: אופס שולחן המסחר`);
  });
}

export function setDeskStatus(deskId, status) {
  store.mutate((state) => {
    const desk = state.desks.find((d) => d.id === deskId);
    if (!desk) return;
    desk.status = status;
    if (status === 'live') desk.liveSince = Date.now();
    if (status !== 'live') desk.openTrade = null;
    store.log('info', 'אוריה · CIO', `${desk.label}: סטטוס שונה ל־${status}`);
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
  store.log('info', 'עומר · מודיעין', `שולח את "${idea.title}" לבדיקה על ${desk.label}`);
  const res = await runDeskCycle(desk, { focus: true, deep: false });
  idea.result = res?.evaluation?.oos ? `${res.evaluation.oos.returnPct}% OOS` : 'לא עבר';
  store.save();
  store.emit();
}
