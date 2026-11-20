// Frontend Bridge for WhatsApp Web Group Reader ("וואטסאפ · גאן")
// Connects to the user's running local Alta Capital Base Server (http://localhost:8181 or configured URL)
// to launch WhatsApp Web QR login, choose a single whitelisted group, run read-only group scans,
// sync summarized insights (with author + source message + before/after context) to store/cloud,
// and render the source message + surrounding conversation context modal from any device.

import { store } from './store.js';
import { scheduleDatabasePush } from './db.js';
import { h, tag, openModal } from './ui.js';

let discoveredOrigin = null;

function getCandidateOrigins() {
  const out = [];
  const push = (u) => {
    const clean = String(u || '').trim().replace(/\/+$/, '');
    if (clean && /^https?:\/\//i.test(clean) && !out.includes(clean)) out.push(clean);
  };
  if (discoveredOrigin) push(discoveredOrigin);
  if (typeof window !== 'undefined' && /^https?:/.test(window.location.origin)) {
    push(window.location.origin);
  }
  const cfgBase = store.state?.settings?.db?.baseServerUrl;
  if (cfgBase) push(cfgBase);
  push('http://localhost:8181');
  push('http://127.0.0.1:8181');
  return out;
}

function authHeaders() {
  const token = (store.state?.settings?.db?.baseServerToken || '').trim();
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 4000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function syncWhatsAppGannToStore(report) {
  if (!report || typeof report !== 'object') return;
  const prevAt = store.state.whatsappGann?.scannedAt || 0;
  if ((report.scannedAt || 0) >= prevAt) {
    store.state.whatsappGann = report;
    store.save();
    store.emit();
    scheduleDatabasePush(1000);
  }
}

export async function fetchWhatsAppStatus() {
  const candidates = getCandidateOrigins();
  for (const origin of candidates) {
    try {
      const res = await fetchWithTimeout(`${origin}/api/whatsapp-agent/status`, { headers: { Accept: 'application/json' } }, 2800);
      if (!res.ok) continue;
      const data = await res.json();
      if (data && data.agentId === 'whatsapp_gann') {
        discoveredOrigin = origin;
        if (data.latestReport) syncWhatsAppGannToStore(data.latestReport);
        return { connected: true, origin, ...data };
      }
    } catch { /* try next origin */ }
  }
  return {
    connected: false,
    origin: null,
    playwrightInstalled: false,
    loggedIn: false,
    groupName: store.state.whatsappGann?.groupName || '',
    discoveredGroups: [],
    config: null,
    job: { busy: false, mode: null },
    latestReport: store.state.whatsappGann || null,
  };
}

async function resolveOrigin() {
  if (discoveredOrigin) return discoveredOrigin;
  const st = await fetchWhatsAppStatus();
  return st.connected ? st.origin : null;
}

export async function launchWhatsAppLogin() {
  const origin = await resolveOrigin();
  if (!origin) {
    return {
      ok: false,
      error: 'לא זוהה שרת בסיס מקומי פעיל על המחשב (http://localhost:8181). הפעל את Alta Capital Base Server במחשב כדי לפתוח את WhatsApp Web.',
    };
  }
  try {
    const res = await fetchWithTimeout(`${origin}/api/whatsapp-agent/login`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    }, 10000);
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function saveWhatsAppConfig(patch = {}) {
  const origin = await resolveOrigin();
  if (!origin) return { ok: false, error: 'שרת הבסיס המקומי אינו מחובר' };
  try {
    const res = await fetchWithTimeout(`${origin}/api/whatsapp-agent/config`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(patch),
    }, 6000);
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function runWhatsAppScan(options = {}) {
  const origin = await resolveOrigin();
  if (!origin) {
    return {
      ok: false,
      error: 'לא זוהה שרת בסיס מקומי פעיל על המחשב (http://localhost:8181).',
    };
  }
  try {
    // Live browser open + scroll + optional local AI summary can take up to 2.5 minutes
    const res = await fetchWithTimeout(`${origin}/api/whatsapp-agent/scan`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(options),
    }, 180_000);
    const data = await res.json();
    if (data?.ok && data.report) {
      syncWhatsAppGannToStore(data.report);
      store.log('ok', 'וואטסאפ · גאן', `נסרקה קבוצת "${data.report.groupName}": ${data.report.relevantInsightsCount} תובנות מתוך ${data.report.totalMessagesRead} הודעות`);
    }
    return data;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const ROLE_HE = {
  target: 'יעד',
  support: 'תמיכה',
  resistance: 'התנגדות',
  stop: 'סטופ',
  entry: 'כניסה',
  anchor: 'עוגן גאן',
};

const CAT_HE = {
  gann: '📐 גאן',
  signal: '🎯 איתות/רמות',
  macro_news: '📰 מאקרו/חדשות',
};

function renderChatBubble(msg, { isSource = false } = {}) {
  return h('div', {
    style: {
      padding: isSource ? '12px 14px' : '9px 12px',
      borderRadius: '10px',
      background: isSource ? 'rgba(16, 62, 46, 0.55)' : 'rgba(15, 23, 42, 0.78)',
      border: isSource ? '2px solid rgba(46, 204, 113, 0.75)' : '1px solid rgba(148, 163, 184, 0.22)',
      boxShadow: isSource ? '0 0 14px rgba(46, 204, 113, 0.16)' : 'none',
    },
  },
    h('div', { class: 'row between', style: { gap: '8px', marginBottom: '5px', flexWrap: 'wrap' } },
      h('div', { class: 'row', style: { gap: '6px', alignItems: 'center' } },
        isSource ? tag('📌 הודעת המקור', 'live') : null,
        h('strong', { style: { fontSize: '12.5px', color: isSource ? '#86efac' : '#93c5fd' }, text: msg.author || 'חבר קבוצה' }),
      ),
      h('span', { class: 'tiny mono muted', text: msg.timestampRaw || '—' }),
    ),
    msg.quotedText
      ? h('div', {
          class: 'tiny',
          style: {
            marginBottom: '6px',
            padding: '5px 8px',
            borderRight: '3px solid #38bdf8',
            background: 'rgba(15, 23, 42, 0.65)',
            borderRadius: '4px',
            color: '#cbd5e1',
          },
          text: `↪ בתגובה ל: ${msg.quotedText}`,
        })
      : null,
    h('div', {
      class: 'small',
      style: {
        whiteSpace: 'pre-wrap',
        lineHeight: '1.58',
        color: isSource ? '#f8fafc' : '#cbd5e1',
      },
      text: msg.text || '',
    }),
  );
}

/**
 * Opens a modal showing the exact WhatsApp source message with author, timestamp,
 * extracted Gann/trading metadata, and the surrounding messages BEFORE and AFTER for full context.
 */
export function openWhatsAppSourceModal(insight, groupName = '') {
  if (!insight) return;
  const src = insight.sourceMessage || {
    author: insight.author,
    timestampRaw: insight.timestampRaw,
    text: insight.summary,
  };
  const before = Array.isArray(insight.contextBefore) ? insight.contextBefore : [];
  const after = Array.isArray(insight.contextAfter) ? insight.contextAfter : [];

  openModal(
    `💬 הודעת מקור וקונטקסט · ${groupName || 'קבוצת וואטסאפ'}`,
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
      // Metadata & Extracted Gann/Trading Tags
      h('div', { class: 'card', style: { background: 'rgba(10, 18, 32, 0.92)', padding: '10px 12px' } },
        h('div', { class: 'row wrap', style: { gap: '6px', marginBottom: '6px' } },
          tag(`✍️ ${src.author || insight.author}`, 'opt'),
          tag(`🕒 ${src.timestampRaw || insight.timestampRaw || 'ללא חותמת זמן'}`, 'dry'),
          ...(insight.symbols || []).map((s) => tag(s, 'live')),
          ...(insight.categories || []).map((c) => tag(CAT_HE[c] || c, 'opt')),
          insight.bias === 'bullish' ? tag(`🟢 שורי (${insight.score})`, 'live') : insight.bias === 'bearish' ? tag(`🔴 דובי (${insight.score})`, 'red') : tag('🟡 נייטרלי', 'opt'),
        ),
        (insight.levels?.length || insight.dates?.length || insight.gannDegrees?.length)
          ? h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '4px' } },
              ...(insight.levels || []).map((l) => tag(`${ROLE_HE[l.role] || l.role}: ${l.price}`, l.role === 'target' ? 'live' : l.role === 'stop' ? 'red' : 'opt')),
              ...(insight.gannDegrees || []).map((d) => tag(`Sq9 ${d}°`, 'opt')),
              ...(insight.dates || []).map((d) => tag(`📅 ${d.dateIso}`, 'opt')),
            )
          : null,
      ),

      // Context Before
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        h('div', { class: 'tiny muted', style: { fontWeight: '700' }, text: `⬆️ קונטקסט לפני ההודעה (${before.length})` }),
        before.length
          ? before.map((m) => renderChatBubble(m))
          : h('div', { class: 'tiny muted', style: { padding: '6px 10px', borderRadius: '6px', background: 'rgba(15,23,42,0.45)' }, text: 'אין הודעות קודמות בחלון שנסרק.' }),
      ),

      // Highlighted Original Source Message
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        renderChatBubble(src, { isSource: true }),
      ),

      // Context After
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        h('div', { class: 'tiny muted', style: { fontWeight: '700' }, text: `⬇️ קונטקסט אחרי ההודעה (${after.length})` }),
        after.length
          ? after.map((m) => renderChatBubble(m))
          : h('div', { class: 'tiny muted', style: { padding: '6px 10px', borderRadius: '6px', background: 'rgba(15,23,42,0.45)' }, text: 'זו ההודעה האחרונה בחלון שנסרק.' }),
      ),
    ),
    { wide: true },
  );
}
