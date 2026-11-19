// Prop Firm / Nostro Challenge Autonomous Dashboard, Infographic & Excel Proof Reporter (#/nostro)

import { store } from '../store.js';
import { h, mount, money, pct, num, tag, chart, notice, empty, toast, timeAgo, openModal, downloadFile } from '../ui.js';
import { STRATEGIES, describeParams } from '../strategies.js';
import { buildArtifact } from '../platforms.js';
import {
  DEFAULT_NOSTRO_RULES,
  NOSTRO_BOT_TEMPLATES,
  PROP_FIRM_PROFILES,
  runNostroBot,
  runNostroFleetSimulation,
  buildNostroExcelXml,
} from '../nostro.js';

let runningFleet = false;
let showInfographic = false;
let showDetailedReport = true;
let autoTimer = null;

function svgEl(tagName, attrs, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tagName);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
  if (text != null) node.textContent = text;
  return node;
}

function renderNostroInfographicSvg(bots, rules) {
  const width = 920;
  const height = 290;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.style.width = '100%';
  svg.style.height = 'auto';
  svg.style.display = 'block';
  svg.style.background = 'linear-gradient(180deg, #0b1220, #070c14)';
  svg.style.borderRadius = '12px';

  // Left: Return vs Phase 1 & Phase 2 Targets
  svg.appendChild(svgEl('text', { x: 24, y: 24, fill: '#e2e8f0', 'font-size': '13', 'font-weight': '700' }, 'תשואה בפועל מול יעדי שלב 1 ו-2 (%)'));
  const maxRet = Math.max(20, ...bots.map((b) => Math.abs(b.totalReturnPct || 0)));
  const barX0 = 175;
  const barMaxW = 240;
  const p1Target = rules.phase1TargetPct;
  const p2Target = rules.phase1TargetPct + (rules.phase2TargetPct || 0);

  // Target guide lines
  [
    { val: p1Target, label: `שלב 1 (${p1Target}%)`, col: '#3b82f6' },
    { val: p2Target, label: `Funded (${p2Target}%)`, col: '#f2cc60' },
  ].forEach((g) => {
    const gx = barX0 + Math.min(1, g.val / maxRet) * barMaxW;
    svg.appendChild(svgEl('line', { x1: gx, x2: gx, y1: 38, y2: 255, stroke: g.col, 'stroke-dasharray': '3,3', 'stroke-width': 1.4 }));
    svg.appendChild(svgEl('text', { x: gx - 18, y: 272, fill: g.col, 'font-size': '9.5' }, g.label));
  });

  bots.forEach((b, i) => {
    const y = 52 + i * 40;
    const ret = b.totalReturnPct || 0;
    const w = Math.max(4, (Math.min(maxRet, Math.max(0, ret)) / maxRet) * barMaxW);
    const col = b.status === 'funded' ? '#2ecc71' : b.status === 'phase2' ? '#3b82f6' : b.status === 'failed' ? '#f05b5b' : '#a78bfa';
    svg.appendChild(svgEl('text', { x: 16, y: y + 14, fill: '#cbd5e1', 'font-size': '10.5' }, `${b.symbol} (${b.name.split('·')[0].trim()})`));
    svg.appendChild(svgEl('rect', { x: barX0, y, width: barMaxW, height: 18, rx: 4, fill: '#111c2e' }));
    svg.appendChild(svgEl('rect', { x: barX0, y, width: w, height: 18, rx: 4, fill: col }));
    svg.appendChild(svgEl('text', { x: barX0 + barMaxW + 8, y: y + 13, fill: ret >= 0 ? '#2ecc71' : '#f05b5b', 'font-size': '10.5', 'font-weight': '700' }, `${ret >= 0 ? '+' : ''}${ret}%`));
  });

  // Right: Risk Compliance (Total DD vs 10% & Daily Loss vs 5%)
  const rx0 = 510;
  svg.appendChild(svgEl('text', { x: rx0, y: 24, fill: '#e2e8f0', 'font-size': '13', 'font-weight': '700' }, 'עמידה בתקרות הסיכון (Daily 5% · Total DD 10%)'));
  const ddWallX = rx0 + 180;
  svg.appendChild(svgEl('line', { x1: ddWallX, x2: ddWallX, y1: 38, y2: 255, stroke: '#f05b5b', 'stroke-dasharray': '4,3', 'stroke-width': 1.4 }));
  svg.appendChild(svgEl('text', { x: ddWallX - 28, y: 272, fill: '#f05b5b', 'font-size': '9.5' }, `תקרת DD (${rules.maxTotalDdPct}%)`));

  bots.forEach((b, i) => {
    const y = 52 + i * 40;
    const dd = b.maxTotalDdPct || 0;
    const daily = b.maxDailyLossPct || 0;
    const ddW = Math.min(210, (dd / Math.max(12, rules.maxTotalDdPct * 1.2)) * 180);
    const col = dd < rules.maxTotalDdPct && daily < rules.maxDailyLossPct ? '#2ecc71' : '#f05b5b';
    svg.appendChild(svgEl('rect', { x: rx0, y, width: 180, height: 18, rx: 4, fill: '#111c2e' }));
    svg.appendChild(svgEl('rect', { x: rx0, y, width: ddW, height: 18, rx: 4, fill: col }));
    svg.appendChild(svgEl('text', { x: rx0 + 190, y: y + 13, fill: '#cbd5e1', 'font-size': '10' }, `DD ${dd}% · יומי ${daily}%`));
  });

  return svg;
}

function downloadExcelReport(nostroState) {
  const xml = buildNostroExcelXml(nostroState);
  const blob = new Blob(['\uFEFF', xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `alta-capital-nostro-proof-${new Date().toISOString().slice(0, 10)}.xls`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('הדוח המפורט יוצא לאקסל בהצלחה!', 'ok');
}

export function renderNostro(root, ui) {
  const nostro = store.state.nostro || { rules: { ...DEFAULT_NOSTRO_RULES }, bots: [], autoMode: true, updatedAt: null };
  const rules = { ...DEFAULT_NOSTRO_RULES, ...(nostro.rules || {}) };
  const bots = nostro.bots || [];
  const autoMode = nostro.autoMode !== false;

  const acctSel = h('select', { class: 'input' }, [
    [25000, '$25,000'],
    [50000, '$50,000'],
    [100000, '$100,000'],
    [200000, '$200,000'],
  ].map(([v, l]) => h('option', { value: v, selected: rules.accountSize === v }, `תיק ${l}`)));

  const p1Sel = h('select', { class: 'input' }, [8, 10].map((v) =>
    h('option', { value: v, selected: rules.phase1TargetPct === v }, `שלב 1: +${v}%`)
  ));

  const runAll = async (doOptimize = false, silent = false) => {
    if (runningFleet) return;
    runningFleet = true;
    ui.rerender();
    try {
      await runNostroFleetSimulation({
        accountSize: Number(acctSel.value) || 100000,
        phase1TargetPct: Number(p1Sel.value) || 8,
      }, { doOptimize, forceLive: true });
      if (!silent) toast(doOptimize ? 'מיטוב ומבחן נוסטרו הושלמו על נתוני אמת!' : 'בדיקת הנוסטרו בזמן אמת הושלמה!', 'ok');
    } catch (err) {
      if (!silent) toast('שגיאה בהרצת מבחן נוסטרו: ' + err.message, 'bad');
    } finally {
      runningFleet = false;
      ui.rerender();
    }
  };

  // Autonomous Auto-Run on page visit if empty or stale (> 3 minutes)
  const isStale = !nostro.updatedAt || (Date.now() - nostro.updatedAt > 180_000);
  if (autoMode && (!bots.length || isStale) && !runningFleet) {
    setTimeout(() => runAll(false, true), 50);
  }
  if (autoMode && !autoTimer) {
    autoTimer = setInterval(() => {
      if (store.state.nostro?.autoMode !== false && !runningFleet) {
        runAll(false, true);
      }
    }, 180_000);
  }

  const readyBots = bots.filter((b) => (b.readyFirms || []).length > 0);
  const fundedBots = bots.filter((b) => b.status === 'funded');
  const totalFundedPayout = bots.reduce((s, b) => s + (b.fundedProfitUsd || 0), 0);
  const liveCount = bots.filter((b) => !b.isSynthetic && b.dataProvider).length;

  mount(root,
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: 'Autonomous Prop Firm Engine · FTMO · The5ers · FundedNext · Topstep · Apex' }),
        h('h1', { text: 'מבחני נוסטרו אוטומטיים (Prop Firm Bot Fleet)' }),
        h('p', { text: 'המערכת בוחנת אוטומטית בזמן אמת 5 בוטים מול חוקי החברות המובילות בעולם, מתריעה אילו בוטים מוכנים לעבור ולאיזו חברה, ומפיקה דוח הוכחות ומקורות לייצוא לאקסל.' }),
      ),
      h('div', { class: 'head-actions' },
        acctSel,
        p1Sel,
        h('button', {
          class: `btn btn-sm ${autoMode ? 'btn-primary' : ''}`,
          onclick: () => {
            store.state.nostro = { ...(store.state.nostro || {}), autoMode: !autoMode };
            store.save();
            ui.rerender();
          },
        }, autoMode ? '● אוטומטי פעיל' : '○ אוטומטי מושהה'),
        h('button', {
          class: 'btn btn-sm',
          disabled: runningFleet,
          onclick: () => runAll(false),
        }, runningFleet ? 'בודק נתוני אמת…' : '⟳ רענן נתוני אמת'),
        h('button', {
          class: 'btn btn-sm btn-primary',
          disabled: runningFleet,
          onclick: () => runAll(true),
        }, runningFleet ? 'ממטב…' : '⚡ מטב + אמת מחדש'),
        h('button', {
          class: `btn btn-sm ${showInfographic ? 'btn-primary' : ''}`,
          onclick: () => { showInfographic = !showInfographic; ui.rerender(); },
        }, showInfographic ? '✖ סגור אינפוגרפיקה' : '📊 פתח אינפוגרפיקה'),
        h('button', {
          class: 'btn btn-sm',
          disabled: !bots.length,
          onclick: () => downloadExcelReport(nostro),
        }, '📥 ייצא דוח לאקסל (.xls)'),
      ),
    ),
  );

  // Live Readiness Verdict Banner
  if (readyBots.length) {
    const verdict = readyBots.map((b) => `${b.name} (${b.symbol}) → מוכן ל: ${b.readyFirms.join(', ')}`).join(' | ');
    mount(root, notice(`🏆 חיווי מוכנות בזמן אמת (${liveCount}/${bots.length} על נתוני שוק חיים): ${verdict}`, 'ok'));
  } else if (runningFleet) {
    mount(root, notice('⏳ מריץ כעת בדיקה אוטומטית על נתוני שוק חיים בזמן אמת מול 5 חברות נוסטרו…', 'blue'));
  } else {
    mount(root, notice('טרם נמצאו בוטים שעברו את כל תנאי המבחן — לחץ על "⚡ מטב + אמת מחדש" כדי לכייל את הפרמטרים לנוסטרו.', 'blue'));
  }

  // KPI Row (using exact bots.length so counts always match the cards below!)
  mount(root, h('div', { class: 'grid cols-4', style: { marginTop: '14px' } },
    h('div', { class: 'metric' }, h('span', { text: 'בוטים מוכנים לחברות נוסטרו' }), h('b', { class: readyBots.length ? 'green mono' : 'mono', text: `${readyBots.length}/${bots.length}` })),
    h('div', { class: 'metric' }, h('span', { text: 'עברו Funded בחוקי התיק' }), h('b', { class: fundedBots.length ? 'green mono' : 'mono', text: `${fundedBots.length}/${bots.length}` })),
    h('div', { class: 'metric' }, h('span', { text: 'רווח משוער למשיכה (Funded)' }), h('b', { class: 'green mono', text: money(totalFundedPayout) })),
    h('div', { class: 'metric' }, h('span', { text: 'עדכון נתוני אמת אחרון' }), h('b', { class: 'small', text: nostro.updatedAt ? timeAgo(nostro.updatedAt) : 'מאתחל…' })),
  ));

  // Toggleable Infographic Panel (opens and closes via the button!)
  if (showInfographic && bots.length) {
    mount(root,
      h('div', { class: 'card', style: { marginTop: '14px', borderColor: 'rgba(59, 130, 246, 0.45)' } },
        h('div', { class: 'card-head' },
          h('div', {},
            h('h2', { text: '📊 אינפוגרפיקת מוכנות לנוסטרו (תשואה מול תקרות סיכון)' }),
            h('div', { class: 'card-sub', text: 'השוואה ויזואלית של כל בוט מול יעדי שלב 1/2 ומגבלות Drawdown של חברות הנוסטרו' }),
          ),
          h('button', { class: 'btn btn-sm', onclick: () => { showInfographic = false; ui.rerender(); } }, '✖ סגור אינפוגרפיקה'),
        ),
        renderNostroInfographicSvg(bots, rules),
      ),
    );
  }

  if (!bots.length) {
    mount(root, h('div', { class: 'card', style: { marginTop: '14px' } },
      empty('טוען ומריץ אוטומטית את 5 הבוטים מול נתוני שוק בזמן אמת…'),
    ));
    return;
  }

  const inProgressBots = bots.filter((b) => !(b.readyFirms || []).length && b.status !== 'failed');
  const failedBots = bots.filter((b) => !(b.readyFirms || []).length && b.status === 'failed');

  const renderBotCard = (bot) => {
    const isReady = (bot.readyFirms || []).length > 0;
    const badgeText = isReady
      ? (bot.status === 'funded' ? bot.statusLabel : `🏆 מוכן ל-${bot.readyFirms.length} חברות`)
      : bot.statusLabel;
    const cls = isReady || bot.status === 'funded' ? 'live' : bot.status === 'phase2' ? 'opt' : bot.status === 'failed' ? 'red' : 'dry';
    return h('div', {
      class: 'card',
      style: { borderColor: isReady ? 'rgba(46, 204, 113, 0.55)' : bot.status === 'failed' ? 'rgba(240, 91, 91, 0.35)' : undefined },
    },
      h('div', { class: 'card-head' },
        h('div', {},
          h('h2', { text: bot.name }),
          h('div', { class: 'card-sub', text: `${bot.symbol} · ${bot.tf} · ${STRATEGIES[bot.strategyId]?.label || bot.strategyId} · מקור: ${bot.dataProvider || 'Live'} (${bot.isSynthetic ? 'גיבוי' : 'זמן אמת'})` }),
        ),
        tag(badgeText, cls),
      ),
      h('div', { class: 'row wrap', style: { gap: '6px', marginBottom: '8px' } },
        tag(bot.sourceDeskLabel ? `🧬 מופרד מבוט קיים: ${bot.sourceDeskLabel}` : '🏆 בוט נוסטרו ייעודי', 'opt'),
        tag(`סיכון: ${((bot.riskPerTrade || 0.0055) * 100).toFixed(2)}%`, 'dry'),
        isReady
          ? bot.readyFirms.map((fn) => tag(`✓ מוכן ל-${fn}`, 'live'))
          : tag('טרם עמד בתנאי חברה', 'dry'),
      ),
      bot.breached ? h('div', { class: 'notice bad', style: { marginBottom: '8px' }, text: bot.breached }) : null,
      h('div', { class: 'grid cols-3', style: { gap: '8px', marginBottom: '10px' } },
        h('div', { class: 'metric' }, h('span', { text: 'תשואה כוללת' }), h('b', { class: (bot.totalReturnPct >= 0 ? 'green ' : 'red ') + 'mono', text: pct(bot.totalReturnPct) })),
        h('div', { class: 'metric' }, h('span', { text: 'Max DD כולל' }), h('b', { class: (bot.maxTotalDdPct < rules.maxTotalDdPct ? 'green ' : 'red ') + 'mono', text: `${bot.maxTotalDdPct}% / ${rules.maxTotalDdPct}%` })),
        h('div', { class: 'metric' }, h('span', { text: 'הפסד יומי שיא' }), h('b', { class: (bot.maxDailyLossPct < rules.maxDailyLossPct ? 'green ' : 'red ') + 'mono', text: `${bot.maxDailyLossPct}% / ${rules.maxDailyLossPct}%` })),
        h('div', { class: 'metric' }, h('span', { text: 'Profit Factor' }), h('b', { class: 'mono', text: bot.metrics?.profitFactor ?? '—' })),
        h('div', { class: 'metric' }, h('span', { text: 'עסקאות' }), h('b', { class: 'mono', text: bot.metrics?.trades ?? 0 })),
        h('div', { class: 'metric' }, h('span', { text: 'משיכה Funded' }), h('b', { class: 'green mono', text: money(bot.fundedProfitUsd || 0) })),
      ),
      bot.curve?.length ? chart(bot.curve, { height: 90, color: bot.status === 'failed' && !isReady ? 'red' : 'green', showZero: false }) : null,
      h('div', { class: 'tiny muted', style: { marginTop: '8px' }, text: `פרמטרים: ${describeParams(bot.strategyId, bot.params)} · מעבר שלב 1: ${bot.phase1PassedDate || '—'} · שלב 2: ${bot.phase2PassedDate || '—'}` }),
      h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '10px' } },
        h('button', {
          class: 'btn btn-sm',
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.textContent = 'ממטב…';
            try {
              const updated = await runNostroBot(bot, rules, { doOptimize: true, forceLive: true });
              const idx = store.state.nostro.bots.findIndex((b) => b.id === bot.id);
              if (idx >= 0) store.state.nostro.bots[idx] = updated;
              store.save();
              toast(`${bot.name}: ${updated.readyFirms?.length ? 'מוכן ל-' + updated.readyFirms.join(', ') : updated.statusLabel}`, updated.readyFirms?.length ? 'ok' : '');
            } catch (err) {
              toast('שגיאה: ' + err.message, 'bad');
            } finally {
              btn.disabled = false;
              ui.rerender();
            }
          },
        }, '⚙ מטב בוט זה לנוסטרו'),
        h('button', {
          class: 'btn btn-sm',
          onclick: () => {
            const platform = store.state.settings.platform || 'freqtrade';
            const art = buildArtifact({
              id: bot.id,
              label: bot.name,
              short: bot.symbol,
              symbol: bot.symbol,
              tf: bot.tf,
              version: 'nostro-v1',
              params: bot.params,
              strategyId: bot.strategyId,
              metrics: bot.metrics || { returnPct: bot.totalReturnPct, profitFactor: 0, maxDrawdownPct: bot.maxTotalDdPct, trades: 0 },
              oosMetrics: { returnPct: bot.totalReturnPct },
            }, platform);
            const pre = h('pre', { class: 'code', text: art.code });
            openModal(`${bot.name} · ${art.filename}`,
              h('div', {},
                h('div', { class: 'row between', style: { marginBottom: '8px' } },
                  h('span', { class: 'small muted', text: `קוד בוט נוסטרו מופרד (${platform}) · סיכון ${((bot.riskPerTrade || 0.0055) * 100).toFixed(2)}%` }),
                  h('button', { class: 'btn btn-sm btn-primary', onclick: () => downloadFile(art.filename, art.code, 'text/plain') }, 'הורד קובץ'),
                ),
                pre,
              ),
              { wide: true },
            );
          },
        }, '</> ייצא קוד בוט נוסטרו מופרד'),
      ),
    );
  };

  const renderCategorySection = (title, subtitle, accentColor, list) => {
    if (!list.length) return null;
    return h('div', { class: 'card', style: { marginTop: '16px', borderColor: accentColor } },
      h('div', { class: 'card-head' },
        h('div', {},
          h('h2', { text: `${title} (${list.length})` }),
          h('div', { class: 'card-sub', text: subtitle }),
        ),
      ),
      h('div', { class: 'grid cols-2', style: { gap: '14px' } }, ...list.map(renderBotCard)),
    );
  };

  mount(root,
    renderCategorySection(
      '🏆 בוטים מוכנים לעבור חברות נוסטרו (Passed Prop Firm Rules)',
      'בוטים שעמדו בפועל בכללי חברה אחת או יותר (FTMO, The5ers, FundedNext, Topstep, Apex) על נתוני אמת',
      'rgba(46, 204, 113, 0.5)',
      readyBots,
    ),
    renderCategorySection(
      '⏳ בוטים בתהליך מבחן והכנה (In Progress)',
      'בוטים שעומדים בתקרות הסיכון ונמצאים בדרך להשגת יעד הרווח המלא',
      'rgba(59, 130, 246, 0.4)',
      inProgressBots,
    ),
    renderCategorySection(
      '❌ בוטים שנכשלו בכללי הסיכון (דורשים מיטוב)',
      'בוטים שחרגו ממגבלת הפסד יומי (5%) או Drawdown כולל (10%) — לחץ על "⚙ מטב בוט זה לנוסטרו" לכיול מחדש',
      'rgba(240, 91, 91, 0.35)',
      failedBots,
    ),
  );

  // Detailed Proof & Prop Firm Rule Sources Report
  if (showDetailedReport) {
    mount(root,
      h('div', { class: 'card', style: { marginTop: '14px' } },
        h('div', { class: 'card-head' },
          h('div', {},
            h('h2', { text: '📑 דוח מפורט: מקורות חוקי המבחן והוכחות מעבר לפי חברה' }),
            h('div', { class: 'card-sub', text: 'פירוט רשמי של כללי חברות הנוסטרו, הקישורים למקורות, וטבלת התאמה מוכחת של כל בוט' }),
          ),
          h('button', { class: 'btn btn-sm btn-primary', onclick: () => downloadExcelReport(nostro) }, '📥 ייצא דוח מלא לאקסל (.xls)'),
        ),
        h('div', { class: 'table-wrap', style: { marginBottom: '14px' } },
          h('table', {},
            h('thead', {}, h('tr', {},
              h('th', { text: 'חברת נוסטרו' }),
              h('th', { text: 'יעד שלב 1 / 2' }),
              h('th', { text: 'הפסד יומי / כולל' }),
              h('th', { text: 'חלוקת רווחים' }),
              h('th', { text: 'מקור רשמי (תיעוד חוקים)' }),
            )),
            h('tbody', {}, PROP_FIRM_PROFILES.map((f) => h('tr', {},
              h('td', { class: 'small', text: `${f.name} (${f.program})` }),
              h('td', { class: 'mono', text: f.phase2TargetPct > 0 ? `+${f.phase1TargetPct}% / +${f.phase2TargetPct}%` : `+${f.phase1TargetPct}% (שלב אחד)` }),
              h('td', { class: 'mono', text: `-${f.maxDailyLossPct}% / -${f.maxTotalDdPct}%` }),
              h('td', { class: 'mono green', text: `${f.profitSplitPct}%` }),
              h('td', { class: 'tiny' },
                h('a', { href: f.sourceUrl, target: '_blank', rel: 'noopener noreferrer', style: { color: '#7dd3fc' } }, f.sourceUrl),
                h('div', { class: 'muted', text: f.sourceNote }),
              ),
            ))),
          ),
        ),
        h('div', { class: 'table-wrap' },
          h('table', {},
            h('thead', {}, h('tr', {},
              h('th', { text: 'בוט (אסטרטגיה + נכס)' }),
              h('th', { text: 'מקור נתונים בזמן אמת' }),
              ...PROP_FIRM_PROFILES.map((f) => h('th', { text: f.name })),
            )),
            h('tbody', {}, bots.map((b) => h('tr', {},
              h('td', { class: 'small', text: `${b.name} (${b.symbol})` }),
              h('td', { class: 'tiny muted', text: `${b.dataProvider || 'Live'} · ${b.dataFromDate || ''}–${b.dataToDate || ''}` }),
              ...PROP_FIRM_PROFILES.map((f) => {
                const fe = (b.firmEvaluations || []).find((x) => x.firmId === f.id);
                return h('td', {}, tag(fe?.passed ? '✓ עבר' : fe?.phase1Passed ? 'שלב 1' : '✗', fe?.passed ? 'live' : fe?.phase1Passed ? 'opt' : 'dry'));
              }),
            ))),
          ),
        ),
      ),
    );
  }
}
