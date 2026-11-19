// מנוע תיק נייר (Paper Trading) — ברירת מחדל $100,000.
// מחשב עמלות ומס רווחי הון (25% בישראל) על רווח ממומש.
// סימולציה בלבד — לא מחובר לכסף אמיתי.

const TAX_RATE_IL = 0.25;

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
    this.makerFee = makerFee;
    this.takerFee = takerFee;
    this.taxRate = taxRate;
    this.taxAccumulated = 0;
    this.capitalLossesCarryForward = 0;
    this.isActive = false;
  }

  activate({ reason = 'בדיקת עבר/אישור הפעלה' } = {}) {
    this.isActive = true;
    this.log(`תיק דמה הופעל: ${reason}`);
  }

  deactivate({ reason = 'נעצר' } = {}) {
    this.isActive = false;
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

  buy({ symbol, price, quantity, timestamp = Date.now(), isTaker = true }) {
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

    const existing = this.positions[symbol];
    if (existing) {
      const totalCostBefore = existing.quantity * existing.averageEntryPrice;
      const newQuantity = existing.quantity + quantity;
      existing.averageEntryPrice = (totalCostBefore + notional + fee) / newQuantity;
      existing.quantity = newQuantity;
    } else {
      this.positions[symbol] = {
        quantity,
        averageEntryPrice: (notional + fee) / quantity,
      };
    }

    const trade = {
      timestamp,
      symbol,
      side: 'BUY',
      price,
      quantity,
      notional,
      fee,
      cashAfter: this.cash,
    };
    this.trades.push(trade);
    return { success: true, trade };
  }

  sell({ symbol, price, quantity, timestamp = Date.now(), isTaker = true }) {
    if (!this.isActive) {
      return { success: false, error: 'תיק הדמה לא פעיל — יש לעבור בדיקת עבר רווחית קודם' };
    }

    const existing = this.positions[symbol];
    if (!existing || existing.quantity < quantity) {
      return { success: false, error: 'אין כמות מספיקה למכירה בתיק הדמה' };
    }

    const notional = price * quantity;
    const fee = this.feeAmount(isTaker, price, quantity);
    const netProceeds = notional - fee;
    this.cash += netProceeds;

    const costOfSold = quantity * existing.averageEntryPrice;
    const realizedPnL = netProceeds - costOfSold;

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

    existing.quantity -= quantity;
    if (existing.quantity <= 0) {
      delete this.positions[symbol];
    }

    const trade = {
      timestamp,
      symbol,
      side: 'SELL',
      price,
      quantity,
      notional,
      fee,
      realizedPnL,
      tax,
      cashAfter: this.cash,
    };
    this.trades.push(trade);
    return { success: true, trade, realizedPnL, tax };
  }

  getEquity(currentPrices = {}) {
    let positionsValue = 0;
    for (const [symbol, pos] of Object.entries(this.positions)) {
      const raw = currentPrices[symbol];
      const currentPrice = (typeof raw === 'object' && raw !== null ? raw.price : raw) ?? pos.averageEntryPrice;
      positionsValue += pos.quantity * currentPrice;
    }
    return this.cash + positionsValue;
  }

  getReport(currentPrices = {}) {
    const equity = this.getEquity(currentPrices);
    const grossPnL = equity - this.initialBalance;

    const totalFees = this.trades.reduce((sum, t) => sum + (t.fee || 0), 0);
    const totalTax = this.taxAccumulated;

    const netPnL = grossPnL - totalFees - totalTax;
    const returnPct = (netPnL / this.initialBalance) * 100;

    return {
      initialBalance: this.initialBalance,
      equity: Math.round(equity * 100) / 100,
      cash: Math.round(this.cash * 100) / 100,
      grossPnL: Math.round(grossPnL * 100) / 100,
      totalFees: Math.round(totalFees * 100) / 100,
      totalTax: Math.round(totalTax * 100) / 100,
      netPnL: Math.round(netPnL * 100) / 100,
      returnPct: Math.round(returnPct * 100) / 100,
      tradeCount: this.trades.length,
      openPositions: Object.keys(this.positions).length,
      taxAccumulated: Math.round(this.taxAccumulated * 100) / 100,
      isActive: this.isActive,
      positions: { ...this.positions },
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
      trades: this.trades.slice(-150),
      makerFee: this.makerFee,
      takerFee: this.takerFee,
      taxRate: this.taxRate,
      taxAccumulated: this.taxAccumulated,
      capitalLossesCarryForward: this.capitalLossesCarryForward,
      isActive: this.isActive,
    };
  }

  fromJSON(data) {
    if (!data || typeof data !== 'object') return this;
    if (Number.isFinite(data.initialBalance)) this.initialBalance = data.initialBalance;
    if (Number.isFinite(data.cash)) this.cash = data.cash;
    if (data.positions && typeof data.positions === 'object') this.positions = data.positions;
    if (Array.isArray(data.trades)) this.trades = data.trades;
    if (Number.isFinite(data.taxAccumulated)) this.taxAccumulated = data.taxAccumulated;
    if (Number.isFinite(data.capitalLossesCarryForward)) this.capitalLossesCarryForward = data.capitalLossesCarryForward;
    if (typeof data.isActive === 'boolean') this.isActive = data.isActive;
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
