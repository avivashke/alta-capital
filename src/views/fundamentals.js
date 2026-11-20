// Dedicated Fundamental Analysis Module (#/fundamentals)
// Analyzes US Stocks (SEC EDGAR XBRL) & Crypto (CoinGecko) + Macro (^VIX, ^TNX, DXY)
// using Graham, Buffett, Lynch & Dalio methodologies with visual SVG infographics & live news.

import { store } from '../store.js';
import { h, mount, num, pct, tag, notice, empty, timeAgo, toast } from '../ui.js';
import {
  FUNDAMENTAL_ASSETS,
  refreshFundamentals,
  analyzeFundamentalMethodologies,
  fetchAssetNews,
  formatCompactUsd,
} from '../fundamentals.js';
import {
  fetchXAgentStatus,
  launchXAgentLogin,
  runXAgentScan,
  saveXAgentConfig,
} from '../x_agent.js';

let fundViewState = {
  symbol: 'NVDA',
  loading: false,
  newsLoading: false,
  newsBySymbol: {},
  xStatus: null,
  xStatusLoading: false,
  xStatusFetchedAt: 0,
  xScanning: false,
  xLoginWaiting: false,
  xShowConfig: false,
  xAssetFilter: 'ALL',
  xPollTimer: null,
};

function svgEl(tagName, attrs, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tagName);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
  if (text != null) node.textContent = text;
  return node;
}

// Visual SVG Infographic: 4 Methodologies Gauge + Financial / Macro Diagram
function renderMethodologySvg(methods, item, macro) {
  const width = 920;
  const height = 240;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.style.width = '100%';
  svg.style.height = 'auto';
  svg.style.display = 'block';
  svg.style.background = 'linear-gradient(180deg, #0b1220, #070c14)';
  svg.style.borderRadius = '12px';

  // Left: 4 Methodology Score Gauges
  svg.appendChild(svgEl('text', { x: 24, y: 24, fill: '#e2e8f0', 'font-size': '13', 'font-weight': '700' }, 'ציון לפי 4 מתודולוגיות העל (0–100)'));
  methods.forEach((m, i) => {
    const y = 46 + i * 44;
    const barW = 240;
    const fillW = Math.round((m.score / 100) * barW);
    const col = m.score >= 68 ? '#2ecc71' : m.score >= 48 ? '#3b82f6' : '#f05b5b';
    svg.appendChild(svgEl('text', { x: 24, y: y + 14, fill: '#cbd5e1', 'font-size': '11' }, m.name));
    svg.appendChild(svgEl('rect', { x: 210, y, width: barW, height: 18, rx: 5, fill: '#111c2e' }));
    svg.appendChild(svgEl('rect', { x: 210, y, width: fillW, height: 18, rx: 5, fill: col }));
    svg.appendChild(svgEl('text', { x: 460, y: y + 14, fill: col, 'font-size': '11.5', 'font-weight': '700' }, `${m.score}/100`));
  });

  // Right: Balance Sheet / Macro Visual Diagram
  const rx = 540;
  svg.appendChild(svgEl('text', { x: rx, y: 24, fill: '#e2e8f0', 'font-size': '13', 'font-weight': '700' },
    item?.kind === 'stock' ? 'מבנה מאזן ורווחיות (SEC EDGAR)' : 'מדדי מאקרו ונזילות (Macro Regime)'));

  if (item?.kind === 'stock') {
    const bars = [
      { label: 'הכנסות', val: item.revenue || 0, col: '#3b82f6' },
      { label: 'רווח נקי', val: Math.max(0, item.netIncome || 0), col: '#2ecc71' },
      { label: 'מזומן', val: item.cash || 0, col: '#a78bfa' },
    ];
    const maxV = Math.max(1, ...bars.map((b) => b.val));
    bars.forEach((b, i) => {
      const bx = rx + i * 115;
      const bh = Math.max(8, Math.round((b.val / maxV) * 125));
      const by = 185 - bh;
      svg.appendChild(svgEl('rect', { x: bx, y: by, width: 68, height: bh, rx: 6, fill: b.col }));
      svg.appendChild(svgEl('text', { x: bx + 34, y: by - 6, fill: '#e2e8f0', 'font-size': '10', 'text-anchor': 'middle' }, formatCompactUsd(b.val)));
      svg.appendChild(svgEl('text', { x: bx + 34, y: 206, fill: '#94a3b8', 'font-size': '10.5', 'text-anchor': 'middle' }, b.label));
    });
  } else {
    const vix = macro?.vix ?? 18;
    const tnx = macro?.us10yYield ?? 4.2;
    const items = [
      { label: 'VIX (פחד)', val: `${vix}`, pct: Math.min(100, (vix / 40) * 100), col: vix > 25 ? '#f05b5b' : '#2ecc71' },
      { label: 'תשואת 10Y', val: `${tnx}%`, pct: Math.min(100, (tnx / 6) * 100), col: tnx > 4.7 ? '#f2cc60' : '#3b82f6' },
      { label: 'ציון כולל', val: `${item?.score ?? 50}`, pct: item?.score ?? 50, col: '#a78bfa' },
    ];
    items.forEach((it, i) => {
      const y = 55 + i * 52;
      svg.appendChild(svgEl('text', { x: rx, y: y + 13, fill: '#cbd5e1', 'font-size': '11' }, it.label));
      svg.appendChild(svgEl('rect', { x: rx + 95, y, width: 190, height: 18, rx: 5, fill: '#111c2e' }));
      svg.appendChild(svgEl('rect', { x: rx + 95, y, width: Math.round((it.pct / 100) * 190), height: 18, rx: 5, fill: it.col }));
      svg.appendChild(svgEl('text', { x: rx + 295, y: y + 13, fill: '#e2e8f0', 'font-size': '11', 'font-weight': '700' }, it.val));
    });
  }

  return svg;
}

async function loadNews(symbol, ui) {
  if (fundViewState.newsLoading) return;
  fundViewState.newsLoading = true;
  ui.rerender();
  try {
    const items = await fetchAssetNews(symbol);
    fundViewState.newsBySymbol[symbol] = items;
  } finally {
    fundViewState.newsLoading = false;
    ui.rerender();
  }
}

async function refreshXStatus(ui, { silent = false } = {}) {
  if (fundViewState.xStatusLoading) return;
  fundViewState.xStatusLoading = true;
  if (!silent) ui.rerender();
  try {
    const st = await fetchXAgentStatus();
    const wasWaiting = fundViewState.xLoginWaiting;
    fundViewState.xStatus = st;
    fundViewState.xStatusFetchedAt = Date.now();
    if (wasWaiting && !st.job?.busy) {
      fundViewState.xLoginWaiting = false;
      if (fundViewState.xPollTimer) {
        clearInterval(fundViewState.xPollTimer);
        fundViewState.xPollTimer = null;
      }
      if (st.loggedIn) {
        toast(`רוני מחובר בהצלחה ל-X כ-${st.loggedInHandle}! אפשר להפעיל סריקה עכשיו.`, 'ok');
      } else if (st.job?.lastError) {
        toast(st.job.lastError, 'bad');
      }
    }
  } finally {
    fundViewState.xStatusLoading = false;
    ui.rerender();
  }
}

function renderXBrowserAgentSection(ui) {
  const st = fundViewState.xStatus;
  const report = st?.latestReport || store.state.xResearch || null;
  const connected = !!st?.connected;
  const pwReady = !!st?.playwrightInstalled;
  const loggedIn = !!st?.loggedIn;
  const busy = fundViewState.xScanning || fundViewState.xLoginWaiting || !!st?.job?.busy;
  const cfg = st?.config || {
    visibleBrowser: true,
    includeHomeFeed: true,
    autoScanMinutes: 0,
    queries: [],
    handles: [],
  };

  const handleLoginClick = async () => {
    const res = await launchXAgentLogin();
    if (!res?.ok) {
      toast(res?.error || 'לא ניתן לפתוח את דפדפן ההתחברות', 'bad');
      return;
    }
    fundViewState.xLoginWaiting = true;
    toast(res.message || 'נפתח חלון דפדפן במחשב שלך — התחבר לחשבון X שיצרת לרוני.', 'ok');
    if (fundViewState.xPollTimer) clearInterval(fundViewState.xPollTimer);
    fundViewState.xPollTimer = setInterval(() => {
      refreshXStatus(ui, { silent: true });
    }, 3500);
    ui.rerender();
  };

  const handleScanClick = async () => {
    if (fundViewState.xScanning) return;
    fundViewState.xScanning = true;
    ui.rerender();
    try {
      const res = await runXAgentScan({ visibleBrowser: cfg.visibleBrowser !== false });
      if (res?.ok && res.report) {
        toast(`רוני השלים סריקה ב-X: ${res.report.totalPosts} ציוצי אמת (${res.report.overallBias})`, 'ok');
        await refreshXStatus(ui, { silent: true });
      } else {
        toast(res?.error || res?.reason || 'סריקת X לא הושלמה', 'bad');
      }
    } finally {
      fundViewState.xScanning = false;
      ui.rerender();
    }
  };

  const assetSignals = report?.assetSignals || {};
  const assetList = Object.values(assetSignals).sort((a, b) => (b.mentions || 0) - (a.mentions || 0));
  const allPosts = report?.posts || [];
  const filteredPosts = fundViewState.xAssetFilter === 'ALL'
    ? allPosts
    : allPosts.filter((p) => (p.assets || []).includes(fundViewState.xAssetFilter));

  const setupCmd = 'git pull origin main; npm run setup:x-agent:win';

  return h('div', {
    class: 'card',
    style: {
      marginTop: '14px',
      borderColor: loggedIn ? 'rgba(56, 189, 248, 0.55)' : 'rgba(148, 163, 184, 0.3)',
      background: 'linear-gradient(180deg, rgba(11, 20, 34, 0.96), rgba(8, 13, 24, 0.96))',
    },
  },
    h('div', { class: 'card-head', style: { flexWrap: 'wrap', gap: '10px' } },
      h('div', {},
        h('h2', { text: '𝕏 רוני — סוכן מחקר פונדמנטלי בדפדפן X על המחשב שלך' }),
        h('div', { class: 'card-sub', text: 'נכנס לדפדפן האמיתי (Chrome / Edge) עם משתמש ה-X הייעודי שיצרת לו, סורק את הפיד שלך ושאילתות מאקרו/דוחות בקריאה בלבד, ומפיק ניתוח פונדמנטלי מאומת עם קישורים ישירים לכל ציוץ.' }),
      ),
      h('div', { class: 'row wrap', style: { gap: '6px' } },
        tag(connected ? `🖥️ שרת בסיס מחובר` : '☁️ מצב ענן / שרת מקומי כבוי', connected ? 'live' : 'opt'),
        connected
          ? tag(pwReady ? `🌐 דפדפן מוכן (${(st.detectedBrowsers?.[0]?.label) || 'Chromium'})` : '⚙ נדרשת התקנת Playwright', pwReady ? 'live' : 'red')
          : null,
        tag(loggedIn ? `𝕏 מחובר: ${st.loggedInHandle}` : '🔒 ממתין להתחברות X', loggedIn ? 'live' : 'opt'),
      ),
    ),

    // Controls Strip
    h('div', { class: 'row wrap', style: { gap: '8px', marginBottom: '12px' } },
      h('button', {
        class: 'btn btn-sm btn-primary',
        disabled: !connected || !pwReady || busy,
        onclick: handleLoginClick,
      }, fundViewState.xLoginWaiting ? '⏳ ממתין שתתחבר בחלון הדפדפן…' : (loggedIn ? `🔐 החלף / רענן התחברות (${st.loggedInHandle})` : '🔐 פתח דפדפן להתחברות ל-X')),
      h('button', {
        class: 'btn btn-sm',
        style: { borderColor: 'rgba(46, 204, 113, 0.55)', color: '#86efac' },
        disabled: !connected || !pwReady || !loggedIn || busy,
        onclick: handleScanClick,
      }, fundViewState.xScanning ? '⏳ רוני גולש ב-X ומנתח…' : '𝕏 הפעל סריקת מחקר פונדמנטלי ב-X עכשיו'),
      h('button', {
        class: 'btn btn-sm',
        disabled: !connected,
        onclick: () => {
          fundViewState.xShowConfig = !fundViewState.xShowConfig;
          ui.rerender();
        },
      }, fundViewState.xShowConfig ? '✕ סגור הגדרות' : '⚙️ הגדרות שאילתות ודפדפן'),
      h('button', {
        class: 'btn btn-sm',
        disabled: fundViewState.xStatusLoading,
        onclick: () => refreshXStatus(ui),
      }, fundViewState.xStatusLoading ? '⏳ בודק…' : '⟳ בדוק סטטוס'),
    ),

    // First-time setup guide when Base Server or Playwright isn't ready yet
    (!connected || !pwReady)
      ? h('div', { class: 'notice', style: { marginBottom: '12px', fontSize: '12.5px' } },
          h('div', {
            style: { fontWeight: '700', marginBottom: '6px' },
            text: !connected
              ? 'כדי שרוני יוכל לפתוח דפדפן על המחשב שלך, פתח את Alta Capital דרך שרת הבסיס המקומי (http://localhost:8181) או ודא שהוא פועל.'
              : 'התקנה חד-פעמית קצרה של מנוע הדפדפן (משתמש ב-Chrome/Edge שכבר מותקן אצלך):',
          }),
          h('div', { class: 'row wrap', style: { gap: '8px', alignItems: 'center' } },
            h('code', { class: 'mono', style: { padding: '6px 10px', borderRadius: '8px', background: 'rgba(0,0,0,0.45)', color: '#93c5fd' }, text: setupCmd }),
            h('button', {
              class: 'btn btn-sm',
              onclick: () => {
                navigator.clipboard?.writeText(setupCmd).then(() => toast('פקודת ההתקנה הועתקה ללוח!', 'ok')).catch(() => {});
              },
            }, '📋 העתק פקודה ל-PowerShell'),
          ),
        )
      : (!loggedIn
        ? notice('שלב אחרון: לחץ על "🔐 פתח דפדפן להתחברות ל-X" — ייפתח אצלך חלון Chrome/Edge אמיתי בפרופיל נפרד ומאובטח של רוני. התחבר פעם אחת עם חשבון ה-X שיצרת עבורו, והסשן יישמר מקומית (לעולם לא עולה ל-GitHub).', 'blue')
        : null),

    // Configurable Watchlist / Browser Mode Panel
    (fundViewState.xShowConfig && connected)
      ? (() => {
          let queriesVal = (cfg.queries || []).join('\n');
          let handlesVal = (cfg.handles || []).join(', ');
          let visibleVal = cfg.visibleBrowser !== false;
          let homeVal = cfg.includeHomeFeed !== false;
          let autoMinVal = Number(cfg.autoScanMinutes) || 0;
          return h('div', { class: 'card', style: { marginBottom: '12px', background: 'rgba(7, 12, 22, 0.9)', padding: '12px' } },
            h('div', { class: 'grid cols-2', style: { gap: '10px' } },
              h('div', {},
                h('label', { class: 'tiny muted', text: 'שאילתות מחקר פונדמנטלי ב-X (שורה לכל שאילתה)' }),
                h('textarea', {
                  class: 'input mono',
                  rows: 5,
                  style: { width: '100%', marginTop: '4px', fontSize: '12px' },
                  value: queriesVal,
                  oninput: (e) => { queriesVal = e.target.value; },
                }),
              ),
              h('div', {},
                h('label', { class: 'tiny muted', text: 'חשבונות X למעקב ישיר (מופרדים בפסיק, בלי @)' }),
                h('input', {
                  class: 'input mono',
                  style: { width: '100%', marginTop: '4px', marginBottom: '8px' },
                  value: handlesVal,
                  oninput: (e) => { handlesVal = e.target.value; },
                }),
                h('label', { class: 'tiny muted', text: 'תדירות סריקה אוטומטית על שרת הבסיס' }),
                h('select', {
                  class: 'input',
                  style: { width: '100%', marginTop: '4px', marginBottom: '8px' },
                  value: String(autoMinVal),
                  onchange: (e) => { autoMinVal = Number(e.target.value) || 0; },
                }, [
                  h('option', { value: '0', selected: autoMinVal === 0 }, 'ידני בלבד'),
                  h('option', { value: '60', selected: autoMinVal === 60 }, 'כל 60 דקות'),
                  h('option', { value: '120', selected: autoMinVal === 120 }, 'כל שעתיים'),
                  h('option', { value: '240', selected: autoMinVal === 240 }, 'כל 4 שעות'),
                ]),
                h('label', { class: 'row', style: { gap: '6px', fontSize: '12px', marginBottom: '4px', cursor: 'pointer' } },
                  h('input', { type: 'checkbox', checked: visibleVal, onchange: (e) => { visibleVal = e.target.checked; } }),
                  h('span', { text: '👁️ הצג דפדפן גלוי על המסך בזמן שרוני סורק' }),
                ),
                h('label', { class: 'row', style: { gap: '6px', fontSize: '12px', cursor: 'pointer' } },
                  h('input', { type: 'checkbox', checked: homeVal, onchange: (e) => { homeVal = e.target.checked; } }),
                  h('span', { text: '🏠 סרוק גם את פיד ה-Following של המשתמש שיצרת לרוני' }),
                ),
              ),
            ),
            h('div', { class: 'row', style: { marginTop: '10px', gap: '8px' } },
              h('button', {
                class: 'btn btn-sm btn-primary',
                onclick: async () => {
                  const r = await saveXAgentConfig({
                    queries: queriesVal,
                    handles: handlesVal,
                    visibleBrowser: visibleVal,
                    includeHomeFeed: homeVal,
                    autoScanMinutes: autoMinVal,
                  });
                  if (r?.ok) {
                    toast('הגדרות רוני (חוקר X) נשמרו!', 'ok');
                    fundViewState.xShowConfig = false;
                    await refreshXStatus(ui, { silent: true });
                  } else {
                    toast(r?.error || 'שמירה נכשלה', 'bad');
                  }
                },
              }, '💾 שמור הגדרות רוני'),
            ),
          );
        })()
      : null,

    // Latest Verified X Fundamental Report
    report
      ? h('div', {},
          h('div', { class: 'grid cols-4', style: { gap: '8px', marginBottom: '10px' } },
            h('div', { class: 'metric' }, h('span', { text: 'הטיה פונדמנטלית ב-X' }), h('b', { class: (report.overallScore >= 60 ? 'green ' : report.overallScore <= 40 ? 'red ' : 'gold ') + 'mono', text: `${report.overallScore}/100 · ${report.overallBias}` })),
            h('div', { class: 'metric' }, h('span', { text: 'ציוצי אמת מאומתים' }), h('b', { class: 'mono', text: `${report.totalPosts || allPosts.length} פוסטים` })),
            h('div', { class: 'metric' }, h('span', { text: 'חשבון ודפדפן' }), h('b', { class: 'small mono', text: `${report.loggedInHandle || '—'} · ${report.browser || 'Browser'}` })),
            h('div', { class: 'metric' }, h('span', { text: 'סריקה אחרונה' }), h('b', { class: 'small', text: report.scannedAt ? timeAgo(report.scannedAt) : '—' })),
          ),

          // AI Executive Fundamental Briefing (when Local AI synthesized it)
          report.aiSummary
            ? h('div', { class: 'card', style: { marginBottom: '10px', background: 'rgba(15, 29, 48, 0.92)', borderColor: 'rgba(56, 189, 248, 0.4)', padding: '10px 12px' } },
                h('div', { class: 'row between', style: { marginBottom: '6px' } },
                  h('strong', { style: { color: '#7dd3fc', fontSize: '13px' }, text: '🧠 תדרוך פונדמנטלי מסונתז מציוצי אמת ב-X (מאומת ללא הזיות)' }),
                  tag(`AI מקומי: ${report.aiModel || 'Ollama'}`, 'live'),
                ),
                h('div', { class: 'small', style: { whiteSpace: 'pre-wrap', lineHeight: '1.55', color: '#e2e8f0' }, text: report.aiSummary }),
              )
            : null,

          // Per-Asset Signal Pills (clickable filter!)
          assetList.length
            ? h('div', { class: 'row wrap', style: { gap: '6px', marginBottom: '10px' } },
                h('button', {
                  class: `btn btn-sm ${fundViewState.xAssetFilter === 'ALL' ? 'btn-primary' : ''}`,
                  onclick: () => { fundViewState.xAssetFilter = 'ALL'; ui.rerender(); },
                }, `הכל (${allPosts.length})`),
                ...assetList.map((a) => h('button', {
                  class: `btn btn-sm ${fundViewState.xAssetFilter === a.symbol ? 'btn-primary' : ''}`,
                  style: {
                    borderColor: a.score >= 60 ? 'rgba(46, 204, 113, 0.45)' : a.score <= 40 ? 'rgba(240, 91, 91, 0.45)' : undefined,
                  },
                  onclick: () => { fundViewState.xAssetFilter = a.symbol; ui.rerender(); },
                }, `${a.symbol} · ${a.score}/100 (${a.mentions})`)),
              )
            : null,

          // Verified Real Posts Evidence Table
          filteredPosts.length
            ? h('div', { class: 'table-wrap', style: { maxHeight: '320px', overflowY: 'auto' } },
                h('table', {},
                  h('thead', {}, h('tr', {},
                    h('th', { text: 'חשבון' }),
                    h('th', { text: 'נכסים / זרזים' }),
                    h('th', { text: 'תוכן הציוץ (מקור אמת)' }),
                    h('th', { text: 'סנטימנט' }),
                  )),
                  h('tbody', {}, filteredPosts.slice(0, 25).map((p) => h('tr', {},
                    h('td', { class: 'tiny mono' },
                      h('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer', style: { color: '#7dd3fc', fontWeight: '700' } }, p.handle),
                      h('div', { class: 'muted', text: p.publishedAt ? timeAgo(Date.parse(p.publishedAt)) : '' }),
                    ),
                    h('td', { class: 'tiny' },
                      h('div', { style: { fontWeight: '700', color: '#e2e8f0' }, text: (p.assets || []).join(', ') }),
                      h('div', { class: 'muted', text: (p.catalysts || []).join(' · ') }),
                    ),
                    h('td', { class: 'small' },
                      h('div', { style: { lineHeight: '1.45' }, text: p.text }),
                      h('div', { class: 'tiny muted mono', style: { marginTop: '3px' } },
                        `❤ ${p.metrics?.likes || 0} · 🔁 ${p.metrics?.reposts || 0} · 💬 ${p.metrics?.replies || 0} · `,
                        h('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer', style: { color: '#93c5fd' } }, 'פתח ציוץ מקורי ב-X ↗'),
                      ),
                    ),
                    h('td', {}, tag(p.sentimentLabel || p.sentiment, p.sentiment === 'bullish' ? 'live' : p.sentiment === 'bearish' ? 'red' : 'opt')),
                  ))),
                ),
              )
            : null,
        )
      : h('div', { class: 'tiny muted', text: 'טרם בוצעה סריקת X. לאחר חיבור החשבון של רוני, הדוחות המאומתים יופיעו כאן ויסתנכרנו אוטומטית בין כל המכשירים.' }),
  );
}

export function renderFundamentals(root, ui) {
  const fState = store.state.fundamentals || { updatedAt: null, macro: null, assets: {} };
  const item = fState.assets?.[fundViewState.symbol] || null;
  const macro = fState.macro || null;

  if (!fState.updatedAt && !fundViewState.loading) {
    fundViewState.loading = true;
    refreshFundamentals({ force: false }).finally(() => {
      fundViewState.loading = false;
      ui.rerender();
    });
  }
  if (!fundViewState.newsBySymbol[fundViewState.symbol] && !fundViewState.newsLoading) {
    setTimeout(() => loadNews(fundViewState.symbol, ui), 50);
  }
  if (!fundViewState.xStatusLoading && Date.now() - fundViewState.xStatusFetchedAt > 30000) {
    setTimeout(() => refreshXStatus(ui, { silent: true }), 80);
  }

  const methods = analyzeFundamentalMethodologies(item, macro);
  const news = fundViewState.newsBySymbol[fundViewState.symbol] || [];

  mount(root,
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: 'SEC EDGAR XBRL · CoinGecko · Macro Regime · X Browser Agent (Roni) · Live News' }),
        h('h1', { text: 'מודול ניתוח פונדמנטליסטי וחדשות (Fundamental Lab)' }),
        h('p', { text: 'ניתוח איכות ושווי הוגן לפי 4 מתודולוגיות העל (גרהאם, באפט, לינץ׳ ודליו), סוכן דפדפן X חי (רוני) למחקר פונדמנטלי בזמן אמת וזרם חדשות עם הסבר השפעה.' }),
      ),
      h('div', { class: 'head-actions' },
        h('select', {
          class: 'input',
          value: fundViewState.symbol,
          onchange: (e) => {
            fundViewState.symbol = e.target.value;
            loadNews(fundViewState.symbol, ui);
            ui.rerender();
          },
        }, FUNDAMENTAL_ASSETS.map((s) => h('option', { value: s, selected: fundViewState.symbol === s }, s))),
        h('button', {
          class: 'btn btn-sm btn-primary',
          disabled: fundViewState.loading,
          onclick: async () => {
            fundViewState.loading = true;
            ui.rerender();
            await refreshFundamentals({ force: true });
            await loadNews(fundViewState.symbol, ui);
            fundViewState.loading = false;
            ui.rerender();
          },
        }, fundViewState.loading ? '⏳ מרענן דוחות…' : '⟳ רענן דוחות וחדשות'),
      ),
    ),
  );

  if (macro?.ok) {
    const fx = macro.forex ? ` · מט"ח חי (ECB): EUR/USD ${macro.forex.eurusd ?? '—'} · USD/ILS ${macro.forex.usdils ?? '—'}` : '';
    mount(root, notice(
      `משטר מאקרו נוכחי: ${macro.regime} · מדד הפחד VIX: ${macro.vix ?? '—'} · תשואת אג"ח ארה"ב ל-10 שנים: ${macro.us10yYield ?? '—'}% · דולר DXY: ${macro.dxy ?? '—'}${fx}`,
      'blue',
    ));
  }

  // Roni — Live X (Twitter) Browser Fundamental Research Cockpit
  mount(root, renderXBrowserAgentSection(ui));

  // KPI Summary
  mount(root, h('div', { class: 'grid cols-4', style: { marginTop: '14px' } },
    h('div', { class: 'metric' }, h('span', { text: 'ציון פונדמנטלי כולל' }), h('b', { class: (item?.score >= 60 ? 'green ' : 'gold ') + 'mono', text: item ? `${item.score}/100 (${item.bias})` : 'טוען…' })),
    h('div', { class: 'metric' }, h('span', { text: item?.kind === 'stock' ? 'מכפיל רווח (P/E) · שולי רווח' : 'שווי שוק · שינוי 30 יום' }),
      h('b', { class: 'mono', text: item ? (item.kind === 'stock' ? `P/E ${item.pe ?? '—'} · ${item.netMarginPct ?? '—'}%` : `${formatCompactUsd(item.marketCap)} · ${pct(item.change30dPct || 0)}`) : '—' })),
    h('div', { class: 'metric' }, h('span', { text: item?.kind === 'stock' ? 'הכנסות · מזומן (SEC)' : 'מרחק משיא (ATH)' }),
      h('b', { class: 'mono', text: item ? (item.kind === 'stock' ? `${formatCompactUsd(item.revenue)} · ${formatCompactUsd(item.cash)}` : `${item.athDrawdownPct ?? '—'}%`) : '—' })),
    h('div', { class: 'metric' }, h('span', { text: 'מקור נתונים ועדכון' }), h('b', { class: 'small', text: item ? `${item.source} · ${timeAgo(fState.updatedAt)}` : 'SEC / CoinGecko' })),
  ));

  // Visual SVG Infographic
  mount(root,
    h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'card-head' },
        h('div', {},
          h('h2', { text: `📊 אינפוגרפיקה פונדמנטלית: ${item?.entityName || fundViewState.symbol}` }),
          h('div', { class: 'card-sub', text: 'השוואה ויזואלית בין 4 אסכולות ההשקעה + מבנה מאזן/מאקרו' }),
        ),
        tag(item?.bias || 'מחשב…', item?.score >= 62 ? 'live' : 'opt'),
      ),
      renderMethodologySvg(methods, item, macro),
    ),
  );

  // 4 Methodology Cards with Educational Explanations
  mount(root,
    h('div', { class: 'grid cols-2', style: { marginTop: '14px', gap: '12px' } },
      ...methods.map((m) => h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('h3', { text: m.name }),
          tag(`${m.score}/100`, m.score >= 68 ? 'live' : m.score >= 48 ? 'opt' : 'red'),
        ),
        h('p', { class: 'small muted', text: m.text }),
      )),
    ),
  );

  // Live Financial News with Fundamental Impact Explanations
  mount(root,
    h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'card-head' },
        h('div', {},
          h('h2', { text: `📰 חדשות בזמן אמת והסבר השפעה פונדמנטלית (${fundViewState.symbol})` }),
          h('div', { class: 'card-sub', text: 'כותרות חיות מ-Yahoo Finance, CNBC, MarketWatch והפדרל ריזרב (Fed) עם פירוש המשמעות לשווי החברה' }),
        ),
      ),
      fundViewState.newsLoading
        ? h('div', { class: 'small muted', text: '⏳ טוען חדשות חיות…' })
        : news.length
          ? h('div', { class: 'table-wrap' },
            h('table', {},
              h('thead', {}, h('tr', {}, h('th', { text: 'מקור' }), h('th', { text: 'כותרת החדשה' }), h('th', { text: 'הסבר השפעה פונדמנטלית' }))),
              h('tbody', {}, news.map((n) => h('tr', {},
                h('td', {}, tag(n.source || 'News', 'opt')),
                h('td', { class: 'small' },
                  n.link
                    ? h('a', { href: n.link, target: '_blank', rel: 'noopener noreferrer', style: { color: '#93c5fd', fontWeight: '600' } }, n.title)
                    : h('span', { text: n.title }),
                  h('div', { class: 'tiny muted', text: n.pubDate || '' }),
                ),
                h('td', { class: 'small muted', text: n.impactNote }),
              ))),
            ),
          )
          : empty('לא נמצאו חדשות זמינות כרגע לנכס זה — לחץ על "רענן דוחות וחדשות".'),
    ),
  );
}
