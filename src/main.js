// Bootstrap: routing, nav, top bar, autopilot clock.

import { store } from './store.js';
import { NAV } from './config.js';
import { ensureDeskFields, startMarketFeed, tick, catchUp, rehydratePaperPortfolio } from './firm.js';
import { marketState, onQuotes, quotes } from './market.js';
import { openingMessage } from './advisor.js';
import { syncFromCloud } from './remote.js';
import { dbState, pushStateToDatabase, checkBaseServerHealth } from './db.js';
import { mountPageChat } from './page_chat.js';
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
import { renderPortfolio } from './views/portfolio.js';
import { renderCharts } from './views/charts.js';
import { renderGann } from './views/gann.js';
import { renderFundamentals } from './views/fundamentals.js';
import { renderNostro } from './views/nostro.js';
import { renderAcademy } from './views/academy.js';

const VIEWS = {
  overview: renderOverview,
  desks: renderDesks,
  agents: renderAgents,
  lab: renderLab,
  bots: renderBots,
  research: renderResearch,
  sentiment: renderSentiment,
  advisor: renderAdvisor,
  academy: renderAcademy,
  gann: renderGann,
  fundamentals: renderFundamentals,
  nostro: renderNostro,
  settings: renderSettings,
  docs: renderDocs,
  portfolio: renderPortfolio,
  charts: renderCharts,
};

const STATIC_ROUTES = new Set([
  'gann', 'academy', 'settings', 'docs', 'charts', 'fundamentals', 'nostro', 'advisor',
]);
const BG_RENDER_MIN_MS = 4000;
const BG_RENDER_AGENTS_MS = 10000;
const SCROLL_SETTLE_MS = 1400;

let isPointerDown = false;
let lastScrollAt = 0;
let lastRenderAt = 0;
let bgRenderTimer = null;

const ui = {
  route: 'overview',
  selectedDesk: null,
  go(route) {
    if (!VIEWS[route]) route = 'overview';
    if (location.hash === '#/' + route) render({ force: true, resetScroll: false });
    else location.hash = '#/' + route;
  },
  setDesk(id) {
    ui.selectedDesk = id;
    render({ force: true });
  },
  rerender() {
    render({ force: true });
  },
};

let renderQueued = false;
let pendingBgRender = false;

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
    if (dbState.baseServerConnected && (dbState.supabaseConnected || dbState.cloudApiConnected)) {
      ap.textContent = 'שרת בסיס + ענן 24/7';
    } else if (dbState.baseServerConnected) {
      ap.textContent = 'שרת בסיס · פעיל';
    } else if (dbState.supabaseConnected || cloud) {
      ap.textContent = 'ענן 24/7 · מסונכרן';
    } else {
      ap.textContent = s.autopilot ? 'אוטופיילוט מקומי' : 'אוטופיילוט מושהה';
    }
    ap.className = 'pill ' + (dbState.connected || cloud || s.autopilot ? '' : 'pill-off');
    const syncInfo = dbState.lastSyncAt ? `סנכרון אחרון ${timeAgo(dbState.lastSyncAt)} (${dbState.provider})` : '';
    ap.title = syncInfo || (cloud ? `עדכון אחרון ${timeAgo(Date.parse(cloud.updatedAt))}` : 'מצב סנכרון');
  }
  const tickPill = document.getElementById('pill-tick');
  if (tickPill) {
    tickPill.textContent = state.lastTickAt
      ? `${dbState.connected || cloud ? 'מסונכרן' : 'מחזור'} ${timeAgo(state.lastTickAt)}`
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
    h('div', { class: 'small muted', style: { marginTop: '8px' }, text: 'פתח את קונסולת הדפדפן (F12) כדי לראות את ה-stack. שאר המסכים ממשיכים לעבוד.' }),
    h('button', { class: 'btn btn-sm', style: { marginTop: '10px' }, onclick: () => ui.go('overview') }, 'חזור לסקירה'),
  );
}

function isUserBusy(view) {
  if (isPointerDown) return true;
  if (Date.now() - lastScrollAt < SCROLL_SETTLE_MS) return true;
  const modalRoot = document.getElementById('modal-root');
  if (modalRoot && modalRoot.childElementCount > 0) return true;
  const sel = window.getSelection?.();
  if (sel && sel.toString().trim().length > 0) return true;
  const active = document.activeElement;
  if (active && view && view.contains(active) && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable)) {
    return true;
  }
  return false;
}

function captureViewUiState(view) {
  const mainEl = view?.closest('main') || document.querySelector('main');
  const scrollables = [...(view?.querySelectorAll('.table-wrap, .chat, .edu-chat-scroll, .card-body') || [])]
    .map((el) => ({ top: el.scrollTop, left: el.scrollLeft }));
  const detailsOpen = [...(view?.querySelectorAll('details') || [])].map((el) => !!el.open);
  return {
    winX: window.scrollX || 0,
    winY: window.scrollY || 0,
    mainTop: mainEl ? mainEl.scrollTop : 0,
    viewTop: view ? view.scrollTop : 0,
    scrollables,
    detailsOpen,
  };
}

function restoreViewUiState(view, snap) {
  if (!snap || !view) return;
  const details = view.querySelectorAll('details');
  snap.detailsOpen.forEach((open, i) => {
    if (details[i]) details[i].open = open;
  });
  const scrollables = view.querySelectorAll('.table-wrap, .chat, .edu-chat-scroll, .card-body');
  snap.scrollables.forEach((pos, i) => {
    if (scrollables[i]) {
      scrollables[i].scrollTop = pos.top;
      scrollables[i].scrollLeft = pos.left;
    }
  });
  const mainEl = view.closest('main') || document.querySelector('main');
  if (mainEl && snap.mainTop) mainEl.scrollTop = snap.mainTop;
  if (snap.viewTop) view.scrollTop = snap.viewTop;
  if (snap.winY || snap.winX) {
    window.scrollTo({ top: snap.winY, left: snap.winX, behavior: 'instant' });
  }
}

function render({ force = false, resetScroll = false } = {}) {
  const view = document.getElementById('view');
  if (!view) return;
  const nextRoute = routeFromHash();
  const routeChanged = nextRoute !== ui.route;

  if (!force && !routeChanged && isUserBusy(view)) {
    pendingBgRender = true;
    return;
  }
  // Even on forced rerender of same route, never yank focus from an active input inside #view unless route changed
  const active = document.activeElement;
  if (!routeChanged && !force && active && view.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
    pendingBgRender = true;
    return;
  }

  pendingBgRender = false;
  const prevSnap = (!routeChanged && !resetScroll) ? captureViewUiState(view) : null;
  ui.route = nextRoute;
  updateNav();

  // Build offscreen fragment so the DOM swaps atomically without height-collapse jitter
  const frag = document.createDocumentFragment();
  const fn = VIEWS[ui.route] || renderOverview;
  try {
    fn(frag, ui);
  } catch (err) {
    console.error('[render]', err);
    frag.appendChild(errorBox(err));
  }
  view.replaceChildren(frag);
  lastRenderAt = Date.now();

  if (prevSnap) {
    restoreViewUiState(view, prevSnap);
  } else if (routeChanged || resetScroll) {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }

  updateTopbar();
  const label = NAV.find((n) => n.id === ui.route)?.label || '';
  document.title = `Alta Capital · ${label}`;
}

function scheduleBackgroundRender() {
  updateTopbar();
  const route = routeFromHash();
  // Never wipe interactive/reading tabs on background autopilot or sync ticks
  if (STATIC_ROUTES.has(route)) return;

  const minGap = route === 'agents' ? BG_RENDER_AGENTS_MS : BG_RENDER_MIN_MS;
  const elapsed = Date.now() - lastRenderAt;
  const run = () => {
    bgRenderTimer = null;
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render({ force: false });
    });
  };

  if (elapsed >= minGap) {
    if (!bgRenderTimer) bgRenderTimer = setTimeout(run, 180);
  } else if (!bgRenderTimer) {
    bgRenderTimer = setTimeout(run, Math.max(200, minGap - elapsed));
  }
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
  render({ force: true });
  mountPageChat(ui);
  startMarketFeed();
  onQuotes(updateTopbar);
  store.subscribe(scheduleBackgroundRender);
  window.addEventListener('hashchange', () => render({ force: true, resetScroll: true }));

  // Track user interactions so background ticks never interrupt scrolling, clicking, or typing
  window.addEventListener('pointerdown', () => { isPointerDown = true; }, { passive: true });
  const releasePointer = () => {
    isPointerDown = false;
    if (pendingBgRender) {
      setTimeout(() => { if (pendingBgRender && !isUserBusy(document.getElementById('view'))) render({ force: false }); }, 350);
    }
  };
  window.addEventListener('pointerup', releasePointer, { passive: true });
  window.addEventListener('pointercancel', releasePointer, { passive: true });
  window.addEventListener('scroll', () => { lastScrollAt = Date.now(); }, { passive: true, capture: true });

  document.addEventListener('focusout', () => {
    setTimeout(() => {
      if (pendingBgRender && !isUserBusy(document.getElementById('view'))) render({ force: false });
    }, 120);
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

  let cloudReady = false;

  setInterval(() => {
    updateTopbar();
    if (!cloudReady) return;
    const s = store.state.settings;
    if (!s.autopilot) return;
    const cloudMode = !!(store.state.remote?.updatedAt && s.cloudSync);
    const gap = Date.now() - (store.state.lastTickAt || 0);
    const interval = Math.max(3, Number(s.tickSeconds || 4)) * 1000;
    if (gap >= interval) {
      tick({ reason: cloudMode ? 'local-nudge' : 'auto' }).catch((err) => console.warn('[autopilot]', err));
    }
  }, 1000);

  // Periodic cross-device sync every 20s so phone/PC/Base Server stay aligned
  setInterval(() => {
    if (cloudReady) syncFromCloud().catch(() => {});
  }, 20000);

  // Flush local changes immediately when leaving/switching tabs or closing on mobile
  const flushOnExit = () => {
    store.save(true);
    if (cloudReady) {
      pushStateToDatabase(store.state, { keepalive: true }).catch(() => {});
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      startMarketFeed();
      syncFromCloud().catch(() => {});
    } else if (document.visibilityState === 'hidden') {
      flushOnExit();
    }
  });
  window.addEventListener('pagehide', flushOnExit);

  // Check if served by or connected to a local Base Server
  checkBaseServerHealth(store.state.settings?.db?.baseServerUrl || '').then(() => updateTopbar()).catch(() => {});

  syncFromCloud()
    .then((res) => {
      rehydratePaperPortfolio();
      if (res?.ok) {
        toast(`נטען מצב התיק וההיסטוריה (${res.source || 'ענן'})`, 'ok');
      }
    })
    .catch((err) => console.warn('[cloud]', err))
    .finally(() => {
      rehydratePaperPortfolio();
      cloudReady = true;
      render({ force: true });
      if (store.state.settings.autopilot) {
        tick({ reason: 'boot' }).catch(() => {});
        const cloudMode = !!(store.state.remote?.updatedAt && store.state.settings.cloudSync);
        if (!cloudMode) catchUp().catch((err) => console.warn('[catchup]', err));
      }
    });
}

boot();
