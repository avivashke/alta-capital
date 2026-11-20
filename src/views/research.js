import { mount } from '../ui.js';
import { store } from '../store.js';
import { RESEARCH_SOURCES } from '../config.js';
import { h, pct, num, section, tag, notice, empty, toast, timeAgo, downloadFile, openModal } from '../ui.js';
import { budgetSnapshot, scanGitHub, scanFearGreed, scanTrending, scanReddit, scanNews, scanYouTube, scanArxivQuant, scanHackerNews, refreshSentiment, saveContextToGitHub, buildContextDocument, scoreText, CURATED_GITHUB_INTEL, runNadavGitHubScout } from '../research.js';
import { testIdea } from '../firm.js';
import { testAllFeeds } from '../conncheck.js';
import { runYonatanYouTubeScout } from '../youtube_scout.js';
import { renderYonatanYouTubeScoutCard } from '../youtube_scout_ui.js';

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
        h('div', { class: 'eyebrow', text: 'Research radar · YouTube Gann & Creators · RSS · Reddit · arXiv · Hacker News' }),
        h('h1', { text: 'מחקר וסריקה' }),
        h('p', { text: 'הסוכנים שואבים אוטומטית מיוטיוב (יונתן: גאן, Doug & Silvia, TradingLab ובוטים ייעודיים), News RSS, Reddit, ערוצי YouTube פיננסיים, arXiv q-fin, Hacker News ו-GitHub.' }),
      ),
      h('div', { class: 'head-actions' },
        h('button', { class: 'btn btn-primary btn-sm', onclick: () => act(() => runYonatanYouTubeScout({ force: true }), 'יונתן סרק סרטוני יוטיוב (גאן + Doug & Silvia) והכין בלופרינטים לבוטים!') }, '▶ סריקת יונתן (יוטיוב גאן + אסטרטגיות)'),
        h('button', { class: 'btn btn-sm', onclick: () => act(() => runNadavGitHubScout(), 'נדב סרק ריפואים ב-GitHub לגאן וייעול המערכת') }, '⌘ סריקת נדב (GitHub)'),
        h('button', { class: 'btn btn-sm', onclick: () => act(() => refreshSentiment(), 'כל 7 מקורות המחקר והחדשות נסרקו!') }, '⟳ סרוק את כל המקורות'),
      ),
    ),
  );

  // Yonatan YouTube Gann & Strategy Creator Scout + Dedicated Bots Proof-of-Profitability Lab
  mount(root, renderYonatanYouTubeScoutCard(ui, { compact: false }));

  mount(root, h('div', { class: 'card', style: { marginTop: '14px' } },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', { text: 'מכסת שאילתות חינמיות ומקורות פעילים' }), h('div', { class: 'card-sub', text: 'הסוכנים שואבים אוטומטית בכל מחזור ומכבדים את מגבלות הקצב של כל מקור' })),
    ),
    h('div', { class: 'grid cols-4' },
      budgets.map((b) => h('div', { class: 'metric' },
        h('span', { text: b.label }),
        h('b', { class: b.used >= b.total ? 'red' : 'green', text: `${b.used}/${b.total}` }),
        h('div', { class: 'tiny muted', text: b.used >= b.total ? `יתאפס ${timeAgo(b.resetAt + 3600000)}` : `נשארו ${b.total - b.used} · קריאות: ${b.calls || 0}` }),
      )),
    ),
    notice('כל המקורות (YouTube Gann & Creators, News RSS, Reddit דרך פרוקסי שרת, YouTube Atom, arXiv q-fin, Hacker News, Fear & Greed, CoinGecko) חינמיים לגמרי ללא צורך במפתחות API ומופעלים אוטומטית בכל סבב מחקר.', 'blue'),
  ));

  mount(root, h('div', { class: 'card', style: { marginTop: '14px' } },
    h('div', { class: 'card-head' },
      h('div', {},
        h('h2', { text: '⌘ נדב · חוקר GitHub וחדשנות קוד (גאן, אינדיקטורים וייעול מערכת)' }),
        h('div', { class: 'card-sub', text: 'מאגר ריפואים שנבדקו להעשרת מודול גאן, אפקטיביות אינדיקטורים ומהירות בקטסט + סריקת GitHub חיה' }),
      ),
      tag(state.githubScout?.updatedAt ? `עודכן ${timeAgo(state.githubScout.updatedAt)}` : 'מאגר ליבה פעיל', 'live'),
    ),
    h('div', { class: 'table-wrap' },
      h('table', {},
        h('thead', {}, h('tr', {}, h('th', { text: 'ריפוזיטורי (GitHub)' }), h('th', { text: 'תחום' }), h('th', { text: 'תרומה למערכת ולאסטרטגיות' }))),
        h('tbody', {}, (state.githubScout?.curated || CURATED_GITHUB_INTEL).map((r) => h('tr', {},
          h('td', { class: 'small' }, h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer', style: { color: '#7dd3fc', fontWeight: '600' } }, r.name)),
          h('td', {}, tag(r.category, 'opt')),
          h('td', { class: 'small muted', text: r.benefit }),
        ))),
      ),
    ),
  ));

  mount(root, h('div', { class: 'card', style: { marginTop: '14px' } },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', { text: 'בדיקת חיבורים חיים' }), h('div', { class: 'card-sub', text: 'נרות היסטוריים · מחיר זמן אמת · News RSS · Reddit · YouTube · arXiv · Hacker News' })),
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
      : h('div', { class: 'small muted', text: 'לחץ כדי לבדוק בפועל את כל מקורות השוק, החדשות, Reddit, YouTube ו-arXiv.' }),
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
    section('חדשות RSS, Reddit, YouTube ו-arXiv', 'סריקה מיידית לפי מקור (רצים גם אוטומטית בכל סבב)',
      h('div', { class: 'row wrap', style: { gap: '6px' } },
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => act(() => scanNews(), 'חדשות RSS נשאבו בהצלחה') }, '📰 News RSS'),
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => act(() => scanReddit(), 'פוסטים מ-Reddit נשאבו בהצלחה') }, '🤖 Reddit'),
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => act(() => scanYouTube(), 'סרטוני YouTube נשאבו בהצלחה') }, '📺 YouTube'),
        h('button', { class: 'btn btn-sm', onclick: () => act(() => scanArxivQuant(), 'מאמרי arXiv q-fin נאספו') }, '📚 arXiv q-fin'),
        h('button', { class: 'btn btn-sm', onclick: () => act(() => scanHackerNews(), 'דיוני Hacker News נאספו') }, '🟠 Hacker News'),
        h('button', { class: 'btn btn-sm', onclick: () => act(() => scanFearGreed(), 'מדד פחד/חמדנות עודכן') }, 'Fear & Greed'),
        h('button', { class: 'btn btn-sm', onclick: () => act(() => scanTrending(), 'מגמות CoinGecko עודכנו') }, 'CoinGecko'),
      ),
      h('div', { class: 'small muted', style: { marginTop: '10px' } },
        `עודכן: ${state.sentiment.updatedAt ? timeAgo(state.sentiment.updatedAt) : 'טרם'} · ` +
        `כותרות: ${state.sentiment.headlines?.length || 0} · ` +
        `סרטוני YouTube: ${state.sentiment.youtubeVideos?.length || 0} · ` +
        `מאמרי arXiv: ${state.sentiment.arxivPapers?.length || 0}`,
      ),
      h('button', { class: 'btn btn-sm btn-ghost', style: { marginTop: '8px' }, onclick: () => ui.go('sentiment') }, 'לפיד החדשות והסנטימנט המלא →'),
    ),
  ));

  // YouTube Research & Market News Videos Card
  const ytVideos = state.sentiment.youtubeVideos || [];
  mount(root, h('div', { class: 'card', style: { marginTop: '14px', borderColor: 'rgba(239, 68, 68, 0.35)' } },
    h('div', { class: 'card-head' },
      h('div', {},
        h('h2', { text: '📺 YouTube · מחקר, מאקרו וחדשות שוק בזמן אמת' }),
        h('div', { class: 'card-sub', text: 'CNBC · Bloomberg · Yahoo Finance · Coin Bureau · Benjamin Cowen · Patrick Boyle (פיד Atom רשמי חינמי)' }),
      ),
      h('div', { class: 'row', style: { gap: '6px' } },
        tag(ytVideos.length ? `${ytVideos.length} סרטונים` : 'טרם נסרק', ytVideos.length ? 'live' : 'opt'),
        h('button', { class: 'btn btn-sm', onclick: () => act(() => scanYouTube(), 'ערוצי YouTube עודכנו') }, '⟳ רענן YouTube'),
      ),
    ),
    ytVideos.length
      ? h('div', { class: 'grid cols-3', style: { gap: '10px' } },
        ytVideos.slice(0, 9).map((v) => h('a', {
          href: v.url,
          target: '_blank',
          rel: 'noopener noreferrer',
          class: 'card',
          style: { padding: '8px', textDecoration: 'none', display: 'flex', flexDirection: 'column', gap: '6px', background: 'rgba(10, 16, 28, 0.9)' },
        },
          v.thumbnail
            ? h('img', { src: v.thumbnail, alt: v.title, loading: 'lazy', style: { width: '100%', height: '112px', objectFit: 'cover', borderRadius: '6px' } })
            : null,
          h('div', { class: 'row between', style: { gap: '4px' } },
            tag(v.channel, 'opt'),
            h('span', { class: 'tiny muted', text: v.at ? timeAgo(v.at) : '' }),
          ),
          h('div', { class: 'small', style: { color: '#f1f5f9', fontWeight: '600', lineHeight: '1.35' }, text: v.title }),
          h('div', { class: 'tiny muted', text: v.category }),
        )),
      )
      : empty('לחץ על "📺 YouTube" או "⟳ סרוק את כל המקורות" למשיכת סרטוני חדשות ומחקר חיים.'),
  ));

  // arXiv Quant Papers Card
  const arxivPapers = state.sentiment.arxivPapers || [];
  mount(root, h('div', { class: 'card', style: { marginTop: '14px', borderColor: 'rgba(167, 139, 250, 0.35)' } },
    h('div', { class: 'card-head' },
      h('div', {},
        h('h2', { text: '📚 arXiv Quantitative Finance (q-fin) — מחקר אקדמי עדכני' }),
        h('div', { class: 'card-sub', text: 'מאמרים חדשים באלגוטריידינג, ניהול סיכונים ומימון כמותי המוזנים ישירות לרשימת הרעיונות של הצוות' }),
      ),
      h('button', { class: 'btn btn-sm', onclick: () => act(() => scanArxivQuant(), 'מאמרי arXiv q-fin עודכנו') }, '⟳ רענן arXiv'),
    ),
    arxivPapers.length
      ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { text: 'כותרת המחקר' }), h('th', { text: 'אסטרטגיה קשורה' }))),
        h('tbody', {}, arxivPapers.slice(0, 8).map((p) => h('tr', {},
          h('td', {},
            h('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer', style: { color: '#c4b5fd', fontWeight: '600' }, text: p.title }),
            h('div', { class: 'tiny muted', text: (p.summary || '').slice(0, 140) }),
          ),
          h('td', { class: 'tiny' }, p.strategy ? tag(strategyName(p.strategy), 'live') : tag('Quant Research', 'opt')),
        ))),
      ))
      : empty('לחץ על "📚 arXiv q-fin" למשיכת מאמרי מחקר קוונט חדשים.'),
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
      : empty('עוד לא נאספו רעיונות — התחל בסריקת GitHub, Reddit או arXiv'),
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
    section('מקורות מוגדרים', 'כל מקורות המידע הפעילים במערכת',
      h('ul', { class: 'list-clean' },
        Object.entries(RESEARCH_SOURCES).map(([k, src]) => h('li', {},
          h('span', { class: 'bul', text: '•' }),
          h('div', { class: 'grow' },
            h('div', { style: { fontWeight: 600 }, text: src.label }),
            h('div', { class: 'tiny muted', text: src.note }),
          ),
        )),
      ),
    ),
  ));
}
