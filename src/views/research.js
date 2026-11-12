import { mount } from '../ui.js';
import { store } from '../store.js';
import { RESEARCH_SOURCES } from '../config.js';
import { h, pct, num, section, tag, notice, empty, toast, timeAgo, downloadFile, openModal } from '../ui.js';
import { budgetSnapshot, scanGitHub, scanFearGreed, scanTrending, scanReddit, scanNews, refreshSentiment, saveContextToGitHub, buildContextDocument, scoreText } from '../research.js';
import { testIdea } from '../firm.js';
import { testAllFeeds } from '../conncheck.js';

let connResults = null;
import { strategyName } from './shared.js';

export function renderResearch(root, ui) {
  const state = store.state;
  const budgets = budgetSnapshot();
  const targetDesk = state.desks.find((d) => d.id === ui.selectedDesk) || state.desks[0];

  const act = async (fn, okMessage) => {
    try {
      const res = await fn();
      toast(okMessage, 'ok');
      ui.rerender();
      return res;
    } catch (err) {
      toast(err.message || 'הפעולה נכשלה', 'bad');
    }
  };

  const queryInput = h('input', { type: 'text', value: 'freqtrade strategy', placeholder: 'חיפוש GitHub, למשל: "backtesting crypto strategies"' });

  mount(root, 
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: 'Research radar' }),
        h('h1', { text: 'מחקר וסריקה' }),
        h('p', { text: 'הסוכנים סורקים מקורות חינמיים וציבוריים, שומרים מכסת שאילתות כדי לא לשרוף מפתחות, ומזרימים רעיונות לבדיקה על השולחנות.' }),
      ),
      h('div', { class: 'head-actions' },
        h('button', { class: 'btn', onclick: () => act(() => refreshSentiment(), 'כל המקורות נסרקו') }, '⟳ סרוק הכל'),
      ),
    ),
  );

  mount(root, h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', { text: 'מכסת שאילתות חינמיות' }), h('div', { class: 'card-sub', text: 'הסוכנים מכבדים את המגבלות של כל ספק' })),
    ),
    h('div', { class: 'grid cols-4' },
      budgets.map((b) => h('div', { class: 'metric' },
        h('span', { text: b.label }),
        h('b', { class: b.used >= b.total ? 'red' : 'green', text: `${b.used}/${b.total}` }),
        h('div', { class: 'tiny muted', text: b.used >= b.total ? `יתאפס ${timeAgo(b.resetAt + 3600000)}` : `נשארו ${b.total - b.used}` }),
      )),
    ),
    notice('GitHub ללא טוקן: 10 בקשות/דקה. מומלץ להוסיף טוקן קריאה בהגדרות כדי להעלות את המכסה. Fear & Greed ו-CoinGecko חינמיים ללא מפתח.', 'blue'),
  ));

  mount(root, h('div', { class: 'card', style: { marginTop: '14px' } },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', { text: 'בדיקת חיבורים חיים' }), h('div', { class: 'card-sub', text: 'נרות היסטוריים · מחיר זמן אמת · WebSocket · סנטימנט · מחקר' })),
      h('button', {
        class: 'btn btn-sm',
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          btn.textContent = 'בודק…';
          connResults = await testAllFeeds();
          btn.disabled = false;
          btn.textContent = 'בדוק חיבורים';
          ui.rerender();
        },
      }, 'בדוק חיבורים'),
    ),
    connResults
      ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { text: 'מקור' }), h('th', { text: 'סוג' }), h('th', { text: 'מצב' }), h('th', { class: 'num', text: 'זמן תגובה' }))),
        h('tbody', {}, connResults.map((r) => h('tr', {},
          h('td', { text: r.label }),
          h('td', { class: 'tiny muted', text: r.kind }),
          h('td', { class: r.ok ? 'green' : 'red' }, r.ok ? '✔ עובד' : `✕ ${r.error || 'HTTP ' + r.status}`),
          h('td', { class: 'num', text: r.ms + 'ms' }),
        ))),
      ))
      : h('div', { class: 'small muted', text: 'לחץ כדי לפנות בפועל לכל מקור מהדפדפן הזה. מקור שנכשל מסומן באדום, והמערכת ממשיכה עם החלופות ונתוני ההדגמה.' }),
  ));

  mount(root, h('div', { class: 'grid cols-2', style: { marginTop: '14px' } },
    section('סריקת GitHub', 'ריפואים של אסטרטגיות, בקטסטים ובוטים',
      h('div', { class: 'row', style: { gap: '6px' } },
        queryInput,
        h('button', { class: 'btn btn-primary btn-sm', onclick: () => act(() => scanGitHub(queryInput.value || 'freqtrade strategy'), 'סריקת GitHub הושלמה') }, 'סרוק'),
      ),
      h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '8px' } },
        ['freqtrade strategy', 'trading bot open source', 'backtesting framework', 'quant strategy crypto'].map((q) =>
          h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { queryInput.value = q; act(() => scanGitHub(q), 'נסרק'); } }, q)),
      ),
    ),
    section('סנטימנט וחדשות', 'מדדים וכותרות בזמן אמת',
      h('div', { class: 'row wrap', style: { gap: '6px' } },
        h('button', { class: 'btn btn-sm', onclick: () => act(() => scanFearGreed(), 'מדד פחד/חמדנות עודכן') }, 'Fear & Greed'),
        h('button', { class: 'btn btn-sm', onclick: () => act(() => scanTrending(), 'מגמות CoinGecko עודכנו') }, 'CoinGecko Trending'),
        h('button', { class: 'btn btn-sm', onclick: () => act(() => scanReddit(), 'כותרות Reddit נאספו') }, 'Reddit'),
        h('button', { class: 'btn btn-sm', onclick: () => act(() => scanNews(), 'כותרות החדשות נטענו') }, 'חדשות (endpoint)'),
      ),
      h('div', { class: 'small muted', style: { marginTop: '10px' } },
        `עודכן: ${state.sentiment.updatedAt ? timeAgo(state.sentiment.updatedAt) : 'טרם'} · ` +
        `מדד: ${state.sentiment.fearGreed ? state.sentiment.fearGreed.value : '—'} · ` +
        `כותרות: ${state.sentiment.headlines?.length || 0}`,
      ),
      h('button', { class: 'btn btn-sm btn-ghost', style: { marginTop: '8px' }, onclick: () => ui.go('sentiment') }, 'לניתוח הסנטימנט →'),
    ),
  ));

  mount(root, h('div', { class: 'card', style: { marginTop: '14px' } },
    h('div', { class: 'card-head' },
      h('div', {},
        h('h2', { text: 'רעיונות שנאספו' }),
        h('div', { class: 'card-sub', text: `${state.ideas.length} רעיונות · ${state.ideas.filter((i) => i.tested).length} נבדקו` }),
      ),
      h('div', { class: 'row', style: { gap: '6px' } },
        h('span', { class: 'tiny muted', text: 'שלח לבדיקה על:' }),
        h('select', {
          onchange: (e) => ui.setDesk(e.target.value),
          style: { width: '210px' },
        }, state.desks.map((d) => h('option', { value: d.id, selected: d.id === targetDesk.id }, `${d.label} · ${d.symbol}`))),
      ),
    ),
    state.ideas.length
      ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {},
          h('th', { text: 'רעיון' }), h('th', { text: 'מקור' }), h('th', { text: 'משפחה' }),
          h('th', { text: 'טווח' }), h('th', { text: 'סטטוס' }), h('th', { text: '' }),
        )),
        h('tbody', {}, state.ideas.slice(0, 30).map((idea) => h('tr', {},
          h('td', {},
            h('a', { href: idea.url, target: '_blank', rel: 'noreferrer', style: { fontWeight: 600 }, text: idea.title }),
            h('div', { class: 'tiny muted', text: (idea.desc || '').slice(0, 90) }),
          ),
          h('td', { class: 'tiny muted', text: `${idea.source}${idea.stars ? ' · ★' + idea.stars : ''}` }),
          h('td', { class: 'tiny', text: idea.strategy ? strategyName(idea.strategy) : '—' }),
          h('td', { class: 'tiny', text: idea.timeframe || '—' }),
          h('td', {},
            idea.tested ? tag(idea.result || 'נבדק', 'dry') : tag('ממתין', ''),
          ),
          h('td', {},
            h('button', {
              class: 'btn btn-sm',
              onclick: async () => {
                toast('שולח לבדיקה...', '');
                await testIdea(idea.id, targetDesk.id);
                ui.rerender();
              },
            }, 'בדוק עכשיו'),
          ),
        ))),
      ))
      : empty('עוד לא נאספו רעיונות — התחל בסריקת GitHub'),
  ));

  mount(root, h('div', { class: 'grid cols-2', style: { marginTop: '14px' } },
    section('זיכרון החברה', 'הקונטקסט נשמר מקומית ואפשר לדחוף אותו לריפו GitHub',
      h('div', { class: 'grid cols-2' },
        h('button', { class: 'btn btn-sm', onclick: () => { downloadFile('firm-context.json', buildContextDocument() && JSON.stringify(buildContextDocument(), null, 2), 'application/json'); toast('הקונטקסט הורד', 'ok'); } }, '⬇ ייצוא קונטקסט'),
        h('button', {
          class: 'btn btn-sm btn-ghost',
          onclick: () => openModal('תצוגת קונטקסט', h('pre', { class: 'code', text: JSON.stringify(buildContextDocument(), null, 2) }), { wide: true }),
        }, '👁 תצוגה'),
        h('button', {
          class: 'btn btn-sm',
          onclick: async () => {
            try {
              const url = await saveContextToGitHub();
              toast(url ? 'נשמר לקומיט ב-GitHub' : 'הקונטקסט נשמר', 'ok');
            } catch (err) { toast(err.message, 'bad'); }
          },
        }, '☁ שמור ל-GitHub'),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => ui.go('settings') }, 'הגדר טוקן וריפו →'),
      ),
      h('div', { class: 'small muted', style: { marginTop: '10px' } },
        'השמירה משתמשת ב-Contents API עם טוקן fine-grained (הרשאת contents:write). הטוקן נשאר בדפדפן שלך בלבד.',
      ),
      notice('הקונטקסט כולל פרמטרים, מדדים, רעיונות וסטטיסטיקות — לא מפתחות API.', 'blue'),
    ),
    section('מקורות מוגדרים', 'מה נסרק ומה המגבלות',
      h('ul', { class: 'list-clean' },
        Object.entries(RESEARCH_SOURCES).map(([k, src]) => h('li', {},
          h('span', { class: 'bul', text: '•' }),
          h('div', { class: 'grow' },
            h('div', { style: { fontWeight: 600 }, text: src.label }),
            h('div', { class: 'tiny muted', text: src.note }),
          ),
        )),
        h('li', {},
          h('span', { class: 'bul', text: '•' }),
          h('div', { class: 'grow' },
            h('div', { style: { fontWeight: 600 }, text: 'Reddit r/CryptoCurrency, r/algotrading' }),
            h('div', { class: 'tiny muted', text: 'כותרות חמות לסנטימנט. עלול להיחסם לפי CORS; אם נכשל — המערכת ממשיכה עם המקורות האחרים.' }),
          ),
        ),
      ),
    ),
  ));
}
