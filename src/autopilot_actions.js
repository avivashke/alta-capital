// Autopilot for the "recommended actions": the machine executes them by itself and the owner can
// step in at any time with plain text in the Team window ("הרץ כיול על 1h", "סיכון 1%", "עצור אוטומציה"...).
import { store } from './store.js';
import { localAdvice, askAdvisor } from './advisor.js';
import { runDeskCycle } from './firm.js';

const MAX_LOG = 40;
const RUN_COOLDOWN_MS = 4 * 60 * 1000;
let running = false;
let lastRunAt = 0;

function record(id, title, result, kind = 'ok') {
  const st = store.state;
  st.autoActions = st.autoActions || [];
  st.autoActions.unshift({ at: Date.now(), id, title, result });
  st.autoActions.length = Math.min(st.autoActions.length, MAX_LOG);
  store.log(kind, 'אוטופיילוט · פעולה מומלצת', `${title}: ${result}`);
}

export function autoActionsEnabled() {
  return store.state.settings?.autoActions !== false;
}

export function lastAutoFor(id) {
  return (store.state.autoActions || []).find((x) => x.id === id) || null;
}

export function recentAutoActions(n = 8) {
  return (store.state.autoActions || []).slice(0, n);
}

function findDesks(token) {
  const t = String(token || '').trim().toLowerCase();
  const desks = store.state.desks || [];
  if (!t || /^(all|הכל|כולם|כל)/.test(t)) return desks;
  return desks.filter((d) => [d.id, d.short, d.tf, d.label, d.symbol].some((x) => String(x || '').toLowerCase().includes(t)));
}

async function cycleOne(desk) {
  try {
    await runDeskCycle(desk, { deep: false });
    return true;
  } catch (err) {
    store.log('warn', 'אוטופיילוט', `מחזור על ${desk.short} נכשל: ${err.message}`);
    return false;
  }
}

/** Execute whatever the advisor currently recommends, without waiting for a click. */
export async function runAutoActions({ force = false } = {}) {
  if (running || !autoActionsEnabled()) return { ok: false, reason: running ? 'busy' : 'disabled' };
  if (!force && Date.now() - lastRunAt < RUN_COOLDOWN_MS) return { ok: false, reason: 'cooldown' };
  running = true;
  lastRunAt = Date.now();
  const done = [];
  try {
    const st = store.state;
    const advice = localAdvice(st);
    const ids = new Set(advice.map((a) => a.id));
    const s = st.settings;

    // Heavy optimisation cycles belong to the Base Server cron (24/7). The browser only does light state actions.
    const inBrowser = typeof window !== 'undefined';

    if (ids.has('stuck') && !inBrowser) {
      const stuck = (st.desks || []).filter((d) => d.status === 'research' || d.status === 'optimizing')
        .sort((a, b) => (a.lastRunAt || 0) - (b.lastRunAt || 0))[0];
      if (stuck && await cycleOne(stuck)) { record('stuck', 'מחזור כיול על שולחן תקוע', `הורץ על ${stuck.short}`); done.push('stuck'); }
    }
    if (ids.has('dry') && !inBrowser) {
      const dry = (st.desks || []).find((d) => d.status === 'dry-run');
      if (dry && await cycleOne(dry)) { record('dry', 'השלמת dry-run', `מחזור נוסף על ${dry.short} (${dry.dryRunCycles || 0}/3)`); done.push('dry'); }
    }
    if (ids.has('livegap')) {
      const bad = (st.desks || []).filter((d) => d.status === 'live' && (Number(d.livePnl) || 0) < -2);
      for (const d of bad) {
        d.status = 'optimizing'; d.openTrade = null; d.dryRunCycles = 0;
        record('livegap', 'פער שלילי בין בקטסט לנייר', `${d.short} (${(Number(d.livePnl) || 0).toFixed(2)}%) הוחזר לכיול`, 'warn');
        done.push('livegap');
      }
    }
    if (ids.has('fragile')) {
      const min = s.minRobustness ?? 50;
      for (const d of (st.desks || []).filter((x) => x.version && x.status === 'live' && (x.assessment?.robustness ?? 100) < min)) {
        d.status = 'optimizing'; d.openTrade = null;
        record('fragile', 'חוסן סטטיסטי נמוך', `${d.short} הורד מהרצה חיה עד שהחוסן יעלה`, 'warn');
        done.push('fragile');
      }
    }
    // Negative sentiment -> auto-trim risk, and restore once it clears
    const news = st.sentiment?.newsScore ?? 0;
    if (news < -0.3 && !s.riskAutoLowered && (Number(s.riskPerTrade) || 0.015) > 0.01) {
      s.riskAutoPrev = s.riskPerTrade; s.riskPerTrade = 0.01; s.riskAutoLowered = true;
      record('sentiment', 'סנטימנט שלילי', 'הסיכון לעסקה הורד ל-1% אוטומטית', 'warn');
      done.push('sentiment');
    } else if (news > -0.1 && s.riskAutoLowered) {
      s.riskPerTrade = s.riskAutoPrev || 0.015; s.riskAutoLowered = false;
      record('sentiment', 'הסנטימנט התייצב', `הסיכון הוחזר ל-${((s.riskPerTrade) * 100).toFixed(1)}%`);
    }
    if (ids.has('ideas')) {
      try {
        const { scanIfDue } = await import('./research.js');
        await scanIfDue();
        record('ideas', 'רעיונות מחקר שלא נבדקו', 'הופעלה סריקת מחקר ושליחה לשולחנות');
        done.push('ideas');
      } catch { /* research is optional */ }
    }
    store.save();
    return { ok: true, done };
  } finally {
    running = false;
  }
}

/** Plain-text intervention from the owner. Returns the team's reply. */
export async function handleTeamCommand(text) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, reply: 'כתוב הוראה לצוות.' };
  const s = store.state.settings;
  let m;

  if (/(עצור|כבה|השבת).*(אוטומ|אוטופיילוט|autopilot)/i.test(raw)) {
    s.autoActions = false; store.save();
    record('cmd', 'הוראה מהבעלים', 'הפעולות האוטומטיות הושבתו', 'warn');
    return { ok: true, reply: 'הפעולות האוטומטיות כבויות. כתוב "הפעל אוטומציה" כדי להחזיר.' };
  }
  if (/(הפעל|חדש|הדלק).*(אוטומ|אוטופיילוט|autopilot)/i.test(raw)) {
    s.autoActions = true; store.save();
    record('cmd', 'הוראה מהבעלים', 'הפעולות האוטומטיות הופעלו');
    return { ok: true, reply: 'הפעולות האוטומטיות פועלות שוב.' };
  }
  if ((m = raw.match(/(?:סיכון|risk)[^\d]*(\d+(?:\.\d+)?)\s*%?/i))) {
    const pct = Math.max(0.2, Math.min(2, Number(m[1])));
    s.riskPerTrade = pct / 100; s.riskAutoLowered = false; store.save();
    record('cmd', 'הוראה מהבעלים', `הסיכון לעסקה נקבע ל-${pct}%`);
    return { ok: true, reply: `הסיכון לעסקה עודכן ל-${pct}%.` };
  }
  if ((m = raw.match(/^(?:הרץ|כייל|כיול|אופטימיזציה|optimi[sz]e|run)\s*(?:כיול|מחזור)?\s*(?:על|ל)?\s*(.*)$/i))) {
    const targets = findDesks(m[1]).slice(0, /^(all|הכל|כולם|כל)/i.test((m[1] || '').trim()) ? 3 : 1);
    if (!targets.length) return { ok: false, reply: `לא מצאתי שולחן שמתאים ל-"${m[1]}". נסה 5m / 1h / 1d או "הכל".` };
    let n = 0;
    for (const d of targets) if (await cycleOne(d)) n++;
    store.save();
    record('cmd', 'הוראה מהבעלים', `הורץ מחזור כיול על ${targets.map((d) => d.short).join(', ')}`);
    return { ok: true, reply: `הורצו ${n} מחזורי כיול: ${targets.map((d) => d.short).join(', ')}.` };
  }

  // Anything else becomes a standing directive for the AI director + gets an advisor reply
  store.state.teamDirectives = store.state.teamDirectives || [];
  store.state.teamDirectives.push({ at: Date.now(), text: raw });
  store.state.teamDirectives = store.state.teamDirectives.slice(-12);
  store.save();
  record('cmd', 'הנחיה מהבעלים', raw.slice(0, 90));
  let answer = '';
  try { const a = await askAdvisor(`הבעלים הנחה את הצוות: "${raw}". אשר בקצרה איך הצוות יפעל לפי ההנחיה.`, []); } catch { /* optional */ }
  return { ok: true, reply: `ההנחיה נשמרה ותשפיע על מנהל ה-AI במחזור הבא.${answer ? `\n\n${answer}` : ''}` };
}
