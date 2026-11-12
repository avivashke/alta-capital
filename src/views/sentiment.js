import { mount } from '../ui.js';
import { store } from '../store.js';
import { h, pct, num, section, tag, notice, empty, toast, timeAgo, chart } from '../ui.js';
import { refreshSentiment, scoreText } from '../research.js';

export function renderSentiment(root, ui) {
  const state = store.state;
  const sent = state.sentiment;
  const fg = sent.fearGreed;

  const act = async (fn, msg) => {
    try { await fn(); toast(msg, 'ok'); ui.rerender(); } catch (err) { toast(err.message, 'bad'); }
  };

  mount(root, 
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: 'Market intelligence' }),
        h('h1', { text: 'סנטימנט וחדשות' }),
        h('p', { text: 'שילוב של מדד פחד/חמדנות, מגמות חיפוש, כותרות מרשתות חברתיות וניתוח טכני — כדי לתת הטיה מקומית לשולחנות, לא תחזית.' }),
      ),
      h('div', { class: 'head-actions' },
        h('button', { class: 'btn btn-primary', onclick: () => act(() => refreshSentiment(), 'הסנטימנט עודכן') }, '⟳ רענן סנטימנט'),
      ),
    ),
  );

  mount(root, h('div', { class: 'grid cols-3' },
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', { text: 'פחד / חמדנות' }), h('div', { class: 'card-sub', text: fg ? `${fg.label} · ${timeAgo(fg.at)}` : 'טרם נסרק' }))),
      h('div', { class: 'gauge' },
        h('div', { class: 'ring', style: { '--v': fg?.value ?? 0 } }, h('b', { text: fg?.value ?? '—' })),
        h('div', { class: 'grow' },
          fg ? h('div', {},
            h('div', { class: 'small', text: fg.value < 25 ? 'פחד קיצוני — לעתים אזור הזדמנות, אבל רק עם אישור מחיר.' : fg.value > 75 ? 'חמדנות קיצונית — סכנת תיקון, שקול לצמצם חשיפה.' : 'טווח ניטרלי — אין יתרון סנטימנטלי ברור.' }),
            h('div', { style: { marginTop: '6px' } }, chart((fg.history || []).slice(-10), { height: 40, color: 'gold' })),
          ) : h('div', { class: 'small muted', text: 'לחץ רענון כדי למשוך את המדד החינמי' }),
        ),
      ),
    ),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', { text: 'מגמות חיפוש' }), h('div', { class: 'card-sub', text: 'CoinGecko Trending' }))),
      (sent.trending || []).length
        ? h('div', { class: 'row wrap', style: { gap: '6px' } }, sent.trending.map((c) => tag(`${c.symbol} · ${c.name}`)))
        : h('div', { class: 'small muted', text: 'אין נתונים — הרץ סריקה' }),
    ),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', { text: 'ציון כותרות' }), h('div', { class: 'card-sub', text: `${sent.headlines?.length || 0} כותרות` }))),
      h('div', { class: 'row', style: { gap: '14px' } },
        h('div', { class: 'mono ' + ((sent.newsScore || 0) >= 0 ? 'green' : 'red'), style: { fontSize: '26px' }, text: (sent.newsScore || 0).toFixed(2) }),
        h('div', { class: 'small muted', text: 'ממוצע ציוני סנטימנט: חיובי = נטייה שורית, שלילי = דובי. זהו פרוקסי רעש, לא אות מסחר.' }),
      ),
    ),
  ));

  mount(root, h('div', { class: 'card', style: { marginTop: '14px' } },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', { text: 'הטיה לפי נכס' }), h('div', { class: 'card-sub', text: '30% טכני · 30% כותרות · 20% פחד/חמדנות · 10% מגמה' })),
    ),
    state.desks.length
      ? h('div', { class: 'grid cols-2' }, state.desks.map((desk) => {
        const a = sent.assets?.[desk.symbol];
        return h('div', { class: 'agent' },
          h('div', { class: 'av', text: desk.symbol.slice(0, 3) }),
          h('div', { class: 'grow' },
            h('div', { class: 'who' },
              h('b', { text: desk.symbol }),
              h('span', { text: a ? `${a.bias} · ${a.score > 0 ? '+' : ''}${a.score}` : 'אין נתונים' }),
            ),
            a ? h('div', { class: 'row', style: { gap: '8px', fontSize: '11px' } },
              tag(`טכני ${a.technical}`), tag(`חדשות ${a.news}`), a.price ? tag(`$${num(a.price, 2)}`) : null,
            ) : null,
            a?.drivers?.length ? h('div', { class: 'tiny muted', style: { marginTop: '5px' }, text: a.drivers[0] }) : null,
          ),
          h('div', { class: 'mono ' + (a?.score >= 0 ? 'green' : 'red'), text: a ? (a.score > 0 ? '↑' : '↓') : '·' }),
        );
      }))
      : empty('אין שולחנות'),
  ));

  mount(root, h('div', { class: 'card', style: { marginTop: '14px' } },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', { text: 'כותרות אחרונות' }), h('div', { class: 'card-sub', text: 'ציון מחושב מהמילים שבכותרת ובתיאור' })),
    ),
    (sent.headlines || []).length
      ? h('div', { class: 'feed' }, sent.headlines.slice(0, 20).map((item) => {
        const score = item.score ?? scoreText(item.title);
        return h('div', { class: 'feed-item ' + (score > 0.15 ? 'ok' : score < -0.15 ? 'bad' : '') },
          h('span', { class: 'dot' }),
          h('div', { class: 'grow' },
            item.url
              ? h('a', { href: item.url, target: '_blank', rel: 'noreferrer', text: item.title })
              : h('span', { text: item.title }),
            h('div', { class: 'who', text: `${item.source || '—'} · ${timeAgo(item.at)}` }),
          ),
          h('span', { class: 'mono tiny ' + (score > 0 ? 'green' : score < 0 ? 'red' : 'muted'), text: (score > 0 ? '+' : '') + score.toFixed(2) }),
        );
      }))
      : empty('אין כותרות — חבר endpoint חדשות בהגדרות או הרץ סריקת Reddit'),
    notice('הסנטימנט משמש כשכבה מגנה: הוא יכול להקטין חשיפה או לעכב כניסה, אבל הקידום והגרסאות נקבעים לפי בקטסט ו-OOS בלבד.', 'blue'),
  ));
}
