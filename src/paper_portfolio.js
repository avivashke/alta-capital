// מנוע תיק נייר (Paper Trading) — ברירת מחדל $100,000.
// מחשב עמלות ומס רווחי הון (25% בישראל) על רווח ממומש.
// סימולציה בלבד — לא מחובר לכסף אמיתי.

const TAX_RATE_IL = 0.25;

function makeTradeId(ts = Date.now()) {
  return `tr_${ts}_${Math.random().toString(36).slice(2, 8)}`;
}

export class PaperPortfolio {
  constructor({
    initialBalance = 100000,
    makerFee = 0.001,
    takerFee = 0.001,
    taxRate = TAX_RATE_IL,
  } = {}) {
    this.initialBalance = initialBalance;
    this.cash = initialBalance;
    this.positions = {};
    this.trades = [];
    this.equityHistory = [];
    this.makerFee = makerFee;
    this.takerFee = takerFee;
    this.taxRate = taxRate;
    this.taxAccumulated = 0;
    this.totalFeesAccumulated = 0;
    this.realizedPnLAccumulated = 0;
    this.totalTradesCount = 0;
    this.capitalLossesCarryForward = 0;
    this.isActive = false;
    this.updatedAt = null;
  }

  activate({ reason = 'בדיקת עבר/אישור הפעלה' } = {}) {
    this.isActive = true;
    this.updatedAt = new Date().toISOString();
    this.log(`תיק דמה הופעל: ${reason}`);
  }

  /**
   * מפקיד מזומן לתיק הכולל (משמש למשיכות נוסטרו שזורמות לתיק הכולל).
   * רושמת גם רישום עסקה מיוחד מסוג DEPOSIT למעקב אחר מקור הכסף.
   */
  deposit(amount, reason = '', source = 'nostro_payout') {
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      return { success: false, error: 'סכום הפקדה אינו תקין' };
    }
    const amt = Math.round(Number(amount) * 100) / 100;
    this.cash = Math.round((this.cash + amt) * 100) / 100;
    this.totalFeesAccumulated = Math.round((this.totalFeesAccumulated || 0) * 100) / 100;
    const trade = {
      id: `dep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      symbol: 'CASH',
      dir: 1,
      side: 'DEPOSIT',
      price: amt,
      quantity: 1,
      notional: amt,
      fee: 0,
      realizedPnL: amt,
      tax: 0,
      reason,
      source,
      cashAfter: this.cash,
      equityAfter: Math.round(this.getEquity() * 100) / 100,
    };
    this.trades.push(trade);
    if (this.trades.length > 500) this.trades = this.trades.slice(-500);
    this.totalTradesCount = Math.max(this.totalTradesCount + 1, this.trades.length);
    this.updatedAt = new Date().toISOString();
    this.recordEquitySnapshot({}, Date.now());
    return { success: true, trade };
  }

  deactivate({ reason = 'נעצר' } = {}) {
    this.isActive = false;
    this.updatedAt = new Date().toISOString();
    this.log(`תיק דמה הושבת: ${reason}`);
  }

  log(text) {
    const t = new Date().toISOString();
    console.log(`[PaperPortfolio] ${t} ${text}`);
  }

  feeAmount(isTaker, price, quantity) {
    const rate = isTaker ? this.takerFee : this.makerFee;
    return price * quantity * rate;
  }

  recordEquitySnapshot(currentPrices = {}, timestamp = Date.now()) {
    const equity = Math.round(this.getEquity(currentPrices) * 100) / 100;
    const cash = Math.round(this.cash * 100) / 100;
    const netPnL = Math.round((equity - this.initialBalance) * 100) / 100;
    const last = this.equityHistory[this.equityHistory.length - 1];
    if (last && Math.abs(timestamp - last.t) < 60_000 && Math.abs(last.equity - equity) < 0.01) {
      return;
    }
    this.equityHistory.push({ t: timestamp, equity, cash, netPnL });
    if (this.equityHistory.length > 300) {
      this.equityHistory = this.equityHistory.slice(-300);
    }
  }

  buy({ symbol, price, quantity, timestamp = Date.now(), isTaker = true, dir = 1, deskId = null, reason = '' }) {
    if (!this.isActive) {
      return { success: false, error: 'תיק הדמה לא פעיל — יש לעבור בדיקת עבר רווחית קודם' };
    }

    const notional = price * quantity;
    const fee = this.feeAmount(isTaker, price, quantity);
    const totalCost = notional + fee;

    if (totalCost > this.cash) {
      return { success: false, error: 'אין מספיק מזומן בתיק הדמה' };
    }

    this.cash -= totalCost;
    this.totalFeesAccumulated += fee;

    const existing = this.positions[symbol];
    const direction = dir < 0 ? -1 : 1;
    if (existing && (existing.dir || 1) === direction) {
      const totalNotionalBefore = existing.quantity * existing.averageEntryPrice;
      const newQuantity = existing.quantity + quantity;
      existing.averageEntryPrice = (totalNotionalBefore + notional) / newQuantity;
      existing.quantity = newQuantity;
      existing.feePaid = (existing.feePaid || 0) + fee;
      existing.dir = direction;
    } else {
      this.positions[symbol] = {
        quantity,
        averageEntryPrice: price,
        feePaid: fee,
        dir: direction,
        openedAt: timestamp,
        deskId,
      };
    }

    const equityAfter = this.getEquity({ [symbol]: price });
    const trade = {
      id: makeTradeId(timestamp),
      timestamp,
      symbol,
      deskId,
      dir: direction,
      side: direction > 0 ? 'BUY' : 'SHORT',
      price,
      quantity,
      notional,
      fee,
      reason,
      cashAfter: Math.round(this.cash * 100) / 100,
      equityAfter: Math.round(equityAfter * 100) / 100,
    };
    this.trades.push(trade);
    if (this.trades.length > 500) this.trades = this.trades.slice(-500);
    this.totalTradesCount = Math.max(this.totalTradesCount + 1, this.trades.length);
    this.updatedAt = new Date(timestamp).toISOString();
    this.recordEquitySnapshot({ [symbol]: price }, timestamp);
    return { success: true, trade };
  }

  sell({ symbol, price, quantity, timestamp = Date.now(), isTaker = true, deskId = null, reason = '' }) {
    if (!this.isActive) {
      return { success: false, error: 'תיק הדמה לא פעיל — יש לעבור בדיקת עבר רווחית קודם' };
    }

    const existing = this.positions[symbol];
    if (!existing || existing.quantity < quantity - 1e-12) {
      return { success: false, error: 'אין כמות מספיקה למכירה בתיק הדמה' };
    }

    const qty = Math.min(quantity, existing.quantity);
    const direction = existing.dir || 1;
    const notional = price * qty;
    const entryNotional = existing.averageEntryPrice * qty;
    const fee = this.feeAmount(isTaker, price, qty);
    this.totalFeesAccumulated += fee;

    const entryFeeShare = existing.quantity > 0 ? ((existing.feePaid || 0) * (qty / existing.quantity)) : 0;

    let grossTradePnL;
    let proceeds;
    if (direction > 0) {
      grossTradePnL = notional - entryNotional;
      proceeds = notional - fee;
    } else {
      // Short position: margin reserved at entry was entryNotional; PnL = entryNotional - notional
      grossTradePnL = entryNotional - notional;
      proceeds = Math.max(0, entryNotional + grossTradePnL - fee);
    }

    const realizedPnL = grossTradePnL - fee - entryFeeShare;
    this.cash += proceeds;
    this.realizedPnLAccumulated += realizedPnL;

    let tax = 0;
    if (realizedPnL > 0) {
      const taxableGain = Math.max(0, realizedPnL - this.capitalLossesCarryForward);
      tax = taxableGain * this.taxRate;
      this.capitalLossesCarryForward = Math.max(0, this.capitalLossesCarryForward - realizedPnL);
      this.taxAccumulated += tax;
      this.cash -= tax;
    } else if (realizedPnL < 0) {
      this.capitalLossesCarryForward += Math.abs(realizedPnL);
    }

    existing.quantity -= qty;
    if (existing.feePaid) existing.feePaid = Math.max(0, existing.feePaid - entryFeeShare);
    if (existing.quantity <= 1e-9) {
      delete this.positions[symbol];
    }

    const equityAfter = this.getEquity({ [symbol]: price });
    const trade = {
      id: makeTradeId(timestamp),
      timestamp,
      symbol,
      deskId: deskId || existing.deskId || null,
      dir: direction,
      side: direction > 0 ? 'SELL' : 'COVER',
      price,
      quantity: qty,
      notional,
      fee,
      realizedPnL: Math.round(realizedPnL * 100) / 100,
      tax: Math.round(tax * 100) / 100,
      reason,
      cashAfter: Math.round(this.cash * 100) / 100,
      equityAfter: Math.round(equityAfter * 100) / 100,
    };
    this.trades.push(trade);
    if (this.trades.length > 500) this.trades = this.trades.slice(-500);
    this.totalTradesCount = Math.max(this.totalTradesCount + 1, this.trades.length);
    this.updatedAt = new Date(timestamp).toISOString();
    this.recordEquitySnapshot({ [symbol]: price }, timestamp);
    return { success: true, trade, realizedPnL, tax };
  }

  getEquity(currentPrices = {}) {
    let positionsValue = 0;
    for (const [symbol, pos] of Object.entries(this.positions)) {
      const raw = currentPrices[symbol];
      const currentPrice = (typeof raw === 'object' && raw !== null ? raw.price : raw) ?? pos.averageEntryPrice;
      const direction = pos.dir || 1;
      if (direction > 0) {
        positionsValue += pos.quantity * currentPrice;
      } else {
        // Short margin value = entryNotional + (entryPrice - currentPrice) * qty
        const val = pos.quantity * (2 * pos.averageEntryPrice - currentPrice);
        positionsValue += Math.max(0, val);
      }
    }
    return this.cash + positionsValue;
  }

  getReport(currentPrices = {}) {
    const equity = this.getEquity(currentPrices);
    const tradesFees = this.trades.reduce((sum, t) => sum + (t.fee || 0), 0);
    const totalFees = Math.max(this.totalFeesAccumulated || 0, tradesFees);
    const totalTax = this.taxAccumulated || 0;

    // Cash already reflects paid fees and taxes, so (equity - initialBalance) is net PnL after fees & tax
    const netPnL = equity - this.initialBalance;
    const grossPnL = netPnL + totalFees + totalTax;
    const returnPct = this.initialBalance > 0 ? (netPnL / this.initialBalance) * 100 : 0;

    return {
      initialBalance: this.initialBalance,
      equity: Math.round(equity * 100) / 100,
      cash: Math.round(this.cash * 100) / 100,
      grossPnL: Math.round(grossPnL * 100) / 100,
      totalFees: Math.round(totalFees * 100) / 100,
      totalTax: Math.round(totalTax * 100) / 100,
      netPnL: Math.round(netPnL * 100) / 100,
      returnPct: Math.round(returnPct * 100) / 100,
      realizedPnL: Math.round((this.realizedPnLAccumulated || 0) * 100) / 100,
      tradeCount: Math.max(this.totalTradesCount || 0, this.trades.length),
      openPositions: Object.keys(this.positions).length,
      taxAccumulated: Math.round(totalTax * 100) / 100,
      isActive: this.isActive,
      positions: { ...this.positions },
      equityHistory: this.equityHistory || [],
      updatedAt: this.updatedAt,
    };
  }

  isProfitableAfterFeesAndTax(currentPrices = {}) {
    const report = this.getReport(currentPrices);
    return report.netPnL > 0;
  }

  toJSON() {
    return {
      initialBalance: this.initialBalance,
      cash: this.cash,
      positions: this.positions,
      trades: this.trades.slice(-500),
      equityHistory: this.equityHistory.slice(-300),
      makerFee: this.makerFee,
      takerFee: this.takerFee,
      taxRate: this.taxRate,
      taxAccumulated: this.taxAccumulated,
      totalFeesAccumulated: Math.max(
        this.totalFeesAccumulated || 0,
        this.trades.reduce((s, t) => s + (t.fee || 0), 0),
      ),
      realizedPnLAccumulated: this.realizedPnLAccumulated || 0,
      totalTradesCount: Math.max(this.totalTradesCount || 0, this.trades.length),
      capitalLossesCarryForward: this.capitalLossesCarryForward,
      isActive: this.isActive,
      updatedAt: this.updatedAt || new Date().toISOString(),
    };
  }

  fromJSON(data) {
    if (!data || typeof data !== 'object') return this;
    if (Number.isFinite(Number(data.initialBalance))) this.initialBalance = Number(data.initialBalance);
    if (Number.isFinite(Number(data.cash))) this.cash = Number(data.cash);
    this.positions = (data.positions && typeof data.positions === 'object')
      ? JSON.parse(JSON.stringify(data.positions))
      : {};
    this.trades = Array.isArray(data.trades) ? JSON.parse(JSON.stringify(data.trades)) : [];
    this.equityHistory = Array.isArray(data.equityHistory) ? JSON.parse(JSON.stringify(data.equityHistory)) : [];
    if (Number.isFinite(Number(data.makerFee))) this.makerFee = Number(data.makerFee);
    if (Number.isFinite(Number(data.takerFee))) this.takerFee = Number(data.takerFee);
    if (Number.isFinite(Number(data.taxRate))) this.taxRate = Number(data.taxRate);
    this.taxAccumulated = Number.isFinite(Number(data.taxAccumulated)) ? Number(data.taxAccumulated) : 0;
    const tradesFees = this.trades.reduce((s, t) => s + (Number(t.fee) || 0), 0);
    this.totalFeesAccumulated = Number.isFinite(Number(data.totalFeesAccumulated))
      ? Math.max(Number(data.totalFeesAccumulated), tradesFees)
      : tradesFees;
    this.realizedPnLAccumulated = Number.isFinite(Number(data.realizedPnLAccumulated))
      ? Number(data.realizedPnLAccumulated)
      : this.trades.reduce((s, t) => s + (Number(t.realizedPnL) || 0), 0);
    this.totalTradesCount = Math.max(
      Number.isFinite(Number(data.totalTradesCount)) ? Number(data.totalTradesCount) : 0,
      this.trades.length,
    );
    this.capitalLossesCarryForward = Number.isFinite(Number(data.capitalLossesCarryForward))
      ? Number(data.capitalLossesCarryForward)
      : 0;
    if (typeof data.isActive === 'boolean') this.isActive = data.isActive;
    this.updatedAt = data.updatedAt || null;
    return this;
  }
}

export function createPaperPortfolio(settings = {}) {
  const paper = settings.paperTrading || {};
  const initial = Number(paper.initialBalance) || Number(settings.capital) || 100000;
  return new PaperPortfolio({
    initialBalance: initial,
    makerFee: paper.makerFee ?? 0.001,
    takerFee: paper.takerFee ?? 0.001,
    taxRate: paper.taxRate ?? TAX_RATE_IL,
  });
}
