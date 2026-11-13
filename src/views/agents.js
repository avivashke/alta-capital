import { store } from '../store.js';
import { h, num, section, notice, timeAgo } from '../ui.js';
import { feedList } from './shared.js';
import { tick } from '../firm.js';

const PIPELINE = [
  ['סריקה', 'איסוף אסטרטגיות, קוד ומחקר מ-GitHub, חדשות ומקורות פתוחים'],
  ['מחקר גאן וזמן', 'ניתוח רב-שנתי של נתונים וגרפים: מחזורי זמן, לוח שנה מסחרי, זוויות/רמות גאן ודפוסים חוזרים'],
  ['בקטסט', 'הרצה על נתוני עבר עם עמלות, walk-forward וניהול סיכון'],
  ['אופטימיזציה', 'כיול מתמטי: grid/random search, hill-climb ו-Walk-Forward'],
  ['שערי סיכון', 'PF, DD, יציבות, OOS, expectancy ומספר עסקאות מינימלי'],
  ['גרסה/רובוט', 'אריזת קוד, יצירת רובוט חדש או עדכון קיים לאסטרטגיות שעברו אימות'],
  ['dry-run', 'הרצה על נייר בזמן אמת לאימות לפני קידום'],
  ['חי על נייר', 'מעקב ביצועים, ניתוח סטיות והמשך מיטוב רציף'],
];

const ROOMS = {
  research: { id: 'research', label: 'חדר מחקר ומודיעין', x: 6, y: 10, w: 40, h: 34, color: 'rgba(88,166,255,.12)' },
  gann:     { id: 'gann', label: 'מעבדת גאן ומחזורי זמן', x: 54, y: 10, w: 40, h: 34, color: 'rgba(167,139,250,.12)' },
  quant:    { id: 'quant', label: 'מעבדת קוונטים ובקטסט', x: 6, y: 54, w: 40, h: 36, color: 'rgba(0,229,255,.10)' },
  ops:      { id: 'ops', label: 'חדר בקרה, סיכון וביצוע', x: 54, y: 54, w: 40, h: 36, color: 'rgba(46,204,113,.10)' },
};

function roomFor(agent) {
  const id = agent.id || '';
  const task = ((agent.task || '') + ' ' + (agent.thinking || '') + ' ' + (agent.speech || '')).toLowerCase();
  if (/gann|גאן|מחזור|זמן|calendar|cycle|זווית|square/i.test(id + task) || id.startsWith('gann')) return 'gann';
  if (/intel|research|סריק|github|חדשות|מודיעין|עומר/i.test(id + task)) return 'research';
  if (/quant|backtest|optimizer|ta|בקטסט|אופטימ|ניתוח|נועה|איתי|ליה|יעל/i.test(id + task)) return 'quant';
  if (/cio|risk|exec|dev|ניהול|סיכון|ביצוע|פיתוח|אוריה|דניאל|תמר|גיא/i.test(id + task)) return 'ops';
  return 'research';
}

function slotInRoom(roomId, idx, total) {
  const r = ROOMS[roomId];
  const cols = Math.max(2, Math.ceil(Math.sqrt(Math.max(total, 1))));
  const rows = Math.max(1, Math.ceil(total / cols));
  const row = Math.floor(idx / cols);
  const col = idx % cols;
  const padX = 10, padTop = 38, padBottom = 8; // leave headroom for bubbles above
  const usableW = r.w - padX * 2;
  const usableH = r.h - padTop - padBottom;
  const x = r.x + padX + (usableW * (col + 0.5)) / cols;
  const y = r.y + padTop + (usableH * (row + 0.85)) / rows; // feet/bottom point
  return { x: Math.max(r.x + 9, Math.min(r.x + r.w - 9, x)), y: Math.max(r.y + padTop + 18, Math.min(r.y + r.h - 6, y)) };
}

function short(text, n = 32) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
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
  const full = parts.join('\n') || agent.focus || 'במעקב ומוכן לפעולה';
  const kind = agent.thinking ? 'think' : (agent.speech ? (agent.speechType || 'speak') : (busy ? 'work' : 'idle'));
  const headline = agent.thinking || agent.speech || agent.task || agent.focus || (busy ? 'עובד על מחקר ומיטוב…' : 'מוכן לפעולה');
  return { full, kind, headline, busy };
}

function mount(root, ...children) {
  for (const child of children.flat(6)) {
    if (child == null || child === false) continue;
    root.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return root;
}

function teamScene(agents) {
  const byRoom = { research: [], gann: [], quant: [], ops: [] };
  agents.forEach((a) => { byRoom[roomFor(a)].push(a); });

  const roomEls = Object.values(ROOMS).map((r) =>
    h('div', { class: 'office-room room-' + r.id, style: { left: r.x + '%', top: r.y + '%', width: r.w + '%', height: r.h + '%' } },
      h('div', { class: 'office-room-label', text: r.label }),
    )
  );

  const agentEls = [];
  Object.entries(byRoom).forEach(([rid, list]) => {
    list.forEach((agent, i) => {
      const pos = slotInRoom(rid, i, list.length);
      const info = actionInfo(agent);
      const busy = info.busy;
      const progress = Math.max(0, Math.min(100, Number(agent.progress || (busy ? 45 : 0))));
      const since = agent.lastActive ? timeAgo(agent.lastActive) : '';
      const titleDetail = agent.name + ' · ' + agent.role
        + (agent.focus ? ('\nתחום: ' + agent.focus) : '')
        + (since ? ('\nפעילות אחרונה: ' + since) : '')
        + '\nמשימות שהושלמו: ' + (agent.completed || 0);
      const processDetail = info.full + (busy ? ('\nהתקדמות: ' + progress + '%') : '');
      const facing = (i % 2 === 0) ? 1 : -1;
      const walkDur = (7 + (i % 4)) + 's';
      agentEls.push(h('div', {
        class: 'agent3d ' + (busy ? 'is-busy' : 'is-idle') + ' in-' + rid,
        style: { left: pos.x + '%', top: pos.y + '%', '--delay': (i * 0.6) + 's', '--walkdur': walkDur, '--face': facing },
        title: titleDetail,
      },
        h('div', { class: 'agent3d-bubble ' + info.kind, title: processDetail },
          h('div', { class: 'bubble-kind', text: info.kind === 'think' ? 'מחשבה' : info.kind === 'speak' ? 'עדכון' : busy ? 'פעולה' : 'מוכן' }),
          h('div', { class: 'bubble-text', text: short(info.headline, 30) }),
          h('div', { class: 'bubble-hover', text: info.full }),
        ),
        h('div', { class: 'agent3d-body' },
          h('div', { class: 'agent3d-shadow' }),
          h('div', { class: 'agent3d-figure' },
            h('div', { class: 'a-head' }, h('span', { text: agent.icon || '☻' })),
            h('div', { class: 'a-torso' }, h('div', { class: 'a-core' }), h('div', { class: 'a-body' })),
            h('div', { class: 'a-arm left' }), h('div', { class: 'a-arm right' }),
            h('div', { class: 'a-leg left' }), h('div', { class: 'a-leg right' }),
          ),
          h('div', { class: 'agent3d-tag' },
            h('b', { class: 'a-name', text: short(agent.name, 12), title: titleDetail }),
            h('span', { class: 'a-role', text: short(agent.role, 16), title: titleDetail }),
          ),
          h('div', { class: 'agent3d-action ' + (busy ? 'active' : 'idle'), title: processDetail },
            h('div', { class: 'act-text', text: short(busy ? (agent.task || info.headline) : (agent.focus || 'במעקב'), 24) }),
            h('div', { class: 'act-bar' }, h('i', { style: { width: progress + '%' } })),
          ),
        ),
      ));
    });
  });

  return h('div', { class: 'team3d-stage office-view cyber-retro' },
    h('div', { class: 'office-bg' }),
    h('div', { class: 'scanlines' }),
    h('div', { class: 'office-floor' }),
    h('div', { class: 'office-grid' }),
    ...roomEls,
    h('div', { class: 'team3d-holo office-core' },
      h('div', { class: 'holo-ring' }),
      h('div', { class: 'holo-ring r2' }),
      h('div', { class: 'holo-core' }),
      h('div', { class: 'holo-label', text: 'CORE · מחקר, גאן, מיטוב וביצוע' }),
    ),
    ...agentEls,
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
        h('p', { text: 'מבט-על משרדי בסגנון סייבר-רטרו: הדמויות עומדות ומהלכות בתוך חדרים, מדברות בבועות מסודרות מעל הראש (ללא חפיפה לדמות) ועובדות ברצף על מחקר, ניתוח גאן רב-שנתי, מיטוב, בניית רובוטים וביצוע.' }),
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
        h('h2', { text: 'משרד סוכנים · מבט מעוף הציפור' }),
        h('div', { class: 'card-sub', text: 'העבר עכבר על בועה/דמות לפרטים מלאים. סוכני גאן (גדעון, גליה, גיל, גלעד, גנית) משולבים בחדר גאן ובתהליך המחקר, האופטימיזציה ובניית הרובוטים.' }),
      ),
      h('span', { class: 'pill pill-sim', text: 'LIVE' }),
    ),
    teamScene(agents),
    h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '10px' } },
      h('span', { class: 'pill', text: 'מחקר GitHub ורשת רציף' }),
      h('span', { class: 'pill', text: 'אנליסטי גאן: זמן, זוויות ותבניות רב-שנתיות' }),
      h('span', { class: 'pill', text: 'אינטגרציית גאן בתהליך העבודה והאסטרטגיות' }),
      h('span', { class: 'pill', text: 'מיטוב מתמטי + Walk-Forward' }),
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
      notice('אנליסטי גאן משולבים במחקר ובמחזור: ניתוח מחזורי זמן, זוויות/רמות ותבניות רב-שנתיות מוזן לשלב המחקר, האופטימיזציה ובניית האסטרטגיות.', 'blue'),
    ),
  ));

  mount(root, h('div', { class: 'grid cols-2', style: { marginTop: '14px' } },
    section('יומן פעילות חי', 'מחקר, מחשבות, אופטימיזציה והחלטות', feedList(state.events, 60)),
    section('מדדי תפוקה', 'קצב העבודה של הצוותים',
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
  const full = info.full + (busy ? ('\nהתקדמות: ' + progress + '%') : '');
  return h('div', { class: 'agent-detail ' + (busy ? 'busy' : ''), title: full },
    h('div', { class: 'av', text: agent.icon || '☻' }),
    h('div', { class: 'grow' },
      h('div', { class: 'who' }, h('b', { text: agent.name }), h('span', { text: ' · ' + agent.role })),
      h('div', { class: 'small', text: busy ? (agent.task || info.headline) : (agent.focus || 'במעקב') }),
      h('div', { class: 'small muted', style: { marginTop: '4px', whiteSpace: 'pre-wrap' }, text: short(info.full.replace(/\n/g, ' · '), 180) }),
      busy ? h('div', { class: 'act-bar', style: { marginTop: '6px' } }, h('i', { style: { width: progress + '%' } })) : null,
    ),
    h('div', { class: 'tiny muted mono', text: agent.lastActive ? timeAgo(agent.lastActive) : '' }),
  );
}

function stat(label, value) {
  return h('div', { class: 'metric' }, h('span', { text: label }), h('b', { text: value }));
}
