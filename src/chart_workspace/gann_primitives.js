// Gann Overlays & Series Primitives (Horizontal Eighths, Swings ST/SB, Gann Fan 9 Angles, Dual Fans, Gann Box)
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
 * Normalizes candle timestamp to UNIX timestamp in seconds.
 */
function normalizeTimeSec(t) {
  if (t == null) return Math.floor(Date.now() / 1000);
  if (typeof t === 'string') return Math.floor(new Date(t).getTime() / 1000);
  if (t > 1e11) return Math.floor(t / 1000);
  return Math.floor(t);
}

/**
 * Syncs Gann 1/8 to 8/8 levels onto the chart as native price lines with collision filtering.
 */
export function applyGannEighthsToChart(tvEngine, eighthsLevels = [], { visible = true } = {}) {
  if (!tvEngine) return;
  // Clear previous lines
  for (let i = 0; i <= 8; i++) {
    tvEngine.removePriceLine(`gann_8th_${i}`);
  }
  // Clear any previously added gann eighths custom lines
  tvEngine.removePriceLine('gann_8th_0/8');
  tvEngine.removePriceLine('gann_8th_1/8');
  tvEngine.removePriceLine('gann_8th_2/8');
  tvEngine.removePriceLine('gann_8th_3/8');
  tvEngine.removePriceLine('gann_8th_4/8');
  tvEngine.removePriceLine('gann_8th_5/8');
  tvEngine.removePriceLine('gann_8th_6/8');
  tvEngine.removePriceLine('gann_8th_7/8');
  tvEngine.removePriceLine('gann_8th_8/8');

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

    tvEngine.addCustomPriceLine(`gann_8th_${fraction}`, {
      price: lvl.price,
      color,
      title: `${lvl.label || fraction} (${formatPrice(lvl.price)})`,
      lineStyle: isHalf ? 0 : 2, // 0 = solid for 50%, 2 = dashed
      lineWidth: isHalf ? 2 : 1,
    });
  }
}

/**
 * Decimates and clusters swing markers (ST/SB) when zoomed out to prevent overlapping icons.
 */
export function buildSwingMarkers(subTrendSignals, { maxMarkers = 50, threshold = 0 } = {}) {
  if (!subTrendSignals || !Array.isArray(subTrendSignals.signals)) return [];
  const signals = subTrendSignals.signals;

  const valid = signals.filter((s) => (s.strength ?? 1) >= threshold);
  const sampled = valid.length > maxMarkers ? valid.slice(-maxMarkers) : valid;

  const markers = [];
  for (const s of sampled) {
    let t = normalizeTimeSec(s.time || s.timestamp || s.t);
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
    if (typeof mainSeries.setMarkers === 'function') {
      mainSeries.setMarkers(markers);
      return null;
    }
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

/**
 * Renders full 9-angle W.D. Gann Fan onto the SVG overlay synced with TradingView coordinate engine.
 */
export function renderGannFanOnSvg(tvEngine, overlaySvg, gannFan, candles, { visible = true, onSelect = null } = {}) {
  if (!overlaySvg) return;
  const oldGroup = overlaySvg.querySelector('#tv-gann-fan-layer');
  if (oldGroup) oldGroup.remove();

  if (!visible || !gannFan || !Array.isArray(gannFan.rays) || !gannFan.rays.length || !candles?.length || !tvEngine?.chart || !tvEngine?.mainSeries) {
    return;
  }

  const ts = tvEngine.chart.timeScale();
  const series = tvEngine.mainSeries;
  const n = candles.length;
  const anchorIdx = Math.max(0, Math.min(n - 1, gannFan.anchorIdx ?? 0));
  const anchorCandle = candles[anchorIdx] || candles[0];
  const anchorTime = normalizeTimeSec(anchorCandle.t || anchorCandle.time);

  const ax = ts.timeToCoordinate(anchorTime);
  const ay = series.priceToCoordinate(gannFan.anchorPrice);
  if (ax == null || ay == null) return;

  const lastCandle = candles[n - 1];
  const lastTime = normalizeTimeSec(lastCandle.t || lastCandle.time);
  const avgStep = n > 1 ? Math.max(60, Math.floor((lastTime - anchorTime) / Math.max(1, n - 1 - anchorIdx))) : 3600;
  const futureTime = lastTime + (gannFan.futureBars || 35) * avgStep;

  let fxEnd = ts.timeToCoordinate(futureTime);
  const svgWidth = overlaySvg.clientWidth || overlaySvg.parentElement?.clientWidth || 800;
  const svgHeight = overlaySvg.clientHeight || overlaySvg.parentElement?.clientHeight || 500;
  if (fxEnd == null || fxEnd <= ax) fxEnd = svgWidth - 24;

  const gFan = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  gFan.id = 'tv-gann-fan-layer';
  gFan.setAttribute('data-overlay-type', 'gann_fan');

  // Render rays
  for (const ray of gannFan.rays) {
    const fyEnd = series.priceToCoordinate(ray.projectedFuture);
    if (fyEnd == null) continue;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(ax));
    line.setAttribute('y1', String(ay));
    line.setAttribute('x2', String(fxEnd));
    line.setAttribute('y2', String(fyEnd));
    line.setAttribute('stroke', ray.color);
    line.setAttribute('stroke-width', ray.id === '1x1' ? '2.2' : ray.isMain ? '1.5' : '1');
    line.setAttribute('stroke-opacity', ray.id === '1x1' ? '0.95' : ray.isMain ? '0.75' : '0.45');
    line.setAttribute('stroke-dasharray', ray.id === '1x1' ? 'none' : '4,3');
    line.style.cursor = 'pointer';
    line.style.pointerEvents = 'auto';

    line.addEventListener('click', (e) => {
      e.stopPropagation();
      if (onSelect) onSelect({ type: 'gann_fan', ray, ax, ay, fxEnd, fyEnd, anchorPrice: gannFan.anchorPrice });
    });
    gFan.appendChild(line);

    // Angle label tag at end of ray
    if (fyEnd >= 10 && fyEnd <= svgHeight - 10) {
      const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      lbl.setAttribute('x', String(Math.min(fxEnd - 6, svgWidth - 55)));
      lbl.setAttribute('y', String(fyEnd - 3));
      lbl.setAttribute('fill', ray.color);
      lbl.setAttribute('font-size', ray.id === '1x1' ? '11' : '9.5');
      lbl.setAttribute('font-weight', ray.id === '1x1' ? '800' : '600');
      lbl.setAttribute('font-family', 'monospace');
      lbl.textContent = `${ray.id} (${ray.degLabel || ''})`;
      lbl.style.cursor = 'pointer';
      lbl.style.pointerEvents = 'auto';
      lbl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (onSelect) onSelect({ type: 'gann_fan', ray, ax, ay, fxEnd, fyEnd, anchorPrice: gannFan.anchorPrice });
      });
      gFan.appendChild(lbl);
    }
  }

  // Anchor Pivot Marker
  const anchorDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  anchorDot.setAttribute('cx', String(ax));
  anchorDot.setAttribute('cy', String(ay));
  anchorDot.setAttribute('r', '6');
  anchorDot.setAttribute('fill', '#facc15');
  anchorDot.setAttribute('stroke', '#090f1a');
  anchorDot.setAttribute('stroke-width', '2');
  anchorDot.style.cursor = 'pointer';
  anchorDot.style.pointerEvents = 'auto';
  anchorDot.addEventListener('click', (e) => {
    e.stopPropagation();
    if (onSelect) onSelect({ type: 'gann_fan', anchor: true, anchorPrice: gannFan.anchorPrice, ax, ay });
  });
  gFan.appendChild(anchorDot);

  const anchorText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  anchorText.setAttribute('x', String(ax + 8));
  anchorText.setAttribute('y', String(ay - 8));
  anchorText.setAttribute('fill', '#facc15');
  anchorText.setAttribute('font-size', '10.5');
  anchorText.setAttribute('font-weight', '700');
  anchorText.setAttribute('font-family', 'Heebo, sans-serif');
  anchorText.textContent = `עוגן גאן (${formatPrice(gannFan.anchorPrice)})`;
  anchorText.style.pointerEvents = 'none';
  gFan.appendChild(anchorText);

  overlaySvg.appendChild(gFan);
}

/**
 * Renders Dual Fans (Bullish from Major Low + Bearish from Major High) on SVG.
 */
export function renderDualFansOnSvg(tvEngine, overlaySvg, multiAngles, candles, { visible = true, onSelect = null } = {}) {
  if (!overlaySvg) return;
  const oldGroup = overlaySvg.querySelector('#tv-dual-fans-layer');
  if (oldGroup) oldGroup.remove();

  if (!visible || !multiAngles || !candles?.length || !tvEngine?.chart || !tvEngine?.mainSeries) {
    return;
  }

  const ts = tvEngine.chart.timeScale();
  const series = tvEngine.mainSeries;
  const n = candles.length;
  const gDual = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  gDual.id = 'tv-dual-fans-layer';
  gDual.setAttribute('data-overlay-type', 'dual_fans');

  const lastCandle = candles[n - 1];
  const lastTime = normalizeTimeSec(lastCandle.t || lastCandle.time);
  const svgWidth = overlaySvg.clientWidth || overlaySvg.parentElement?.clientWidth || 800;

  // Bullish Fan from Major Low
  if (multiAngles.bullishFan?.rays?.length) {
    const bCandle = candles[multiAngles.bullishFan.anchorIdx] || candles[0];
    const bx = ts.timeToCoordinate(normalizeTimeSec(bCandle.t || bCandle.time));
    const by = series.priceToCoordinate(multiAngles.bullishFan.anchorPrice);
    if (bx != null && by != null) {
      const fxEnd = Math.min(svgWidth - 20, bx + 500);
      for (const ray of multiAngles.bullishFan.rays) {
        if (!['1x1', '2x1', '1x2', '4x1', '1x4'].includes(ray.id)) continue;
        const fy = series.priceToCoordinate(ray.projectedFuture);
        if (fy == null) continue;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(bx));
        line.setAttribute('y1', String(by));
        line.setAttribute('x2', String(fxEnd));
        line.setAttribute('y2', String(fy));
        line.setAttribute('stroke', '#10b981');
        line.setAttribute('stroke-width', ray.id === '1x1' ? '1.8' : '1');
        line.setAttribute('stroke-opacity', ray.id === '1x1' ? '0.85' : '0.45');
        line.setAttribute('stroke-dasharray', '3,3');
        line.style.cursor = 'pointer';
        line.style.pointerEvents = 'auto';
        line.addEventListener('click', (e) => {
          e.stopPropagation();
          if (onSelect) onSelect({ type: 'dual_fans', side: 'bullish', ray });
        });
        gDual.appendChild(line);
      }
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', String(bx));
      dot.setAttribute('cy', String(by));
      dot.setAttribute('r', '5');
      dot.setAttribute('fill', '#10b981');
      dot.style.cursor = 'pointer';
      dot.style.pointerEvents = 'auto';
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        if (onSelect) onSelect({ type: 'dual_fans', anchor: 'low' });
      });
      gDual.appendChild(dot);
    }
  }

  // Bearish Fan from Major High
  if (multiAngles.bearishFan?.rays?.length) {
    const hCandle = candles[multiAngles.bearishFan.anchorIdx] || candles[0];
    const hx = ts.timeToCoordinate(normalizeTimeSec(hCandle.t || hCandle.time));
    const hy = series.priceToCoordinate(multiAngles.bearishFan.anchorPrice);
    if (hx != null && hy != null) {
      const fxEnd = Math.min(svgWidth - 20, hx + 500);
      for (const ray of multiAngles.bearishFan.rays) {
        if (!['1x1', '2x1', '1x2', '4x1', '1x4'].includes(ray.id)) continue;
        const fy = series.priceToCoordinate(ray.projectedFuture);
        if (fy == null) continue;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(hx));
        line.setAttribute('y1', String(hy));
        line.setAttribute('x2', String(fxEnd));
        line.setAttribute('y2', String(fy));
        line.setAttribute('stroke', '#f43f5e');
        line.setAttribute('stroke-width', ray.id === '1x1' ? '1.8' : '1');
        line.setAttribute('stroke-opacity', ray.id === '1x1' ? '0.85' : '0.45');
        line.setAttribute('stroke-dasharray', '3,3');
        line.style.cursor = 'pointer';
        line.style.pointerEvents = 'auto';
        line.addEventListener('click', (e) => {
          e.stopPropagation();
          if (onSelect) onSelect({ type: 'dual_fans', side: 'bearish', ray });
        });
        gDual.appendChild(line);
      }
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', String(hx));
      dot.setAttribute('cy', String(hy));
      dot.setAttribute('r', '5');
      dot.setAttribute('fill', '#f43f5e');
      dot.style.cursor = 'pointer';
      dot.style.pointerEvents = 'auto';
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        if (onSelect) onSelect({ type: 'dual_fans', anchor: 'high' });
      });
      gDual.appendChild(dot);
    }
  }

  overlaySvg.appendChild(gDual);
}

/**
 * Renders W.D. Gann Box (Square of Price and Time) with 1x1 diagonals and time/price divisions.
 */
export function renderGannBoxOnSvg(tvEngine, overlaySvg, gannBox, candles, { visible = true, onSelect = null } = {}) {
  if (!overlaySvg) return;
  const oldGroup = overlaySvg.querySelector('#tv-gann-box-layer');
  if (oldGroup) oldGroup.remove();

  if (!visible || !gannBox || !candles?.length || !tvEngine?.chart || !tvEngine?.mainSeries) {
    return;
  }

  const ts = tvEngine.chart.timeScale();
  const series = tvEngine.mainSeries;
  const n = candles.length;

  const startCandle = candles[Math.max(0, Math.min(n - 1, gannBox.startIdx ?? 0))] || candles[0];
  const startTime = normalizeTimeSec(startCandle.t || startCandle.time);
  const lastCandle = candles[n - 1];
  const lastTime = normalizeTimeSec(lastCandle.t || lastCandle.time);
  const avgStep = n > 1 ? Math.max(60, Math.floor((lastTime - startTime) / Math.max(1, n - 1 - (gannBox.startIdx || 0)))) : 3600;

  const extraBars = Math.max(10, (gannBox.endIdx ?? n) - (n - 1));
  const endTime = lastTime + extraBars * avgStep;

  let bx1 = ts.timeToCoordinate(startTime);
  let bx2 = ts.timeToCoordinate(endTime);
  const by1 = series.priceToCoordinate(gannBox.high);
  const by2 = series.priceToCoordinate(gannBox.low);

  if (bx1 == null || by1 == null || by2 == null) return;
  if (bx2 == null || bx2 <= bx1) bx2 = bx1 + 320;

  const gBox = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  gBox.id = 'tv-gann-box-layer';
  gBox.setAttribute('data-overlay-type', 'gann_box');

  const topY = Math.min(by1, by2);
  const botY = Math.max(by1, by2);
  const boxW = Math.max(10, bx2 - bx1);
  const boxH = Math.max(10, botY - topY);

  // Outer Box Rectangle
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', String(bx1));
  rect.setAttribute('y', String(topY));
  rect.setAttribute('width', String(boxW));
  rect.setAttribute('height', String(boxH));
  rect.setAttribute('fill', 'rgba(56, 189, 248, 0.07)');
  rect.setAttribute('stroke', '#38bdf8');
  rect.setAttribute('stroke-width', '1.6');
  rect.style.cursor = 'pointer';
  rect.style.pointerEvents = 'auto';
  rect.addEventListener('click', (e) => {
    e.stopPropagation();
    if (onSelect) onSelect({ type: 'gann_box', gannBox, bx1, topY, boxW, boxH });
  });
  gBox.appendChild(rect);

  // 1x1 Diagonals
  const d1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  d1.setAttribute('x1', String(bx1));
  d1.setAttribute('y1', String(botY));
  d1.setAttribute('x2', String(bx2));
  d1.setAttribute('y2', String(topY));
  d1.setAttribute('stroke', 'rgba(46, 204, 113, 0.55)');
  d1.setAttribute('stroke-dasharray', '4,3');
  d1.setAttribute('stroke-width', '1.2');
  gBox.appendChild(d1);

  const d2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  d2.setAttribute('x1', String(bx1));
  d2.setAttribute('y1', String(topY));
  d2.setAttribute('x2', String(bx2));
  d2.setAttribute('y2', String(botY));
  d2.setAttribute('stroke', 'rgba(240, 91, 91, 0.55)');
  d2.setAttribute('stroke-dasharray', '4,3');
  d2.setAttribute('stroke-width', '1.2');
  gBox.appendChild(d2);

  // Horizontal Price Lines inside Box
  for (const pl of gannBox.priceLines || []) {
    if (pl.ratio === 0 || pl.ratio === 1) continue;
    const py = series.priceToCoordinate(pl.price);
    if (py != null && py >= topY && py <= botY) {
      const plLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      plLine.setAttribute('x1', String(bx1));
      plLine.setAttribute('x2', String(bx2));
      plLine.setAttribute('y1', String(py));
      plLine.setAttribute('y2', String(py));
      plLine.setAttribute('stroke', pl.ratio === 0.5 ? '#f2cc60' : pl.isThird ? '#c084fc' : 'rgba(56, 189, 248, 0.4)');
      plLine.setAttribute('stroke-width', pl.ratio === 0.5 ? '1.5' : '1');
      plLine.setAttribute('stroke-dasharray', pl.ratio === 0.5 ? 'none' : '3,3');
      gBox.appendChild(plLine);

      const plText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      plText.setAttribute('x', String(bx2 - 50));
      plText.setAttribute('y', String(py - 3));
      plText.setAttribute('fill', pl.ratio === 0.5 ? '#f2cc60' : pl.isThird ? '#c084fc' : '#7dd3fc');
      plText.setAttribute('font-size', '8.5');
      plText.setAttribute('font-family', 'monospace');
      plText.textContent = `${pl.label} ${formatPrice(pl.price)}`;
      gBox.appendChild(plText);
    }
  }

  // Label Header
  const title = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  title.setAttribute('x', String(bx1 + 8));
  title.setAttribute('y', String(topY + 14));
  title.setAttribute('fill', '#7dd3fc');
  title.setAttribute('font-size', '10');
  title.setAttribute('font-weight', '700');
  title.setAttribute('font-family', 'Heebo, sans-serif');
  title.textContent = `▦ תיבת גאן (${gannBox.rangeModeLabel || 'טווח'}) · ${formatPrice(gannBox.range)}`;
  title.style.pointerEvents = 'none';
  gBox.appendChild(title);

  overlaySvg.appendChild(gBox);
}
