import { mount } from '../ui.js';
import { store } from '../store.js';
import { askAdvisor, localAdvice, openingMessage, quickPrompts } from '../advisor.js';
import { hasModelKey } from '../llm.js';
import { h, section, notice, toast, timeAgo, tag, empty } from '../ui.js';

let sending = false;

export function renderAdvisor(root, ui) {
  const state = store.state;
  if (!state.advisor.messages.length) state.advisor.messages.push(openingMessage());
  const messages = state.advisor.messages;
  const advice = localAdvice(state);

  const input = h('textarea', {
    rows: 2,
    placeholder: hasModelKey() ? 'שאל את היועץ: מה הפעולה הבאה? איזה שולחן מסוכן?' : 'מצב כללים מקומי — חבר מפתח מודל לתשובות חופשיות',
  });

  const send = async () => {
    const text = input.value.trim();
    if (!text || sending) return;
    sending = true;
    input.value = '';
    store.mutate((st) => {
      st.advisor.messages.push({ role: 'user', content: text, at: Date.now() });
      if (st.advisor.messages.length > 60) st.advisor.messages.splice(0, st.advisor.messages.length - 60);
    });
    const thinking = { role: 'ai', content: '⏳ מנתח את מצב התיק...', at: Date.now(), pending: true };
    state.advisor.messages.push(thinking);
    store.emit();
    try {
      const history = messages.filter((m) => m !== thinking && !m.pending);
      const reply = await askAdvisor(text, history);
      thinking.content = reply || 'לא התקבלה תשובה מהמודל.';
    } catch (err) {
      console.error('[advisor]', err);
      thinking.content = `⚠️ לא הצלחתי לפנות למודל: ${err.message}\n\nאפשר להמשיך במצב כללים מקומי — ה"פעולות מומלצות" למטה מחושבות תמיד מהנתונים.`;
      thinking.error = true;
    }
    thinking.pending = false;
    sending = false;
    store.save();
    store.emit();
  };

  mount(root, 
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: 'AI advisor' }),
        h('h1', { text: 'היועץ החכם' }),
        h('p', { text: 'היועץ רואה את כל השולחנות, הגרסאות, מדדי הבקטסט והסנטימנט — ומנחה אותך מה לעשות עכשיו. בלי מפתח מודל הוא עובד במצב כללים.' }),
      ),
      h('div', { class: 'head-actions' },
        hasModelKey() ? tag('מודל מחובר', 'live') : tag('מצב כללים מקומי', 'dry'),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { store.mutate((st) => { st.advisor.messages = [openingMessage()]; }); } }, 'נקה שיחה'),
        h('button', { class: 'btn btn-sm', onclick: () => ui.go('settings') }, 'הגדרות מודל'),
      ),
    ),
  );

  const chatBox = h('div', { class: 'card' },
    h('div', { class: 'chat', id: 'chat' },
      messages.map((m) => h('div', { class: 'msg ' + (m.role === 'ai' ? 'ai' : 'me') },
        h('div', {},
          h('div', { class: 'bubble' }, renderContent(m.content)),
          h('div', { class: 'meta', text: `${m.role === 'ai' ? 'היועץ' : 'אתה'} · ${m.pending ? '...' : timeAgo(m.at)}` }),
        ),
      )),
    ),
    h('div', { class: 'chat-input' },
      input,
      h('button', { class: 'btn btn-primary', onclick: send }, 'שלח'),
    ),
    h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '10px' } },
      quickPrompts().map((q) => h('button', {
        class: 'btn btn-sm btn-ghost',
        onclick: () => { input.value = q; send(); },
      }, q)),
    ),
  );

  mount(root, chatBox);
  mount(root, notice(hasModelKey()
    ? 'המפתח נשמר בדפדפן בלבד ונשלח ישירות לספק המודל. אם האתר פרוס בפומבי, כל משתמש מביא את המפתח שלו.'
    : 'אין מפתח מודל. היועץ עונה מכללים מקומיים מתוך הנתונים — לא מהשוק. הוסף מפתח ב"הגדרות ומפתחות" כדי לקבל ניתוח חופשי.', 'blue'));

  mount(root, h('div', { style: { marginTop: '14px' } },
    section('פעולות מומלצות עכשיו', 'מחושב מהמצב בפועל, לא מהמודל',
      h('div', { class: 'grid cols-2' }, advice.map((a, i) => h('div', { class: 'agent' },
        h('div', { class: 'av', text: String(i + 1) }),
        h('div', { class: 'grow' },
          h('div', { class: 'who' }, h('b', { text: a.title })),
          h('div', { class: 'small muted', text: a.detail }),
          a.action ? h('button', { class: 'btn-link', style: { marginTop: '6px' }, onclick: () => ui.go(a.action.route) }, a.action.label) : null,
        ),
      ))),
    ),
  ));

  const chatEl = root.querySelector('#chat');
  if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
}

function renderContent(text) {
  const container = h('div', {});
  const lines = String(text || '').split('\n');
  let list = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^[-•*]\s+/.test(line)) {
      if (!list) { list = document.createElement('ul'); container.appendChild(list); }
      const li = document.createElement('li');
      li.textContent = line.replace(/^[-•*]\s+/, '');
      list.appendChild(li);
      continue;
    }
    list = null;
    if (/^\d+[.)]\s+/.test(line)) {
      const div = document.createElement('div');
      div.style.margin = '3px 0';
      div.textContent = line;
      container.appendChild(div);
      continue;
    }
    if (!line) { container.appendChild(document.createElement('br')); continue; }
    const p = document.createElement('div');
    p.textContent = line;
    container.appendChild(p);
  }
  return container;
}
