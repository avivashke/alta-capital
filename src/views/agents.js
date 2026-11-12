import { mount } from '../ui.js';
import { store } from '../store.js';
import { h, pct, num, section, notice } from '../ui.js';
import { agentCard, feedList } from './shared.js';
import { runDeskCycle, tick } from '../firm.js';

const PIPELINE = [
  ['סריקה', 'אנליסטים אוספים אסטרטגיות מ-GitHub, רשתות וחדשות'],
  ['מחקר', 'בדיקת היגיון, זיהוי משפחת אסטרטגיה והקצאת שולחן'],
  ['בקטסט', 'הרצה על 70% מהנתונים עם עמלות, החלקה וסטופ ATR'],
  ['אופטימיזציה', 'חיפוש פרמטרים + טיפוס מקומי, עם זרע מהגרסה הקיימת'],
  ['שערי סיכון', 'רווח, PF, drawdown, מספר עסקאות, OOS חיובי'],
  ['גרסה', 'אריזת קוד ל-Freqtrade/Jesse/OctoBot + יומן שינויים'],
  ['dry-run', '3 מחזורים על נייר לפני אישור'],
  ['חי על נייר', 'הרצה שוטפת עם ניטור PnL מול הצפי'],
];

export function renderAgents(root, ui) {
  const state = store.state;
  const agents = state.agents;
  const busy = agents.filter((a) => a.status === 'busy');
  const advice = agents.filter((a) => a.id === 'cio');

  mount(root, 
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: 'The team' }),
        h('h1', { text: 'הצוות' }),
        h('p', { text: 'שמונה סוכנים עם תפקידים נפרדים: מחקר, בקטסט, אופטימיזציה, סיכונים, פיתוח, ביצוע ומודיעין. כל אחד מדווח למחזור העבודה של החברה.' }),
      ),
      h('div', { class: 'head-actions' },
        h('span', { class: 'pill', text: `${busy.length} פעילים` }),
        h('button', { class: 'btn btn-sm', onclick: async () => { await tick({ reason: 'manual' }); ui.rerender(); } }, 'הרץ מחזור'),
      ),
    ),
    h('div', { class: 'grid cols-2' },
      agents.map(agentCard),
    ),
  );

  mount(root, h('div', { class: 'card', style: { marginTop: '14px' } },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', { text: 'צינור העבודה של החברה' }), h('div', { class: 'card-sub', text: 'מחזור מלא: מרעיון ועד בוט שרץ' })),
    ),
    h('div', { class: 'grid cols-2' },
      PIPELINE.map(([title, desc], i) => h('div', { class: 'agent' },
        h('div', { class: 'av', text: String(i + 1) }),
        h('div', { class: 'grow' },
          h('div', { class: 'who', text: title }),
          h('div', { class: 'small muted', text: desc }),
        ),
      )),
    ),
  ));

  mount(root, h('div', { class: 'grid cols-2', style: { marginTop: '14px' } },
    section('יומן מלא', 'כרונולוגי, מהחדש לישן', feedList(state.events, 40)),
    section('מדדי תפוקה', 'מאז פתיחת המערכת',
      h('div', { class: 'grid cols-2' },
        stat('מחזורים שהושלמו', num(state.stats.cycles || 0)),
        stat('בקטסטים', num(state.stats.backtests || 0)),
        stat('גרסאות שפורסמו', num(state.stats.deployments || 0)),
        stat('סריקות מחקר', num(state.stats.scans || 0)),
      ),
      notice('הסוכנים הם תהליכים בדפדפן: הם מתקדמים בזמן שהטאב פתוח, ומשלימים עד 3 מחזורים בפתיחה הבאה.', 'blue'),
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', { class: 'btn btn-sm', onclick: () => ui.go('research') }, 'פתח מחקר'),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => ui.go('docs') }, 'איך זה עובד'),
      ),
    ),
  ));
}

function stat(label, value) {
  return h('div', { class: 'metric' }, h('span', { text: label }), h('b', { text: value }));
}
