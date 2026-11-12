// Bootstrap: routing, nav, top bar, autopilot clock.

import { store } from './store.js';
import { NAV } from './config.js';
import { ensureDeskFields, startMarketFeed, tick, catchUp } from './firm.js';
import { marketState, onQuotes, quotes } from './market.js';
import { openingMessage } from './advisor.js';
import { syncFromCloud } from './remote.js';
import { h, timeAgo, num, toast } from './ui.js';

import { renderOverview } from './views/overview.js';
import { renderDesks } from './views/desks.js';
import { renderAgents } from './views/agents.js';
import { renderLab } from './views/lab.js';
import { renderBots } from './views/bots.js';
import { renderResearch } from './views/research.js';
import { renderSentiment } from './views/sentiment.js';
import { renderAdvisor } from './views/advisor.js';
import { renderSettings } from './views/settings.js';
import { renderDocs } from './views/docs.js';

const VIEWS = {
  overview: renderOverview,
  desks: renderDesks,
  agents: renderAgents,
  lab: renderLab,
  bots: renderBots,
  research: renderResearch,
  sentiment: renderSentiment,
  advisor: renderAdvisor,
  settings: renderSettings,
  docs: renderDocs,
};

const ui = {
  route: 'overview',
  selectedDesk: null,
  go(route) {
    if (!VIEWS[route]) route = 'overview';
    if (location.hash === '#/' + route) render();
    else location.hash = '#/' + route;
  },
  setDesk(id) {
    ui.selectedDesk = id;
    render();
  },
  rerender() {
    render();
  },
};

let renderQueued = false;
let pendingRender = false;

function routeFromHash() {
  const route = location.hash.replace(/^#\/?/, '');
  return VIEWS[route] ? route : 'overview';
}

function buildNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = '';
  for (const item of NAV) {
    if (item.id === 'settings') nav.appendChild(h('div', { class: 'nav-sep' }));
    nav.appendChild(h('button', {
      class: 'nav-item',
      dataset: { route: item.id },
      onclick: () => ui.go(item.id),
    }, h('span', { class: 'ic', text: item.icon }), item.label));
  }
}

function updateNav() {
  for (const btn of document.querySelectorAll('.nav-item')) {
    btn.classList.toggle('active', btn.dataset.route === ui.route);
  }
}

function updateTopbar() {
  const state = store.state;
  const s = state.settings;
  const dataPill = document.getElementById('pill-data');
  if (dataPill) {
    const price = quotes.BTCUSDT?.price;
    const source = marketState.synthetic ? 'נתוני הדגמה' : (marketState.provider || '—');
    dataPill.textContent = price ? `${source} · BTC ${num(price, 0)}$` : source;
    dataPill.className = 'pill ' + (marketState.synthetic ? 'pill-sim' : '');
    dataPill.title = marketState.error ? String(marketState.error).slice(0, 240) : 'מקור נתוני השוק';
  }
  const cloud = state.remote?.updatedAt && s.cloudSync ? state.remote : null;
  const ap = document.getElementById('pill-autopilot');
  if (ap) {
    ap.textContent = cloud
      ? 'ענן 24/7 · פעיל'
      : s.autopilot ? 'אוטופיילוט פעיל' : 'אוטופיילוט מושהה';
    ap.className = 'pill ' + (cloud || s.autopilot ? '' : 'pill-off');
    ap.title = cloud ? `הסוכנים רצים ב-GitHub Actions · עדכון אחרון ${timeAgo(Date.parse(cloud.updatedAt))}` : '';
  }
  const tickPill = document.getElementById('pill-tick');
  if (tickPill) {
    tickPill.textContent = state.lastTickAt
      ? `${cloud ? 'ענן' : 'מחזור'} ${timeAgo(state.lastTickAt)}`
      : 'טרם רץ מחזור';
  }
  const cycles = document.getElementById('foot-cycles');
  if (cycles) cycles.textContent = num(state.stats.cycles || 0);
  const backtests = document.getElementById('foot-backtests');
  if (backtests) backtests.textContent = num(state.stats.backtests || 0);
}

function errorBox(err) {
  return h('div', { class: 'card', style: { borderColor: 'rgba(240,91,91,.4)' } },
    h('h2', { text: 'שגיאה ברינדור המסך' }),
    h('div', { class: 'small muted', text: String(err?.message || err) }),
    h('div', { class: 'small muted', style: { marginTop: '8px' }, text: 'פתח את קונסולת הדפדפן (Cmd+Option+J) כדי לראות את ה-stack. שאר המסכים ממשיכים לעבוד.' }),
    h('button', { class: 'btn btn-sm', style: { marginTop: '10px' }, onclick: () => ui.go('overview') }, 'חזור לסקירה'),
  );
}

function render() {
  const view = document.getElementById('view');
  if (!view) return;
  const active = document.activeElement;
  if (active && view.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
    pendingRender = true;
    return;
  }
  pendingRender = false;
  ui.route = routeFromHash();
  updateNav();
  view.innerHTML = '';
  const fn = VIEWS[ui.route] || renderOverview;
  try {
    fn(view, ui);
  } catch (err) {
    console.error('[render]', err);
    view.appendChild(errorBox(err));
  }
  updateTopbar();
  const label = NAV.find((n) => n.id === ui.route)?.label || '';
  document.title = `Alta Capital · ${label}`;
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function boot() {
  store.load();
  ensureDeskFields();
  ui.selectedDesk = store.state.desks[0]?.id || null;
  if (!store.state.advisor.messages.length) {
    store.state.advisor.messages.push(openingMessage());
    store.save();
  }
  if (!location.hash) history.replaceState(null, '', '#/overview');

  buildNav();
  render();
  startMarketFeed();
  onQuotes(updateTopbar);
  store.subscribe(scheduleRender);
  window.addEventListener('hashchange', render);

  document.addEventListener('focusout', () => {
    setTimeout(() => { if (pendingRender) render(); }, 0);
  });

  document.getElementById('btn-quick-tick')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await tick({ reason: 'manual' });
    } catch (err) {
      console.error(err);
    } finally {
      btn.disabled = false;
    }
  });

  setInterval(() => {
    updateTopbar();
    const s = store.state.settings;
    if (!s.autopilot) return;
    // When the cloud runner is publishing state, the local tab stays a read-only dashboard.
    if (store.state.remote?.updatedAt && s.cloudSync) return;
    const gap = Date.now() - (store.state.lastTickAt || 0);
    if (gap >= Math.max(3, s.tickSeconds) * 1000) {
      tick().catch((err) => console.warn('[autopilot]', err));
    }
  }, 1000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      startMarketFeed();
      const cloudMode = !!(store.state.remote?.updatedAt && store.state.settings.cloudSync);
      if (cloudMode) syncFromCloud().catch(() => {});
      else if (store.state.settings.autopilot) catchUp().catch(() => {});
    }
  });

  syncFromCloud()
    .then((res) => {
      if (res?.ok) toast('נטען מצב ההרצה מהענן (GitHub Actions)', 'ok');
    })
    .catch((err) => console.warn('[cloud]', err));

  setTimeout(() => {
    const cloudMode = !!(store.state.remote?.updatedAt && store.state.settings.cloudSync);
    if (store.state.settings.autopilot && !cloudMode) catchUp().catch((err) => console.warn('[catchup]', err));
  }, 1300);
}

boot();
