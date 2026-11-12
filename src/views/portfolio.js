import { mount } from '../ui.js';
import { store } from '../store.js';
import { h, pct, num, money, section, notice, empty, tag, timeAgo, chart, livePrice, positionRow, tradeRow, kpi } from '../ui.js';
import { marketState, quotes, lastPrice } from '../market.js';
import { ensurePaperPortfolio, getPaperPortfolio } from '../firm.js';
import { DESKS } from '../config.js';

export function renderPortfolio(root, ui) {
  const state = store.state;
  const s = state.settings;
  const pf = getPaperPortfolio() || ensurePaperPortfolio();
  const report = pf.getReport(quotes);
  const desks = state.desks;

  // מחירי נוכחיים מכל ה-desks
  const liveDesks = desks.filter((d) => d.status === 'live' || d.status === 'dry-run');
  const openPositions = [];
  for (const d of liveDesks) {
    if (d.openTrade) {
      const cur = quotes[d.symbol]?.price ?? d.openTrade.entry;
      openPositions.push({
        symbol: d.symbol,
        deskLabel: d.label,
        deskId: d.id,
        dir: d.openTrade.dir,
        quantity: d.openTrade.binanceQuantity || d.openTrade.sizeFactor * 0.1,
        averageEntryPrice: d.openTrade.entry,
        stop: d.openTrade.stop,
        target: d.openTrade.target,
        markPct: d.openTrade.markPct ?? 0,
        at: d.openTrade.at,
      });
    }
  }

  // עסקאות אחרונות מהתיק הדמה
  const recentTrades = (pf.trades || []).slice(-12).reverse();

  // גרף הון מצטבר מכל השולחנות
  const allEquity = [];
  for (const d of desks) {
    if (d.equity && d.equity.length) {
      d.equity.forEach((v, i) => {
        const existing = allEquity.find((e) => e.t === i);
        if (existing) existing.v += v;
        else allEquity.push({ t: i, v });
      });
    }
  }

  const connected = !marketState.synthetic;

  mount(root,
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: 'Paper Trading · תיק מסחר מדומה' }),
        h('h1', { text: 'תיק המסחר של החברה' }),
        h('p', { text: 'כל הפוזיציות נפתחות על נייר בלבד לאחר בדיקת עבר רווחית על נתוני Binance אמת. מחירים מתעדכנים בחיבור חי מביננס.' }),
      ),
      h('div', { class: 'head-actions' },
        h('span', { class: connected ? 'pill pill-sim' : 'pill pill-warn', text: connected ? 'חיבור חי ל-Binance · פעיל' : 'נתוני הדגמה · אין חיבור חי' }),
      ),
    ),

    h('div', { class: 'grid cols-4', style: { marginBottom: '14px' } },
      kpi('הון מנוהל', money(report.equity), report.returnPct, allEquity.map((e) => e.v), report.returnPct >= 0 ? 'green' : 'red'),
      kpi('מזומן פנוי', money(report.cash), null, null),
      kpi('רווח נקי', money(report.netPnL), report.returnPct, null, report.netPnL >= 0 ? 'green' : 'red'),
      kpi('עמלות + מס', money(report.totalFees + report.totalTax), null, null),
    ),

    h('div', { class: 'notice ' + (connected ? '' : 'bad') },
      h('span', { class: 'ic' }, connected ? '✅' : '⚠️'),
      h('span', {},
        connected
          ? `נתונים חיים מביננס פועלים. המקור כרגע: ${marketState.provider || 'Binance'} · עודכן לאחרונה ${timeAgo(marketState.fetchedAt || Date.now())}`
          : 'אין חיבור חי ל-Binance כרגע. המחירים מוצגים מסדרת הדגמה — התוצאות להמחשה בלבד.'
      ),
    ),

    h('div', { class: 'portfolio-grid' },

      // פוזיציות פתוחות
      h('div', { class: 'card positions-card' },
        h('div', { class: 'positions-head' },
          h('h3', { text: 'פוזיציות פתוחות' }),
          h('span', { class: 'tiny muted', text: openPositions.length + ' פתוחות' }),
        ),
        openPositions.length ? (
          h('div', {},
            h('div', { class: 'thead-row' },
              h('div', { text: 'סמל' }),
              h('div', { text: 'כמות' }),
              h('div', { text: 'מחיר כניסה' }),
              h('div', { text: 'מחיר נוכחי' }),
              h('div', { text: 'ריווח/הפסד' }),
              h('div', { text: 'שולחן' }),
            ),
            openPositions.map((pos) => {
              const cur = quotes[pos.symbol]?.price ?? pos.averageEntryPrice;
              const pnl = pos.dir > 0
                ? ((cur - pos.averageEntryPrice) * pos.quantity)
                : ((pos.averageEntryPrice - cur) * pos.quantity);
              const pnlPct = pos.dir > 0
                ? ((cur / pos.averageEntryPrice) - 1) * 100
                : ((pos.averageEntryPrice / cur) - 1) * 100;
              const cls = pnl >= 0 ? 'up' : 'down';
              return h('div', { class: 'position-row' },
                h('div', { class: 'sym', text: pos.symbol }),
                h('div', { class: 'qty', text: num(pos.quantity, 6) }),
                h('div', { class: 'entry', text: 'כניסה: ' + num(pos.averageEntryPrice, 2) }),
                h('div', { class: 'mark', text: 'מחיר: ' + num(cur, 2) }),
                h('div', { class: 'pnl ' + cls, text: pct(pnlPct) + ' · ' + money(pnl) }),
                h('div', { class: 'small muted', text: pos.deskLabel }),
              );
            }),
          )
        ) : (
          h('div', { class: 'empty-portfolio' },
            h('div', { class: 'ic' }, '📭'),
            h('div', { text: 'אין פוזיציות פתוחות כרגע' }),
            h('div', { class: 'tiny muted', text: 'הסוכנים יפתחו פוזיציה לאחר בדיקת עבר רווחית ואישור הרצה חיה' }),
          )
        ),
      ),

      // היסטוריית עסקאות
      h('div', { class: 'card trades-card' },
        h('div', { class: 'trades-head' },
          h('h3', { text: 'היסטוריית עסקאות אחרונות' }),
          h('span', { class: 'tiny muted', text: report.tradeCount + ' סה״כ' }),
        ),
        recentTrades.length ? (
          h('div', {},
            h('div', { class: 'thead-row' },
              h('div', { text: 'פעולה' }),
              h('div', { text: 'סמל' }),
              h('div', { text: 'מחיר' }),
              h('div', { text: 'כמות' }),
              h('div', { text: 'עמלה' }),
              h('div', { text: 'זמן' }),
            ),
            recentTrades.map((t) => tradeRow(t)),
          )
        ) : (
          h('div', { class: 'empty-portfolio' },
            h('div', { class: 'ic' }, '📋'),
            h('div', { text: 'עדיין לא בוצעו עסקאות בתיק הדמה' }),
            h('div', { class: 'tiny muted', text: 'העסקאות יופיעו כאן אחרי שהסוכנים יאשרו גרסה ויפתחו פוזיציה על נייר' }),
          )
        ),
      ),

    ),

    // שולחנות פעילים
    h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'card-head' },
        h('div', {},
          h('h2', { text: 'שולחנות פעילים על נייר' }),
          h('div', { class: 'card-sub', text: 'מצב כל שולחן, רווח נייר נוכחי ומחיר השוק האחרון' }),
        ),
      ),
      h('div', { class: 'grid cols-2' },
        desks.map((d) => {
          const isLive = d.status === 'live' || d.status === 'dry-run';
          const cur = quotes[d.symbol]?.price ?? 0;
          const open = d.openTrade;
          return h('div', { class: 'card desk-card', style: { marginBottom: '10px' } },
            h('div', { class: 'row between' },
              h('div', {},
                h('div', { class: 'row', style: { gap: '7px' } },
                  h('strong', { style: { fontSize: '13px' }, text: d.label }),
                  tag(d.status === 'live' ? 'חי על נייר' : d.status === 'dry-run' ? 'יבש' : 'במחקר', d.status === 'live' ? 'live' : d.status === 'dry-run' ? 'dry' : ''),
                  tag(d.symbol, ''),
                ),
                h('div', { class: 'small muted', text: `${d.tf} · ${d.strategyId ? 'אסטרטגיה טעונה' : 'מחפשת אסטרטגיה'}` }),
              ),
              h('div', { style: { textAlign: 'left' } },
                h('div', { class: 'mono ' + (d.livePnl >= 0 ? 'green' : 'red'), style: { fontSize: '16px' }, text: pct(d.livePnl || 0) }),
                h('div', { class: 'tiny muted', text: 'ריווח נייר נוכחי' }),
              ),
            ),
            h('div', { class: 'metrics', style: { marginTop: '6px' } },
              h('div', { class: 'metric' }, h('span', { text: 'הון מוקצה' }), h('b', { text: money(s.capital * (d.weight || 0.2)) })),
              h('div', { class: 'metric' }, h('span', { text: 'מחיר נוכחי' }), h('b', { text: num(cur, 2) })),
              h('div', { class: 'metric' }, h('span', { text: 'גרסה' }), h('b', { text: d.version || '—' })),
            ),
            open ? h('div', { class: 'small muted', style: { marginTop: '6px' } },
              h('span', { class: open.markPct >= 0 ? 'green' : 'red' },
                `פוזיציה פתוחה: ${open.dir > 0 ? 'לונג' : 'שורט'} ב־${num(open.entry, 2)} · רווח נוכחי ${pct(open.markPct)}`
              ),
            ) : null,
          );
        }),
      ),
    ),

    notice('אין ביצוע פקודות בכסף אמת. כל המסחר הוא על נייר (paper trading) עם עמלות Binance מדומות. ביצועי עבר אינם ערובה לתוצאות עתידיות.', 'bad'),
  );
}
