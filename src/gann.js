// Unified W.D. Gann Forecasting & Historical Validation Engine.
// Merges:
//  1. Square of 9 / Square Root Price Vibration Levels (from gann indicator script sq9.txt)
//     Price = (sqrt(Anchor) + (Degree / 180) * Direction)^2
//  2. Gann Angles & Fan (8x1, 4x1, 2x1, 1x1, 1x2, 1x4, 1x8)
//  3. Master Time & Calendar Cycle Calculator (30, 45, 60, 90, 120, 144, 180, 270, 360 calendar days & bar cycles)

const GANN_CALENDAR_CYCLES = [
  { days: 30,  label: '30 יום (1/12 שנה)', weight: 1 },
  { days: 45,  label: '45 יום (1/8 שנה · 45°)', weight: 2 },
  { days: 60,  label: '60 יום (1/6 שנה)', weight: 1 },
  { days: 90,  label: '90 יום (רבעון · 90°)', weight: 3 },
  { days: 120, label: '120 יום (שליש שנה)', weight: 2 },
  { days: 144, label: '144 ימים (ריבוע 12 · מחזור מאסטר)', weight: 3 },
  { days: 180, label: '180 יום (חצי שנה · 180°)', weight: 3 },
  { days: 270, label: '270 יום (3/4 שנה · 270°)', weight: 2 },
  { days: 360, label: '360 יום (מעגל שלם · 360°)', weight: 4 },
];

const SQ9_DEGREES = [45, 90, 135, 180, 225, 270, 315, 360];

export function gannSq9Price(anchor, degree, direction = 1) {
  const root = Math.sqrt(Math.max(anchor, 1e-9));
  const val = root + (degree / 180) * direction;
  return val > 0 ? +(Math.pow(val, 2)).toFixed(4) : null;
}

export function detectMajorPivots(candles, lookback = 12) {
  const pivots = [];
  if (!Array.isArray(candles) || candles.length < lookback * 2 + 1) return pivots;

  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (candles[j].h > candles[i].h) isHigh = false;
      if (candles[j].l < candles[i].l) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) {
      pivots.push({ idx: i, t: candles[i].t, price: candles[i].h, type: 'high' });
    } else if (isLow) {
      pivots.push({ idx: i, t: candles[i].t, price: candles[i].l, type: 'low' });
    }
  }
  return pivots;
}

export function buildSq9VibrationTable(anchorPrice, currentPrice) {
  const rows = [];
  for (const deg of SQ9_DEGREES) {
    const isCardinal = deg % 90 === 0;
    const up = gannSq9Price(anchorPrice, deg, 1);
    const down = gannSq9Price(anchorPrice, deg, -1);
    if (up != null) {
      rows.push({
        degree: deg,
        type: isCardinal ? 'Cardinal' : 'Ordinal',
        isCardinal,
        direction: 'up',
        price: up,
        distPct: +(((up - currentPrice) / currentPrice) * 100).toFixed(2),
      });
    }
    if (down != null) {
      rows.push({
        degree: -deg,
        type: isCardinal ? 'Cardinal' : 'Ordinal',
        isCardinal,
        direction: 'down',
        price: down,
        distPct: +(((down - currentPrice) / currentPrice) * 100).toFixed(2),
      });
    }
  }
  return rows.sort((a, b) => Math.abs(a.distPct) - Math.abs(b.distPct));
}

export function computeGannAngles(candles, anchorPivot) {
  if (!candles?.length || !anchorPivot) return [];
  const n = candles.length;
  const lastIdx = n - 1;
  const barsElapsed = Math.max(1, lastIdx - anchorPivot.idx);

  // Average true bar range as natural Price/Time unit (1x1 slope)
  let sumRange = 0;
  for (let i = 1; i < n; i++) sumRange += Math.abs(candles[i].c - candles[i - 1].c);
  const unitPerBar = Math.max(1e-6, (sumRange / Math.max(1, n - 1)) * 0.85);
  const dir = anchorPivot.type === 'low' ? 1 : -1;

  const ratios = [
    { name: '4x1 (תלול מאוד)', mult: 4 },
    { name: '2x1 (מהיר)', mult: 2 },
    { name: '1x1 (45° · שיווי משקל)', mult: 1 },
    { name: '1x2 (מתון)', mult: 0.5 },
    { name: '1x4 (ארוך טווח)', mult: 0.25 },
  ];

  const currentClose = candles[lastIdx].c;
  return ratios.map((r) => {
    const projectedNow = +(anchorPivot.price + dir * r.mult * unitPerBar * barsElapsed).toFixed(2);
    return {
      name: r.name,
      mult: r.mult,
      projectedNow,
      abovePrice: currentClose >= projectedNow,
      distPct: +(((projectedNow - currentClose) / currentClose) * 100).toFixed(2),
    };
  });
}

export function analyzeGannHistoryAndForecast(candles, { lookback = 10 } = {}) {
  if (!Array.isArray(candles) || candles.length < 60) {
    return { ok: false, error: 'אין מספיק נרות היסטוריים לניתוח גאן' };
  }

  const pivots = detectMajorPivots(candles, lookback);
  const currentPrice = candles[candles.length - 1].c;
  const lastTs = candles[candles.length - 1].t;
  const DAY_MS = 86_400_000;

  // Primary Anchor: most prominent recent major high/low or global low
  let anchorPivot = pivots[pivots.length - 1];
  if (!anchorPivot) {
    let minIdx = 0;
    for (let i = 1; i < candles.length; i++) if (candles[i].l < candles[minIdx].l) minIdx = i;
    anchorPivot = { idx: minIdx, t: candles[minIdx].t, price: candles[minIdx].l, type: 'low' };
  }

  // 1. Historical Validation: For each past pivot, check if Gann Calendar Cycles (+30..360 days)
  //    matched another real swing pivot within ±5 calendar days.
  const validations = [];
  let totalTests = 0;
  let totalHits = 0;

  for (let i = 0; i < pivots.length - 1; i++) {
    const origin = pivots[i];
    for (const cyc of GANN_CALENDAR_CYCLES) {
      const targetTs = origin.t + cyc.days * DAY_MS;
      if (targetTs > lastTs - 3 * DAY_MS) continue; // not yet in the past
      totalTests++;

      // Find closest real pivot to targetTs
      let bestMatch = null;
      let bestDiffDays = Infinity;
      for (let j = i + 1; j < pivots.length; j++) {
        const diffDays = Math.abs(pivots[j].t - targetTs) / DAY_MS;
        if (diffDays < bestDiffDays) {
          bestDiffDays = diffDays;
          bestMatch = pivots[j];
        }
      }

      const hit = bestMatch && bestDiffDays <= 6;
      if (hit) {
        totalHits++;
        const movePct = +(((bestMatch.price - origin.price) / origin.price) * 100).toFixed(2);
        validations.push({
          originDate: new Date(origin.t).toISOString().slice(0, 10),
          originType: origin.type === 'low' ? 'שפל' : 'שיא',
          originPrice: origin.price,
          cycleLabel: cyc.label,
          cycleDays: cyc.days,
          predictedDate: new Date(targetTs).toISOString().slice(0, 10),
          actualPivotDate: new Date(bestMatch.t).toISOString().slice(0, 10),
          actualType: bestMatch.type === 'low' ? 'שפל' : 'שיא',
          actualPrice: bestMatch.price,
          errorDays: +bestDiffDays.toFixed(1),
          movePct,
        });
      }
    }
  }

  const hitRatePct = totalTests > 0 ? +((totalHits / totalTests) * 100).toFixed(1) : 0;

  // 2. Square of 9 Vibration Levels from primary anchor
  const sq9Levels = buildSq9VibrationTable(anchorPivot.price, currentPrice);

  // 3. Gann Angles from primary anchor
  const angles = computeGannAngles(candles, anchorPivot);
  const angle1x1 = angles.find((a) => a.mult === 1);

  // 4. Future Projected Pivot Windows (Calendar Cycles from recent major pivots + Sq9 + 1x1 Confluence)
  const futureMap = new Map();
  const recentPivots = pivots.slice(-6);
  for (const origin of recentPivots) {
    for (const cyc of GANN_CALENDAR_CYCLES) {
      const targetTs = origin.t + cyc.days * DAY_MS;
      if (targetTs <= lastTs || targetTs > lastTs + 365 * DAY_MS) continue;
      // Bucket by week/3-day window so overlapping cycles from multiple pivots merge into high-confluence dates!
      const bucketKey = Math.round(targetTs / (4 * DAY_MS)) * (4 * DAY_MS);
      const existing = futureMap.get(bucketKey) || {
        ts: targetTs,
        date: new Date(targetTs).toISOString().slice(0, 10),
        daysAhead: Math.round((targetTs - lastTs) / DAY_MS),
        score: 0,
        reasons: [],
      };
      existing.score += cyc.weight;
      existing.reasons.push(`${cyc.days}d מ-${origin.type === 'low' ? 'שפל' : 'שיא'} (${new Date(origin.t).toISOString().slice(0, 10)})`);
      futureMap.set(bucketKey, existing);
    }
  }

  const nearestUpSq9 = sq9Levels.find((l) => l.price > currentPrice);
  const nearestDnSq9 = sq9Levels.find((l) => l.price < currentPrice);

  const futurePivots = [...futureMap.values()]
    .sort((a, b) => b.score - a.score || a.ts - b.ts)
    .slice(0, 10)
    .sort((a, b) => a.ts - b.ts)
    .map((fp) => ({
      ...fp,
      targetUp: nearestUpSq9?.price ?? null,
      targetDown: nearestDnSq9?.price ?? null,
      confluenceLabel: fp.score >= 5 ? 'התכנסות חזקה מאוד' : fp.score >= 3 ? 'התכנסות בינונית-גבוהה' : 'חלון זמן גאן',
    }));

  return {
    ok: true,
    candlesCount: candles.length,
    spanDays: Math.round((lastTs - candles[0].t) / DAY_MS),
    currentPrice,
    anchorPivot,
    pivots,
    sq9Levels,
    angles,
    angle1x1,
    totalTests,
    totalHits,
    hitRatePct,
    validations: validations.slice(-14).reverse(),
    futurePivots,
  };
}
