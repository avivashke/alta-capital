// Floating Static Page-Context AI Assistant Widget
// Provides a compact toggle button on every page that opens an AI chat explaining
// what the user is currently seeing and allowing live consultation on the current view's data.

import { NAV } from './config.js';
import { store } from './store.js';
import { chatDetailed } from './llm.js';

const chatState = {
  open: false,
  busy: false,
  lastRoute: null,
  messages: [], // { role: 'assistant' | 'user', content: string }
};

function getPageContextSummary(route) {
  const navItem = NAV.find((n) => n.id === route) || { label: route || 'סקירה' };
  const s = store.state;
  const parts = [`המשתמש נמצא כעת בעמוד: "${navItem.label}" (#/${route}).`];

  if (route === 'nostro') {
    const bots = s.nostro?.bots || [];
    const ready = bots.filter((b) => (b.readyFirms || []).length > 0);
    parts.push(`מבחני נוסטרו: נבדקו ${bots.length} בוטים. ${ready.length} בוטים מוכנים למעבר חברות נוסטרו.`);
    bots.forEach((b) => {
      parts.push(`- ${b.name} (${b.symbol} ${b.tf}): תשואה ${b.totalReturnPct}%, MaxDD ${b.maxTotalDdPct}%, יומי ${b.maxDailyLossPct}%, מוכן ל: ${(b.readyFirms || []).join(', ') || 'טרם עבר'}.`);
    });
  } else if (route === 'gann') {
    const viewText = document.getElementById('view')?.innerText?.slice(0, 1200) || '';
    parts.push('עמוד מעבדת גאן המורחבת (Gannzilla, מייקל ג׳נקינס, Square of 9, הקסגון 60° והוכחה מול אירועים פונדמנטליסטיים).');
    if (viewText) parts.push(`תוכן נוכחי על המסך:\n${viewText}`);
  } else {
    const viewText = document.getElementById('view')?.innerText?.slice(0, 1000) || '';
    parts.push(`מחזורי חברה: ${s.cycles || 0}, הון תיק דמה: $${Math.round(s.paper?.cash || 0)}.`);
    if (viewText) parts.push(`תקציר הנתונים הגלויים בעמוד:\n${viewText}`);
  }

  return { label: navItem.label, summary: parts.join('\n') };
}

function defaultPageIntro(route) {
  const { label } = getPageContextSummary(route);
  const guides = {
    nostro: 'אתה נמצא בעמוד **מבחני נוסטרו (Prop Firm Bot Fleet)**. כאן המערכת מריצה אוטומטית 5 בוטים על נתוני אמת מול חוקי FTMO, The5ers, FundedNext, Topstep ו-Apex. אפשר לפתוח אינפוגרפיקה, לבדוק אילו חברות כל בוט עובר, ולייצא דוח הוכחות לאקסל.',
    gann: 'אתה נמצא ב**מעבדת גאן המורחבת (Gannzilla & Jenkins Lab)**. כאן תוכל לבחון כל נכס (קריפטו, מניות, מדדים, זהב, מט"ח), לראות הוכחה שמחזורי גאן ניבאו מראש אירועים פונדמנטליסטיים, ולשחק עם גלגל Gannzilla ומחשבוני מייקל ג׳נקינס.',
    overview: 'אתה נמצא בעמוד **הסקירה הראשית**. כאן רואים את מצב תיק הדמה, פעילות הסוכנים האוטונומיים וביצועי הדסקים.',
    agents: 'אתה נמצא ב**זירת הסוכנים התלת-ממדית**. כאן צוות הסוכנים מנתח שווקים, מריץ בק-טסטים ומחפש אסטרטגיות.',
    academy: 'אתה נמצא ב**אקדמיה וצ׳אט המחקר**. כאן ניתן לשאול כל שאלה על ניתוח טכני, פונדמנטלי וגאן.',
    settings: 'אתה נמצא ב**הגדרות ומפתחות**. כאן מנהלים את חיבורי ה-AI, ענן ה-Supabase והפרמטרים הכלליים.',
  };
  return guides[route] || `אתה נמצא בעמוד **${label}**. שאל אותי כל שאלה על מה שמופיע כאן ואסביר לך את המשמעות וההמלצות!`;
}

export function mountPageChat(ui) {
  if (document.getElementById('alta-page-chat-wrap')) return;

  const wrap = document.createElement('div');
  wrap.id = 'alta-page-chat-wrap';
  wrap.style.cssText = 'position:fixed;bottom:18px;left:18px;z-index:9999;direction:rtl;font-family:inherit;';

  const panel = document.createElement('div');
  panel.style.cssText = [
    'display:none', 'width:360px', 'max-width:calc(100vw - 36px)', 'height:460px', 'max-height:72vh',
    'background:#0c1424', 'border:1px solid #263859', 'border-radius:14px',
    'box-shadow:0 16px 40px rgba(0,0,0,0.55)', 'margin-bottom:10px',
    'flex-direction:column', 'overflow:hidden',
  ].join(';');

  const header = document.createElement('div');
  header.style.cssText = 'padding:10px 14px;background:#111d33;border-bottom:1px solid #1e2d4a;display:flex;align-items:center;justify-content:space-between;';
  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'font-weight:700;font-size:13px;color:#e2e8f0;';
  titleEl.textContent = '🤖 יועץ AI לעמוד הנוכחי';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn-sm';
  closeBtn.textContent = '✕';
  closeBtn.onclick = () => toggle(false);
  header.append(titleEl, closeBtn);

  const msgBox = document.createElement('div');
  msgBox.style.cssText = 'flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;font-size:12.5px;line-height:1.5;';

  const quickRow = document.createElement('div');
  quickRow.style.cssText = 'padding:6px 10px;border-top:1px solid #172338;display:flex;gap:6px;flex-wrap:wrap;background:#0a111f;';

  const form = document.createElement('form');
  form.style.cssText = 'padding:8px 10px;border-top:1px solid #1e2d4a;display:flex;gap:6px;background:#0f182a;';
  const input = document.createElement('input');
  input.className = 'input';
  input.placeholder = 'שאל אותי על מה שאתה רואה כאן…';
  input.style.cssText = 'flex:1;font-size:12.5px;';
  const sendBtn = document.createElement('button');
  sendBtn.type = 'submit';
  sendBtn.className = 'btn btn-sm btn-primary';
  sendBtn.textContent = 'שלח';
  form.append(input, sendBtn);

  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'alta-page-chat-btn';
  toggleBtn.className = 'btn btn-primary';
  toggleBtn.style.cssText = 'border-radius:999px;padding:10px 16px;font-size:13px;font-weight:700;box-shadow:0 8px 24px rgba(37,99,235,0.4);';
  toggleBtn.textContent = '💬 הסבר AI על העמוד';

  function renderMessages() {
    msgBox.innerHTML = '';
    for (const m of chatState.messages) {
      const bubble = document.createElement('div');
      bubble.style.cssText = m.role === 'user'
        ? 'align-self:flex-start;background:#1d4ed8;color:#fff;padding:8px 11px;border-radius:10px;max-width:88%;white-space:pre-wrap;'
        : 'align-self:flex-end;background:#152238;color:#e2e8f0;padding:8px 11px;border-radius:10px;max-width:92%;white-space:pre-wrap;border:1px solid #223454;';
      bubble.textContent = m.content;
      msgBox.appendChild(bubble);
    }
    if (chatState.busy) {
      const loader = document.createElement('div');
      loader.style.cssText = 'align-self:flex-end;color:#93c5fd;font-size:12px;';
      loader.textContent = '⏳ מנתח את העמוד…';
      msgBox.appendChild(loader);
    }
    msgBox.scrollTop = msgBox.scrollHeight;
  }

  async function askPageAi(question) {
    if (!question.trim() || chatState.busy) return;
    chatState.messages.push({ role: 'user', content: question.trim() });
    chatState.busy = true;
    renderMessages();

    const route = ui.route || 'overview';
    const ctx = getPageContextSummary(route);
    const system = [
      'אתה יועץ המסחר והמחקר האישי של המשתמש במערכת Alta Capital.',
      'השב בעברית ברורה, תמציתית ומדויקת.',
      'הסבר למשתמש מה הוא רואה בעמוד הנוכחי, מה המשמעות של המספרים/גרפים, ואיך לקבל החלטה מושכלת.',
      `הקשר חי מתוך העמוד הנוכחי:\n${ctx.summary}`,
    ].join('\n\n');

    try {
      const res = await chatDetailed({
        system,
        messages: chatState.messages.slice(-8),
        maxTokens: 700,
      });
      chatState.messages.push({ role: 'assistant', content: res.text || 'לא התקבלה תשובה.' });
    } catch {
      chatState.messages.push({
        role: 'assistant',
        content: `${defaultPageIntro(route)}\n\n(הערה: חיבור ה-AI בענן לא היה זמין כרגע, ולכן מוצג הסבר מקומי מתוך נתוני העמוד.)`,
      });
    } finally {
      chatState.busy = false;
      renderMessages();
    }
  }

  ['הסבר מה אני רואה כאן', 'מה ההמלצה מהנתונים?', 'מה הסיכונים המרכזיים?'].forEach((q) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'btn btn-sm';
    chip.style.cssText = 'font-size:11px;padding:3px 8px;';
    chip.textContent = q;
    chip.onclick = () => askPageAi(q);
    quickRow.appendChild(chip);
  });

  form.onsubmit = (e) => {
    e.preventDefault();
    const q = input.value;
    input.value = '';
    askPageAi(q);
  };

  function toggle(force) {
    chatState.open = typeof force === 'boolean' ? force : !chatState.open;
    panel.style.display = chatState.open ? 'flex' : 'none';
    toggleBtn.textContent = chatState.open ? '✖ סגור צ׳אט AI' : '💬 הסבר AI על העמוד';
    if (chatState.open) {
      const route = ui.route || 'overview';
      if (chatState.lastRoute !== route || !chatState.messages.length) {
        chatState.lastRoute = route;
        chatState.messages = [{ role: 'assistant', content: defaultPageIntro(route) }];
      }
      renderMessages();
    }
  }

  toggleBtn.onclick = () => toggle();
  panel.append(header, msgBox, quickRow, form);
  wrap.append(panel, toggleBtn);
  document.body.appendChild(wrap);
}
