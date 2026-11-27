// Comprehensive Page-Context & Visual Multimodal Extractor
// Extracts deep financial state, chart indicators, Gann/Nostro/Invo data, and visual canvas snapshots
// for the AI Advisor and Page Chat, prioritizing online models with free tiers (Gemini, Groq, Claude, OpenRouter).

import { store } from './store.js';
import { quotes, lastPrice, marketState } from './market.js';
import { addPoolEntry } from './keypool.js';
import { h, openModal, toast } from './ui.js';

/**
 * Captures an image (data URL) of the active chart canvas or visual element on the page.
 */
export function captureActiveViewImage() {
  if (typeof document === 'undefined') return null;
  try {
    const view = document.getElementById('view');
    if (!view) return null;

    // 1. Look for active TradingView Canvas
    const canvases = view.querySelectorAll('canvas');
    for (const canvas of canvases) {
      if (canvas.width > 150 && canvas.height > 120) {
        try {
          const dataUrl = canvas.toDataURL('image/png');
          if (dataUrl && dataUrl.length > 200) return dataUrl;
        } catch (e) {
          console.warn('[captureActiveViewImage] canvas export warn:', e);
        }
      }
    }

    // 2. Look for large chart SVG
    const svg = view.querySelector('svg');
    if (svg && (svg.clientWidth > 200 || svg.getAttribute('viewBox'))) {
      try {
        const svgStr = new XMLSerializer().serializeToString(svg);
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgStr)}`;
      } catch (e) {
        console.warn('[captureActiveViewImage] SVG export warn:', e);
      }
    }
  } catch (err) {
    console.warn('[captureActiveViewImage] failed:', err);
  }
  return null;
}

/**
 * Builds rich, comprehensive structured context of the current screen for AI consumption.
 */
export function buildComprehensivePageContext(route = 'overview') {
  const s = store.state;
  const sections = [];

  // General header
  sections.push(`📌 עמוד נוכחי: #${route}`);
  sections.push(`מצב נתוני שוק: ${marketState.synthetic ? 'סינתטי (הדגמה)' : 'שוק חי (' + (marketState.provider || 'Live') + ')'}`);

  // Route-Specific Deep Intelligence
  if (route === 'gann') {
    const sym = s.gannViewState?.symbol || 'BTCUSDT';
    const curQuote = quotes[sym]?.price || lastPrice(sym);
    sections.push(`\n📐 נתוני מעבדת גאן (Gann & Jenkins Lab):`);
    sections.push(`- נכס מנותח: ${sym} · מחיר חי: $${curQuote || '—'}`);
    if (s.gannConfig) {
      sections.push(`- תצורת גאן: מצב ריבוע=${s.gannConfig.boxRangeMode || 'swing'}, חלוקות=${s.gannConfig.boxDivisions || 'שמיניות'}, נרות סווינג=${s.gannConfig.swingBarMode || 2}`);
    }
    if (s.whatsappGann) {
      sections.push(`- מודיעין קבוצת וואטסאפ: "${s.whatsappGann.groupName || 'קבוצת גאן'}" · ${s.whatsappGann.relevantInsightsCount || 0} תובנות · סנטימנט: ${s.whatsappGann.overallBias || 'שורי'} · סוחרים אמינים: יגאל ושמחה.`);
    }
  } else if (route === 'charts') {
    sections.push(`\n📈 נתוני תחנת המסחר TradingView:`);
    const desk = s.desks?.[0];
    const sym = desk?.symbol || 'BTCUSDT';
    const p = quotes[sym]?.price || lastPrice(sym);
    sections.push(`- נכס מוצג: ${sym} (${desk?.tf || '1h'}) · מחיר: $${p || '—'}`);
    sections.push(`- אינדיקטורים פעילים: ממוצעים נעים (EMA 20/50/200), נפח מסחר (Volume), שמיניות גאן, איתותי סווינג ST/SB, רצועות בולינגר, RSI(14).`);
  } else if (route === 'nostro') {
    const bots = s.nostro?.bots || [];
    const funded = bots.filter((b) => (b.passedRules || []).length >= 4);
    const vault = s.vault || { balance: 0, totalWithdrawn: 0 };
    sections.push(`\n🏆 נתוני מודול נוסטרו (Prop Firm Challenges & Vault):`);
    sections.push(`- צי בוטים: ${bots.length} בוטים נבדקו · ${funded.length} עברו את מבחני השלבים (Funded)`);
    sections.push(`- כספת רווחים צדדית מובטחת (Vault Side Fund): יתרה נעולה=$${vault.balance?.toLocaleString('en-US') || 0}, סך שנמשך=$${vault.totalWithdrawn?.toLocaleString('en-US') || 0}`);
    sections.push(`- חוקי חברות: FTMO, The5ers, FundedNext, Invo, Topstep (מגבלת DD יומית 5%, כוללת 10%, יעד רווח 10%).`);
  } else if (route === 'invo') {
    const invo = s.invoState || {};
    const subs = invo.activeSubscriptions || [];
    sections.push(`\n👥 נתוני פלטפורמת Invo וחדרי חיקוי (Copy-Trading):`);
    sections.push(`- סטטוס חשבון Invo: ${invo.connected ? 'מחובר (' + (invo.username || invo.email) + ')' : 'סביבת הדגמה / Nesting'}`);
    sections.push(`- סוחרים בחיקוי פעיל (${subs.length}): יגאל (Macro Alpha 76.4%), שמחה (Jenkins Sq9 73.1%), Quant Volatility Stack`);
    sections.push(`- ניתוב עסקאות: מועבר אוטומטית לשולחן Invo Mirror בתיק הנוסטרו ולקופה הצדדית המוגנת.`);
  } else if (route === 'portfolio') {
    const pf = s.paperPortfolio || {};
    sections.push(`\n💼 נתוני תיק מסחר:`);
    sections.push(`- הון כולל: $${Math.round(pf.equity || pf.cash || 100000).toLocaleString('en-US')}, מזומן פנוי: $${Math.round(pf.cash || 0).toLocaleString('en-US')}`);
    sections.push(`- עסקאות פתוחות: ${(pf.openTrades || []).length}, עסקאות שנסגרו: ${pf.totalTradesCount || 0}, רווח מצטבר: $${Math.round(pf.realizedPnl || 0)}`);
  } else if (route === 'desks' || route === 'lab') {
    sections.push(`\n▤ נתוני שולחנות מסחר ומעבדה:`);
    const desks = s.desks || [];
    for (const d of desks.slice(0, 5)) {
      sections.push(`- שולחן ${d.label || d.id}: ${d.status || 'research'} · אסטרטגיה: ${d.strategyId || 'EMA'} · תשואה OOS: ${d.oosMetrics?.returnPct ?? d.bestReturn ?? '—'}% · PF: ${d.metrics?.profitFactor ?? '—'}`);
    }
  }

  // Extract Visible DOM Metrics and Headings
  if (typeof document !== 'undefined') {
    const view = document.getElementById('view');
    if (view) {
      const h1 = view.querySelector('h1')?.textContent?.trim();
      const h2s = [...view.querySelectorAll('h2')].slice(0, 5).map((el) => el.textContent.trim()).filter(Boolean);
      const metrics = [...view.querySelectorAll('.metric, .kpi')].slice(0, 8)
        .map((el) => el.innerText.replace(/\s+/g, ' ').trim())
        .filter(Boolean);

      if (h1 || h2s.length) {
        sections.push(`\n🖥️ תוכן חזותי בעמוד: ${h1 ? `"${h1}"` : ''} ${h2s.length ? `[${h2s.join(', ')}]` : ''}`);
      }
      if (metrics.length) {
        sections.push(`מדדים בולטים על המסך: ${metrics.join(' | ')}`);
      }
    }
  }

  return sections.join('\n');
}

/**
 * Opens a modal allowing the user to paste their accounts & free-tier API keys
 * (Gemini, Groq, OpenRouter, Claude, Grok) with direct registration links.
 */
export function openFreeAiConnectModal(ui) {
  const s = store.state;
  const pool = s.settings?.pool?.entries || [];

  // Find existing keys if present
  const geminiKey = pool.find((e) => e.provider === 'gemini')?.key || '';
  const groqKey = pool.find((e) => e.provider === 'groq')?.key || '';
  const openRouterKey = pool.find((e) => e.provider === 'openrouter')?.key || '';
  const claudeKey = pool.find((e) => e.provider === 'anthropic')?.key || '';
  const grokKey = pool.find((e) => e.provider === 'xai')?.key || '';

  const geminiInput = h('input', { class: 'input mono', type: 'password', value: geminiKey, placeholder: 'AIzaSy...', dir: 'ltr' });
  const groqInput = h('input', { class: 'input mono', type: 'password', value: groqKey, placeholder: 'gsk_...', dir: 'ltr' });
  const openRouterInput = h('input', { class: 'input mono', type: 'password', value: openRouterKey, placeholder: 'sk-or-v1-...', dir: 'ltr' });
  const claudeInput = h('input', { class: 'input mono', type: 'password', value: claudeKey, placeholder: 'sk-ant-api03-...', dir: 'ltr' });
  const grokInput = h('input', { class: 'input mono', type: 'password', value: grokKey, placeholder: 'xai-...', dir: 'ltr' });

  const modalBody = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px', minWidth: '380px', maxWidth: '520px' } },
    h('div', { class: 'row between', style: { alignItems: 'center' } },
      h('h3', { style: { margin: '0', fontSize: '17px' }, text: '⚡ חיבור חשבונות AI בעדיפות עליונה' }),
      h('span', { class: 'badge', style: { background: 'rgba(16,185,129,0.15)', color: '#34d399' }, text: 'עדיפות ראשונה ליועץ' }),
    ),
    h('p', { class: 'small muted', style: { margin: '0' }, text: 'שאילתות היועץ יישלחו קודם כל למודלים האלו ברשת (טוקנים חינמיים ונדיבים, מהירות LPU ותמיכה בראייה חזותית) לפני כל מודל מקומי.' }),

    // Google Gemini (Top Priority)
    h('div', { class: 'card', style: { padding: '10px', background: 'rgba(56, 189, 248, 0.05)', borderColor: 'rgba(56, 189, 248, 0.3)' } },
      h('div', { class: 'row between', style: { marginBottom: '4px' } },
        h('b', { style: { color: '#38bdf8' }, text: '✨ Google Gemini (מומלץ ראשון · חינם לגמרי)' }),
        h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', class: 'btn-link small', text: 'קבל מפתח חינם ב-Google ↗' }),
      ),
      h('div', { class: 'small muted', style: { marginBottom: '6px' }, text: 'Gemini 2.5 Flash: מיליון טוקנים בהקשר, תמיכה מלאה בתמונות גרפים, ללא CORS.' }),
      geminiInput,
    ),

    // Groq LPU
    h('div', { class: 'card', style: { padding: '10px', background: 'rgba(245, 158, 11, 0.05)', borderColor: 'rgba(245, 158, 11, 0.3)' } },
      h('div', { class: 'row between', style: { marginBottom: '4px' } },
        h('b', { style: { color: '#f59e0b' }, text: '⚡ Groq (מהירות LPU גבוהה ביותר)' }),
        h('a', { href: 'https://console.groq.com/keys', target: '_blank', class: 'btn-link small', text: 'קבל מפתח Groq חינם ↗' }),
      ),
      h('div', { class: 'small muted', style: { marginBottom: '6px' }, text: 'Llama 3.3 70B & GPT-OSS 120B: עד 30 בקשות בדקה ו-1,000 ביום חינם.' }),
      groqInput,
    ),

    // OpenRouter
    h('div', { class: 'card', style: { padding: '10px' } },
      h('div', { class: 'row between', style: { marginBottom: '4px' } },
        h('b', { text: '🌐 OpenRouter (DeepSeek / Qwen / Llama Free)' }),
        h('a', { href: 'https://openrouter.ai/keys', target: '_blank', class: 'btn-link small', text: 'קבל מפתח OpenRouter ↗' }),
      ),
      openRouterInput,
    ),

    // Claude / Anthropic
    h('div', { class: 'card', style: { padding: '10px' } },
      h('div', { class: 'row between', style: { marginBottom: '4px' } },
        h('b', { text: '🎭 Anthropic Claude (Claude 3.5 Sonnet / Haiku)' }),
        h('a', { href: 'https://console.anthropic.com', target: '_blank', class: 'btn-link small', text: 'קבל מפתח Claude ↗' }),
      ),
      claudeInput,
    ),

    // Grok / xAI
    h('div', { class: 'card', style: { padding: '10px' } },
      h('div', { class: 'row between', style: { marginBottom: '4px' } },
        h('b', { text: '𝕏 xAI Grok (Grok 2 / Grok Vision)' }),
        h('a', { href: 'https://console.x.ai', target: '_blank', class: 'btn-link small', text: 'קבל מפתח xAI ↗' }),
      ),
      grokInput,
    ),

    // Save Button
    h('div', { class: 'row between', style: { marginTop: '8px' } },
      h('span', { class: 'small muted', text: 'המפתחות נשמרים מקומית בדפדפן ופונים ישירות לספקים.' }),
      h('button', {
        class: 'btn btn-primary',
        onclick: () => {
          if (geminiInput.value.trim()) {
            addPoolEntry(s, { provider: 'gemini', key: geminiInput.value.trim(), model: 'gemini-2.5-flash', weight: 100 });
          }
          if (groqInput.value.trim()) {
            addPoolEntry(s, { provider: 'groq', key: groqInput.value.trim(), model: 'llama-3.3-70b-versatile', weight: 95 });
          }
          if (openRouterInput.value.trim()) {
            addPoolEntry(s, { provider: 'openrouter', key: openRouterInput.value.trim(), model: 'meta-llama/llama-3.3-70b-instruct:free', weight: 90 });
          }
          if (claudeInput.value.trim()) {
            addPoolEntry(s, { provider: 'anthropic', key: claudeInput.value.trim(), model: 'claude-3-5-sonnet-20241022', weight: 85 });
          }
          if (grokInput.value.trim()) {
            addPoolEntry(s, { provider: 'xai', key: grokInput.value.trim(), model: 'grok-2-latest', weight: 80 });
          }
          store.save();
          toast('✓ חשבונות ה-AI עודכנו והוגדרו בעדיפות עליונה ליועץ!', 'ok');
          if (ui?.rerender) ui.rerender();
        },
      }, '💾 שמור והפעל בעדיפות עליונה'),
    ),
  );

  openModal(modalBody);
}
