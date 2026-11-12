import { mount } from '../ui.js';
import { store } from '../store.js';
import { PLATFORMS } from '../config.js';
import { buildArtifact } from '../platforms.js';
import { h, pct, num, section, tag, notice, empty, openModal, downloadFile, toast, timeAgo, statusTag } from '../ui.js';
import { strategyName } from './shared.js';

export function renderBots(root, ui) {
  const state = store.state;
  const s = state.settings;
  const desk = state.desks.find((d) => d.id === ui.selectedDesk) || state.desks[0];
  if (!desk) return;
  const version = desk.history[0];

  const artifactFor = (v) => buildArtifact({
    ...desk,
    version: v.version,
    params: v.params,
    strategyId: v.strategyId,
    metrics: {
      returnPct: v.fullReturn, profitFactor: v.profitFactor,
      maxDrawdownPct: v.maxDrawdownPct, trades: v.trades, sharpe: '—',
    },
    oosMetrics: { returnPct: v.oosReturn },
  }, s.platform);

  const preview = (code, filename) => {
    const pre = h('pre', { class: 'code', text: code });
    const body = h('div', {},
      h('div', { class: 'row between', style: { marginBottom: '8px' } },
        h('div', { class: 'small muted', text: filename }),
        h('div', { class: 'row', style: { gap: '6px' } },
          h('button', { class: 'btn btn-sm', onclick: () => { navigator.clipboard?.writeText(code).then(() => toast('הקוד הועתק', 'ok')); } }, 'העתק'),
          h('button', { class: 'btn btn-sm', onclick: () => downloadFile(filename, code, 'text/plain') }, 'הורד'),
        ),
      ),
      pre,
      notice('הקוד מיוצא לפלטפורמה שבחרת. הרץ אותו קודם ב-dry-run אצלך, עם מפתחות הבורסה שלך — לא כאן.', 'blue'),
    );
    openModal(filename, body, { wide: true });
  };

  mount(root, 
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: 'Versioning & deployment' }),
        h('h1', { text: 'גרסאות ובוטים' }),
        h('p', { text: 'כל שיפור של אחוז אחד ב-out-of-sample יוצר גרסה חדשה, אורז קוד לפלטפורמת הבוט שתבחר ורושם יומן שינויים. אתה מוריד ומריץ — או מריץ על נייר כאן.' }),
      ),
      h('div', { class: 'head-actions' },
        h('select', {
          onchange: (e) => ui.setDesk(e.target.value),
          style: { minWidth: '210px' },
        }, state.desks.map((d) => h('option', { value: d.id, selected: d.id === desk.id }, `${d.label} · ${d.symbol}`))),
        h('select', {
          onchange: (e) => store.mutate((st) => { st.settings.platform = e.target.value; }),
          style: { minWidth: '170px' },
        }, Object.entries(PLATFORMS).map(([k, p]) => h('option', { value: k, selected: k === s.platform }, p.label))),
      ),
    ),
  );

  mount(root, h('div', { class: 'grid cols-2' },
    h('div', { class: 'card' },
      h('div', { class: 'row between' },
        h('div', {},
          h('div', { class: 'row', style: { gap: '7px' } },
            h('h2', { text: desk.label }),
            statusTag(desk.status),
            tag(desk.version || 'ללא גרסה', desk.version ? 'green' : ''),
          ),
          h('div', { class: 'small muted', text: `${strategyName(desk.strategyId)} · ${s.platform}` }),
        ),
        h('div', { style: { textAlign: 'left' } },
          h('div', { class: 'mono green', style: { fontSize: '20px' }, text: desk.bestReturn == null ? '—' : pct(desk.bestReturn) }),
          h('div', { class: 'tiny muted', text: 'OOS' }),
        ),
      ),
      desk.params ? h('div', { class: 'grid cols-3', style: { marginTop: '12px' } },
        mini('תשואה', desk.metrics ? pct(desk.metrics.returnPct) : '—'),
        mini('PF', desk.metrics?.profitFactor ?? '—'),
        mini('עסקאות', desk.metrics?.trades ?? '—'),
      ) : null,
      h('div', { class: 'row wrap', style: { marginTop: '12px', gap: '6px' } },
        h('button', {
          class: 'btn btn-primary',
          disabled: !desk.params,
          onclick: () => {
            const a = buildArtifact(desk, s.platform);
            preview(a.code, a.filename);
          },
        }, 'הצג / הורד קוד'),
        h('button', {
          class: 'btn',
          disabled: !desk.params,
          onclick: () => { const a = buildArtifact(desk, s.platform); downloadFile(a.filename, a.code); toast('הקוד הורד', 'ok'); },
        }, '⬇ הורדה'),
        h('button', { class: 'btn btn-ghost', onclick: () => ui.go('lab') }, 'למעבדה'),
      ),
      desk.generatedCode ? h('div', { class: 'tiny muted', style: { marginTop: '8px' } }, `ארטיפקט אחרון: ${desk.artifactName || '—'} · ${num(desk.generatedCode.length)} תווים`) : null,
    ),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', { text: 'הרצה על נייר' }), h('div', { class: 'card-sub', text: 'PnL מצטבר מאז הקידום, ללא כסף אמיתי' }))),
      h('div', { class: 'grid cols-3' },
        mini('PnL נייר', desk.livePnl ? pct(desk.livePnl) : '0%'),
        mini('גרסה חיה', desk.version || '—'),
        mini('פוזיציה', desk.openTrade ? (desk.openTrade.dir > 0 ? 'לונג' : 'שורט') : 'אין'),
      ),
      desk.openTrade ? h('div', { class: 'small muted', style: { marginTop: '10px' } },
        `כניסה ${desk.openTrade.entry} · סטופ ${desk.openTrade.stop.toFixed(2)} · יעד ${desk.openTrade.target.toFixed(2)} · ${desk.openTrade.markPct != null ? pct(desk.openTrade.markPct) : '—'}`,
      ) : null,
      desk.liveTrades.length
        ? h('div', { class: 'table-wrap', style: { marginTop: '10px' } }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', { text: 'מתי' }), h('th', { text: 'כיוון' }), h('th', { class: 'num', text: 'כניסה' }), h('th', { class: 'num', text: 'יציאה' }), h('th', { class: 'num', text: 'PnL' }), h('th', { text: 'סיבה' }))),
          h('tbody', {}, desk.liveTrades.slice(0, 6).map((t) => h('tr', {},
            h('td', { class: 'tiny muted', text: timeAgo(t.at) }),
            h('td', { text: t.dir > 0 ? 'לונג' : 'שורט' }),
            h('td', { class: 'num', text: t.entry }),
            h('td', { class: 'num', text: t.exit }),
            h('td', { class: 'num ' + (t.pct >= 0 ? 'green' : 'red'), text: pct(t.pct) }),
            h('td', { class: 'tiny muted', text: t.reason }),
          ))),
        ))
        : empty('אין עסקאות נייר עדיין — השולחן עובר להרצה חיה אחרי 3 מחזורי dry-run נקיים'),
    ),
  ));

  mount(root, h('div', { class: 'card', style: { marginTop: '14px' } },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', { text: 'היסטוריית גרסאות' }), h('div', { class: 'card-sub', text: 'כל גרסה ניתנת להורדה בפורמט הפלטפורמה הנוכחית' })),
    ),
    desk.history.length
      ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {},
          h('th', { text: 'גרסה' }), h('th', { text: 'מתי' }), h('th', { text: 'אסטרטגיה' }),
          h('th', { class: 'num', text: 'OOS' }), h('th', { class: 'num', text: 'PF' }), h('th', { class: 'num', text: 'DD' }),
          h('th', { class: 'num', text: 'עסקאות' }), h('th', { text: 'קוד' }),
        )),
        h('tbody', {}, desk.history.map((v) => h('tr', {},
          h('td', {}, tag(v.version, 'green')),
          h('td', { class: 'tiny muted', text: new Date(v.at).toLocaleString('he-IL') }),
          h('td', { class: 'small', text: strategyName(v.strategyId) }),
          h('td', { class: 'num green', text: pct(v.oosReturn) }),
          h('td', { class: 'num', text: v.profitFactor }),
          h('td', { class: 'num red', text: pct(-v.maxDrawdownPct) }),
          h('td', { class: 'num', text: v.trades }),
          h('td', {}, h('button', {
            class: 'btn-link',
            onclick: () => { const a = artifactFor(v); preview(a.code, a.filename); },
          }, 'הצג')),
        ))),
      ))
      : empty('אין גרסאות עדיין — הרץ מחזור במעבדה'),
  ));

  mount(root, h('div', { class: 'card', style: { marginTop: '14px' } },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', { text: 'פלטפורמות בוטים בקוד פתוח' }), h('div', { class: 'card-sub', text: 'הקוד מיוצא בפורמט של כל אחת מהן; ההתקנה וההרצה אצלך' })),
    ),
    h('div', { class: 'grid cols-2' },
      Object.entries(PLATFORMS).map(([key, p]) => h('div', { class: 'agent' },
        h('div', { class: 'av', text: p.lang === 'Python' ? 'Py' : p.lang === 'JS' ? 'JS' : '{}' }),
        h('div', { class: 'grow' },
          h('div', { class: 'who' }, h('b', { text: p.label }), h('span', { text: `${p.lang} · ${p.license}` })),
          h('div', { class: 'small muted', text: p.blurb }),
          h('div', { class: 'row', style: { gap: '8px', marginTop: '6px' } },
            p.repo ? h('a', { class: 'btn-link', href: p.repo, target: '_blank', rel: 'noreferrer' }, 'GitHub ↗') : null,
            h('button', {
              class: 'btn-link',
              onclick: () => store.mutate((st) => { st.settings.platform = key; }),
            }, s.platform === key ? '✓ נבחר' : 'בחר פלטפורמה'),
          ),
        ),
      )),
    ),
    notice('הקפד להריץ כל אסטרטגיה קודם ב-dry-run של הפלטפורמה, עם הגבלת הון, והשווה את התוצאות לבקטסט כאן לפני שאתה מסכן כסף.', 'blue'),
  ));
}

function mini(label, value) {
  return h('div', { class: 'metric' }, h('span', { text: label }), h('b', { text: String(value) }));
}
