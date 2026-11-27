// TradingView-Grade Professional Charting Workspace Component
// Upgrades the Forecast Map chart into a full professional workspace with Lightweight Charts,
// drawing rail, indicator picker modal, layers drawer, templates, and clean RTL/LTR isolation.

import { h, mount, tag, openModal, toast } from '../ui.js';
import { getCandles, quotes, ASSET_CATALOG } from '../market.js';
import { TVChartEngine } from './engine.js';
import { applyGannEighthsToChart, buildSwingMarkers, applySwingMarkersToSeries } from './gann_primitives.js';
import { DrawingManager } from './drawings.js';
import { bidiText, formatPrice, formatPercent, I18N } from './i18n.js';
import { getSavedTemplates, saveTemplate, defaultTemplates } from './templates.js';
import { canAccessFeature } from './entitlements.js';

export function createChartWorkspace({
  symbol = 'BTCUSDT',
  tf = '1h',
  analysis = null,
  candles = [],
  onSymbolChange = null,
  onTfChange = null,
  onAiExplain = null,
  compact = false,
} = {}) {
  const state = {
    symbol,
    tf,
    chartType: 'candles',
    candles: candles || [],
    analysis,
    loading: false,
    overlaysHidden: false,
    rightDrawerOpen: false,
    activeDrawerTab: 'layers', // 'layers' | 'indicators' | 'ai'
    swingStrengthThreshold: 0,
    layers: {
      gannEighths: true,
      swings: true,
      volume: true,
      ema20: false,
      ema50: false,
      ema200: false,
      sma20: false,
      sma50: false,
      vwap: false,
      bollinger: false,
      rsi: false,
    },
  };

  let tvEngine = null;
  let drawingManager = null;
  let hudEl = null;
  let chartContainer = null;
  let overlaySvg = null;
  let swingMarkerPrimitive = null;

  const root = h('div', {
    class: 'tv-workspace-root',
    style: {
      display: 'flex',
      flexDirection: 'column',
      background: '#090f1a',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '14px',
      overflow: 'hidden',
      position: 'relative',
      width: '100%',
      minHeight: compact ? '500px' : '650px',
      boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
    },
  });

  // 1. Slim Dismissible Trend Alert Strip (Above Chart) with Bidi Isolation
  const subTrend = state.analysis?.subTrendSignals?.currentSubTrend || 'bearish';
  const isBull = subTrend === 'bullish';
  const alertStrip = h('div', {
    class: 'tv-alert-strip',
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '7px 14px',
      background: isBull
        ? 'linear-gradient(90deg, rgba(16, 185, 129, 0.15), rgba(9, 15, 26, 0.95))'
        : 'linear-gradient(90deg, rgba(239, 68, 68, 0.15), rgba(9, 15, 26, 0.95))',
      borderBottom: `1px solid ${isBull ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`,
      fontSize: '12px',
    },
  },
    h('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } },
      tag(isBull ? 'איתות עולה' : 'איתות יורד', isBull ? 'active' : 'paused'),
      h('span', {
        style: { color: isBull ? '#34d399' : '#fca5a5', fontWeight: '700' },
        text: isBull ? '▲ תת-מגמה עולה (Bullish):' : '▼ תת-מגמה יורדת (Bearish):',
      }),
      h('span', { style: { color: '#e2e8f0' } }, [
        bidiText(state.symbol, { className: 'mono' }),
        document.createTextNode(' שוהה ביחס לשמיניות גאן '),
        bidiText('4/8 ($87,500)'),
        document.createTextNode(' · תמיכה קרובה '),
        bidiText('2/8 ($84,200)'),
      ]),
    ),
    h('div', { class: 'row', style: { gap: '8px' } },
      h('button', {
        class: 'btn btn-ghost btn-sm',
        style: { padding: '2px 8px', fontSize: '11px', color: '#10b981' },
        onclick: () => {
          if (onAiExplain) onAiExplain(state.symbol, state.analysis);
        },
      }, '✨ הסבר בינה מלאכותית'),
      h('button', {
        class: 'btn btn-ghost btn-sm',
        style: { padding: '2px 8px', fontSize: '11px', color: '#94a3b8' },
        onclick: () => { alertStrip.style.display = 'none'; },
      }, '✕ סגור'),
    ),
  );
  root.appendChild(alertStrip);

  // 2. Top Toolbar
  const topToolbar = h('div', {
    class: 'tv-top-toolbar',
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '8px 12px',
      background: 'rgba(15, 23, 42, 0.95)',
      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
      flexWrap: 'wrap',
      gap: '8px',
    },
  });

  // Left tools in topbar: Symbol, Timeframes, Chart Types
  const leftGroup = h('div', { class: 'row wrap', style: { gap: '6px', alignItems: 'center' } },
    h('select', {
      class: 'input',
      style: { padding: '4px 8px', fontSize: '13px', fontWeight: '700', color: '#38bdf8' },
      onchange: (e) => {
        state.symbol = e.target.value;
        if (drawingManager) drawingManager.setContext(state.symbol, state.tf);
        if (onSymbolChange) onSymbolChange(state.symbol);
      },
    },
      ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'NVDA', 'AAPL', 'SPY', 'QQQ', 'GOLD'].map((sym) =>
        h('option', { value: sym, selected: sym === state.symbol }, sym)
      )
    ),

    h('div', { class: 'row', style: { gap: '2px' } },
      ['1m', '5m', '15m', '1h', '4h', '1d', '1w'].map((t) =>
        h('button', {
          class: `btn btn-sm ${state.tf.toLowerCase() === t ? 'btn-primary' : 'btn-ghost'}`,
          style: { padding: '3px 7px', fontSize: '12px' },
          onclick: () => {
            state.tf = t;
            if (drawingManager) drawingManager.setContext(state.symbol, state.tf);
            if (onTfChange) onTfChange(t);
          },
        }, t.toUpperCase())
      )
    ),

    h('select', {
      class: 'input',
      style: { padding: '4px 8px', fontSize: '12px' },
      onchange: (e) => {
        state.chartType = e.target.value;
        if (tvEngine) tvEngine.createMainSeries(state.chartType);
      },
    },
      h('option', { value: 'candles' }, '🕯️ נרות (Candlesticks)'),
      h('option', { value: 'heikin' }, '📊 הייקין אשי (Heikin Ashi)'),
      h('option', { value: 'line' }, '📈 קו סגירה (Line)'),
      h('option', { value: 'area' }, '🏔️ אזור (Area)'),
      h('option', { value: 'bars' }, '📊 עמודות (Bars)')
    ),

    // Indicators Modal Trigger
    h('button', {
      class: 'btn btn-sm btn-ghost',
      style: { fontSize: '12px', border: '1px solid rgba(255, 255, 255, 0.15)' },
      onclick: () => openIndicatorModal(),
    }, 'fx אינדיקטורים'),
  );
  topToolbar.appendChild(leftGroup);

  // Right tools in topbar: Layers Drawer, Naked Chart Toggle, Clear Drawings, Fit View, Fullscreen
  const rightGroup = h('div', { class: 'row wrap', style: { gap: '6px', alignItems: 'center' } },
    h('button', {
      class: 'btn btn-sm btn-ghost',
      style: { fontSize: '12px' },
      onclick: () => toggleRightDrawer('layers'),
      title: 'נהל שכבות ואינדיקטורים פעילים',
    }, '📑 שכבות'),

    h('button', {
      class: 'btn btn-sm btn-ghost',
      style: { fontSize: '12px' },
      onclick: () => {
        state.overlaysHidden = !state.overlaysHidden;
        applyGannEighthsToChart(tvEngine, state.analysis?.jenkins?.eighths || [], { visible: !state.overlaysHidden });
        if (state.overlaysHidden) {
          applySwingMarkersToSeries(tvEngine?.mainSeries, []);
        } else if (state.analysis?.subTrendSignals) {
          const markers = buildSwingMarkers(state.analysis.subTrendSignals, { threshold: state.swingStrengthThreshold });
          swingMarkerPrimitive = applySwingMarkersToSeries(tvEngine?.mainSeries, markers, swingMarkerPrimitive);
        }
        toast(state.overlaysHidden ? 'גרף נקי (כל השכבות הוסתרו)' : 'שכבות גאן הוצגו מחדש', 'ok');
      },
    }, '👁 הסתר/הצג שכבות'),

    h('button', {
      class: 'btn btn-sm btn-ghost',
      style: { fontSize: '12px', color: '#f87171' },
      onclick: () => {
        if (drawingManager) drawingManager.clearAll();
        toast('הציורים נמחקו מהגרף', 'ok');
      },
    }, '🗑 מחק ציורים'),

    h('button', {
      class: 'btn btn-sm btn-ghost',
      style: { fontSize: '12px' },
      onclick: () => {
        if (tvEngine) tvEngine.fitContent();
      },
      title: 'התאם גרף למסך (Fit Content)',
    }, '⟲ התאם'),

    h('button', {
      class: 'btn btn-sm btn-ghost',
      style: { fontSize: '12px' },
      onclick: () => {
        if (!document.fullscreenElement) {
          root.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      },
      title: 'מסך מלא (Fullscreen)',
    }, '⛶ מסך מלא'),
  );
  topToolbar.appendChild(rightGroup);
  root.appendChild(topToolbar);

  // 3. Main Workspace Body (Left Drawing Rail + Center Chart + Right Drawer)
  const workspaceBody = h('div', {
    class: 'tv-workspace-body',
    style: {
      display: 'flex',
      flex: '1',
      position: 'relative',
      overflow: 'hidden',
    },
  });

  // Left Drawing Rail
  const leftRail = h('div', {
    class: 'tv-left-rail',
    style: {
      width: '42px',
      background: 'rgba(15, 23, 42, 0.98)',
      borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '8px 0',
      gap: '8px',
      zIndex: '10',
    },
  });

  const tools = [
    { id: null, icon: '⤹', label: 'בחירה / תנועה (Select/Pan)' },
    { id: 'trendline', icon: '╱', label: 'קו מגמה (Trendline)' },
    { id: 'ray', icon: '↗', label: 'קרן (Ray)' },
    { id: 'horizontal', icon: '―', label: 'קו אופקי (Horizontal Line)' },
    { id: 'vertical', icon: '│', label: 'קו אנכי / זמן (Vertical Line)' },
    { id: 'fibonacci', icon: '≡', label: 'רמות פיבונאצ׳י (Fibonacci Retracement)' },
    { id: 'gann_fan', icon: '🪭', label: 'מניפת גאן (Gann Fan 1x1..8x1)' },
    { id: 'rectangle', icon: '▭', label: 'מלבן / אזור (Rectangle)' },
    { id: 'measure', icon: '📐', label: 'סרגל מדידה (Measure Tool)' },
    { id: 'text', icon: 'T', label: 'הערת טקסט (Text Note)' },
  ];

  tools.forEach((t) => {
    const btn = h('button', {
      class: 'btn btn-ghost btn-sm',
      style: {
        width: '32px',
        height: '32px',
        padding: '0',
        display: 'grid',
        placeItems: 'center',
        fontSize: '14px',
        color: '#cbd5e1',
      },
      title: t.label,
      onclick: () => {
        tools.forEach((other) => {
          const el = leftRail.querySelector(`[data-tool="${other.id}"]`);
          if (el) el.style.background = 'transparent';
        });
        btn.style.background = 'rgba(56, 189, 248, 0.2)';
        if (drawingManager) drawingManager.setTool(t.id);
      },
    }, t.icon);
    btn.setAttribute('data-tool', String(t.id));
    leftRail.appendChild(btn);
  });

  // Undo / Redo Rail Buttons
  const undoBtn = h('button', {
    class: 'btn btn-ghost btn-sm',
    style: { width: '32px', height: '32px', padding: '0', marginTop: 'auto', fontSize: '13px' },
    title: 'בטל פעולה אחרונה (Ctrl+Z)',
    onclick: () => drawingManager?.undo(),
  }, '↩');
  leftRail.appendChild(undoBtn);

  // Magnet Mode Toggle Button
  const magnetBtn = h('button', {
    class: 'btn btn-ghost btn-sm',
    style: { width: '32px', height: '32px', padding: '0', fontSize: '13px' },
    title: 'מצב מגנט (היצמדות אוטומטית לשיא/שפל הנר)',
    onclick: () => {
      if (drawingManager) {
        drawingManager.magnetMode = !drawingManager.magnetMode;
        magnetBtn.style.color = drawingManager.magnetMode ? '#34d399' : '#cbd5e1';
        toast(drawingManager.magnetMode ? 'מצב מגנט הופעל' : 'מצב מגנט כבוי', 'ok');
      }
    },
  }, '🧲');
  leftRail.appendChild(magnetBtn);
  workspaceBody.appendChild(leftRail);

  // Center Chart Canvas Container
  chartContainer = h('div', {
    class: 'tv-center-pane',
    style: {
      flex: '1',
      position: 'relative',
      minHeight: compact ? '420px' : '550px',
      direction: 'ltr', // STRICT LTR ISOLATION FOR FINANCIAL CANVAS & AXES!
    },
  });

  // Crosshair HUD (OHLC + Volume Legend)
  hudEl = h('div', {
    class: 'tv-hud',
    style: {
      position: 'absolute',
      top: '10px',
      left: '12px',
      zIndex: '8',
      display: 'flex',
      gap: '12px',
      fontSize: '12px',
      fontFamily: 'monospace',
      background: 'rgba(9, 15, 26, 0.85)',
      padding: '4px 10px',
      borderRadius: '6px',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      pointerEvents: 'none',
      color: '#cbd5e1',
    },
  },
    h('span', { style: { fontWeight: '700', color: '#38bdf8' }, text: state.symbol }),
    h('span', { class: 'hud-open', text: 'O: —' }),
    h('span', { class: 'hud-high', text: 'H: —' }),
    h('span', { class: 'hud-low', text: 'L: —' }),
    h('span', { class: 'hud-close', text: 'C: —' }),
    h('span', { class: 'hud-vol', text: 'V: —' }),
  );
  chartContainer.appendChild(hudEl);

  // Live Candle Close Countdown Badge (top right of chart)
  const countdownBadge = h('div', {
    class: 'tv-countdown-badge',
    style: {
      position: 'absolute',
      top: '10px',
      right: '65px',
      zIndex: '8',
      fontSize: '11px',
      fontFamily: 'monospace',
      background: 'rgba(15, 23, 42, 0.85)',
      color: '#94a3b8',
      padding: '3px 8px',
      borderRadius: '5px',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      pointerEvents: 'none',
    },
  }, '⏱ סגירת נר: --:--');
  chartContainer.appendChild(countdownBadge);

  // Overlay SVG for User Vector Drawings & Gann Projections
  overlaySvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  overlaySvg.style.position = 'absolute';
  overlaySvg.style.inset = '0';
  overlaySvg.style.width = '100%';
  overlaySvg.style.height = '100%';
  overlaySvg.style.pointerEvents = 'none';
  overlaySvg.style.zIndex = '5';
  chartContainer.appendChild(overlaySvg);

  workspaceBody.appendChild(chartContainer);

  // Right-Side Slide-out Drawer (Layers, Indicators, AI Forecast)
  const rightDrawer = h('div', {
    class: 'tv-right-drawer',
    style: {
      width: '280px',
      background: 'rgba(15, 23, 42, 0.98)',
      borderRight: '1px solid rgba(255, 255, 255, 0.08)',
      display: 'none',
      flexDirection: 'column',
      padding: '12px',
      gap: '12px',
      zIndex: '9',
      overflowY: 'auto',
    },
  });

  function toggleRightDrawer(tab = 'layers') {
    state.activeDrawerTab = tab;
    state.rightDrawerOpen = rightDrawer.style.display === 'none' || state.activeDrawerTab !== tab ? true : !state.rightDrawerOpen;
    rightDrawer.style.display = state.rightDrawerOpen ? 'flex' : 'none';
    renderDrawerContent();
  }

  function renderDrawerContent() {
    rightDrawer.textContent = '';

    // Header
    const head = h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center' } },
      h('h3', { style: { margin: '0', fontSize: '14px', color: '#f8fafc' }, text: 'ניהול שכבות ואינדיקטורים' }),
      h('button', {
        class: 'btn btn-ghost btn-sm',
        style: { padding: '2px 6px' },
        onclick: () => {
          rightDrawer.style.display = 'none';
          state.rightDrawerOpen = false;
        },
      }, '✕'),
    );
    rightDrawer.appendChild(head);

    // Proprietary Overlays section
    const propSection = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
      h('div', { class: 'small muted', style: { fontWeight: '700' }, text: 'שכבות גאן וניתוח ייחודי' }),
      createLayerRow('שמיניות גאן (1/8 ... 8/8)', state.layers.gannEighths, (val) => {
        state.layers.gannEighths = val;
        applyGannEighthsToChart(tvEngine, state.analysis?.jenkins?.eighths || [], { visible: val });
      }),
      createLayerRow('איתותי סווינג (ST / SB)', state.layers.swings, (val) => {
        state.layers.swings = val;
        if (val && state.analysis?.subTrendSignals) {
          const markers = buildSwingMarkers(state.analysis.subTrendSignals, { threshold: state.swingStrengthThreshold });
          swingMarkerPrimitive = applySwingMarkersToSeries(tvEngine?.mainSeries, markers, swingMarkerPrimitive);
        } else {
          applySwingMarkersToSeries(tvEngine?.mainSeries, []);
        }
      }),
      // Swing strength slider
      h('div', { style: { padding: '4px 0', fontSize: '11px', color: '#94a3b8' } },
        h('span', { text: `סף סינון סווינג (חוזק: ${state.swingStrengthThreshold})` }),
        h('input', {
          type: 'range',
          min: '0',
          max: '4',
          step: '1',
          value: String(state.swingStrengthThreshold),
          style: { width: '100%', marginTop: '4px' },
          oninput: (e) => {
            state.swingStrengthThreshold = Number(e.target.value);
            if (state.layers.swings && state.analysis?.subTrendSignals) {
              const markers = buildSwingMarkers(state.analysis.subTrendSignals, { threshold: state.swingStrengthThreshold });
              swingMarkerPrimitive = applySwingMarkersToSeries(tvEngine?.mainSeries, markers, swingMarkerPrimitive);
            }
          },
        }),
      ),
    );
    rightDrawer.appendChild(propSection);

    // Technical Indicators section
    const indSection = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '10px' } },
      h('div', { class: 'small muted', style: { fontWeight: '700' }, text: 'אינדיקטורים טכניים פעילים' }),
      createLayerRow('EMA 20 (כחול)', state.layers.ema20, (v) => { state.layers.ema20 = v; tvEngine?.setIndicator('ema20', v); }),
      createLayerRow('EMA 50 (צהוב)', state.layers.ema50, (v) => { state.layers.ema50 = v; tvEngine?.setIndicator('ema50', v); }),
      createLayerRow('EMA 200 (ורוד)', state.layers.ema200, (v) => { state.layers.ema200 = v; tvEngine?.setIndicator('ema200', v); }),
      createLayerRow('VWAP (כתום)', state.layers.vwap, (v) => { state.layers.vwap = v; tvEngine?.setIndicator('vwap', v); }),
      createLayerRow('Bollinger Bands', state.layers.bollinger, (v) => { state.layers.bollinger = v; tvEngine?.setIndicator('bollinger', v); }),
      createLayerRow('RSI (14)', state.layers.rsi, (v) => { state.layers.rsi = v; tvEngine?.setIndicator('rsi', v); }),
    );
    rightDrawer.appendChild(indSection);
  }

  function createLayerRow(label, active, onToggle) {
    const row = h('div', {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '5px 8px',
        background: 'rgba(255, 255, 255, 0.03)',
        borderRadius: '6px',
        fontSize: '12px',
      },
    },
      h('span', { text: label }),
      h('input', {
        type: 'checkbox',
        checked: active,
        onchange: (e) => onToggle(e.target.checked),
      }),
    );
    return row;
  }

  workspaceBody.appendChild(rightDrawer);
  root.appendChild(workspaceBody);

  // 4. Bottom Quick Range & Scale Selector
  const bottomBar = h('div', {
    class: 'tv-bottom-bar',
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '6px 14px',
      background: 'rgba(15, 23, 42, 0.95)',
      borderTop: '1px solid rgba(255, 255, 255, 0.08)',
      fontSize: '11px',
    },
  },
    h('div', { class: 'row', style: { gap: '4px' } },
      ['1D', '5D', '1M', '3M', '6M', '1Y', 'All'].map((rng) =>
        h('button', {
          class: 'btn btn-ghost btn-sm',
          style: { padding: '2px 6px', fontSize: '11px' },
          onclick: () => {
            if (tvEngine) tvEngine.fitContent();
          },
        }, rng)
      )
    ),
    h('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } },
      h('button', {
        class: 'btn btn-ghost btn-sm',
        style: { padding: '2px 8px', fontSize: '11px' },
        onclick: (e) => {
          if (tvEngine) {
            const isLog = tvEngine.toggleLogScale();
            e.target.style.color = isLog ? '#38bdf8' : '#cbd5e1';
          }
        },
      }, 'Log'),
      h('button', {
        class: 'btn btn-ghost btn-sm',
        style: { padding: '2px 8px', fontSize: '11px', color: '#10b981' },
        onclick: () => {
          if (tvEngine) tvEngine.fitContent();
        },
      }, 'Auto'),
    ),
  );
  root.appendChild(bottomBar);

  // Indicators Picker Modal
  function openIndicatorModal() {
    const content = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px', minWidth: '320px' } },
      h('h3', { style: { margin: '0', fontSize: '16px' }, text: 'הוסף אינדיקטור לגרף' }),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        [
          { id: 'ema20', name: 'EMA 20 · ממוצע נע אקספוננציאלי קצר', cat: 'Trend' },
          { id: 'ema50', name: 'EMA 50 · ממוצע נע מגמתי', cat: 'Trend' },
          { id: 'ema200', name: 'EMA 200 · ממוצע נע ראשי (מוסדי)', cat: 'Trend' },
          { id: 'sma20', name: 'SMA 20 · ממוצע נע פשוט', cat: 'Trend' },
          { id: 'vwap', name: 'VWAP · ממוצע מחיר משוקלל נפח', cat: 'Volume' },
          { id: 'bollinger', name: 'Bollinger Bands (20, 2) · רצועות בולינג׳ר', cat: 'Volatility' },
          { id: 'rsi', name: 'RSI (14) · מדד עוצמה יחסית עם פסי 70/30', cat: 'Momentum' },
        ].map((item) =>
          h('div', {
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 10px',
              background: 'rgba(255, 255, 255, 0.04)',
              borderRadius: '8px',
            },
          },
            h('div', {},
              h('div', { style: { fontWeight: '600', fontSize: '13px' }, text: item.name }),
              h('div', { class: 'small muted', text: item.cat }),
            ),
            h('button', {
              class: `btn btn-sm ${state.layers[item.id] ? 'btn-primary' : 'btn-ghost'}`,
              style: { padding: '3px 10px', fontSize: '11px' },
              onclick: (e) => {
                state.layers[item.id] = !state.layers[item.id];
                tvEngine?.setIndicator(item.id, state.layers[item.id]);
                e.target.textContent = state.layers[item.id] ? 'הסר' : 'הוסף';
                e.target.className = `btn btn-sm ${state.layers[item.id] ? 'btn-primary' : 'btn-ghost'}`;
                toast(`${item.name.split('·')[0].trim()} ${state.layers[item.id] ? 'נוסף' : 'הוסר'}`, 'ok');
              },
            }, state.layers[item.id] ? 'הסר' : 'הוסף')
          )
        )
      )
    );
    openModal(content);
  }

  // Initialize Lightweight Charts Engine
  setTimeout(() => {
    try {
      tvEngine = new TVChartEngine(chartContainer, {
        chartType: state.chartType,
        tf: state.tf,
        onCrosshairMove: (data) => {
          if (!hudEl) return;
          if (!data || !data.ohlc) {
            hudEl.querySelector('.hud-open').textContent = 'O: —';
            hudEl.querySelector('.hud-high').textContent = 'H: —';
            hudEl.querySelector('.hud-low').textContent = 'L: —';
            hudEl.querySelector('.hud-close').textContent = 'C: —';
            hudEl.querySelector('.hud-vol').textContent = 'V: —';
            return;
          }
          const { open, high, low, close } = data.ohlc;
          hudEl.querySelector('.hud-open').textContent = `O: ${formatPrice(open)}`;
          hudEl.querySelector('.hud-high').textContent = `H: ${formatPrice(high)}`;
          hudEl.querySelector('.hud-low').textContent = `L: ${formatPrice(low)}`;
          hudEl.querySelector('.hud-close').textContent = `C: ${formatPrice(close)}`;
          hudEl.querySelector('.hud-vol').textContent = data.volume != null ? `V: ${Number(data.volume).toFixed(1)}` : '';
        },
      });

      drawingManager = new DrawingManager(overlaySvg, tvEngine, { symbol: state.symbol, tf: state.tf });

      if (state.candles?.length) {
        tvEngine.setData(state.candles);
        tvEngine.fitContent();
      }

      // Sync Gann Eighths & Swing Markers
      if (state.analysis) {
        if (state.analysis.jenkins?.eighths) {
          applyGannEighthsToChart(tvEngine, state.analysis.jenkins.eighths, { visible: true });
        }
        if (state.analysis.subTrendSignals) {
          const markers = buildSwingMarkers(state.analysis.subTrendSignals, { threshold: state.swingStrengthThreshold });
          swingMarkerPrimitive = applySwingMarkersToSeries(tvEngine.mainSeries, markers, swingMarkerPrimitive);
        }
      }
    } catch (err) {
      console.warn('[createChartWorkspace] TV Engine init error:', err.message);
    }
  }, 40);

  return {
    element: root,
    updateData: (newCandles, newAnalysis) => {
      state.candles = newCandles;
      state.analysis = newAnalysis;
      if (tvEngine) {
        tvEngine.setData(newCandles);
        if (newAnalysis?.jenkins?.eighths) {
          applyGannEighthsToChart(tvEngine, newAnalysis.jenkins.eighths, { visible: !state.overlaysHidden });
        }
        if (newAnalysis?.subTrendSignals) {
          const markers = buildSwingMarkers(newAnalysis.subTrendSignals, { threshold: state.swingStrengthThreshold });
          swingMarkerPrimitive = applySwingMarkersToSeries(tvEngine.mainSeries, markers, swingMarkerPrimitive);
        }
      }
    },
    destroy: () => {
      if (tvEngine) tvEngine.destroy();
    },
  };
}
