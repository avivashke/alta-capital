import { store } from '../store.js';
import { h, pct, num, money, section, statusTag, chart, tag, notice, empty } from '../ui.js';
import { metricsTable, gateList, strategyName } from './shared.js';
import { runDeskCycle, resetDesk, setDeskStatus, getPaperPortfolio, ensurePaperPortfolio } from '../firm.js';
import { quotes } from '../market.js';

function mount(root, ...children) {
  for (const child of children.flat(6)) {
    if (child == null || child === false) continue;
    root.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return root;
}

export function renderDesks(root, ui) {
  const state = store.state;
  const s = state.settings;
  const pf = getPaperPortfolio() || ensurePaperPortfolio();
  const report = pf.getReport(quotes);

  const act = async (fn, label) => {
    try { await fn(); ui.rerender(); } catch (err) { console.error(err); }
  };

  mount(root,
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: 'Trading desks' }),
        h('h1', { text: 'שולחנות מסחר' }),
        h('p', { text: 'כל שולחן מתמחה בטווח זמן אחר. הסוכנים מכיילים אסטרטגיה, מדדים ופרמטרים בנפרד, והרווח מוצג לאחר עמלות ומס בהתאם לתיק הנייר.' }),
      ),
      h('div', { class: 'head-actions' },
        h('span', { class: 'pill pill-quiet', text: `סה״כ הון: ${money(s.capital)}` }),
        h('span', { class: 'pill pill-quiet', text: `סיכון לעסקה: ${(Number(s.riskPerTrade || 0) * 100).toFixed(1)}%` }),
      ),
    ),
  );

  mount(root, h('div', { class: 'card', style: { marginBottom: '14px' } },
    h('div', { class: 'card-head' },
      h('div', {},
        h('h2', { text: 'שורת רווח תיק הנייר (משותף)' }),
        h('div', { class: 'card-sub', text: 'מחושב לאחר ניכוי עמלות ומס רווחי הון (כמו בתיק מסחר).' }),
      ),
      h('span', { class: 'pill ' + (report.netPnL >= 0 ? 'pill-live' : 'pill-warn'), text: (report.netPnL >= 0 ? 'רווחי' : 'בהפסד') + ' נטו' }),
    ),
    h('div', { class: 'grid cols-4' },
      h('div', { class: 'metric' }, h('span', { text: 'רווח/הפסד נטו (לאחר עמלות ומס)' }), h('b', { class: report.netPnL >= 0 ? 'green mono' : 'red mono', text: money(report.netPnL) + ' · ' + pct(report.returnPct) })),
      h('div', { class: 'metric' }, h('span', { text: 'הון עצמי נוכחי' }), h('b', { class: 'mono', text: money(report.equity) })),
      h('div', { class: 'metric' }, h('span', { text: 'עמלות ששולמו' }), h('b', { class: 'mono', text: money(report.totalFees) })),
      h('div', { class: 'metric' }, h('span', { text: 'מס רווחי הון שנצבר' }), h('b', { class: 'mono', text: money(report.totalTax) })),
    ),
  ));

  state.desks.forEach((desk) => {
    mount(root, h('div', { class: 'card', style: { marginBottom: '14px' } },
      h('div', { class: 'row between', style: { alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' } },
        h('div', {},
          h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
            h('h2', { text: desk.label }),
            statusTag(desk.status),
            tag(desk.symbol),
            tag(`${desk.tf} candles`),
            desk.version ? tag(desk.version, 'green') : null,
          ),
          h('div', { class: 'small muted', style: { marginTop: '4px' }, text: `${desk.mandate} · אופק: ${desk.horizon}` }),
        ),
      ),
      h('div', { class: 'profit-strip ' + ((desk.livePnl ?? desk.bestReturn ?? 0) >= 0 ? 'up' : 'down') },
        h('div', { class: 'profit-item main' },
          h('div', { class: 'lab', text: 'ביצועי נייר (P&L %)' }),
          h('div', { class: 'val mono ' + ((desk.livePnl || 0) >= 0 ? 'green' : 'red'), text: pct(desk.livePnl || 0) }),
        ),
        h('div', { class: 'profit-item' },
          h('div', { class: 'lab', text: 'תשואת Out-of-sample' }),
          h('div', { class: 'val mono ' + (desk.bestReturn == null ? '' : desk.bestReturn >= 0 ? 'green' : 'red'), text: desk.bestReturn == null ? '—' : pct(desk.bestReturn) }),
        ),
        h('div', { class: 'profit-item' },
          h('div', { class: 'lab', text: 'תרומת הון משוערת (לפני/אחרי בתיק)' }),
          h('div', { class: 'val mono ' + ((desk.livePnl || 0) >= 0 ? 'green' : 'red'), text: money((s.capital * (desk.weight || 0.2)) * ((desk.livePnl || 0) / 100)) }),
        ),
        h('div', { class: 'profit-item' },
          h('div', { class: 'lab', text: 'עסקאות / חשיפה' }),
          h('div', { class: 'val mono', text: `${desk.metrics?.trades ?? 0} · ${desk.metrics?.exposurePct ?? 0}%` }),
        ),
        desk.openTrade ? h('div', { class: 'profit-item' },
          h('div', { class: 'lab', text: 'פוזיציה פתוחה' }),
          h('div', { class: 'val mono ' + ((desk.openTrade.markPct || 0) >= 0 ? 'green' : 'red'), text: `${desk.openTrade.dir > 0 ? 'לונג' : 'שורט'} ${pct(desk.openTrade.markPct || 0)}` }),
        ) : null,
      ),
      h('div', { class: 'grid cols-2', style: { marginTop: '12px' } },
        h('div', {},
          h('div', { class: 'row between', style: { marginBottom: '6px' } },
            h('div', { class: 'small muted', text: `הון מוקצה: ${money(s.capital * (desk.weight || 0.2))} · ${desk.metrics?.trades ?? 0} עסקאות · חשיפה ${desk.metrics?.exposurePct ?? 0}%` }),
            h('div', { class: 'tiny muted', text: desk.lastRunAt ? `עודכן ${new Date(desk.lastRunAt).toLocaleTimeString('he-IL')}` : 'טרם רץ' }),
          ),
          chart(desk.equity, { height: 120, color: 'green', showZero: true }),
          desk.params ? h('div', { class: 'small muted', style: { marginTop: '8px' } },
            `${strategyName(desk.strategyId)} — ${Object.entries(desk.params).map(([k, v]) => `${k}=${typeof v === 'boolean' ? (v ? 'כן' : 'לא') : v}`).join(' · ')}`,
          ) : null,
        ),
        h('div', {},
          h('h3', { style: { fontSize: '13px', marginBottom: '6px' }, text: 'שערי קידום' }),
          gateList(desk, s),
          h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '10px' } },
            h('button', { class: 'btn btn-sm btn-primary', onclick: () => act(() => runDeskCycle(desk), 'run') }, 'הרץ מחזור'),
            h('button', { class: 'btn btn-sm', onclick: () => act(() => runDeskCycle(desk, { deep: true, focus: true }), 'deep') }, 'כיול מעמיק'),
            desk.status === 'dry-run'
              ? h('button', { class: 'btn btn-sm', onclick: () => act(() => setDeskStatus(desk.id, 'live'), 'live') }, 'אשר הרצה חיה')
              : null,
            desk.status === 'live'
              ? h('button', { class: 'btn btn-sm', onclick: () => act(() => setDeskStatus(desk.id, 'dry-run'), 'dry') }, 'חזור ליבש')
              : null,
            h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { ui.setDesk(desk.id); ui.go('lab'); } }, 'מעבדה'),
            h('button', { class: 'btn btn-sm btn-danger', onclick: () => act(() => resetDesk(desk.id), 'reset') }, 'אפס'),
          ),
        ),
      ),
      desk.metrics ? h('div', { style: { marginTop: '12px' } }, metricsTable(desk)) : empty('אין עדיין תוצאות בקטסט לשולחן זה'),
      desk.history.length ? h('div', { style: { marginTop: '12px' } },
        h('h3', { style: { fontSize: '13px' }, text: 'גרסאות אחרונות' }),
        h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {},
            h('th', { text: 'גרסה' }), h('th', { text: 'מתי' }), h('th', { text: 'אסטרטגיה' }),
            h('th', { class: 'num', text: 'OOS' }), h('th', { class: 'num', text: 'PF' }), h('th', { class: 'num', text: 'DD' }), h('th', { text: 'הערה' }),
          )),
          h('tbody', {}, desk.history.slice(0, 4).map((v) => h('tr', {},
            h('td', {}, tag(v.version, 'green')),
            h('td', { class: 'tiny muted', text: new Date(v.at).toLocaleString('he-IL') }),
            h('td', { class: 'small', text: strategyName(v.strategyId) }),
            h('td', { class: 'num green', text: pct(v.oosReturn) }),
            h('td', { class: 'num', text: v.profitFactor }),
            h('td', { class: 'num red', text: pct(-v.maxDrawdownPct) }),
            h('td', { class: 'tiny muted', text: v.note }),
          ))),
        )),
      ) : null,
    ));
  });

  mount(root, notice('שורת הרווח בתיק מוצגת גם כאן ומשקפת רווח/הפסד נטו לאחר עמלות ומס רווחי הון. מדדי עבר אינם ערובה לביצועים עתידיים.', 'blue'));
}
