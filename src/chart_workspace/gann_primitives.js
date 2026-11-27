// Gann Overlays & Series Primitives (Horizontal Eighths, Swings ST/SB, Time-Squaring)
// Designed to scale smoothly with Lightweight Charts zoom and pan without pixel breakage or label collision.

import { formatPrice } from './i18n.js';

export const GANN_EIGHTHS_COLORS = {
  '0/8': '#64748b',
  '1/8': '#38bdf8',
  '2/8': '#e0b64a',
  '3/8': '#a855f7',
  '4/8': '#f59e0b', // 50% Equilibrium
  '5/8': '#a855f7',
  '6/8': '#e0b64a',
  '7/8': '#38bdf8',
  '8/8': '#64748b',
};

/**
 * Syncs Gann 1/8 to 8/8 levels onto the chart as native price lines with collision filtering.
 */
export function applyGannEighthsToChart(tvEngine, eighthsLevels = [], { visible = true } = {}) {
  if (!tvEngine) return;
  // Clear previous lines
  for (let i = 0; i <= 8; i++) {
    tvEngine.removePriceLine(`gann_8th_${i}`);
  }
  if (!visible || !eighthsLevels.length) return;

  // Filter collision if levels are closer than 0.4%
  const sorted = [...eighthsLevels].sort((a, b) => a.price - b.price);
  const filtered = [];
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    if (i === 0) {
      filtered.push(cur);
      continue;
    }
    const prev = filtered[filtered.length - 1];
    const diffPct = Math.abs((cur.price - prev.price) / prev.price) * 100;
    if (diffPct >= 0.4 || cur.strong) {
      filtered.push(cur);
    }
  }

  for (const lvl of filtered) {
    const fraction = lvl.fraction || lvl.label?.match(/\d\/\d/)?.[0] || '4/8';
    const color = GANN_EIGHTHS_COLORS[fraction] || '#38bdf8';
    const isHalf = fraction === '4/8' || lvl.ratio === 0.5;

    tvEngine.addCustomPriceLine(`gann_8th_${lvl.label}`, {
      price: lvl.price,
      color,
      title: `${lvl.label} (${formatPrice(lvl.price)})`,
      lineStyle: isHalf ? 0 : 2, // 0 = solid for 50%, 2 = dashed
      lineWidth: isHalf ? 2 : 1,
    });
  }
}

/**
 * Decimates and clusters swing markers (ST/SB) when zoomed out to prevent overlapping icons.
 */
export function buildSwingMarkers(subTrendSignals, { maxMarkers = 40, threshold = 0 } = {}) {
  if (!subTrendSignals || !Array.isArray(subTrendSignals.signals)) return [];
  const signals = subTrendSignals.signals;

  // Filter by strength threshold if present
  const valid = signals.filter((s) => (s.strength ?? 1) >= threshold);

  // Take most recent or sample evenly
  const sampled = valid.length > maxMarkers
    ? valid.slice(-maxMarkers)
    : valid;

  const markers = [];
  for (const s of sampled) {
    let t = s.time || s.timestamp || s.t;
    if (typeof t === 'string') t = Math.floor(new Date(t).getTime() / 1000);
    else if (t > 1e11) t = Math.floor(t / 1000);

    const isTop = s.type === 'top';
    markers.push({
      time: t,
      position: isTop ? 'aboveBar' : 'belowBar',
      color: isTop ? '#f43f5e' : '#10b981',
      shape: isTop ? 'arrowDown' : 'arrowUp',
      text: isTop ? 'ST' : 'SB',
      id: `swing_${s.idx || t}`,
      size: 1,
    });
  }

  // Sort markers chronologically (Lightweight Charts requirement)
  markers.sort((a, b) => a.time - b.time);

  return markers;
}

/**
 * Applies swing markers (ST / SB) to the main series with v4 and v5 compatibility.
 */
export function applySwingMarkersToSeries(mainSeries, markers = [], existingPrimitive = null) {
  if (!mainSeries) return null;
  const LW = window.LightweightCharts;

  try {
    // v4 API
    if (typeof mainSeries.setMarkers === 'function') {
      mainSeries.setMarkers(markers);
      return null;
    }
    // v5 API
    if (LW && typeof LW.createSeriesMarkers === 'function') {
      if (existingPrimitive && typeof existingPrimitive.setMarkers === 'function') {
        existingPrimitive.setMarkers(markers);
        return existingPrimitive;
      }
      return LW.createSeriesMarkers(mainSeries, markers);
    }
  } catch (err) {
    console.warn('[GannPrimitives] failed to setMarkers:', err.message);
  }
  return null;
}
