import { mount } from '../ui.js';
import { store } from '../store.js';
import { DISCLAIMER } from '../config.js';
import { h, kpi, pct, num, money, section, notice, empty, tag, timeAgo } from '../ui.js';
import { deskCard, feedList, agentCard, strategyName } from './shared.js';
import { localAdvice } from '../advisor.js';
import { marketState } from '../market.js';
import { tick, runDeskCycle } from '../firm.js';

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
  const dry = desks.filter((d) => d.status === 'dry-run');
  const paperPnl = desks.reduce((sum, d) => sum + ((d.livePnl || 0) / 100) * s.capital * (d.weight || 0.2), 0);
  const equity = s.capital + paperPnl;
  const advice = localAdvice(state);
  const bestDesk = [...desks].sort((a, b) => (b.bestReturn ?? -99) - (a.bestReturn ?? -99))[0];

  const run = async (fn, label) => {
    try {
      await fn();
      ui.rerender();
    } catch (err) {
      console.error(err);
    }
  };

  mount(root, 
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: 'Investment firm · agent run' }),
        h('h1', { text: 'סקירת חדר המסחר' }),
        h('p', { text: 'סוכני מחקר, בקטסט ואופטימיזציה עובדים על חמישה שולחנות מסחר. גרסה חדשה נארזת אוטומטית בכל שיפור של אחוז אחד ב־out-of-sample.' }),
      ),
      h('div', { class: 'head-actions' },
        h('button', { class: 'btn btn-primary', onclick: () => run(() => tick({ reason: 'manual' }), 'cycle') }, '▶ הרץ מחזור עכשיו'),
        h('button', { class: 'btn', onclick: () => ui.go('lab') }, 'למעבדה'),
      ),
    ),

    marketState.synthetic
      ? notice(`נתוני השוק כרגע מסדרת הדגמה (${marketState.error || 'אין חיבור לבורסה'}); כל התוצאות להמחשה בלבד.`, 'bad')
      : null,

    h('div', { class: 'grid cols-4', style: { marginBottom: '14px' } },
      kpi('הון מנוהל (מדומה)', money(equity), ((equity / s.capital) - 1) * 100, null),
      kpi('תשואה ממוצעת · OOS', weighted == null ? '—' : pct(weighted), null, versioned.flatMap((d) => d.equity.slice(-40)), 'green'),
      kpi('שולחנות חיים', `${live.length} / ${desks.length}`, null, null),
      kpi('גרסאות שפורסמו', num(state.stats.deployments || 0), null, null),
    ),

    h('div', { class: 'grid cols-3' },
      h('div', { class: 'card', style: { gridColumn: 'span 2' } },
        h('div', { class: 'card-head' },
          h('div', {},
            h('h2', { text: 'לוח השולחנות' }),
            h('div', { class: 'card-sub', text: `feed: ${marketState.provider} · ${state.stats.cycles || 0} מחזורים · ${num(state.stats.backtests || 0)} בקטסטים` }),
          ),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => ui.go('desks') }, 'כל השולחנות →'),
        ),
        h('div', { class: 'grid cols-2' },
          desks.map((desk) => deskCard(desk, {
            compact: true,
            onRun: (d) => run(() => runDeskCycle(d), d.label),
            onOpen: (d) => { ui.setDesk(d.id); ui.go('lab'); },
          })),
        ),
      ),

      h('div', { class: 'stack' },
        section('פעולות מומלצות', 'היועץ מחשב מהמצב בפועל',
          h('ul', { class: 'list-clean' }, advice.slice(0, 3).map((a) => h('li', {},
            h('span', { class: 'bul', text: '→' }),
            h('div', { class: 'grow' },
              h('div', { style: { fontWeight: 600 }, text: a.title }),
              h('div', { class: 'tiny muted', text: a.detail.slice(0, 130) }),
              a.action ? h('button', { class: 'btn-link', style: { marginTop: '4px' }, onclick: () => ui.go(a.action.route) }, a.action.label) : null,
            ),
          ))),
        ),
        section('מצב הצוות', `${state.agents.filter((a) => a.status === 'busy').length} סוכנים פעילים`,
          h('div', { class: 'stack', style: { gap: '8px' } }, state.agents.slice(0, 4).map(agentCard)),
          h('button', { class: 'btn btn-ghost btn-sm', style: { marginTop: '10px' }, onclick: () => ui.go('agents') }, 'לכל הצוות →'),
        ),
      ),
    ),

    h('div', { class: 'grid cols-2', style: { marginTop: '14px' } },
      section('יומן פעילות', 'כל החלטה של הסוכנים נרשמת',
        feedList(state.events, 12),
      ),
      section('מצב שוק וסנטימנט', 'מקורות ציבוריים חינמיים',
        h('div', { class: 'grid cols-2', style: { gap: '10px' } },
          state.desks.map((d) => {
            const sent = state.sentiment.assets?.[d.symbol];
            return h('div', { class: 'metric' },
              h('span', { text: d.symbol }),
              h('b', { class: sent?.bias === 'שורי' ? 'green' : sent?.bias === 'דובי' ? 'red' : '', text: sent ? `${sent.bias} ${sent.score > 0 ? '+' : ''}${sent.score}` : '—' }),
            );
          }),
        ),
        h('div', { class: 'row between', style: { marginTop: '12px' } },
          h('div', { class: 'small muted' }, `פחד/חמדנות: ${state.sentiment.fearGreed ? `${state.sentiment.fearGreed.value} (${state.sentiment.fearGreed.label})` : '—'}`),
          h('div', { class: 'tiny muted', text: state.sentiment.updatedAt ? timeAgo(state.sentiment.updatedAt) : 'טרם נסרק' }),
        ),
        h('div', { class: 'row', style: { marginTop: '10px', gap: '6px' } },
          h('button', { class: 'btn btn-sm', onclick: () => ui.go('sentiment') }, 'פירוט סנטימנט'),
          h('button', { class: 'btn btn-sm btn-ghost', onclick: () => ui.go('research') }, 'סריקת מחקר'),
        ),
      ),
    ),

    h('div', { class: 'grid cols-2', style: { marginTop: '14px' } },
      section('השולחן המוביל', bestDesk ? bestDesk.label : '—',
        bestDesk ? h('div', {},
          h('div', { class: 'row', style: { gap: '8px', marginBottom: '8px' } },
            tag(bestDesk.version || 'טרם פורסמה גרסה'),
            tag(strategyName(bestDesk.strategyId)),
          ),
          h('div', { class: 'grid cols-3' },
            h('div', { class: 'metric' }, h('span', { text: 'OOS' }), h('b', { class: 'green', text: bestDesk.bestReturn == null ? '—' : pct(bestDesk.bestReturn) })),
            h('div', { class: 'metric' }, h('span', { text: 'עסקאות' }), h('b', { text: bestDesk.metrics?.trades ?? '—' })),
            h('div', { class: 'metric' }, h('span', { text: 'Profit Factor' }), h('b', { text: bestDesk.metrics?.profitFactor ?? '—' })),
          ),
          h('div', { class: 'small muted', style: { marginTop: '10px' }, text: bestDesk.mandate }),
        ) : empty('אין עדיין גרסאות'),
      ),
      section('מגבלות וסיכונים', 'חשוב לפני שמחברים הון אמיתי',
        notice(DISCLAIMER, 'bad'),
        h('ul', { class: 'list-clean', style: { marginTop: '10px' } },
          h('li', {}, h('span', { class: 'bul', text: '•' }), h('span', { class: 'grow', text: 'הסוכנים רצים בדפדפן — כשהטאב סגור הם לא עובדים. יש מנגנון השלמה (catch-up) בפתיחה.' })),
          h('li', {}, h('span', { class: 'bul', text: '•' }), h('span', { class: 'grow', text: 'אין חיבור לבורסה ואין שליחת פקודות. ההרצה החיה היא על נייר.' })),
          h('li', {}, h('span', { class: 'bul', text: '•' }), h('span', { class: 'grow', text: 'הקוד המיוצא מיועד ל-Freqtrade/Jesse/OctoBot ולהרצת dry-run אצלך.' })),
        ),
      ),
    ),
  );
}
