// Dedicated Invo Copy-Trading Rooms & Platform Nesting View (#/invo)
// Connects to Invo, hosts copy-trading rooms mimicking top verified traders (Yigal, Simcha, QuantTitan),
// manages risk limits, and routes profits into Nostro desks and the Vault Portfolio.

import { h, mount, tag, num, pct, openModal, toast } from '../ui.js';
import {
  INVO_TOP_TRADERS,
  getInvoState,
  updateInvoState,
  toggleCopyTrader,
  simulateInvoMirrorExecution,
} from '../invo.js';

export function renderInvo(root, ui) {
  const invoState = getInvoState();

  // Top Page Header
  const header = h('div', { class: 'page-head' },
    h('div', {},
      h('div', { class: 'eyebrow', text: 'Invo Social Copy-Trading & Prop Nesting' },
        tag('Invo Platform Active', 'live'),
      ),
      h('h1', { text: 'חדרי מסחר וחיקוי סוחרי Invo' }),
      h('p', { text: 'חיבור ישיר ו-Nesting לפלטפורמת Invo. חדרי מסחר ייעודיים לחיקוי אוטונומי של הסוחרים המובילים, בדגש על יגאל, שמחה וסוחרי נוסטרו מוכחים.' }),
    ),
    h('div', { class: 'head-actions', style: { gap: '8px', flexWrap: 'wrap' } },
      h('button', {
        class: `btn btn-sm ${invoState.connected ? 'btn-primary' : ''}`,
        onclick: () => openInvoAuthModal(ui),
      }, invoState.connected ? '✓ חשבון Invo מחובר' : '🔗 חבר חשבון Invo'),
      h('button', {
        class: `btn btn-sm ${invoState.nestingOpen ? 'btn-primary' : 'btn-ghost'}`,
        onclick: () => {
          updateInvoState({ nestingOpen: !invoState.nestingOpen });
          ui.rerender();
        },
      }, invoState.nestingOpen ? '✕ סגור Nesting' : '🖥️ פתח Invo מוטמע (Nesting)'),
    ),
  );

  // Key KPI Row
  const totalPnl = invoState.replicatedTrades.reduce((acc, t) => acc + (t.pnlUsd || 0), 0);
  const activeSubs = (invoState.activeSubscriptions || []).length;

  const kpis = h('div', { class: 'grid cols-4', style: { marginTop: '14px' } },
    h('div', { class: 'metric' },
      h('span', { text: 'סך רווח מחיקוי Invo' }),
      h('b', { class: totalPnl >= 0 ? 'green mono' : 'red mono', text: `$${num(totalPnl, 2)}` }),
    ),
    h('div', { class: 'metric' },
      h('span', { text: 'חדרי חיקוי פעילים' }),
      h('b', { class: 'mono', text: `${activeSubs} סוחרים` }),
    ),
    h('div', { class: 'metric' },
      h('span', { text: 'ממוצע Win Rate סוחרים' }),
      h('b', { class: 'green mono', text: '74.2%' }),
    ),
    h('div', { class: 'metric' },
      h('span', { text: 'ניתוב לנוסטרו וקופה' }),
      h('b', { class: 'gold mono', text: invoState.autoMirrorToNostro ? 'פעיל (שולחן Invo Mirror)' : 'כבוי' }),
    ),
  );

  // Optional Nesting Embed Container (Webview / Iframe)
  const nestingContainer = invoState.nestingOpen
    ? h('div', { class: 'card', style: { marginTop: '14px', padding: '10px', background: '#090f1a' } },
        h('div', { class: 'row between', style: { marginBottom: '8px', alignItems: 'center' } },
          h('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } },
            h('span', { style: { fontWeight: '700', fontSize: '13px' }, text: '🖥️ סביבת Invo מוטמעת (Nesting View)' }),
            h('span', { class: 'small muted', text: invoState.targetUrl }),
          ),
          h('div', { class: 'row', style: { gap: '6px' } },
            h('a', {
              href: invoState.targetUrl,
              target: '_blank',
              class: 'btn btn-ghost btn-sm',
              style: { textDecoration: 'none', fontSize: '11px' },
            }, '↗ פתח בכרטיסייה חדשה'),
            h('button', {
              class: 'btn btn-ghost btn-sm',
              style: { padding: '2px 6px' },
              onclick: () => {
                updateInvoState({ nestingOpen: false });
                ui.rerender();
              },
            }, '✕'),
          ),
        ),
        h('iframe', {
          src: invoState.targetUrl,
          style: {
            width: '100%',
            height: '600px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '8px',
            background: '#040711',
          },
          sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups',
        }),
      )
    : null;

  // Copy-Trading Rooms Section
  const roomsSection = h('div', { style: { marginTop: '18px' } },
    h('div', { class: 'card-head' },
      h('div', {},
        h('h2', { text: '👥 חדרי מסחר מבוססי סוחרי Invo המובילים' }),
        h('div', { class: 'card-sub', text: 'בחר סוחר להפעיל חיקוי עסקאות אוטומטי. כל עסקה משוכפלת בזמן אמת ומנותבת לשולחן הנוסטרו ולקופת הרווחים.' }),
      ),
    ),
    h('div', { class: 'grid cols-2', style: { gap: '14px', marginTop: '10px' } },
      INVO_TOP_TRADERS.map((trader) => renderTraderRoomCard(trader, invoState, ui)),
    ),
  );

  // Mirrored Trades Log Table
  const tableSection = h('div', { class: 'card', style: { marginTop: '18px' } },
    h('div', { class: 'card-head' },
      h('h2', { text: '📋 היסטוריית עסקאות ששוכפלו מחדרי Invo' }),
      h('div', { class: 'card-sub', text: 'מעקב עסקאות מועתקות, רווח/הפסד וסטטוס העברה לקופה צדדית' }),
    ),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'table' },
        h('thead', {},
          h('tr', {},
            h('th', { text: 'סוחר מקור' }),
            h('th', { text: 'נכס' }),
            h('th', { text: 'כיוון' }),
            h('th', { text: 'כניסה' }),
            h('th', { text: 'יציאה' }),
            h('th', { text: 'תשואה (%)' }),
            h('th', { text: 'רווח ($)' }),
            h('th', { text: 'יעד ביצוע' }),
            h('th', { text: 'זמן' }),
          ),
        ),
        h('tbody', {},
          invoState.replicatedTrades.map((t) =>
            h('tr', {},
              h('td', { style: { fontWeight: '700', color: '#38bdf8' }, text: t.traderName }),
              h('td', { class: 'mono', text: t.symbol }),
              h('td', {}, tag(t.side, t.side === 'BUY' ? 'active' : 'paused')),
              h('td', { class: 'mono', text: `$${num(t.entry, 2)}` }),
              h('td', { class: 'mono', text: t.exit ? `$${num(t.exit, 2)}` : '—' }),
              h('td', { class: t.pnlPct >= 0 ? 'green mono' : 'red mono', text: `${t.pnlPct >= 0 ? '+' : ''}${num(t.pnlPct, 2)}%` }),
              h('td', { class: t.pnlUsd >= 0 ? 'green mono' : 'red mono', text: `${t.pnlUsd >= 0 ? '+' : ''}$${num(t.pnlUsd, 2)}` }),
              h('td', { text: t.destination }),
              h('td', { class: 'small muted', text: t.time }),
            )
          ),
        ),
      ),
    ),
  );

  mount(root, header, kpis, nestingContainer, roomsSection, tableSection);
}

function renderTraderRoomCard(trader, invoState, ui) {
  const isCopied = (invoState.activeSubscriptions || []).includes(trader.id);

  return h('div', {
    class: 'card',
    style: {
      background: 'rgba(15, 23, 42, 0.65)',
      border: isCopied ? '1px solid #10b981' : '1px solid rgba(255, 255, 255, 0.08)',
      boxShadow: isCopied ? '0 0 20px rgba(16, 185, 129, 0.15)' : 'none',
    },
  },
    h('div', { class: 'card-head', style: { marginBottom: '8px' } },
      h('div', {},
        h('div', { class: 'row', style: { gap: '6px', alignItems: 'center' } },
          h('h3', { style: { margin: '0', fontSize: '15px' }, text: trader.name }),
          tag(trader.badge, 'live'),
        ),
        h('div', { class: 'small muted', text: `${trader.handle} · ${trader.copiers} עוקבים · AUM: ${trader.aum}` }),
      ),
      h('button', {
        class: `btn btn-sm ${isCopied ? 'btn-primary' : 'btn-ghost'}`,
        style: {
          background: isCopied ? 'linear-gradient(90deg, #10b981, #059669)' : 'transparent',
          border: '1px solid rgba(255,255,255,0.15)',
        },
        onclick: () => {
          const nowActive = toggleCopyTrader(trader.id);
          toast(nowActive ? `חדר המסחר של ${trader.name} הופעל לחיקוי אוטומטי!` : `חיקוי ${trader.name} הופסק`, 'ok');
          ui.rerender();
        },
      }, isCopied ? '✓ בחיקוי פעיל' : '＋ הפעל חיקוי (Copy)'),
    ),

    // Bio & Strategy
    h('p', { class: 'small', style: { color: '#cbd5e1', margin: '4px 0 10px' }, text: trader.bio }),

    // Metrics Row
    h('div', { class: 'grid cols-4', style: { gap: '6px', background: 'rgba(0,0,0,0.25)', padding: '8px', borderRadius: '8px' } },
      h('div', { style: { textAlign: 'center' } },
        h('div', { class: 'small muted', text: 'Win Rate' }),
        h('b', { class: 'green mono', text: `${trader.winRate}%` }),
      ),
      h('div', { style: { textAlign: 'center' } },
        h('div', { class: 'small muted', text: 'תשואה 30 יום' }),
        h('b', { class: 'green mono', text: `+${trader.roi30d}%` }),
      ),
      h('div', { style: { textAlign: 'center' } },
        h('div', { class: 'small muted', text: 'Profit Factor' }),
        h('b', { class: 'gold mono', text: num(trader.profitFactor, 2) }),
      ),
      h('div', { style: { textAlign: 'center' } },
        h('div', { class: 'small muted', text: 'Max DD' }),
        h('b', { class: 'mono', text: `${trader.maxDrawdown}%` }),
      ),
    ),

    // Recent Trades in Room
    h('div', { style: { marginTop: '10px' } },
      h('div', { class: 'small muted', style: { fontWeight: '700', marginBottom: '4px' }, text: 'עסקאות אחרונות בחדר:' }),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
        trader.recentTrades.map((tr) =>
          h('div', {
            class: 'row between',
            style: {
              fontSize: '11.5px',
              padding: '4px 8px',
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: '5px',
            },
          },
            h('span', { class: 'mono', style: { color: '#38bdf8' }, text: `${tr.symbol} (${tr.side})` }),
            h('span', { text: `כניסה: $${num(tr.entry, 2)}` }),
            h('span', { class: tr.pnlPct >= 0 ? 'green mono' : 'red mono', text: `${tr.pnlPct >= 0 ? '+' : ''}${num(tr.pnlPct, 2)}%` }),
            h('span', { class: 'small muted', text: tr.time }),
          )
        ),
      ),
    ),
  );
}

function openInvoAuthModal(ui) {
  const current = getInvoState();
  const emailInput = h('input', { class: 'input', type: 'email', value: current.email || '', placeholder: 'user@example.com' });
  const userInput = h('input', { class: 'input', type: 'text', value: current.username || '', placeholder: 'שם משתמש ב-Invo' });
  const tokenInput = h('input', { class: 'input', type: 'password', value: current.apiKey || '', placeholder: 'API Token / Session Cookie' });
  const urlInput = h('input', { class: 'input', type: 'text', value: current.targetUrl || 'https://app.invo.trade' });

  const modalBody = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', minWidth: '340px' } },
    h('h3', { style: { margin: '0' }, text: 'חיבור חשבון פלטפורמת Invo' }),
    h('p', { class: 'small muted', text: 'הזן את פרטי המשתמש או טוקן ה-API שלך ב-Invo. הפרטים נשמרים מקומית בדפדפן ומאפשרים סנכרון חדרים ו-Nesting מאומת.' }),
    h('div', {}, h('label', { class: 'small', text: 'אימייל משתמש ב-Invo:' }), emailInput),
    h('div', {}, h('label', { class: 'small', text: 'שם משתמש Invo:' }), userInput),
    h('div', {}, h('label', { class: 'small', text: 'מפתח API / סשן:' }), tokenInput),
    h('div', {}, h('label', { class: 'small', text: 'כתובת פלטפורמת Invo (URL):' }), urlInput),
    h('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '8px', marginTop: '10px' } },
      h('button', {
        class: 'btn btn-primary',
        onclick: () => {
          updateInvoState({
            connected: true,
            email: emailInput.value.trim(),
            username: userInput.value.trim(),
            apiKey: tokenInput.value.trim(),
            targetUrl: urlInput.value.trim(),
          });
          toast('חשבון Invo חובר בהצלחה! חדרי המסחר מסונכרנים.', 'ok');
          ui.rerender();
        },
      }, 'שמור והתחבר'),
    ),
  );

  openModal(modalBody);
}
