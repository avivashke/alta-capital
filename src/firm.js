// The firm: orchestration of desks, agents, optimization cycles, versioning and paper execution.

import { BARS_PER_YEAR, BACKTEST_HISTORY, DESKS, BINANCE_TESTNET, PAPER_TRADING, scanUniverseFor } from './config.js';
import { store } from './store.js';
import { getCandles, lastPrice, startQuotes, marketState } from './market.js';
import { STRATEGIES } from './strategies.js';
import { optimize, detectMarketRegime } from './optimizer.js';
import { auditDeskPromotion, auditSystemTruth } from './auditor.js';
import { runBacktest, passesGates } from './backtest.js';
import { scanUniverse } from './universe.js';
import { buildArtifact } from './platforms.js';
import { atr } from './indicators.js';
import { assessStrategy } from './stats.js';
import { analyze } from './ta.js';
import { scanIfDue, refreshSentiment } from './research.js';
import { refreshFundamentals } from './fundamentals.js';
import { runAutonomousGannLibraryAuditIfDue } from './gann.js';
import { runYonatanYouTubeScoutIfDue } from './youtube_scout.js';
import { createBinanceClient } from './binance_testnet.js';
import { createPaperPortfolio } from './paper_portfolio.js';
import { recordVersionInDb, recordTradeInDb, recordCycleInDb, scheduleDatabasePush, pushStateToDatabase } from './db.js';
import { runAiDirector } from './ai.js';

// Deep history per timeframe (years back on 1d/1w, months on intraday) so the
// backtest is not decided by a few weeks of one market regime.
const LIMITS = BACKTEST_HISTORY;
const ROUNDS = { intraday: { rounds: 26, climb: 12 }, swing: { rounds: 30, climb: 14 } };

// --- risk governor ---------------------------------------------------------
// The live book once ran until it was gone. These are the limits the risk desk
// now enforces by itself on every tick: a bot has to keep earning to stay live,
// and the whole paper book has a hard circuit breaker.
const LIVE_RISK = {
  deskMaxLossPct: 6,               // live drop from the desk's own high-water mark
  deskVerdictTrades: 8,            // ...or this many live trades with a losing, low-hit-rate run
  deskMinWinRate: 0.35,
  portfolioMaxDdPct: 12,           // the whole paper book, from its peak equity
  maxLiveDesks: 6,
  cooldownMs: 12 * 60 * 60 * 1000, // paused desks may re-enter optimisation after this
};

// What a nostro bot must show before the team lets it trade the live book.
const NOSTRO_LIVE_GATES = {
  minTrades: 20,
  minProfitFactor: 1.25,
  maxDrawdownPct: 20,
  minReturnPct: 8,
  minCandles: 600,
  maxPerCycle: 2,
};

export function cloneParams(params) {
  try { return JSON.parse(JSON.stringify(params || {})); } catch { return { ...(params || {}) }; }
}

let lastEmit = 0;
let ticking = false;

// מנוע תיק דמה גלובלי — מסונכרן אוטומטית עם store._revision כדי שלעולם לא יתאפס אחרי סנכרון ענן
let paperPortfolio = null;
let paperPortfolioRev = -1;
// לקוח Binance Testnet — מוגדר רק אם יש מפתחות API בהגדרות
let binanceClient = null;

export function rehydratePaperPortfolio() {
  const s = store.state.settings || {};
  const pf = createPaperPortfolio(s);
  if (store.state.paperPortfolio && typeof store.state.paperPortfolio === 'object') {
    pf.fromJSON(store.state.paperPortfolio);
  }
  paperPortfolio = pf;
  paperPortfolioRev = store._revision;
  binanceClient = createBinanceClient(s);
  return paperPortfolio;
}

export function ensurePaperPortfolio() {
  if (!paperPortfolio || paperPortfolioRev !== store._revision) {
    rehydratePaperPortfolio();
    if (binanceClient?.apiKey && binanceClient?.apiSecret) {
      console.log('[firm] Binance Testnet client initialized');
    }
  }
  return paperPortfolio;
}

export function savePaperPortfolio() {
  const pf = ensurePaperPortfolio();
  if (pf) {
    store.state.paperPortfolio = pf.toJSON();
  }
}

export function getPaperPortfolio() {
  return ensurePaperPortfolio();
}

export function getBinanceClient() {
  if (!binanceClient) ensurePaperPortfolio();
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
  if (force || now - lastEmit > 1800) {
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
      a.speech = a.task ? ('סיים: ' + a.task) : 'מחזור הושלם';
      a.speechType = 'speak';
      a.thinking = null;
      a.thoughtUntil = now + 45000; // השארת מחשבה/עדכון גלוי למשך זמן
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
    if (!a.task || a.task.indexOf('ממתין') === 0) a.task = 'סורק שוק, מחקר ומיטוב מתמשך';
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
  const intraday = ['ema_trend', 'supertrend_adx', 'structure_pullback', 'vol_breakout', 'breakout', 'momentum', 'rsi_reversion', 'mean_reversion_z', 'gann_swing_sq9'];
  const swing = ['macd_swing', 'ema_trend', 'structure_pullback', 'supertrend_adx', 'breakout', 'gann_swing_sq9', 'gann_time_cycle', 'vol_breakout'];
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
    desk.livePnl = Number(desk.livePnl) || 0;
    desk.livePeakPnl = Math.max(Number(desk.livePeakPnl) || 0, desk.livePnl);
  }
}

export function nextDesk(state) {
  const desks = state.desks;
  const planned = desks.find((d) => d.aiPlan && !d.aiPlan.consumed);
  if (planned) return planned;
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

  store.log('info', 'אוריה · CIO', `פותח מחזור על ${desk.label} (${desk.symbol} · ${desk.tf})`);
  liveEmit(true);

  try {
    const candles = await getCandles(desk.symbol, desk.tf, {
      limit: LIMITS[desk.tf] || 700,
      force: !!opts.focus,
    });
    desk.dataWindow = candles.length
      ? {
        bars: candles.length,
        from: candles[0]?.t || null,
        to: candles[candles.length - 1]?.t || null,
        provider: candles.__provider || null,
        synthetic: !!candles.__synthetic,
      }
      : null;

    // Detect live market regime from real OHLCV candles for continuous adaptive optimization
    const regime = detectMarketRegime(candles);
    const prevRegime = desk.marketRegime?.regime;
    desk.marketRegime = regime;
    if (prevRegime && prevRegime !== regime.regime) {
      store.log('info', 'יעל · משטר שוק', `${desk.label}: זוהה שינוי משטר שוק → ${regime.label} (ER ${regime.er} · Vol×${regime.volRatio})`);
    }

    // AI director decision, consumed once by the next cycle on this desk (grounded against real STRATEGIES).
    const aiPlan = desk.aiPlan && !desk.aiPlan.consumed ? desk.aiPlan : null;
    if (aiPlan?.strategyId && !STRATEGIES[aiPlan.strategyId]) {
      store.log('warn', 'אמיר · ביקורת אמת', `${desk.label}: יורטה המלצת AI לאסטרטגיה לא קיימת (${aiPlan.strategyId}) — נחסמה הזיה`);
      desk.aiPlan = { ...aiPlan, consumed: true, rejectedByAuditor: 'unknown-strategy' };
    } else if (!desk.lockedStrategy && aiPlan?.strategyId && STRATEGIES[aiPlan.strategyId] && aiPlan.strategyId !== desk.strategyId) {
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
    if (!desk.strategyId) {
      const regPool = (regime.recommendedFamilies || []).filter((id) => STRATEGIES[id]);
      desk.strategyId = regPool.length ? regPool[0] : pickStrategy(desk);
    }

    const baseRounds = ROUNDS[desk.kind] || ROUNDS.intraday;
    setAgent('optimizer', {
      status: 'busy',
      task: `מיטוב למשטר "${regime.label}" · ${desk.label}`,
      progress: 12,
      thinking: `מכיילת פרמטרים ל-${regime.label} (שיפוע ${regime.slopePct}% · תנודתיות ×${regime.volRatio})`,
    });
    const result = await optimize({
      candles,
      strategyId: desk.strategyId,
      cfg,
      seed: desk.params,
      spaceOverride: aiPlan?.paramBias || null,
      regime,
      rounds: opts.deep ? baseRounds.rounds * 2 : baseRounds.rounds,
      climb: opts.deep ? baseRounds.climb * 2 : baseRounds.climb,
      onProgress: ({ done, total }) => {
        const pct = Math.round((done / total) * 100);
        setAgent('optimizer', { progress: pct });
        setAgent('backtest', { progress: pct, task: `בודק ${done}/${total} וריאציות` });
        if (done % 10 === 0) liveEmit();
      },
    });

    state.stats.backtests = (state.stats.backtests || 0) + (result.backtests || 0);

    // Continuous Market-Regime Challenger: skipped for dedicated strategy bots (desk.lockedStrategy)
    // so each dedicated YouTube bot proves profitability strictly on its own target strategy.
    let winner = result.best;
    const regimeMismatch = !(regime.recommendedFamilies || []).includes(desk.strategyId);
    const recentWeak = !winner?.recentMetrics || (winner.recentMetrics.returnPct ?? 0) < 0;
    const deskWeak = !desk.version || (winner?.evaluation?.oos?.returnPct ?? -999) < 1.5 || (desk.assessment?.robustness ?? 0) < 55 || !!desk.lastAudit?.vetoed;
    if (!desk.lockedStrategy && (regimeMismatch || recentWeak || deskWeak || opts.deep || !winner)) {
      const regRecs = (regime.recommendedFamilies || []).filter((id) => STRATEGIES[id] && id !== desk.strategyId);
      const orthogonal = deskWeak
        ? [regRecs[0], 'rsi_reversion', 'mean_reversion_z', 'macd_swing', 'gann_swing_sq9', regRecs[1]]
            .filter((id, i, arr) => id && STRATEGIES[id] && id !== desk.strategyId && arr.indexOf(id) === i)
            .slice(0, 3)
        : regRecs.slice(0, opts.deep ? 2 : 1);
      for (const challengerId of orthogonal) {
        const chalRes = await optimize({
          candles,
          strategyId: challengerId,
          cfg,
          regime,
          rounds: opts.deep ? 26 : 18,
          climb: opts.deep ? 12 : 8,
        });
        state.stats.backtests = (state.stats.backtests || 0) + (chalRes.backtests || 0);
        const cb = chalRes.best;
        const incWeak = !winner
          || (winner.evaluation?.full?.profitFactor ?? 0) < 1.15
          || (winner.evaluation?.full?.returnPct ?? 0) <= 0;
        const chalPositive = cb && (cb.evaluation?.oos?.returnPct ?? -999) > 0 && (cb.evaluation?.full?.returnPct ?? -999) > 0;
        const beatsInc = cb && (!winner
          || (cb.score > winner.score + 0.8 && (
            (cb.evaluation?.oos?.returnPct ?? -999) > (winner.evaluation?.oos?.returnPct ?? -999) + 0.3
            || (incWeak && chalPositive)
          )));
        if (beatsInc) {
          store.log('info', 'ליה · הסתגלות לשוק',
            `${desk.label}: משטר "${regime.label}" — מתמודדת ${STRATEGIES[challengerId].label} (OOS ${cb.evaluation.oos.returnPct}% · PF ${cb.evaluation.full.profitFactor}) גברה על ${STRATEGIES[winner?.strategyId || desk.strategyId]?.label || desk.strategyId}`);
          winner = cb;
        }
      }
    }

    if (!winner) {
      desk.status = desk.status === 'live' ? 'live' : (desk.metrics ? 'optimizing' : 'research');
      store.log('warn', 'ליה · אופטימיזציה', `${desk.label}: לא נמצאה וריאציה עם מספיק עסקאות בנתונים הקיימים`);
      idleAgents();
      liveEmit(true);
      return { ok: false, reason: 'no-candidate' };
    }

    const candStrategyId = winner.strategyId || desk.strategyId;
    const ev = { ...winner.evaluation, strategyId: candStrategyId, params: winner.params };

    // Statistical hardening before anything is allowed to become a version.
    setAgent('ta', { status: 'busy', task: `קוראת מגמה, מומנטום ומבנה · ${desk.tf}`, progress: 45, thinking: 'מזהה רמות תמיכה והתנגדות, בודקת מומנטום ומבנה מחיר', speechType: 'think' });
    const assessment = assessStrategy({
      candles,
      strategyId: candStrategyId,
      params: winner.params,
      cfg,
      isMetrics: ev.is,
      oosMetrics: ev.oos,
      // Deeper history earns more walk-forward folds: each fold retrains and then
      // trades an unseen slice, so 6 folds test the strategy across more regimes.
      folds: candles.length >= 1500 ? 6 : 4,
      mcIterations: desk.kind === 'swing' ? 500 : 700,
    });
    desk.assessment = assessment;
    desk.robustness = assessment.robustness;
    desk.recentMetrics = winner.recentMetrics || null;
    desk.technical = analyze(candles) || desk.technical;

    // Critical Truth & Anti-Hallucination Audit by Amir ("אמיר") BEFORE publication or promotion!
    setAgent('auditor', {
      status: 'busy',
      task: `מאמת נתוני אמת ו-OOS · ${desk.label}`,
      progress: 65,
      thinking: 'בודק שאין נתוני הדגמה, שאין Overfitting, שעמלות משוקללות ושהמדדים ריאליים',
      speech: `מבצע ביקורת אמת קפדנית על ${desk.label}`,
      speechType: 'think',
    });
    const audit = auditDeskPromotion({
      desk: { ...desk, strategyId: candStrategyId, params: winner.params },
      candles,
      evaluation: ev,
      assessment,
      marketState,
      settings: gates,
      recentMetrics: winner.recentMetrics || null,
    });
    desk.lastAudit = audit;
    if (audit.vetoed) {
      if (!state.truthAudit) state.truthAudit = { vetoesTotal: 0 };
      state.truthAudit.vetoesTotal = (state.truthAudit.vetoesTotal || 0) + 1;
      setAgent('auditor', {
        status: 'busy',
        task: `חסם קידום · ${desk.short}`,
        progress: 100,
        speech: audit.summary,
        speechType: 'speak',
      });
      store.log('warn', 'אמיר · ביקורת אמת', `${desk.label}: ${audit.summary}`);
    } else {
      setAgent('auditor', {
        status: 'busy',
        task: `אימת אמת (${audit.score}/100) · ${desk.short}`,
        progress: 100,
        speech: audit.summary,
        speechType: 'speak',
      });
    }

    // Cross-market depth: run the winning strategy + parameters over a whole
    // universe, so the team sees which stock (or coin) it actually works best on.
    const scanDue = opts.focus || !desk.universeScan || Date.now() - (desk.universeScan.at || 0) > 20 * 60_000;
    if (scanDue && winner?.params) {
      setAgent('backtest', {
        status: 'busy',
        task: `בודק את האסטרטגיה על פני סל נכסים · ${desk.short}`,
        progress: 75,
        thinking: 'מריץ את אותם פרמטרים על מניות/מטבעות נוספים ומדרג איפה האסטרטגיה עובדת הכי טוב',
      });
      try {
        const uni = await scanUniverse({
          symbols: scanUniverseFor(desk.symbol),
          tf: desk.tf,
          strategyId: candStrategyId,
          params: winner.params,
          cfg,
          limit: LIMITS[desk.tf] || 700,
          minTrades: Math.max(4, Math.round((gates.minTrades || 10) / 2)),
        });
        desk.universeScan = {
          at: Date.now(),
          tf: desk.tf,
          strategyId: candStrategyId,
          baseSymbol: desk.symbol,
          scanned: uni.scanned,
          ok: uni.ok,
          years: uni.years,
          rows: uni.rows,
          best: uni.best,
          worst: uni.worst,
        };
        if (uni.best) {
          store.log('info', 'איתי · בקטסט',
            `${desk.label}: ${uni.ok}/${uni.scanned} נכסים נבדקו לאורך ${uni.years} שנים · הכי טוב ${uni.best.symbol} (${uni.best.returnPct}% · PF ${uni.best.profitFactor} · ${uni.best.trades} עסקאות)`);
        } else {
          store.log('warn', 'איתי · בקטסט', `${desk.label}: סריקת הסל לא נמצאה רווחית באף נכס (${uni.ok}/${uni.scanned} תקפים)`);
        }
      } catch (err) {
        store.log('warn', 'איתי · בקטסט', `${desk.label}: סריקת הסל נכשלה · ${err.message}`);
      }
    }

    const prevReturn = desk.bestReturn;
    const threshold = s.promotionDelta;
    const hasVersion = desk.version != null;
    const robustEnough = assessment.robustness >= (s.minRobustness ?? 50);
    // Unlock stale high-water-mark trap: if the currently deployed version is failing gates or losing on current candles,
    // allow any healthy, Amir-verified OOS-positive replacement immediately.
    let incumbentBroken = false;
    if (hasVersion && desk.params && STRATEGIES[desk.strategyId]) {
      const curCheck = runBacktest(candles, desk.strategyId, desk.params, cfg);
      incumbentBroken = !passesGates(curCheck.metrics, gates).ok || curCheck.metrics.returnPct <= 0;
    }
    const beatsThreshold = desk.version == null
      || incumbentBroken
      || ev.oos.returnPct >= (prevReturn ?? ev.oos.returnPct) + threshold;
    const publish = !audit.vetoed && ev.oos.returnPct > 0 && robustEnough && beatsThreshold;

    setAgent('risk', {
      status: 'busy',
      task: `בודק DD ${ev.full.maxDrawdownPct}% · PF ${ev.full.profitFactor}`,
      progress: 60,
      speech: `מגן על ההון · בודק Drawdown ${ev.full.maxDrawdownPct}% ו-Profit Factor ${ev.full.profitFactor}`, speechType: 'speak' });

    if (publish) {
      const improvement = prevReturn == null ? null : +(ev.oos.returnPct - prevReturn).toFixed(2);
      const minor = desk.version ? Number(desk.version.split('.')[1]) + 1 : 0;
      desk.version = `v1.${minor}`;
      desk.params = winner.params;
      desk.strategyId = candStrategyId;
      desk.bestReturn = +ev.oos.returnPct.toFixed(2);
      desk.baselineReturn = desk.baselineReturn ?? +ev.oos.returnPct.toFixed(2);
      desk.metrics = ev.full;
      desk.oosMetrics = ev.oos;
      desk.isMetrics = ev.is;
      desk.equity = downsample(ev.curve.map((p) => p.v));
      desk.fitness = +winner.score.toFixed(2);
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
        auditScore: audit.score,
        regime: regime.label,
        note: improvement == null
          ? `גרסה ראשונה מאומתת (משטר: ${regime.label})`
          : `שיפור של ${improvement}% ב־OOS (משטר: ${regime.label})`,
      });
      if (desk.history.length > 40) desk.history.length = 40;
      state.stats.deployments = (state.stats.deployments || 0) + 1;

      store.log(
        'ok',
        'גיא · פיתוח',
        `${desk.label}: פורסמה ${desk.version} (${desk.strategyId}) · OOS ${ev.oos.returnPct}% · PF ${ev.full.profitFactor} · אימות אמיר ${audit.score}/100`,
      );
      recordVersionInDb(desk, ev, assessment).catch(() => {});

    } else if (!hasVersion) {
      // Working hypothesis: keep the best candidate so the desk is measurable, but publish
      // nothing until out-of-sample turns positive AND Amir verifies truth.
      desk.params = winner.params;
      desk.strategyId = candStrategyId;
      desk.metrics = ev.full;
      desk.oosMetrics = ev.oos;
      desk.isMetrics = ev.is;
      desk.fitness = +winner.score.toFixed(2);
      desk.equity = downsample(ev.curve.map((p) => p.v));
      desk.lastCandles = candles.length;
      store.log('info', 'נועה · אנליסטית', `${desk.label}: נשמרת השערת עבודה (${desk.strategyId}) — ממתינים ל-OOS חיובי ולאישור אמיר`);
    } else {
      const current = runBacktest(candles, desk.strategyId, desk.params, cfg);
      desk.metrics = current.metrics;
      desk.equity = downsample(current.curve.map((p) => p.v));
      desk.fitness = +winner.score.toFixed(2);
      desk.lastCandles = candles.length;
      if (!audit.vetoed) {
        store.log(
          'warn',
          'ליה · אופטימיזציה',
          `${desk.label}: המועמד הטוב (${candStrategyId}) השיג OOS ${ev.oos.returnPct}% · חוסן ${assessment.robustness}/100 — לא עומד בסף (שיפור ${threshold}% · חוסן ${s.minRobustness ?? 50})`,
        );
      }
    }

    // Promotion ladder, decided from the desk's own frozen parameters AND Amir's truth verification.
    const gateCheck = desk.metrics ? passesGates(desk.metrics, gates) : { ok: false };
    const oosPositive = (desk.oosMetrics?.returnPct ?? 0) > 0;
    const robustOk = (desk.assessment?.robustness ?? 0) >= (s.minRobustness ?? 50);
    const auditOk = !desk.lastAudit?.vetoed;
    if (desk.status === 'live') {
      if (!gateCheck.ok || !oosPositive || !robustOk || !auditOk) {
        desk.status = 'optimizing';
        desk.dryRunCycles = 0;
        desk.openTrade = null;
        store.log('warn', !auditOk ? 'אמיר · ביקורת אמת' : 'דניאל · סיכונים',
          `${desk.label}: ${!auditOk ? 'נחסם בביקורת אמת' : 'המדדים ירדו מתחת לשערים'} — חזרה לכיול וסגירת פוזיציית הנייר`);
      }
    } else if (desk.version && gateCheck.ok && oosPositive && robustOk && auditOk) {
      desk.dryRunCycles = (desk.dryRunCycles || 0) + 1;
      desk.status = 'dry-run';
      setAgent('exec', { status: 'busy', task: `dry-run ${desk.dryRunCycles}/3 · ${desk.version}`, progress: 80, speech: `מריצת dry-run למחזור ${desk.dryRunCycles}/3 לפני אישור מסחר חי על נייר`, speechType: 'speak' });
      store.log('info', 'תמר · ביצוע', `${desk.label}: dry-run ${desk.dryRunCycles}/3 · ${desk.version}`);
      if (desk.dryRunCycles >= 3) {
        desk.status = 'live';
        desk.liveSince = Date.now();
        store.log('ok', 'אוריה · CIO', `${desk.label}: אושרה הרצה חיה על נייר (מאומתת אמיר ${audit.score}/100) · ${desk.version}`);
      }
    } else {
      desk.status = desk.metrics ? 'optimizing' : 'research';
      desk.dryRunCycles = 0;
    }

    setAgent('cio', {
      status: 'busy',
      task: publish ? `מאשר ${desk.version} ומקצה הון` : (audit.vetoed ? 'מכבד וטו של אמיר · ממתין לאימות' : 'מעדיף להמתין לשיפור מובהק'),
      progress: 90,
      speech: publish ? `מאשר ${desk.version} ומקצה הון לשולחן ${desk.label}` : (audit.vetoed ? `אמיר חסם קידום ב-${desk.label} — חוזרים לכיול על נתוני אמת` : 'מעדיף להמתין לשיפור מובהק לפני קידום גרסה'), speechType: 'speak' });
    if (aiPlan) {
      desk.aiPlan = { ...aiPlan, consumed: true, appliedAt: Date.now() };
    }

    idleAgents();
    liveEmit(true);
    recordCycleInDb({
      deskId: desk.id,
      tf: desk.tf,
      strategyId: desk.strategyId,
      ok: true,
      published: publish,
      version: desk.version,
      oosReturn: ev.oos?.returnPct ?? null,
      robustness: assessment?.robustness ?? null,
      aiProvider: state.aiDirector?.source || null,
      aiModel: state.aiDirector?.model || null,
    }).catch(() => {});
    scheduleDatabasePush();
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
  if (desk.liveTrades.length > 100) desk.liveTrades.length = 100;

  // סגירה בתיק הנייר המשותף + Binance Testnet אם הוגדרו מפתחות
  const pf = ensurePaperPortfolio();
  if (!pf.isActive) pf.activate({ reason: 'מסחר נייר פעיל' });
  const qty = t.binanceQuantity || t.quantity || 0;
  let sellRes = null;
  if (qty > 0 && pf.positions[desk.symbol]) {
    sellRes = pf.sell({
      symbol: desk.symbol,
      price,
      quantity: Math.min(qty, pf.positions[desk.symbol].quantity),
      timestamp: Date.now(),
      isTaker: true,
      deskId: desk.id,
      reason,
    });
  }
  desk.openTrade = null;
  savePaperPortfolio();
  store.save(true);

  if (binanceClient && binanceClient.apiKey && binanceClient.apiSecret && t.binanceOrderId) {
    try {
      const side = t.dir > 0 ? 'SELL' : 'BUY';
      await binanceClient.createMarketOrder({
        symbol: desk.symbol,
        side,
        quantity: qty,
      });
      store.log('info', 'תמר · ביצוע',
        `${desk.label}: פקודת סגירה בוצעה ב-Binance Testnet · ${side} ${qty}`);
    } catch (err) {
      console.warn('[firm] binance close failed', desk.id, err.message);
    }
  }

  store.log(sized >= 0 ? 'ok' : 'warn', 'תמר · ביצוע',
    `${desk.label}: סגירת פוזיציית נייר ${t.dir > 0 ? 'לונג' : 'שורט'} · ${sized.toFixed(2)}% (${reason})`);
  recordTradeInDb({
    id: sellRes?.trade?.id,
    deskId: desk.id,
    symbol: desk.symbol,
    side: t.dir > 0 ? 'SELL' : 'COVER',
    dir: t.dir,
    price,
    quantity: qty,
    pct: +sized.toFixed(3),
    fee: sellRes?.trade?.fee || 0,
    tax: sellRes?.tax || 0,
    reason,
    at: Date.now(),
  }).catch(() => {});
  pushStateToDatabase(store.state).catch(() => {});
}

export async function analyzeManualClose(deskId) {
  const desk = store.state.desks.find((d) => d.id === deskId);
  if (!desk || !desk.openTrade) return { ok: false, error: 'אין פוזיציה פתוחה' };
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
      reasons.push(`לפי האסטרטגיה (${STRATEGIES[desk.strategyId]?.label || desk.strategyId || 'נוכחית'}) האות הנוכחי עדיין תומך בכיוון ${t.dir > 0 ? 'לונג' : 'שורט'}. יציאה מוקדמת עלולה לפספס המשך מהלך שהאסטרטגיה מנסה ללכוד.`);
    }
    if (t.target != null && ((t.dir > 0 && price < t.target) || (t.dir < 0 && price > t.target))) {
      reasons.push(`יעד הרווח (${t.target.toFixed(2)}) עדיין לא הושג — המתנה מאפשרת לאסטרטגיה לממש את יחס סיכון/סיכוי שתוכנן.`);
    }
    if (t.stop != null && ((t.dir > 0 && price > t.stop) || (t.dir < 0 && price < t.stop))) {
      reasons.push(`סטופ ההפסד (${t.stop.toFixed(2)}) לא הופעל — ניהול הסיכון המקורי עדיין מגן על הפוזיציה.`);
    }
    if (pnlPct < 0) {
      reasons.push(`הפוזיציה כרגע בהפסד (${pnlPct.toFixed(2)}%). סגירה עכשיו תקבע הפסד; לפי רוב האסטרטגיות עדיף לתת לסטופ/אות היציאה לנהל את העסקה אלא אם השתנו התנאים.`);
    } else {
      reasons.push(`הפוזיציה כרגע ברווח (${pnlPct.toFixed(2)}%). סגירה מוקדמת עשויה להקטין רווח אם המהלך עוד לא הגיע ליעד או לאות יציאה של האסטרטגיה.`);
    }
    return { ok: true, desk, price, pnlPct, contradicts, desired, reasons };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function manualCloseDesk(deskId, reason = 'manual') {
  const desk = store.state.desks.find((d) => d.id === deskId);
  if (!desk || !desk.openTrade) return { ok: false, error: 'אין פוזיציה פתוחה' };
  let price = lastPrice(desk.symbol);
  if (!price) {
    try {
      const candles = await getCandles(desk.symbol, desk.tf, { limit: 5 });
      if (candles.length) price = candles[candles.length - 1].c;
    } catch {}
  }
  if (!price) price = desk.openTrade.entry;
  await closePaperTrade(desk, price, reason);
  store.save(true);
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
  const livePrices = {};
  const pf = ensurePaperPortfolio();
  let tradeChanged = false;

  for (const desk of live) {
    try {
      const candles = await getCandles(desk.symbol, desk.tf, { limit: 320 });
      if (candles.__synthetic) continue;
      const candlePrice = candles[candles.length - 1]?.c;
      const price = candlePrice > 0 ? candlePrice : lastPrice(desk.symbol);
      if (price) livePrices[desk.symbol] = price;
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
        if (hitStop) {
          await closePaperTrade(desk, t.stop, t.trailed ? 'trail' : 'stop');
          tradeChanged = true;
        } else if (hitTarget) {
          await closePaperTrade(desk, t.target, 'target');
          tradeChanged = true;
        } else if (dir !== t.dir) {
          await closePaperTrade(desk, price, 'signal');
          tradeChanged = true;
        } else {
          // Mirror backtest breakeven + ATR trailing stop on live paper trades
          const initDist = t.stopDist || Math.abs(t.entry - t.stop) || a * stopMult;
          t.stopDist = initDist;
          if (t.dir > 0) {
            t.peak = Math.max(t.peak || t.entry, price);
            const gain = t.peak - t.entry;
            if (gain >= initDist * 1.5 && a > 0) {
              const trail = t.peak - Math.max(a * 1.3, initDist * 0.75);
              if (trail > t.stop) { t.stop = trail; t.trailed = true; }
            } else if (gain >= initDist * 1.0) {
              const be = t.entry + initDist * 0.1;
              if (be > t.stop) { t.stop = be; t.trailed = true; }
            }
          } else {
            t.peak = Math.min(t.peak || t.entry, price);
            const gain = t.entry - t.peak;
            if (gain >= initDist * 1.5 && a > 0) {
              const trail = t.peak + Math.max(a * 1.3, initDist * 0.75);
              if (trail < t.stop) { t.stop = trail; t.trailed = true; }
            } else if (gain >= initDist * 1.0) {
              const be = t.entry - initDist * 0.1;
              if (be < t.stop) { t.stop = be; t.trailed = true; }
            }
          }
          const pct = t.dir > 0 ? ((price - t.entry) / t.entry) * 100 : ((t.entry - price) / t.entry) * 100;
          desk.openTrade.markPct = +pct.toFixed(3);
        }
      } else if (dir !== 0 && s.autopilot) {
        const stopDist = stopMult * a;
        const capitalUsdt = Math.min(s.capital || 100000, pf.cash);
        // Per-desk risk wins: a promoted nostro bot trades at its hardened size, not
        // the portfolio-wide default that helped the book evaporate.
        const riskAmount = capitalUsdt * Number(desk.riskPerTrade || s.riskPerTrade || 0.015);
        const stopDistance = Math.abs(price - (dir > 0 ? price - stopDist : price + stopDist));
        const quantity = stopDistance > 0 ? riskAmount / stopDistance : 0;

        let binanceOrderId = null;
        let binanceQuantity = Number(quantity.toFixed(6));
        if (!pf.isActive) pf.activate({ reason: `פתיחת עסקת נייר על ${desk.label}` });

        // ביצוע פקודה בתיק הנייר המשותף (עמלות + מעקב יתרה)
        let buyRes = null;
        if (binanceQuantity > 0 && price > 0) {
          const maxQtyByCash = (pf.cash * 0.25) / price;
          const paperQty = Math.min(binanceQuantity, maxQtyByCash);
          if (paperQty > 0) {
            buyRes = pf.buy({
              symbol: desk.symbol,
              price,
              quantity: paperQty,
              timestamp: Date.now(),
              isTaker: true,
              dir,
              deskId: desk.id,
              reason: 'open_paper',
            });
            binanceQuantity = +paperQty.toFixed(6);
            savePaperPortfolio();
            tradeChanged = true;
          }
        }

        // ביצוע פקודה אמת ב-Binance Testnet אם מוגדרו מפתחות API
        if (binanceClient && binanceClient.apiKey && binanceClient.apiSecret && binanceQuantity > 0) {
          try {
            const side = dir > 0 ? 'BUY' : 'SELL';
            const order = await binanceClient.createMarketOrder({
              symbol: desk.symbol,
              side,
              quantity: Number(binanceQuantity).toFixed(6),
            });
            binanceOrderId = order.orderId || null;
            binanceQuantity = Number(order.executedQty || binanceQuantity);
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
          quantity: binanceQuantity,
          binanceOrderId,
          binanceQuantity,
        };
        savePaperPortfolio();
        store.save(true);
        recordTradeInDb({
          id: buyRes?.trade?.id,
          deskId: desk.id,
          symbol: desk.symbol,
          side: dir > 0 ? 'BUY' : 'SHORT',
          dir,
          price,
          quantity: binanceQuantity,
          fee: buyRes?.trade?.fee || 0,
          reason: 'open_paper',
          at: Date.now(),
        }).catch(() => {});
        pushStateToDatabase(store.state).catch(() => {});
        store.log('info', 'תמר · ביצוע', `${desk.label}: פתיחת פוזיציית נייר ${dir > 0 ? 'לונג' : 'שורט'} ב־${price.toFixed(2)}`);
      }
    } catch (err) {
      console.warn('[firm] live tick failed', desk.id, err);
    }
  }

  if (Object.keys(livePrices).length) {
    pf.recordEquitySnapshot(livePrices);
  }
  if (!store.state.paperPortfolio || tradeChanged || Object.keys(livePrices).length) {
    savePaperPortfolio();
  }
}

/**
 * Risk governor: pauses live bots that bleed and trips a portfolio-wide circuit
 * breaker, so no bot can quietly lose the book again. Also releases desks whose
 * cooldown expired back to optimisation — they must re-earn promotion.
 */
export function enforceLiveRiskControls() {
  ensureDeskFields();
  const state = store.state;
  const pf = ensurePaperPortfolio();
  const now = Date.now();
  const paused = [];

  for (const desk of state.desks.filter((d) => d.status === 'live')) {
    desk.livePnl = Number(desk.livePnl) || 0;
    desk.livePeakPnl = Math.max(Number(desk.livePeakPnl) || 0, desk.livePnl);
    const liveDd = desk.livePeakPnl - desk.livePnl;
    const recent = (desk.liveTrades || []).slice(0, LIVE_RISK.deskVerdictTrades);
    const recentSum = recent.reduce((sum, t) => sum + (Number(t.pct) || 0), 0);
    const winRate = recent.length ? recent.filter((t) => (Number(t.pct) || 0) > 0).length / recent.length : null;
    let reason = null;
    if (liveDd >= LIVE_RISK.deskMaxLossPct) {
      reason = `ירדה ${liveDd.toFixed(1)}% מהשיא החי שלה`;
    } else if (recent.length >= LIVE_RISK.deskVerdictTrades && recentSum < 0 && winRate < LIVE_RISK.deskMinWinRate) {
      reason = `${recent.length} העסקאות האחרונות הפסידו ${recentSum.toFixed(1)}% (${Math.round(winRate * 100)}% הצלחה)`;
    }
    if (!reason) continue;
    desk.status = 'paused';
    desk.pausedAt = now;
    desk.pauseReason = reason;
    desk.openTrade = null;
    paused.push({ id: desk.id, label: desk.label, reason });
    store.log('warn', 'דניאל · סיכונים',
      `${desk.label}: הופסק אוטומטית — ${reason}. לא נפתחות פוזיציות חדשות עד לכיול מחדש ולמעבר חוזר בשערים`);
  }

  // Portfolio-wide breaker: the book first, the tactics later.
  const hist = Array.isArray(pf.equityHistory) ? pf.equityHistory : [];
  const peak = Math.max(Number(pf.initialBalance) || 0, ...hist.map((h) => Number(h.equity) || 0));
  const equity = hist.length ? Number(hist[hist.length - 1].equity) || peak : peak;
  const bookDd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
  if (bookDd >= LIVE_RISK.portfolioMaxDdPct) {
    const liveLeft = state.desks.filter((d) => d.status === 'live');
    for (const desk of liveLeft) {
      desk.status = 'paused';
      desk.pausedAt = now;
      desk.pauseReason = `בלם חירום על התיק (${bookDd.toFixed(1)}% ירידה מהשיא)`;
      desk.openTrade = null;
      paused.push({ id: desk.id, label: desk.label, reason: desk.pauseReason });
    }
    state.settings.emergencyStop = {
      at: now,
      drawdownPct: +bookDd.toFixed(2),
      peak: +peak.toFixed(2),
      equity: +equity.toFixed(2),
    };
    if (liveLeft.length) pf.deactivate({ reason: `בלם חירום — ירידה של ${bookDd.toFixed(1)}% מהשיא` });
    store.log('bad', 'דניאל · סיכונים',
      `בלם חירום: התיק בנייר ירד ${bookDd.toFixed(1)}% מהשיא (${equity.toFixed(0)} מתוך ${peak.toFixed(0)}) — כל ${liveLeft.length} הבוטים החיים הופסקו. הצוות ממשיך לכייל ולחפש, אבל לא פותח פוזיציות`);
  }

  // Cooldown: a paused bot goes back to optimisation and has to pass the ladder again.
  let released = 0;
  for (const desk of state.desks.filter((d) => d.status === 'paused')) {
    const since = Number(desk.pausedAt) || now;
    if (now - since < LIVE_RISK.cooldownMs) continue;
    desk.status = 'optimizing';
    desk.dryRunCycles = 0;
    desk.openTrade = null;
    desk.pausedAt = null;
    desk.livePnl = 0;
    desk.livePeakPnl = 0;
    desk.liveTrades = [];
    released++;
    store.log('info', 'דניאל · סיכונים',
      `${desk.label}: צינון הסתיים (${desk.pauseReason || 'הפסדים'}) — חזרה לכיול; יקודם חזרה רק אם יעבור בקטסט, OOS וביקורת אמת`);
  }
  if (released && !state.desks.some((d) => d.status === 'paused')) delete state.settings.emergencyStop;

  if (paused.length || released) {
    store.save(true);
    store.emit();
    scheduleDatabasePush(1000);
  }
  return { paused, released, bookDrawdownPct: +bookDd.toFixed(2) };
}

function nostroPromotionBlocker(bot) {
  if (!bot || bot.isSynthetic) return 'נתוני דמה';
  if (!bot.strategyId || !STRATEGIES[bot.strategyId]) return 'אסטרטגיה לא מוכרת';
  if (bot.breached) return `נפסל בפירמה (${bot.breached})`;
  if (!(bot.readyFirms || []).length) return 'לא עבר אף חברת פרופ';
  if ((bot.candlesCount || 0) < NOSTRO_LIVE_GATES.minCandles) return 'היסטוריית בדיקה קצרה';
  const m = bot.metrics || {};
  if ((m.trades || 0) < NOSTRO_LIVE_GATES.minTrades) return `מעט מדי עסקאות (${m.trades || 0})`;
  if ((m.profitFactor || 0) < NOSTRO_LIVE_GATES.minProfitFactor) return `profit factor ${m.profitFactor || 0}`;
  if ((m.maxDrawdownPct || 0) > NOSTRO_LIVE_GATES.maxDrawdownPct) return `drawdown ${m.maxDrawdownPct}%`;
  if ((bot.totalReturnPct || 0) < NOSTRO_LIVE_GATES.minReturnPct) return `תשואה ${bot.totalReturnPct || 0}%`;
  return null;
}

/**
 * Our own promotion decision: a nostro bot that proved itself on real data and
 * passed at least one prop firm is moved into the live paper book as its own desk,
 * with hardened per-trade risk and under the risk governor above.
 */
export async function promoteNostroWinnersToLive() {
  ensureDeskFields();
  const state = store.state;
  const bots = state.nostro?.bots || [];
  if (!bots.length) return { promoted: 0 };

  let promoted = 0;
  let liveCount = state.desks.filter((d) => d.status === 'live').length;
  for (const bot of bots) {
    if (promoted >= NOSTRO_LIVE_GATES.maxPerCycle) break;
    if (liveCount >= LIVE_RISK.maxLiveDesks) break;
    const deskId = `nostro_live_${String(bot.id).replace(/[^a-z0-9_]/gi, '_')}`;
    if (state.desks.some((d) => d.id === deskId)) continue;
    const blocker = nostroPromotionBlocker(bot);
    if (blocker) continue;

    const m = bot.metrics || {};
    const isCrypto = String(bot.symbol || '').endsWith('USDT');
    const kind = (bot.tf === '1d' || bot.tf === '1w') ? 'swing' : 'intraday';
    const risk = Number(bot.riskPerTrade) > 0 ? Math.min(0.01, Number(bot.riskPerTrade)) : 0.005;
    const desk = {
      id: deskId,
      label: `${bot.name || bot.id} · מסחר שוטף`,
      short: bot.symbol || bot.id,
      tf: bot.tf || '1h',
      kind,
      symbol: bot.symbol || 'BTCUSDT',
      venue: isCrypto ? 'Binance / Kraken' : 'Yahoo Finance',
      weight: 0.05,
      horizon: kind === 'swing' ? 'סווינג' : 'תוך־יומי',
      mandate: `קודם מהנוסטרו למסחר השוטף אחרי שעבר ${bot.readyFirms.join(', ')} על נתוני אמת: ${m.trades} עסקאות, PF ${m.profitFactor}, DD ${m.maxDrawdownPct}%, תשואה ${bot.totalReturnPct}%. סיכון ${(risk * 100).toFixed(2)}% לעסקה ובלם הפסד חי של ${LIVE_RISK.deskMaxLossPct}%.`,
      strategyId: bot.strategyId,
      params: cloneParams(bot.params),
      lockedStrategy: true,
      source: 'nostro_promotion',
      nostroBotId: bot.id,
      riskPerTrade: risk,
      status: 'live',
      liveSince: Date.now(),
      dryRunCycles: PAPER_TRADING.dryRunCyclesBeforeLive,
      history: [],
      equity: [],
      liveTrades: [],
      livePnl: 0,
      livePeakPnl: 0,
      openTrade: null,
      ideas: [],
      metrics: { ...m },
      createdAt: Date.now(),
    };
    state.desks.push(desk);
    liveCount++;
    promoted++;
    store.log('ok', 'אוריה · CIO',
      `${bot.name}: קודם מהנוסטרו למסחר השוטף — עבר ${bot.readyFirms.join('/')} · ${m.trades} עסקאות · PF ${m.profitFactor} · DD ${m.maxDrawdownPct}% · תשואה ${bot.totalReturnPct}%`);
    store.log('info', 'דניאל · סיכונים',
      `${bot.name}: רץ במסחר השוטף בסיכון ${(risk * 100).toFixed(2)}% לעסקה; ייעצר אוטומטית ב-${LIVE_RISK.deskMaxLossPct}% ירידה מהשיא החי או ב-${LIVE_RISK.deskVerdictTrades} עסקאות מפסידות`);
  }

  if (promoted) {
    store.save(true);
    store.emit();
    scheduleDatabasePush(800);
  }
  return { promoted, liveCount };
}

export async function promoteDryRuns() {
  const pf = ensurePaperPortfolio();
  let promoted = false;

  for (const desk of store.state.desks) {
    if (desk.status !== 'dry-run') continue;

    const gatesOk = passesGates(desk.metrics, gateSettings(desk)).ok;
    const profitableAfterFees = isBacktestProfitableAfterFeesAndTax(desk.metrics);
    const auditOk = !desk.lastAudit?.vetoed && !marketState.synthetic;

    const liveCapReached = store.state.desks.filter((d) => d.status === 'live').length >= LIVE_RISK.maxLiveDesks;
    const emergencyStop = !!store.state.settings?.emergencyStop;
    if (liveCapReached && gatesOk) {
      continue;
    }
    if (emergencyStop) continue;

    if (desk.dryRunCycles >= PAPER_TRADING.dryRunCyclesBeforeLive && gatesOk && profitableAfterFees && auditOk) {
      desk.status = 'live';
      desk.liveSince = Date.now();
      pf.activate({
        reason: `אסטרטגיה ${desk.strategyId} על ${desk.label} הרוויחה ${desk.metrics.returnPct}% בבקטסט אחרי עמלות (מאומת אמיר)`,
      });
      promoted = true;
      store.log('ok', 'אוריה · CIO',
        `${desk.label}: אושרה למסחר דמה על Binance Testnet — ${desk.version} · ${desk.metrics.returnPct}% נטו בבקטסט`);
    } else if (desk.dryRunCycles >= PAPER_TRADING.dryRunCyclesBeforeLive && gatesOk && !auditOk) {
      store.log('warn', 'אמיר · ביקורת אמת',
        `${desk.label}: קידום לנייר חי נחסם — ממתין לאימות נתוני אמת ותנאי ביקורת מחמירים`);
    } else if (desk.dryRunCycles >= PAPER_TRADING.dryRunCyclesBeforeLive && gatesOk && !profitableAfterFees) {
      store.log('warn', 'אוריה · CIO',
        `${desk.label}: עברה גדרות אך אינה רווחית אחרי עמלות ומס — לא תופעל במסחר דמה`);
    }
  }
  if (promoted) {
    savePaperPortfolio();
    scheduleDatabasePush(1000);
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
    if (state.settings.autoOptimize !== false && ((state.stats.cycles || 0) % 3 === 0)) {
      runAiDirector({ useFallback: true }).catch((e) => console.warn('[ai-director]', e));
    }
    const desk = nextDesk(state);
    state.stats.cycles = (state.stats.cycles || 0) + 1;
    state.lastTickAt = Date.now();
    const result = await runDeskCycle(desk, { deep: (state.stats.cycles||0) % 4 === 0 });
    enforceLiveRiskControls();
    await promoteNostroWinnersToLive();
    await tickLive();
    await promoteDryRuns();
    savePaperPortfolio();
    import('./nostro.js').then(({ tickNostroTradingRoom }) => tickNostroTradingRoom()).catch((e) => console.warn('[nostro-room]', e));
    state.truthAudit = auditSystemTruth(state, marketState);
    // עבודה רציפה: מחקר, ניתוח טכני, פונדמנטליסטי, סנטימנט ואופטימיזציה בכל מחזור
    refreshTechnicals({ force: true }).catch((e) => console.warn('[ta]', e));
    refreshFundamentals().catch((e) => console.warn('[fundamentals]', e));
    runAutonomousGannLibraryAuditIfDue().catch((e) => console.warn('[gann-audit]', e));
    runYonatanYouTubeScoutIfDue().then((res) => {
      if (res?.ok && res.report?.blueprints?.length) {
        const existingYtBots = (store.state.desks || []).filter((d) => d.source === 'youtube_scout');
        if (existingYtBots.length < 3) {
          const nextBp = res.report.blueprints.find((bp) => !(store.state.desks || []).some((d) => d.id === bp.deskId));
          if (nextBp) {
            spawnDedicatedStrategyBot(nextBp, { runNow: false }).catch(() => {});
          }
        }
      }
    }).catch((e) => console.warn('[youtube-scout]', e));
    scanIfDue().catch((e) => console.warn('[research]', e));
    refreshSentiment().catch((e) => console.warn('[sentiment]', e));
    store.save(true);
    store.emit();
    scheduleDatabasePush(1000);
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

/**
 * Spawns (or retrieves) a DEDICATED bot desk for a YouTube Strategy Blueprint (e.g. Doug & Silvia Rumer,
 * W.D. Gann Sq9, Michael Jenkins, TradingLab) locked to its target strategy so it iterates through
 * real OHLCV Backtest -> Walk-Forward OOS -> Amir Truth Audit -> Dry-Run -> Live Paper Deployment.
 */
export async function spawnDedicatedStrategyBot(blueprint, { runNow = true, deep = true } = {}) {
  if (!blueprint || !blueprint.deskId) throw new Error('בלופרינט אסטרטגיה לא תקין');
  const state = store.state;
  ensureDeskFields();

  const stratId = STRATEGIES[blueprint.strategyId] ? blueprint.strategyId : 'structure_pullback';
  const symbol = blueprint.symbol || 'BTCUSDT';
  const tf = blueprint.tf || '1h';
  const isCrypto = symbol.endsWith('USDT');

  let desk = state.desks.find((d) => d.id === blueprint.deskId);
  if (!desk) {
    desk = {
      id: blueprint.deskId,
      label: blueprint.label || `בוט ייעודי · ${blueprint.creator || 'YouTube'} (${symbol} ${tf})`,
      short: symbol,
      tf,
      kind: (tf === '1d' || tf === '1w') ? 'swing' : 'intraday',
      symbol,
      venue: isCrypto ? 'Binance / Kraken' : 'Yahoo Finance',
      weight: 0.08,
      horizon: (tf === '1d' || tf === '1w') ? 'סווינג' : 'תוך־יומי',
      mandate: `בוט ייעודי ממחקר YouTube (${blueprint.creator || 'Creator'}): ${blueprint.techniqueHe || stratId}. רץ עד הוכחת רווחיות אחרי עמלות ומס ואימות אמיר.`,
      strategyId: stratId,
      lockedStrategy: true,
      source: 'youtube_scout',
      creator: blueprint.creator || '',
      videoTitle: blueprint.videoTitle || '',
      videoUrl: blueprint.videoUrl || '',
      techniqueHe: blueprint.techniqueHe || '',
      status: 'optimizing',
      history: [],
      equity: [],
      liveTrades: [],
      dryRunCycles: 0,
      openTrade: null,
      ideas: [],
      createdAt: Date.now(),
    };
    state.desks.push(desk);
    store.log('ok', 'יונתן · בוט ייעודי', `הוקם בוט ייעודי חדש: ${desk.label} (${STRATEGIES[stratId].label}) — מקור: ${blueprint.creator}`);
  } else {
    desk.strategyId = stratId;
    desk.lockedStrategy = true;
    desk.videoUrl = blueprint.videoUrl || desk.videoUrl;
    desk.videoTitle = blueprint.videoTitle || desk.videoTitle;
  }

  store.save(true);
  store.emit();

  if (!runNow) {
    scheduleDatabasePush(1000);
    return { ok: true, desk, ran: false };
  }

  setAgent('yt_strategy_scout', {
    status: 'busy',
    task: `מריץ הוכחת רווחיות לבוט הייעודי · ${desk.label}`,
    speech: `בוחן את אסטרטגיית ${blueprint.creator || 'YouTube'} בבוט ייעודי על נתוני אמת (${symbol} ${tf})!`,
    progress: 50,
  });
  const res = await runDeskCycle(desk, { focus: true, deep });
  await promoteDryRuns();
  savePaperPortfolio();
  setAgent('yt_strategy_scout', {
    status: 'idle',
    progress: 100,
    task: `הבוט ${desk.label}: ${desk.status === 'live' ? 'אושר ויושם!' : desk.status === 'dry-run' ? 'עבר ל-Dry-Run מאומת!' : 'ממשיך אופטימיזציה'}`,
  });
  store.save(true);
  store.emit();
  scheduleDatabasePush(800);
  return { ok: true, desk, ran: true, result: res };
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
