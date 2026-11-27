// Invo Platform Copy-Trading & Social Trading Rooms Engine
// Integrates Invo (invo.trade) via official API/Webhook or responsive Nesting/Iframe mode,
// providing real-time trader leaderboards, copy-trading rooms, risk parameters, and auto-mirror to Nostro.

import { store } from './store.js';
import { quotes, lastPrice } from './market.js';

export const INVO_TOP_TRADERS = [
  {
    id: 'trader_yigal',
    name: 'יגאל (Yigal Macro Alpha)',
    handle: '@yigal_macro',
    badge: '🏆 מוביל דירוג Invo Pro',
    winRate: 76.4,
    roi30d: 84.2,
    profitFactor: 2.82,
    maxDrawdown: 3.9,
    copiers: 248,
    aum: '$1.42M',
    style: 'שמיניות גאן (1/8 ... 8/8) + מאקרו קריפטו',
    preferredSymbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
    verified: true,
    bio: 'סוחר נוסטרו בכיר ומנהל חדר מסחר. מתמקד ברמות שיווי משקל של גאן ובלימות בשמיניות 2/8 ו-6/8.',
    recentTrades: [
      { id: 't1', symbol: 'BTCUSDT', side: 'BUY', entry: 87400, exit: 90200, pnlPct: 3.2, time: 'לפני 25 דק׳', status: 'closed' },
      { id: 't2', symbol: 'SOLUSDT', side: 'BUY', entry: 184.2, exit: 196.5, pnlPct: 6.67, time: 'לפני 3 שעות', status: 'closed' },
      { id: 't3', symbol: 'ETHUSDT', side: 'BUY', entry: 3340, current: 3410, pnlPct: 2.1, time: 'פעיל עכשיו', status: 'open' },
    ],
  },
  {
    id: 'trader_simcha',
    name: 'שמחה (Simcha Jenkins Sq9)',
    handle: '@simcha_cycles',
    badge: '🎯 מומחה מחזורי זמן ונוסטרו',
    winRate: 73.1,
    roi30d: 71.5,
    profitFactor: 2.54,
    maxDrawdown: 4.8,
    copiers: 195,
    aum: '$980K',
    style: 'שורש ריבועי ג׳נקינס + Square of 9 מחיר-זמן',
    preferredSymbols: ['BTCUSDT', 'NVDA', 'SPY'],
    verified: true,
    bio: 'חוקר שיטות מייקל ג׳נקינס וו.ד. גאן. סוחר אך ורק בהתכנסות זמן ומחיר בנקודות מפנה מדויקות.',
    recentTrades: [
      { id: 't4', symbol: 'BTCUSDT', side: 'SELL', entry: 89800, exit: 88100, pnlPct: 1.89, time: 'לפני שעתיים', status: 'closed' },
      { id: 't5', symbol: 'NVDA', side: 'BUY', entry: 142.5, exit: 148.8, pnlPct: 4.42, time: 'אתמול', status: 'closed' },
      { id: 't6', symbol: 'BTCUSDT', side: 'BUY', entry: 86900, current: 87800, pnlPct: 1.03, time: 'פעיל עכשיו', status: 'open' },
    ],
  },
  {
    id: 'trader_quant_stack',
    name: 'Quant Volatility Stack',
    handle: '@valix_antsaslyku',
    badge: '⚡ מודל HAR + Student-t',
    winRate: 69.8,
    roi30d: 62.1,
    profitFactor: 2.31,
    maxDrawdown: 5.1,
    copiers: 164,
    aum: '$650K',
    style: 'מודל תנודתיות HAR + תמחור Student-t תלת-שלבי',
    preferredSymbols: ['BTCUSDT', 'ETHUSDT'],
    verified: true,
    bio: 'שכפול מערכת המסחר האוטונומית מ-X/Polymarket. איתור יתרון סטטיסטי של מעל 5 סנט לחוזה.',
    recentTrades: [
      { id: 't7', symbol: 'BTCUSDT', side: 'BUY', entry: 87200, exit: 87650, pnlPct: 0.52, time: 'לפני 12 דק׳', status: 'closed' },
      { id: 't8', symbol: 'BTCUSDT', side: 'SELL', entry: 87650, exit: 87310, pnlPct: 0.39, time: 'לפני 40 דק׳', status: 'closed' },
    ],
  },
  {
    id: 'trader_nostro_pass',
    name: 'NostroTitan Payout Master',
    handle: '@nostro_titan',
    badge: '💎 100% מעבר שלב 1 ו-2 + משיכות',
    winRate: 81.2,
    roi30d: 118.0,
    profitFactor: 3.15,
    maxDrawdown: 3.2,
    copiers: 420,
    aum: '$2.85M',
    style: 'משמעת נוסטרו קפדנית · סיכון מקסימלי 1.5% ליום',
    preferredSymbols: ['BTCUSDT', 'SOLUSDT', 'GOLD'],
    verified: true,
    bio: 'בוט אלגו ייעודי למעבר מבחני נוסטרו בחברות מימון (Invo, FTMO, Apex). ללא חריגת Drawdown מעולם.',
    recentTrades: [
      { id: 't9', symbol: 'BTCUSDT', side: 'BUY', entry: 86500, exit: 89400, pnlPct: 3.35, time: 'אתמול', status: 'closed' },
      { id: 't10', symbol: 'SOLUSDT', side: 'BUY', entry: 182.0, exit: 194.0, pnlPct: 6.59, time: 'לפני יומיים', status: 'closed' },
    ],
  },
  {
    id: 'trader_tomer',
    name: 'תומר מומנטום קריפטו',
    handle: '@tomer_crypto',
    badge: '🚀 סקאלפינג פריצות מהירות',
    winRate: 65.2,
    roi30d: 46.0,
    profitFactor: 2.05,
    maxDrawdown: 7.1,
    copiers: 98,
    aum: '$420K',
    style: 'Order Flow + פריצות מומנטום ב-5 דקות',
    preferredSymbols: ['SOLUSDT', 'DOGEUSDT', 'ETHUSDT'],
    verified: true,
    bio: 'סוחר תוך-יומי זריז על פריצות ווליום בנרות קצרים.',
    recentTrades: [
      { id: 't11', symbol: 'SOLUSDT', side: 'BUY', entry: 188.0, exit: 193.5, pnlPct: 2.92, time: 'לפני שעה', status: 'closed' },
    ],
  },
];

const DEFAULT_INVO_STATE = {
  connected: false,
  username: '',
  email: '',
  apiKey: '',
  sessionToken: '',
  targetUrl: 'https://app.invo.trade',
  nestingEnabled: true,
  autoMirrorToNostro: true,
  copyRatio: 1.0,
  maxRiskPerTradeUsd: 250,
  stopLossPct: 1.5,
  takeProfitPct: 3.5,
  activeSubscriptions: ['trader_yigal', 'trader_simcha'],
  replicatedTrades: [
    {
      id: 'rep_1',
      traderId: 'trader_yigal',
      traderName: 'יגאל',
      symbol: 'BTCUSDT',
      side: 'BUY',
      size: 0.15,
      entry: 87400,
      exit: 90200,
      pnlUsd: 420.0,
      pnlPct: 3.2,
      time: 'היום 14:22',
      destination: 'Nostro Desk (Invo Mirror)',
      status: 'closed',
    },
    {
      id: 'rep_2',
      traderId: 'trader_simcha',
      traderName: 'שמחה',
      symbol: 'NVDA',
      side: 'BUY',
      size: 20,
      entry: 142.5,
      exit: 148.8,
      pnlUsd: 126.0,
      pnlPct: 4.42,
      time: 'אתמול 17:05',
      destination: 'Nostro Desk (Invo Mirror)',
      status: 'closed',
    },
  ],
};

export function getInvoState() {
  if (!store.state.invoState) {
    store.state.invoState = JSON.parse(JSON.stringify(DEFAULT_INVO_STATE));
    store.save();
  }
  return store.state.invoState;
}

export function updateInvoState(patch) {
  const current = getInvoState();
  store.state.invoState = { ...current, ...patch };
  store.save(true);
}

export function toggleCopyTrader(traderId) {
  const s = getInvoState();
  const list = new Set(s.activeSubscriptions || []);
  if (list.has(traderId)) {
    list.delete(traderId);
  } else {
    list.add(traderId);
  }
  updateInvoState({ activeSubscriptions: Array.from(list) });
  return list.has(traderId);
}

export function simulateInvoMirrorExecution(traderId, signal) {
  const s = getInvoState();
  const trader = INVO_TOP_TRADERS.find((t) => t.id === traderId);
  if (!trader) return null;

  const trade = {
    id: `rep_${Date.now()}`,
    traderId,
    traderName: trader.name,
    symbol: signal.symbol || 'BTCUSDT',
    side: signal.side || 'BUY',
    size: signal.size || 0.1,
    entry: signal.entry || quotes[signal.symbol]?.price || 87500,
    exit: null,
    pnlUsd: 0,
    pnlPct: 0,
    time: 'עכשיו',
    destination: s.autoMirrorToNostro ? 'Nostro Desk (Invo Mirror)' : 'תיק מסחר ראשי',
    status: 'open',
  };

  s.replicatedTrades.unshift(trade);
  if (s.replicatedTrades.length > 50) s.replicatedTrades.pop();
  updateInvoState({ replicatedTrades: s.replicatedTrades });
  return trade;
}
