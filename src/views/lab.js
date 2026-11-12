import { mount } from '../ui.js';
import { store } from '../store.js';
import { STRATEGIES, STRATEGY_IDS } from '../strategies.js';
import { marketState } from '../market.js';
import { h, pct, num, chart, section, statusTag, tag, notice, empty, openModal, timeAgo, toast } from '../ui.js';
import { runAiDirector } from '../ai.js';
import { metricsTable, gateList, strategyName } from './shared.js';
import { runDeskCycle, resetDesk, switchStrategy } from '../firm.js';

export function renderLab(root, ui) {
  const state = store.state;
  const s = state.settings;
  const desk = state.desks.find((d) => d.id === ui.selectedDesk) || state.desks[0];
  if (!desk) return;

  const act = async (fn) => {
    try { await fn(); ui.rerender(); } catch (err) { console.error(err); }
  };

  mount(root, 
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: 'Strategy lab' }),
        h('h1', { text: 'מעבדת אסטרטגיות' }),
        h('p', { text: 'כאן רואים איך הגרסה נבנתה: פרמטרים, תוצאות in-sample מול out-of-sample, שערי הסיכון והיסטוריית הגרסאות.' }),
      ),
      h('div', { class: 'head-actions' },
        h('select', {
          value: desk.id,
          onchange: (e) => { ui.setDesk(e.target.value); },
          style: { minWidth: '220px' },
        }, state.desks.map((d) => h('option', { value: d.id, selected: d.id === desk.id }, `${d.label} · ${d.symbol}`))),
        h('button', { class: 'btn btn-primary', onclick: () => act(() => runDeskCycle(desk)), }, '▶ הרץ מחזור'),
        h('button', { class: 'btn', onclick: () => act(() => runDeskCycle(desk, { deep: true, focus: true })) }, '⚙ כיול מעמיק'),
      ),
    ),
    h('div', { class: 'grid cols-2' },
      h('div', { class: 'stack' },
        h('div', { class: 'card' },
          h('div', { class: 'row between' },
            h('div', {},
              h('div', { class: 'row', style: { gap: '7px' } },
                h('h2', { text: desk.label }),
                statusTag(desk.status),
                tag(desk.version || 'אין גרסה', desk.version ? 'green' : ''),
              ),
              h('div', { class: 'small muted', text: `${desk.symbol} · ${desk.tf} · ${strategyName(desk.strategyId)}` }),
            ),
            h('div', { style: { textAlign: 'left' } },
              h('div', { class: 'mono ' + (desk.metrics?.returnPct >= 0 ? 'green' : 'red'), style: { fontSize: '22px' }, text: desk.metrics ? pct(desk.metrics.returnPct) : '—' }),
              h('div', { class: 'tiny muted', text: 'תשואת בקטסט' }),
            ),
          ),
          h('div', { style: { marginTop: '10px' } }, chart(desk.equity, { height: 170, color: 'green', showZero: true })),
          h('div', { class: 'grid cols-4', style: { marginTop: '10px', gap: '8px' } },
            mini('עסקאות', desk.metrics?.trades ?? '—'),
            mini('PF', desk.metrics?.profitFactor ?? '—'),
            mini('DD', desk.metrics ? pct(-desk.metrics.maxDrawdownPct) : '—'),
            mini('Sharpe', desk.metrics?.sharpe ?? '—'),
          ),
        ),
        h('div', { class: 'card' },
          h('div', { class: 'card-head' },
            h('div', {}, h('h2', { text: 'פרמטרים נוכחיים' }), h('div', { class: 'card-sub', text: 'הערכים שנבחרו בגרסה האחרונה' })),
            desk.params ? h('button', {
              class: 'btn btn-sm btn-ghost',
              onclick: () => openModal('פרמטרים · ' + desk.label, h('pre', { class: 'code', text: JSON.stringify(desk.params, null, 2) })),
            }, 'JSON') : null,
          ),
          desk.params
            ? h('div', { class: 'grid cols-2', style: { gap: '8px' } },
              Object.entries(desk.params).map(([k, v]) => h('div', { class: 'metric' },
                h('span', { text: paramLabel(k) }),
                h('b', { text: typeof v === 'boolean' ? (v ? 'כן' : 'לא') : String(v) }),
              )),
            )
            : empty('עוד לא נבחרו פרמטרים — הרץ מחזור כיול'),
          h('div', { class: 'row wrap', style: { marginTop: '12px', gap: '8px' } },
            h('label', { class: 'field', style: { flex: '1 1 220px' } },
              'החלף משפחת אסטרטגיה (מאפס גרסאות)',
              h('select', {
                value: desk.strategyId || '',
                onchange: (e) => { if (e.target.value) act(() => switchStrategy(desk.id, e.target.value)); },
              },
                h('option', { value: '' }, 'בחר...'),
                STRATEGY_IDS.map((id) => h('option', { value: id, selected: id === desk.strategyId }, STRATEGIES[id].label)),
              ),
            ),
            h('div', { class: 'field', style: { flex: '1 1 160px' } },
              'פעולות',
              h('div', { class: 'row', style: { gap: '6px' } },
                h('button', { class: 'btn btn-sm', onclick: () => act(() => runDeskCycle(desk, { deep: true, focus: true })) }, 'כיול עמוק'),
                h('button', { class: 'btn btn-sm btn-danger', onclick: () => act(() => resetDesk(desk.id)) }, 'אפס שולחן'),
              ),
            ),
          ),
          h('div', { class: 'small muted', style: { marginTop: '10px' } },
            STRATEGIES[desk.strategyId]?.blurb || '',
          ),
        ),
      ),

      h('div', { class: 'stack' },
        h('div', { class: 'card' },
          h('div', { class: 'card-head' },
            h('div', {}, h('h2', { text: 'In-sample מול Out-of-sample' }), h('div', { class: 'card-sub', text: 'המדד הקובע לקידום הוא ה-OOS' })),
          ),
          metricsTable(desk),
          notice('אם ה-OOS נמוך משמעותית מה-in-sample, זו עדות ל-overfitting. במקרה כזה הפחת פרמטרים או החלף משפחת אסטרטגיה.', 'blue'),
        ),
        statsCard(desk),
        technicalCard(desk),
        aiDirectorCard(desk, ui),
        h('div', { class: 'card' },
          h('div', { class: 'card-head' },
            h('div', {}, h('h2', { text: 'שערי סיכון וקידום' }), h('div', { class: 'card-sub', text: `סף שיפור: ${s.promotionDelta}% · OOS נדרש חיובי` })),
          ),
          gateList(desk, s),
          h('div', { class: 'small muted', style: { marginTop: '8px' } },
            `נתונים: ${desk.lastCandles ? num(desk.lastCandles) + ' נרות' : '—'} · מקור: ${marketLabel()}`,
          ),
        ),
        h('div', { class: 'card' },
          h('div', { class: 'card-head' },
            h('div', {}, h('h2', { text: 'היסטוריית גרסאות' }), h('div', { class: 'card-sub', text: 'גרסה חדשה נפתחת בכל שיפור ≥ ' + s.promotionDelta + '%' })),
            h('button', { class: 'btn btn-sm btn-ghost', onclick: () => ui.go('bots') }, 'קוד ובוטים →'),
          ),
          desk.history.length
            ? h('div', { class: 'table-wrap' }, h('table', {},
              h('thead', {}, h('tr', {},
                h('th', { text: 'גרסה' }), h('th', { class: 'num', text: 'OOS' }), h('th', { class: 'num', text: 'PF' }),
                h('th', { class: 'num', text: 'עסקאות' }), h('th', { text: 'שיפור' }),
              )),
              h('tbody', {}, desk.history.slice(0, 8).map((v) => h('tr', {},
                h('td', {}, tag(v.version, 'green')),
                h('td', { class: 'num green', text: pct(v.oosReturn) }),
                h('td', { class: 'num', text: v.profitFactor }),
                h('td', { class: 'num', text: v.trades }),
                h('td', { class: 'tiny muted', text: v.improvement == null ? 'בסיס' : `+${v.improvement}%` }),
              ))),
            ))
            : empty('אין גרסאות עדיין'),
        ),
      ),
    ),
  );
}

function mini(label, value) {
  return h('div', { class: 'metric' }, h('span', { text: label }), h('b', { text: String(value) }));
}

function statsCard(desk) {
  const a = desk.assessment;
  if (!a) {
    return h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', { text: 'חיזוק סטטיסטי' }), h('div', { class: 'card-sub', text: 'walk-forward · Monte Carlo · רגישות פרמטרים' }))),
      empty('הרץ מחזור כדי לחשב חוסן סטטיסטי'),
    );
  }
  const wf = a.walkForward || {};
  const mc = a.monteCarlo || {};
  const sens = a.sensitivity || {};
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', { text: 'חיזוק סטטיסטי' }), h('div', { class: 'card-sub', text: '4 חלונות walk-forward · bootstrap · רגישות פרמטרים' })),
      tag(`חוסן ${a.robustness}/100`, a.robustness >= 50 ? 'green' : 'opt'),
    ),
    h('div', { class: 'grid cols-3', style: { gap: '8px' } },
      mini('חלונות חיוביים', `${wf.positiveFolds ?? 0}/${wf.totalFolds ?? 0}`),
      mini('תרחיש 5% (MC)', mc.available ? pct(mc.p05) : '—'),
      mini('הסתברות רווח', mc.available ? Math.round(mc.probProfit * 100) + '%' : '—'),
    ),
    (wf.folds || []).length
      ? h('div', { class: 'table-wrap', style: { marginTop: '10px' } }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { text: 'חלון' }), h('th', { class: 'num', text: 'תשואה' }), h('th', { class: 'num', text: 'עסקאות' }), h('th', { class: 'num', text: 'PF' }), h('th', { class: 'num', text: 'DD' }))),
        h('tbody', {}, wf.folds.map((f) => h('tr', {},
          h('td', { text: `#${f.fold}` }),
          h('td', { class: 'num ' + (f.returnPct >= 0 ? 'green' : 'red'), text: pct(f.returnPct) }),
          h('td', { class: 'num', text: f.trades }),
          h('td', { class: 'num', text: f.profitFactor }),
          h('td', { class: 'num red', text: pct(-f.maxDrawdownPct) }),
        ))),
      ))
      : h('div', { class: 'small muted', style: { marginTop: '8px' }, text: wf.note || 'אין חלונות' }),
    mc.available
      ? h('div', { style: { marginTop: '10px' } },
        chart((mc.histogram || []).map((b) => b.count), { height: 44, color: 'blue' }),
        h('div', { class: 'tiny muted', text: `${mc.iterations} סימולציות · חציון ${pct(mc.p50)} · תרחיש 5% ${pct(mc.p05)} · DD95 ${pct(-mc.ddP95)} · סיכון קריסה ${Math.round(mc.ruinProb * 100)}%` }),
      )
      : h('div', { class: 'small muted', style: { marginTop: '8px' }, text: mc.note || '' }),
    h('div', { class: 'tiny muted', style: { marginTop: '8px' } },
      `רגישות פרמטרים ${sens.sensitivity ?? '—'} (נמוך = יציב יותר) · סטיית תשואה ${sens.sd ?? '—'} נק׳ · דגימות שנשברו ${sens.brokenSamples ?? 0}`,
    ),
  );
}

function aiDirectorCard(desk, ui) {
  const state = store.state;
  const director = state.aiDirector;
  const plan = desk.aiPlan;
  const review = desk.aiReview;
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', { text: 'החלטת הסוכן החכם' }),
        h('div', { class: 'card-sub', text: director
          ? `${director.source === 'model' ? 'מודל ' + (director.model || '') : 'כללים מקומיים'} · ${timeAgo(director.at)}`
          : 'טרם התקבלה החלטה' })),
      h('button', {
        class: 'btn btn-sm',
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          btn.textContent = 'חושב…';
          try {
            const res = await runAiDirector({ useFallback: true });
            toast(res.ok ? 'התקבלה החלטה חדשה' : String(res.reason), res.ok ? 'ok' : 'bad');
          } catch (err) {
            toast(err.message, 'bad');
          }
          ui.rerender();
        },
      }, 'בקש החלטה'),
    ),
    plan
      ? h('div', {},
        h('div', { class: 'row wrap', style: { gap: '6px' } },
          tag(STRATEGIES[plan.strategyId]?.label || plan.strategyId, 'green'),
          plan.paramBias && Object.keys(plan.paramBias).length
            ? tag(Object.entries(plan.paramBias).map(([k, v]) => `${k} ${v[0]}–${v[1]}`).join(' · '))
            : null,
          plan.consumed ? tag('הוחל במחזור האחרון', 'dry') : tag('ממתין למחזור הבא', 'opt'),
        ),
        h('div', { class: 'small muted', style: { marginTop: '8px' }, text: plan.rationale || '' }),
      )
      : h('div', { class: 'small muted', text: 'אין תוכנית פתוחה. בקש החלטה — המודל בוחר שולחן, משפחת אסטרטגיה וטווח פרמטרים למחזור הבא.' }),
    review
      ? h('div', { style: { marginTop: '10px' } },
        h('div', { class: 'small', text: review.verdict || '' }),
        (review.risks || []).length
          ? h('ul', { class: 'list-clean', style: { marginTop: '6px' } }, review.risks.map((r) => h('li', {},
            h('span', { class: 'bul red', text: '!' }), h('span', { class: 'grow', text: r }),
          )))
          : null,
      )
      : null,
    director?.plan?.nextActions?.length
      ? h('div', { style: { marginTop: '10px' } },
        h('div', { class: 'tiny muted', text: 'הפעולות הבאות לפי ה-AI' }),
        h('ul', { class: 'list-clean', style: { marginTop: '4px' } }, director.plan.nextActions.map((a) => h('li', {},
          h('span', { class: 'bul', text: '→' }), h('span', { class: 'grow', text: a }),
        ))),
      )
      : null,
  );
}

function technicalCard(desk) {
  const ta = desk.technical;
  if (!ta) {
    return h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', { text: 'ניתוח טכני' }), h('div', { class: 'card-sub', text: 'מגמה · מומנטום · תנודתיות · מבנה' }))),
      empty('מנתחת טכנית ממתינה לנתוני השולחן'),
    );
  }
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', { text: 'ניתוח טכני' }), h('div', { class: 'card-sub', text: `מחיר ${ta.price} · ${ta.trend.label}` })),
      h('div', { class: 'row', style: { gap: '6px' } },
        tag(ta.biasLabel, ta.bias > 0.12 ? 'live' : ta.bias < -0.12 ? 'paused' : ''),
        tag(`ביטחון ${ta.confidence}%`),
      ),
    ),
    h('ul', { class: 'list-clean' }, (ta.summary || []).map((s) => h('li', {},
      h('span', { class: 'bul', text: '•' }), h('span', { class: 'grow', text: s }),
    ))),
    h('div', { class: 'grid cols-3', style: { gap: '8px', marginTop: '10px' } },
      mini('תמיכה', ta.structure.support),
      mini('התנגדות', ta.structure.resistance),
      mini('ADX', ta.trend.adx ?? '—'),
    ),
  );
}

function paramLabel(key) {
  return {
    fast: 'EMA מהיר', slow: 'EMA איטי', atrStop: 'סטופ × ATR', rr: 'יעד R:R',
    period: 'תקופה', oversold: 'RSI קנייה', overbought: 'RSI מכירה',
    threshold: 'סף מומנטום %', trendFilter: 'פילטר מגמה', filter: 'פילטר',
    signal: 'MACD סיגנל',
  }[key] || key;
}

function marketLabel() {
  return marketState.provider || '—';
}
