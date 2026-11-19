// Dedicated Fundamental Analysis Module (#/fundamentals)
// Analyzes US Stocks (SEC EDGAR XBRL) & Crypto (CoinGecko) + Macro (^VIX, ^TNX, DXY)
// using Graham, Buffett, Lynch & Dalio methodologies with visual SVG infographics & live news.

import { store } from '../store.js';
import { h, mount, num, pct, tag, notice, empty, timeAgo } from '../ui.js';
import {
  FUNDAMENTAL_ASSETS,
  refreshFundamentals,
  analyzeFundamentalMethodologies,
  fetchAssetNews,
  formatCompactUsd,
} from '../fundamentals.js';

let fundViewState = {
  symbol: 'NVDA',
  loading: false,
  newsLoading: false,
  newsBySymbol: {},
};

function svgEl(tagName, attrs, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tagName);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
  if (text != null) node.textContent = text;
  return node;
}

// Visual SVG Infographic: 4 Methodologies Gauge + Financial / Macro Diagram
function renderMethodologySvg(methods, item, macro) {
  const width = 920;
  const height = 240;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.style.width = '100%';
  svg.style.height = 'auto';
  svg.style.display = 'block';
  svg.style.background = 'linear-gradient(180deg, #0b1220, #070c14)';
  svg.style.borderRadius = '12px';

  // Left: 4 Methodology Score Gauges
  svg.appendChild(svgEl('text', { x: 24, y: 24, fill: '#e2e8f0', 'font-size': '13', 'font-weight': '700' }, 'ציון לפי 4 מתודולוגיות העל (0–100)'));
  methods.forEach((m, i) => {
    const y = 46 + i * 44;
    const barW = 240;
    const fillW = Math.round((m.score / 100) * barW);
    const col = m.score >= 68 ? '#2ecc71' : m.score >= 48 ? '#3b82f6' : '#f05b5b';
    svg.appendChild(svgEl('text', { x: 24, y: y + 14, fill: '#cbd5e1', 'font-size': '11' }, m.name));
    svg.appendChild(svgEl('rect', { x: 210, y, width: barW, height: 18, rx: 5, fill: '#111c2e' }));
    svg.appendChild(svgEl('rect', { x: 210, y, width: fillW, height: 18, rx: 5, fill: col }));
    svg.appendChild(svgEl('text', { x: 460, y: y + 14, fill: col, 'font-size': '11.5', 'font-weight': '700' }, `${m.score}/100`));
  });

  // Right: Balance Sheet / Macro Visual Diagram
  const rx = 540;
  svg.appendChild(svgEl('text', { x: rx, y: 24, fill: '#e2e8f0', 'font-size': '13', 'font-weight': '700' },
    item?.kind === 'stock' ? 'מבנה מאזן ורווחיות (SEC EDGAR)' : 'מדדי מאקרו ונזילות (Macro Regime)'));

  if (item?.kind === 'stock') {
    const bars = [
      { label: 'הכנסות', val: item.revenue || 0, col: '#3b82f6' },
      { label: 'רווח נקי', val: Math.max(0, item.netIncome || 0), col: '#2ecc71' },
      { label: 'מזומן', val: item.cash || 0, col: '#a78bfa' },
    ];
    const maxV = Math.max(1, ...bars.map((b) => b.val));
    bars.forEach((b, i) => {
      const bx = rx + i * 115;
      const bh = Math.max(8, Math.round((b.val / maxV) * 125));
      const by = 185 - bh;
      svg.appendChild(svgEl('rect', { x: bx, y: by, width: 68, height: bh, rx: 6, fill: b.col }));
      svg.appendChild(svgEl('text', { x: bx + 34, y: by - 6, fill: '#e2e8f0', 'font-size': '10', 'text-anchor': 'middle' }, formatCompactUsd(b.val)));
      svg.appendChild(svgEl('text', { x: bx + 34, y: 206, fill: '#94a3b8', 'font-size': '10.5', 'text-anchor': 'middle' }, b.label));
    });
  } else {
    const vix = macro?.vix ?? 18;
    const tnx = macro?.us10yYield ?? 4.2;
    const items = [
      { label: 'VIX (פחד)', val: `${vix}`, pct: Math.min(100, (vix / 40) * 100), col: vix > 25 ? '#f05b5b' : '#2ecc71' },
      { label: 'תשואת 10Y', val: `${tnx}%`, pct: Math.min(100, (tnx / 6) * 100), col: tnx > 4.7 ? '#f2cc60' : '#3b82f6' },
      { label: 'ציון כולל', val: `${item?.score ?? 50}`, pct: item?.score ?? 50, col: '#a78bfa' },
    ];
    items.forEach((it, i) => {
      const y = 55 + i * 52;
      svg.appendChild(svgEl('text', { x: rx, y: y + 13, fill: '#cbd5e1', 'font-size': '11' }, it.label));
      svg.appendChild(svgEl('rect', { x: rx + 95, y, width: 190, height: 18, rx: 5, fill: '#111c2e' }));
      svg.appendChild(svgEl('rect', { x: rx + 95, y, width: Math.round((it.pct / 100) * 190), height: 18, rx: 5, fill: it.col }));
      svg.appendChild(svgEl('text', { x: rx + 295, y: y + 13, fill: '#e2e8f0', 'font-size': '11', 'font-weight': '700' }, it.val));
    });
  }

  return svg;
}

async function loadNews(symbol, ui) {
  if (fundViewState.newsLoading) return;
  fundViewState.newsLoading = true;
  ui.rerender();
  try {
    const items = await fetchAssetNews(symbol);
    fundViewState.newsBySymbol[symbol] = items;
  } finally {
    fundViewState.newsLoading = false;
    ui.rerender();
  }
}

export function renderFundamentals(root, ui) {
  const fState = store.state.fundamentals || { updatedAt: null, macro: null, assets: {} };
  const item = fState.assets?.[fundViewState.symbol] || null;
  const macro = fState.macro || null;

  if (!fState.updatedAt && !fundViewState.loading) {
    fundViewState.loading = true;
    refreshFundamentals({ force: false }).finally(() => {
      fundViewState.loading = false;
      ui.rerender();
    });
  }
  if (!fundViewState.newsBySymbol[fundViewState.symbol] && !fundViewState.newsLoading) {
    setTimeout(() => loadNews(fundViewState.symbol, ui), 50);
  }

  const methods = analyzeFundamentalMethodologies(item, macro);
  const news = fundViewState.newsBySymbol[fundViewState.symbol] || [];

  mount(root,
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow', text: 'SEC EDGAR XBRL · CoinGecko · Macro Regime · Live News' }),
        h('h1', { text: 'מודול ניתוח פונדמנטליסטי וחדשות (Fundamental Lab)' }),
        h('p', { text: 'ניתוח איכות ושווי הוגן לפי 4 מתודולוגיות העל (גרהאם, באפט, לינץ׳ ודליו) על נתוני דוחות אמיתיים, אינפוגרפיקות ויזואליות וזרם חדשות עם הסבר השפעה.' }),
      ),
      h('div', { class: 'head-actions' },
        h('select', {
          class: 'input',
          value: fundViewState.symbol,
          onchange: (e) => {
            fundViewState.symbol = e.target.value;
            loadNews(fundViewState.symbol, ui);
            ui.rerender();
          },
        }, FUNDAMENTAL_ASSETS.map((s) => h('option', { value: s, selected: fundViewState.symbol === s }, s))),
        h('button', {
          class: 'btn btn-sm btn-primary',
          disabled: fundViewState.loading,
          onclick: async () => {
            fundViewState.loading = true;
            ui.rerender();
            await refreshFundamentals({ force: true });
            await loadNews(fundViewState.symbol, ui);
            fundViewState.loading = false;
            ui.rerender();
          },
        }, fundViewState.loading ? '⏳ מרענן דוחות…' : '⟳ רענן דוחות וחדשות'),
      ),
    ),
  );

  if (macro?.ok) {
    const fx = macro.forex ? ` · מט"ח חי (ECB): EUR/USD ${macro.forex.eurusd ?? '—'} · USD/ILS ${macro.forex.usdils ?? '—'}` : '';
    mount(root, notice(
      `משטר מאקרו נוכחי: ${macro.regime} · מדד הפחד VIX: ${macro.vix ?? '—'} · תשואת אג"ח ארה"ב ל-10 שנים: ${macro.us10yYield ?? '—'}% · דולר DXY: ${macro.dxy ?? '—'}${fx}`,
      'blue',
    ));
  }

  // KPI Summary
  mount(root, h('div', { class: 'grid cols-4', style: { marginTop: '14px' } },
    h('div', { class: 'metric' }, h('span', { text: 'ציון פונדמנטלי כולל' }), h('b', { class: (item?.score >= 60 ? 'green ' : 'gold ') + 'mono', text: item ? `${item.score}/100 (${item.bias})` : 'טוען…' })),
    h('div', { class: 'metric' }, h('span', { text: item?.kind === 'stock' ? 'מכפיל רווח (P/E) · שולי רווח' : 'שווי שוק · שינוי 30 יום' }),
      h('b', { class: 'mono', text: item ? (item.kind === 'stock' ? `P/E ${item.pe ?? '—'} · ${item.netMarginPct ?? '—'}%` : `${formatCompactUsd(item.marketCap)} · ${pct(item.change30dPct || 0)}`) : '—' })),
    h('div', { class: 'metric' }, h('span', { text: item?.kind === 'stock' ? 'הכנסות · מזומן (SEC)' : 'מרחק משיא (ATH)' }),
      h('b', { class: 'mono', text: item ? (item.kind === 'stock' ? `${formatCompactUsd(item.revenue)} · ${formatCompactUsd(item.cash)}` : `${item.athDrawdownPct ?? '—'}%`) : '—' })),
    h('div', { class: 'metric' }, h('span', { text: 'מקור נתונים ועדכון' }), h('b', { class: 'small', text: item ? `${item.source} · ${timeAgo(fState.updatedAt)}` : 'SEC / CoinGecko' })),
  ));

  // Visual SVG Infographic
  mount(root,
    h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'card-head' },
        h('div', {},
          h('h2', { text: `📊 אינפוגרפיקה פונדמנטלית: ${item?.entityName || fundViewState.symbol}` }),
          h('div', { class: 'card-sub', text: 'השוואה ויזואלית בין 4 אסכולות ההשקעה + מבנה מאזן/מאקרו' }),
        ),
        tag(item?.bias || 'מחשב…', item?.score >= 62 ? 'live' : 'opt'),
      ),
      renderMethodologySvg(methods, item, macro),
    ),
  );

  // 4 Methodology Cards with Educational Explanations
  mount(root,
    h('div', { class: 'grid cols-2', style: { marginTop: '14px', gap: '12px' } },
      ...methods.map((m) => h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('h3', { text: m.name }),
          tag(`${m.score}/100`, m.score >= 68 ? 'live' : m.score >= 48 ? 'opt' : 'red'),
        ),
        h('p', { class: 'small muted', text: m.text }),
      )),
    ),
  );

  // Live Financial News with Fundamental Impact Explanations
  mount(root,
    h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'card-head' },
        h('div', {},
          h('h2', { text: `📰 חדשות בזמן אמת והסבר השפעה פונדמנטלית (${fundViewState.symbol})` }),
          h('div', { class: 'card-sub', text: 'כותרות חיות מ-Yahoo Finance, CNBC, MarketWatch והפדרל ריזרב (Fed) עם פירוש המשמעות לשווי החברה' }),
        ),
      ),
      fundViewState.newsLoading
        ? h('div', { class: 'small muted', text: '⏳ טוען חדשות חיות…' })
        : news.length
          ? h('div', { class: 'table-wrap' },
            h('table', {},
              h('thead', {}, h('tr', {}, h('th', { text: 'מקור' }), h('th', { text: 'כותרת החדשה' }), h('th', { text: 'הסבר השפעה פונדמנטלית' }))),
              h('tbody', {}, news.map((n) => h('tr', {},
                h('td', {}, tag(n.source || 'News', 'opt')),
                h('td', { class: 'small' },
                  n.link
                    ? h('a', { href: n.link, target: '_blank', rel: 'noopener noreferrer', style: { color: '#93c5fd', fontWeight: '600' } }, n.title)
                    : h('span', { text: n.title }),
                  h('div', { class: 'tiny muted', text: n.pubDate || '' }),
                ),
                h('td', { class: 'small muted', text: n.impactNote }),
              ))),
            ),
          )
          : empty('לא נמצאו חדשות זמינות כרגע לנכס זה — לחץ על "רענן דוחות וחדשות".'),
    ),
  );
}
