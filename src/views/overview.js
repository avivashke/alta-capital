import { store } from '../store.js';
import { DISCLAIMER } from '../config.js';
import { h, mount, kpi, pct, num, money, section, notice, empty, tag, timeAgo } from '../ui.js';
import { deskCard, feedList, agentCard } from './shared.js';
import { localAdvice } from '../advisor.js';
import { marketState } from '../market.js';
import { tick, runDeskCycle, ensurePaperPortfolio, getPaperPortfolio } from '../firm.js';
import { quotes } from '../market.js';

export function renderOverview(root, ui) {
  const state = store.state;
  const s = state.settings;
  const desks = state.desks;
  const versioned = desks.filter((d) => d.version);
  const weightSum = versioned.reduce((sum, d) => sum + (d.weight || 0.2), 0) || 1;
  const weighted = versioned.length
    ? versioned.reduce((sum, d) => sum + (d.bestReturn || 0) * (d.weight || 0.2), 0) / weightSum
    : null;
  const live = desks.filter((d) => d.status === 'live');
  const advice = localAdvice(state);
  const bestDesk = [...desks].sort((a, b) => (b.bestReturn ?? -99) - (a.bestReturn ?? -99))[0];

  // Paper portfolio (shared, default $100,000) reflects team trading activity
  const pf = getPaperPortfolio() || ensurePaperPortfolio();
  const report = pf.getReport(quotes || {});
  const initial = report.initialBalance ?? 100000;
  const equity = report.equity ?? initial;
  const equityChangePct = ((equity / initial) - 1) * 100;

  const run = async (fn) => {
    try { await fn(); ui.rerender(); } catch (err) { console.error(err); }
  };

  mount(root,
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: 'חדר מסחר · פעילות צוות' }),
        h('h1', { text: 'סקירת חדר המסחר' }),
        h('p', { text: 'סיכום פעילות הסוכנים, תיק הנייר המשותף והמדדים המרכזיים. הנתונים משקפים מסחר על נייר (אחרי עמלות ומס) לפי פעילות הצוות.' }),
      ),
      h('div', { class: 'head-actions' },
        h('button', { class: 'btn btn-primary', onclick: () => run(() => tick({ reason: 'manual' })) }, 'הרץ מחזור עכשיו'),
        h('button', { class: 'btn', onclick: () => ui.go('lab') }, 'למעבדה'),
      ),
    ),

    marketState.synthetic
      ? notice('נתוני השוק כרגע בהדגמה (' + (marketState.error || 'אין חיבור לבורסה') + '); התוצאות להמחשה בלבד.', 'bad')
      : null,

    h('div', { class: 'grid cols-4', style: { marginBottom: '14px' } },
      kpi('הון מנוהל (נייר)', money(equity), equityChangePct, null, equityChangePct >= 0 ? 'green' : 'red'),
      kpi('הון התחלתי / מזומן', money(initial) + ' / ' + money(report.cash ?? 0), null, null),
      kpi('רווח/הפסד נטו (אחרי עמלות ומס)', money(report.netPnL ?? 0), report.returnPct ?? 0, null, (report.netPnL ?? 0) >= 0 ? 'green' : 'red'),
      kpi('עסקאות שבוצעו', num(report.tradeCount || 0), null, null),
    ),

    h('div', { class: 'grid cols-3' },
      h('div', { class: 'card', style: { gridColumn: 'span 2' } },
        h('div', { class: 'card-head' },
          h('div', {},
            h('h2', { text: 'לוח השולחנות' }),
            h('div', { class: 'card-sub', text: 'מקור: ' + marketState.provider + ' · ' + (state.stats.cycles || 0) + ' מחזורים · ' + num(state.stats.backtests || 0) + ' בקטסטים' }),
          ),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => ui.go('desks') }, 'כל השולחנות →'),
        ),
        h('div', { class: 'grid cols-2' },
          desks.map((desk) => deskCard(desk, {
            compact: true,
            onRun: (d) => run(() => runDeskCycle(d)),
            onOpen: (d) => { ui.setDesk(d.id); ui.go('lab'); },
          })),
        ),
      ),

      h('div', { class: 'stack' },
        section('פעולות מומלצות', 'המלצות לפי מצב המערכת',
          h('ul', { class: 'list-clean' }, advice.slice(0, 3).map((a) => h('li', {},
            h('span', { class: 'bul', text: '→' }),
            h('div', { class: 'grow' },
              h('div', { style: { fontWeight: 600 }, text: a.title }),
              h('div', { class: 'tiny muted', text: (a.detail || '').slice(0, 130) }),
              a.action ? h('button', { class: 'btn-link', style: { marginTop: '4px' }, onclick: () => ui.go(a.action.route) }, a.action.label) : null,
            ),
          ))),
        ),
        section('מצב הצוות', (state.agents.filter((a) => a.status === 'busy').length) + ' סוכנים פעילים',
          h('div', { class: 'stack', style: { gap: '8px' } }, state.agents.slice(0, 6).map(agentCard)),
          h('button', { class: 'btn btn-ghost btn-sm', style: { marginTop: '10px' }, onclick: () => ui.go('agents') }, 'לכל הצוות →'),
        ),
      ),
    ),

    h('div', { class: 'grid cols-2', style: { marginTop: '14px' } },
      section('יומן פעילות', 'אירועים והחלטות אחרונות', feedList(state.events, 14)),
      section('סיכום תיק נייר', 'שיקוף פעילות המסחר של הצוות',
        h('div', { class: 'grid cols-2', style: { gap: '10px' } },
          h('div', { class: 'metric' }, h('span', { text: 'הון התחלתי' }), h('b', { text: money(initial) })),
          h('div', { class: 'metric' }, h('span', { text: 'שווי נוכחי' }), h('b', { text: money(equity) })),
          h('div', { class: 'metric' }, h('span', { text: 'מזומן' }), h('b', { text: money(report.cash ?? 0) })),
          h('div', { class: 'metric' }, h('span', { text: 'עמלות + מס' }), h('b', { text: money((report.totalFees || 0) + (report.totalTax || 0)) })),
        ),
        h('div', { class: 'row', style: { marginTop: '10px', gap: '6px' } },
          h('button', { class: 'btn btn-sm', onclick: () => ui.go('portfolio') }, 'לתיק ולוג עסקאות'),
          h('button', { class: 'btn btn-sm btn-ghost', onclick: () => ui.go('agents') }, 'צוות ומעבדות'),
        ),
        h('div', { class: 'small muted', style: { marginTop: '8px' } }, 'לתיעוד ברור של רווח/הפסד ויתרה אחרי כל עסקה — ראו "תיק המסחר".'),
      ),
    ),

    h('div', { class: 'grid cols-2', style: { marginTop: '14px' } },
      section('השולחן המוביל', bestDesk ? bestDesk.label : '—',
        bestDesk ? h('div', {},
          h('div', { class: 'row', style: { gap: '8px', marginBottom: '8px' } },
            tag(bestDesk.version || 'טרם פורסמה גרסה'),
            tag(bestDesk.strategyId || '—'),
          ),
          h('div', { class: 'grid cols-3' },
            h('div', { class: 'metric' }, h('span', { text: 'OOS' }), h('b', { class: 'green', text: bestDesk.bestReturn == null ? '—' : pct(bestDesk.bestReturn) })),
            h('div', { class: 'metric' }, h('span', { text: 'עסקאות' }), h('b', { text: bestDesk.metrics?.trades ?? '—' })),
            h('div', { class: 'metric' }, h('span', { text: 'Profit Factor' }), h('b', { text: bestDesk.metrics?.profitFactor ?? '—' })),
          ),
          h('div', { class: 'small muted', style: { marginTop: '10px' }, text: bestDesk.mandate || '' }),
        ) : empty('אין עדיין גרסאות'),
      ),
      section('הגבלות וסיכונים', 'חשוב לפני שמחברים הון אמיתי',
        notice(DISCLAIMER, 'bad'),
        h('ul', { class: 'list-clean', style: { marginTop: '10px' } },
          h('li', {}, h('span', { class: 'bul', text: '•' }), h('span', { class: 'grow', text: 'הסוכנים רצים בדפדפן — כשהטאב סגור הם לא עובדים. בפתיחה מתבצע סנכרון/המשך לפי המצב השמור.' })),
          h('li', {}, h('span', { class: 'bul', text: '•' }), h('span', { class: 'grow', text: 'אין שליחת פקודות לכסף אמת (למעט אם הוגדר בנפרד). ברירת המחדל: הרצה על נייר.' })),
        ),
      ),
    ),
  );
}
