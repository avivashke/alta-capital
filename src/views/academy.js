// Educational Strategy Chat & Academy View (#/academy + embedded widget).

import { store } from '../store.js';
import { h, mount, pct, num, tag, timeAgo, notice } from '../ui.js';
import { describeParams } from '../strategies.js';
import {
  STRATEGY_GUIDES,
  EDUCATIONAL_PROMPTS,
  getTopDesks,
  buildLocalEducationalReply,
  askEducationalTutor,
} from '../academy.js';

let chatBusy = false;

function ensureAcademyMessages() {
  if (!store.state.academy) {
    store.state.academy = {
      messages: [
        {
          role: 'ai',
          at: Date.now(),
          content: buildLocalEducationalReply('נתח לי את האסטרטגיה הכי מוצלחת כרגע', store.state),
        },
      ],
    };
  }
  if (!Array.isArray(store.state.academy.messages) || !store.state.academy.messages.length) {
    store.state.academy.messages = [
      {
        role: 'ai',
        at: Date.now(),
        content: buildLocalEducationalReply('נתח לי את האסטרטגיה הכי מוצלחת כרגע', store.state),
      },
    ];
  }
  return store.state.academy.messages;
}

function formatMessage(text) {
  const wrap = h('div', { class: 'edu-msg-body' });
  const lines = String(text || '').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      wrap.appendChild(h('div', { style: { height: '6px' } }));
      continue;
    }
    if (/^[🎓🏆📐🔬📈🔄🛡📊🥈💡]/.test(line)) {
      wrap.appendChild(h('div', { style: { fontWeight: '800', color: '#f8fafc', marginTop: '6px', marginBottom: '2px' }, text: line }));
    } else if (/^[-•]\s+/.test(line)) {
      wrap.appendChild(h('div', { style: { paddingRight: '10px', color: '#d7e3f4', margin: '2px 0' }, text: '• ' + line.replace(/^[-•]\s+/, '') }));
    } else {
      wrap.appendChild(h('div', { style: { margin: '2px 0' }, text: line }));
    }
  }
  return wrap;
}

export function renderEducationalChatWidget(ui, { compact = false } = {}) {
  const messages = ensureAcademyMessages();
  const topDesks = getTopDesks(store.state);

  const input = h('textarea', {
    rows: 2,
    placeholder: 'שאל על כל אסטרטגיה: איך עובד גאן ריבוע התשע? למה האסטרטגיה המובילה מרוויחה? מה זה Walk-Forward?',
  });

  const sendQuestion = async (customText) => {
    const text = (customText != null ? customText : input.value).trim();
    if (!text || chatBusy) return;
    chatBusy = true;
    input.value = '';
    messages.push({ role: 'user', content: text, at: Date.now() });
    const pendingMsg = { role: 'ai', content: '🎓 מכין שיעור מפורט וניתוח מתוך נתוני השולחנות...', at: Date.now(), pending: true };
    messages.push(pendingMsg);
    if (messages.length > 40) messages.splice(0, messages.length - 40);
    ui.rerender();

    try {
      const history = messages.filter((m) => m !== pendingMsg && !m.pending);
      const reply = await askEducationalTutor(text, history);
      pendingMsg.content = reply;
    } catch (err) {
      pendingMsg.content = buildLocalEducationalReply(text, store.state);
    } finally {
      pendingMsg.pending = false;
      chatBusy = false;
      store.save();
      ui.rerender();
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendQuestion();
    }
  });

  const topShowcase = h('div', { class: 'grid cols-3', style: { marginBottom: '12px', gap: '10px' } },
    ...topDesks.slice(0, 3).map((d, idx) => {
      const guide = STRATEGY_GUIDES[d.strategyId] || { title: d.strategyId || 'בכיול', category: 'אסטרטגיה כמותית' };
      const oos = d.oosMetrics?.returnPct ?? d.bestReturn;
      return h('div', {
        class: 'card',
        style: {
          padding: '11px 13px',
          borderColor: idx === 0 ? 'rgba(46, 204, 113, 0.45)' : 'rgba(88, 166, 255, 0.24)',
          background: idx === 0 ? 'linear-gradient(180deg, rgba(16, 38, 28, 0.75), rgba(10, 16, 24, 0.9))' : 'rgba(12, 18, 28, 0.85)',
        },
      },
        h('div', { class: 'row between', style: { marginBottom: '4px' } },
          h('span', { class: 'tiny', style: { fontWeight: '800', color: idx === 0 ? '#4ade80' : '#7dd3fc' }, text: idx === 0 ? '🥇 מקום #1 בביצועים' : `#${idx + 1} בדירוג` }),
          tag(d.version || d.tf, idx === 0 ? 'live' : 'dry'),
        ),
        h('div', { style: { fontWeight: '800', fontSize: '14px', color: '#f8fafc' }, text: guide.title }),
        h('div', { class: 'tiny muted', text: `${d.label} · ${d.symbol} · ${guide.category}` }),
        h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '6px', fontSize: '12px' } },
          h('span', { class: 'mono ' + ((oos ?? 0) >= 0 ? 'green' : 'red'), text: `OOS: ${oos != null ? pct(oos) : '—'}` }),
          h('span', { class: 'mono muted', text: `PF: ${d.metrics?.profitFactor ?? '—'}` }),
          h('span', { class: 'mono muted', text: `חוסן: ${d.assessment?.robustness ?? '—'}/100` }),
        ),
        h('button', {
          class: 'btn btn-sm btn-ghost',
          style: { marginTop: '8px', width: '100%' },
          onclick: () => sendQuestion(`למד אותי לעומק על האסטרטגיה ${guide.title} (${d.strategyId}) בשולחן ${d.label}`),
        }, '🎓 למד איך האסטרטגיה הזו עובדת'),
      );
    }),
  );

  const chatList = h('div', {
    class: 'chat edu-chat-scroll',
    style: { maxHeight: compact ? '340px' : '460px', overflowY: 'auto', padding: '6px 4px' },
  },
    ...messages.map((m) => h('div', { class: 'msg ' + (m.role === 'ai' ? 'ai' : 'me') },
      h('div', { style: { maxWidth: '92%' } },
        h('div', { class: 'bubble' }, formatMessage(m.content)),
        h('div', { class: 'meta', text: `${m.role === 'ai' ? '🎓 מנטור האסטרטגיות' : 'אתה'} · ${m.pending ? 'מנתח...' : timeAgo(m.at)}` }),
      ),
    )),
  );

  setTimeout(() => { chatList.scrollTop = chatList.scrollHeight; }, 20);

  return h('div', { class: 'card edu-academy-card', style: { marginTop: '14px', borderColor: 'rgba(88, 166, 255, 0.35)' } },
    h('div', { class: 'card-head' },
      h('div', {},
        h('h2', { text: '🎓 צ׳אט חינוכי — לימוד האסטרטגיות המוצלחות בחדר המסחר' }),
        h('div', { class: 'card-sub', text: 'לחץ על אחת האסטרטגיות המובילות או שאל כל שאלה כדי ללמוד איך האלגוריתמים, שיטות גאן וניהול הסיכונים עובדים' }),
      ),
      h('div', { class: 'row', style: { gap: '6px' } },
        tag('10 משפחות אסטרטגיה', 'live'),
        h('button', {
          class: 'btn btn-sm btn-ghost',
          onclick: () => {
            store.state.academy = {
              messages: [{ role: 'ai', at: Date.now(), content: buildLocalEducationalReply('נתח לי את האסטרטגיה הכי מוצלחת כרגע', store.state) }],
            };
            store.save();
            ui.rerender();
          },
        }, 'איפוס שיעור'),
      ),
    ),
    topShowcase,
    h('div', { class: 'row wrap', style: { gap: '6px', marginBottom: '10px' } },
      ...EDUCATIONAL_PROMPTS.map((promptText) => h('button', {
        class: 'btn btn-sm btn-ghost',
        style: { fontSize: '12px' },
        onclick: () => sendQuestion(promptText),
      }, promptText)),
    ),
    chatList,
    h('div', { class: 'chat-input', style: { marginTop: '10px' } },
      input,
      h('button', { class: 'btn btn-primary', onclick: () => sendQuestion() }, 'שאל את המנטור'),
    ),
  );
}

export function renderAcademy(root, ui) {
  mount(root,
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: 'Strategy Academy · לימוד מסחר כמותי וגאן' }),
        h('h1', { text: 'האקדמיה והצ׳אט החינוכי לאסטרטגיות' }),
        h('p', { text: 'למד איך פועלות האסטרטגיות המנצחות של הסוכנים, מה המשמעות של כל פרמטר, איך עובדים ריבוע התשע ומחזורי הזמן של גאן, ואיך בודקים חוסן ב-Walk-Forward.' }),
      ),
    ),
    renderEducationalChatWidget(ui, { compact: false }),
    h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'card-head' },
        h('div', {},
          h('h2', { text: 'ספריית 10 משפחות האסטרטגיה של החברה' }),
          h('div', { class: 'card-sub', text: 'לחץ על כל אסטרטגיה כדי לפתוח עליה שיעור מלא בצ׳אט החינוכי למעלה' }),
        ),
      ),
      h('div', { class: 'grid cols-2', style: { gap: '12px' } },
        ...Object.values(STRATEGY_GUIDES).map((g) => {
          const activeDesk = (store.state.desks || []).find((d) => d.strategyId === g.id);
          return h('div', { class: 'card', style: { background: 'rgba(10, 16, 25, 0.8)' } },
            h('div', { class: 'row between', style: { marginBottom: '6px' } },
              h('strong', { style: { fontSize: '15px', color: '#f8fafc' }, text: g.title }),
              tag(g.category, activeDesk ? 'live' : 'dry'),
            ),
            h('div', { class: 'small', style: { color: '#cbd5e1', marginBottom: '6px' }, text: g.howItWorks }),
            h('div', { class: 'tiny muted', style: { marginBottom: '4px' }, text: '⚙️ ' + g.mathAndParams }),
            h('div', { class: 'tiny muted', text: '🎯 מתאים ל: ' + g.bestFor }),
            activeDesk ? h('div', { class: 'tiny green mono', style: { marginTop: '6px' }, text: `פעיל בשולחן ${activeDesk.label} · פרמטרים: ${describeParams(g.id, activeDesk.params)}` }) : null,
          );
        }),
      ),
    ),
    notice('הצ׳אט החינוכי מנתח את מדדי האמת של השולחנות במערכת ומשלב אותם עם הסברים מתמטיים וכללי ניהול סיכונים.', 'blue'),
  );
}
