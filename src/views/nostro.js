// Prop Firm / Nostro Challenge Dashboard (#/nostro)

import { store } from '../store.js';
import { h, mount, money, pct, num, tag, chart, notice, empty, toast, timeAgo } from '../ui.js';
import { STRATEGIES, describeParams } from '../strategies.js';
import {
  DEFAULT_NOSTRO_RULES,
  NOSTRO_BOT_TEMPLATES,
  runNostroBot,
  runNostroFleetSimulation,
} from '../nostro.js';

let runningFleet = false;

export function renderNostro(root, ui) {
  const nostro = store.state.nostro || { rules: { ...DEFAULT_NOSTRO_RULES }, bots: [], updatedAt: null };
  const rules = { ...DEFAULT_NOSTRO_RULES, ...(nostro.rules || {}) };
  const bots = nostro.bots || [];

  const acctSel = h('select', { class: 'input' }, [
    [25000, '$25,000'],
    [50000, '$50,000'],
    [100000, '$100,000'],
    [200000, '$200,000'],
  ].map(([v, l]) => h('option', { value: v, selected: rules.accountSize === v }, `תיק ${l}`)));

  const p1Sel = h('select', { class: 'input' }, [8, 10].map((v) =>
    h('option', { value: v, selected: rules.phase1TargetPct === v }, `שלב 1: +${v}%`)
  ));

  const runAll = async (doOptimize = false) => {
    if (runningFleet) return;
    runningFleet = true;
    ui.rerender();
    try {
      await runNostroFleetSimulation({
        accountSize: Number(acctSel.value) || 100000,
        phase1TargetPct: Number(p1Sel.value) || 8,
      }, { doOptimize });
      toast(doOptimize ? 'מיטוב ומבחן נוסטרו הושלמו ונשמרו בדאטה-בייס!' : 'מבחן הדמה לנוסטרו הושלם!', 'ok');
    } catch (err) {
      toast('שגיאה בהרצת מבחן נוסטרו: ' + err.message, 'bad');
    } finally {
      runningFleet = false;
      ui.rerender();
    }
  };

  const fundedBots = bots.filter((b) => b.status === 'funded');
  const phase1Bots = bots.filter((b) => b.phase1Passed);
  const totalFundedPayout = bots.reduce((s, b) => s + (b.fundedProfitUsd || 0), 0);

  mount(root,
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: 'Prop Firm Simulation · מבחני נוסטרו מרובי בוטים' }),
        h('h1', { text: 'מבחני נוסטרו (Prop Firm Bot Fleet)' }),
        h('p', { text: 'צי של 5 בוטים עם אסטרטגיות שונות (מגמה, גאן, Supertrend, פריצת תנודתיות ו-Z-Score) המכוילים לעבור שלב 1 + שלב 2 של מבחני נוסטרו ולהוכיח רווחיות תחת מגבלות הפסד יומי (5%) ו-Drawdown כולל (10%).' }),
      ),
      h('div', { class: 'head-actions' },
        acctSel,
        p1Sel,
        h('button', {
          class: 'btn btn-sm',
          disabled: runningFleet,
          onclick: () => runAll(false),
        }, runningFleet ? 'מריץ מבחנים…' : '▶ הרץ מבחן דמה'),
        h('button', {
          class: 'btn btn-sm btn-primary',
          disabled: runningFleet,
          onclick: () => runAll(true),
        }, runningFleet ? 'ממטב ובוחן…' : '⚡ מטב + הרץ מבחן נוסטרו'),
      ),
    ),
  );

  mount(root, notice(
    `חוקי המבחן הפעילים: תיק ${money(rules.accountSize)} · יעד שלב 1: +${rules.phase1TargetPct}% · יעד שלב 2: +${rules.phase2TargetPct}% · הפסד יומי מקסימלי: -${rules.maxDailyLossPct}% · Drawdown מקסימלי: -${rules.maxTotalDdPct}% · חלוקת רווחים בחשבון Funded: ${rules.profitSplitPct}%.`,
    'blue',
  ));

  mount(root, h('div', { class: 'grid cols-4', style: { marginTop: '14px' } },
    h('div', { class: 'metric' }, h('span', { text: 'בוטים שעברו Funded (שלב 1+2)' }), h('b', { class: fundedBots.length ? 'green mono' : 'mono', text: `${fundedBots.length}/${NOSTRO_BOT_TEMPLATES.length}` })),
    h('div', { class: 'metric' }, h('span', { text: 'עברו שלב 1' }), h('b', { class: 'mono', text: `${phase1Bots.length}/${NOSTRO_BOT_TEMPLATES.length}` })),
    h('div', { class: 'metric' }, h('span', { text: 'רווח משוער למשיכה (Funded 80%)' }), h('b', { class: 'green mono', text: money(totalFundedPayout) })),
    h('div', { class: 'metric' }, h('span', { text: 'עדכון אחרון' }), h('b', { class: 'small', text: nostro.updatedAt ? timeAgo(nostro.updatedAt) : 'טרם הורץ' })),
  ));

  if (!bots.length) {
    mount(root, h('div', { class: 'card', style: { marginTop: '14px' } },
      empty('לחץ על "⚡ מטב + הרץ מבחן נוסטרו" למעלה כדי להריץ את 5 הבוטים על נתוני עבר ולהוכיח עמידה בחוקי הנוסטרו.'),
    ));
    return;
  }

  mount(root, h('div', { class: 'grid cols-2', style: { marginTop: '14px', gap: '14px' } },
    ...bots.map((bot) => {
      const cls = bot.status === 'funded' ? 'live' : bot.status === 'phase2' ? 'opt' : bot.status === 'failed' ? 'red' : 'dry';
      return h('div', {
        class: 'card',
        style: { borderColor: bot.status === 'funded' ? 'rgba(46, 204, 113, 0.5)' : bot.status === 'failed' ? 'rgba(240, 91, 91, 0.35)' : undefined },
      },
        h('div', { class: 'card-head' },
          h('div', {},
            h('h2', { text: bot.name }),
            h('div', { class: 'card-sub', text: `${bot.symbol} · ${bot.tf} · ${STRATEGIES[bot.strategyId]?.label || bot.strategyId} · סיכון ${(bot.riskPerTrade * 100).toFixed(2)}%` }),
          ),
          tag(bot.statusLabel, cls),
        ),
        h('div', { class: 'small muted', style: { marginBottom: '8px' }, text: bot.note }),
        bot.breached ? h('div', { class: 'notice bad', style: { marginBottom: '8px' }, text: bot.breached }) : null,
        h('div', { class: 'grid cols-3', style: { gap: '8px', marginBottom: '10px' } },
          h('div', { class: 'metric' }, h('span', { text: 'תשואה כוללת' }), h('b', { class: (bot.totalReturnPct >= 0 ? 'green ' : 'red ') + 'mono', text: pct(bot.totalReturnPct) })),
          h('div', { class: 'metric' }, h('span', { text: 'Max DD כולל' }), h('b', { class: (bot.maxTotalDdPct < rules.maxTotalDdPct ? 'green ' : 'red ') + 'mono', text: `${bot.maxTotalDdPct}% / ${rules.maxTotalDdPct}%` })),
          h('div', { class: 'metric' }, h('span', { text: 'הפסד יומי שיא' }), h('b', { class: (bot.maxDailyLossPct < rules.maxDailyLossPct ? 'green ' : 'red ') + 'mono', text: `${bot.maxDailyLossPct}% / ${rules.maxDailyLossPct}%` })),
          h('div', { class: 'metric' }, h('span', { text: 'Profit Factor' }), h('b', { class: 'mono', text: bot.metrics?.profitFactor ?? '—' })),
          h('div', { class: 'metric' }, h('span', { text: 'עסקאות' }), h('b', { class: 'mono', text: bot.metrics?.trades ?? 0 })),
          h('div', { class: 'metric' }, h('span', { text: 'משיכה Funded' }), h('b', { class: 'green mono', text: money(bot.fundedProfitUsd || 0) })),
        ),
        bot.curve?.length ? chart(bot.curve, { height: 95, color: bot.status === 'failed' ? 'red' : 'green', showZero: false }) : null,
        h('div', { class: 'tiny muted', style: { marginTop: '8px' }, text: `פרמטרים: ${describeParams(bot.strategyId, bot.params)}` }),
        h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '10px' } },
          h('button', {
            class: 'btn btn-sm',
            onclick: async (e) => {
              const btn = e.currentTarget;
              btn.disabled = true;
              btn.textContent = 'ממטב…';
              try {
                const updated = await runNostroBot(bot, rules, { doOptimize: true });
                const idx = store.state.nostro.bots.findIndex((b) => b.id === bot.id);
                if (idx >= 0) store.state.nostro.bots[idx] = updated;
                store.save();
                toast(`${bot.name}: ${updated.statusLabel} (${pct(updated.totalReturnPct)})`, updated.status === 'funded' ? 'ok' : '');
              } catch (err) {
                toast('שגיאה: ' + err.message, 'bad');
              } finally {
                btn.disabled = false;
                ui.rerender();
              }
            },
          }, '⚙ מטב בוט זה לנוסטרו'),
        ),
      );
    }),
  ));
}
