// Quant Volatility Stack Trading System (HAR Volatility + Student-t Valuation Engine)
// Inspired by Quantitative Realized Volatility modeling (Corsi HAR-RV) and fat-tailed Student-t option/binary valuation.
//
// 1. HAR Volatility: ln(v_tau) = beta_0 + beta_1 * ln(RV_1) + beta_5 * ln(RV_5) + beta_15 * ln(RV_15)
// 2. Student-t Valuation: p_Up = 1 - T_nu[ (ln(K / S) - mu_tau) / s_tau ]
// 3. Statistical Edge Arbitrage: Edge = Modeled_Probability - Market_Cost

/**
 * Log Gamma function via Lanczos approximation.
 */
function logGamma(z) {
  const p = [
    676.5203681287,
    -1259.1392167224,
    771.32342877765,
    -176.61502916214,
    12.507343278687,
    -0.13857109526572,
    9.9843695780196e-6,
    1.5056327351493e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = 0.9999999999998099;
  for (let i = 0; i < p.length; i++) x += p[i] / (z + i + 1);
  const t = z + p.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * Regularized Incomplete Beta function I_x(a, b) via continued fraction (Betacf).
 */
function betacf(a, b, x) {
  const maxIt = 100;
  const eps = 3e-10;
  let qab = a + b;
  let qap = a + 1;
  let qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= maxIt; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    h *= d * c;

    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < eps) break;
  }
  return h;
}

export function regularizedIncompleteBeta(x, a, b) {
  if (x < 0 || x > 1) return x < 0 ? 0 : 1;
  if (x === 0) return 0;
  if (x === 1) return 1;

  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betacf(a, b, x)) / a;
  }
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/**
 * Cumulative Distribution Function (CDF) of Student-t distribution with nu degrees of freedom.
 */
export function studentTCdf(t, nu = 5) {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  const x = nu / (nu + t * t);
  const ib = regularizedIncompleteBeta(x, nu / 2, 0.5);
  if (t >= 0) {
    return 1 - 0.5 * ib;
  }
  return 0.5 * ib;
}

/**
 * Compute realized variance (RV) over the last N periods of candle closes.
 * RV = sum(ln(P_t / P_{t-1})^2)
 */
export function computeRealizedVariance(candles, windowBars = 15) {
  if (!candles || candles.length < 3) return 0.0001;
  const closes = candles.map((c) => (typeof c === 'number' ? c : c.close ?? c.c)).filter(Number.isFinite);
  if (closes.length < 3) return 0.0001;

  const slice = closes.slice(-Math.max(3, windowBars + 1));
  let sumSq = 0;
  let count = 0;
  for (let i = 1; i < slice.length; i++) {
    const r = Math.log(slice[i] / slice[i - 1]);
    sumSq += r * r;
    count += 1;
  }
  return count > 0 ? Math.max(1e-9, sumSq / count) : 0.0001;
}

/**
 * HAR-RV Volatility Forecaster.
 * ln(v_tau) = beta_0 + beta_1 * ln(RV_1) + beta_5 * ln(RV_5) + beta_15 * ln(RV_15)
 */
export function harVolatilityForecast(rv1, rv5, rv15, {
  beta0 = -0.38,
  beta1 = 0.42,
  beta5 = 0.36,
  beta15 = 0.22,
  tauMultiplier = 1.0,
} = {}) {
  const eps = 1e-11;
  const lRv1 = Math.log(Math.max(eps, rv1));
  const lRv5 = Math.log(Math.max(eps, rv5));
  const lRv15 = Math.log(Math.max(eps, rv15));

  const logV = beta0 + beta1 * lRv1 + beta5 * lRv5 + beta15 * lRv15;
  const vTau = Math.max(1e-8, Math.exp(logV) * Math.max(0.1, tauMultiplier));
  const sTau = Math.sqrt(vTau); // scale parameter for Student-t

  return {
    logVariance: logV,
    variance: vTau,
    scaleParam: sTau,
    annualizedVolPct: Math.round(sTau * Math.sqrt(365 * 24) * 100 * 10) / 10,
  };
}

/**
 * Student-t Directional Valuation & Statistical Edge Calculator.
 * Estimates probability of price closing above reference level K at settlement horizon tau.
 *
 * S = current price
 * K = reference level / barrier
 * mu_tau = expected drift
 * s_tau = scale from HAR-RV
 * nu = degrees of freedom
 */
export function evaluateQuantVolatilityEdge({
  currentPrice,
  referencePrice = currentPrice,
  candles = [],
  marketUpCost = 0.50, // implied market price (e.g. 50c)
  minEdge = 0.04, // 4c modeled edge threshold
  driftBars = 10,
  nu = 5,
  tauMultiplier = 1.0,
} = {}) {
  const S = Number(currentPrice) || 1;
  const K = Number(referencePrice) || S;

  // Realized variances across 1, 5, 15 periods
  const rv1 = computeRealizedVariance(candles, 2);
  const rv5 = computeRealizedVariance(candles, 6);
  const rv15 = computeRealizedVariance(candles, 16);

  const har = harVolatilityForecast(rv1, rv5, rv15, { tauMultiplier });
  const sTau = Math.max(1e-5, har.scaleParam);

  // Compute expected drift mu_tau from short-term momentum
  let muTau = 0;
  if (candles && candles.length >= driftBars) {
    const closes = candles.map((c) => (typeof c === 'number' ? c : c.close ?? c.c)).filter(Number.isFinite);
    if (closes.length >= driftBars) {
      const past = closes[closes.length - driftBars];
      const recent = closes[closes.length - 1];
      muTau = (Math.log(recent / past) / driftBars) * Math.sqrt(tauMultiplier);
    }
  }

  // Student-t standardized distance to barrier K
  // z = (ln(K / S) - mu_tau) / s_tau
  const logGap = Math.log(Math.max(1e-8, K / S));
  const z = (logGap - muTau) / sTau;

  // p_Up = 1 - T_nu(z)
  const cdfK = studentTCdf(z, nu);
  const pUp = Math.max(0.01, Math.min(0.99, 1 - cdfK));
  const pDown = 1 - pUp;

  // Modeled Statistical Edge
  const costUp = Math.max(0.01, Math.min(0.99, Number(marketUpCost) || 0.50));
  const costDown = 1 - costUp;

  const edgeUp = pUp - costUp;
  const edgeDown = pDown - costDown;

  const hasUpEdge = edgeUp >= minEdge;
  const hasDownEdge = edgeDown >= minEdge;

  let recommendation = 'HOLD';
  let recommendedDir = 0;
  let activeEdge = 0;
  let expectedValue = 0;

  if (hasUpEdge && edgeUp > edgeDown) {
    recommendation = 'BUY_UP';
    recommendedDir = 1;
    activeEdge = edgeUp;
    expectedValue = pUp * (1 - costUp) - (1 - pUp) * costUp;
  } else if (hasDownEdge && edgeDown > edgeUp) {
    recommendation = 'BUY_DOWN';
    recommendedDir = -1;
    activeEdge = edgeDown;
    expectedValue = pDown * (1 - costDown) - (1 - pDown) * costDown;
  }

  return {
    currentPrice: S,
    referencePrice: K,
    distancePct: Math.round(((S - K) / K) * 10000) / 100,
    har,
    muTau: Math.round(muTau * 100000) / 100000,
    zScore: Math.round(z * 1000) / 1000,
    degreesOfFreedom: nu,
    pUp: Math.round(pUp * 1000) / 1000,
    pDown: Math.round(pDown * 1000) / 1000,
    costUp: Math.round(costUp * 1000) / 1000,
    costDown: Math.round(costDown * 1000) / 1000,
    edgeUp: Math.round(edgeUp * 1000) / 1000,
    edgeDown: Math.round(edgeDown * 1000) / 1000,
    hasEdge: hasUpEdge || hasDownEdge,
    activeEdge: Math.round(activeEdge * 1000) / 1000,
    expectedValue: Math.round(expectedValue * 1000) / 1000,
    recommendation,
    recommendedDir,
    modelName: 'Quant Volatility Stack (HAR-RV + Student-t Valuation)',
  };
}

/**
 * Signal generation function for Alta Capital Strategy integration.
 */
export function quantVolatilitySignal(candles, params = {}) {
  if (!candles || candles.length < 20) return { dir: 0, reason: 'insufficient_candles' };
  const lastCandle = candles[candles.length - 1];
  const currentClose = lastCandle.close ?? lastCandle.c;
  const lookback = Math.max(3, Math.round(params.lookback || 14));
  const refIndex = Math.max(0, candles.length - lookback);
  const refCandle = candles[refIndex];
  const refPrice = refCandle.close ?? refCandle.c;

  const edgeObj = evaluateQuantVolatilityEdge({
    currentPrice: currentClose,
    referencePrice: refPrice,
    candles,
    minEdge: params.minEdge || 0.045,
    nu: params.nu || 5,
    tauMultiplier: params.tauMultiplier || 1.2,
  });

  return {
    dir: edgeObj.recommendedDir,
    score: edgeObj.activeEdge * 100,
    reason: edgeObj.hasEdge
      ? `Quant Volatility Stack Edge: ${edgeObj.recommendation} (Edge ${(edgeObj.activeEdge * 100).toFixed(1)}%, pUp ${(edgeObj.pUp * 100).toFixed(1)}%)`
      : 'no_edge',
    edge: edgeObj,
  };
}
