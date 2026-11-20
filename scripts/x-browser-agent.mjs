#!/usr/bin/env node
// Alta Capital — Real-Browser X (Twitter) Fundamental Research Agent ("רוני" · x_fundamental).
//
// Runs on the user's local machine (invoked via Base Server /api/x-agent/* or CLI):
//  - Uses a dedicated persistent browser profile at data/x-browser-profile/ (gitignored).
//  - Login mode (--login): opens a REAL visible browser window (Edge/Chrome/Chromium) so the user
//    logs in directly into the X account they created for the agent (including any 2FA/verification).
//  - Scan mode (--scan): opens X with that saved session (visible window by default so the user
//    can watch live, or headless if configured), reads Following/Home + fundamental watchlist queries
//    + tracked handles (strictly READ-ONLY), extracts real verified posts with canonical status URLs,
//    analyzes fundamental catalysts & per-asset bias, and synthesizes a Hebrew fundamental briefing
//    using the machine's local AI (Ollama) when available.
//  - Safety: NEVER bypasses or solves CAPTCHAs / anti-bot challenges / login walls. If any gate is
//    detected, stops immediately and instructs the user to complete verification in a visible window.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
export const X_PROFILE_DIR = path.join(DATA_DIR, 'x-browser-profile');
export const X_CONFIG_PATH = path.join(DATA_DIR, 'x-agent-config.json');
export const X_RESEARCH_PATH = path.join(DATA_DIR, 'x_research.json');

export const DEFAULT_X_AGENT_CONFIG = {
  visibleBrowser: true, // Show the real browser window on the user's computer during scans
  includeHomeFeed: true, // Read the agent's Following / Home timeline
  maxPostsPerSource: 10,
  autoScanMinutes: 0, // 0 = manual only; >0 = auto scan every N minutes while Base Server runs
  browserPreference: 'auto', // 'auto' | 'msedge' | 'chrome' | 'chromium'
  queries: [
    '$BTC OR "Bitcoin ETF" OR "spot ETF" macro',
    '$NVDA earnings OR guidance OR "data center" OR AI',
    '$AAPL OR $MSFT earnings OR revenue OR guidance',
    '"Federal Reserve" OR FOMC OR CPI OR Powell OR yields',
    '$SPY OR macro OR recession OR liquidity',
  ],
  handles: [
    'KobeissiLetter',
    'DeItaone',
    'federalreserve',
  ],
  loggedInHandle: null,
  loggedInAt: null,
  browserChannel: null,
};

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadXAgentConfig() {
  ensureDataDir();
  try {
    if (fs.existsSync(X_CONFIG_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(X_CONFIG_PATH, 'utf8'));
      return {
        ...DEFAULT_X_AGENT_CONFIG,
        ...parsed,
        queries: Array.isArray(parsed.queries) ? parsed.queries.filter((q) => String(q || '').trim()) : DEFAULT_X_AGENT_CONFIG.queries,
        handles: Array.isArray(parsed.handles) ? parsed.handles.map((h) => String(h || '').replace(/^@/, '').trim()).filter(Boolean) : DEFAULT_X_AGENT_CONFIG.handles,
      };
    }
  } catch { /* fall back to defaults */ }
  return { ...DEFAULT_X_AGENT_CONFIG };
}

export function saveXAgentConfig(patch = {}) {
  ensureDataDir();
  const prev = loadXAgentConfig();
  const next = {
    ...prev,
    ...patch,
  };
  if (patch.queries !== undefined) {
    next.queries = (Array.isArray(patch.queries) ? patch.queries : String(patch.queries || '').split(/\r?\n/))
      .map((s) => String(s || '').trim())
      .filter(Boolean)
      .slice(0, 12);
  }
  if (patch.handles !== undefined) {
    next.handles = (Array.isArray(patch.handles) ? patch.handles : String(patch.handles || '').split(/[\s,;\r\n]+/))
      .map((s) => String(s || '').replace(/^@/, '').trim())
      .filter((s) => /^[A-Za-z0-9_]{1,30}$/.test(s))
      .slice(0, 15);
  }
  if (patch.maxPostsPerSource !== undefined) {
    next.maxPostsPerSource = Math.max(4, Math.min(25, Number(patch.maxPostsPerSource) || 10));
  }
  if (patch.autoScanMinutes !== undefined) {
    next.autoScanMinutes = Math.max(0, Math.min(1440, Number(patch.autoScanMinutes) || 0));
  }
  fs.writeFileSync(X_CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export function readLatestXResearch() {
  try {
    if (fs.existsSync(X_RESEARCH_PATH)) {
      return JSON.parse(fs.readFileSync(X_RESEARCH_PATH, 'utf8'));
    }
  } catch { /* ignore */ }
  return null;
}

export function detectSystemBrowsers() {
  const candidates = [];
  if (process.platform === 'win32') {
    const localApp = process.env.LOCALAPPDATA || '';
    const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
    const pfx86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    candidates.push(
      { id: 'msedge', label: 'Microsoft Edge', path: path.join(pfx86, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
      { id: 'msedge', label: 'Microsoft Edge', path: path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
      { id: 'chrome', label: 'Google Chrome', path: path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe') },
      { id: 'chrome', label: 'Google Chrome', path: path.join(pfx86, 'Google', 'Chrome', 'Application', 'chrome.exe') },
      { id: 'chrome', label: 'Google Chrome', path: path.join(localApp, 'Google', 'Chrome', 'Application', 'chrome.exe') },
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      { id: 'chrome', label: 'Google Chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
      { id: 'msedge', label: 'Microsoft Edge', path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
    );
  } else {
    candidates.push(
      { id: 'chrome', label: 'Google Chrome', path: '/usr/bin/google-chrome' },
      { id: 'chrome', label: 'Google Chrome', path: '/usr/bin/google-chrome-stable' },
      { id: 'chromium', label: 'Chromium', path: '/usr/bin/chromium' },
      { id: 'chromium', label: 'Chromium', path: '/usr/bin/chromium-browser' },
      { id: 'msedge', label: 'Microsoft Edge', path: '/usr/bin/microsoft-edge' },
    );
  }
  const found = [];
  const seen = new Set();
  for (const c of candidates) {
    if (!c.path || seen.has(c.id)) continue;
    try {
      if (fs.existsSync(c.path)) {
        seen.add(c.id);
        found.push(c);
      }
    } catch { /* ignore */ }
  }
  return found;
}

async function loadPlaywright() {
  for (const pkg of ['playwright', 'playwright-core']) {
    try {
      const mod = await import(pkg);
      const pw = mod.default || mod;
      if (pw?.chromium) return { pkg, chromium: pw.chromium };
    } catch { /* try next */ }
  }
  return null;
}

function hasSavedProfileSession() {
  try {
    if (!fs.existsSync(X_PROFILE_DIR)) return false;
    const entries = fs.readdirSync(X_PROFILE_DIR);
    return entries.length > 0;
  } catch {
    return false;
  }
}

export async function getXAgentStatus() {
  const pw = await loadPlaywright();
  const browsers = detectSystemBrowsers();
  const config = loadXAgentConfig();
  const latest = readLatestXResearch();
  const profileExists = hasSavedProfileSession();
  return {
    ok: true,
    agentId: 'x_fundamental',
    agentName: 'רוני',
    hostname: os.hostname(),
    platform: process.platform,
    playwrightInstalled: !!pw,
    playwrightPkg: pw?.pkg || null,
    detectedBrowsers: browsers.map((b) => ({ id: b.id, label: b.label })),
    profileExists,
    loggedIn: !!(profileExists && config.loggedInHandle),
    loggedInHandle: config.loggedInHandle || null,
    loggedInAt: config.loggedInAt || null,
    config: {
      visibleBrowser: config.visibleBrowser !== false,
      includeHomeFeed: config.includeHomeFeed !== false,
      maxPostsPerSource: config.maxPostsPerSource || 10,
      autoScanMinutes: config.autoScanMinutes || 0,
      browserPreference: config.browserPreference || 'auto',
      queries: config.queries || [],
      handles: config.handles || [],
    },
    latestReport: latest ? sanitizeXResearchForSync(latest) : null,
  };
}

async function launchPersistentBrowser(chromium, { headless = false, browserPreference = 'auto' } = {}) {
  fs.mkdirSync(X_PROFILE_DIR, { recursive: true });
  const systemBrowsers = detectSystemBrowsers();
  let chosen = null;
  if (browserPreference && browserPreference !== 'auto') {
    chosen = systemBrowsers.find((b) => b.id === browserPreference) || null;
  }
  if (!chosen && systemBrowsers.length) {
    // Prefer Chrome then Edge on Windows/Mac/Linux
    chosen = systemBrowsers.find((b) => b.id === 'chrome') || systemBrowsers[0];
  }

  const baseOpts = {
    headless: !!headless,
    viewport: { width: 1280, height: 860 },
    locale: 'en-US',
    args: ['--disable-notifications'],
  };

  if (chosen?.path) {
    const context = await chromium.launchPersistentContext(X_PROFILE_DIR, {
      ...baseOpts,
      executablePath: chosen.path,
    });
    return { context, browserLabel: chosen.label };
  }

  // Fallback to Playwright bundled Chromium
  const context = await chromium.launchPersistentContext(X_PROFILE_DIR, baseOpts);
  return { context, browserLabel: 'Playwright Chromium' };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function detectLoggedInHandle(page) {
  try {
    return await page.evaluate(() => {
      const profileLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
      if (profileLink) {
        const href = profileLink.getAttribute('href') || '';
        const m = href.match(/^\/([A-Za-z0-9_]{1,30})\/?$/);
        if (m) return '@' + m[1];
      }
      const switcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
      if (switcher) {
        const txt = switcher.innerText || '';
        const m = txt.match(/@([A-Za-z0-9_]{1,30})/);
        if (m) return '@' + m[1];
      }
      return null;
    });
  } catch {
    return null;
  }
}

async function detectChallengeOrLoginGate(page) {
  try {
    const url = page.url() || '';
    if (/\/i\/flow\/login|\/login\b|\/account\/access|\/account\/begin_password_reset/i.test(url)) {
      return { blocked: true, needsLogin: true, reason: 'X דורש התחברות מחדש לחשבון — פתח את דפדפן ההתחברות והתחבר.' };
    }
    const bodyText = await page.evaluate(() => (document.body?.innerText || '').slice(0, 2500));
    if (/verify you are human|arkose|captcha|unusual login activity|confirm your identity|authenticate your account/i.test(bodyText)) {
      return {
        blocked: true,
        needsLogin: true,
        challengeDetected: true,
        reason: 'X הציג אימות אבטחה / CAPTCHA. הסוכן עצר מיד — יש לפתוח חלון דפדפן גלוי ולהשלים את האימות ידנית.',
      };
    }
    return { blocked: false };
  } catch {
    return { blocked: false };
  }
}

/**
 * Opens a REAL visible browser window on the user's computer pointed at x.com/login
 * using the dedicated persistent profile so the user can log into the agent's X account.
 */
export async function launchXLogin({ timeoutMs = 5 * 60 * 1000 } = {}) {
  const pw = await loadPlaywright();
  if (!pw) {
    return {
      ok: false,
      error: 'Playwright עדיין לא מותקן על המחשב. הרץ פעם אחת: npm run setup:x-agent:win (ב-Windows) או npm run setup:x-agent',
    };
  }
  const cfg = loadXAgentConfig();
  let context = null;
  try {
    const launched = await launchPersistentBrowser(pw.chromium, {
      headless: false, // Always visible so the user logs in directly!
      browserPreference: cfg.browserPreference,
    });
    context = launched.context;
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await sleep(2500);

    let handle = await detectLoggedInHandle(page);
    if (!handle) {
      await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }

    const deadline = Date.now() + timeoutMs;
    while (!handle && Date.now() < deadline) {
      if (page.isClosed()) break;
      await sleep(2000);
      handle = await detectLoggedInHandle(page);
    }

    if (handle) {
      saveXAgentConfig({
        loggedInHandle: handle,
        loggedInAt: Date.now(),
        browserChannel: launched.browserLabel,
      });
      await sleep(1200);
      await context.close().catch(() => {});
      return {
        ok: true,
        loggedIn: true,
        handle,
        browser: launched.browserLabel,
        message: `התחברת בהצלחה ל-X כ-${handle}! הסשן נשמר מקומית בפרופיל הייעודי של רוני.`,
      };
    }

    await context.close().catch(() => {});
    return {
      ok: false,
      loggedIn: false,
      error: 'החלון נסגר או שתם הזמן לפני שזוהתה התחברות פעילה ב-X. נסה שוב והתחבר בחלון הדפדפן.',
    };
  } catch (err) {
    if (context) await context.close().catch(() => {});
    return { ok: false, error: `שגיאה בפתיחת הדפדפן: ${err.message}` };
  }
}

async function extractTweetsFromPage(page, sourceLabel, maxPosts = 10) {
  const collected = new Map();
  for (let scroll = 0; scroll < 3 && collected.size < maxPosts; scroll++) {
    const batch = await page.evaluate(() => {
      const parseMetric = (txt) => {
        const s = String(txt || '').trim().replace(/,/g, '');
        if (!s) return 0;
        const m = s.match(/^([\d.]+)\s*([KMB])?$/i);
        if (!m) return Number(s) || 0;
        const mult = m[2]?.toUpperCase() === 'K' ? 1e3 : m[2]?.toUpperCase() === 'M' ? 1e6 : m[2]?.toUpperCase() === 'B' ? 1e9 : 1;
        return Math.round(parseFloat(m[1]) * mult);
      };
      const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
      return articles.map((art) => {
        const textNode = art.querySelector('[data-testid="tweetText"]');
        const text = (textNode?.innerText || '').trim();
        const timeEl = art.querySelector('time');
        const publishedAt = timeEl?.getAttribute('datetime') || null;
        const linkEl = timeEl?.closest('a') || art.querySelector('a[href*="/status/"]');
        const href = linkEl?.getAttribute('href') || '';
        const statusMatch = href.match(/^\/([A-Za-z0-9_]+)\/status\/(\d+)/);
        if (!statusMatch || !text) return null;
        const handle = '@' + statusMatch[1];
        const id = statusMatch[2];
        const url = `https://x.com/${statusMatch[1]}/status/${id}`;
        const userNode = art.querySelector('[data-testid="User-Name"]');
        const authorName = (userNode?.innerText || '').split('\n')[0]?.trim() || statusMatch[1];
        const replies = parseMetric(art.querySelector('[data-testid="reply"]')?.innerText);
        const reposts = parseMetric(art.querySelector('[data-testid="retweet"]')?.innerText);
        const likes = parseMetric(art.querySelector('[data-testid="like"]')?.innerText);
        return { id, url, handle, authorName, publishedAt, text, metrics: { replies, reposts, likes } };
      }).filter(Boolean);
    }).catch(() => []);

    for (const item of batch) {
      if (!collected.has(item.url) && collected.size < maxPosts) {
        collected.set(item.url, { ...item, source: sourceLabel });
      }
    }
    if (collected.size < maxPosts) {
      await page.evaluate(() => window.scrollBy(0, 900)).catch(() => {});
      await sleep(1200);
    }
  }
  return [...collected.values()];
}

// --- Deterministic Fundamental & Catalyst Analysis (Zero Hallucination) ----

const ASSET_MATCHERS = [
  { symbol: 'BTCUSDT', rx: /(\$btc\b|\bbitcoin\b|\bbtc\b)/i },
  { symbol: 'ETHUSDT', rx: /(\$eth\b|\bethereum\b|\beth\b)/i },
  { symbol: 'SOLUSDT', rx: /(\$sol\b|\bsolana\b)/i },
  { symbol: 'NVDA', rx: /(\$nvda\b|\bnvidia\b)/i },
  { symbol: 'AAPL', rx: /(\$aapl\b|\bapple\b)/i },
  { symbol: 'TSLA', rx: /(\$tsla\b|\btesla\b)/i },
  { symbol: 'MSFT', rx: /(\$msft\b|\bmicrosoft\b)/i },
  { symbol: 'AMZN', rx: /(\$amzn\b|\bamazon\b)/i },
  { symbol: 'GOOGL', rx: /(\$googl?\b|\balphabet\b|\bgoogle\b)/i },
  { symbol: 'SPY', rx: /(\$spy\b|\bs&p\s*500\b|\bqqq\b|\bnasdaq\b)/i },
  { symbol: 'MACRO', rx: /(\bfed\b|federal reserve|\bfomc\b|\bpowell\b|\bcpi\b|\bpce\b|\binflation\b|\byields?\b|\btreasury\b|\brecession\b|\brate cut\b|\brate hike\b|\btariff\b|\bgdp\b)/i },
];

const CATALYST_RULES = [
  { id: 'earnings', label: 'דוחות ורווחיות', rx: /(earnings|revenue|eps|guidance|beat|miss|quarter|margin|profit|forecast)/i },
  { id: 'macro', label: 'מאקרו וריבית', rx: /(fed|fomc|powell|cpi|pce|inflation|rate cut|rate hike|yield|treasury|gdp|jobs|payroll|tariff)/i },
  { id: 'flows', label: 'ETF וזרימה מוסדית', rx: /(etf|inflow|outflow|blackrock|fidelity|institutional|whale|treasury reserve|buyback)/i },
  { id: 'regulation', label: 'רגולציה ו-SEC', rx: /(sec\b|cftc|lawsuit|antitrust|regulation|approval|ban|probe|settlement)/i },
  { id: 'growth_ai', label: 'AI ומוצרים / חפיר', rx: /(\bai\b|gpu|chip|data center|blackwell|cloud|partnership|launch|upgrade|capex)/i },
];

const BULLISH_TERMS = [
  /\bbeat(s|ing)?\b/i, /\braise(d|s)? guidance\b/i, /\bstrong(er)?\b/i, /\bsurge(d|s)?\b/i,
  /\binflow(s)?\b/i, /\brate cut(s)?\b/i, /\bcool(ing|er)? inflation\b/i, /\bbreakout\b/i,
  /\bupgrade(d)?\b/i, /\baccelerat(ing|ed|ion)\b/i, /\brecord (revenue|profit|demand|inflow)\b/i,
  /\bbuyback\b/i, /\bapproval\b/i, /\bapproved\b/i, /\bbullish\b/i, /\boutperform\b/i,
];

const BEARISH_TERMS = [
  /\bmiss(ed|es)?\b/i, /\bcut(s)? guidance\b/i, /\bweak(er|ness)?\b/i, /\bplunge(d|s)?\b/i,
  /\boutflow(s)?\b/i, /\brate hike(s)?\b/i, /\bhot(ter)? inflation\b/i, /\brecession\b/i,
  /\bdowngrade(d)?\b/i, /\bslowdown\b/i, /\blawsuit\b/i, /\binvestigation\b/i,
  /\btariff(s)?\b/i, /\bbearish\b/i, /\blayoff(s)?\b/i, /\bdefault\b/i, /\bhack(ed)?\b/i,
];

export function analyzeXPosts(rawPosts = []) {
  const dedup = new Map();
  for (const p of rawPosts) {
    if (!p?.url || !p?.text) continue;
    if (!/^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]+\/status\/\d+/.test(p.url)) continue;
    if (!dedup.has(p.url)) dedup.set(p.url, p);
  }

  const enrichedPosts = [...dedup.values()].map((p) => {
    const txt = String(p.text || '');
    const assets = ASSET_MATCHERS.filter((m) => m.rx.test(txt) || m.rx.test(p.source || '')).map((m) => m.symbol);
    if (!assets.length) assets.push('MACRO');

    const catalysts = CATALYST_RULES.filter((c) => c.rx.test(txt)).map((c) => c.label);
    let bullHits = 0;
    let bearHits = 0;
    for (const rx of BULLISH_TERMS) if (rx.test(txt)) bullHits++;
    for (const rx of BEARISH_TERMS) if (rx.test(txt)) bearHits++;

    const rawScore = bullHits - bearHits;
    const sentiment = rawScore > 0 ? 'bullish' : rawScore < 0 ? 'bearish' : 'neutral';
    const sentimentLabel = sentiment === 'bullish' ? 'חיובי (Bullish)' : sentiment === 'bearish' ? 'שלילי (Bearish)' : 'נייטרלי';
    const engagement = (p.metrics?.likes || 0) + (p.metrics?.reposts || 0) * 3 + (p.metrics?.replies || 0) * 2;
    const weight = 1 + Math.min(3, Math.log10(1 + engagement));

    return {
      id: p.id,
      url: p.url,
      handle: p.handle,
      authorName: p.authorName || p.handle,
      publishedAt: p.publishedAt || null,
      text: txt.slice(0, 420),
      source: p.source || 'X',
      metrics: p.metrics || { replies: 0, reposts: 0, likes: 0 },
      assets,
      catalysts: catalysts.length ? catalysts : ['עדכון שוק'],
      sentiment,
      sentimentLabel,
      score: rawScore,
      weight: +weight.toFixed(2),
    };
  });

  // Sort by recency & engagement weight
  enrichedPosts.sort((a, b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) || 0 : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) || 0 : 0;
    return (tb - ta) || ((b.weight || 0) - (a.weight || 0));
  });

  // Aggregate per-asset fundamental summary
  const byAsset = {};
  for (const p of enrichedPosts) {
    for (const sym of p.assets) {
      if (!byAsset[sym]) {
        byAsset[sym] = { symbol: sym, mentions: 0, bullish: 0, bearish: 0, neutral: 0, weightedSum: 0, weightTotal: 0, catalysts: new Set() };
      }
      const bucket = byAsset[sym];
      bucket.mentions++;
      bucket[p.sentiment]++;
      bucket.weightedSum += (p.sentiment === 'bullish' ? 1 : p.sentiment === 'bearish' ? -1 : 0) * p.weight;
      bucket.weightTotal += p.weight;
      for (const c of p.catalysts) bucket.catalysts.add(c);
    }
  }

  const assetSignals = {};
  for (const [sym, b] of Object.entries(byAsset)) {
    const norm = b.weightTotal > 0 ? b.weightedSum / b.weightTotal : 0; // -1..+1
    const score = Math.max(5, Math.min(95, Math.round(50 + norm * 42)));
    const bias = score >= 60 ? 'שורי פונדמנטלית' : score <= 40 ? 'דובי / זהירות' : 'מאוזן / מעורב';
    assetSignals[sym] = {
      symbol: sym,
      score,
      bias,
      mentions: b.mentions,
      bullish: b.bullish,
      bearish: b.bearish,
      neutral: b.neutral,
      catalysts: [...b.catalysts].slice(0, 4),
    };
  }

  const totalBull = enrichedPosts.filter((p) => p.sentiment === 'bullish').length;
  const totalBear = enrichedPosts.filter((p) => p.sentiment === 'bearish').length;
  const overallScore = enrichedPosts.length
    ? Math.max(5, Math.min(95, Math.round(50 + ((totalBull - totalBear) / enrichedPosts.length) * 45)))
    : 50;
  const overallBias = overallScore >= 60 ? 'חיובי (Risk-On ב-X)' : overallScore <= 40 ? 'זהירות (Risk-Off ב-X)' : 'מאוזן ב-X';

  return {
    posts: enrichedPosts.slice(0, 60),
    totalPosts: enrichedPosts.length,
    overallScore,
    overallBias,
    assetSignals,
    topCatalysts: [...new Set(enrichedPosts.flatMap((p) => p.catalysts))].slice(0, 6),
  };
}

async function synthesizeWithLocalAi(analysis) {
  if (!analysis.posts.length) return null;
  const ollamaHost = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  let model = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const r = await fetch(`${ollamaHost}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    const names = (j?.models || []).map((m) => m.name || m.model).filter(Boolean);
    model = names.find((n) => /qwen2\.5:7b/i.test(n))
      || names.find((n) => /qwen2\.5/i.test(n))
      || names.find((n) => /llama3/i.test(n))
      || names[0]
      || null;
  } catch {
    return null;
  }
  if (!model) return null;

  const sample = analysis.posts.slice(0, 18).map((p, idx) =>
    `${idx + 1}. ${p.handle} [${p.assets.join(',')}] (${p.sentiment}): "${p.text.replace(/\s+/g, ' ').slice(0, 220)}"`
  ).join('\n');

  const prompt = [
    'אתה רוני, אנליסט מחקר פונדמנטלי ב-Alta Capital שסרק כרגע ציוצי אמת ב-X.',
    'כלל ברזל נגד הזיות: הסתמך אך ורק על הציוצים האמיתיים שלמטה! אל תמציא שום מספר, אירוע או חשבון שלא מופיעים בהם. ציין @handle לכל עובדה.',
    'כתוב בעברית תמציתית ומקצועית (4-6 נקודות קצרות):',
    '1) תמונת מאקרו וריבית',
    '2) זרזים פונדמנטליים עיקריים במניות/קריפטו שזוהו',
    '3) סיכונים ואזהרות לצוות המסחר',
    '',
    'הציוצים האמיתיים שנאספו:',
    sample,
  ].join('\n');

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    const res = await fetch(`${ollamaHost}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        stream: false,
        messages: [
          { role: 'system', content: 'ענה בעברית ברורה ומדויקת בלבד, ללא המצאת עובדות.' },
          { role: 'user', content: prompt },
        ],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content?.trim() || '';
    if (!content) return null;
    return { model, summary: content.slice(0, 1800) };
  } catch {
    return null;
  }
}

export function sanitizeXResearchForSync(report) {
  if (!report || typeof report !== 'object') return null;
  return {
    scannedAt: report.scannedAt || Date.now(),
    loggedInHandle: report.loggedInHandle || null,
    browser: report.browser || null,
    totalPosts: Number(report.totalPosts) || (report.posts?.length || 0),
    overallScore: Number(report.overallScore) || 50,
    overallBias: report.overallBias || 'מאוזן',
    topCatalysts: Array.isArray(report.topCatalysts) ? report.topCatalysts.slice(0, 6) : [],
    assetSignals: report.assetSignals || {},
    aiSummary: report.aiSummary || null,
    aiModel: report.aiModel || null,
    sourcesScanned: Array.isArray(report.sourcesScanned) ? report.sourcesScanned.slice(0, 20) : [],
    posts: Array.isArray(report.posts) ? report.posts.slice(0, 40) : [],
  };
}

/**
 * Executes a live read-only fundamental research scan on X using the persistent logged-in browser.
 */
export async function runXFundamentalScan(options = {}) {
  const pw = await loadPlaywright();
  if (!pw) {
    return {
      ok: false,
      error: 'Playwright עדיין לא מותקן על המחשב. הרץ פעם אחת: npm run setup:x-agent:win (ב-Windows) או npm run setup:x-agent',
    };
  }
  const cfg = loadXAgentConfig();
  const visibleBrowser = options.visibleBrowser !== undefined ? !!options.visibleBrowser : cfg.visibleBrowser !== false;
  const queries = Array.isArray(options.queries) && options.queries.length ? options.queries : cfg.queries;
  const handles = Array.isArray(options.handles) ? options.handles : cfg.handles;
  const includeHomeFeed = options.includeHomeFeed !== undefined ? !!options.includeHomeFeed : cfg.includeHomeFeed !== false;
  const maxPerSource = Number(options.maxPostsPerSource) || cfg.maxPostsPerSource || 10;

  let context = null;
  try {
    const launched = await launchPersistentBrowser(pw.chromium, {
      headless: !visibleBrowser,
      browserPreference: cfg.browserPreference,
    });
    context = launched.context;
    const page = context.pages()[0] || await context.newPage();

    // 1. Open Home timeline and verify active login session (never bypass gates!)
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    const gate = await detectChallengeOrLoginGate(page);
    if (gate.blocked) {
      await context.close().catch(() => {});
      return { ok: false, ...gate };
    }

    const activeHandle = await detectLoggedInHandle(page);
    if (!activeHandle) {
      await context.close().catch(() => {});
      return {
        ok: false,
        needsLogin: true,
        error: 'לא זוהה משתמש מחובר ב-X בפרופיל של רוני. לחץ על "פתח דפדפן להתחברות ל-X" והתחבר פעם אחת.',
      };
    }

    if (activeHandle !== cfg.loggedInHandle) {
      saveXAgentConfig({ loggedInHandle: activeHandle, loggedInAt: Date.now(), browserChannel: launched.browserLabel });
    }

    const rawPosts = [];
    const sourcesScanned = [];

    if (includeHomeFeed) {
      const homePosts = await extractTweetsFromPage(page, 'Following / Home Feed', maxPerSource);
      rawPosts.push(...homePosts);
      sourcesScanned.push(`Home Feed (${homePosts.length})`);
    }

    // 2. Scan Fundamental Watchlist Queries (Latest / Top real posts)
    for (const q of queries.slice(0, 6)) {
      const searchUrl = `https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=top`;
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
      await sleep(2400);
      const qGate = await detectChallengeOrLoginGate(page);
      if (qGate.blocked) {
        await context.close().catch(() => {});
        return { ok: false, ...qGate };
      }
      const posts = await extractTweetsFromPage(page, `חיפוש: ${q}`, maxPerSource);
      rawPosts.push(...posts);
      sourcesScanned.push(`${q.slice(0, 32)} (${posts.length})`);
    }

    // 3. Scan Tracked Macro / Finance Handles
    for (const h of handles.slice(0, 5)) {
      const cleanH = String(h || '').replace(/^@/, '').trim();
      if (!cleanH) continue;
      await page.goto(`https://x.com/${encodeURIComponent(cleanH)}`, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
      await sleep(2200);
      const hGate = await detectChallengeOrLoginGate(page);
      if (hGate.blocked) {
        await context.close().catch(() => {});
        return { ok: false, ...hGate };
      }
      const posts = await extractTweetsFromPage(page, `@${cleanH}`, Math.min(6, maxPerSource));
      rawPosts.push(...posts);
      sourcesScanned.push(`@${cleanH} (${posts.length})`);
    }

    await context.close().catch(() => {});
    context = null;

    const analysis = analyzeXPosts(rawPosts);
    const ai = await synthesizeWithLocalAi(analysis);

    const report = sanitizeXResearchForSync({
      scannedAt: Date.now(),
      loggedInHandle: activeHandle,
      browser: launched.browserLabel,
      sourcesScanned,
      ...analysis,
      aiSummary: ai?.summary || null,
      aiModel: ai?.model || null,
    });

    ensureDataDir();
    fs.writeFileSync(X_RESEARCH_PATH, JSON.stringify(report, null, 2), 'utf8');

    return { ok: true, report };
  } catch (err) {
    if (context) await context.close().catch(() => {});
    return { ok: false, error: `שגיאה בסריקת X: ${err.message}` };
  }
}

// --- CLI Entrypoint --------------------------------------------------------
const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const args = new Set(process.argv.slice(2));
  if (args.has('--login')) {
    console.log('[Roni · X Agent] Opening visible browser window for X login...');
    const res = await launchXLogin();
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.ok ? 0 : 1);
  } else if (args.has('--scan')) {
    console.log('[Roni · X Agent] Starting live fundamental research scan on X...');
    const res = await runXFundamentalScan({
      visibleBrowser: args.has('--headless') ? false : undefined,
    });
    console.log(JSON.stringify(res.ok ? { ok: true, totalPosts: res.report.totalPosts, overallBias: res.report.overallBias, assets: Object.keys(res.report.assetSignals) } : res, null, 2));
    process.exit(res.ok ? 0 : 1);
  } else {
    const st = await getXAgentStatus();
    console.log(JSON.stringify(st, null, 2));
    process.exit(0);
  }
}
