#!/usr/bin/env node
// Alta Capital — Real-Browser WhatsApp Web Group Reader for Gann Module (Strictly Read-Only).
//
// Runs on the user's local PC (invoked via Base Server /api/whatsapp-agent/* or CLI):
//  - Dedicated persistent browser profile at data/whatsapp-browser-profile/ (gitignored).
//  - Login mode (--login): opens a REAL visible Chrome/Edge window to https://web.whatsapp.com
//    so the user scans the QR code ONCE with their phone (standard WhatsApp Linked Devices).
//  - Scan mode (--scan): opens ONLY the user's single whitelisted WhatsApp group (read-only —
//    never types or sends messages), extracts recent messages with author, timestamp, quoted reply,
//    and surrounding before/after context, then parses Gann levels/dates/degrees, trading signals
//    (entries/targets/supports/stops), and macro/news sentiment, syncing structured insights to store.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { detectSystemBrowsers } from './x-browser-agent.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
export const WA_PROFILE_DIR = path.join(DATA_DIR, 'whatsapp-browser-profile');
export const WA_CONFIG_PATH = path.join(DATA_DIR, 'whatsapp-agent-config.json');
export const WA_REPORT_PATH = path.join(DATA_DIR, 'whatsapp_gann.json');

export const DEFAULT_WA_AGENT_CONFIG = {
  groupName: '', // Exact (or partial) WhatsApp group title whitelisted by user
  visibleBrowser: true, // Keep visible Chrome window by default so user sees everything
  maxMessages: 90,
  scrollPasses: 5,
  autoScanMinutes: 0, // 0 = manual only; >0 = auto scan every N minutes while Base Server runs
  browserPreference: 'auto',
  loggedIn: false,
  loggedInAt: null,
  discoveredGroups: [],
};

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadWhatsAppConfig() {
  ensureDataDir();
  try {
    if (fs.existsSync(WA_CONFIG_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(WA_CONFIG_PATH, 'utf8'));
      return {
        ...DEFAULT_WA_AGENT_CONFIG,
        ...parsed,
        groupName: String(parsed.groupName || '').trim(),
        discoveredGroups: Array.isArray(parsed.discoveredGroups) ? parsed.discoveredGroups.slice(0, 60) : [],
      };
    }
  } catch { /* fall back to defaults */ }
  return { ...DEFAULT_WA_AGENT_CONFIG };
}

export function saveWhatsAppConfig(patch = {}) {
  ensureDataDir();
  const prev = loadWhatsAppConfig();
  const next = { ...prev, ...patch };
  if (patch.groupName !== undefined) next.groupName = String(patch.groupName || '').trim().slice(0, 140);
  if (patch.maxMessages !== undefined) next.maxMessages = Math.max(20, Math.min(200, Number(patch.maxMessages) || 90));
  if (patch.scrollPasses !== undefined) next.scrollPasses = Math.max(1, Math.min(12, Number(patch.scrollPasses) || 5));
  if (patch.autoScanMinutes !== undefined) next.autoScanMinutes = Math.max(0, Math.min(1440, Number(patch.autoScanMinutes) || 0));
  if (Array.isArray(patch.discoveredGroups)) {
    next.discoveredGroups = [...new Set(patch.discoveredGroups.map((s) => String(s || '').trim()).filter(Boolean))].slice(0, 60);
  }
  fs.writeFileSync(WA_CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export function readLatestWhatsAppReport() {
  try {
    if (fs.existsSync(WA_REPORT_PATH)) {
      return JSON.parse(fs.readFileSync(WA_REPORT_PATH, 'utf8'));
    }
  } catch { /* ignore */ }
  return null;
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
    if (!fs.existsSync(WA_PROFILE_DIR)) return false;
    return fs.readdirSync(WA_PROFILE_DIR).length > 0;
  } catch {
    return false;
  }
}

export async function getWhatsAppAgentStatus() {
  const pw = await loadPlaywright();
  const browsers = detectSystemBrowsers();
  const config = loadWhatsAppConfig();
  const latest = readLatestWhatsAppReport();
  const profileExists = hasSavedProfileSession();
  return {
    ok: true,
    agentId: 'whatsapp_gann',
    agentName: 'סוכן וואטסאפ · גאן',
    hostname: os.hostname(),
    platform: process.platform,
    playwrightInstalled: !!pw,
    playwrightPkg: pw?.pkg || null,
    detectedBrowsers: browsers.map((b) => ({ id: b.id, label: b.label })),
    profileExists,
    loggedIn: !!(profileExists && config.loggedIn),
    loggedInAt: config.loggedInAt || null,
    groupName: config.groupName || '',
    discoveredGroups: config.discoveredGroups || [],
    config: {
      groupName: config.groupName || '',
      visibleBrowser: config.visibleBrowser !== false,
      maxMessages: config.maxMessages || 90,
      scrollPasses: config.scrollPasses || 5,
      autoScanMinutes: config.autoScanMinutes || 0,
      browserPreference: config.browserPreference || 'auto',
    },
    latestReport: latest ? sanitizeWhatsAppReportForSync(latest) : null,
  };
}

async function launchWhatsAppBrowser(chromium, { headless = false, browserPreference = 'auto' } = {}) {
  fs.mkdirSync(WA_PROFILE_DIR, { recursive: true });
  const systemBrowsers = detectSystemBrowsers();
  let chosen = null;
  if (browserPreference && browserPreference !== 'auto') {
    chosen = systemBrowsers.find((b) => b.id === browserPreference) || null;
  }
  if (!chosen && systemBrowsers.length) {
    chosen = systemBrowsers.find((b) => b.id === 'chrome') || systemBrowsers[0];
  }
  const baseOpts = {
    headless: !!headless,
    viewport: { width: 1320, height: 880 },
    args: ['--disable-notifications'],
  };
  if (chosen?.path) {
    const context = await chromium.launchPersistentContext(WA_PROFILE_DIR, {
      ...baseOpts,
      executablePath: chosen.path,
    });
    return { context, browserLabel: chosen.label };
  }
  const context = await chromium.launchPersistentContext(WA_PROFILE_DIR, baseOpts);
  return { context, browserLabel: 'Playwright Chromium' };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function isWhatsAppReady(page) {
  try {
    return await page.evaluate(() => {
      const paneSide = document.querySelector('#pane-side');
      if (paneSide && paneSide.querySelectorAll('span[title]').length > 0) return true;
      const searchBox = document.querySelector('[data-testid="chat-list-search"], [contenteditable="true"][data-tab="3"], div[role="textbox"][aria-label]');
      if (searchBox && document.querySelector('#side')) return true;
      return false;
    });
  } catch {
    return false;
  }
}

async function isQrScreenVisible(page) {
  try {
    return await page.evaluate(() => {
      if (document.querySelector('canvas[aria-label*="Scan"], canvas[aria-label*="QR"], [data-testid="qrcode"], [data-ref] canvas')) return true;
      const body = document.body?.innerText || '';
      return /Log in with phone number|Link a device|התחבר באמצעות מספר טלפון|סרוק את קוד ה-QR|Use WhatsApp on your computer/i.test(body);
    });
  } catch {
    return false;
  }
}

async function listVisibleChats(page) {
  try {
    return await page.evaluate(() => {
      const out = [];
      const seen = new Set();
      const pane = document.querySelector('#pane-side') || document.querySelector('#side');
      if (!pane) return out;
      const spans = pane.querySelectorAll('span[title][dir="auto"], span[title]');
      for (const sp of spans) {
        const title = (sp.getAttribute('title') || '').trim();
        if (!title || title.length < 2 || title.length > 100) continue;
        // Skip timestamps or pure message preview artifacts
        if (/^\d{1,2}:\d{2}(\s?(AM|PM))?$/i.test(title)) continue;
        if (/^(yesterday|today|אתמול|היום)$/i.test(title)) continue;
        // Prefer chat title rows inside gridcell / role="listitem"
        const row = sp.closest('[role="listitem"], [role="row"], [data-testid="cell-frame-container"]');
        if (!row) continue;
        const headerSpan = row.querySelector('[data-testid="cell-frame-title"] span[title], span[dir="auto"][title]');
        const candidate = (headerSpan?.getAttribute('title') || title).trim();
        if (candidate && !seen.has(candidate)) {
          seen.add(candidate);
          out.push(candidate);
        }
      }
      return out.slice(0, 50);
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Gann + Trading Signals + Macro/News Analyzer (Pure, Unit-Testable)
// ---------------------------------------------------------------------------

const ASSET_ALIASES = [
  { symbol: 'BTCUSDT', patterns: [/\bbtc(?:usdt|usd)?\b/i, /\bbitcoin\b/i, /ביטקוין/, /ביטיסי/, /\bביט\b/] },
  { symbol: 'ETHUSDT', patterns: [/\beth(?:usdt|usd)?\b/i, /\bethereum\b/i, /אתריום/, /איתריום/] },
  { symbol: 'SOLUSDT', patterns: [/\bsol(?:usdt|usd)?\b/i, /\bsolana\b/i, /סולאנה/, /סולנה/] },
  { symbol: 'XRPUSDT', patterns: [/\bxrp(?:usdt|usd)?\b/i, /\bripple\b/i, /ריפל/] },
  { symbol: 'BNBUSDT', patterns: [/\bbnb(?:usdt|usd)?\b/i] },
  { symbol: 'ADAUSDT', patterns: [/\bada(?:usdt|usd)?\b/i, /\bcardano\b/i, /קרדנו/] },
  { symbol: 'DOGEUSDT', patterns: [/\bdoge(?:usdt|usd)?\b/i, /דוג׳קוין/, /דוגקוין/] },
  { symbol: 'AVAXUSDT', patterns: [/\bavax(?:usdt|usd)?\b/i] },
  { symbol: 'LINKUSDT', patterns: [/\blink(?:usdt|usd)?\b/i, /\bchainlink\b/i] },
  { symbol: 'NVDA', patterns: [/\bnvda\b/i, /\bnvidia\b/i, /אנבידיה/, /אנווידיה/] },
  { symbol: 'AAPL', patterns: [/\baapl\b/i, /\bapple\b/i, /מניית אפל/, /\bאפל\b/] },
  { symbol: 'MSFT', patterns: [/\bmsft\b/i, /\bmicrosoft\b/i, /מיקרוסופט/] },
  { symbol: 'TSLA', patterns: [/\btsla\b/i, /\btesla\b/i, /טסלה/] },
  { symbol: 'META', patterns: [/\bmeta\b/i, /מטא/] },
  { symbol: 'AMZN', patterns: [/\bamzn\b/i, /\bamazon\b/i, /אמזון/] },
  { symbol: 'GOOGL', patterns: [/\bgoogl?\b/i, /\bgoogle\b/i, /\balphabet\b/i, /גוגל/] },
  { symbol: 'AMD', patterns: [/\bamd\b/i] },
  { symbol: 'PLTR', patterns: [/\bpltr\b/i, /\bpalantir\b/i, /פלנטיר/] },
  { symbol: 'MSTR', patterns: [/\bmstr\b/i, /\bmicrostrategy\b/i, /\bstrategy\b/i] },
  { symbol: 'COIN', patterns: [/\bcoin\b/i, /\bcoinbase\b/i, /קוינבייס/] },
  { symbol: 'SPY', patterns: [/\bspy\b/i, /\bspx\b/i, /s&p\s*500/i, /\bsp500\b/i, /\bes1?!?\b/i, /סנופי/, /אס\s*אנד\s*פי/] },
  { symbol: 'QQQ', patterns: [/\bqqq\b/i, /\bndx\b/i, /\bnasdaq\b/i, /\bnq1?!?\b/i, /נאסד["״']?ק/, /נסדאק/] },
  { symbol: 'DIA', patterns: [/\bdia\b/i, /\bdow\s*jones\b/i, /דאו\s*ג׳?ונס/] },
  { symbol: 'IWM', patterns: [/\biwm\b/i, /\brussell\s*2000\b/i, /ראסל/] },
  { symbol: 'XAUUSD', patterns: [/\bxau(?:usd)?\b/i, /\bgld\b/i, /\bgold\b/i, /זהב/] },
  { symbol: 'XAGUSD', patterns: [/\bxag(?:usd)?\b/i, /\bslv\b/i, /\bsilver\b/i, /מתכת כסף/, /סילבר/] },
  { symbol: 'USO', patterns: [/\buso\b/i, /\bwti\b/i, /\bcrude\b/i, /\boil\b/i, /נפט/] },
  { symbol: 'EURUSD', patterns: [/\beurusd\b/i, /eur\/usd/i, /יורו[\s/-]*דולר/, /אירו[\s/-]*דולר/] },
  { symbol: 'USDJPY', patterns: [/\busdjpy\b/i, /usd\/jpy/i, /דולר[\s/-]*ין/] },
  { symbol: 'GBPUSD', patterns: [/\bgbpusd\b/i, /gbp\/usd/i, /פאונד[\s/-]*דולר/] },
  { symbol: 'TLT', patterns: [/\btlt\b/i, /\bus10y\b/i, /\b10y\b/i, /אג["״']?ח/, /תשואות/] },
];

const GANN_KEYWORDS = [
  /גאן/i, /\bgann\b/i, /\bsq9\b/i, /square\s*of\s*9/i, /ריבוע\s*9/i, /ריבוע\s*ה?תשע/i,
  /\b[1248]x[1248]\b/i, /מניפת?/i, /סווינג/i, /\bswing\b/i, /הקסגון/i, /גלגל/i,
  /מחזור(?:י|ים)?/i, /\bcycle\b/i, /תאריך\s*היפוך/i, /חלון\s*זמן/i, /נקודת?\s*ציר/i,
  /\bpivot\b/i, /פיבוט/i, /עוגן/i, /\banchor\b/i, /זווית/i, /מעלות/i, /\b(?:45|90|120|135|180|225|270|315|360)\s*(?:°|deg|מעלות)/i,
  /אוקטב/i, /ג׳?נקינס/i, /\bjenkins\b/i, /חוק\s*50%/i, /אמצע\s*טווח/i, /אסטרו/i, /פלאנט/i,
];

const SIGNAL_KEYWORDS = [
  /לונג/i, /שורט/i, /\blong\b/i, /\bshort\b/i, /כניסה/i, /\bentry\b/i, /יעד(?:ים)?/i,
  /\btp\d?\b/i, /\btarget\b/i, /תמיכה/i, /התנגדות/i, /\bsupport\b/i, /\bresistance\b/i,
  /סטופ/i, /\bsl\b/i, /\bstop\s*loss\b/i, /פריצה/i, /שבירה/i, /\bbreakout\b/i,
  /קנייה/i, /מכירה/i, /\bbuy\b/i, /\bsell\b/i, /איתות/i, /\bsignal\b/i,
];

const MACRO_NEWS_KEYWORDS = [
  /\bfed\b/i, /פד\b/, /\bfomc\b/i, /פאוול/i, /\bpowell\b/i, /ריבית/i, /אינפלציה/i,
  /\bcpi\b/i, /\bpce\b/i, /\bnfp\b/i, /דוח(?:ות)?/i, /\bearnings\b/i, /\bguidance\b/i,
  /\betf\b/i, /\bsec\b/i, /מאקרו/i, /\bmacro\b/i, /חדשות/i, /\bnews\b/i, /מכסים/i,
  /\btariffs?\b/i, /\bvix\b/i, /נזילות/i, /\bliquidity\b/i, /תשואות/i, /אג["״']?ח/i,
];

const BULLISH_TERMS = [
  /שורי/i, /לונג/i, /\blong\b/i, /\bbull(?:ish)?\b/i, /עליות/i, /עולה/i, /פריצה\s*למעלה/i,
  /פריצה/i, /\bbreakout\b/i, /קנייה/i, /לקנות/i, /\bbuy\b/i, /איסוף/i, /צבירה/i,
  /\baccumulat/i, /תחתית/i, /\bbottom\b/i, /היפוך\s*למעלה/i, /יעד\s*עליון/i, /חזק/i,
  /חיובי/i, /מעל\s*1x1/i, /מעל\s*50%/i, /זינוק/i, /ראלי/i, /\brally\b/i, /🚀/, /🟢/, /📈/,
];

const BEARISH_TERMS = [
  /דובי/i, /שורט/i, /\bshort\b/i, /\bbear(?:ish)?\b/i, /ירידות/i, /יורד/i, /שבירה/i,
  /\bbreakdown\b/i, /מכירה/i, /למכור/i, /\bsell\b/i, /חלוקה/i, /פיזור/i,
  /שיא\s*מקומי/i, /\btop\b/i, /היפוך\s*למטה/i, /תיקון/i, /זהירות/i, /חלש/i, /שלילי/i,
  /מתחת\s*ל?-?1x1/i, /מתחת\s*ל?-?50%/i, /קריסה/i, /נפילה/i, /\bdump\b/i, /🔴/, /📉/, /⚠️/,
];

function parseNumericPriceToken(rawNum, suffix = '') {
  let clean = String(rawNum || '').replace(/,/g, '').trim();
  const val = Number(clean);
  if (!Number.isFinite(val) || val <= 0) return null;
  if (/^k$/i.test(suffix)) return val * 1000;
  return val;
}

function extractPriceLevels(text) {
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
      // Ignore obvious calendar years like 2025/2026 unless preceded by $ or decimals
      if ((price === 2024 || price === 2025 || price === 2026 || price === 2027) && !m[0].includes('$') && !m[1].includes('.')) continue;
      const key = `${role}|${price}`;
      if (seen.has(key)) continue;
      seen.add(key);
      levels.push({ role, price, raw: m[0].trim() });
    }
  }
  return levels.slice(0, 8);
}

function extractGannDegrees(text) {
  const out = [];
  const re = /(?:^|[^\d])(45|60|90|120|135|144|180|225|240|270|315|360)\s*(?:°|deg(?:rees?)?|מעלות)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const deg = Number(m[1]);
    if (!out.includes(deg)) out.push(deg);
  }
  return out;
}

function extractMentionedDates(text, refDate = new Date()) {
  const out = [];
  const seen = new Set();
  const refYear = refDate.getFullYear();

  // ISO YYYY-MM-DD
  for (const m of text.matchAll(/\b(202[4-9])-(\d{1,2})-(\d{1,2})\b/g)) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (!seen.has(iso)) { seen.add(iso); out.push({ dateIso: iso, raw: m[0] }); }
    }
  }

  // DD/MM/YYYY or DD.MM.YYYY or DD/MM (common in Israel)
  for (const m of text.matchAll(/(?:^|[^\d])(\d{1,2})[/.](\d{1,2})(?:[/.](20\d{2}|\d{2}))?(?!\d)/g)) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = m[3] ? Number(m[3]) : refYear;
    if (y < 100) y += 2000;
    if (d < 1 || d > 31 || mo < 1 || mo > 12) continue;
    // Skip ratios like 1/2, 3/4, 1/8 when no year and no date context
    const idx = m.index || 0;
    const around = text.slice(Math.max(0, idx - 22), Math.min(text.length, idx + 24));
    const hasDateHint = !!m[3] || /תאריך|היפוך|חלון|ציר|פיבוט|ב-|עד|יום|pivot|date|fomc|cpi|דוח|מחזור|אסטרו/i.test(around);
    if (!hasDateHint && d <= 8 && mo <= 8) continue;
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const cleanRaw = m[0].replace(/^[^\d]+/, '').trim();
    if (!seen.has(iso)) { seen.add(iso); out.push({ dateIso: iso, raw: cleanRaw }); }
  }

  // Hebrew month names: e.g. "24 בנובמבר" or "3 לדצמבר"
  const hebMonths = {
    ינואר: 1, פברואר: 2, מרץ: 3, אפריל: 4, מאי: 5, יוני: 6,
    יולי: 7, אוגוסט: 8, ספטמבר: 9, אוקטובר: 10, נובמבר: 11, דצמבר: 12,
  };
  for (const m of text.matchAll(/\b(\d{1,2})\s*[בל]?(ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)(?:\s*(20\d{2}))?/g)) {
    const d = Number(m[1]);
    const mo = hebMonths[m[2]];
    const y = m[3] ? Number(m[3]) : refYear;
    if (d >= 1 && d <= 31 && mo) {
      const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (!seen.has(iso)) { seen.add(iso); out.push({ dateIso: iso, raw: m[0].trim() }); }
    }
  }

  return out.slice(0, 5);
}

function detectSymbols(text) {
  const found = [];
  for (const entry of ASSET_ALIASES) {
    if (entry.patterns.some((re) => re.test(text))) {
      found.push(entry.symbol);
    }
  }
  return found;
}

function detectCategories(text, levels, dates, degrees) {
  const cats = [];
  if (GANN_KEYWORDS.some((re) => re.test(text)) || degrees.length > 0 || levels.some((l) => l.role === 'anchor')) {
    cats.push('gann');
  }
  if (SIGNAL_KEYWORDS.some((re) => re.test(text)) || levels.some((l) => ['target', 'support', 'resistance', 'stop', 'entry'].includes(l.role))) {
    cats.push('signal');
  }
  if (MACRO_NEWS_KEYWORDS.some((re) => re.test(text))) {
    cats.push('macro_news');
  }
  if (!cats.length && dates.length > 0) cats.push('gann');
  return cats;
}

function scoreMessageSentiment(text) {
  let bull = 0;
  let bear = 0;
  for (const re of BULLISH_TERMS) if (re.test(text)) bull += 1;
  for (const re of BEARISH_TERMS) if (re.test(text)) bear += 1;
  if (bull === 0 && bear === 0) return { score: 50, bias: 'neutral' };
  const raw = 50 + ((bull - bear) / (bull + bear + 1)) * 42;
  const score = Math.max(10, Math.min(90, Math.round(raw)));
  const bias = score >= 58 ? 'bullish' : score <= 42 ? 'bearish' : 'neutral';
  return { score, bias };
}

function buildCompactSummary(msg, symbols, categories, levels, dates, degrees) {
  const clean = String(msg.text || '').replace(/\s+/g, ' ').trim();
  const snippet = clean.length > 170 ? `${clean.slice(0, 167)}…` : clean;
  const badges = [];
  if (symbols.length) badges.push(symbols.slice(0, 3).join('/'));
  if (degrees.length) badges.push(`Sq9 ${degrees.map((d) => `${d}°`).join('/')}`);
  if (levels.length) {
    const roleHe = { target: 'יעד', support: 'תמיכה', resistance: 'התנגדות', stop: 'סטופ', entry: 'כניסה', anchor: 'עוגן' };
    badges.push(levels.slice(0, 3).map((l) => `${roleHe[l.role] || l.role} ${l.price}`).join(' · '));
  }
  if (dates.length) badges.push(`תאריך ${dates.map((d) => d.dateIso).join(', ')}`);
  return badges.length ? `[${badges.join(' | ')}] ${snippet}` : snippet;
}

function makeMessageId(msg, idx) {
  const raw = `${msg.timestampRaw || ''}|${msg.author || ''}|${String(msg.text || '').slice(0, 80)}|${idx}`;
  return 'wa_' + crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12);
}

/**
 * Analyze chronologically ordered raw messages extracted from the whitelisted WhatsApp group.
 * Preserves author name, timestamp, full source message, and surrounding before/after context.
 */
export function analyzeWhatsAppMessages(rawMessages = [], groupName = '') {
  const normalized = (rawMessages || [])
    .map((m, i) => ({
      id: m.id || makeMessageId(m, i),
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
        latestAt: '',
        latestSummary: '',
      };
    }
    return assetBuckets[sym];
  };

  const total = normalized.length;
  for (let i = 0; i < total; i++) {
    const msg = normalized[i];
    // Combine message text + quoted reply text (if any) for symbol resolution
    const textForDetection = msg.quotedText ? `${msg.text} ${msg.quotedText}` : msg.text;
    const symbols = detectSymbols(textForDetection);
    const levels = extractPriceLevels(msg.text);
    const degrees = extractGannDegrees(msg.text);
    const dates = extractMentionedDates(msg.text);
    const categories = detectCategories(msg.text, levels, dates, degrees);
    const sent = scoreMessageSentiment(msg.text);

    const isRelevant = symbols.length > 0 || categories.length > 0 || levels.length > 0 || dates.length > 0 || degrees.length > 0;
    if (!isRelevant) continue;

    // Context before (up to 3 messages) and after (up to 3 messages) for exact source inspection
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

    const effectiveSymbols = symbols.length ? symbols : ['MACRO'];
    const recencyWeight = 0.6 + 0.8 * ((i + 1) / Math.max(1, total)); // newer messages carry higher weight

    const insight = {
      id: msg.id,
      index: msg.index,
      author: msg.author,
      timestampRaw: msg.timestampRaw,
      symbols: effectiveSymbols,
      categories: categories.length ? categories : ['macro_news'],
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
      b.weightedScoreSum += sent.score * recencyWeight;
      b.weightSum += recencyWeight;
      b.authors.add(msg.author);
      b.latestAt = msg.timestampRaw || b.latestAt;
      b.latestSummary = insight.summary;
      for (const lv of levels) {
        const entry = { ...lv, symbol: sym, author: msg.author, timestampRaw: msg.timestampRaw, insightId: msg.id };
        b.levels.push(entry);
        allLevels.push(entry);
      }
      for (const dt of dates) {
        const entry = { ...dt, symbol: sym, author: msg.author, timestampRaw: msg.timestampRaw, insightId: msg.id, snippet: msg.text.slice(0, 100) };
        b.dates.push(entry);
        allDates.push(entry);
      }
      for (const deg of degrees) {
        if (!b.degrees.includes(deg)) b.degrees.push(deg);
      }
    }
  }

  // Finalize per-asset signal map
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
      levels: b.levels.slice(-14).reverse(),
      dates: b.dates.slice(-10).reverse(),
      degrees: b.degrees,
      latestAt: b.latestAt,
      latestSummary: b.latestSummary,
    };
    overallSum += score * b.mentions;
    overallWeight += b.mentions;
  }

  const overallScore = overallWeight > 0 ? Math.round(overallSum / overallWeight) : 50;
  const overallBias = overallScore >= 58 ? 'שורי' : overallScore <= 42 ? 'דובי' : 'מאוזן';

  // Newest insights first for display
  const sortedInsights = insights.slice(-60).reverse();

  return {
    ok: true,
    groupName: groupName || 'קבוצת וואטסאפ',
    scannedAt: Date.now(),
    totalMessagesRead: normalized.length,
    relevantInsightsCount: insights.length,
    overallScore,
    overallBias,
    assetSignals,
    keyLevels: allLevels.slice(-24).reverse(),
    keyDates: allDates.slice(-16).reverse(),
    insights: sortedInsights,
    aiSummary: null,
  };
}

async function synthesizeWhatsAppWithLocalAi(report) {
  if (!report?.insights?.length) return null;
  const candidates = [
    { url: 'http://127.0.0.1:11434/v1/chat/completions', tagsUrl: 'http://127.0.0.1:11434/api/tags' },
  ];
  for (const c of candidates) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3500);
      const tagsRes = await fetch(c.tagsUrl, { signal: ctrl.signal });
      clearTimeout(t);
      if (!tagsRes.ok) continue;
      const tagsData = await tagsRes.json();
      const models = (tagsData.models || []).map((m) => m.name).filter(Boolean);
      const model = models.find((m) => /qwen2\.5|llama3/i.test(m)) || models[0];
      if (!model) continue;

      const lines = report.insights.slice(0, 16).map((ins) =>
        `• [${ins.timestampRaw || '—'}] ${ins.author} (${ins.symbols.join('/')} · ${ins.bias}): ${ins.sourceMessage.text.slice(0, 220)}`,
      ).join('\n');

      const ctrl2 = new AbortController();
      const t2 = setTimeout(() => ctrl2.abort(), 28000);
      const res = await fetch(c.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl2.signal,
        body: JSON.stringify({
          model,
          temperature: 0.25,
          max_tokens: 460,
          messages: [
            {
              role: 'system',
              content: 'אתה אנליסט גאן ושוק ההון בכיר ב-Alta Capital. סכם בקצרה ובעברית ברורה (5–6 נקודות) את התובנות המרכזיות מקבוצת הוואטסאפ: נכסים מרכזיים, רמות מחיר/תמיכות/יעדים, תאריכי היפוך גאן ומי אמר מה. אל תמציא אף מספר או שם שלא הופיע בהודעות.',
            },
            {
              role: 'user',
              content: `קבוצה: "${report.groupName}" (${report.relevantInsightsCount} תובנות רלוונטיות מתוך ${report.totalMessagesRead} הודעות).\n\nהודעות אחרונות:\n${lines}`,
            },
          ],
        }),
      });
      clearTimeout(t2);
      if (!res.ok) continue;
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (text) return { model, text, generatedAt: Date.now() };
    } catch { /* fallback cleanly without AI */ }
  }
  return null;
}

export function sanitizeWhatsAppReportForSync(report) {
  if (!report || typeof report !== 'object') return null;
  return {
    ok: !!report.ok,
    groupName: report.groupName || '',
    scannedAt: report.scannedAt || Date.now(),
    totalMessagesRead: Number(report.totalMessagesRead) || 0,
    relevantInsightsCount: Number(report.relevantInsightsCount) || 0,
    overallScore: Number(report.overallScore) || 50,
    overallBias: report.overallBias || 'מאוזן',
    assetSignals: report.assetSignals || {},
    keyLevels: (report.keyLevels || []).slice(0, 24),
    keyDates: (report.keyDates || []).slice(0, 16),
    insights: (report.insights || []).slice(0, 45),
    aiSummary: report.aiSummary || null,
  };
}

// ---------------------------------------------------------------------------
// Interactive QR Login & Single-Group Read-Only Scanner
// ---------------------------------------------------------------------------

export async function launchWhatsAppLogin({ timeoutMs = 240_000 } = {}) {
  const pw = await loadPlaywright();
  if (!pw) {
    return { ok: false, error: 'Playwright אינו מותקן. הרץ: npm run setup:x-agent:win (הוא מתקין playwright-core שמשמש גם לוואטסאפ).' };
  }
  const cfg = loadWhatsAppConfig();
  let context = null;
  try {
    const launched = await launchWhatsAppBrowser(pw.chromium, {
      headless: false, // Always visible so user can scan QR safely
      browserPreference: cfg.browserPreference || 'auto',
    });
    context = launched.context;
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 45_000 });

    const deadline = Date.now() + timeoutMs;
    let ready = false;
    while (Date.now() < deadline) {
      if (await isWhatsAppReady(page)) {
        ready = true;
        break;
      }
      await sleep(1800);
    }

    if (!ready) {
      return { ok: false, error: 'תם הזמן להמתנה לסריקת QR ב-WhatsApp Web. נסה שוב וסרוק את הקוד מהטלפון.' };
    }

    // Wait briefly for chat titles to hydrate, then discover group names
    await sleep(2500);
    const groups = await listVisibleChats(page);
    saveWhatsAppConfig({
      loggedIn: true,
      loggedInAt: new Date().toISOString(),
      discoveredGroups: groups.length ? groups : cfg.discoveredGroups,
    });
    return {
      ok: true,
      loggedIn: true,
      browser: launched.browserLabel,
      discoveredGroups: groups,
      message: `WhatsApp Web חובר בהצלחה (${groups.length} צ׳אטים זוהו). כעת בחר את שם הקבוצה הספציפית לסריקה.`,
    };
  } catch (err) {
    return { ok: false, error: `שגיאה בחיבור WhatsApp Web: ${err.message}` };
  } finally {
    if (context) {
      try { await context.close(); } catch { /* ignore */ }
    }
  }
}

async function openTargetGroupReadOnly(page, groupName) {
  const targetLower = groupName.trim().toLowerCase();

  // 1. Try direct click in visible #pane-side list first
  const directFound = await page.evaluate((target) => {
    const pane = document.querySelector('#pane-side');
    if (!pane) return false;
    const spans = [...pane.querySelectorAll('span[title]')];
    const exact = spans.find((s) => (s.getAttribute('title') || '').trim().toLowerCase() === target);
    const partial = exact || spans.find((s) => (s.getAttribute('title') || '').trim().toLowerCase().includes(target));
    if (partial) {
      partial.scrollIntoView({ block: 'center' });
      partial.click();
      return true;
    }
    return false;
  }, targetLower);

  if (directFound) {
    await sleep(2200);
    return true;
  }

  // 2. Otherwise search in the left chat-list search box (read-only navigation)
  const searchSelectors = [
    '[data-testid="chat-list-search"]',
    'div[contenteditable="true"][data-tab="3"]',
    '#side div[contenteditable="true"][role="textbox"]',
    '#side input[type="text"]',
  ];
  let searchEl = null;
  for (const sel of searchSelectors) {
    searchEl = await page.$(sel);
    if (searchEl) break;
  }
  if (!searchEl) return false;

  await searchEl.click();
  await sleep(300);
  await page.keyboard.press('Control+A').catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
  await page.keyboard.type(groupName.trim(), { delay: 35 });
  await sleep(1800);

  const clickedAfterSearch = await page.evaluate((target) => {
    const pane = document.querySelector('#pane-side') || document.querySelector('#side');
    if (!pane) return false;
    const spans = [...pane.querySelectorAll('span[title]')];
    const exact = spans.find((s) => (s.getAttribute('title') || '').trim().toLowerCase() === target);
    const partial = exact || spans.find((s) => (s.getAttribute('title') || '').trim().toLowerCase().includes(target));
    if (partial) {
      partial.click();
      return true;
    }
    return false;
  }, targetLower);

  if (!clickedAfterSearch) return false;
  await sleep(2200);
  return true;
}

async function extractMessagesFromOpenChat(page, { scrollPasses = 5, maxMessages = 90 } = {}) {
  // Scroll up inside the main conversation panel to load recent history
  for (let pass = 0; pass < scrollPasses; pass++) {
    await page.evaluate(() => {
      const main = document.querySelector('#main');
      if (!main) return;
      const scroller = main.querySelector('[data-testid="conversation-panel-messages"], div[role="application"]')?.parentElement
        || [...main.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 120 && d.clientHeight > 250);
      if (scroller) {
        scroller.scrollTop = Math.max(0, scroller.scrollTop - 1100);
      }
    });
    await sleep(900);
  }

  // Extract all visible messages in chronological order
  return await page.evaluate((limit) => {
    const main = document.querySelector('#main');
    if (!main) return { headerTitle: '', messages: [] };

    const headerTitle = (
      main.querySelector('header span[title]')?.getAttribute('title')
      || main.querySelector('header span[dir="auto"]')?.innerText
      || ''
    ).trim();

    const rows = [...main.querySelectorAll('div[role="row"], div.message-in, div.message-out')];
    const seenKeys = new Set();
    const out = [];

    for (const row of rows) {
      const msgNode = row.matches('.message-in, .message-out')
        ? row
        : (row.querySelector('.message-in, .message-out') || row);

      const copyable = msgNode.querySelector('[data-pre-plain-text]');
      const prePlain = copyable?.getAttribute('data-pre-plain-text') || '';

      // Extract text spans (excluding timestamps/meta)
      const textSpans = [...msgNode.querySelectorAll('span.selectable-text, span._ao3e.selectable-text, div.copyable-text span[dir]')];
      let text = '';
      if (textSpans.length) {
        // Deduplicate nested spans by taking outermost selectable-text elements
        const topSpans = textSpans.filter((s) => !s.parentElement?.closest('span.selectable-text'));
        text = topSpans.map((s) => s.innerText || '').join('\n').trim();
      }
      if (!text && copyable) text = (copyable.innerText || '').trim();
      if (!text || text.length < 2) continue;

      // Quoted reply snippet if present
      const quoteEl = msgNode.querySelector('[data-testid="quoted-message"], div[aria-label*="Quoted"], div[role="button"] span.quoted-mention');
      const quotedText = quoteEl ? (quoteEl.innerText || '').trim().slice(0, 240) : null;

      // Parse "[14:32, 19/11/2026] Author Name: " from data-pre-plain-text
      let timestampRaw = '';
      let author = '';
      const preMatch = prePlain.match(/^\[([^\]]+)\]\s*([^:]+):\s*$/);
      if (preMatch) {
        timestampRaw = preMatch[1].trim();
        author = preMatch[2].trim();
      } else {
        const metaTime = msgNode.querySelector('[data-testid="msg-meta"] span, span[dir="auto"][class*="time"]')?.innerText?.trim() || '';
        timestampRaw = metaTime;
        const senderEl = msgNode.querySelector('[data-testid="author"], span[dir="auto"][style*="color"]');
        author = (senderEl?.innerText || '').trim();
      }

      const isOutgoing = msgNode.classList.contains('message-out');
      if (!author) author = isOutgoing ? 'אני' : 'חבר קבוצה';

      // Remove quoted text prefix if accidentally duplicated at start of text
      if (quotedText && text.startsWith(quotedText) && text.length > quotedText.length + 2) {
        text = text.slice(quotedText.length).trim();
      }

      const dedupeKey = `${timestampRaw}|${author}|${text.slice(0, 70)}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      out.push({ author, timestampRaw, text, quotedText, isOutgoing });
    }

    return { headerTitle, messages: out.slice(-limit) };
  }, maxMessages);
}

export async function runWhatsAppGroupScan(opts = {}) {
  const pw = await loadPlaywright();
  if (!pw) {
    return { ok: false, error: 'Playwright אינו מותקן. הרץ: npm run setup:x-agent:win' };
  }
  const cfg = loadWhatsAppConfig();
  const targetGroup = String(opts.groupName || cfg.groupName || '').trim();
  if (!targetGroup) {
    return { ok: false, error: 'לא הוגדר שם קבוצת וואטסאפ לסריקה. הזן או בחר שם קבוצה ושמור לפני הסריקה.' };
  }

  let context = null;
  try {
    const visible = opts.visibleBrowser !== undefined ? !!opts.visibleBrowser : cfg.visibleBrowser !== false;
    const launched = await launchWhatsAppBrowser(pw.chromium, {
      headless: !visible,
      browserPreference: cfg.browserPreference || 'auto',
    });
    context = launched.context;
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 45_000 });

    const deadline = Date.now() + 45_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (await isWhatsAppReady(page)) {
        ready = true;
        break;
      }
      if (await isQrScreenVisible(page)) {
        saveWhatsAppConfig({ loggedIn: false });
        return {
          ok: false,
          needsLogin: true,
          error: 'נדרשת התחברות (סריקת QR) ל-WhatsApp Web. לחץ על "חבר WhatsApp Web (QR)" וסרוק מהטלפון.',
        };
      }
      await sleep(1500);
    }

    if (!ready) {
      return { ok: false, error: 'WhatsApp Web לא סיים להיטען בזמן. נסה שוב או בדוק חיבור אינטרנט.' };
    }

    await sleep(1800);
    const visibleGroups = await listVisibleChats(page);
    if (visibleGroups.length) {
      saveWhatsAppConfig({ loggedIn: true, discoveredGroups: visibleGroups });
    }

    const opened = await openTargetGroupReadOnly(page, targetGroup);
    if (!opened) {
      return {
        ok: false,
        error: `לא נמצאה קבוצה בשם "${targetGroup}" ברשימת הצ׳אטים שלך. ודא שהשם מדויק (או בחר מהרשימה שזוהתה).`,
        discoveredGroups: visibleGroups,
      };
    }

    const extracted = await extractMessagesFromOpenChat(page, {
      scrollPasses: Number(opts.scrollPasses) || cfg.scrollPasses || 5,
      maxMessages: Number(opts.maxMessages) || cfg.maxMessages || 90,
    });

    const report = analyzeWhatsAppMessages(extracted.messages, extracted.headerTitle || targetGroup);
    const aiSummary = await synthesizeWhatsAppWithLocalAi(report).catch(() => null);
    if (aiSummary) report.aiSummary = aiSummary;

    const cleanReport = sanitizeWhatsAppReportForSync(report);
    ensureDataDir();
    fs.writeFileSync(WA_REPORT_PATH, JSON.stringify(cleanReport, null, 2), 'utf8');

    return {
      ok: true,
      report: cleanReport,
      discoveredGroups: visibleGroups,
    };
  } catch (err) {
    return { ok: false, error: `שגיאה בסריקת קבוצת הוואטסאפ: ${err.message}` };
  } finally {
    if (context) {
      try { await context.close(); } catch { /* ignore */ }
    }
  }
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Set(process.argv.slice(2));
  if (args.has('--login')) {
    const out = await launchWhatsAppLogin();
    console.log(JSON.stringify(out, null, 2));
    process.exit(out.ok ? 0 : 1);
  } else if (args.has('--scan')) {
    const groupIdx = process.argv.indexOf('--group');
    const groupName = groupIdx > -1 ? process.argv[groupIdx + 1] : undefined;
    const out = await runWhatsAppGroupScan({ groupName });
    console.log(JSON.stringify(out, null, 2));
    process.exit(out.ok ? 0 : 1);
  } else {
    const st = await getWhatsAppAgentStatus();
    console.log(JSON.stringify(st, null, 2));
  }
}
