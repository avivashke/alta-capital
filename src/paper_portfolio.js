// src/paper_portfolio.js
// מנוע תיק דמה (Paper Trading) עם $100,000 וירטואליים.
// מחשב עמלות Binance אמיתיות ומס רווחי הון בישראל (25%).
// סימולציה בלבד — אינו מבטיח רווח, אינו מחבר לכסף אמת.

const מיסרווחי_הון_ישראל = 0.25; // 25% מס רווחי הון לפי חוק מס הכנסה

export class PaperPortfolio {
  constructor({
    initialBalance = 100000,
    makerFee = 0.001,
    takerFee = 0.001,
    taxRate = מיסרווחי_הון_ישראל,
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

  activate({ reason = 'בדיקת עבר עברה את הסף' } = {}) {
    this.isActive = true;
    this.log(`תיק הדמה הופעל: ${reason}`);
  }

  deactivate({ reason = 'נעצר על ידי משתמש' } = {}) {
    this.isActive = false;
    this.log(`תיק הדמה הושבת: ${reason}`);
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
      const currentPrice = currentPrices[symbol] ?? pos.averageEntryPrice;
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
    };
  }

  isProfitableAfterFeesAndTax(currentPrices = {}) {
    const report = this.getReport(currentPrices);
    return report.netPnL > 0;
  }
}

export function createPaperPortfolio(settings = {}) {
  const paper = settings.paperTrading || {};
  return new PaperPortfolio({
    initialBalance: paper.initialBalance ?? 100000,
    makerFee: paper.makerFee ?? 0.001,
    takerFee: paper.takerFee ?? 0.001,
    taxRate: paper.taxRate ?? מיסרווחי_הון_ישראל,
  });
}

