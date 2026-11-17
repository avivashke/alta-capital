import { store } from '../store.js';
import { h, pct, num, money, notice, empty, tag, timeAgo, chart, tradeRow, kpi, openModal, closeModal, toast } from '../ui.js';
import { marketState, quotes } from '../market.js';
import { ensurePaperPortfolio, getPaperPortfolio, analyzeManualClose, manualCloseDesk } from '../firm.js';

function mount(root, ...children) {
  for (const child of children.flat(6)) {
    if (child == null || child === false) continue;
    root.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return root;
}

export function renderPortfolio(root, ui) {
  const state = store.state;
  const s = state.settings;
  const pf = getPaperPortfolio() || ensurePaperPortfolio();
  const report = pf.getReport(quotes);
  const desks = state.desks || [];

  async function onClosePosition(deskId) {
    const analysis = await analyzeManualClose(deskId);
    if (!analysis.ok) { toast(analysis.error || 'לא ניתן לסגור פוזיציה', 'bad'); return; }
    const { desk, price, pnlPct, contradicts, reasons } = analysis;
    const dirText = desk.openTrade?.dir > 0 ? 'לונג' : 'שורט';
    const body = h('div', {},
      h('div', { class: contradicts ? 'notice bad' : 'notice', style: { marginBottom: '10px' } },
        contradicts ? 'הפעולה מנוגדת לאות האסטרטגיה הנוכחי — מומלץ לשקול המתנה' : 'בדיקת סגירה ידנית מול האסטרטגיה'),
      h('div', { class: 'small', style: { marginBottom: '8px' } },
        `${desk.label} · ${dirText} · כניסה ${num(desk.openTrade.entry, 2)} · מחיר נוכחי ${num(price, 2)} · רווח/הפסד ${pct(pnlPct)}`),
      h('div', { style: { marginBottom: '10px' } },
        ...(reasons || []).map((r) => h('div', { class: 'small muted', style: { marginBottom: '6px' }, text: '• ' + r })),
      ),
      h('div', { class: 'row', style: { gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' } },
        h('button', { class: 'btn btn-ghost', onclick: () => closeModal() }, 'המשך להמתין'),
        h('button', {
          class: 'btn ' + (contradicts ? 'btn-danger' : 'btn-primary'),
          onclick: async () => {
            const res = await manualCloseDesk(deskId, contradicts ? 'manual_override' : 'manual');
            closeModal();
            if (res.ok) toast('הפוזיציה נסגרה ידנית (נייר)', 'ok'); else toast(res.error || 'סגירה נכשלה', 'bad');
            ui.rerender();
          },
        }, contradicts ? 'סגור בכל זאת' : 'סגור פוזיציה'),
      ),
    );
    openModal('סגירת פוזיציה ידנית', body);
  }

  const liveDesks = desks.filter((d) => d.status === 'live' || d.status === 'dry-run');
  const openPositions = [];
  for (const d of liveDesks) {
    if (d.openTrade) {
      const cur = quotes[d.symbol]?.price ?? d.openTrade.entry;
      openPositions.push({
        symbol: d.symbol, deskLabel: d.label, deskId: d.id,
        dir: d.openTrade.dir,
        quantity: d.openTrade.binanceQuantity || d.openTrade.sizeFactor * 0.1,
        averageEntryPrice: d.openTrade.entry,
        stop: d.openTrade.stop, target: d.openTrade.target,
        markPct: d.openTrade.markPct ?? 0, at: d.openTrade.at,
      });
    }
  }

  const recentTrades = (pf.trades || []).slice(-12).reverse();
  const allEquity = [];
  for (const d of desks) {
    if (d.equity && d.equity.length) {
      d.equity.forEach((v, i) => {
        const existing = allEquity.find((e) => e.t === i);
        if (existing) existing.v += Number(v) || 0; else allEquity.push({ t: i, v: Number(v) || 0 });
      });
    }
  }

  const connected = !marketState.synthetic;

  mount(root,
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: 'Paper Trading · תיק מסחר מדומה' }),
        h('h1', { text: 'תיק המסחר של החברה' }),
        h('p', { text: 'כל הפוזיציות נפתחות על נייר בלבד לאחר בדיקת עבר רווחית על נתוני Binance אמת. מחירים מתעדכנים בחיבור חי. הרווח/הפסד מוצג לאחר ניכוי עמלות ומס רווחי הון.' }),
      ),
      h('div', { class: 'head-actions' },
        h('span', { class: connected ? 'pill pill-sim' : 'pill pill-warn', text: connected ? 'חיבור חי ל-Binance · פעיל' : 'נתוני הדגמה · אין חיבור חי' }),
      ),
    ),

    h('div', { class: 'grid cols-4', style: { marginBottom: '14px' } },
      kpi('הון מנוהל', money(report.equity), report.returnPct, allEquity.map((e) => e.v), report.returnPct >= 0 ? 'green' : 'red'),
      kpi('מזומן פנוי', money(report.cash), null, null),
      kpi('רווח נטו (אחרי עמלות ומס)', money(report.netPnL), report.returnPct, null, report.netPnL >= 0 ? 'green' : 'red'),
      kpi('עמלות + מס', money((report.totalFees || 0) + (report.totalTax || 0)), null, null),
    ),

    h('div', { class: 'notice ' + (connected ? '' : 'bad') },
      h('span', { class: 'ic', text: connected ? '●' : '⚠' }),
      h('span', { text: connected
        ? `נתונים חיים מביננס פעילים. מקור: ${marketState.provider || 'Binance'} · עודכן ${timeAgo(marketState.fetchedAt || Date.now())}`
        : 'אין חיבור חי ל-Binance כרגע. מוצגים נתוני הדגמה — התוצאות להמחשה בלבד.' }),
    ),

    h('div', { class: 'portfolio-grid' },
      h('div', { class: 'card positions-card' },
        h('div', { class: 'positions-head' },
          h('h3', { text: 'פוזיציות פתוחות' }),
          h('span', { class: 'tiny muted', text: openPositions.length + ' פתוחות' }),
        ),
        openPositions.length ? h('div', {},
          h('div', { class: 'thead-row' },
            h('div', { text: 'סמל' }), h('div', { text: 'כמות' }), h('div', { text: 'כניסה' }),
            h('div', { text: 'מחיר נוכחי' }), h('div', { text: 'רווח/הפסד' }), h('div', { text: 'שולחן' }), h('div', { text: 'פעולה' }),
          ),
          ...openPositions.map((pos) => {
            const cur = quotes[pos.symbol]?.price ?? pos.averageEntryPrice;
            const pnl = pos.dir > 0 ? ((cur - pos.averageEntryPrice) * pos.quantity) : ((pos.averageEntryPrice - cur) * pos.quantity);
            const pnlPct = pos.dir > 0 ? ((cur / pos.averageEntryPrice) - 1) * 100 : ((pos.averageEntryPrice / cur) - 1) * 100;
            const cls = pnl >= 0 ? 'up' : 'down';
            return h('div', { class: 'position-row' },
              h('div', { class: 'sym', text: pos.symbol + (pos.dir > 0 ? ' · לונג' : ' · שורט') }),
              h('div', { class: 'qty', text: num(pos.quantity, 6) }),
              h('div', { class: 'entry', text: num(pos.averageEntryPrice, 2) }),
              h('div', { class: 'mark', text: num(cur, 2) }),
              h('div', { class: 'pnl ' + cls, text: pct(pnlPct) + ' · ' + money(pnl) }),
              h('div', { class: 'small muted', text: pos.deskLabel, title: pos.deskLabel }),
              h('div', {}, h('button', { class: 'btn btn-sm btn-danger', onclick: () => onClosePosition(pos.deskId) }, 'סגור ידנית')),
            );
          }),
        ) : h('div', { class: 'empty-portfolio' },
          h('div', { class: 'ic', text: '◻' }),
          h('div', { text: 'אין פוזיציות פתוחות כרגע' }),
          h('div', { class: 'tiny muted', text: 'הסוכנים יפתחו פוזיציה לאחר בדיקת עבר רווחית ואישור הרצה.' }),
        ),
      ),

      h('div', { class: 'card trades-card' },
        h('div', { class: 'trades-head' },
          h('h3', { text: 'היסטוריית עסקאות אחרונות' }),
          h('span', { class: 'tiny muted', text: (report.tradeCount || 0) + ' סה״כ' }),
        ),
        recentTrades.length ? h('div', {},
          h('div', { class: 'thead-row' },
            h('div', { text: 'פעולה' }), h('div', { text: 'סמל' }), h('div', { text: 'מחיר' }),
            h('div', { text: 'כמות' }), h('div', { text: 'עמלה' }), h('div', { text: 'זמן' }),
          ),
          ...recentTrades.map((t) => tradeRow(t)),
        ) : h('div', { class: 'empty-portfolio' },
          h('div', { class: 'ic', text: '◻' }),
          h('div', { text: 'עדיין לא בוצעו עסקאות בתיק הדמה' }),
          h('div', { class: 'tiny muted', text: 'העסקאות יופיעו כאן לאחר פתיחה וסגירה של פוזיציות.' }),
        ),
      ),
    ),

    h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'card-head' },
        h('div', {},
          h('h2', { text: 'שולחנות פעילים על נייר' }),
          h('div', { class: 'card-sub', text: 'מצב כל שולחן, רווח נייר נוכחי ומחיר שוק אחרון' }),
        ),
      ),
      h('div', { class: 'grid cols-2' },
        ...desks.map((d) => {
          const cur = quotes[d.symbol]?.price ?? 0;
          const open = d.openTrade;
          return h('div', { class: 'card desk-card', style: { marginBottom: '10px' } },
            h('div', { class: 'row between' },
              h('div', {},
                h('div', { class: 'row', style: { gap: '7px', flexWrap: 'wrap' } },
                  h('strong', { style: { fontSize: '14px' }, text: d.label }),
                  tag(d.status === 'live' ? 'חי על נייר' : d.status === 'dry-run' ? 'יבש' : 'במחקר', d.status === 'live' ? 'live' : d.status === 'dry-run' ? 'dry' : ''),
                  tag(d.symbol, ''),
                ),
                h('div', { class: 'small muted', text: `${d.tf} · ${d.strategyId ? 'אסטרטגיה טעונה' : 'מחפשת אסטרטגיה'}` }),
              ),
              h('div', { style: { textAlign: 'left' } },
                h('div', { class: 'mono ' + ((d.livePnl || 0) >= 0 ? 'green' : 'red'), style: { fontSize: '16px', fontWeight: '700' }, text: pct(d.livePnl || 0) }),
                h('div', { class: 'tiny muted', text: 'רווח נייר נוכחי' }),
              ),
            ),
            h('div', { class: 'metrics', style: { marginTop: '8px' } },
              h('div', { class: 'metric' }, h('span', { text: 'הון מוקצה' }), h('b', { text: money((s.capital || 0) * (d.weight || 0.2)) })),
              h('div', { class: 'metric' }, h('span', { text: 'מחיר נוכחי' }), h('b', { text: cur ? num(cur, 2) : '—' })),
              h('div', { class: 'metric' }, h('span', { text: 'גרסה' }), h('b', { text: d.version || '—' })),
            ),
            open ? h('div', { class: 'small', style: { marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
              h('span', { class: (open.markPct || 0) >= 0 ? 'green' : 'red' },
                `פוזיציה פתוחה: ${open.dir > 0 ? 'לונג' : 'שורט'} ב־${num(open.entry, 2)} · רווח נוכחי ${pct(open.markPct || 0)}`),
              h('button', { class: 'btn btn-sm btn-danger', onclick: () => onClosePosition(d.id) }, 'סגור פוזיציה'),
            ) : null,
          );
        }),
      ),
    ),

    notice('אין ביצוע פקודות בכסף אמת. כל המסחר הוא על נייר (paper trading) עם עמלות ומס רווחי הון כפי שמוגדר. ביצועי עבר אינם ערובה לתוצאות עתידיות.', 'blue'),
  );
}
