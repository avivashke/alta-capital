import { mount } from '../ui.js';
// Shared building blocks used by more than one view.

import { h, chart, pct, num, statusTag, timeAgo, progressBar, tag, signClass, agentBubble } from '../ui.js';
import { STRATEGIES } from '../strategies.js';
import { STRATEGY_LABELS, PLATFORMS } from '../config.js';

export function deskCard(desk, { onRun, onOpen, compact = false } = {}) {
  const m = desk.metrics;
  const oos = desk.oosMetrics;
  return h('div', { class: 'card desk-card' },
    h('div', { class: 'row between' },
      h('div', {},
        h('div', { class: 'row', style: { gap: '7px' } },
          h('strong', { style: { fontSize: '13px' }, text: desk.label }),
          statusTag(desk.status),
        ),
        h('div', { class: 'small muted', text: `${desk.symbol} · ${desk.tf} · ${desk.version || 'אין גרסה'}` }),
      ),
      h('div', { style: { textAlign: 'left' } },
        h('div', { class: 'mono ' + signClass(desk.bestReturn), style: { fontSize: '16px' }, text: oos ? pct(oos.returnPct) : (desk.bestReturn != null ? pct(desk.bestReturn) : '—') }),
        h('div', { class: 'tiny muted', text: 'OOS' }),
      ),
    ),
    chart(desk.equity, { height: compact ? 44 : 62, color: 'green' }),
    h('div', { class: 'metrics' },
      metric('תשואה', m ? pct(m.returnPct) : '—', m ? m.returnPct : null),
      metric('PF', m ? num(m.profitFactor, 2) : '—', m ? m.profitFactor - 1 : null),
      metric('DD', m ? pct(-m.maxDrawdownPct) : '—', m ? -1 : null),
    ),
    compact ? null : h('div', { class: 'small muted', style: { minHeight: '34px' } },
      STRATEGIES[desk.strategyId]?.label || 'טרם נבחרה משפחת אסטרטגיות',
      m ? ` · ${m.trades} עסקאות · Sharpe ${m.sharpe}` : '',
    ),
    h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '2px' } },
      h('button', { class: 'btn btn-sm', onclick: () => onRun?.(desk) }, 'הרץ מחזור'),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => onOpen?.(desk) }, 'פרטים'),
      desk.technical ? tag(`TA ${desk.technical.biasLabel}`, desk.technical.bias > 0.12 ? 'live' : desk.technical.bias < -0.12 ? 'paused' : '') : null,
      desk.robustness != null ? tag(`חוסן ${desk.robustness}`, desk.robustness >= 50 ? 'green' : 'opt') : null,
      desk.openTrade ? tag(`${desk.openTrade.dir > 0 ? 'לונג' : 'שורט'} פתוח`, 'dry') : null,
      desk.livePnl ? tag(`נייר ${pct(desk.livePnl)}`, desk.livePnl >= 0 ? 'live' : 'paused') : null,
    ),
  );
}

export function metric(label, value, delta = null) {
  return h('div', { class: 'metric' },
    h('span', { text: label }),
    h('b', { class: delta == null ? '' : signClass(delta), text: value }),
  );
}

export function dataSpan(win) {
  if (!win?.from || !win?.to) return '';
  const years = (win.to - win.from) / (365.25 * 24 * 3600 * 1000);
  const yearsTxt = years >= 1 ? `${years.toFixed(1)} שנים` : `${Math.max(1, Math.round(years * 12))} חודשים`;
  return `${win.bars} נרות · ${yearsTxt} אחורה`;
}

export function metricsTable(desk) {
  const rows = [
    ['תשואה', desk.isMetrics ? pct(desk.isMetrics.returnPct) : '—', desk.oosMetrics ? pct(desk.oosMetrics.returnPct) : '—', desk.metrics ? pct(desk.metrics.returnPct) : '—'],
    ['עסקאות', desk.isMetrics?.trades ?? '—', desk.oosMetrics?.trades ?? '—', desk.metrics?.trades ?? '—'],
    ['אחוז הצלחה', desk.isMetrics ? desk.isMetrics.winRate + '%' : '—', desk.oosMetrics ? desk.oosMetrics.winRate + '%' : '—', desk.metrics ? desk.metrics.winRate + '%' : '—'],
    ['Profit Factor', desk.isMetrics?.profitFactor ?? '—', desk.oosMetrics?.profitFactor ?? '—', desk.metrics?.profitFactor ?? '—'],
    ['Max Drawdown', desk.isMetrics ? pct(-desk.isMetrics.maxDrawdownPct) : '—', desk.oosMetrics ? pct(-desk.oosMetrics.maxDrawdownPct) : '—', desk.metrics ? pct(-desk.metrics.maxDrawdownPct) : '—'],
    ['Sharpe', desk.isMetrics?.sharpe ?? '—', desk.oosMetrics?.sharpe ?? '—', desk.metrics?.sharpe ?? '—'],
    ['R ממוצע', desk.isMetrics?.avgR ?? '—', desk.oosMetrics?.avgR ?? '—', desk.metrics?.avgR ?? '—'],
  ];
  return h('div', { class: 'table-wrap' },
    h('table', {},
      h('thead', {}, h('tr', {},
        h('th', { text: 'מדד' }),
        h('th', { class: 'num', text: 'In-Sample 70%' }),
        h('th', { class: 'num', text: 'Out-of-Sample 30%' }),
        h('th', { class: 'num', text: 'מלא' }),
      )),
      h('tbody', {}, rows.map((r) => h('tr', {},
        h('td', { text: r[0] }),
        h('td', { class: 'num', text: String(r[1]) }),
        h('td', { class: 'num', text: String(r[2]) }),
        h('td', { class: 'num', text: String(r[3]) }),
      ))),
    ),
    desk.dataWindow ? h('div', { class: 'tiny muted', style: { marginTop: '6px' } },
      `עומק נתונים: ${dataSpan(desk.dataWindow)}${desk.dataWindow.synthetic ? ' · נתוני הדגמה' : ''}`) : null,
  );
}

/** Ranked cross-market scan: which symbol the desk's strategy works best on. */
export function universeTable(desk) {
  const scan = desk?.universeScan;
  if (!scan || !Array.isArray(scan.rows) || !scan.rows.length) return null;
  const rows = scan.rows.slice(0, 12);
  return h('div', { class: 'card', style: { marginTop: '14px' } },
    h('div', { class: 'card-head' },
      h('div', {},
        h('h2', { text: 'סריקת סל נכסים · איפה האסטרטגיה עובדת הכי טוב' }),
        h('div', { class: 'card-sub', text:
          `${scan.strategyId ? STRATEGY_LABELS[scan.strategyId] || scan.strategyId : ''} · ${scan.ok}/${scan.scanned} נכסים · ${scan.tf} · ${num(scan.years || 0)} שנים אחורה` }),
      ),
      scan.best ? tag(`מוביל: ${scan.best.symbol} ${pct(scan.best.returnPct)}`, 'green') : null,
    ),
    h('div', { class: 'table-wrap' },
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', { text: '#' }),
          h('th', { text: 'נכס' }),
          h('th', { class: 'num', text: 'תשואה' }),
          h('th', { class: 'num', text: 'PF' }),
          h('th', { class: 'num', text: 'DD' }),
          h('th', { class: 'num', text: 'עסקאות' }),
          h('th', { class: 'num', text: 'שנים' }),
        )),
        h('tbody', {}, rows.map((r, i) => r.error
          ? h('tr', {},
            h('td', { class: 'mono', text: String(i + 1) }),
            h('td', { text: r.symbol }),
            h('td', { class: 'num muted', text: r.error, colSpan: '5' }),
          )
          : h('tr', {},
            h('td', { class: 'mono', text: String(i + 1) }),
            h('td', {}, h('b', { text: r.symbol }), i === 0 ? ' ' : '', i === 0 ? tag('מוביל', 'green') : null),
            h('td', { class: 'num mono ' + signClass(r.returnPct), text: pct(r.returnPct) }),
            h('td', { class: 'num mono', text: String(r.profitFactor) }),
            h('td', { class: 'num mono', text: pct(-r.maxDrawdownPct) }),
            h('td', { class: 'num mono', text: String(r.trades) }),
            h('td', { class: 'num mono', text: String(r.years ?? '—') }),
          ))),
      ),
    ),
    h('div', { class: 'tiny muted', style: { marginTop: '6px' } },
      scan.worst ? `החלש בסל: ${scan.worst.symbol} ${pct(scan.worst.returnPct)} — שקול לפסול גרסה שנשענת על נכס אחד בלבד.` : ''),
  );
}

export function gateList(desk, settings) {
  const m = desk.metrics;
  const factor = desk.tf === '1w' ? 0.4 : desk.tf === '1d' ? 0.6 : 1;
  const minTrades = Math.max(4, Math.round(settings.minTrades * factor));
  const checks = [
    ['תשואה חיובית', m ? m.returnPct > 0 : false, m ? pct(m.returnPct) : '—'],
    ['מספיק עסקאות', m ? m.trades >= minTrades : false, m ? `${m.trades}/${minTrades}` : '—'],
    ['Profit Factor', m ? m.profitFactor >= settings.minProfitFactor : false, m ? String(m.profitFactor) : '—'],
    ['Drawdown במגבלה', m ? m.maxDrawdownPct <= settings.maxDrawdown * 100 : false, m ? pct(-m.maxDrawdownPct) : '—'],
    ['OOS חיובי', desk.oosMetrics ? desk.oosMetrics.returnPct > 0 : false, desk.oosMetrics ? pct(desk.oosMetrics.returnPct) : '—'],
    ['חוסן סטטיסטי', (desk.assessment?.robustness ?? desk.robustness ?? 0) >= (settings.minRobustness ?? 50), `${desk.assessment?.robustness ?? desk.robustness ?? '—'} / ${settings.minRobustness ?? 50}`],
    ['יציבות בין חלונות', (desk.assessment?.walkForward?.consistency ?? 0) >= 0.5, `${Math.round((desk.assessment?.walkForward?.consistency ?? 0) * 100)}%`],
  ];
  return h('ul', { class: 'list-clean' }, checks.map(([label, ok, val]) =>
    h('li', {},
      h('span', { class: 'bul ' + (ok ? 'green' : 'red'), text: ok ? '✔' : '✕' }),
      h('span', { class: 'grow', text: label }),
      h('span', { class: 'mono small ' + (ok ? 'green' : 'red'), text: String(val) }),
    )),
  );
}

export function feedList(events, limit = 14) {
  if (!events?.length) return h('div', { class: 'empty', text: 'אין אירועים עדיין — הרץ מחזור ראשון' });
  return h('div', { class: 'feed' }, events.slice(0, limit).map((e) =>
    h('div', { class: 'feed-item ' + (e.level === 'ok' ? 'ok' : e.level === 'bad' ? 'bad' : e.level === 'warn' ? 'warn' : '') },
      h('span', { class: 'dot' }),
      h('div', { class: 'grow' },
        h('div', { text: e.text }),
        h('div', { class: 'who', text: `${e.actor} · ${timeAgo(e.at)}` }),
      ),
    )),
  );
}

export function agentCard(agent) {
  const busy = agent.status === 'busy';
  return h('div', { class: 'agent' + (busy ? ' busy agent-active' : '') },
    h('div', { class: 'av', text: agent.icon || '☻' }),
    agentBubble(agent),
    h('div', { class: 'grow' },
      h('div', { class: 'who' }, h('b', { text: agent.name }), h('span', { text: agent.role })),
      h('div', { class: 'task' + (busy ? ' on' : ''), text: busy ? agent.task : agent.focus }),
      busy ? progressBar(agent.progress) : null,
      h('div', { class: 'tiny muted', style: { marginTop: '4px' }, text: `${agent.completed || 0} משימות שהושלמו` }),
    ),
  );
}

export function deskOptions(desks) {
  return desks.map((d) => h('option', { value: d.id }, `${d.label} · ${d.symbol}`));
}

export function platformLabel(key) {
  return PLATFORMS[key]?.label || key;
}

export function strategyName(id) {
  return STRATEGY_LABELS[id] || STRATEGIES[id]?.label || id || '—';
}
