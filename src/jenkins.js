// Michael S. Jenkins — Time-Price Geometry & Gann Research Engine
// Implements:
// 1. "The Past as the Foundation of the Future" (Points A, B, C, 45° wave angles, horizontal extremes, time-price vertical intersections)
// 2. Square Root Calculator (SquareRoots.exe / SquareRootPrices.wmv: (sqrt(P) +/- deg/360)^2)
// 3. Master Time Calculator (MasterCalculator.exe / MasterTimeCalculator.wmv: Natural squares, price-time square outs, range squaring)

/**
 * Standard Jenkins Square Root Harmonics.
 * deg / 360 gives the square root delta:
 * 45° -> 0.125, 90° -> 0.25, 180° -> 0.50, 270° -> 0.75, 360° -> 1.00, 720° -> 2.00
 */
export const JENKINS_HARMONIC_ANGLES = [45, 90, 135, 180, 225, 270, 315, 360, 450, 540, 720];

/**
 * Calculate Jenkins Square Root Price Targets from a key high or low.
 * Formula: P_target = (sqrt(P_base) +/- (deg / 360))^2
 */
export function jenkinsSquareRootTargets(basePrice, { degrees = JENKINS_HARMONIC_ANGLES, mode = 'both' } = {}) {
  const p = Number(basePrice);
  if (!p || p <= 0) return { basePrice: p, upLevels: [], downLevels: [] };

  const sqrtP = Math.sqrt(p);
  const upLevels = [];
  const downLevels = [];

  for (const deg of degrees) {
    const delta = deg / 360;
    // Upward expansion
    if (mode === 'both' || mode === 'up' || mode === 'long') {
      const pUp = Math.round(Math.pow(sqrtP + delta, 2) * 100) / 100;
      upLevels.push({
        degree: deg,
        delta,
        price: pUp,
        changePct: Math.round(((pUp - p) / p) * 10000) / 100,
        label: `SqRoot +${deg}° (${pUp})`,
      });
    }
    // Downward expansion
    if (mode === 'both' || mode === 'down' || mode === 'short') {
      const rootDown = sqrtP - delta;
      if (rootDown > 0) {
        const pDown = Math.round(Math.pow(rootDown, 2) * 100) / 100;
        downLevels.push({
          degree: deg,
          delta,
          price: pDown,
          changePct: Math.round(((pDown - p) / p) * 10000) / 100,
          label: `SqRoot -${deg}° (${pDown})`,
        });
      }
    }
  }

  return {
    basePrice: p,
    sqrtBase: Math.round(sqrtP * 1000) / 1000,
    upLevels,
    downLevels,
  };
}

/**
 * Jenkins Master Time Calculator: Price-Time Square Outs & Natural Square Cycles.
 * High at price P squares out every P bars/hours/days.
 * Natural squares: 4, 9, 16, 25, 36, 49, 64, 81, 100, 144, 169, 225, 256, 360, 400.
 */
export function jenkinsMasterTimeCycles({
  originPrice,
  originTime,
  rangePrice = 0,
  barDurationMs = 3600 * 1000,
  maxCycles = 12,
} = {}) {
  const p = Number(originPrice) || 100;
  const t0 = Number(originTime) || Date.now();
  const naturalSquares = [4, 9, 16, 25, 36, 49, 64, 81, 100, 121, 144, 169, 196, 225, 256, 360, 400];

  // 1. Natural Square Projections
  const squareDates = naturalSquares.slice(0, maxCycles).map((sq) => ({
    type: 'natural_square',
    bars: sq,
    timestamp: t0 + sq * barDurationMs,
    dateIso: new Date(t0 + sq * barDurationMs).toISOString().slice(0, 10),
    label: `Natural Sq ${sq} (${Math.round(Math.sqrt(sq))}²)`,
  }));

  // 2. Price Square-Outs (Price converted into Time bars)
  const priceHarmonics = [0.25, 0.5, 1.0, 1.5, 2.0];
  const priceSquareOuts = priceHarmonics.map((h) => {
    const bars = Math.round(p * h);
    return {
      type: 'price_square_out',
      multiplier: h,
      bars,
      timestamp: t0 + bars * barDurationMs,
      dateIso: new Date(t0 + bars * barDurationMs).toISOString().slice(0, 10),
      label: `Price Square-Out ${h}x (${bars} bars)`,
    };
  });

  // 3. Range Square-Outs (if high-low range provided)
  const rangeSquareOuts = [];
  if (rangePrice > 0) {
    [0.5, 1.0, 1.618, 2.0].forEach((m) => {
      const bars = Math.round(rangePrice * m);
      rangeSquareOuts.push({
        type: 'range_square_out',
        multiplier: m,
        bars,
        timestamp: t0 + bars * barDurationMs,
        dateIso: new Date(t0 + bars * barDurationMs).toISOString().slice(0, 10),
        label: `Range Square ${m}x (${bars} bars)`,
      });
    });
  }

  return {
    originPrice: p,
    originTime: t0,
    squareDates,
    priceSquareOuts,
    rangeSquareOuts,
  };
}

/**
 * Automatically find prominent local extrema (Points A, B, C) from candlestick data.
 */
export function detectJenkinsWavePoints(candles = []) {
  if (!candles || candles.length < 15) return null;

  let globalMinIdx = 0;
  let globalMaxIdx = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (c.low < candles[globalMinIdx].low) globalMinIdx = i;
    if (c.high > candles[globalMaxIdx].high) globalMaxIdx = i;
  }

  // Determine primary direction: if min occurs before max -> Long wave, else Short wave
  const isUp = globalMinIdx < globalMaxIdx;
  const pA = isUp
    ? { index: globalMinIdx, price: candles[globalMinIdx].low, time: candles[globalMinIdx].time || globalMinIdx, label: 'Point A (Origin Low)' }
    : { index: globalMaxIdx, price: candles[globalMaxIdx].high, time: candles[globalMaxIdx].time || globalMaxIdx, label: 'Point A (Origin High)' };

  const pB = isUp
    ? { index: globalMaxIdx, price: candles[globalMaxIdx].high, time: candles[globalMaxIdx].time || globalMaxIdx, label: 'Point B (Wave 1 Crest)' }
    : { index: globalMinIdx, price: candles[globalMinIdx].low, time: candles[globalMinIdx].time || globalMinIdx, label: 'Point B (Wave 1 Trough)' };

  // Point C: intermediate retracement between B and end of series
  const startC = Math.min(pB.index + 1, candles.length - 1);
  let bestC = startC;
  for (let j = startC; j < candles.length; j++) {
    if (isUp) {
      if (candles[j].low < candles[bestC].low) bestC = j;
    } else {
      if (candles[j].high > candles[bestC].high) bestC = j;
    }
  }

  const pC = {
    index: bestC,
    price: isUp ? candles[bestC].low : candles[bestC].high,
    time: candles[bestC].time || bestC,
    label: isUp ? 'Point C (Wave 2 Pullback Low)' : 'Point C (Wave 2 Pullback High)',
  };

  return {
    mode: isUp ? 'long' : 'short',
    pointA: pA,
    pointB: pB,
    pointC: pC,
  };
}

/**
 * Core Jenkins Analysis: "The Past as the Foundation of the Future".
 * Computes:
 * 1. Horizontal levels of significant extremes (A, B, C + wave harmonic projections)
 * 2. 45° geometric diagonal lines calculated from first wave (A -> B)
 * 3. Vertical time-price intersection points where diagonals meet horizontal levels.
 */
export function calculateJenkinsAnalysis({
  pointA,
  pointB,
  pointC,
  mode = 'long',
  angleMultiplier = 1.0,
  maxBarsAhead = 40,
  candles = [],
} = {}) {
  // If points are omitted, automatically detect them from candles
  let pA = pointA;
  let pB = pointB;
  let pC = pointC;

  if (!pA || !pB || !pC) {
    const auto = detectJenkinsWavePoints(candles);
    if (auto) {
      pA = pA || auto.pointA;
      pB = pB || auto.pointB;
      pC = pC || auto.pointC;
      mode = mode || auto.mode;
    } else {
      pA = { index: 0, price: 100, time: 0 };
      pB = { index: 10, price: 110, time: 10 };
      pC = { index: 15, price: 105, time: 15 };
    }
  }

  // Sort points chronologically
  const pts = [pA, pB, pC].sort((x, y) => (x.index ?? 0) - (y.index ?? 0));
  const [ptA, ptB, ptC] = pts;

  // 1. Calculate 45-degree Base Slope from Wave A -> B
  const timeDeltaAB = Math.max(1, Math.abs((ptB.index ?? 10) - (ptA.index ?? 0)));
  const priceDeltaAB = Math.abs(ptB.price - ptA.price);
  const baseSlope = timeDeltaAB > 0 ? priceDeltaAB / timeDeltaAB : 1.0;
  const effectiveSlope = Math.max(1e-6, baseSlope * Number(angleMultiplier || 1.0));

  // 2. Horizontal Levels of Significant Extremes
  const wave1Range = Math.abs(ptB.price - ptA.price);
  const isLong = mode === 'long';

  const horizontalLevels = [
    { id: 'ext_a', price: ptA.price, label: `רמת קיצון A (${ptA.price})`, type: isLong ? 'low' : 'high', color: isLong ? '#2ecc71' : '#f05b5b' },
    { id: 'ext_b', price: ptB.price, label: `רמת קיצון B (${ptB.price})`, type: isLong ? 'high' : 'low', color: isLong ? '#f05b5b' : '#2ecc71' },
    { id: 'ext_c', price: ptC.price, label: `רמת קיצון C (${ptC.price})`, type: isLong ? 'low' : 'high', color: isLong ? '#2ecc71' : '#f05b5b' },
    // Harmonic wave projections from Point C
    { id: 'proj_050', price: Math.round((isLong ? ptC.price + wave1Range * 0.5 : ptC.price - wave1Range * 0.5) * 100) / 100, label: 'הרחבה הרמונית 50%', type: 'harmonic', color: '#e0b64a' },
    { id: 'proj_100', price: Math.round((isLong ? ptC.price + wave1Range * 1.0 : ptC.price - wave1Range * 1.0) * 100) / 100, label: 'יעד שוויון גלים 100% (A=B -> C=D)', type: 'target', color: '#38bdf8' },
    { id: 'proj_1618', price: Math.round((isLong ? ptC.price + wave1Range * 1.618 : ptC.price - wave1Range * 1.618) * 100) / 100, label: 'יעד הרחבת זהב 161.8%', type: 'golden', color: '#a855f7' },
  ];

  // 3. 45° Diagonal Lines
  // For each origin point, construct line trajectory
  const diagonalLines = [];
  const origins = [
    { name: 'A', pt: ptA, sign: isLong ? 1 : -1, color: '#38bdf8' },
    { name: 'B', pt: ptB, sign: isLong ? -1 : 1, color: '#f59e0b' },
    { name: 'C', pt: ptC, sign: isLong ? 1 : -1, color: '#2ecc71' },
  ];

  const totalBars = Math.max(candles.length, (ptC.index ?? 0) + maxBarsAhead);

  for (const orig of origins) {
    const points = [];
    const startIndex = orig.pt.index ?? 0;
    for (let bar = startIndex; bar <= totalBars; bar++) {
      const dt = bar - startIndex;
      const price = Math.round((orig.pt.price + orig.sign * dt * effectiveSlope) * 100) / 100;
      points.push({ barIndex: bar, price });
    }
    diagonalLines.push({
      originName: orig.name,
      originPoint: orig.pt,
      slope: orig.sign * effectiveSlope,
      color: orig.color,
      points,
    });
  }

  // 4. Vertical Time-Price Intersection Marks
  // Where diagonal meets each horizontal level
  const verticalIntersections = [];
  for (const diag of diagonalLines) {
    for (const hLevel of horizontalLevels) {
      if (Math.abs(diag.slope) < 1e-9) continue;
      // price(t) = P0 + slope * dt = P_target  =>  dt = (P_target - P0) / slope
      const dt = (hLevel.price - diag.originPoint.price) / diag.slope;
      if (dt > 0 && dt <= maxBarsAhead * 2) {
        const barIndex = Math.round((diag.originPoint.index ?? 0) + dt);
        const candleAtBar = candles[barIndex];
        const dateIso = candleAtBar?.time
          ? new Date(candleAtBar.time).toISOString().slice(0, 10)
          : `Bar +${barIndex}`;

        verticalIntersections.push({
          originName: diag.originName,
          levelId: hLevel.id,
          levelLabel: hLevel.label,
          price: hLevel.price,
          barIndex,
          dateIso,
          label: `צומת זמן-מחיר Jenkins: זווית ${diag.originName} נפגשת עם ${hLevel.label} (בר ${barIndex})`,
        });
      }
    }
  }

  // Sort intersections by barIndex
  verticalIntersections.sort((x, y) => x.barIndex - y.barIndex);

  // Square Root targets from active reference extreme
  const sqRootTargets = jenkinsSquareRootTargets(isLong ? ptC.price : ptB.price, { mode: isLong ? 'up' : 'down' });

  return {
    mode,
    pointA: ptA,
    pointB: ptB,
    pointC: ptC,
    baseSlope: Math.round(baseSlope * 1000) / 1000,
    angleMultiplier: Number(angleMultiplier || 1.0),
    effectiveSlope: Math.round(effectiveSlope * 1000) / 1000,
    horizontalLevels,
    diagonalLines,
    verticalIntersections,
    sqRootTargets,
    summary: `ניתוח Michael S. Jenkins: גל 1 שיפוע בסיס ${baseSlope.toFixed(2)} (מכפיל ${angleMultiplier}x). זוהו ${horizontalLevels.length} רמות קיצון ו-${verticalIntersections.length} צומתי היפוך זמן-מחיר.`,
  };
}
