// src/binance_testnet.js
// לקוח API עבור Binance Testnet — סביבת בדיקה עם נתוני שוק אמת של קריפטו.
// לא מסחר בכסף אמת. משתמש במפתחות API מסביבת הבדיקה של Binance.
// תיעוד: https://developers.binance.com/docs/binance-spot-api-docs/testnet

import crypto from 'node:crypto';

const TESTNET_BASE = 'https://testnet.binance.vision/api/v3';

// עמלת ברירת מחדל של Binance (ניתן לשנות בהגדרות)
const DEFAULT_MAKER_FEE = 0.001; // 0.1%
const DEFAULT_TAKER_FEE = 0.001; // 0.1%

function hmacSign(secret, queryString) {
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

function buildQuery(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

export class BinanceTestnet {
  constructor({ apiKey, apiSecret, makerFee = DEFAULT_MAKER_FEE, takerFee = DEFAULT_TAKER_FEE } = {}) {
    this.apiKey = apiKey || '';
    this.apiSecret = apiSecret || '';
    this.makerFee = makerFee;
    this.takerFee = takerFee;
    this.recvWindow = 5000;
  }

  // בקשת GET ציבורית (בלי חתימה)
  async publicGet(path, params = {}) {
    const query = buildQuery(params);
    const url = `${TESTNET_BASE}${path}${query ? '?' + query : ''}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Binance ${path} HTTP ${res.status} ${text}`);
    }
    return await res.json();
  }

  // בקשה מאומתת (דורשת API Key + חתימה)
  async signedRequest(method, path, params = {}, requireSignature = true) {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error('חסרים מפתחות API של Binance Testnet בהגדרות');
    }

    const timestamp = Date.now();
    const queryParams = { ...params, timestamp, recvWindow: this.recvWindow };
    let queryString = buildQuery(queryParams);

    if (requireSignature) {
      const signature = hmacSign(this.apiSecret, queryString);
      queryString += `&signature=${encodeURIComponent(signature)}`;
    }

    const url = `${TESTNET_BASE}${path}?${queryString}`;
    const res = await fetch(url, {
      method,
      headers: {
        'X-MBX-APIKEY': this.apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Binance ${method} ${path} HTTP ${res.status} ${text}`);
    }
    return await res.json();
  }

  // מחיר נוכחי של סמל
  async getPrice(symbol) {
    const data = await this.publicGet('/ticker/price', { symbol });
    return +data.price;
  }

  // מידע על חשבון (יתרות)
  async getAccount() {
    return await this.signedRequest('GET', '/account', {}, true);
  }

  // פתיחת פקודת קנייה/מכירה בשוק (MARKET)
  async createMarketOrder({ symbol, side, quantity }) {
    const params = {
      symbol,
      side, // BUY או SELL
      type: 'MARKET',
      quantity: Number(quantity).toFixed(6),
    };
    return await this.signedRequest('POST', '/order', params, true);
  }

  // ביטול פקודה
  async cancelOrder({ symbol, orderId }) {
    return await this.signedRequest('DELETE', '/order', { symbol, orderId }, true);
  }

  // פרטי פקודה
  async getOrder({ symbol, orderId }) {
    return await this.signedRequest('GET', '/order', { symbol, orderId }, true);
  }

  // המרת עמלה לפי סוג פקודה (maker/taker)
  feeFor(isTaker, price, quantity) {
    const feeRate = isTaker ? this.takerFee : this.makerFee;
    return price * quantity * feeRate;
  }
}

// יצירת instance ריקה — מוגדרת מאוחר יותר מההגדרות
export function createBinanceClient(settings = {}) {
  const binance = settings.binance || {};
  return new BinanceTestnet({
    apiKey: binance.apiKey || '',
    apiSecret: binance.apiSecret || '',
    makerFee: binance.makerFee ?? DEFAULT_MAKER_FEE,
    takerFee: binance.takerFee ?? DEFAULT_TAKER_FEE,
  });
}
