import { mount } from '../ui.js';
import { store } from '../store.js';
import { h, num, section, notice, timeAgo } from '../ui.js';
import { feedList } from './shared.js';
import { tick } from '../firm.js';

const PIPELINE = [
  ['סריקה', 'איסוף אסטרטגיות, קוד ומחקר מ-GitHub, חדשות ומקורות פתוחים'],
  ['מחקר', 'ניתוח עומק: שיטות גאן (זוויות, רמות מחיר/זמן, מחזורי זמן ולוח שנה), מומנטום, mean-reversion ועוד'],
  ['בקטסט', 'הרצה על נתוני עבר עם עמלות, החלקה, walk-forward וניהול סיכון'],
  ['אופטימיזציה', 'כיול מתמטי: grid/random search, hill-climb, Walk-Forward וניתוח רגישות לפרמטרים'],
  ['שערי סיכון', 'PF, DD, יציבות, OOS, expectancy ומספר עסקאות מינימלי'],
  ['גרסה/רובוט', 'אריזת קוד, יצירת רובוט חדש או עדכון קיים לאסטרטגיות שעברו אימות'],
  ['dry-run', 'הרצה על נייר בזמן אמת לאימות לפני קידום'],
  ['חי על נייר', 'מעקב ביצועים, ניתוח סטיות והמשך מיטוב רציף ללא הפסקה'],
];

const SLOTS = [
  { x: 14, y: 22, z: 30 }, { x: 34, y: 16, z: 80 }, { x: 56, y: 20, z: 50 },
  { x: 78, y: 24, z: 10 }, { x: 20, y: 60, z: 60 }, { x: 42, y: 68, z: 0 },
  { x: 64, y: 62, z: 90 }, { x: 84, y: 66, z: 40 },
];

function short(text, n = 38) {
  const t = String(text || '').replace(/s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function actionInfo(agent) {
  const busy = agent.status === 'busy';
  const parts = [];
  if (agent.thinking) parts.push('מחשבה: ' + agent.thinking);
  if (agent.speech) parts.push((agent.speechType === 'think' ? 'ניתוח: ' : 'עדכון: ') + agent.speech);
  if (agent.task) parts.push('משימה נוכחית: ' + agent.task);
  if (agent.focus) parts.push('תחום אחריות: ' + agent.focus);
  if (agent.lastActive) parts.push('עודכן: ' + timeAgo(agent.lastActive));
  if (agent.completed) parts.push('משימות שהושלמו: ' + agent.completed);
  const full = parts.join('
') || agent.focus || 'במעקב ומוכן לפעולה';
  const kind = agent.thinking ? 'think' : (agent.speech ? (agent.speechType || 'speak') : (busy ? 'work' : 'idle'));
  const headline = agent.thinking || agent.speech || agent.task || agent.focus || (busy ? 'עובד על מחקר ומיטוב…' : 'מוכן לפעולה');
  return { full, kind, headline, busy };
}

function teamScene(agents) {
  return h('div', { class: 'team3d-stage cyber' },
    h('div', { class: 'team3d-room' },
      h('div', { class: 'cyber-bg' }),
      h('div', { class: 'scanlines' }),
      h('div', { class: 'team3d-floor' }),
      h('div', { class: 'team3d-grid' }),
      h('div', { class: 'team3d-holo' },
        h('div', { class: 'holo-ring' }),
        h('div', { class: 'holo-ring r2' }),
        h('div', { class: 'holo-ring r3' }),
        h('div', { class: 'holo-core' }),
        h('div', { class: 'holo-label', text: 'CORE · מחקר, מיטוב וביצוע רציף' }),
      ),
      ...agents.map((agent, i) => {
        const pos = SLOTS[i % SLOTS.length];
        const info = actionInfo(agent);
        const busy = info.busy;
        const progress = Math.max(0, Math.min(100, Number(agent.progress || (busy ? 45 : 0))));
        const since = agent.lastActive ? timeAgo(agent.lastActive) : '';
        const titleDetail = agent.name + ' · ' + agent.role
          + (agent.focus ? ('
תחום: ' + agent.focus) : '')
          + (since ? ('
פעילות אחרונה: ' + since) : '')
          + '
משימות שהושלמו: ' + (agent.completed || 0);
        const processDetail = info.full + (busy ? ('
התקדמות: ' + progress + '%') : '');
        return h('div', {
          class: 'agent3d ' + (busy ? 'is-busy' : 'is-idle'),
          style: { left: pos.x + '%', top: pos.y + '%', '--z': pos.z + 'px', '--delay': (i * 0.8) + 's', '--dur': (busy ? 7 : 11) + 's' },
          title: titleDetail,
        },
          h('div', { class: 'agent3d-shadow' }),
          h('div', { class: 'agent3d-bubble ' + info.kind, title: processDetail },
            h('div', { class: 'bubble-kind', text: info.kind === 'think' ? 'מחשבה' : info.kind === 'speak' ? 'עדכון' : busy ? 'פעולה' : 'מוכן' }),
            h('div', { class: 'bubble-text', text: short(info.headline, 44) }),
            h('div', { class: 'bubble-hover', text: info.full }),
          ),
          h('div', { class: 'agent3d-figure' },
            h('div', { class: 'a-head' }, h('span', { text: agent.icon || '☻' })),
            h('div', { class: 'a-torso' }, h('div', { class: 'a-core' }), h('div', { class: 'a-body' })),
            h('div', { class: 'a-arm left' }), h('div', { class: 'a-arm right' }),
            h('div', { class: 'a-leg left' }), h('div', { class: 'a-leg right' }),
          ),
          h('div', { class: 'agent3d-tag' },
            h('b', { class: 'a-name', text: short(agent.name, 14), title: titleDetail }),
            h('span', { class: 'a-role', text: short(agent.role, 22), title: titleDetail }),
          ),
          h('div', { class: 'agent3d-action ' + (busy ? 'active' : 'idle'), title: processDetail },
            h('div', { class: 'act-text', text: short(busy ? (agent.task || info.headline) : (agent.focus || 'במעקב וסריקה'), 30) }),
            h('div', { class: 'act-bar' }, h('i', { style: { width: progress + '%' } })),
          ),
        );
      }),
    ),
  );
}

export function renderAgents(root, ui) {
  const state = store.state;
  const agents = state.agents || [];
  const busy = agents.filter((a) => a.status === 'busy');

  mount(root,
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: 'Cyber Ops · צוות הסוכנים החי' }),
        h('h1', { text: 'הצוות' }),
        h('p', { text: 'תצוגה חיה: דמויות תלת־ממדיות, מחשבות ופעולות. הסוכנים עובדים ברצף על מחקר, מיטוב מתמטי, בנייה ועדכון של רובוטים, וחיפוש מתמשך אחר אסטרטגיות חדשות — כולל שיטות גאן (זוויות, מחיר/זמן, מחזורי זמן ולוח שנה).' }),
      ),
      h('div', { class: 'head-actions' },
        h('span', { class: busy.length ? 'pill pill-live' : 'pill', text: busy.length ? (busy.length + ' פעילים עכשיו') : 'במעקב פעיל' }),
        h('button', { class: 'btn btn-sm btn-primary', onclick: async () => { await tick({ reason: 'manual' }); ui.rerender(); } }, 'הרץ מחזור'),
      ),
    ),
  );

  mount(root, h('div', { class: 'card team3d-card' },
    h('div', { class: 'card-head' },
      h('div', {},
        h('h2', { text: 'חלל עבודה תלת־ממדי · שידור חי' }),
        h('div', { class: 'card-sub', text: 'תוויות מקוצרות לנראות נקייה; העבר עכבר על שם, תפקיד, בועה או תהליך כדי לראות פירוט מלא ומחשבות.' }),
      ),
      h('span', { class: 'pill pill-sim', text: 'LIVE' }),
    ),
    teamScene(agents),
    h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '10px' } },
      h('span', { class: 'pill', text: 'מחקר GitHub ורשת רציף' }),
      h('span', { class: 'pill', text: 'מיטוב מתמטי + Walk-Forward' }),
      h('span', { class: 'pill', text: 'גאן: זוויות, מחיר/זמן, לוח שנה' }),
      h('span', { class: 'pill', text: 'יצירה ועדכון אוטומטי של רובוטים' }),
    ),
  ));

  mount(root, h('div', { class: 'grid cols-2', style: { marginTop: '14px' } },
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', { text: 'סטטוס ומחשבות מפורטות' }), h('div', { class: 'card-sub', text: 'פירוט מלא לכל סוכן — העבר עכבר לפרטים' }))),
      h('div', { class: 'agent-detail-list' }, agents.map(detailedAgent)),
    ),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', { text: 'צינור עבודה אוטונומי' }), h('div', { class: 'card-sub', text: 'מרעיון ועד רובוט פעיל' }))),
      h('div', { class: 'grid cols-1' },
        PIPELINE.map(([title, desc], i) => h('div', { class: 'agent pipe-step', title: desc },
          h('div', { class: 'av', text: String(i + 1) }),
          h('div', { class: 'grow' }, h('div', { class: 'who', text: title }), h('div', { class: 'small muted', text: desc })),
        )),
      ),
      notice('אסטרטגיה שעוברת בדיקות ושערי סיכון מקודמת/ממומשת כרובוט וממשיכה לעבור מיטוב ועדכון שוטף. המערכת סורקת GitHub לפתרונות מיטוב ואסטרטגיות חדשות (כולל גאן).', 'blue'),
    ),
  ));

  mount(root, h('div', { class: 'grid cols-2', style: { marginTop: '14px' } },
    section('יומן פעילות חי', 'מחקר, מחשבות, אופטימיזציה והחלטות', feedList(state.events, 60)),
    section('מדדי תפוקה', 'קצב העבודה של הצוות',
      h('div', { class: 'grid cols-2' },
        stat('מחזורים', num(state.stats.cycles || 0)),
        stat('בקטסטים', num(state.stats.backtests || 0)),
        stat('גרסאות/רובוטים', num(state.stats.deployments || 0)),
        stat('סריקות מחקר', num(state.stats.scans || 0)),
      ),
      h('div', { class: 'row', style: { marginTop: '10px', gap: '8px' } },
        h('button', { class: 'btn btn-sm', onclick: () => ui.go('research') }, 'מחקר'),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => ui.go('charts') }, 'גרפים'),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => ui.go('settings') }, 'מודלים ו-API'),
      ),
    ),
  ));
}

function detailedAgent(agent) {
  const busy = agent.status === 'busy';
  const info = actionInfo(agent);
  const progress = Math.max(0, Math.min(100, Number(agent.progress || 0)));
  const full = info.full + (busy ? ('
התקדמות: ' + progress + '%') : '');
  return h('div', { class: 'agent-detail ' + (busy ? 'busy' : ''), title: full },
    h('div', { class: 'av', text: agent.icon || '☻' }),
    h('div', { class: 'grow' },
      h('div', { class: 'who' }, h('b', { text: agent.name }), h('span', { text: ' · ' + agent.role })),
      h('div', { class: 'small', text: busy ? (agent.task || info.headline) : (agent.focus || 'במעקב') }),
      h('div', { class: 'small muted', style: { marginTop: '4px', whiteSpace: 'pre-wrap' }, text: short(info.full, 220) }),
      busy ? h('div', { class: 'act-bar', style: { marginTop: '6px' } }, h('i', { style: { width: progress + '%' } })) : null,
    ),
    h('div', { class: 'tiny muted mono', text: agent.lastActive ? timeAgo(agent.lastActive) : '' }),
  );
}

function stat(label, value) {
  return h('div', { class: 'metric' }, h('span', { text: label }), h('b', { text: value }));
}
