// Yonatan ("יונתן" · yt_strategy_scout) — Autonomous YouTube Gann & Strategy Research Agent.
//
// Continuously scans real YouTube creators & searches across two tracks:
//  1. W.D. Gann / Michael Jenkins / Gannzilla videos -> extracts Gann module improvements & feeds gannLibrary.
//  2. Proven strategy creators (explicitly including Doug & Silvia Rumer, TradingLab, BACKTEST THE HYPE,
//     plus user-added creators) -> turns videos into executable Strategy Blueprints and spawns DEDICATED
//     BOT DESKS that iterate through Backtest -> Walk-Forward OOS -> Amir Truth Audit -> Dry-Run -> Live Paper Deployment.

import { store } from './store.js';
import { STRATEGIES } from './strategies.js';
import { scheduleDatabasePush } from './db.js';
import { chatDetailed } from './llm.js';

const AUTO_SCAN_COOLDOWN_MS = 45 * 60_000; // Auto-refresh at most every 45 min in background loop

export const DEFAULT_TRACKED_CREATORS = [
  { name: 'Silvia & Doug (Doug & Silvia Rumer)', query: 'Doug and Silvia Rumer trading strategy', track: 'creator', focus: 'Price Action, מבנה מגמה, משיכות וניהול סיכונים' },
  { name: 'Wd Gann Trader', query: 'W.D. Gann Square of 9 trading strategy', track: 'gann', focus: 'ריבוע התשע (Sq9), זוויות תמיכה/התנגדות ומחזורי זמן' },
  { name: 'Michael Jenkins (Gann)', query: 'Michael Jenkins Gann square of 9 time cycles', track: 'gann', focus: 'איחוד זמן-מחיר, שורש ריבועי ומחזורי היפוך' },
  { name: 'BACKTEST THE HYPE', query: 'BACKTEST THE HYPE trading strategy', track: 'creator', focus: 'בדיקות בקטסט כמותיות על אסטרטגיות ויראליות' },
  { name: 'TradingLab', query: 'TradingLab tested 100 times trading strategy', track: 'creator', focus: 'בדיקת 100 עסקאות, Supertrend/EMA/Breakout ו-R:R' },
];

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'strat';
}

function setYonatan(patch) {
  const agent = (store.state.agents || []).find((a) => a.id === 'yt_strategy_scout');
  if (!agent) return;
  Object.assign(agent, patch, { lastActive: Date.now() });
}

function detectTargetSymbol(text) {
  const s = String(text || '');
  if (/\bnvda\b|\bnvidia\b/i.test(s)) return 'NVDA';
  if (/\baapl\b|\bapple\b/i.test(s)) return 'AAPL';
  if (/\bspy\b|\bs&p\s*500\b|\bspx\b|\bes\b/i.test(s)) return 'SPY';
  if (/\bqqq\b|\bnasdaq\b|\bnq\b/i.test(s)) return 'QQQ';
  if (/\beth\b|\bethereum\b/i.test(s)) return 'ETHUSDT';
  if (/\bsol\b|\bsolana\b/i.test(s)) return 'SOLUSDT';
  if (/\bgold\b|\bxau\b/i.test(s)) return 'XAUUSD';
  if (/\btsla\b|\btesla\b/i.test(s)) return 'TSLA';
  return 'BTCUSDT';
}

function detectTargetTf(text, isGann) {
  const s = String(text || '');
  if (/\b5m\b|\b5\s*min|scalp/i.test(s)) return '5m';
  if (/\b15m\b|\b15\s*min/i.test(s)) return '15m';
  if (/\b1h\b|\bhourly|intraday|day\s*trad/i.test(s)) return '1h';
  if (/\bweekly\b|\b1w\b/i.test(s)) return '1w';
  if (isGann || /\bswing\b|\bdaily\b|\bcycle\b|\bportfolio\b/i.test(s)) return '1d';
  return '1h';
}

function detectStrategyFamily(video) {
  const blob = `${video.title || ''} ${video.snippet || ''} ${video.channel || ''} ${video.queryTag || ''}`;
  const isDougSilvia = /silvia|sylvia|rumer|doug/i.test(blob);
  const isGann = video.track === 'gann' || /\bgann\b|square\s*of\s*9|\bsq9\b|jenkins|gannzilla/i.test(blob);

  if (isGann) {
    if (/cycle|time\s*and\s*price|jenkins|date|astro|planet|seasonal/i.test(blob)) {
      return {
        strategyId: 'gann_time_cycle',
        isGann: true,
        techniqueHe: 'מחזורי זמן גאן ואיחוד זמן-מחיר (Jenkins / Time Cycles)',
        gannUpgrade: 'שילוב תזמון מחזורי זמן עם אישור מומנטום בחלונות היפוך (גאן + בקטסט)',
      };
    }
    return {
      strategyId: 'gann_swing_sq9',
      isGann: true,
      techniqueHe: 'גאן סווינג + Square of 9 וזוויות 1x1',
      gannUpgrade: 'דיוק רמות תמיכה/התנגדות Sq9 (45°/90°/180°) עם שבירת סווינג וסטופ מובנה',
    };
  }

  if (isDougSilvia || /pullback|structure|price\s*action|copying\s*my\s*trades|simple\s*trading\s*strategy|grow\s*your\s*portfolio/i.test(blob)) {
    return {
      strategyId: 'structure_pullback',
      isGann: false,
      techniqueHe: isDougSilvia
        ? 'אסטרטגיית מבנה מחיר ומשיכה למגמה (Doug & Silvia Rumer Style)'
        : 'משיכה למבנה מגמה + אישור נר (Price Action Pullback)',
      gannUpgrade: null,
    };
  }

  if (/supertrend|adx/i.test(blob)) {
    return { strategyId: 'supertrend_adx', isGann: false, techniqueHe: 'מעקב מגמה Supertrend + פילטר ADX', gannUpgrade: null };
  }
  if (/breakout|donchian|channel|turtle|opening\s*range/i.test(blob)) {
    return { strategyId: 'breakout', isGann: false, techniqueHe: 'פריצת ערוץ / טווח (Breakout)', gannUpgrade: null };
  }
  if (/volatility|atr|squeeze/i.test(blob)) {
    return { strategyId: 'vol_breakout', isGann: false, techniqueHe: 'פריצת תנודתיות ATR + Efficiency Ratio', gannUpgrade: null };
  }
  if (/z-?score|bollinger|mean\s*reversion/i.test(blob)) {
    return { strategyId: 'mean_reversion_z', isGann: false, techniqueHe: 'חזרה לממוצע סטטיסטית (Z-Score / Bollinger)', gannUpgrade: null };
  }
  if (/rsi|oversold|overbought|divergence/i.test(blob)) {
    return { strategyId: 'rsi_reversion', isGann: false, techniqueHe: 'היפוך RSI מקיצוניות עם אישור Hook', gannUpgrade: null };
  }
  if (/macd/i.test(blob)) {
    return { strategyId: 'macd_swing', isGann: false, techniqueHe: 'מומנטום סווינג MACD + פילטר מגמה', gannUpgrade: null };
  }
  if (/ema|moving\s*average|crossover/i.test(blob)) {
    return { strategyId: 'ema_trend', isGann: false, techniqueHe: 'חציית ממוצעים נעים EMA + פילטר מגמה', gannUpgrade: null };
  }
  return { strategyId: 'structure_pullback', isGann: false, techniqueHe: 'אסטרטגיית מבנה ומגמה (Price Action)', gannUpgrade: null };
}

export function classifyYouTubeVideosToBlueprints(videos = []) {
  const blueprints = [];
  const gannUpgrades = [];
  const seenBpKeys = new Set();

  for (const v of videos) {
    if (!v?.title || !v?.url) continue;
    const cls = detectStrategyFamily(v);
    const symbol = detectTargetSymbol(`${v.title} ${v.snippet}`);
    const tf = detectTargetTf(`${v.title} ${v.snippet}`, cls.isGann);
    const channel = v.channel || v.queryTag || 'YouTube Creator';
    const bpKey = `${slugify(channel)}_${cls.strategyId}_${symbol}`;

    if (cls.isGann && cls.gannUpgrade) {
      gannUpgrades.push({
        id: `yt_gann_${v.videoId || slugify(v.title)}`,
        title: v.title,
        channel,
        url: v.url,
        views: v.views || '',
        duration: v.duration || '',
        published: v.published || '',
        upgradeNote: cls.gannUpgrade,
        strategyId: cls.strategyId,
        appliedToModule: cls.strategyId === 'gann_swing_sq9'
          ? 'משולב במנוע gann_swing_sq9 + מחשבון Sq9 במעבדת #/gann'
          : 'משולב במנוע gann_time_cycle + חלונות זמן עתידיים ב-#/gann',
      });
    }

    if (seenBpKeys.has(bpKey)) continue;
    seenBpKeys.add(bpKey);

    const deskId = `yt_bot_${bpKey}`.slice(0, 44);
    const isDougSilvia = /silvia|sylvia|rumer|doug/i.test(`${channel} ${v.title} ${v.queryTag}`);
    const botLabel = isDougSilvia
      ? `בוט ייעודי · Doug & Silvia (${symbol} ${tf})`
      : cls.isGann
        ? `בוט ייעודי · גאן ${channel.slice(0, 16)} (${symbol} ${tf})`
        : `בוט ייעודי · ${channel.slice(0, 18)} (${symbol} ${tf})`;

    blueprints.push({
      id: deskId,
      deskId,
      label: botLabel,
      creator: channel,
      videoId: v.videoId || '',
      videoTitle: v.title,
      videoUrl: v.url,
      views: v.views || '',
      duration: v.duration || '',
      published: v.published || '',
      snippet: v.snippet || '',
      track: cls.isGann ? 'gann' : 'creator',
      priority: isDougSilvia ? 100 : cls.isGann ? 90 : 75,
      strategyId: STRATEGIES[cls.strategyId] ? cls.strategyId : 'structure_pullback',
      techniqueHe: cls.techniqueHe,
      symbol,
      tf,
      kind: (tf === '1d' || tf === '1w') ? 'swing' : 'intraday',
      discoveredAt: Date.now(),
    });
  }

  blueprints.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  return {
    blueprints: blueprints.slice(0, 18),
    gannUpgrades: gannUpgrades.slice(0, 14),
  };
}

export function getDedicatedBotStage(desk) {
  if (!desk) {
    return { step: 1, key: 'discovered', label: '🔍 גילוי ביוטיוב (ממתין לבוט)', tone: 'dry' };
  }
  if (desk.status === 'live') {
    return { step: 4, key: 'live', label: '🟢 מיושם בתיק הנייר החי', tone: 'live' };
  }
  if (desk.status === 'dry-run') {
    return { step: 3, key: 'dry-run', label: `🧪 הוכחת רווחיות · Dry-Run (${desk.dryRunCycles || 0}/3)`, tone: 'live' };
  }
  if (desk.lastAudit?.vetoed) {
    return { step: 2, key: 'vetoed', label: '⚖️ בבדיקה · אמיר דרש שיפור', tone: 'red' };
  }
  if (desk.metrics) {
    return { step: 2, key: 'optimizing', label: '⚙️ בוט ייעודי באופטימיזציה', tone: 'opt' };
  }
  return { step: 2, key: 'research', label: '⚙️ בוט נוצר · ממתין לבקטסט', tone: 'opt' };
}

async function fetchYouTubeScoutRaw(customQueries = []) {
  const qParam = customQueries.filter(Boolean).join('|');
  // 1. Node runner / local server direct import path
  if (typeof window === 'undefined') {
    const { handleMarketRequest } = await import('../netlify/functions/market.mjs');
    return await handleMarketRequest({ action: 'youtube_scout', queries: qParam });
  }
  // 2. Browser: call /api/market?action=youtube_scout
  const qs = `action=youtube_scout${qParam ? `&queries=${encodeURIComponent(qParam)}` : ''}`;
  const urls = [`/api/market?${qs}`, `/.netlify/functions/market?${qs}`];
  const baseUrl = (store.state?.settings?.db?.baseServerUrl || '').trim().replace(/\/+$/, '');
  if (baseUrl) urls.push(`${baseUrl}/api/market?${qs}`);

  let lastErr = null;
  for (const u of urls) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20_000);
      const res = await fetch(u, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.ok && Array.isArray(data.videos)) return data;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(lastErr?.message || 'לא ניתן למשוך תוצאות מ-YouTube כרגע');
}

export async function runYonatanYouTubeScout({ customQueries = null, force = true, withAi = false } = {}) {
  const prev = store.state.youtubeScout || {};
  const queries = Array.isArray(customQueries)
    ? customQueries
    : (Array.isArray(prev.customQueries) ? prev.customQueries : []);

  if (!force && prev.scannedAt && (Date.now() - prev.scannedAt < AUTO_SCAN_COOLDOWN_MS)) {
    return { skipped: true, report: prev };
  }

  setYonatan({
    status: 'busy',
    task: 'סורק יוטיוב אחר סרטוני גאן ויוצרי אסטרטגיות (Doug & Silvia, TradingLab, Michael Jenkins)…',
    speech: 'סורק עכשיו סרטוני גאן ויוצרי אסטרטגיות מוכחות ביוטיוב כדי לבנות בוטים ייעודיים!',
    progress: 25,
  });
  store.emit();

  try {
    const raw = await fetchYouTubeScoutRaw(queries);
    const { blueprints, gannUpgrades } = classifyYouTubeVideosToBlueprints(raw.videos || []);

    // Optional AI digest in Hebrew (never hallucinates — strictly grounded on real video titles)
    let aiDigest = prev.aiDigest || null;
    if (withAi && blueprints.length) {
      try {
        const res = await chatDetailed({
          system: 'אתה יונתן, חוקר אסטרטגיות יוטיוב וגאן ב-Alta Capital. כתוב סיכום מחקרי קצר בעברית (5 נקודות) המבוסס אך ורק על הסרטונים האמיתיים שנסרקו: אילו טכניקות גאן ואילו אסטרטגיות של Doug & Silvia ויוצרים אחרים שווה להריץ בבוטים ייעודיים.',
          messages: [{
            role: 'user',
            content: blueprints.slice(0, 10).map((b) => `- [${b.creator}] "${b.videoTitle}" -> מנוע ${b.strategyId} על ${b.symbol} (${b.tf})`).join('\n'),
          }],
          maxTokens: 420,
          preferWeb: true,
        });
        if (res?.text) aiDigest = { model: res.provider || res.model || 'Gemini', text: res.text, at: Date.now() };
      } catch { /* keep without AI */ }
    }

    const report = {
      ok: true,
      scannedAt: Date.now(),
      source: raw.source,
      activeSources: raw.activeSources || [],
      customQueries: queries,
      totalVideos: raw.videos?.length || 0,
      videos: (raw.videos || []).slice(0, 36),
      blueprints,
      gannUpgrades,
      aiDigest,
    };

    store.state.youtubeScout = report;

    // Feed top Gann & creator learnings into store.state.knowledge.lessons & ideas (deduplicated)
    store.state.knowledge = store.state.knowledge || { strategies: [], lessons: [], facts: [] };
    for (const up of gannUpgrades.slice(0, 4)) {
      const lesson = `יוטיוב גאן (${up.channel}): ${up.upgradeNote} — "${up.title.slice(0, 75)}"`;
      if (!store.state.knowledge.lessons.includes(lesson)) {
        store.state.knowledge.lessons.push(lesson);
      }
    }
    if (store.state.knowledge.lessons.length > 180) {
      store.state.knowledge.lessons = store.state.knowledge.lessons.slice(-180);
    }

    store.state.ideas = store.state.ideas || [];
    for (const bp of blueprints.slice(0, 5)) {
      if (!store.state.ideas.some((i) => i.id === bp.id)) {
        store.state.ideas.unshift({
          id: bp.id,
          title: `${bp.creator}: ${bp.videoTitle.slice(0, 68)}`,
          source: 'YouTube · יונתן',
          url: bp.videoUrl,
          strategyId: bp.strategyId,
          symbol: bp.symbol,
          tf: bp.tf,
          tested: false,
          at: Date.now(),
        });
      }
    }
    if (store.state.ideas.length > 120) store.state.ideas.length = 120;

    setYonatan({
      status: 'idle',
      progress: 100,
      completed: (Number((store.state.agents || []).find((a) => a.id === 'yt_strategy_scout')?.completed) || 0) + 1,
      task: `נסרקו ${report.totalVideos} סרטוני יוטיוב · ${blueprints.length} בלופרינטים לבוטים ייעודיים`,
      speech: `אספתי ${report.totalVideos} סרטונים אמיתיים (גאן + Doug & Silvia + יוצרים) והכנתי ${blueprints.length} בלופרינטים לבוטים ייעודיים!`,
    });

    store.log('ok', 'יונתן · יוטיוב גאן ואסטרטגיות', `סריקת YouTube הושלמה: ${report.totalVideos} סרטונים אמיתיים, ${gannUpgrades.length} שדרוגי גאן ו-${blueprints.length} בלופרינטים לבוטים ייעודיים`);
    store.save(true);
    store.emit();
    scheduleDatabasePush(1200);
    return { ok: true, report };
  } catch (err) {
    setYonatan({
      status: 'idle',
      task: `שגיאה בסריקת יוטיוב: ${err.message}`,
    });
    store.emit();
    throw err;
  }
}

export async function runYonatanYouTubeScoutIfDue() {
  const prev = store.state.youtubeScout;
  if (prev?.scannedAt && Date.now() - prev.scannedAt < AUTO_SCAN_COOLDOWN_MS) return { skipped: true };
  return await runYonatanYouTubeScout({ force: false, withAi: false });
}

export function saveYouTubeCustomQueries(list = []) {
  const clean = [...new Set((list || []).map((s) => String(s || '').trim()).filter((s) => s.length >= 2))].slice(0, 8);
  store.state.youtubeScout = {
    ...(store.state.youtubeScout || {}),
    customQueries: clean,
  };
  store.save(true);
  scheduleDatabasePush(1000);
  return clean;
}
