// Core TradingView Lightweight Charts (v4 & v5 Compatible) Engine Wrapper
// Delivers 60fps canvas rendering, Candle/Heikin-Ashi/Line/Area/Bar series,
// volume histogram, crosshair HUD, auto-fitting, log/linear scale, responsive resizing,
// and dynamic technical indicators (EMA, SMA, VWAP, Bollinger, RSI, MACD).

import {
  calculateSMA,
  calculateEMA,
  calculateVWAP,
  calculateBollinger,
  calculateRSI,
  calculateMACD,
} from './indicators.js';

function addSeriesCompat(chart, seriesTypeClass, fallbackMethodName, options) {
  const LW = window.LightweightCharts;
  if (typeof chart.addSeries === 'function' && seriesTypeClass) {
    return chart.addSeries(seriesTypeClass, options);
  }
  if (typeof chart[fallbackMethodName] === 'function') {
    return chart[fallbackMethodName](options);
  }
  throw new Error(`Cannot add series ${fallbackMethodName}`);
}

export class TVChartEngine {
  constructor(containerEl, options = {}) {
    this.container = containerEl;
    this.options = {
      theme: 'dark',
      chartType: options.chartType || 'candles',
      tf: options.tf || '1h',
      onCrosshairMove: options.onCrosshairMove || null,
      ...options,
    };

    this.chart = null;
    this.mainSeries = null;
    this.volumeSeries = null;
    this.indicatorSeries = new Map();
    this.priceLines = new Map();
    this.candles = [];
    this.currentPrice = null;
    this.resizeObserver = null;
    this.isLogScale = false;
    this.countdownTimer = null;
    this.swingMarkerPrimitive = null;

    this.init();
  }

  init() {
    if (!this.container) return;
    const LW = window.LightweightCharts;
    if (!LW || !LW.createChart) {
      console.warn('[TVChartEngine] window.LightweightCharts not loaded yet, will retry');
      setTimeout(() => this.init(), 100);
      return;
    }

    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 450;

    this.chart = LW.createChart(this.container, {
      width: w,
      height: h,
      layout: {
        background: { type: 'solid', color: '#090f1a' },
        textColor: '#94a3b8',
        fontSize: 12,
        fontFamily: "'IBM Plex Mono', monospace, sans-serif",
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.04)', style: 1 },
        horzLines: { color: 'rgba(255, 255, 255, 0.04)', style: 1 },
      },
      crosshair: {
        mode: LW.CrosshairMode ? LW.CrosshairMode.Normal : 1,
        vertLine: {
          color: 'rgba(56, 189, 248, 0.5)',
          width: 1,
          style: 3,
          labelBackgroundColor: '#0f172a',
        },
        horzLine: {
          color: 'rgba(56, 189, 248, 0.5)',
          width: 1,
          style: 3,
          labelBackgroundColor: '#0f172a',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        scaleMargins: { top: 0.08, bottom: 0.22 },
        autoScale: true,
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 8,
        minBarSpacing: 3,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });

    this.setupSeries();
    this.setupListeners();
    this.setupResize();
    this.startCountdown();
  }

  setupSeries() {
    if (!this.chart) return;
    const LW = window.LightweightCharts;

    // 1. Volume Pane (overlay with histogram)
    try {
      this.volumeSeries = addSeriesCompat(this.chart, LW.HistogramSeries, 'addHistogramSeries', {
        priceFormat: { type: 'volume' },
        priceScaleId: '', // overlay pane
        scaleMargins: { top: 0.78, bottom: 0 },
      });
    } catch (e) {
      console.warn('[TVChartEngine] Volume series setup warning:', e.message);
    }

    // 2. Main Price Series
    this.createMainSeries(this.options.chartType);
  }

  createMainSeries(type = 'candles') {
    if (!this.chart) return;
    if (this.mainSeries) {
      try { this.chart.removeSeries(this.mainSeries); } catch {}
      this.mainSeries = null;
    }

    const LW = window.LightweightCharts;
    this.options.chartType = type;

    if (type === 'line') {
      this.mainSeries = addSeriesCompat(this.chart, LW.LineSeries, 'addLineSeries', {
        color: '#10b981',
        lineWidth: 2,
        priceLineVisible: true,
        lastValueVisible: true,
      });
    } else if (type === 'area') {
      this.mainSeries = addSeriesCompat(this.chart, LW.AreaSeries, 'addAreaSeries', {
        topColor: 'rgba(16, 185, 129, 0.45)',
        bottomColor: 'rgba(16, 185, 129, 0.02)',
        lineColor: '#10b981',
        lineWidth: 2,
        priceLineVisible: true,
        lastValueVisible: true,
      });
    } else if (type === 'bars') {
      this.mainSeries = addSeriesCompat(this.chart, LW.BarSeries, 'addBarSeries', {
        upColor: '#10b981',
        downColor: '#f43f5e',
        priceLineVisible: true,
        lastValueVisible: true,
      });
    } else {
      // 'candles' or 'heikin'
      this.mainSeries = addSeriesCompat(this.chart, LW.CandlestickSeries, 'addCandlestickSeries', {
        upColor: '#10b981',
        downColor: '#f43f5e',
        borderVisible: false,
        wickUpColor: '#10b981',
        wickDownColor: '#f43f5e',
        priceLineVisible: true,
        lastValueVisible: true,
      });
    }

    if (this.candles.length) {
      this.applyCandleData(this.candles);
    }
  }

  setupListeners() {
    if (!this.chart) return;

    this.chart.subscribeCrosshairMove((param) => {
      if (!param || !param.time || !param.seriesData) {
        if (this.options.onCrosshairMove) this.options.onCrosshairMove(null);
        return;
      }
      const priceData = param.seriesData.get(this.mainSeries);
      const volData = this.volumeSeries ? param.seriesData.get(this.volumeSeries) : null;
      if (this.options.onCrosshairMove) {
        this.options.onCrosshairMove({
          time: param.time,
          point: param.point,
          ohlc: priceData,
          volume: volData?.value ?? null,
        });
      }
    });
  }

  setupResize() {
    if (!this.container) return;
    this.resizeObserver = new ResizeObserver((entries) => {
      if (!entries || !entries.length) return;
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0 && this.chart) {
        this.chart.applyOptions({ width, height });
      }
    });
    this.resizeObserver.observe(this.container);
  }

  setData(candles = []) {
    this.candles = candles;
    if (!this.chart || !this.mainSeries) return;
    this.applyCandleData(candles);
  }

  applyCandleData(candles) {
    if (!candles || !candles.length) return;
    const isHeikin = this.options.chartType === 'heikin';
    const isLineOrArea = this.options.chartType === 'line' || this.options.chartType === 'area';

    const formattedPrice = [];
    const formattedVol = [];

    let prevHA = null;
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      let t = c.t || c.time;
      if (typeof t === 'string') t = Math.floor(new Date(t).getTime() / 1000);
      else if (t > 1e11) t = Math.floor(t / 1000);

      const open = Number(c.o ?? c.open ?? c.c);
      const high = Number(c.h ?? c.high ?? c.c);
      const low = Number(c.l ?? c.low ?? c.c);
      const close = Number(c.c ?? c.close);
      const volume = Number(c.v ?? c.volume ?? 0);

      if (isHeikin) {
        const haClose = (open + high + low + close) / 4;
        const haOpen = prevHA ? (prevHA.open + prevHA.close) / 2 : (open + close) / 2;
        const haHigh = Math.max(high, haOpen, haClose);
        const haLow = Math.min(low, haOpen, haClose);
        prevHA = { open: haOpen, close: haClose };

        formattedPrice.push({ time: t, open: haOpen, high: haHigh, low: haLow, close: haClose });
      } else if (isLineOrArea) {
        formattedPrice.push({ time: t, value: close });
      } else {
        formattedPrice.push({ time: t, open, high, low, close });
      }

      const isUp = close >= open;
      formattedVol.push({
        time: t,
        value: volume,
        color: isUp ? 'rgba(16, 185, 129, 0.28)' : 'rgba(244, 63, 94, 0.28)',
      });
    }

    try {
      this.mainSeries.setData(formattedPrice);
      if (this.volumeSeries) this.volumeSeries.setData(formattedVol);
    } catch (err) {
      console.warn('[TVChartEngine] setData error:', err.message);
    }

    this.currentPrice = candles[candles.length - 1]?.c ?? candles[candles.length - 1]?.close;

    // Refresh active indicators
    this.refreshIndicators();
  }

  // --- Dynamic Indicators System ---
  setIndicator(name, enabled) {
    if (!enabled) {
      this.removeIndicator(name);
      return;
    }
    const LW = window.LightweightCharts;
    if (!this.chart || !this.candles?.length) return;

    this.removeIndicator(name);

    try {
      if (name === 'ema20' || name === 'ema50' || name === 'ema200') {
        const period = name === 'ema20' ? 20 : name === 'ema50' ? 50 : 200;
        const color = name === 'ema20' ? '#38bdf8' : name === 'ema50' ? '#eab308' : '#ec4899';
        const data = calculateEMA(this.candles, period);
        const s = addSeriesCompat(this.chart, LW.LineSeries, 'addLineSeries', {
          color,
          lineWidth: 2,
          title: `EMA ${period}`,
        });
        s.setData(data);
        this.indicatorSeries.set(name, [s]);
      } else if (name === 'sma20' || name === 'sma50') {
        const period = name === 'sma20' ? 20 : 50;
        const color = name === 'sma20' ? '#a855f7' : '#06b6d4';
        const data = calculateSMA(this.candles, period);
        const s = addSeriesCompat(this.chart, LW.LineSeries, 'addLineSeries', {
          color,
          lineWidth: 2,
          title: `SMA ${period}`,
        });
        s.setData(data);
        this.indicatorSeries.set(name, [s]);
      } else if (name === 'vwap') {
        const data = calculateVWAP(this.candles);
        const s = addSeriesCompat(this.chart, LW.LineSeries, 'addLineSeries', {
          color: '#f97316',
          lineWidth: 2,
          title: 'VWAP',
        });
        s.setData(data);
        this.indicatorSeries.set(name, [s]);
      } else if (name === 'bollinger') {
        const { upper, middle, lower } = calculateBollinger(this.candles, 20, 2);
        const sMid = addSeriesCompat(this.chart, LW.LineSeries, 'addLineSeries', {
          color: 'rgba(148, 163, 184, 0.7)',
          lineWidth: 1,
          title: 'BB Mid',
        });
        const sUp = addSeriesCompat(this.chart, LW.LineSeries, 'addLineSeries', {
          color: 'rgba(56, 189, 248, 0.7)',
          lineWidth: 1,
          lineStyle: 2,
          title: 'BB Upper',
        });
        const sLow = addSeriesCompat(this.chart, LW.LineSeries, 'addLineSeries', {
          color: 'rgba(56, 189, 248, 0.7)',
          lineWidth: 1,
          lineStyle: 2,
          title: 'BB Lower',
        });
        sMid.setData(middle);
        sUp.setData(upper);
        sLow.setData(lower);
        this.indicatorSeries.set(name, [sMid, sUp, sLow]);
      } else if (name === 'rsi') {
        const data = calculateRSI(this.candles, 14);
        const s = addSeriesCompat(this.chart, LW.LineSeries, 'addLineSeries', {
          color: '#8b5cf6',
          lineWidth: 2,
          priceScaleId: 'rsi_pane',
          scaleMargins: { top: 0.85, bottom: 0 },
          title: 'RSI(14)',
        });
        s.setData(data);
        s.createPriceLine({ price: 70, color: 'rgba(239, 68, 68, 0.5)', lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title: 'OB 70' });
        s.createPriceLine({ price: 30, color: 'rgba(16, 185, 129, 0.5)', lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title: 'OS 30' });
        this.indicatorSeries.set(name, [s]);
      }
    } catch (e) {
      console.warn(`[TVChartEngine] Failed to add indicator ${name}:`, e.message);
    }
  }

  removeIndicator(name) {
    const list = this.indicatorSeries.get(name);
    if (list && Array.isArray(list)) {
      list.forEach((s) => {
        try { this.chart.removeSeries(s); } catch {}
      });
      this.indicatorSeries.delete(name);
    }
  }

  refreshIndicators() {
    for (const [name] of this.indicatorSeries.entries()) {
      this.setIndicator(name, true);
    }
  }

  fitContent() {
    if (this.chart) {
      this.chart.timeScale().fitContent();
    }
  }

  toggleLogScale() {
    if (!this.chart) return false;
    const LW = window.LightweightCharts;
    this.isLogScale = !this.isLogScale;
    this.chart.priceScale('right').applyOptions({
      mode: this.isLogScale
        ? (LW.PriceScaleMode ? LW.PriceScaleMode.Logarithmic : 1)
        : (LW.PriceScaleMode ? LW.PriceScaleMode.Normal : 0),
    });
    return this.isLogScale;
  }

  addCustomPriceLine(id, { price, color = '#38bdf8', title = '', lineStyle = 2, lineWidth = 1 }) {
    if (!this.mainSeries) return null;
    this.removePriceLine(id);
    const line = this.mainSeries.createPriceLine({
      price: Number(price),
      color,
      lineWidth,
      lineStyle,
      axisLabelVisible: true,
      title,
    });
    this.priceLines.set(id, line);
    return line;
  }

  removePriceLine(id) {
    const existing = this.priceLines.get(id);
    if (existing && this.mainSeries) {
      try { this.mainSeries.removePriceLine(existing); } catch {}
      this.priceLines.delete(id);
    }
  }

  clearAllPriceLines() {
    if (!this.mainSeries) return;
    for (const [id, line] of this.priceLines.entries()) {
      try { this.mainSeries.removePriceLine(line); } catch {}
    }
    this.priceLines.clear();
  }

  // Live countdown to candle close
  startCountdown() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = setInterval(() => {
      if (!this.container) return;
      const el = this.container.querySelector('.tv-countdown-badge');
      if (!el) return;

      const tf = this.options.tf || '1h';
      const now = Math.floor(Date.now() / 1000);
      let tfSec = 3600;
      if (tf === '1m') tfSec = 60;
      else if (tf === '5m') tfSec = 300;
      else if (tf === '15m') tfSec = 900;
      else if (tf === '4h') tfSec = 14400;
      else if (tf === '1d') tfSec = 86400;
      else if (tf === '1w') tfSec = 604800;

      const remSec = tfSec - (now % tfSec);
      const m = Math.floor(remSec / 60);
      const s = remSec % 60;
      el.textContent = `⏱ סגירת נר: ${m}:${s < 10 ? '0' : ''}${s}`;
    }, 1000);
  }

  destroy() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.chart) {
      try { this.chart.remove(); } catch {}
      this.chart = null;
    }
  }
}
