// Dedicated Fundamental Analysis Module (#/fundamentals)
// Analyzes US Stocks (SEC EDGAR XBRL) & Crypto (CoinGecko) + Macro (^VIX, ^TNX, DXY)
// using Graham, Buffett, Lynch & Dalio methodologies with visual SVG infographics & live news.

import { store } from '../store.js';
import { chat as llmChat } from '../llm.js';
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

// ---------- Responsive HTML infographic (no fixed-width SVG => no clipped labels) ----------
function scoreColor(s) { return s >= 68 ? '#2ecc71' : s >= 48 ? '#3b82f6' : '#f05b5b'; }

function barRow(label, valueText, pctFill, color) {
  return h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(110px, 38%) 1fr auto', gap: '10px', alignItems: 'center', margin: '9px 0' } },
    h('div', { style: { color: '#cbd5e1', fontSize: '12.5px', lineHeight: '1.3', overflowWrap: 'anywhere' }, text: label }),
    h('div', { style: { background: '#111c2e', borderRadius: '6px', height: '18px', overflow: 'hidden' } },
      h('div', { style: { width: `${Math.max(2, Math.min(100, pctFill))}%`, height: '100%', background: color, borderRadius: '6px' } })),
    h('div', { class: 'mono', style: { color, fontWeight: '700', fontSize: '12px', whiteSpace: 'nowrap' }, text: valueText }),
  );
}

function renderMethodologyInfographic(methods, item, macro) {
  const left = h('div', { style: { flex: '1 1 320px', minWidth: '0' } },
    h('div', { style: { color: '#e2e8f0', fontWeight: '700', fontSize: '13.5px', marginBottom: '6px' }, text: 'ציון לפי 4 מתודולוגיות העל (0–100)' }),
    ...methods.map((m) => barRow(m.name, `${m.score}/100`, m.score, scoreColor(m.score))),
  );

  let rightRows;
  if (item?.kind === 'stock') {
    const vals = [
      { label: 'הכנסות', val: item.revenue || 0, col: '#3b82f6' },
      { label: 'רווח נקי', val: Math.max(0, item.netIncome || 0), col: '#2ecc71' },
      { label: 'מזומן', val: item.cash || 0, col: '#a78bfa' },
    ];
    const maxV = Math.max(1, ...vals.map((b) => b.val));
    rightRows = vals.map((b) => barRow(b.label, formatCompactUsd(b.val), (b.val / maxV) * 100, b.col));
  } else {
    const vix = macro?.vix ?? 18;
    const tnx = macro?.us10yYield ?? 4.2;
    rightRows = [
      barRow('VIX (מדד הפחד)', `${vix}`, (vix / 40) * 100, vix > 25 ? '#f05b5b' : '#2ecc71'),
      barRow('תשואת אג"ח 10Y', `${tnx}%`, (tnx / 6) * 100, tnx > 4.7 ? '#f2cc60' : '#3b82f6'),
      barRow('ציון כולל', `${item?.score ?? 50}`, item?.score ?? 50, '#a78bfa'),
    ];
  }
  const right = h('div', { style: { flex: '1 1 320px', minWidth: '0' } },
    h('div', { style: { color: '#e2e8f0', fontWeight: '700', fontSize: '13.5px', marginBottom: '6px' },
      text: item?.kind === 'stock' ? 'מבנה מאזן ורווחיות (SEC EDGAR)' : 'מדדי מאקרו ונזילות (Macro Regime)' }),
    ...rightRows,
  );

  return h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '24px', padding: '16px', background: 'linear-gradient(180deg, #0b1220, #070c14)', borderRadius: '12px' } }, left, right);
}

// ---------- Smart AI analyst: per-asset summary, news refresh, Q&A ----------
const ANALYST_SYSTEM = 'אתה אנליסט פונדמנטלי בכיר בעברית. השתמש אך ורק בנתונים שסופקו לך בהקשר. אם נתון חסר — אמור זאת במפורש ואל תמציא. היה תמציתי וברור, הסבר מושגים בפשטות כמו מורה פרטי. זה לא ייעוץ השקעות.';
let aiState = { summaries: {}, chats: {}, draft: '', busy: false, bulk: false, bulkLines: {} };

function buildAssetContext(symbol, item, macro, methods, news) {
  const lines = [`נכס: ${symbol}${item?.entityName ? ` (${item.entityName})` : ''}`];
  if (item) {
    lines.push(`ציון פונדמנטלי כולל: ${item.score}/100 (${item.bias})`);
    if (item.kind === 'stock') {
      lines.push(`P/E: ${item.pe ?? 'לא ידוע'} · שולי רווח נקי: ${item.netMarginPct ?? 'לא ידוע'}% · הכנסות: ${formatCompactUsd(item.revenue)} · רווח נקי: ${formatCompactUsd(item.netIncome)} · מזומן: ${formatCompactUsd(item.cash)}`);
    } else {
      lines.push(`שווי שוק: ${formatCompactUsd(item.marketCap)} · שינוי 30 יום: ${item.change30dPct ?? 'לא ידוע'}% · מרחק משיא: ${item.athDrawdownPct ?? 'לא ידוע'}%`);
    }
  }
  if (methods?.length) lines.push('מתודולוגיות: ' + methods.map((m) => `${m.name}=${m.score}/100`).join('; '));
  if (macro?.ok) lines.push(`מאקרו: משטר ${macro.regime}, VIX ${macro.vix ?? '—'}, תשואת 10Y ${macro.us10yYield ?? '—'}%, DXY ${macro.dxy ?? '—'}`);
  if (news?.length) lines.push('כותרות חדשות אחרונות:\n' + news.slice(0, 6).map((n, i) => `${i + 1}. ${n.title}`).join('\n'));
  return lines.join('\n');
}

async function aiSummarize(symbol, ui, { refreshNews = false } = {}) {
  if (aiState.busy) return;
  aiState.busy = true;
  ui.rerender();
  try {
    if (refreshNews) fundViewState.newsBySymbol[symbol] = await fetchAssetNews(symbol);
    const st = store.state.fundamentals || {};
    const item = st.assets?.[symbol] || null;
    const methods = analyzeFundamentalMethodologies(item, st.macro || null);
    const ctx = buildAssetContext(symbol, item, st.macro, methods, fundViewState.newsBySymbol[symbol]);
    const text = await llmChat({
      system: ANALYST_SYSTEM,
      messages: [{ role: 'user', content: `${ctx}\n\nכתוב סיכום חכם: 1) תמונת מצב ב-2 משפטים 2) חוזקות 3) סיכונים 4) מה החדשות האחרונות משנות 5) מה כדאי לעקוב אחריו.` }],
      maxTokens: 450,
    });
    aiState.summaries[symbol] = { text, at: Date.now(), withNews: refreshNews };
  } catch (err) {
    toast(`האנליסט לא הצליח: ${err.message}`, 'bad');
  } finally {
    aiState.busy = false;
    ui.rerender();
  }
}

async function aiAsk(symbol, ui) {
  const q = (aiState.draft || '').trim();
  if (!q || aiState.busy) return;
  aiState.draft = '';
  aiState.busy = true;
  const thread = (aiState.chats[symbol] = aiState.chats[symbol] || []);
  thread.push({ role: 'user', content: q });
  ui.rerender();
  try {
    const st = store.state.fundamentals || {};
    const item = st.assets?.[symbol] || null;
    const methods = analyzeFundamentalMethodologies(item, st.macro || null);
    const ctx = buildAssetContext(symbol, item, st.macro, methods, fundViewState.newsBySymbol[symbol]);
    const history = thread.slice(-8);
    const msgs = history.map((m, i) => (i === 0 && m.role === 'user' ? { role: 'user', content: `הקשר נתונים:\n${ctx}\n\nשאלה: ${m.content}` } : m));
    if (msgs[0]?.role !== 'user') msgs.unshift({ role: 'user', content: `הקשר נתונים:\n${ctx}` });
    const text = await llmChat({ system: ANALYST_SYSTEM, messages: msgs, maxTokens: 400 });
    thread.push({ role: 'assistant', content: text });
  } catch (err) {
    thread.push({ role: 'assistant', content: `⚠️ שגיאה: ${err.message}` });
  } finally {
    aiState.busy = false;
    ui.rerender();
  }
}

async function aiSummarizeAll(ui) {
  if (aiState.bulk) return;
  aiState.bulk = true;
  ui.rerender();
  const st = store.state.fundamentals || {};
  for (const sym of FUNDAMENTAL_ASSETS) {
    const item = st.assets?.[sym];
    if (!item) continue;
    try {
      const methods = analyzeFundamentalMethodologies(item, st.macro || null);
      aiState.bulkLines[sym] = await llmChat({
        system: ANALYST_SYSTEM,
        messages: [{ role: 'user', content: `${buildAssetContext(sym, item, st.macro, methods, null)}\n\nסכם במשפט אחד קצר (עד 25 מילים) את התמונה הפונדמנטלית.` }],
        maxTokens: 90,
      });
    } catch (err) {
      aiState.bulkLines[sym] = `⚠️ ${err.message}`;
    }
    ui.rerender();
  }
  aiState.bulk = false;
  ui.rerender();
}

function renderAiAnalyst(symbol, item, ui) {
  const sum = aiState.summaries[symbol];
  const thread = aiState.chats[symbol] || [];
  const st = store.state.fundamentals || {};
  const box = { background: 'rgba(15, 29, 48, 0.92)', borderRadius: '10px', padding: '12px', lineHeight: '1.6', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
  return h('div', { class: 'card', style: { marginTop: '14px', borderColor: 'rgba(56, 189, 248, 0.45)' } },
    h('div', { class: 'card-head', style: { flexWrap: 'wrap', gap: '8px' } },
      h('div', {},
        h('h2', { text: `🧠 אנליסט AI — ${item?.entityName || symbol}` }),
        h('div', { class: 'card-sub', text: 'סיכום חכם לנכס, עדכון חדשות לפי דרישה, ושאלות חופשיות. מבוסס על הנתונים שבמסך בלבד.' }),
      ),
      h('div', { class: 'row wrap', style: { gap: '6px' } },
        h('button', { class: 'btn btn-sm btn-primary', disabled: aiState.busy, onclick: () => aiSummarize(symbol, ui) }, aiState.busy ? '⏳ חושב…' : '✨ סכם נכס'),
        h('button', { class: 'btn btn-sm', disabled: aiState.busy, onclick: () => aiSummarize(symbol, ui, { refreshNews: true }) }, '📰 עדכן חדשות וסכם'),
      ),
    ),
    sum ? h('div', { style: box },
      h('div', { class: 'tiny muted', style: { marginBottom: '6px' }, text: `${sum.withNews ? 'כולל חדשות מעודכנות · ' : ''}${timeAgo(sum.at)}` }),
      sum.text,
    ) : h('div', { class: 'small muted', text: 'לחץ על "סכם נכס" כדי לקבל סיכום חכם, או שאל שאלה למטה.' }),

    h('div', { style: { marginTop: '12px' } },
      ...thread.map((m) => h('div', { style: { ...box, margin: '6px 0', background: m.role === 'user' ? 'rgba(59, 130, 246, 0.16)' : box.background } },
        h('div', { class: 'tiny muted', text: m.role === 'user' ? 'אתה' : 'האנליסט' }), m.content)),
      h('div', { class: 'row', style: { gap: '8px', marginTop: '8px' } },
        h('input', {
          class: 'input', style: { flex: '1' }, placeholder: `שאל על ${symbol}: למה הציון נמוך? מה המשמעות של P/E?`, value: aiState.draft,
          oninput: (e) => { aiState.draft = e.target.value; },
          onkeydown: (e) => { if (e.key === 'Enter') aiAsk(symbol, ui); },
        }),
        h('button', { class: 'btn btn-sm btn-primary', disabled: aiState.busy, onclick: () => aiAsk(symbol, ui) }, 'שאל'),
      ),
    ),

    h('div', { style: { marginTop: '16px' } },
      h('div', { class: 'row between', style: { marginBottom: '6px' } },
        h('strong', { text: 'סקירה מהירה של כל הנכסים' }),
        h('button', { class: 'btn btn-sm', disabled: aiState.bulk || aiState.busy, onclick: () => aiSummarizeAll(ui) }, aiState.bulk ? '⏳ מסכם…' : 'סכם את כולם'),
      ),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('tbody', {}, FUNDAMENTAL_ASSETS.map((s) => {
          const a = st.assets?.[s];
          return h('tr', {},
            h('td', { class: 'mono', style: { fontWeight: '700', whiteSpace: 'nowrap' }, text: s }),
            h('td', {}, a ? tag(`${a.score}/100`, a.score >= 62 ? 'live' : 'opt') : '—'),
            h('td', { class: 'small', style: { overflowWrap: 'anywhere' }, text: aiState.bulkLines[s] || '' }));
        })),
      )),
    ),
  );
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
      renderMethodologyInfographic(methods, item, macro),
    ),
  );

  // Smart AI analyst (summary, news refresh, Q&A)
  mount(root, renderAiAnalyst(fundViewState.symbol, item, ui));

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
