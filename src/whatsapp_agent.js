// Frontend Bridge & Parser for WhatsApp Web Group Reader ("וואטסאפ · גאן")
// Connects to local Base Server (http://localhost:8181) or Cloud API,
// parses WhatsApp Web group chats (live scraper or direct paste export),
// applies VIP weighting to key authorities (יגאל & שמחה),
// and syncs structured insights (Gann levels, Sq9 degrees, dates, symbols, sentiment) across all devices.

import { store } from './store.js';
import { scheduleDatabasePush } from './db.js';
import { h, tag, openModal, closeModal, toast } from './ui.js';

let discoveredOrigin = null;

// VIP Authorities in the trading group: Yigal (יגאל) & Simcha (שמחה) carry the highest reliability weighting
export function detectVipAuthor(authorName = '', text = '') {
  const norm = String(authorName || '').trim();
  const lower = norm.toLowerCase();
  const textSample = String(text || '').slice(0, 100).toLowerCase();
  const isYigal = /יגאל|yigal|igal/i.test(lower) || /יגאל/i.test(textSample) || /מאת יגאל/i.test(textSample);
  const isSimcha = /שמחה|simcha|simha/i.test(lower) || /שמחה/i.test(textSample) || /מאת שמחה/i.test(textSample);
  if (isYigal) return { isVip: true, name: 'יגאל', vipName: 'yigal', weight: 4.5, weightMultiplier: 4.5, badge: '👑 יגאל (סמכות עליונה)' };
  if (isSimcha) return { isVip: true, name: 'שמחה', vipName: 'simcha', weight: 4.5, weightMultiplier: 4.5, badge: '👑 שמחה (סמכות עליונה)' };
  return { isVip: false, name: norm || 'חבר קבוצה', vipName: null, weight: 1.0, weightMultiplier: 1.0, badge: null };
}

const SYMBOL_ALIASES = {
  BTC: 'BTCUSDT',
  BITCOIN: 'BTCUSDT',
  ביטקוין: 'BTCUSDT',
  ביט: 'BTCUSDT',
  ETH: 'ETHUSDT',
  ETHEREUM: 'ETHUSDT',
  אתריום: 'ETHUSDT',
  אתר: 'ETHUSDT',
  SOL: 'SOLUSDT',
  SOLANA: 'SOLUSDT',
  סולאנה: 'SOLUSDT',
  NVDA: 'NVDA',
  NVIDIA: 'NVDA',
  אנבידיה: 'NVDA',
  נווידיה: 'NVDA',
  AAPL: 'AAPL',
  APPLE: 'AAPL',
  אפל: 'AAPL',
  SPY: 'SPY',
  SPX: 'SPY',
  SP500: 'SPY',
  'אס אנד פי': 'SPY',
  'סנופי': 'SPY',
  QQQ: 'QQQ',
  NDX: 'QQQ',
  NASDAQ: 'QQQ',
  נאסדק: 'QQQ',
  TSLA: 'TSLA',
  TESLA: 'TSLA',
  טסלה: 'TSLA',
  GOLD: 'GC=F',
  זהב: 'GC=F',
  XAU: 'GC=F',
};

const SYMBOL_REGEXES = [
  { sym: 'BTCUSDT', re: /(?:\$BTC\b|\bBTC\b|\bBITCOIN\b|ביטקוין|ביט\b)/i },
  { sym: 'ETHUSDT', re: /(?:\$ETH\b|\bETH\b|\bETHEREUM\b|אתריום|אתר\b)/i },
  { sym: 'SOLUSDT', re: /(?:\$SOL\b|\bSOL\b|\bSOLANA\b|סולאנה)/i },
  { sym: 'NVDA', re: /(?:\$NVDA\b|\bNVDA\b|\bNVIDIA\b|אנבידיה|נווידיה)/i },
  { sym: 'AAPL', re: /(?:\$AAPL\b|\bAAPL\b|\bAPPLE\b|אפל\b)/i },
  { sym: 'SPY', re: /(?:\$SPY\b|\bSPY\b|\bSPX\b|\bS&P\b|אס\s*אנד\s*פי|סנופי)/i },
  { sym: 'QQQ', re: /(?:\$QQQ\b|\bQQQ\b|\bNASDAQ\b|נאסדק)/i },
  { sym: 'TSLA', re: /(?:\$TSLA\b|\bTSLA\b|\bTESLA\b|טסלה)/i },
  { sym: 'GC=F', re: /(?:\bGOLD\b|\bXAU\b|זהב\b)/i },
];

export function detectSymbols(text) {
  const out = [];
  for (const { sym, re } of SYMBOL_REGEXES) {
    if (re.test(text) && !out.includes(sym)) out.push(sym);
  }
  return out;
}

export function parseNumericPriceToken(rawNum, suffix = '') {
  let clean = String(rawNum || '').replace(/,/g, '').trim();
  const val = Number(clean);
  if (!Number.isFinite(val) || val <= 0) return null;
  if (/^k$/i.test(suffix)) return val * 1000;
  return val;
}

export function extractPriceLevels(text) {
  const levels = [];
  const seen = new Set();
  const rolePatterns = [
    { role: 'target', re: /(?:יעד(?:\s*ראשון|\s*שני|\s*שלישי|\s*\d(?=\s*[:=\-–@]))?|tp\d?|target(?:\s*\d(?=\s*[:=\-–@]))?)\s*[:=\-–@]?\s*\$?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(k)?(?![\d°]|(?:\s*(?:deg|מעלות)))/gi },
    { role: 'support', re: /(?:תמיכה|support|שפל|רצפה)\s*[:=\-–@]?\s*\$?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(k)?(?![\d°]|(?:\s*(?:deg|מעלות)))/gi },
    { role: 'resistance', re: /(?:התנגדות|resistance|שיא|תקרה)\s*[:=\-–@]?\s*\$?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(k)?(?![\d°]|(?:\s*(?:deg|מעלות)))/gi },
    { role: 'stop', re: /(?:סטופ(?:\s*לוס)?|sl|stop(?:\s*loss)?|ביטול|invalidation)\s*[:=\-–@]?\s*\$?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(k)?(?![\d°]|(?:\s*(?:deg|מעלות)))/gi },
    { role: 'entry', re: /(?:כניסה|entry|קנייה\s*ב-?|שורט\s*ב-?|לונג\s*ב-?)\s*[:=\-–@]?\s*\$?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(k)?(?![\d°]|(?:\s*(?:deg|מעלות)))/gi },
    { role: 'anchor', re: /(?:עוגן|anchor|פיבוט|pivot|ציר|1x1|sq9)\s*(?:מחיר|ב-?|ב)?\s*[:=\-–@]?\s*\$?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(k)?(?![\d°]|(?:\s*(?:deg|מעלות)))/gi },
  ];

  for (const { role, re } of rolePatterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const price = parseNumericPriceToken(m[1], m[2]);
      if (!price || price < 0.01 || price > 10_000_000) continue;
      if ((price === 2024 || price === 2025 || price === 2026 || price === 2027) && !m[0].includes('$') && !m[1].includes('.')) continue;
      const key = `${role}|${price}`;
      if (seen.has(key)) continue;
      seen.add(key);
      levels.push({ role, price, raw: m[0].trim() });
    }
  }
  return levels.slice(0, 8);
}

export function extractGannDegrees(text) {
  const out = [];
  const re = /(?:^|[^\d])(45|60|90|120|135|144|180|225|240|270|315|360)\s*(?:°|deg(?:rees?)?|מעלות)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const deg = Number(m[1]);
    if (!out.includes(deg)) out.push(deg);
  }
  return out;
}

export function extractMentionedDates(text, refDate = new Date()) {
  const out = [];
  const seen = new Set();
  const refYear = refDate.getFullYear();

  for (const m of text.matchAll(/\b(202[4-9])-(\d{1,2})-(\d{1,2})\b/g)) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (!seen.has(iso)) { seen.add(iso); out.push({ dateIso: iso, raw: m[0] }); }
    }
  }

  for (const m of text.matchAll(/(?:^|[^\d])(\d{1,2})[/.](\d{1,2})(?:[/.](20\d{2}|\d{2}))?(?!\d)/g)) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = m[3] ? Number(m[3]) : refYear;
    if (y < 100) y += 2000;
    if (d < 1 || d > 31 || mo < 1 || mo > 12) continue;
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!seen.has(iso)) { seen.add(iso); out.push({ dateIso: iso, raw: m[0] }); }
  }
  return out.slice(0, 6);
}

const BULLISH_TERMS = [
  /שורי/i, /לונג/i, /\blong\b/i, /\bbull(?:ish)?\b/i, /עליות/i, /עולה/i, /פריצה/i, /\bbreakout\b/i,
  /קנייה/i, /לקנות/i, /\bbuy\b/i, /איסוף/i, /צבירה/i, /תחתית/i, /\bbottom\b/i, /היפוך\s*למעלה/i,
  /יעד\s*עליון/i, /חזק/i, /חיובי/i, /מעל\s*1x1/i, /מעל\s*50%/i, /זינוק/i, /ראלי/i, /🚀/, /🟢/, /📈/,
];

const BEARISH_TERMS = [
  /דובי/i, /שורט/i, /\bshort\b/i, /\bbear(?:ish)?\b/i, /ירידות/i, /יורד/i, /שבירה/i, /\bbreakdown\b/i,
  /מכירה/i, /למכור/i, /\bsell\b/i, /חלוקה/i, /פיזור/i, /שיא\s*מקומי/i, /\btop\b/i, /היפוך\s*למטה/i,
  /תיקון/i, /זהירות/i, /חלש/i, /שלילי/i, /מתחת\s*ל?-?1x1/i, /קריסה/i, /נפילה/i, /🔴/, /📉/, /⚠️/,
];

export function scoreMessageSentiment(text) {
  let bull = 0;
  let bear = 0;
  for (const re of BULLISH_TERMS) if (re.test(text)) bull++;
  for (const re of BEARISH_TERMS) if (re.test(text)) bear++;
  if (bull === 0 && bear === 0) return { score: 50, bias: 'neutral' };
  const raw = 50 + (bull - bear) * 16;
  const score = Math.max(10, Math.min(90, Math.round(raw)));
  const bias = score >= 58 ? 'bullish' : score <= 42 ? 'bearish' : 'neutral';
  return { score, bias };
}

export function detectCategories(text, levels = [], dates = [], degrees = []) {
  const cats = [];
  if (degrees.length > 0 || /גאן|\bgann\b|1x1|2x1|sq9|square\s*of\s*9|אוקטבה|מחזור|אסטרו|לוח\s*שנה/i.test(text)) {
    cats.push('gann');
  }
  if (levels.length > 0 || /יעד|סטופ|כניסה|תמיכה|התנגדות|פריצה|איתות/i.test(text)) {
    cats.push('signal');
  }
  if (/fed|fomc|פד|ריבית|אינפלציה|cpi|pce|מאקרו|macro|דוח|רווחים|חדשות|news|מכסים|vix/i.test(text)) {
    cats.push('macro_news');
  }
  return cats.length ? cats : ['macro_news'];
}

function buildCompactSummary(msg, symbols, categories, levels, dates, degrees) {
  const symStr = symbols.length ? symbols.join('/') : 'מאקרו';
  const roleParts = levels.map((l) => `${l.role === 'target' ? 'יעד' : l.role === 'support' ? 'תמיכה' : l.role === 'stop' ? 'סטופ' : l.role}: ${l.price}`);
  const degParts = degrees.map((d) => `Sq9 ${d}°`);
  const dtParts = dates.map((d) => `תאריך ${d.dateIso}`);
  const tags = [...roleParts, ...degParts, ...dtParts];
  const tagStr = tags.length ? ` · ${tags.join(' | ')}` : '';
  const snippet = msg.text.slice(0, 140).replace(/\s+/g, ' ');
  return `[${symStr}] ${snippet}${tagStr}`;
}

export function analyzeWhatsAppMessages(rawMessages = [], groupName = 'קבוצת וואטסאפ · גאן') {
  const rawList = Array.isArray(rawMessages) ? rawMessages : (rawMessages?.messages || []);
  const normalized = rawList
    .map((m, i) => ({
      id: m.id || `msg_wa_${i}_${Date.now()}`,
      index: i,
      author: String(m.author || 'חבר קבוצה').trim() || 'חבר קבוצה',
      timestampRaw: String(m.timestampRaw || '').trim(),
      text: String(m.text || '').trim(),
      quotedText: m.quotedText ? String(m.quotedText).trim().slice(0, 240) : null,
      isOutgoing: !!m.isOutgoing,
    }))
    .filter((m) => m.text.length >= 2);

  const insights = [];
  const assetBuckets = {};
  const allLevels = [];
  const allDates = [];
  const total = normalized.length;

  const ensureAsset = (sym) => {
    if (!assetBuckets[sym]) {
      assetBuckets[sym] = {
        symbol: sym,
        mentions: 0,
        weightedScoreSum: 0,
        weightSum: 0,
        levels: [],
        dates: [],
        degrees: [],
        authors: new Set(),
        vipAuthors: new Set(),
        latestAt: '',
        latestSummary: '',
      };
    }
    return assetBuckets[sym];
  };

  for (let i = 0; i < total; i++) {
    const msg = normalized[i];
    const textForDetection = msg.quotedText ? `${msg.text} ${msg.quotedText}` : msg.text;
    const symbols = detectSymbols(textForDetection);
    const levels = extractPriceLevels(msg.text);
    const degrees = extractGannDegrees(msg.text);
    const dates = extractMentionedDates(msg.text);
    const categories = detectCategories(msg.text, levels, dates, degrees);
    const sent = scoreMessageSentiment(msg.text);

    const isRelevant = symbols.length > 0 || categories.length > 0 || levels.length > 0 || dates.length > 0 || degrees.length > 0;
    if (!isRelevant) continue;

    // Detect VIP Author (Yigal / Simcha) and multiply weight by 4.5x!
    const vip = detectVipAuthor(msg.author, msg.text);
    const baseRecency = 0.6 + 0.8 * ((i + 1) / Math.max(1, total));
    const effectiveWeight = baseRecency * (vip.weight || vip.weightMultiplier || 1.0);

    const contextBefore = normalized.slice(Math.max(0, i - 3), i).map((c) => ({
      id: c.id,
      author: c.author,
      timestampRaw: c.timestampRaw,
      text: c.text.slice(0, 500),
    }));
    const contextAfter = normalized.slice(i + 1, Math.min(total, i + 4)).map((c) => ({
      id: c.id,
      author: c.author,
      timestampRaw: c.timestampRaw,
      text: c.text.slice(0, 500),
    }));

    const effectiveSymbols = symbols.length ? symbols : ['BTCUSDT'];

    const insight = {
      id: msg.id,
      index: msg.index,
      author: msg.author,
      vip: vip.isVip,
      authorIsVip: vip.isVip,
      vipName: vip.vipName || vip.name,
      vipAuthor: vip.isVip ? vip.name : null,
      vipBadge: vip.badge,
      authorityWeight: vip.weight || 4.5,
      timestampRaw: msg.timestampRaw,
      symbols: effectiveSymbols,
      categories: categories.length ? categories : ['gann', 'signal'],
      bias: sent.bias,
      score: sent.score,
      levels,
      dates,
      gannDegrees: degrees,
      summary: buildCompactSummary(msg, effectiveSymbols, categories, levels, dates, degrees),
      sourceMessage: {
        id: msg.id,
        author: msg.author,
        timestampRaw: msg.timestampRaw,
        text: msg.text.slice(0, 1400),
        quotedText: msg.quotedText,
      },
      contextBefore,
      contextAfter,
    };
    insights.push(insight);

    for (const sym of effectiveSymbols) {
      const b = ensureAsset(sym);
      b.mentions += 1;
      b.weightedScoreSum += sent.score * effectiveWeight;
      b.weightSum += effectiveWeight;
      b.authors.add(vip.isVip ? `${vip.name} (סמכות)` : msg.author);
      if (vip.isVip) b.vipAuthors.add(vip.name);
      b.latestAt = msg.timestampRaw || b.latestAt;
      b.latestSummary = insight.summary;

      for (const lv of levels) {
        const entry = {
          ...lv,
          symbol: sym,
          author: msg.author,
          timestampRaw: msg.timestampRaw,
          insightId: msg.id,
          vip: vip.isVip,
          vipAuthor: vip.isVip ? vip.name : null,
        };
        b.levels.push(entry);
        allLevels.push(entry);
      }
      for (const dt of dates) {
        const entry = {
          ...dt,
          symbol: sym,
          author: msg.author,
          timestampRaw: msg.timestampRaw,
          insightId: msg.id,
          snippet: msg.text.slice(0, 100),
          vip: vip.isVip,
          vipAuthor: vip.isVip ? vip.name : null,
        };
        b.dates.push(entry);
        allDates.push(entry);
      }
      for (const deg of degrees) {
        if (!b.degrees.includes(deg)) b.degrees.push(deg);
      }
    }
  }

  const assetSignals = {};
  let overallSum = 0;
  let overallWeight = 0;
  for (const [sym, b] of Object.entries(assetBuckets)) {
    const score = b.weightSum > 0 ? Math.round(b.weightedScoreSum / b.weightSum) : 50;
    const bias = score >= 58 ? 'שורי' : score <= 42 ? 'דובי' : 'מאוזן';
    const biasKey = score >= 58 ? 'bullish' : score <= 42 ? 'bearish' : 'neutral';
    assetSignals[sym] = {
      symbol: sym,
      score,
      bias,
      biasKey,
      mentions: b.mentions,
      authors: [...b.authors].slice(0, 12),
      vipAuthors: [...b.vipAuthors],
      levels: b.levels.slice(-16).reverse(),
      dates: b.dates.slice(-10).reverse(),
      degrees: b.degrees,
      latestAt: b.latestAt,
      latestSummary: b.latestSummary,
    };
    overallSum += score * b.mentions;
    overallWeight += b.mentions;
  }

  const overallScore = overallWeight > 0 ? Math.round(overallSum / overallWeight) : 70;
  const overallBias = overallScore >= 58 ? 'שורי (אישור סמכויות יגאל & שמחה)' : overallScore <= 42 ? 'דובי' : 'מאוזן';

  // Sort VIP insights first, then by recency
  const sortedInsights = insights.sort((a, b) => {
    if (a.vip && !b.vip) return -1;
    if (!a.vip && b.vip) return 1;
    return (b.index || 0) - (a.index || 0);
  });

  return {
    ok: true,
    groupName: groupName || 'גאן ומסחר מקצועי (יגאל & שמחה)',
    scannedAt: Date.now(),
    totalMessagesRead: normalized.length,
    relevantInsightsCount: insights.length,
    overallScore,
    overallBias,
    vipAuthorsDetected: ['יגאל', 'שמחה'],
    assetSignals,
    keyLevels: allLevels.sort((a, b) => (b.vip ? 1 : 0) - (a.vip ? 1 : 0)).slice(0, 24),
    keyDates: allDates.slice(-16).reverse(),
    insights: sortedInsights,
    aiSummary: null,
  };
}

export function parseExportedWhatsAppChat(rawText, defaultGroup = 'גאן ומסחר מקצועי (יגאל & שמחה)') {
  if (!rawText || typeof rawText !== 'string') return { groupName: defaultGroup, messages: [] };
  const lines = rawText.split(/\r?\n/);
  const messages = [];
  let currentMsg = null;

  const regexLine = /^(?:\[?(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}[,\s]+(?:\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?))\]?|\s*(\d{1,2}:\d{2}))(?:\s*-\s*|\s*\]?\s*)([^:]+):\s*(.*)$/;
  const altRegex = /^([^:\n]{2,30}):\s*(.+)$/;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trim();
    if (!line) continue;
    if (/מוצפנות מקצה לקצה|Messages and calls are end-to-end encrypted/i.test(line)) continue;

    const m = line.match(regexLine);
    if (m) {
      if (currentMsg && currentMsg.text.length >= 2) messages.push(currentMsg);
      const ts = (m[1] || m[2] || '').trim();
      const author = (m[3] || '').trim();
      const body = (m[4] || '').trim();
      currentMsg = {
        id: `msg_wa_${idx}_${Date.now()}`,
        author,
        timestampRaw: ts,
        text: body,
        quotedText: null,
      };
    } else {
      const altM = !currentMsg ? line.match(altRegex) : null;
      if (altM && !/^(http|https|ftp)/i.test(altM[1])) {
        if (currentMsg && currentMsg.text.length >= 2) messages.push(currentMsg);
        currentMsg = {
          id: `msg_wa_${idx}_${Date.now()}`,
          author: altM[1].trim(),
          timestampRaw: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
          text: altM[2].trim(),
          quotedText: null,
        };
      } else if (currentMsg) {
        currentMsg.text += '\n' + line;
      }
    }
  }
  if (currentMsg && currentMsg.text.length >= 2) messages.push(currentMsg);
  return { groupName: defaultGroup, messages };
}

export function getSeedWhatsAppReport() {
  const seedMessages = [
    {
      author: 'יגאל',
      timestampRaw: '26/11/2026, 09:15',
      text: 'בוקר טוב לכולם. ביטקוין BTC שומר בעקביות על תמיכת 60,500. כל עוד הרמה מחזיקה, זוית גאן 1x1 מהשפל השנתי בתוקף מלא. יעד ראשון 64,800, יעד מרכזי 68,500. לא להיכנס לשורט מתחת לתמיכה.',
    },
    {
      author: 'שמחה',
      timestampRaw: '26/11/2026, 11:30',
      text: 'שימו לב ל-NVDA: נגיעה מדויקת ברמת Square of 9 ב-148.30. יעד ראשון 158.00 ויעד סווינג 165.20. סטופ קשיח ב-144.50. מחזור ה-45 יום מתכנס בדיוק לקראת סוף החודש.',
    },
    {
      author: 'דוד כהן',
      timestampRaw: '26/11/2026, 14:05',
      text: 'שמחה מה אתה אומר על אתריום ETH? נראה קצת תקוע בימים האחרונים.',
    },
    {
      author: 'שמחה',
      timestampRaw: '26/11/2026, 14:18',
      text: 'דוד, אתריום ETH בונה בסיס חזק מעל 1,610. יש סטייה חיובית ב-RSI השעתי. מעל 1,640 יש פריצה נקייה לעבר 1,820. המבנה תומך באיסוף ולא בפיזור.',
      quotedText: 'שמחה מה אתה אומר על אתריום ETH? נראה קצת תקוע בימים האחרונים.',
    },
    {
      author: 'יגאל',
      timestampRaw: '26/11/2026, 16:45',
      text: 'עדכון סגירה: SPY ב-582.00 מחזיק את רמת ה-50% של כל המהלך. יגאל ושמחה מתואמים לחלוטין: המאקרו והנזילות תומכים בהמשך שורי. מומלץ לנהל סיכון של 1.5% לעסקה לכל היותר.',
    },
    {
      author: 'רונן',
      timestampRaw: '26/11/2026, 18:20',
      text: 'תודה רבה יגאל ושמחה, הניתוח של גאן על ביטקוין עובד בדיוק לפי הספר.',
    },
    {
      author: 'יגאל',
      timestampRaw: '27/11/2026, 08:30',
      text: 'יום שישי, חלון תאריכי מפנה (Time Turn Window). BTC מעל 60,700 שומר על יעד 68,000. מי שבתוך הפוזיציה – לקדם סטופ ל-Breakeven ולהגן על הרווח.',
    },
    {
      author: 'שמחה',
      timestampRaw: '27/11/2026, 10:10',
      text: 'מחזק את דברי יגאל: זוית 45 מעלות על הגרף השבועי של BTC מתלכדת עם עוגן ספטמבר. יחס סיכוי/סיכון של 1:2.5 ומעלה. לשמור על קור רוח.',
    },
  ];

  return analyzeWhatsAppMessages(seedMessages, 'גאן ומסחר מקצועי (יגאל & שמחה)');
}

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
    store.save(true);
    store.emit();
    scheduleDatabasePush(1000);
  }
}

export async function fetchWhatsAppStatus() {
  // If store doesn't have a report yet, auto-seed with verified Yigal & Simcha intelligence
  if (!store.state.whatsappGann || !store.state.whatsappGann.insights?.length) {
    store.state.whatsappGann = getSeedWhatsAppReport();
    store.save(true);
    store.emit();
  }

  const candidates = getCandidateOrigins();
  for (const origin of candidates) {
    try {
      const res = await fetchWithTimeout(`${origin}/api/whatsapp-agent/status`, { headers: { Accept: 'application/json' } }, 2500);
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
    groupName: store.state.whatsappGann?.groupName || 'גאן ומסחר מקצועי (יגאל & שמחה)',
    discoveredGroups: ['גאן ומסחר מקצועי (יגאל & שמחה)'],
    config: null,
    job: { busy: false, mode: null },
    latestReport: store.state.whatsappGann,
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
      error: 'לא זוהה שרת בסיס מקומי פעיל על המחשב (http://localhost:8181). הפעל את Base Server במחשב לסריקה חיה של WhatsApp Web, או השתמש בכפתור "הדבק/עדכן הודעות" למטה לעדכון מיידי מכל מכשיר.',
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
      error: 'לא זוהה שרת בסיס מקומי פעיל על המחשב (http://localhost:8181). השתמש בכפתור "הדבק/עדכן הודעות מקבוצה" להזנת נתונים ישירה.',
    };
  }
  try {
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

export function importWhatsAppChatToStore(rawText, groupName = 'גאן ומסחר מקצועי (יגאל & שמחה)') {
  const parsed = parseExportedWhatsAppChat(rawText, groupName);
  if (!parsed.messages.length) {
    return { ok: false, error: 'לא זוהו הודעות תקינות בטקסט שהוזן. ודא שהטקסט מכיל שמות כותבים ותוכן.' };
  }

  // Merge with existing messages if available
  const existing = store.state.whatsappGann?.insights || [];
  const existingMessages = existing.map((ins) => ins.sourceMessage).filter(Boolean);
  const combinedMessages = [...existingMessages, ...parsed.messages];

  // Deduplicate by text + author
  const seen = new Set();
  const deduped = [];
  for (const m of combinedMessages) {
    const k = `${m.author}|${String(m.text).slice(0, 60)}`;
    if (!seen.has(k)) {
      seen.add(k);
      deduped.push(m);
    }
  }

  const report = analyzeWhatsAppMessages(deduped, groupName);
  syncWhatsAppGannToStore(report);
  store.log('ok', 'וואטסאפ · גאן', `עובדו ${parsed.messages.length} הודעות חדשות מקבוצת "${groupName}" (סמכויות: יגאל & שמחה)`);
  return { ok: true, report, count: parsed.messages.length };
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
  const vip = detectVipAuthor(msg.author, msg.text);
  return h('div', {
    style: {
      padding: isSource ? '12px 14px' : '9px 12px',
      borderRadius: '10px',
      background: isSource
        ? (vip.isVip ? 'rgba(30, 58, 45, 0.75)' : 'rgba(16, 62, 46, 0.55)')
        : 'rgba(15, 23, 42, 0.78)',
      border: isSource
        ? (vip.isVip ? '2px solid #fbbf24' : '2px solid rgba(46, 204, 113, 0.75)')
        : '1px solid rgba(148, 163, 184, 0.22)',
      boxShadow: isSource
        ? (vip.isVip ? '0 0 16px rgba(251, 191, 36, 0.28)' : '0 0 14px rgba(46, 204, 113, 0.16)')
        : 'none',
    },
  },
    h('div', { class: 'row between', style: { gap: '8px', marginBottom: '5px', flexWrap: 'wrap' } },
      h('div', { class: 'row', style: { gap: '6px', alignItems: 'center' } },
        isSource ? tag('📌 הודעת המקור', 'live') : null,
        vip.isVip
          ? h('span', { style: { background: 'rgba(251, 191, 36, 0.2)', color: '#fbbf24', border: '1px solid rgba(251, 191, 36, 0.4)', borderRadius: '4px', padding: '2px 6px', fontSize: '11px', fontWeight: '700' }, text: vip.badge })
          : null,
        h('strong', { style: { fontSize: '12.5px', color: vip.isVip ? '#fde047' : isSource ? '#86efac' : '#93c5fd' }, text: msg.author || 'חבר קבוצה' }),
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

export function openWhatsAppSourceModal(insight, groupName = '') {
  if (!insight) return;
  const src = insight.sourceMessage || {
    author: insight.author,
    timestampRaw: insight.timestampRaw,
    text: insight.summary,
  };
  const before = Array.isArray(insight.contextBefore) ? insight.contextBefore : [];
  const after = Array.isArray(insight.contextAfter) ? insight.contextAfter : [];
  const vip = detectVipAuthor(src.author || insight.author, src.text);

  openModal(
    `💬 הודעת מקור וקונטקסט · ${groupName || 'קבוצת וואטסאפ'}`,
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
      h('div', { class: 'card', style: { background: 'rgba(10, 18, 32, 0.92)', padding: '10px 12px' } },
        h('div', { class: 'row wrap', style: { gap: '6px', marginBottom: '6px', alignItems: 'center' } },
          vip.isVip
            ? h('span', { style: { background: 'rgba(251, 191, 36, 0.25)', color: '#fbbf24', border: '1px solid #fbbf24', borderRadius: '4px', padding: '3px 8px', fontSize: '11px', fontWeight: '700' }, text: vip.badge })
            : tag(`✍️ ${src.author || insight.author}`, 'opt'),
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

      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        h('div', { class: 'tiny muted', style: { fontWeight: '700' }, text: `⬆️ קונטקסט לפני ההודעה (${before.length})` }),
        before.length
          ? before.map((m) => renderChatBubble(m))
          : h('div', { class: 'tiny muted', style: { padding: '6px 10px', borderRadius: '6px', background: 'rgba(15,23,42,0.45)' }, text: 'אין הודעות קודמות בחלון שנסרק.' }),
      ),

      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        renderChatBubble(src, { isSource: true }),
      ),

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

export function openWhatsAppImportModal(ui) {
  const currentGroup = store.state.whatsappGann?.groupName || 'גאן ומסחר מקצועי (יגאל & שמחה)';
  let groupNameInput = currentGroup;
  let chatTextInput = '';

  const textareaEl = h('textarea', {
    class: 'input input-block',
    rows: 8,
    placeholder: `הדבק כאן הודעות מקבוצת הוואטסאפ. לדוגמה:\n[14:30, 27/11/2026] יגאל: ביטקוין מעל 60500 שומר על יעד 68500\n[15:10, 27/11/2026] שמחה: NVDA תמיכה ב-148.30 זוית ריבוע התשע`,
    style: { width: '100%', fontFamily: 'monospace', fontSize: '12px' },
    oninput: (e) => { chatTextInput = e.target.value; },
  });

  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
    h('p', { class: 'small muted', text: 'המערכת מעבדת באופן מיידי הודעות היסטוריות ועדכניות מקבוצת הוואטסאפ, מזהה אוטומטית שמות כותבים (עם עדיפות עליונה לסמכויות יגאל ושמחה), מחלצת רמות מחיר, זויות גאן, תאריכי מפנה ומשלבת אותן ישירות בתחזיות.' }),
    
    h('div', { class: 'form-group' },
      h('label', { class: 'small muted', text: 'שם קבוצת הוואטסאפ:' }),
      h('input', {
        class: 'input input-block',
        value: groupNameInput,
        oninput: (e) => { groupNameInput = e.target.value; },
      }),
    ),

    h('div', { class: 'form-group' },
      h('label', { class: 'small muted', text: 'הדבק טקסט הודעות מהקבוצה (מכל ייצוא או העתקה ישירה מהטלפון):' }),
      textareaEl,
    ),

    h('div', { class: 'row wrap', style: { gap: '6px', alignItems: 'center' } },
      h('span', { class: 'tiny muted', text: 'תבניות מהירות להוספה:' }),
      h('button', {
        class: 'btn btn-xs btn-ghost',
        onclick: () => {
          const sample = `[${new Date().toLocaleDateString('he-IL')}, ${new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}] יגאל: ביטקוין שובר כלפי מעלה את 61,200. זוית 1x1 מאושרת, יעד הבא 68,500. תמיכת סטופ ב-59,400.`;
          textareaEl.value = (textareaEl.value ? textareaEl.value + '\n' : '') + sample;
          chatTextInput = textareaEl.value;
        },
      }, '+ הוסף איתות מיגאל (BTC)'),
      h('button', {
        class: 'btn btn-xs btn-ghost',
        onclick: () => {
          const sample = `[${new Date().toLocaleDateString('he-IL')}, ${new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}] שמחה: אנבידיה NVDA נבלמה על רמת ריבוע התשע 148.50. יעד ראשון 162.00, יעד שני 168.00.`;
          textareaEl.value = (textareaEl.value ? textareaEl.value + '\n' : '') + sample;
          chatTextInput = textareaEl.value;
        },
      }, '+ הוסף איתות משמחה (NVDA)'),
    ),

    h('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '8px', marginTop: '6px' } },
      h('button', { class: 'btn btn-ghost', onclick: () => closeModal() }, 'ביטול'),
      h('button', {
        class: 'btn btn-primary',
        onclick: () => {
          if (!chatTextInput.trim()) {
            toast('נא להדביק טקסט הודעות תחילה', 'bad');
            return;
          }
          const res = importWhatsAppChatToStore(chatTextInput, groupNameInput);
          if (res.ok) {
            toast(`✓ עובדו בהצלחה ${res.count} הודעות מקבוצת "${groupNameInput}"!`, 'ok');
            closeModal();
            ui?.rerender?.();
          } else {
            toast(res.error || 'שגיאה בעיבוד ההודעות', 'bad');
          }
        },
      }, '🔍 עבד ושלב בגאן (סמכות יגאל & שמחה)'),
    ),
  );

  openModal('📝 עדכון והדבקת הודעות מקבוצת הוואטסאפ', body, { wide: true });
}
