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
