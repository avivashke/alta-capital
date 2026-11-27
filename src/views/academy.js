// Educational Strategy Chat & Academy View (#/academy + embedded widget).

import { store } from '../store.js';
import { h, mount, pct, num, tag, timeAgo, notice, openModal } from '../ui.js';
import { describeParams } from '../strategies.js';
import { openFreeAiConnectModal } from '../page_context.js';
import {
  STRATEGY_GUIDES,
  EDUCATIONAL_PROMPTS,
  getTopDesks,
  buildLocalEducationalReply,
  askEducationalTutor,
  buildBeginnerStrategyGuide,
  askAiBeginnerExplanation,
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
    if (/^[🎓🏆📐🔬📈🔄🛡📊🥈💡🌟🧭🪜📖⚖]/.test(line)) {
      wrap.appendChild(h('div', { style: { fontWeight: '800', color: '#f8fafc', marginTop: '6px', marginBottom: '2px' }, text: line }));
    } else if (/^[-•]\s+/.test(line)) {
      wrap.appendChild(h('div', { style: { paddingRight: '10px', color: '#d7e3f4', margin: '2px 0' }, text: '• ' + line.replace(/^[-•]\s+/, '') }));
    } else {
      wrap.appendChild(h('div', { style: { margin: '2px 0' }, text: line }));
    }
  }
  return wrap;
}

/**
 * Interactive Beginner Modal for any strategy:
 * - Instant plain-Hebrew explanation, real-life analogy, and step-by-step example
 * - Clickable glossary terms with instant plain-Hebrew definitions
 * - Live AI expanded explanation + follow-up beginner Q&A right inside the modal
 */
export function openBeginnerStrategyModal(strategyId) {
  const g = buildBeginnerStrategyGuide(strategyId, store.state);

  const termBox = h('div', {
    class: 'card',
    style: { background: 'rgba(15, 25, 42, 0.88)', padding: '10px 12px', marginTop: '8px', borderColor: 'rgba(56, 189, 248, 0.35)' },
  });

  const aiOut = h('div', {
    class: 'card',
    style: { background: 'rgba(10, 18, 30, 0.92)', padding: '12px 14px', borderColor: 'rgba(167, 139, 250, 0.4)', marginTop: '10px' },
  });

  const aiBadge = h('span', { class: 'tag opt', text: '⏳ מכין הסבר AI למתחילים…' });
  const aiContentWrap = h('div', { style: { marginTop: '8px', lineHeight: '1.65', fontSize: '13px', color: '#e2e8f0' } },
    h('div', { class: 'small muted', text: 'מייצר הסבר מפורט ומותאם למתחילים על האסטרטגיה ועל כל המושגים שלה…' }),
  );
  aiOut.appendChild(
    h('div', { class: 'row between wrap', style: { gap: '8px' } },
      h('strong', { style: { color: '#c4b5fd', fontSize: '14px' }, text: '✨ הסבר מורחב מ-AI למתחילים (כולל מושגים)' }),
      aiBadge,
    ),
  );
  aiOut.appendChild(aiContentWrap);

  const runAiExplain = async (customQ = '') => {
    aiBadge.className = 'tag opt';
    aiBadge.textContent = '⏳ ה-AI מנסח הסבר פשוט…';
    aiContentWrap.replaceChildren(h('div', { class: 'small muted', text: customQ ? `עונה בפשטות על: "${customQ}"…` : 'מכין הסבר מקיף למתחילים…' }));
    try {
      const res = await askAiBeginnerExplanation(strategyId, customQ, store.state);
      aiBadge.className = res.aiPowered ? 'tag live' : 'tag dry';
      aiBadge.textContent = res.aiPowered ? `🤖 הוסבר ע״י AI (${res.model})` : '📘 מדריך מובנה (ללא מפתח AI פעיל)';
      aiContentWrap.replaceChildren(formatMessage(res.text));
    } catch {
      aiBadge.className = 'tag dry';
      aiBadge.textContent = '📘 מדריך מובנה';
      aiContentWrap.replaceChildren(formatMessage(g.simpleSummary));
    }
  };

  const showTerm = (item) => {
    termBox.replaceChildren(
      h('div', { class: 'row between wrap', style: { gap: '8px', marginBottom: '4px' } },
        h('strong', { style: { color: '#7dd3fc', fontSize: '13.5px' }, text: `📖 ${item.term}` }),
        h('button', {
          class: 'btn btn-sm btn-ghost',
          onclick: () => runAiExplain(`הסבר לי בפשטות עם דוגמה יומיומית מה זה המושג "${item.term}" ואיך הוא עובד באסטרטגיה הזו`),
        }, '✨ בקש מ-AI דוגמה נוספת למושג'),
      ),
      h('div', { class: 'small', style: { color: '#e2e8f0', lineHeight: '1.55' }, text: item.simple }),
    );
  };
  if (g.glossary.length) showTerm(g.glossary[0]);

  const followUpInput = h('input', {
    class: 'input',
    type: 'text',
    placeholder: 'משהו עדיין לא ברור? שאל שאלה של מתחילים (למשל: "מה זה Stop-Loss בדוגמה של 1,000$?")',
    style: { flex: '1', minWidth: '220px' },
  });
  const askFollowUp = () => {
    const q = followUpInput.value.trim();
    if (!q) return;
    followUpInput.value = '';
    runAiExplain(q);
  };
  followUpInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); askFollowUp(); }
  });

  const body = h('div', { style: { display: 'grid', gap: '10px', maxHeight: '78vh', overflowY: 'auto', paddingLeft: '4px' } },
    h('div', { class: 'row wrap', style: { gap: '6px' } },
      tag(g.category, 'live'),
      tag(`מתאים ל: ${g.bestFor}`, 'dry'),
    ),

    // 1. Plain-Hebrew Summary & Analogy
    h('div', { class: 'grid cols-2', style: { gap: '10px' } },
      h('div', { class: 'card', style: { background: 'rgba(16, 38, 28, 0.55)', borderColor: 'rgba(46, 204, 113, 0.35)' } },
        h('div', { style: { fontWeight: '800', color: '#4ade80', marginBottom: '4px' }, text: '💡 במילים פשוטות (בלי מונחים מסובכים)' }),
        h('div', { class: 'small', style: { color: '#e2e8f0', lineHeight: '1.6' }, text: g.simpleSummary }),
      ),
      h('div', { class: 'card', style: { background: 'rgba(20, 32, 54, 0.65)', borderColor: 'rgba(88, 166, 255, 0.35)' } },
        h('div', { style: { fontWeight: '800', color: '#7dd3fc', marginBottom: '4px' }, text: '🧭 דימוי מהחיים היומיומיים' }),
        h('div', { class: 'small', style: { color: '#e2e8f0', lineHeight: '1.6' }, text: g.analogy }),
      ),
    ),

    // 2. Concrete Step-by-Step Walkthrough
    h('div', { class: 'card', style: { background: 'rgba(10, 16, 26, 0.85)' } },
      h('div', { style: { fontWeight: '800', color: '#f8fafc', marginBottom: '4px' }, text: '🪜 איך עסקה עובדת בפועל צעד אחר צעד?' }),
      h('div', { class: 'small', style: { color: '#cbd5e1', lineHeight: '1.65' }, text: g.stepByStep }),
      h('div', { class: 'tiny muted', style: { marginTop: '6px' }, text: `⚖️ יתרונות ומתי להיזהר: ${g.prosAndCons}` }),
    ),

    // 3. Interactive Beginner Glossary for This Strategy
    g.glossary.length
      ? h('div', { class: 'card', style: { background: 'rgba(10, 16, 26, 0.85)' } },
        h('div', { style: { fontWeight: '800', color: '#f8fafc', marginBottom: '6px' }, text: '📖 מילון מושגים למתחילים (לחץ על מושג להסבר פשוט)' }),
        h('div', { class: 'row wrap', style: { gap: '6px' } },
          ...g.glossary.map((item) => h('button', {
            class: 'btn btn-sm btn-ghost',
            onclick: () => showTerm(item),
          }, item.term)),
        ),
        termBox,
      )
      : null,

    // 4. Live AI Expanded Explanation + Follow-up Q&A
    aiOut,
    h('div', { class: 'row wrap', style: { gap: '8px', alignItems: 'center' } },
      followUpInput,
      h('button', { class: 'btn btn-sm btn-primary', onclick: askFollowUp }, '🤖 שאל את ה-AI'),
      h('button', { class: 'btn btn-sm', onclick: () => runAiExplain('') }, '🔄 צור הסבר AI מחדש'),
    ),

    // 5. Real Live System Performance (strictly grounded)
    g.liveDesks.length
      ? h('div', { class: 'notice blue', style: { fontSize: '12px' } },
        `📊 ביצועי אמת כרגע במערכת: ` + g.liveDesks.map((d) =>
          `${d.label} (${d.symbol} ${d.tf}) · OOS ${d.oosReturnPct != null ? pct(d.oosReturnPct) : '—'} · PF ${d.profitFactor ?? '—'} · חוסן ${d.robustness ?? '—'}/100`
        ).join(' | '),
      )
      : null,
  );

  openModal(`🎓 מדריך מורחב למתחילים (AI) · ${g.title}`, body, { wide: true });
  // Trigger live AI explanation immediately in the background
  runAiExplain('');
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
      if (typeof reply === 'object' && reply.text) {
        pendingMsg.content = reply.text;
        pendingMsg.provider = reply.provider;
      } else {
        pendingMsg.content = String(reply);
      }
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
        h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '8px' } },
          d.strategyId
            ? h('button', {
                class: 'btn btn-sm btn-primary',
                style: { flex: '1' },
                onclick: () => openBeginnerStrategyModal(d.strategyId),
              }, '✨ הסבר מורחב למתחילים (AI)')
            : null,
          h('button', {
            class: 'btn btn-sm btn-ghost',
            onclick: () => sendQuestion(`למד אותי לעומק על האסטרטגיה ${guide.title} (${d.strategyId}) בשולחן ${d.label}`),
          }, '🎓 לצ׳אט'),
        ),
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
        h('div', { class: 'meta', style: { display: 'flex', gap: '6px', alignItems: 'center' } }, [
          h('span', { text: `${m.role === 'ai' ? '🎓 מנטור האסטרטגיות' : 'אתה'} · ${m.pending ? 'מנתח...' : timeAgo(m.at)}` }),
          m.provider ? tag(m.provider === 'מדריך מקומי' ? 'מדריך מקומי' : `סופק ע"י ${m.provider}`, m.provider === 'מדריך מקומי' ? 'dry' : 'live') : null,
        ]),
      ),
    )),
  );

  setTimeout(() => { chatList.scrollTop = chatList.scrollHeight; }, 20);

  return h('div', { class: 'card edu-academy-card', style: { marginTop: '14px', borderColor: 'rgba(88, 166, 255, 0.35)' } },
    h('div', { class: 'card-head' },
      h('div', {},
        h('h2', { text: '🎓 צ׳אט חינוכי — לימוד האסטרטגיות המוצלחות בחדר המסחר' }),
        h('div', { class: 'card-sub', text: 'לחץ על "הסבר מורחב למתחילים (AI)" בכל אסטרטגיה כדי לקבל הסבר פשוט עם מושגים ודוגמאות, או שאל כל שאלה בצ׳אט' }),
      ),
      h('div', { class: 'row wrap', style: { gap: '6px', alignItems: 'center' } },
        h('button', {
          class: 'btn btn-sm btn-ghost',
          style: { fontSize: '11.5px', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.35)' },
          onclick: () => openFreeAiConnectModal(ui),
        }, '⚡ חבר חשבונות AI (Gemini, Groq, Claude)'),
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
        h('div', { class: 'eyebrow', text: 'Strategy Academy · לימוד מסחר כמותי, מושגים למתחילים וגאן' }),
        h('h1', { text: 'האקדמיה והצ׳אט החינוכי לאסטרטגיות' }),
        h('p', { text: 'למד בצורה פשוטה ומובנת איך פועלות האסטרטגיות המנצחות של הסוכנים. לכל אסטרטגיה יש כפתור להסבר מורחב למתחילים המשלב AI ומילון מושגים אינטראקטיבי.' }),
      ),
    ),
    renderEducationalChatWidget(ui, { compact: false }),
    h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'card-head' },
        h('div', {},
          h('h2', { text: 'ספריית 10 משפחות האסטרטגיה של החברה' }),
          h('div', { class: 'card-sub', text: 'לחץ על "✨ הסבר מורחב למתחילים (AI + מושגים)" בכל כרטיס לקבלת מדריך פשוט, דוגמה צעד-אחר-צעד ושיחה אישית עם AI' }),
        ),
      ),
      h('div', { class: 'grid cols-2', style: { gap: '12px' } },
        ...Object.values(STRATEGY_GUIDES).map((g) => {
          const activeDesk = (store.state.desks || []).find((d) => d.strategyId === g.id);
          return h('div', { class: 'card', style: { background: 'rgba(10, 16, 25, 0.8)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '8px' } },
            h('div', {},
              h('div', { class: 'row between', style: { marginBottom: '6px', gap: '8px' } },
                h('strong', { style: { fontSize: '15px', color: '#f8fafc' }, text: g.title }),
                tag(g.category, activeDesk ? 'live' : 'dry'),
              ),
              h('div', { class: 'small', style: { color: '#cbd5e1', marginBottom: '6px' }, text: g.howItWorks }),
              h('div', { class: 'tiny muted', style: { marginBottom: '4px' }, text: '⚙️ ' + g.mathAndParams }),
              h('div', { class: 'tiny muted', text: '🎯 מתאים ל: ' + g.bestFor }),
              activeDesk ? h('div', { class: 'tiny green mono', style: { marginTop: '6px' }, text: `פעיל בשולחן ${activeDesk.label} · פרמטרים: ${describeParams(g.id, activeDesk.params)}` }) : null,
            ),
            h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '6px' } },
              h('button', {
                class: 'btn btn-sm btn-primary',
                style: { flex: '1' },
                onclick: () => openBeginnerStrategyModal(g.id),
              }, '✨ הסבר מורחב למתחילים (AI + מושגים)'),
            ),
          );
        }),
      ),
    ),
    notice('הצ׳אט החינוכי והמדריך למתחילים מנתחים את מדדי האמת של השולחנות במערכת ומשלבים AI להסבר ברור של כל מושג.', 'blue'),
  );
}
