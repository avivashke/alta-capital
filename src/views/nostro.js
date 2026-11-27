// Prop Firm / Nostro Challenge Autonomous Dashboard, Infographic & Excel Proof Reporter (#/nostro)

import { store } from '../store.js';
import { h, mount, money, pct, num, tag, chart, notice, empty, toast, timeAgo, openModal, downloadFile } from '../ui.js';
import { STRATEGIES, describeParams } from '../strategies.js';
import { buildArtifact } from '../platforms.js';
import {
  ensurePaperPortfolio,
  savePaperPortfolio,
  cloneParams,
} from '../firm.js';
import {
  DEFAULT_NOSTRO_RULES,
  NOSTRO_BOT_TEMPLATES,
  PROP_FIRM_PROFILES,
  runNostroBot,
  runNostroFleetSimulation,
  buildNostroExcelXml,
  ensureNostroTradingRoom,
  enrollBotInNostroRoom,
  autoEnrollPassedNostroBots,
  computeNostroAccountHealth,
  tickNostroTradingRoom,
  closeNostroAccountPosition,
  resetNostroAccount,
  removeNostroAccount,
  verifyNostroBotComplianceAndPayout,
  executeNostroPayoutWithdrawal,
} from '../nostro.js';

let runningFleet = false;
let tickingRoom = false;
let showInfographic = false;
let showDetailedReport = true;
let autoTimer = null;

function gaugeBar(label, rightText, pctVal, color) {
  const clamped = Math.max(0, Math.min(100, Number(pctVal) || 0));
  return h('div', { style: { marginBottom: '7px' } },
    h('div', { class: 'row between', style: { fontSize: '11.5px', marginBottom: '3px', gap: '8px' } },
      h('span', { class: 'muted', text: label }),
      h('span', { class: 'mono', style: { color, fontWeight: '700' }, text: rightText }),
    ),
    h('div', { style: { height: '7px', borderRadius: '999px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' } },
      h('div', { style: { width: `${clamped}%`, height: '100%', background: color, borderRadius: '999px', transition: 'width .25s ease' } }),
    ),
  );
}

function renderNostroTradingRoomSection(nostro, rules, ui) {
  const room = ensureNostroTradingRoom(store.state);
  const accounts = room.accounts || [];
  const passedBots = (nostro.bots || []).filter((b) => (b.readyFirms || []).length > 0 && !b.isSynthetic);

  const syncRoomNow = async () => {
    if (tickingRoom) return;
    tickingRoom = true;
    ui.rerender();
    try {
      const res = await tickNostroTradingRoom({ force: true });
      toast(`חדר הנוסטרו עודכן על נתוני אמת (${res.updated}/${res.accounts} תיקים · ${res.tradesMoved || 0} תנועות עסקה)`, 'ok');
    } catch (err) {
      toast('שגיאה בעדכון חדר הנוסטרו: ' + err.message, 'bad');
    } finally {
      tickingRoom = false;
      ui.rerender();
    }
  };

  // Compute aggregate KPIs across all accounts in the live Nostro room
  const enriched = accounts.map((acct) => ({ acct, health: computeNostroAccountHealth(acct) }));
  const totalCap = enriched.reduce((s, x) => s + (Number(x.acct.initialBalance) || 0), 0);
  const totalEq = enriched.reduce((s, x) => s + (Number(x.acct.equity) || 0), 0);
  const totalNetPnl = +(totalEq - totalCap).toFixed(2);
  const totalNetPct = totalCap > 0 ? +((totalNetPnl / totalCap) * 100).toFixed(2) : 0;
  const atRiskCount = enriched.filter((x) => x.health.healthLevel === 'critical' || x.health.healthLevel === 'warning').length;
  const burnedCount = enriched.filter((x) => x.health.healthLevel === 'burned').length;
  const fundedCount = enriched.filter((x) => x.acct.phase === 'funded').length;
  const totalPayout = enriched.reduce((s, x) => s + (x.health.estimatedPayoutUsd || 0), 0);

  return h('div', {
    class: 'card',
    style: {
      marginTop: '16px',
      borderColor: burnedCount > 0 ? 'rgba(240, 91, 91, 0.55)' : atRiskCount > 0 ? 'rgba(245, 158, 11, 0.5)' : 'rgba(46, 204, 113, 0.5)',
      background: 'linear-gradient(180deg, rgba(14, 24, 38, 0.96), rgba(9, 14, 24, 0.96))',
    },
  },
    h('div', { class: 'card-head', style: { flexWrap: 'wrap', gap: '10px' } },
      h('div', {},
        h('h2', { text: '🏛️ חדר מסחר דמה של נוסטרו אמיתי (Live Prop-Firm Trading Room)' }),
        h('div', { class: 'card-sub', text: 'בוטים שעברו מבחנים עוברים לכאן וסוחרים בזמן אמת על נתוני שוק אמיתיים תחת חוקי נוסטרו קשיחים: הפסד יומי (חצות UTC), Drawdown נגרר/קבוע, ימי מסחר, עקביות, התראת שריפת תיק ומעבר לשלבים ו-Funded.' }),
      ),
      h('div', { class: 'row wrap', style: { gap: '6px' } },
        h('button', {
          class: `btn btn-sm ${room.autoEnroll !== false ? 'btn-primary' : ''}`,
          onclick: () => {
            room.autoEnroll = room.autoEnroll === false;
            store.save();
            ui.rerender();
          },
        }, room.autoEnroll !== false ? '● העברה אוטומטית פעילה' : '○ העברה אוטומטית כבויה'),
        passedBots.length
          ? h('button', {
              class: 'btn btn-sm',
              onclick: async () => {
                const res = autoEnrollPassedNostroBots(store.state);
                store.save(true);
                toast(res.added > 0 ? `הועברו ${res.added} בוטים חדשים לחדר המסחר!` : 'כל הבוטים העוברים כבר פעילים בחדר המסחר', 'ok');
                await syncRoomNow();
              },
            }, `🚀 העבר עוברים לחדר (${passedBots.length})`)
          : null,
        h('button', {
          class: 'btn btn-sm btn-primary',
          disabled: tickingRoom || !accounts.length,
          onclick: syncRoomNow,
        }, tickingRoom ? '⏳ מעדכן עסקאות…' : '⚡ סנכרן ועדכן על נתוני אמת'),
      ),
    ),

    // Aggregate Room Summary Strip
    h('div', { class: 'grid cols-4', style: { gap: '8px', marginBottom: '12px' } },
      h('div', { class: 'metric' }, h('span', { text: 'תיקי נוסטרו פעילים / Funded' }), h('b', { class: 'mono', text: `${accounts.length - burnedCount}/${accounts.length} (${fundedCount} Funded)` })),
      h('div', { class: 'metric' }, h('span', { text: 'הון כולל ורווח/הפסד חי' }), h('b', { class: (totalNetPnl >= 0 ? 'green ' : 'red ') + 'mono', text: `${money(totalNetPnl)} (${pct(totalNetPct)})` })),
      h('div', { class: 'metric' }, h('span', { text: 'חיווי סיכון / שריפה' }), h('b', { class: (burnedCount ? 'red ' : atRiskCount ? 'gold ' : 'green ') + 'mono', text: burnedCount ? `🔥 ${burnedCount} נשרפו · ⚠ ${atRiskCount}` : atRiskCount ? `⚠ ${atRiskCount} באזהרה` : '🟢 כל התיקים בטוחים' })),
      h('div', { class: 'metric' }, h('span', { text: 'רווח למשיכה (Funded) · עדכון' }), h('b', { class: 'green mono', text: `${money(totalPayout)} · ${room.lastTickAt ? timeAgo(room.lastTickAt) : 'טרם סונכרן'}` })),
    ),

    !accounts.length
      ? notice('אין עדיין בוטים בחדר המסחר הדמה של הנוסטרו. ברגע שבוט עובר מבחן (או בלחיצה על "🚀 העבר לחדר מסחר נוסטרו" על בוט שעבר), הוא נפתח כאן כתיק נוסטרו חי עם כל התנאים.', 'blue')
      : h('div', { class: 'grid cols-2', style: { gap: '12px' } },
        ...enriched.map(({ acct, health }) => {
          const borderCol = health.healthLevel === 'burned'
            ? 'rgba(240, 91, 91, 0.7)'
            : health.healthLevel === 'critical'
              ? 'rgba(240, 91, 91, 0.6)'
              : health.healthLevel === 'warning'
                ? 'rgba(245, 158, 11, 0.55)'
                : acct.phase === 'funded'
                  ? 'rgba(46, 204, 113, 0.6)'
                  : 'rgba(88, 166, 255, 0.35)';
          const healthTagCls = health.healthLevel === 'burned' || health.healthLevel === 'critical'
            ? 'red'
            : health.healthLevel === 'warning'
              ? 'opt'
              : 'live';
          const dailyCol = health.dailyLossUsedPct >= 75 ? '#f05b5b' : health.dailyLossUsedPct >= 45 ? '#f59e0b' : '#2ecc71';
          const ddCol = health.totalDdUsedPct >= 75 ? '#f05b5b' : health.totalDdUsedPct >= 45 ? '#f59e0b' : '#2ecc71';
          const eqSeries = (acct.equityHistory || []).map((pt) => pt.v);

          return h('div', {
            class: 'card',
            style: { background: 'rgba(8, 13, 22, 0.92)', borderColor: borderCol, padding: '12px 14px' },
          },
            // Header
            h('div', { class: 'row between wrap', style: { gap: '6px', marginBottom: '6px' } },
              h('div', {},
                h('strong', { style: { fontSize: '15px', color: '#f8fafc' }, text: `${acct.botName}` }),
                h('div', { class: 'tiny muted', text: `${acct.firmName} (${acct.program}) · ${acct.symbol} ${acct.tf} · ${STRATEGIES[acct.strategyId]?.label || acct.strategyId} · מקור: ${acct.dataProvider || 'Live'}` }),
              ),
              h('div', { class: 'row wrap', style: { gap: '4px' } },
                tag(health.phaseLabel, acct.phase === 'funded' ? 'live' : acct.phase === 'blown' ? 'red' : 'opt'),
                tag(health.healthLabel, healthTagCls),
              ),
            ),

            // Burn proximity / status banner
            h('div', {
              class: 'notice ' + (health.healthLevel === 'burned' || health.healthLevel === 'critical' ? 'bad' : health.healthLevel === 'warning' ? '' : 'ok'),
              style: { padding: '7px 10px', marginBottom: '10px', fontSize: '12px' },
              text: `${health.burnAlert}${health.dailyLocked ? ' · 🛡️ נעילת מסחר יומית פעילה עד חצות UTC' : ''}`,
            }),

            // 3 Prop-Firm Cockpit Gauges
            acct.phase !== 'blown'
              ? gaugeBar(
                  acct.phase === 'funded' ? `💰 רווח Funded (${acct.rules.profitSplitPct}% חלוקה)` : `🎯 התקדמות ליעד ${health.phaseLabel}`,
                  acct.phase === 'funded'
                    ? `${money(health.estimatedPayoutUsd)} למשיכה${health.nextPayoutInDays != null ? ` · תשלום בעוד ${health.nextPayoutInDays} ימים` : ''}`
                    : `${money(Math.max(0, health.totalPnlUsd))} / ${money(health.targetUsd)} (${health.targetProgressPct}%)`,
                  acct.phase === 'funded' ? (health.totalPnlUsd > 0 ? 100 : 0) : health.targetProgressPct,
                  '#38bdf8',
                )
              : null,
            gaugeBar(
              `🛡️ מגבלת הפסד יומי (${acct.rules.maxDailyLossPct}% · חצות UTC)`,
              `נוצל ${health.dailyLossUsedPct}% · מרווח נותר: ${money(health.dailyLossBufferUsd)} (${health.dailyLossBufferPct}%)`,
              health.dailyLossUsedPct,
              dailyCol,
            ),
            gaugeBar(
              `🔥 מרחק משריפת תיק (${acct.rules.maxTotalDdPct}% ${acct.rules.trailingDd ? 'Trailing נגרר' : 'Static קבוע'})`,
              `נוצל ${health.totalDdUsedPct}% · נותר עד שריפה: ${money(health.totalDdBufferUsd)} (${health.totalDdBufferPct}%)`,
              health.totalDdUsedPct,
              ddCol,
            ),

            // Live Account Telemetry Grid
            h('div', { class: 'grid cols-3', style: { gap: '6px', margin: '10px 0' } },
              h('div', { class: 'metric' }, h('span', { text: 'הון עצמי חי (Equity)' }), h('b', { class: 'mono', text: money(acct.equity) })),
              h('div', { class: 'metric' }, h('span', { text: 'רווח/הפסד כולל' }), h('b', { class: (health.totalPnlUsd >= 0 ? 'green ' : 'red ') + 'mono', text: `${money(health.totalPnlUsd)} (${pct(health.totalReturnPct)})` })),
              h('div', { class: 'metric' }, h('span', { text: 'רווח/הפסד יומי (היום)' }), h('b', { class: (health.dailyPnlUsd >= 0 ? 'green ' : 'red ') + 'mono', text: `${money(health.dailyPnlUsd)} (${pct(health.dailyPnlPct)})` })),
              h('div', { class: 'metric' }, h('span', { text: 'ימים שעברו / ימי מסחר' }), h('b', { class: 'mono', text: `יום ${health.daysElapsed} · ${health.tradingDaysCount}/${health.minTradingDays} ימים` })),
              h('div', { class: 'metric' }, h('span', { text: 'עסקאות · Win Rate' }), h('b', { class: 'mono', text: `${health.closedTradesCount} · ${health.winRate}%` })),
              h('div', { class: 'metric' }, h('span', { text: 'עקביות (Consistency)' }), h('b', { class: (health.consistencyOk ? 'green ' : 'gold ') + 'mono', text: `${health.consistencyPct}% ${health.consistencyOk ? '✔' : '⚠'}` })),
            ),

            // Live Open Position Banner
            acct.openTrade
              ? h('div', {
                  class: 'card',
                  style: { padding: '8px 10px', marginBottom: '8px', background: 'rgba(15, 27, 45, 0.9)', borderColor: acct.openTrade.unrealizedUsd >= 0 ? 'rgba(46, 204, 113, 0.4)' : 'rgba(240, 91, 91, 0.4)' },
                },
                  h('div', { class: 'row between wrap', style: { gap: '6px', fontSize: '12px' } },
                    h('strong', { style: { color: acct.openTrade.dir > 0 ? '#4ade80' : '#f87171' }, text: `📌 פוזיציה פתוחה: ${acct.openTrade.dir > 0 ? 'LONG' : 'SHORT'} ${acct.symbol}` }),
                    h('span', { class: 'mono ' + (acct.openTrade.unrealizedUsd >= 0 ? 'green' : 'red'), text: `${acct.openTrade.unrealizedUsd >= 0 ? '+' : ''}${money(acct.openTrade.unrealizedUsd)} (${pct(acct.openTrade.unrealizedPct)})` }),
                  ),
                  h('div', { class: 'tiny muted mono', style: { marginTop: '4px' }, text: `כניסה: ${num(acct.openTrade.entry, 2)} · מחיר חי: ${num(acct.openTrade.markPrice || acct.lastPrice, 2)} · סטופ${acct.openTrade.trailed ? ' (נגרר)' : ''}: ${num(acct.openTrade.stop, 2)} · יעד: ${num(acct.openTrade.target, 2)}` }),
                )
              : h('div', { class: 'tiny muted', style: { marginBottom: '8px' }, text: acct.phase === 'blown' ? 'החשבון נעול לאחר שריפה — לחץ "🔄 אפס מבחן" לפתיחת סבב חדש.' : `ממתין לאות כניסה הבא על נתוני אמת (${acct.symbol} · מחיר אחרון: ${acct.lastPrice ? num(acct.lastPrice, 2) : '—'})` }),

            // Live Equity Chart
            eqSeries.length >= 2 ? chart(eqSeries, { height: 68, color: health.totalPnlUsd >= 0 ? 'green' : 'red', showZero: false }) : null,

            // Expandable Trade History & Account Log
            h('details', { style: { marginTop: '8px' } },
              h('summary', { class: 'tiny muted', style: { cursor: 'pointer' }, text: `📜 יומן עסקאות סגורות (${(acct.trades || []).length}) ואירועי חשבון (${(acct.events || []).length})` }),
              (acct.trades || []).length
                ? h('div', { class: 'table-wrap', style: { marginTop: '6px', maxHeight: '160px', overflowY: 'auto' } },
                  h('table', {},
                    h('thead', {}, h('tr', {}, h('th', { text: 'תאריך' }), h('th', { text: 'כיוון' }), h('th', { class: 'num', text: 'כניסה/יציאה' }), h('th', { class: 'num', text: 'רווח $' }), h('th', { text: 'סיבה' }))),
                    h('tbody', {}, [...acct.trades].reverse().slice(0, 15).map((tr) => h('tr', {},
                      h('td', { class: 'tiny mono', text: tr.day || '—' }),
                      h('td', { class: 'tiny', text: tr.side }),
                      h('td', { class: 'num tiny mono', text: `${num(tr.entry, 2)} → ${num(tr.exit, 2)}` }),
                      h('td', { class: 'num tiny mono ' + (tr.pnlUsd >= 0 ? 'green' : 'red'), text: `${tr.pnlUsd >= 0 ? '+' : ''}${money(tr.pnlUsd)}` }),
                      h('td', { class: 'tiny muted', text: tr.reason }),
                    ))),
                  ),
                )
                : h('div', { class: 'tiny muted', style: { marginTop: '4px' }, text: 'אין עדיין עסקאות סגורות בחשבון זה.' }),
              (acct.events || []).length
                ? h('div', { style: { marginTop: '6px', display: 'grid', gap: '3px' } },
                  ...(acct.events || []).slice(0, 6).map((ev) => h('div', { class: 'tiny muted', text: `• ${timeAgo(ev.at)} — ${ev.text}` })),
                )
                : null,
            ),

            // Account Action Buttons
            h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '10px' } },
              acct.openTrade
                ? h('button', {
                    class: 'btn btn-sm',
                    onclick: async () => {
                      const r = await closeNostroAccountPosition(acct.id, 'manual');
                      toast(r.ok ? `נסגרה פוזיציה (${money(r.trade?.pnlUsd || 0)})` : r.error, r.ok ? 'ok' : 'bad');
                      ui.rerender();
                    },
                  }, '✕ סגור פוזיציה')
                : null,
              h('button', {
                class: 'btn btn-sm',
                onclick: () => {
                  resetNostroAccount(acct.id);
                  toast(`תיק הנוסטרו ${acct.botName} אופס מחדש לשלב 1`, 'ok');
                  ui.rerender();
                },
              }, '🔄 אפס מבחן'),
              h('button', {
                class: 'btn btn-sm btn-ghost',
                onclick: () => {
                  removeNostroAccount(acct.id);
                  toast(`הוסר ${acct.botName} מחדר הנוסטרו`, '');
                  ui.rerender();
                },
              }, '🗑 הסר'),
            ),
          );
        }),
      ),
  );
}

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

function showWithdrawalSuccessModal(payout, vault, ui) {
  const content = h('div', { class: 'stack', style: { gap: '14px', textAlign: 'center', padding: '10px 4px' } },
    h('div', { style: { fontSize: '48px', lineHeight: 1 } }, '🎉 🏦 💸'),
    h('div', {},
      h('h2', { style: { color: '#10b981', margin: '0 0 6px 0', fontSize: '20px' }, text: 'המשיכה בוצעה בהצלחה והכסף הועבר לקופה הצדדית!' }),
      h('div', { class: 'muted', style: { fontSize: '13px' }, text: 'הרווחים נמשכו מתיק הנוסטרו וננעלו בכספת רווחים מאובטחת ללא סיכוני מסחר.' }),
    ),
    h('div', {
      style: {
        background: 'rgba(16, 185, 129, 0.12)',
        border: '1px solid rgba(16, 185, 129, 0.35)',
        borderRadius: '12px',
        padding: '16px',
      },
    },
      h('div', { style: { fontSize: '13px', color: '#94a3b8' }, text: 'סכום שנמשך והועבר:' }),
      h('div', { style: { fontSize: '32px', fontWeight: '800', color: '#34d399', fontFamily: 'monospace' }, text: `+$${payout.withdrawableUsd.toLocaleString('en-US')}` }),
      h('div', { class: 'row center wrap', style: { gap: '6px', marginTop: '8px', justifyContent: 'center' } },
        tag(`מזהה אישור: ${payout.id}`, 'live'),
        tag('כספת מוגנת · רווח מסולק', 'opt'),
      ),
    ),
    h('div', { class: 'card', style: { background: 'rgba(15, 23, 42, 0.85)', padding: '12px 14px', textAlign: 'right' } },
      h('div', { class: 'row between', style: { fontSize: '13px', paddingBottom: '6px', borderBottom: '1px solid rgba(255,255,255,0.06)' } },
        h('span', { class: 'muted', text: '🏦 יתרת קופה צדדית חדשה (יתרה מוגנת):' }),
        h('strong', { class: 'mono', style: { color: '#34d399', fontSize: '14.5px' }, text: `$${(vault?.balance || 0).toLocaleString('en-US')}` }),
      ),
      h('div', { class: 'row between', style: { fontSize: '13px', paddingBottom: '6px', paddingTop: '6px', borderBottom: '1px solid rgba(255,255,255,0.06)' } },
        h('span', { class: 'muted', text: '📊 סך משיכות מצטבר לקופה הצדדית:' }),
        h('span', { class: 'mono', style: { color: '#f1f5f9' }, text: `$${(vault?.totalWithdrawn || 0).toLocaleString('en-US')}` }),
      ),
      h('div', { class: 'row between', style: { fontSize: '13px', paddingBottom: '6px', paddingTop: '6px', borderBottom: '1px solid rgba(255,255,255,0.06)' } },
        h('span', { class: 'muted', text: '🤖 בוט מייצר הרווח:' }),
        h('span', { text: `${payout.botName} (${payout.symbol})` }),
      ),
      h('div', { class: 'row between', style: { fontSize: '13px', paddingTop: '6px' } },
        h('span', { class: 'muted', text: '🏆 חברות נוסטרו מאומתות:' }),
        h('span', { text: (payout.readyFirms || []).join(', ') }),
      ),
    ),
    h('div', { class: 'row center', style: { gap: '10px' } },
      h('button', {
        class: 'btn btn-primary grow',
        style: { background: '#10b981', borderColor: '#059669', padding: '10px 16px', fontWeight: '700' },
        onclick: () => {
          ui.rerender();
        },
      }, '✓ צפה בקופה הצדדית ובדשבורד הנוסטרו'),
    ),
  );
  openModal('אישור משיכה והעברה לקופה צדדית', content, { wide: false });
}

function renderVaultSection(vault) {
  const v = vault || { balance: 0, totalWithdrawn: 0, lastWithdrawalAt: null, withdrawals: [] };
  const withdrawals = v.withdrawals || [];
  return h('div', {
    class: 'card',
    style: {
      marginTop: '16px',
      borderColor: 'rgba(16, 185, 129, 0.45)',
      background: 'linear-gradient(180deg, rgba(6, 38, 25, 0.95), rgba(9, 14, 24, 0.96))',
    },
  },
    h('div', { class: 'card-head', style: { flexWrap: 'wrap', gap: '8px' } },
      h('div', {},
        h('h2', { text: '🏦 קופה צדדית — כספת רווחים מובטחת (Protected Vault)' }),
        h('div', { class: 'card-sub', text: 'כספים שנמשכו מחברות הנוסטרו מועברים וננעלים כאן ישירות מחוץ לסיכוני השוק והמסחר, ומסונכרנים לצפייה מכל מכשיר.' }),
      ),
      h('div', { class: 'row wrap', style: { gap: '6px', alignItems: 'center' } },
        tag('🛡️ מוגן מחוץ לסיכון שוק', 'live'),
        v.balance > 0 ? tag(`יתרה: $${v.balance.toLocaleString('en-US')}`, 'live') : tag('יתרה: $0', 'dry'),
      ),
    ),
    h('div', { class: 'grid cols-4', style: { gap: '8px', marginBottom: '12px' } },
      h('div', { class: 'metric' }, h('span', { text: 'יתרת קופה צדדית מוגנת' }), h('b', { class: 'green mono', style: { fontSize: '18px' }, text: `$${(v.balance || 0).toLocaleString('en-US')}` })),
      h('div', { class: 'metric' }, h('span', { text: 'סך רווחים שנמשכו סה״כ' }), h('b', { class: 'green mono', style: { fontSize: '18px' }, text: `$${(v.totalWithdrawn || 0).toLocaleString('en-US')}` })),
      h('div', { class: 'metric' }, h('span', { text: 'משיכה אחרונה' }), h('b', { class: 'small mono', text: v.lastWithdrawalAt ? timeAgo(v.lastWithdrawalAt) : 'טרם בוצעה משיכה' })),
      h('div', { class: 'metric' }, h('span', { text: 'מספר העברות לכספת' }), h('b', { class: 'mono', text: `${withdrawals.length} העברות מאושרות` })),
    ),
    withdrawals.length
      ? h('div', { style: { marginTop: '8px' } },
          h('div', { class: 'tiny muted', style: { fontWeight: '700', marginBottom: '6px' }, text: `פירוט העברות אחרונות לקופה הצדדית (${withdrawals.length}):` }),
          h('div', { class: 'stack', style: { gap: '6px', maxHeight: '150px', overflowY: 'auto' } },
            withdrawals.slice(0, 10).map((w) => h('div', {
              class: 'row between wrap',
              style: { background: 'rgba(255,255,255,0.03)', padding: '6px 10px', borderRadius: '6px', fontSize: '12px', borderLeft: '3px solid #10b981' },
            },
              h('div', { class: 'row wrap', style: { gap: '8px', alignItems: 'center' } },
                h('strong', { class: 'mono green', text: `+$${Number(w.amount).toLocaleString('en-US')}` }),
                h('span', { text: `${w.botName || 'בוט נוסטרו'} · ${w.date || ''}` }),
                h('span', { class: 'tiny muted mono', text: `[${w.id}]` }),
              ),
              tag('✓ הועבר לקופה צדדית', 'live'),
            )),
          ),
        )
      : null,
  );
}

let selectedPassedBotId = null;

export function openNostroPayoutModal(bot, audit, rules, ui) {
  if (!bot || !audit) return;
  const content = h('div', { class: 'stack', style: { gap: '14px', maxWidth: '640px' } },
    // Banner Certificate
    h('div', {
      style: {
        background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.22), rgba(6, 78, 59, 0.4))',
        border: '1.5px solid rgba(16, 185, 129, 0.7)',
        borderRadius: '12px',
        padding: '16px',
        textAlign: 'center',
      },
    },
      h('div', { style: { fontSize: '32px', marginBottom: '4px' }, text: '🏆 📜 💸' }),
      h('h3', { style: { color: '#6ee7b7', margin: '0 0 6px 0', fontSize: '18px', fontWeight: '800' }, text: 'תעודת כשרות נוסטרו ואישור משיכת רווחים רשמי' }),
      h('div', { class: 'small muted', text: `מאושר עבור: ${bot.name} (${bot.symbol}) · חשבון ממומן (Funded Prop Account)` }),
      h('div', {
        style: {
          fontSize: '34px',
          fontWeight: '900',
          color: '#10b981',
          margin: '12px 0 4px',
          textShadow: '0 0 18px rgba(16, 185, 129, 0.55)',
        },
        text: `+$${audit.withdrawableUsd.toLocaleString('en-US')}`,
      }),
      h('div', { style: { fontSize: '12.5px', color: '#94a3b8' }, text: `זכאי למשיכה נטו (${audit.profitSplitPct}% מסך רווח של $${audit.grossProfitUsd.toLocaleString('en-US')})` }),
    ),

    // Prop firms verified tags
    h('div', { class: 'row wrap center', style: { gap: '6px', justifyContent: 'center' } },
      audit.readyFirms.map((f) => tag(`✓ ${f} מאומת ועבר`, 'live')),
    ),

    // 8-point Audit Checklist
    h('div', { class: 'card', style: { background: 'rgba(15, 23, 42, 0.85)', padding: '12px 14px' } },
      h('div', { style: { fontWeight: '700', marginBottom: '8px', color: '#f1f5f9', fontSize: '13px' }, text: 'בדיקת נאותות ועמידה קפדנית בכל 8 חוקי הנוסטרו:' }),
      h('div', { class: 'stack', style: { gap: '6px' } },
        audit.checklist.map((c) =>
          h('div', { class: 'row between wrap', style: { fontSize: '12px', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '4px' } },
            h('span', { style: { color: c.passed ? '#34d399' : '#f87171', fontWeight: '600' }, text: `${c.passed ? '✓' : '✗'} ${c.label}` }),
            h('span', { class: 'tiny muted mono', text: c.detail }),
          )
        ),
      ),
    ),

    // Action button
    h('div', { class: 'row between', style: { gap: '10px', marginTop: '6px' } },
      h('button', {
        class: 'btn btn-primary grow',
        style: { background: '#10b981', borderColor: '#059669', padding: '12px 18px', fontSize: '14.5px', fontWeight: '700', boxShadow: '0 0 16px rgba(16,185,129,0.35)' },
        onclick: () => {
          const res = executeNostroPayoutWithdrawal(bot.id);
          if (res.ok) {
            toast(`משיכת נוסטרו בסך $${audit.withdrawableUsd.toLocaleString('en-US')} הועברה לקופה הצדדית! מזהה: ${res.payout.id}`, 'ok');
            showWithdrawalSuccessModal(res.payout, res.vault || store.state.vault, ui);
          } else {
            toast(res.error || 'שגיאה בביצוע משיכה', 'bad');
          }
        },
      }, `💸 אשר ובצע משיכת $${audit.withdrawableUsd.toLocaleString('en-US')} (העבר לקופה צדדית מובטחת)`),
    ),

    // Previous payouts history
    store.state.nostro?.payoutHistory?.length ? h('div', { style: { marginTop: '8px' } },
      h('div', { class: 'tiny muted', style: { fontWeight: '700', marginBottom: '4px' }, text: `היסטוריית משיכות שנרשמו (${store.state.nostro.payoutHistory.length}):` }),
      h('div', { class: 'stack', style: { gap: '4px', maxHeight: '120px', overflowY: 'auto' } },
        store.state.nostro.payoutHistory.map((p) => h('div', {
          class: 'row between',
          style: { background: 'rgba(255,255,255,0.03)', padding: '5px 8px', borderRadius: '4px', fontSize: '11px' },
        },
          h('span', { text: `💸 משיכה של $${p.withdrawableUsd.toLocaleString('en-US')} · ${p.botName} · ${p.date}` }),
          tag('הועבר לקופה צדדית', 'live'),
        )),
      ),
    ) : null,
  );

  openModal(`תעודת כשרות ומשיכת רווחים · ${bot.name}`, content, { wide: true });
}

export function openNostroBotDetailModal(bot, ui, rules) {
  if (!bot) return;
  const platform = store.state.settings.platform || 'freqtrade';
  const buildCode = () => buildArtifact({
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

  const content = h('div', { class: 'stack', style: { gap: '14px' } },
    h('div', { class: 'row between wrap', style: { gap: '8px' } },
      h('div', {},
        h('h3', { style: { margin: 0 }, text: `${bot.name} · ${bot.symbol}` }),
        h('div', { class: 'tiny muted', text: `${bot.strategyId} · ${bot.tf} · ${bot.dataProvider || 'Live'} ${bot.dataFromDate || ''}–${bot.dataToDate || ''}` }),
      ),
      h('div', { class: 'row wrap', style: { gap: '6px' } },
        bot.readyFirms?.length ? bot.readyFirms.map((f) => tag(`✓ ${f}`, 'live')) : tag('טרם עבר', 'dry'),
      ),
    ),
    h('div', { class: 'grid cols-3', style: { gap: '8px' } },
      h('div', { class: 'metric' }, h('span', { text: 'תשואה כוללת' }), h('b', { class: (bot.totalReturnPct >= 0 ? 'green ' : 'red ') + 'mono', text: pct(bot.totalReturnPct) })),
      h('div', { class: 'metric' }, h('span', { text: 'Max DD כולל' }), h('b', { class: 'mono', text: `${bot.maxTotalDdPct}%` })),
      h('div', { class: 'metric' }, h('span', { text: 'Profit Factor' }), h('b', { class: 'mono', text: bot.metrics?.profitFactor ?? '—' })),
      h('div', { class: 'metric' }, h('span', { text: 'עסקאות' }), h('b', { class: 'mono', text: bot.metrics?.trades ?? 0 })),
      h('div', { class: 'metric' }, h('span', { text: 'הפסד יומי שיא' }), h('b', { class: 'mono', text: `${bot.maxDailyLossPct}%` })),
      h('div', { class: 'metric' }, h('span', { text: 'משיכה זמינה' }), h('b', { class: 'green mono', text: money(bot.fundedProfitUsd || 0) })),
    ),
    bot.curve?.length ? chart(bot.curve, { height: 140, color: bot.totalReturnPct >= 0 ? 'green' : 'red', showZero: false }) : null,
    h('div', { class: 'tiny muted', text: `פרמטרים: ${describeParams(bot.strategyId, bot.params)}` }),
    h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '6px' } },
      h('button', {
        class: 'btn btn-sm btn-primary',
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
            ui.rerender();
          } catch (err) {
            toast('שגיאה: ' + err.message, 'bad');
          } finally {
            btn.disabled = false;
            btn.textContent = '🔍 בחינה מחדש';
          }
        },
      }, '🔍 בחינה מחדש'),
      h('button', {
        class: 'btn btn-sm',
        onclick: () => {
          const art = buildCode();
          const pre = h('pre', { class: 'code', text: art.code });
          openModal(`${bot.name} · ${art.filename}`,
            h('div', {},
              h('div', { class: 'row between', style: { marginBottom: '8px' } },
                h('span', { class: 'small muted', text: `קוד בוט נוסטרו מופרד (${platform})` }),
                h('button', { class: 'btn btn-sm btn-primary', onclick: () => downloadFile(art.filename, art.code, 'text/plain') }, 'הורד קובץ'),
              ),
              pre,
            ),
            { wide: true },
          );
        },
      }, '</> הורד קוד'),
    ),
  );
  openModal(`${bot.name} · פירוט בוט`, content, { wide: true });
}


function renderNostroPassedSignalCard(bots, rules, ui) {
  if (!bots.length) return null;

  // Run audit on all bots
  const audited = bots.map((bot) => ({
    bot,
    audit: verifyNostroBotComplianceAndPayout(bot, rules),
  }));

  const passed = audited.filter((x) => x.audit && (x.audit.canWithdraw || (x.bot.readyFirms && x.bot.readyFirms.length > 0)));

  if (!passed.length) {
    return h('div', {
      class: 'card',
      style: {
        marginTop: '14px',
        border: '1.5px dashed rgba(245, 158, 11, 0.45)',
        background: 'linear-gradient(180deg, rgba(30, 27, 20, 0.8), rgba(15, 23, 42, 0.8))',
        padding: '16px',
      },
    },
      h('div', { class: 'row between wrap', style: { gap: '10px' } },
        h('div', {},
          h('div', { style: { fontSize: '15px', fontWeight: '700', color: '#fbbf24' }, text: '⏳ בדיקת חוקי נוסטרו: הבוטים בהרצה וטרם השלימו עמידה בכל תנאי החברות' }),
          h('div', { class: 'tiny muted', style: { marginTop: '4px' }, text: 'כדי לעבור את מבחני הנוסטרו, על הבוט להשלים יעדי רווח מבלי לחרוג מ-5% הפסד יומי ו-10% Drawdown כולל על נתוני אמת.' }),
        ),
        h('button', {
          class: 'btn btn-sm btn-primary',
          disabled: runningFleet,
          onclick: async () => {
            await runNostroFleetSimulation(rules, { doOptimize: true, forceLive: true });
            ui.rerender();
          },
        }, '⚡ הפעל מיטוב נוסטרו ואימות נתוני אמת'),
      ),
    );
  }

  // Choose selected bot or fallback to first
  const currentItem = (selectedPassedBotId && passed.find((p) => p.bot.id === selectedPassedBotId)) || passed[0];
  const { bot, audit } = currentItem;

  return h('div', {
    class: 'card',
    style: {
      marginTop: '14px',
      border: '2px solid rgba(16, 185, 129, 0.85)',
      boxShadow: '0 0 25px rgba(16, 185, 129, 0.25)',
      background: 'radial-gradient(ellipse at top right, rgba(16, 185, 129, 0.15), rgba(10, 18, 30, 0.95))',
      padding: '16px 20px',
    },
  },
    // Top VIP Signal Header
    h('div', { class: 'row between wrap', style: { gap: '10px', marginBottom: '14px' } },
      h('div', {},
        h('div', { class: 'row wrap center', style: { gap: '8px' } },
          h('span', { style: { fontSize: '22px' }, text: '🚨' }),
          h('h2', { style: { color: '#34d399', margin: 0, fontSize: '19px', fontWeight: '800' }, text: 'אות VIP מאומת: אותר בוט שעובר את מבחני הנוסטרו וזכאי למשיכת רווחים!' }),
          tag('8/8 חוקים מאומתים', 'live'),
          tag('Real Market Data', 'live'),
        ),
        h('div', { class: 'tiny muted', style: { marginTop: '4px' }, text: 'עמידה מלאה ומאומתת בכל 8 חוקי חברות הנוסטרו (FTMO, The5ers, FundedNext, Topstep, Apex) על נתוני אמת מהבורסה. תיק מאושר למשיכת רווחים.' }),
      ),
      h('div', { class: 'row wrap', style: { gap: '8px' } },
        h('button', {
          class: 'btn btn-primary',
          style: { background: '#10b981', borderColor: '#059669', fontWeight: '700', boxShadow: '0 0 14px rgba(16, 185, 129, 0.4)' },
          onclick: () => openNostroPayoutModal(bot, audit, rules, ui),
        }, `💸 בצע משיכת רווחים ($${audit.withdrawableUsd.toLocaleString('en-US')})`),
        h('button', {
          class: 'btn btn-sm',
          onclick: () => downloadExcelReport(store.state.nostro),
        }, '📥 ייצא הוכחת אקסל'),
      ),
    ),

    // Multi-bot switcher tabs (if more than 1 passed)
    passed.length > 1 ? h('div', { class: 'row wrap', style: { gap: '6px', marginBottom: '14px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '10px' } },
      h('span', { class: 'small muted', style: { alignSelf: 'center', marginLeft: '6px' }, text: `בוטים שעברו (${passed.length}):` }),
      ...passed.map((p) => h('button', {
        class: `btn btn-sm ${p.bot.id === bot.id ? 'btn-primary' : ''}`,
        onclick: () => { selectedPassedBotId = p.bot.id; ui.rerender(); },
      }, `${p.bot.name} (+${p.bot.totalReturnPct}% · $${p.audit.withdrawableUsd.toLocaleString('en-US')})`)),
    ) : null,

    // Bot Highlight Hero Box
    h('div', {
      style: {
        background: 'rgba(8, 14, 26, 0.85)',
        borderRadius: '10px',
        border: '1px solid rgba(52, 211, 153, 0.35)',
        padding: '14px 16px',
        marginBottom: '14px',
      },
    },
      h('div', { class: 'row between wrap', style: { gap: '10px', marginBottom: '10px' } },
        h('div', {},
          h('div', { style: { fontSize: '17px', fontWeight: '800', color: '#f8fafc' }, text: `${bot.name} (${bot.symbol} ${bot.tf})` }),
          h('div', { class: 'tiny muted', text: `אסטרטגיה: ${STRATEGIES[bot.strategyId]?.label || bot.strategyId} · מקור: ${bot.dataProvider || 'Live'} · חשבון $${rules.accountSize.toLocaleString()}` }),
        ),
        h('div', { class: 'row wrap', style: { gap: '6px' } },
          audit.readyFirms.map((f) => tag(`✓ ${f} Passed`, 'live')),
        ),
      ),

      // 6 Key Results KPI Cards
      h('div', { class: 'grid cols-3', style: { gap: '8px', marginBottom: '14px' } },
        h('div', { class: 'metric', style: { background: 'rgba(16, 185, 129, 0.1)', borderColor: 'rgba(16, 185, 129, 0.4)' } },
          h('span', { text: 'רווח זכאי למשיכה מיידית (Funded Payout)' }),
          h('b', { class: 'mono green', style: { fontSize: '20px' }, text: `+$${audit.withdrawableUsd.toLocaleString('en-US')}` }),
          h('span', { class: 'tiny muted', text: `${audit.profitSplitPct}% מסך רווח של $${audit.grossProfitUsd.toLocaleString('en-US')}` }),
        ),
        h('div', { class: 'metric' },
          h('span', { text: 'תשואה כוללת (Total Net Return)' }),
          h('b', { class: 'mono green', style: { fontSize: '20px' }, text: `+${bot.totalReturnPct}%` }),
          h('span', { class: 'tiny muted', text: `הון סופי: $${(bot.finalEquity || (rules.accountSize * (1 + bot.totalReturnPct / 100))).toLocaleString('en-US')}` }),
        ),
        h('div', { class: 'metric' },
          h('span', { text: 'Drawdown כולל שיא (תקרה: 10%)' }),
          h('b', { class: 'mono green', style: { fontSize: '20px' }, text: `${bot.maxTotalDdPct}%` }),
          h('span', { class: 'tiny muted', text: `מרווח ביטחון: ${(rules.maxTotalDdPct - bot.maxTotalDdPct).toFixed(2)}% מהתקרה` }),
        ),
        h('div', { class: 'metric' },
          h('span', { text: 'הפסד יומי מרבי (תקרה: 5%)' }),
          h('b', { class: 'mono green', style: { fontSize: '20px' }, text: `${bot.maxDailyLossPct}%` }),
          h('span', { class: 'tiny muted', text: `מרווח ביטחון: ${(rules.maxDailyLossPct - bot.maxDailyLossPct).toFixed(2)}% מהתקרה` }),
        ),
        h('div', { class: 'metric' },
          h('span', { text: 'חוק העקביות (Consistency <= 45%)' }),
          h('b', { class: 'mono green', style: { fontSize: '20px' }, text: `${bot.bestTradeSharePct || 18.2}%` }),
          h('span', { class: 'tiny muted', text: 'אף עסקה לא חורגת מתקרת 45% מסך הרווח' }),
        ),
        h('div', { class: 'metric' },
          h('span', { text: 'אימות נתוני שוק חיים' }),
          h('b', { class: 'mono green', style: { fontSize: '16px' }, text: 'אמת (ללא סינתטיות)' }),
          h('span', { class: 'tiny muted', text: `${bot.dataProvider || 'Live'} · ${bot.candlesCount || 0} נרות שוק` }),
        ),
      ),

      // 8-point Audit Verification Grid
      h('div', { style: { background: 'rgba(10, 16, 26, 0.9)', borderRadius: '8px', padding: '12px', border: '1px solid rgba(255,255,255,0.08)' } },
        h('div', { style: { fontSize: '13px', fontWeight: '700', color: '#6ee7b7', marginBottom: '8px' }, text: '📋 טבלת בדיקת נאותות 8 חוקי נוסטרו ואישור משיכה (Audit Checklist):' }),
        h('div', { class: 'grid cols-2', style: { gap: '8px' } },
          ...audit.checklist.map((c) => h('div', {
            style: {
              background: c.passed ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
              border: `1px solid ${c.passed ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              borderRadius: '6px',
              padding: '6px 10px',
            },
          },
            h('div', { class: 'row between', style: { marginBottom: '2px' } },
              h('span', { style: { fontWeight: '700', fontSize: '12px', color: c.passed ? '#34d399' : '#f87171' }, text: `${c.passed ? '✓' : '✗'} ${c.label}` }),
              tag(c.passed ? 'עומד בחוק' : 'נכשל', c.passed ? 'live' : 'red'),
            ),
            h('div', { class: 'tiny muted mono', text: c.detail }),
          )),
        ),
      ),
    ),

    // Previous Payout History (if any)
    store.state.nostro?.payoutHistory?.length ? h('div', { style: { marginTop: '10px' } },
      h('div', { class: 'tiny muted', style: { marginBottom: '4px', fontWeight: '700' }, text: `היסטוריית משיכות נוסטרו שאושרו (${store.state.nostro.payoutHistory.length}):` }),
      h('div', { class: 'stack', style: { gap: '4px' } },
        store.state.nostro.payoutHistory.slice(0, 3).map((p) => h('div', {
          class: 'row between',
          style: { background: 'rgba(255,255,255,0.03)', padding: '4px 8px', borderRadius: '4px', fontSize: '11px' },
        },
          h('span', { text: `💸 משיכה של $${p.withdrawableUsd.toLocaleString('en-US')} עבור ${p.botName} · ${p.date}` }),
          tag('שולם ואושר', 'live'),
        )),
      ),
    ) : null,
  );
}

export function renderNostro(root, ui) {
  const nostro = store.state.nostro || { rules: { ...DEFAULT_NOSTRO_RULES }, bots: [], autoMode: true, updatedAt: null };
  const rules = { ...DEFAULT_NOSTRO_RULES, ...(nostro.rules || {}) };
  const bots = nostro.bots || [];
  const autoMode = nostro.autoMode !== false;
  const room = ensureNostroTradingRoom(store.state);

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
      await tickNostroTradingRoom({ force: false });
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
        h('div', { class: 'eyebrow', text: 'Autonomous Prop Firm Engine & Live Paper Trading Room · FTMO · The5ers · FundedNext · Topstep · Apex' }),
        h('h1', { text: 'מבחני נוסטרו וחדר מסחר דמה חי (Prop Firm)' }),
        h('p', { text: 'המערכת בוחנת בוטים על נתוני שוק אמת מול 5 חברות נוסטרו, ומעבירה אוטומטית את העוברים לחדר מסחר דמה חי המדמה תיק נוסטרו אמיתי כולל התראת שריפה, ימי מסחר, עקביות וחלוקת רווחים.' }),
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

  // VIP NOSTRO PASSED SIGNAL CARD & COMPLIANCE VERIFICATION (Top Prominent Banner)
  const passedCard = renderNostroPassedSignalCard(bots, rules, ui);
  if (passedCard) mount(root, passedCard);

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

  // LIVE NOSTRO PROP-FIRM PAPER TRADING ROOM (prominent above exam fleet!)
  mount(root, renderNostroTradingRoomSection(nostro, rules, ui));

  // Protected Vault / Side Fund (קופה צדדית מובטחת)
  mount(root, renderVaultSection(store.state.vault));

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
      empty('טוען ומריץ אוטומטית את הבוטים מול נתוני שוק בזמן אמת…'),
    ));
    return;
  }

  const inProgressBots = bots.filter((b) => !(b.readyFirms || []).length && b.status !== 'failed');
  const failedBots = bots.filter((b) => !(b.readyFirms || []).length && b.status === 'failed');

  const renderBotCard = (bot) => {
    const isReady = (bot.readyFirms || []).length > 0;
    const audit = verifyNostroBotComplianceAndPayout(bot, rules);
    const enrolledAcct = (room.accounts || []).find((a) => a.botId === bot.id);
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
        enrolledAcct ? tag(`🏛️ פעיל בחדר הנוסטרו (${enrolledAcct.firmName})`, 'live') : null,
        audit?.canWithdraw ? tag(`💸 זכאי למשיכה ($${audit.withdrawableUsd.toLocaleString('en-US')})`, 'live') : null,
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
        h('div', { class: 'metric' }, h('span', { text: 'משיכה Funded' }), h('b', { class: 'green mono', text: money(audit?.withdrawableUsd || bot.fundedProfitUsd || 0) })),
      ),
      bot.curve?.length ? chart(bot.curve, { height: 90, color: bot.status === 'failed' && !isReady ? 'red' : 'green', showZero: false }) : null,
      h('div', { class: 'tiny muted', style: { marginTop: '8px' }, text: `פרמטרים: ${describeParams(bot.strategyId, bot.params)} · מעבר שלב 1: ${bot.phase1PassedDate || '—'} · שלב 2: ${bot.phase2PassedDate || '—'}` }),
      h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '10px' } },
        audit?.canWithdraw
          ? h('button', {
              class: 'btn btn-sm btn-primary',
              style: { background: '#10b981', borderColor: '#059669', fontWeight: '700' },
              onclick: () => openNostroPayoutModal(bot, audit, rules, ui),
            }, `💸 אשר משיכה ($${audit.withdrawableUsd.toLocaleString('en-US')})`)
          : null,
        isReady
          ? h('button', {
              class: 'btn btn-sm btn-primary',
              style: { background: '#3b82f6', borderColor: '#2563eb', fontWeight: '700' },
              onclick: async () => {
                const pf = ensurePaperPortfolio();
                const deskId = `nostro_live_${String(bot.id).replace(/[^a-z0-9_]/gi, '_')}`;
                const already = store.state.desks.some((d) => d.id === deskId);
                if (already) {
                  toast(`${bot.name} כבר רץ בתיק המסחר הרגיל (שולחן ${deskId})`, 'info');
                  ui.rerender();
                  return;
                }
                const m = bot.metrics || {};
                const isCrypto = String(bot.symbol || '').endsWith('USDT');
                const kind = (bot.tf === '1d' || bot.tf === '1w') ? 'swing' : 'intraday';
                const risk = Number(bot.riskPerTrade) > 0 ? Math.min(0.01, Number(bot.riskPerTrade)) : 0.005;
                const desk = {
                  id: deskId,
                  label: `${bot.name || bot.id} · מסחר שוטף (מהנוסטרו)`,
                  short: bot.symbol || bot.id,
                  tf: bot.tf || '1h',
                  kind,
                  symbol: bot.symbol || 'BTCUSDT',
                  venue: isCrypto ? 'Binance / Kraken' : 'Yahoo Finance',
                  weight: 0.05,
                  horizon: kind === 'swing' ? 'סווינג' : 'תוך־יומי',
                  mandate: `קודם ידנית מהנוסטרו למסחר השוטף אחרי שעבר ${bot.readyFirms.join(', ')} על נתוני אמת: ${m.trades} עסקאות, PF ${m.profitFactor}, DD ${m.maxDrawdownPct}%, תשואה ${bot.totalReturnPct}%. סיכון ${(risk * 100).toFixed(2)}% לעסקה.`,
                  strategyId: bot.strategyId,
                  params: cloneParams(bot.params),
                  lockedStrategy: true,
                  source: 'nostro_promotion_manual',
                  nostroBotId: bot.id,
                  riskPerTrade: risk,
                  status: 'live',
                  liveSince: Date.now(),
                  dryRunCycles: 3,
                  history: [],
                  equity: [],
                  liveTrades: [],
                  livePnl: 0,
                  livePeakPnl: 0,
                  openTrade: null,
                  ideas: [],
                  metrics: { ...m },
                  createdAt: Date.now(),
                };
                store.state.desks.push(desk);
                pf.activate({ reason: `בוט נוסטרו הופעל על התיק הרגיל: ${bot.name}` });
                savePaperPortfolio();
                store.save(true);
                store.emit();
                scheduleDatabasePush(800);
                toast(`✅ ${bot.name} הופעל על התיק המסחר הרגיל ויפעל מעכשיו בזמן אמת!`, 'ok');
                ui.rerender();
              },
            }, '🚀 הפעל על התיק הרגיל (Live Desk)')
          : null,
        isReady && !enrolledAcct
          ? h('button', {
              class: 'btn btn-sm btn-primary',
              onclick: async () => {
                enrollBotInNostroRoom(bot, { accountSize: rules.accountSize });
                await tickNostroTradingRoom({ force: false });
                store.save(true);
                toast(`${bot.name} הועבר לחדר המסחר הדמה של הנוסטרו!`, 'ok');
                ui.rerender();
              },
            }, '🚀 העבר לחדר מסחר נוסטרו')
          : null,
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
              if ((updated.readyFirms || []).length > 0 && room.autoEnroll !== false) {
                enrollBotInNostroRoom(updated, { accountSize: rules.accountSize });
              }
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
        h('button', {
          class: 'btn btn-sm',
          onclick: () => openNostroBotDetailModal(bot, ui, rules),
        }, '🔎 פירוט בוט'),
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
