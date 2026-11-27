import { mount } from '../ui.js';
import { store } from '../store.js';
import { askAdvisor, localAdvice, openingMessage, quickPrompts } from '../advisor.js';
import { lastAutoFor, autoActionsEnabled } from '../autopilot_actions.js';
import { hasModelKey } from '../llm.js';
import { h, section, notice, toast, timeAgo, tag, empty } from '../ui.js';
import { captureActiveViewImage, openFreeAiConnectModal } from '../page_context.js';

let sending = false;
let attachVision = true;

export function renderAdvisor(root, ui) {
  const state = store.state;
  if (!state.advisor.messages.length) state.advisor.messages.push(openingMessage());
  const messages = state.advisor.messages;
  const advice = localAdvice(state);

  const input = h('textarea', {
    rows: 2,
    placeholder: 'שאל את היועץ עם קונטקסט חי של המערכת (פונה בעדיפות ראשונה ל-Gemini, Groq, Claude ו-OpenRouter)…',
  });

  const visionToggle = h('input', {
    type: 'checkbox',
    checked: attachVision,
    onchange: (e) => { attachVision = e.target.checked; },
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
    const thinking = { role: 'ai', content: '⏳ פונה בעדיפות עליונה ל-Gemini/Groq/Claude עם קונטקסט חי…', at: Date.now(), pending: true };
    state.advisor.messages.push(thinking);
    store.emit();
    try {
      const history = messages.filter((m) => m !== thinking && !m.pending);
      const img = attachVision ? captureActiveViewImage() : null;
      const res = await askAdvisor(text, history, { route: ui.route || 'advisor', image: img });
      thinking.content = res.text || 'לא התקבלה תשובה מהמודל.';
      thinking.label = res.label || res.model || 'AI';
    } catch (err) {
      console.error('[advisor]', err);
      thinking.content = `⚠️ שגיאה בפנייה למודלים: ${err.message}\n\nהיועץ פועל כעת במצב כללים מקומי מתוך נתוני התיק.`;
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
        h('div', { class: 'eyebrow', text: 'AI Advisor · Free Tier Web Priority' },
          tag('עדיפות: Gemini / Groq / Claude / OpenRouter', 'live'),
        ),
        h('h1', { text: 'היועץ החכם (AI)' }),
        h('p', { text: 'היועץ מקבל קונטקסט עשיר של המסך, הגרפים והתיק. שאילתות נשלחות בעדיפות עליונה למודלים בעלי טוקנים חינמיים ברשת (Google Gemini, Groq LPU, OpenRouter, Claude) ומחזירות תשובות ישירות לצ׳אט.' }),
      ),
      h('div', { class: 'head-actions', style: { gap: '6px', flexWrap: 'wrap' } },
        h('button', {
          class: 'btn btn-sm btn-primary',
          style: { background: 'linear-gradient(90deg, #38bdf8, #2563eb)' },
          onclick: () => openFreeAiConnectModal(ui),
        }, '⚡ חבר חשבונות AI (Gemini, Groq, Claude, OpenRouter)'),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { store.mutate((st) => { st.advisor.messages = [openingMessage()]; }); } }, 'נקה שיחה'),
        h('button', { class: 'btn btn-sm', onclick: () => ui.go('settings') }, 'הגדרות מתקדמות'),
      ),
    ),
  );

  const chatBox = h('div', { class: 'card' },
    h('div', { class: 'chat', id: 'chat' },
      messages.map((m) => h('div', { class: 'msg ' + (m.role === 'ai' ? 'ai' : 'me') },
        h('div', {},
          h('div', { class: 'bubble' }, renderContent(m.content)),
          h('div', { class: 'meta', style: { display: 'flex', gap: '6px', alignItems: 'center' } },
            h('span', { text: `${m.role === 'ai' ? 'היועץ' : 'אתה'} · ${m.pending ? '...' : timeAgo(m.at)}` }),
            m.label ? tag(m.label, 'live') : null,
          ),
        ),
      )),
    ),
    h('div', { class: 'chat-input' },
      input,
      h('button', { class: 'btn btn-primary', onclick: send }, 'שלח'),
    ),
    h('div', { class: 'row between wrap', style: { gap: '8px', marginTop: '8px', alignItems: 'center', padding: '4px 6px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px' } },
      h('label', { class: 'row', style: { gap: '6px', alignItems: 'center', fontSize: '12px', cursor: 'pointer' } },
        visionToggle,
        h('span', { text: '📸 צרף צילום גרף/מסך חי (Multimodal Vision ל-Gemini / Grok / Claude)' }),
      ),
      h('button', {
        class: 'btn btn-sm btn-ghost',
        style: { fontSize: '11px', color: '#38bdf8' },
        onclick: () => openFreeAiConnectModal(ui),
      }, '🔑 הוסף/ערוך מפתחות חשבון אישי'),
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
          autoActionsEnabled() ? h('div', { class: 'tiny', style: { marginTop: '6px', color: '#34d399' }, text: lastAutoFor(a.id) ? ('✅ בוצע אוטומטית · ' + lastAutoFor(a.id).result) : '🤖 מטופל אוטומטית על ידי האוטופיילוט' }) : null,
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
