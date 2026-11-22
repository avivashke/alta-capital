// Floating Static Page-Context AI Assistant Widget
// Provides a compact toggle button on every page that opens an AI chat explaining
// what the user is currently seeing and allowing live consultation on the current view's data.

import { NAV } from './config.js';
import { store } from './store.js';
import { chatDetailed } from './llm.js';
import { toast } from './ui.js';

const chatState = {
  open: false,
  busy: false,
  lastRoute: null,
  lastQuestion: '',
  messages: [], // { role: 'assistant' | 'user', content: string }
};

function extractVisualSnapshot() {
  const view = document.getElementById('view');
  if (!view) return '';
  const lines = [];
  const h1 = view.querySelector('h1')?.textContent?.trim();
  if (h1) lines.push(`כותרת מסך: ${h1}`);

  const metrics = [...view.querySelectorAll('.metric, .kpi')].slice(0, 10)
    .map((el) => el.innerText.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (metrics.length) lines.push(`מדדים מרכזיים על המסך: ${metrics.join(' | ')}`);

  const pills = [...view.querySelectorAll('.pill, .tag')].slice(0, 12)
    .map((el) => el.textContent.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (pills.length) lines.push(`סטטוסים ותגיות: ${[...new Set(pills)].slice(0, 10).join(' · ')}`);

  const svgCount = view.querySelectorAll('svg').length;
  const cardHeads = [...view.querySelectorAll('.card h2')].slice(0, 8)
    .map((el) => el.textContent.trim())
    .filter(Boolean);
  if (svgCount || cardHeads.length) {
    lines.push(`רכיבים חזותיים (${svgCount} גרפים): ${cardHeads.join(' | ')}`);
  }

  const notices = [...view.querySelectorAll('.notice')].slice(0, 2)
    .map((el) => el.innerText.replace(/\s+/g, ' ').trim().slice(0, 160))
    .filter(Boolean);
  if (notices.length) lines.push(`התראות/סיכומים: ${notices.join(' // ')}`);

  return lines.join('\n').slice(0, 900);
}

function getPageContextSummary(route) {
  const navItem = NAV.find((n) => n.id === route) || { label: route || 'סקירה' };
  const s = store.state;
  const parts = [`עמוד נוכחי: "${navItem.label}" (#/${route}).`];
  const visual = extractVisualSnapshot();
  if (visual) parts.push(visual);

  if (route === 'nostro') {
    const bots = s.nostro?.bots || [];
    const ready = bots.filter((b) => (b.readyFirms || []).length > 0);
    parts.push(`מבחני נוסטרו: ${bots.length} בוטים נבדקו, ${ready.length} מוכנים.`);
  } else if (route === 'gann' && s.whatsappGann?.groupName) {
    parts.push(`מודיעין וואטסאפ גאן: קבוצת "${s.whatsappGann.groupName}" (${s.whatsappGann.relevantInsightsCount || 0} תובנות · הטיה: ${s.whatsappGann.overallBias || '—'}).`);
  }

  return { label: navItem.label, summary: parts.join('\n').slice(0, 950) };
}

function buildSmartExternalPrompt(route, question) {
  const ctx = getPageContextSummary(route);
  const q = (question || chatState.lastQuestion || 'הסבר לי מה אני רואה כרגע על המסך, מה המשמעות של הנתונים והגרפים, ומה ההמלצות והסיכונים המרכזיים.').trim();
  const s = store.state;
  const pf = s.paperPortfolio || {};
  return [
    'אני עובד במערכת המסחר והמחקר Alta Capital ומבקש ניתוח מעמיק בעברית.',
    '',
    `❓ השאלה שלי:\n${q}`,
    '',
    `🖥️ תיאור חזותי ונתונים חיים מהמסך כרגע:\n${ctx.summary}`,
    '',
    `📊 קונטקסט מערכת: מחזורים=${s.stats?.cycles || 0}, עסקאות תיק נייר=${pf.totalTradesCount || pf.trades?.length || 0}, מזומן=$${Math.round(pf.cash || 0)}.`,
    '',
    'אנא תן תשובה ברורה, פרקטית ומבוססת על הנתונים למעלה (בלי להמציא מספרים שלא הופיעו).',
  ].join('\n');
}

function defaultPageIntro(route) {
  const { label } = getPageContextSummary(route);
  const guides = {
    nostro: 'אתה נמצא בעמוד **מבחני נוסטרו (Prop Firm Bot Fleet)**. כאן המערכת מריצה אוטומטית 5 בוטים על נתוני אמת מול חוקי FTMO, The5ers, FundedNext, Topstep ו-Apex. אפשר לפתוח אינפוגרפיקה, לבדוק אילו חברות כל בוט עובר, ולייצא דוח הוכחות לאקסל.',
    gann: 'אתה נמצא ב**מעבדת גאן המורחבת (Gannzilla & Jenkins Lab)**. כאן תוכל לבחון כל נכס (קריפטו, מניות, מדדים, זהב, מט"ח), לראות הוכחה שמחזורי גאן ניבאו מראש אירועים פונדמנטליסטיים, ולשחק עם גלגל Gannzilla ומחשבוני מייקל ג׳נקינס.',
    overview: 'אתה נמצא בעמוד **הסקירה הראשית**. כאן רואים את מצב תיק הדמה, פעילות הסוכנים האוטונומיים וביצועי הדסקים.',
    agents: 'אתה נמצא ב**זירת הסוכנים התלת-ממדית**. כאן צוות הסוכנים מנתח שווקים, מריץ בק-טסטים ומחפש אסטרטגיות.',
    academy: 'אתה נמצא ב**אקדמיה וצ׳אט המחקר**. כאן ניתן לשאול כל שאלה על ניתוח טכני, פונדמנטלי וגאן.',
    settings: 'אתה נמצא ב**הגדרות ומפתחות**. כאן מנהלים את חיבורי ה-AI, מסד הנתונים המקומי והפרמטרים הכלליים.',
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
    chatState.lastQuestion = question.trim();
    chatState.messages.push({ role: 'user', content: question.trim() });
    chatState.busy = true;
    renderMessages();

    const route = ui.route || 'overview';
    const ctx = getPageContextSummary(route);
    const system = [
      'אתה יועץ המסחר והמחקר האישי של המשתמש במערכת Alta Capital.',
      'השב בעברית ברורה, תמציתית ומדויקת (עד 6-8 שורות).',
      'הסבר למשתמש מה הוא רואה בעמוד הנוכחי, מה המשמעות של המספרים/גרפים, ואיך לקבל החלטה מושכלת.',
      `הקשר חי מתוך העמוד הנוכחי:\n${ctx.summary}`,
    ].join('\n\n');

    try {
      const res = await chatDetailed({
        system,
        messages: chatState.messages.slice(-6),
        maxTokens: 380,
      });
      const via = res.label || res.model ? `\n\n— ${res.label || res.model}` : '';
      chatState.messages.push({ role: 'assistant', content: (res.text || 'לא התקבלה תשובה.') + via });
    } catch (err) {
      chatState.messages.push({
        role: 'assistant',
        content: `${defaultPageIntro(route)}\n\n(הערה: חיבור ה-AI לא החזיר תשובה כרגע: ${err?.message || 'שגיאת חיבור'} — תוכל ללחוץ למטה על "✨ שאל ב-Gemini" או "📋 העתק לאנטיוגרוויטי" לשאילתה חכמה עם כל הקונטקסט.)`,
      });
    } finally {
      chatState.busy = false;
      renderMessages();
    }
  }

  async function copySmartPrompt(openGemini = false) {
    const route = ui.route || 'overview';
    const prompt = buildSmartExternalPrompt(route, input.value || chatState.lastQuestion);
    try {
      await navigator.clipboard.writeText(prompt);
      toast(openGemini ? '✓ השאילתה החכמה + הקונטקסט הועתקו — הדבק (Ctrl+V) ב-Gemini!' : '✓ השאילתה החכמה + התיאור החזותי הועתקו — הדבק (Ctrl+V) באנטיוגרוויטי!', 'ok');
    } catch {
      toast('לא ניתן להעתיק אוטומטית — השאילתה הוצגה בצ׳אט להעתקה ידנית.', 'opt');
      chatState.messages.push({ role: 'assistant', content: prompt });
      renderMessages();
    }
    if (openGemini) {
      window.open('https://gemini.google.com/app', '_blank', 'noopener');
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

  const externalRow = document.createElement('div');
  externalRow.style.cssText = 'padding:5px 10px;border-top:1px solid #172338;display:flex;gap:6px;flex-wrap:wrap;background:#08101d;';

  const geminiBtn = document.createElement('button');
  geminiBtn.type = 'button';
  geminiBtn.className = 'btn btn-sm';
  geminiBtn.style.cssText = 'font-size:11px;padding:3px 8px;border-color:rgba(88,166,255,0.45);color:#93c5fd;flex:1;';
  geminiBtn.textContent = '✨ שאל ב-Gemini (עם קונטקסט)';
  geminiBtn.onclick = () => copySmartPrompt(true);

  const agyBtn = document.createElement('button');
  agyBtn.type = 'button';
  agyBtn.className = 'btn btn-sm btn-ghost';
  agyBtn.style.cssText = 'font-size:11px;padding:3px 8px;border:1px solid rgba(167,139,250,0.4);color:#c4b5fd;flex:1;';
  agyBtn.textContent = '📋 העתק לאנטיוגרוויטי';
  agyBtn.onclick = () => copySmartPrompt(false);

  externalRow.append(geminiBtn, agyBtn);

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
  panel.append(header, msgBox, quickRow, externalRow, form);
  wrap.append(panel, toggleBtn);
  document.body.appendChild(wrap);
}
