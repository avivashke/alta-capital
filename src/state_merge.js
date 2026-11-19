// Cross-device, conflict-free state merging for Alta Capital.
// Pure ES module shared by browser, Netlify functions, local Base Server, and GitHub Actions runner.
// Guarantees monotonic progress: an empty/fresh device can NEVER reset total balance or wipe history.

function toTs(val) {
  if (!val) return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  const parsed = Date.parse(val);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clone(obj) {
  if (obj == null) return obj;
  return JSON.parse(JSON.stringify(obj));
}

function tradeKey(t) {
  if (!t || typeof t !== 'object') return '';
  if (t.id) return String(t.id);
  return [
    t.timestamp || t.at || 0,
    t.symbol || '',
    t.side || t.dir || '',
    Number(t.price || t.exit || t.entry || 0).toFixed(6),
    Number(t.quantity || 0).toFixed(6),
  ].join('|');
}

function deskTradeKey(t) {
  if (!t || typeof t !== 'object') return '';
  return [
    t.at || 0,
    t.dir || 0,
    Number(t.entry || 0).toFixed(4),
    Number(t.exit || 0).toFixed(4),
    t.reason || '',
  ].join('|');
}

export function portfolioActivityScore(pf) {
  if (!pf || typeof pf !== 'object') return 0;
  const tradeCount = Math.max(
    Number(pf.totalTradesCount) || 0,
    Array.isArray(pf.trades) ? pf.trades.length : 0,
  );
  const openPositions = pf.positions && typeof pf.positions === 'object'
    ? Object.keys(pf.positions).length
    : 0;
  const initial = Number(pf.initialBalance) || 100000;
  const cash = Number.isFinite(Number(pf.cash)) ? Number(pf.cash) : initial;
  const cashMoved = Math.abs(cash - initial) > 0.01 ? 1 : 0;
  const taxMoved = (Number(pf.taxAccumulated) || 0) > 0 ? 1 : 0;
  const eqPts = Array.isArray(pf.equityHistory) ? pf.equityHistory.length : 0;
  return tradeCount * 1000 + openPositions * 100 + cashMoved * 50 + taxMoved * 25 + Math.min(eqPts, 50) + (pf.isActive ? 5 : 0);
}

export function mergePaperPortfolios(basePf, incPf) {
  if (!basePf && !incPf) return null;
  if (!basePf) return clone(incPf);
  if (!incPf) return clone(basePf);

  const baseScore = portfolioActivityScore(basePf);
  const incScore = portfolioActivityScore(incPf);
  const baseTrades = Math.max(Number(basePf.totalTradesCount) || 0, Array.isArray(basePf.trades) ? basePf.trades.length : 0);
  const incTrades = Math.max(Number(incPf.totalTradesCount) || 0, Array.isArray(incPf.trades) ? incPf.trades.length : 0);
  const baseTs = toTs(basePf.updatedAt) || (basePf.trades?.[basePf.trades.length - 1]?.timestamp || 0);
  const incTs = toTs(incPf.updatedAt) || (incPf.trades?.[incPf.trades.length - 1]?.timestamp || 0);

  // Never let an untouched fresh portfolio (score <= 5, 0 trades) overwrite one with real activity
  let winner = basePf;
  if (incTrades > baseTrades) {
    winner = incPf;
  } else if (incTrades < baseTrades) {
    winner = basePf;
  } else if (incScore > baseScore && baseScore <= 5) {
    winner = incPf;
  } else if (baseScore > incScore && incScore <= 5) {
    winner = basePf;
  } else if (incTs > baseTs) {
    winner = incPf;
  } else if (baseTs > incTs) {
    winner = basePf;
  } else if (incScore >= baseScore) {
    winner = incPf;
  }

  // Merge full trade history (deduplicated, chronological)
  const tradeMap = new Map();
  for (const list of [basePf.trades || [], incPf.trades || []]) {
    for (const t of list) {
      const k = tradeKey(t);
      if (k && !tradeMap.has(k)) tradeMap.set(k, clone(t));
    }
  }
  const mergedTrades = [...tradeMap.values()]
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    .slice(-500);

  // Merge equity history snapshots (deduplicated by timestamp)
  const eqMap = new Map();
  for (const list of [basePf.equityHistory || [], incPf.equityHistory || []]) {
    for (const pt of list) {
      if (!pt || typeof pt !== 'object') continue;
      const t = Number(pt.t) || 0;
      if (!t) continue;
      eqMap.set(t, clone(pt));
    }
  }
  const mergedEqHistory = [...eqMap.values()]
    .sort((a, b) => a.t - b.t)
    .slice(-300);

  const out = clone(winner);
  out.trades = mergedTrades;
  out.totalTradesCount = Math.max(baseTrades, incTrades, mergedTrades.length);
  out.totalFeesAccumulated = Math.max(
    Number(basePf.totalFeesAccumulated) || 0,
    Number(incPf.totalFeesAccumulated) || 0,
    mergedTrades.reduce((s, t) => s + (Number(t.fee) || 0), 0),
  );
  out.equityHistory = mergedEqHistory;
  out.isActive = !!(basePf.isActive || incPf.isActive);
  out.updatedAt = new Date(Math.max(baseTs, incTs, Date.now())).toISOString();
  return out;
}

function deskProgressScore(d) {
  if (!d) return 0;
  const hist = Array.isArray(d.history) ? d.history.length : 0;
  const live = Array.isArray(d.liveTrades) ? d.liveTrades.length : 0;
  const statusWeight = d.status === 'live' ? 30 : d.status === 'dry-run' ? 20 : d.status === 'optimizing' ? 10 : 0;
  return hist * 100 + live * 80 + (d.version ? 50 : 0) + statusWeight + (d.dryRunCycles || 0) * 5;
}

export function mergeDesks(baseDesks = [], incDesks = []) {
  if (!baseDesks?.length) return clone(incDesks || []);
  if (!incDesks?.length) return clone(baseDesks || []);

  const byId = new Map();
  const order = [];
  for (const d of baseDesks) {
    if (!d?.id) continue;
    byId.set(d.id, { base: d, inc: null });
    order.push(d.id);
  }
  for (const d of incDesks) {
    if (!d?.id) continue;
    if (byId.has(d.id)) byId.get(d.id).inc = d;
    else {
      byId.set(d.id, { base: null, inc: d });
      order.push(d.id);
    }
  }

  return order.map((id) => {
    const { base, inc } = byId.get(id);
    if (!base) return clone(inc);
    if (!inc) return clone(base);

    const baseRun = toTs(base.lastRunAt);
    const incRun = toTs(inc.lastRunAt);
    const baseScore = deskProgressScore(base);
    const incScore = deskProgressScore(inc);

    // Prefer whichever side has more accumulated progress; break ties by lastRunAt
    let primary = base;
    let secondary = inc;
    if (incScore > baseScore && incRun >= baseRun) {
      primary = inc;
      secondary = base;
    } else if (baseScore > incScore && baseRun >= incRun) {
      primary = base;
      secondary = inc;
    } else if (incRun > baseRun) {
      // Do not allow an uninitialized desk (score 0) to overwrite a populated desk
      if (incScore > 0 || baseScore === 0) {
        primary = inc;
        secondary = base;
      }
    } else if (incScore > baseScore) {
      primary = inc;
      secondary = base;
    }

    const merged = clone(primary);

    // Union version history
    const histMap = new Map();
    for (const h of [...(primary.history || []), ...(secondary.history || [])]) {
      if (!h) continue;
      const k = `${h.version || ''}|${h.at || 0}`;
      if (!histMap.has(k)) histMap.set(k, clone(h));
    }
    merged.history = [...histMap.values()]
      .sort((a, b) => (b.at || 0) - (a.at || 0))
      .slice(0, 60);

    // Union liveTrades
    const ltMap = new Map();
    for (const t of [...(primary.liveTrades || []), ...(secondary.liveTrades || [])]) {
      const k = deskTradeKey(t);
      if (k && !ltMap.has(k)) ltMap.set(k, clone(t));
    }
    merged.liveTrades = [...ltMap.values()]
      .sort((a, b) => (b.at || 0) - (a.at || 0))
      .slice(0, 100);

    // Preserve non-empty generatedCode / technical if primary lost it
    if (!merged.generatedCode && secondary.generatedCode) merged.generatedCode = secondary.generatedCode;
    if (!merged.technical && secondary.technical) merged.technical = clone(secondary.technical);
    if (merged.liveTrades.length > (primary.liveTrades?.length || 0)) {
      merged.livePnl = +merged.liveTrades.reduce((s, t) => s + (Number(t.pct) || 0), 0).toFixed(3);
    }
    merged.lastRunAt = Math.max(baseRun, incRun) || null;
    return merged;
  });
}

function mergeEvents(baseEvents = [], incEvents = []) {
  const map = new Map();
  for (const list of [baseEvents || [], incEvents || []]) {
    for (const e of list) {
      if (!e || typeof e !== 'object') continue;
      const k = `${e.at || 0}|${e.actor || ''}|${(e.text || '').slice(0, 80)}`;
      if (!map.has(k)) map.set(k, clone(e));
    }
  }
  return [...map.values()]
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, 350);
}

function mergeIdeas(baseIdeas = [], incIdeas = []) {
  const map = new Map();
  for (const list of [baseIdeas || [], incIdeas || []]) {
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const k = item.id || item.title || JSON.stringify(item).slice(0, 80);
      const existing = map.get(k);
      if (!existing || (item.tested && !existing.tested)) {
        map.set(k, clone(item));
      }
    }
  }
  return [...map.values()].slice(0, 150);
}

function mergeKnowledge(baseK = {}, incK = {}) {
  const mergeArr = (a = [], b = []) => {
    const map = new Map();
    for (const item of [...a, ...b]) {
      if (item == null) continue;
      const k = typeof item === 'string' ? item : (item.id || item.title || item.name || JSON.stringify(item).slice(0, 100));
      if (!map.has(k)) map.set(k, clone(item));
    }
    return [...map.values()].slice(-200);
  };
  return {
    strategies: mergeArr(baseK?.strategies, incK?.strategies),
    lessons: mergeArr(baseK?.lessons, incK?.lessons),
    facts: mergeArr(baseK?.facts, incK?.facts),
  };
}

function pickFresherRicher(baseObj, incObj, richnessFn = null) {
  if (!baseObj && !incObj) return null;
  if (!baseObj) return clone(incObj);
  if (!incObj) return clone(baseObj);
  if (richnessFn) {
    const br = richnessFn(baseObj);
    const ir = richnessFn(incObj);
    if (br > 0 && ir === 0) return clone(baseObj);
    if (ir > 0 && br === 0) return clone(incObj);
  }
  const bt = toTs(baseObj.updatedAt || baseObj.at || baseObj.lastAuditAt);
  const it = toTs(incObj.updatedAt || incObj.at || incObj.lastAuditAt);
  return it >= bt ? clone(incObj) : clone(baseObj);
}

export function stateProgressScore(state) {
  if (!state || typeof state !== 'object') return 0;
  const cycles = Number(state.stats?.cycles) || 0;
  const backtests = Number(state.stats?.backtests) || 0;
  const deployments = Number(state.stats?.deployments) || 0;
  const pfScore = portfolioActivityScore(state.paperPortfolio);
  const deskHist = (state.desks || []).reduce((s, d) => s + (d.history?.length || 0) + (d.liveTrades?.length || 0), 0);
  const rev = Number(state.stateRevision) || 0;
  return pfScore * 10 + cycles * 50 + deployments * 100 + deskHist * 40 + Math.min(backtests, 100000) * 0.01 + rev;
}

export function isStateFreshEmpty(state) {
  if (!state || typeof state !== 'object') return true;
  const cycles = Number(state.stats?.cycles) || 0;
  const deployments = Number(state.stats?.deployments) || 0;
  const pfScore = portfolioActivityScore(state.paperPortfolio);
  const deskHist = (state.desks || []).reduce((s, d) => s + (d.history?.length || 0) + (d.liveTrades?.length || 0), 0);
  return cycles === 0 && deployments === 0 && pfScore <= 5 && deskHist === 0;
}

export function mergeFirmStates(base, incoming, { forceReset = false, bumpRevision = false } = {}) {
  if (forceReset && incoming) {
    const out = clone(incoming);
    out.stateRevision = Math.max(Number(base?.stateRevision) || 0, Number(incoming.stateRevision) || 0) + 1;
    out.updatedAt = new Date().toISOString();
    return out;
  }
  if (!base && !incoming) return null;
  if (!base) {
    const out = clone(incoming);
    if (bumpRevision) out.stateRevision = (Number(out.stateRevision) || 0) + 1;
    return out;
  }
  if (!incoming) return clone(base);

  const baseTs = toTs(base.updatedAt) || toTs(base.lastTickAt);
  const incTs = toTs(incoming.updatedAt) || toTs(incoming.lastTickAt);
  const baseRev = Number(base.stateRevision) || 0;
  const incRev = Number(incoming.stateRevision) || 0;

  // Start from whichever shell is fresher, but merge every stateful subsystem non-destructively
  const shell = incTs >= baseTs ? clone(incoming) : clone(base);

  // Monotonic stats
  const bs = base.stats || {};
  const is = incoming.stats || {};
  const startedCandidates = [bs.startedAt, is.startedAt].filter((v) => Number.isFinite(Number(v)) && Number(v) > 0).map(Number);
  shell.stats = {
    ...bs,
    ...is,
    cycles: Math.max(Number(bs.cycles) || 0, Number(is.cycles) || 0),
    backtests: Math.max(Number(bs.backtests) || 0, Number(is.backtests) || 0),
    deployments: Math.max(Number(bs.deployments) || 0, Number(is.deployments) || 0),
    scans: Math.max(Number(bs.scans) || 0, Number(is.scans) || 0),
    startedAt: startedCandidates.length ? Math.min(...startedCandidates) : Date.now(),
  };

  shell.desks = mergeDesks(base.desks, incoming.desks);
  shell.paperPortfolio = mergePaperPortfolios(base.paperPortfolio, incoming.paperPortfolio);
  shell.events = mergeEvents(base.events, incoming.events);
  shell.ideas = mergeIdeas(base.ideas, incoming.ideas);
  shell.knowledge = mergeKnowledge(base.knowledge, incoming.knowledge);

  const nostro = pickFresherRicher(base.nostro, incoming.nostro, (n) => (n.bots?.length || 0));
  if (nostro) shell.nostro = nostro;
  const gann = pickFresherRicher(base.gannLibrary, incoming.gannLibrary, (g) => (g.items?.length || g.entries?.length || g.events?.length || 0));
  if (gann) shell.gannLibrary = gann;
  const gannCfg = pickFresherRicher(base.gannConfig, incoming.gannConfig);
  if (gannCfg) shell.gannConfig = gannCfg;
  const fund = pickFresherRicher(base.fundamentals, incoming.fundamentals, (f) => Object.keys(f.assets || {}).length);
  if (fund) shell.fundamentals = fund;
  const scout = pickFresherRicher(base.githubScout, incoming.githubScout, (g) => (g.repos?.length || 0));
  if (scout) shell.githubScout = scout;
  const sent = pickFresherRicher(base.sentiment, incoming.sentiment, (s) => (s.headlines?.length || 0));
  if (sent) shell.sentiment = sent;
  shell.budget = pickFresherRicher(base.budget, incoming.budget) || shell.budget || {};

  // Keep richer agent completed counters
  if (Array.isArray(base.agents) && Array.isArray(incoming.agents)) {
    const incById = new Map(incoming.agents.map((a) => [a.id, a]));
    const baseById = new Map(base.agents.map((a) => [a.id, a]));
    const allIds = [...new Set([...base.agents.map((a) => a.id), ...incoming.agents.map((a) => a.id)])];
    shell.agents = allIds.map((id) => {
      const ba = baseById.get(id);
      const ia = incById.get(id);
      if (!ba) return clone(ia);
      if (!ia) return clone(ba);
      const pick = (ia.lastActive || 0) >= (ba.lastActive || 0) ? clone(ia) : clone(ba);
      pick.completed = Math.max(Number(ba.completed) || 0, Number(ia.completed) || 0);
      return pick;
    });
  }

  const maxRev = Math.max(baseRev, incRev);
  shell.stateRevision = bumpRevision ? maxRev + 1 : maxRev;
  shell.lastTickAt = Math.max(toTs(base.lastTickAt), toTs(incoming.lastTickAt)) || null;
  const maxUpdatedTs = Math.max(baseTs, incTs, Date.now());
  shell.updatedAt = new Date(bumpRevision ? maxUpdatedTs : Math.max(baseTs, incTs) || Date.now()).toISOString();

  return shell;
}

export function remoteHasMoreOrNewerData(local, remote) {
  if (!remote || typeof remote !== 'object') return false;
  if (!local || typeof local !== 'object') return true;
  if (isStateFreshEmpty(local) && !isStateFreshEmpty(remote)) return true;

  const localRev = Number(local.stateRevision) || 0;
  const remoteRev = Number(remote.stateRevision) || 0;
  if (remoteRev > localRev) return true;

  const localTrades = Math.max(
    Number(local.paperPortfolio?.totalTradesCount) || 0,
    local.paperPortfolio?.trades?.length || 0,
  );
  const remoteTrades = Math.max(
    Number(remote.paperPortfolio?.totalTradesCount) || 0,
    remote.paperPortfolio?.trades?.length || 0,
  );
  if (remoteTrades > localTrades) return true;

  const localCycles = Number(local.stats?.cycles) || 0;
  const remoteCycles = Number(remote.stats?.cycles) || 0;
  if (remoteCycles > localCycles) return true;

  const localDeploy = Number(local.stats?.deployments) || 0;
  const remoteDeploy = Number(remote.stats?.deployments) || 0;
  if (remoteDeploy > localDeploy) return true;

  if (!local.paperPortfolio && remote.paperPortfolio) return true;
  if (portfolioActivityScore(remote.paperPortfolio) > portfolioActivityScore(local.paperPortfolio)) return true;

  const remoteTs = toTs(remote.updatedAt);
  const localTs = toTs(local.remote?.updatedAt) || toTs(local.updatedAt) || toTs(local.lastTickAt);
  return remoteTs > localTs;
}
