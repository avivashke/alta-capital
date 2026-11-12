// Export adapters: turn a promoted desk version into runnable code for open-source bot platforms.

import { PLATFORMS } from './config.js';
import { STRATEGIES } from './strategies.js';

function header(desk, platform, comment = '#') {
  const m = desk.metrics || {};
  return [
    `${comment} ============================================================`,
    `${comment} Alta Capital — auto-generated strategy artifact`,
    `${comment} Desk: ${desk.label} · ${desk.symbol} · ${desk.tf}`,
    `${comment} Version: ${desk.version || 'v1.0'} · Strategy family: ${desk.strategyId}`,
    `${comment} Backtest: return ${m.returnPct ?? '—'}% · PF ${m.profitFactor ?? '—'} · DD ${m.maxDrawdownPct ?? '—'}% · trades ${m.trades ?? '—'}`,
    `${comment} OOS: ${desk.oosMetrics?.returnPct ?? '—'}% · Sharpe ${m.sharpe ?? '—'}`,
    `${comment} Params: ${JSON.stringify(desk.params || {})}`,
    `${comment} Target platform: ${PLATFORMS[platform]?.label || platform}`,
    `${comment} Generated: ${new Date().toISOString()}`,
    `${comment} Research artifact only — no warranty, no live order routing.`,
    `${comment} ============================================================`,
  ].join('\n');
}

function pyName(desk) {
  return 'Alta' + desk.id.replace(/[^a-zA-Z0-9]/g, '_');
}

function freqtrade(desk) {
  const p = desk.params || {};
  const sid = desk.strategyId;
  const ind = [];
  const entryLong = [];
  const entryShort = [];

  if (sid === 'ema_trend') {
    ind.push(`        dataframe['ema_fast'] = ta.EMA(dataframe, timeperiod=${Math.round(p.fast || 12)})`,
      `        dataframe['ema_slow'] = ta.EMA(dataframe, timeperiod=${Math.round(p.slow || 48)})`,
      `        dataframe['ema_trend'] = ta.EMA(dataframe, timeperiod=200)`);
    entryLong.push(`        & (dataframe['ema_fast'] > dataframe['ema_slow'])`,
      p.trendFilter ? `        & (dataframe['close'] > dataframe['ema_trend'])` : '');
    entryShort.push(`        & (dataframe['ema_fast'] < dataframe['ema_slow'])`,
      p.trendFilter ? `        & (dataframe['close'] < dataframe['ema_trend'])` : '');
  } else if (sid === 'rsi_reversion') {
    ind.push(`        dataframe['rsi'] = ta.RSI(dataframe, timeperiod=${Math.round(p.period || 14)})`);
    entryLong.push(`        & (dataframe['rsi'] <= ${Math.round(p.oversold || 30)})`,
      `        & (dataframe['rsi'].shift(1) > ${Math.round(p.oversold || 30)})`);
    entryShort.push(`        & (dataframe['rsi'] >= ${Math.round(p.overbought || 70)})`,
      `        & (dataframe['rsi'].shift(1) < ${Math.round(p.overbought || 70)})`);
  } else if (sid === 'breakout') {
    ind.push(`        dataframe['dc_high'] = dataframe['high'].rolling(${Math.round(p.period || 20)}).max()`,
      `        dataframe['dc_low'] = dataframe['low'].rolling(${Math.round(p.period || 20)}).min()`,
      `        dataframe['dc_mid'] = (dataframe['dc_high'] + dataframe['dc_low']) / 2`);
    entryLong.push(`        & (dataframe['close'] > dataframe['dc_high'].shift(1))`);
    entryShort.push(`        & (dataframe['close'] < dataframe['dc_low'].shift(1))`);
  } else if (sid === 'momentum') {
    ind.push(`        dataframe['roc'] = ta.ROC(dataframe, timeperiod=${Math.round(p.period || 10)})`);
    entryLong.push(`        & (dataframe['roc'] > ${Number(p.threshold || 0.5).toFixed(2)})`);
    entryShort.push(`        & (dataframe['roc'] < -${Number(p.threshold || 0.5).toFixed(2)})`);
  } else {
    ind.push(`        macd = ta.MACD(dataframe, fastperiod=${Math.round(p.fast || 12)}, slowperiod=${Math.round(p.slow || 26)}, signalperiod=${Math.round(p.signal || 9)})`,
      `        dataframe['macd_hist'] = macd['macdhist']`,
      `        dataframe['ema_trend'] = ta.EMA(dataframe, timeperiod=200)`);
    entryLong.push(`        & (dataframe['macd_hist'] > 0)`, `        & (dataframe['close'] > dataframe['ema_trend'])`);
    entryShort.push(`        & (dataframe['macd_hist'] < 0)`, `        & (dataframe['close'] < dataframe['ema_trend'])`);
  }

  const longCond = entryLong.filter(Boolean).join('\n');
  const shortCond = entryShort.filter(Boolean).join('\n');
  const stopRoi = Math.max(0.4, Math.min(6, Number(p.rr || 2) * 0.9)).toFixed(2);

  return `${header(desk, 'freqtrade')}
# Drop this file in freqtrade/user_data/strategies/ and run:
#   freqtrade backtesting --strategy ${pyName(desk)} --config user_data/config.json
#   freqtrade trade --strategy ${pyName(desk)} --config user_data/config.json --dry-run

from freqtrade.strategy import IStrategy
from pandas import DataFrame
import talib.abstract as ta


class ${pyName(desk)}(IStrategy):
    INTERFACE_VERSION = 3

    timeframe = '${desk.tf}'
    can_short = True
    startup_candle_count = 210

    stoploss = -${(Number(p.atrStop || 2) * 0.012).toFixed(3)}
    minimal_roi = {"0": ${stopRoi}, "240": 0.01, "720": 0}

    trailing_stop = False
    process_only_new_candles = True
    use_exit_signal = True
    exit_profit_only = False

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
${ind.join('\n')}
        dataframe['atr'] = ta.ATR(dataframe, timeperiod=14)
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (
${longCond}
                & (dataframe['volume'] > 0)
            ),
            'enter_long',
        ] = 1
        dataframe.loc[
            (
${shortCond}
                & (dataframe['volume'] > 0)
            ),
            'enter_short',
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # Risk-managed exits: ATR stop + fixed R multiple handled by the engine.
        dataframe.loc[
            (
${longCond.replace(/enter|&/g, '&')}
            ),
            'exit_short',
        ] = 1
        dataframe.loc[
            (
${shortCond.replace(/enter|&/g, '&')}
            ),
            'exit_long',
        ] = 1
        return dataframe
`;
}

function jesse(desk) {
  const p = desk.params || {};
  const sid = desk.strategyId;
  const periodMap = { ema_trend: 'fast/slow EMA', rsi_reversion: 'RSI', breakout: 'Donchian', momentum: 'ROC', macd_swing: 'MACD' };
  return `${header(desk, 'jesse')}
# Place in jesse/strategies/${pyName(desk)}/__init__.py
#   jesse backtest ${new Date().toISOString().slice(0, 10)}..

from jesse.strategies import Strategy
import jesse.indicators as ta
from jesse import utils


class ${pyName(desk)}(Strategy):
    timeframe = '${desk.tf === '1w' ? '1D' : desk.tf}'
    hyperparameters = [
        # {'name': 'atr_stop', 'type': float, 'min': 1.0, 'max': 4.0, 'default': ${Number(p.atrStop || 2).toFixed(1)}},
    ]

    def __init__(self):
        super().__init__()
        self.atr_stop = ${Number(p.atrStop || 2).toFixed(2)}
        self.rr = ${Number(p.rr || 2).toFixed(2)}
        # Family: ${periodMap[sid] || sid} · params ${JSON.stringify(p)}

    def should_long(self) -> bool:
${sid === 'rsi_reversion'
    ? `        rsi = ta.rsi(self.candles, period=${Math.round(p.period || 14)})\n        return rsi <= ${Math.round(p.oversold || 30)}`
    : sid === 'breakout'
      ? `        upper = max(c[2] for c in self.candles[-${Math.round(p.period || 20)}:-1])\n        return self.close > upper`
      : sid === 'momentum'
        ? `        roc = ta.roc(self.candles, period=${Math.round(p.period || 10)})\n        return roc > ${Number(p.threshold || 0.5).toFixed(2)}`
        : `        fast = ta.ema(self.candles, period=${Math.round(p.fast || 12)})\n        slow = ta.ema(self.candles, period=${Math.round(p.slow || 48)})\n        return fast > slow`}

    def should_short(self) -> bool:
        # Mirror of the long condition (long-only accounts can return False).
        return False

    def should_cancel_entry(self) -> bool:
        return False

    def go_long(self):
        entry = self.price
        stop = entry - self.atr_stop * ta.atr(self.candles, period=14)
        qty = utils.size_to_qty(self.balance * ${Number(store_risk()).toFixed(3)}, entry)
        self.buy = qty, entry
        self.stop_loss = qty, stop
        self.take_profit = qty, entry + (entry - stop) * self.rr

    def go_short(self):
        pass
`;
}

function store_risk() {
  return 0.015;
}

function octobot(desk) {
  const p = desk.params || {};
  return `${header(desk, 'octobot')}
# OctoBot evaluator skeleton — drop into tentacles/Evaluator/TA/
#   python start.py --simulate
import octobot_commons.enums as commons_enums
import octobot_trading.modes.script_keywords as script_keywords


class ${pyName(desk)}Evaluator:
    DESCRIPTION = "Alta Capital ${desk.version || 'v1.0'} · ${desk.label}"

    # params: ${JSON.stringify(p)}

    @staticmethod
    async def evaluate(ctx):
        candles = await script_keywords.get_candles(ctx, ctx.symbol, ${desk.tf === '1w' ? '1w' : desk.tf})
        closes = [c[commons_enums.PriceIndexes.IND_PRICE_CLOSE.value] for c in candles]

        fast = sum(closes[-${Math.round(p.fast || 12)}:]) / ${Math.round(p.fast || 12)}
        slow = sum(closes[-${Math.round(p.slow || 48)}:]) / ${Math.round(p.slow || 48)}

        if fast > slow:
            return script_keywords.Signal.LONG
        if fast < slow:
            return script_keywords.Signal.SHORT
        return script_keywords.Signal.NEUTRAL
`;
}

function superalgos(desk) {
  const spec = {
    type: 'AltaCapital/Strategy',
    version: desk.version,
    desk: { id: desk.id, symbol: desk.symbol, timeframe: desk.tf },
    strategyFamily: desk.strategyId,
    parameters: desk.params,
    entryRules: signalRules(desk.strategyId, desk.params),
    risk: {
      stopLossATRMultiple: desk.params?.atrStop,
      rewardRisk: desk.params?.rr,
      riskPerTrade: 0.015,
    },
    backtest: desk.metrics,
    outOfSample: desk.oosMetrics,
  };
  return `${header(desk, 'superalgos', '//')}\n${JSON.stringify(spec, null, 2)}`;
}

function signalRules(sid, p = {}) {
  switch (sid) {
    case 'ema_trend':
      return { long: [`sma(${Math.round(p.fast || 12)}) > sma(${Math.round(p.slow || 48)})`], short: [`sma(${Math.round(p.fast || 12)}) < sma(${Math.round(p.slow || 48)})`] };
    case 'rsi_reversion':
      return { long: [`rsi(${Math.round(p.period || 14)}) <= ${Math.round(p.oversold || 30)}`], short: [`rsi(${Math.round(p.period || 14)}) >= ${Math.round(p.overbought || 70)}`] };
    case 'breakout':
      return { long: [`close > donchian_high(${Math.round(p.period || 20)}, prev)`], short: [`close < donchian_low(${Math.round(p.period || 20)}, prev)`] };
    case 'momentum':
      return { long: [`roc(${Math.round(p.period || 10)}) > ${Number(p.threshold || 0.5).toFixed(2)}`], short: [`roc(${Math.round(p.period || 10)}) < -${Number(p.threshold || 0.5).toFixed(2)}`] };
    default:
      return { long: [`macd_hist > 0`, `close > ema(200)`], short: [`macd_hist < 0`, `close < ema(200)`] };
  }
}

function genericJson(desk) {
  const spec = {
    artifact: 'alta-capital/strategy',
    generatedAt: new Date().toISOString(),
    desk: { id: desk.id, label: desk.label, symbol: desk.symbol, timeframe: desk.tf, kind: desk.kind },
    version: desk.version,
    strategyFamily: desk.strategyId,
    parameters: desk.params,
    rules: signalRules(desk.strategyId, desk.params),
    execution: {
      entry: 'market on bar close',
      stop: 'ATR multiple',
      target: 'R multiple',
      atrStop: desk.params?.atrStop,
      rewardRisk: desk.params?.rr,
    },
    evidence: { inSample: desk.isMetrics, outOfSample: desk.oosMetrics, full: desk.metrics },
    disclaimer: 'Backtested research output. Forward-test before risking capital.',
  };
  return JSON.stringify(spec, null, 2);
}

function pineScript(desk) {
  const p = desk.params || {};
  const sid = desk.strategyId;
  const tf = desk.tf === '5m' ? '5' : desk.tf === '15m' ? '15' : desk.tf === '1h' ? '60' : desk.tf === '1d' ? 'D' : desk.tf === '1w' ? 'W' : '60';
  let entryLong = '';
  let entryShort = '';
  let indicators = '';
  if (sid === 'ema_trend') {
    indicators = `fast = ta.ema(close, ${Math.round(p.fast || 12)})\nslow = ta.ema(close, ${Math.round(p.slow || 48)})\ntrend = ta.ema(close, 200)`;
    entryLong = `fast > slow${p.trendFilter ? ' and close > trend' : ''}`;
    entryShort = `fast < slow${p.trendFilter ? ' and close < trend' : ''}`;
  } else if (sid === 'rsi_reversion') {
    indicators = `rsi = ta.rsi(close, ${Math.round(p.period || 14)})`;
    entryLong = `rsi <= ${Math.round(p.oversold || 30)}`;
    entryShort = `rsi >= ${Math.round(p.overbought || 70)}`;
  } else if (sid === 'breakout') {
    indicators = `hi = ta.highest(high, ${Math.round(p.period || 20)})[1]\nlo = ta.lowest(low, ${Math.round(p.period || 20)})[1]`;
    entryLong = `close > hi`;
    entryShort = `close < lo`;
  } else if (sid === 'momentum') {
    indicators = `roc = ta.roc(close, ${Math.round(p.period || 10)})`;
    entryLong = `roc > ${Number(p.threshold || 0.5).toFixed(2)}`;
    entryShort = `roc < -${Number(p.threshold || 0.5).toFixed(2)}`;
  } else {
    indicators = `macdLine = ta.macd(close, ${Math.round(p.fast || 12)}, ${Math.round(p.slow || 26)}, ${Math.round(p.signal || 9)})\nhist = macdLine[2]\ntrend = ta.ema(close, 200)`;
    entryLong = `hist > 0 and close > trend`;
    entryShort = `hist < 0 and close < trend`;
  }
  const atrStop = Number(p.atrStop || 2);
  const rr = Number(p.rr || 2);
  return `// ============================================================
// Alta Capital - auto-generated TradingView strategy
// Desk: ${desk.label} | ${desk.symbol} | ${desk.tf}
// Version: ${desk.version || 'v1.0'} | Family: ${desk.strategyId}
// Backtest: return ${desk.metrics?.returnPct ?? '—'}% | PF ${desk.metrics?.profitFactor ?? '—'} | DD ${desk.metrics?.maxDrawdownPct ?? '—'}%
// OOS: ${desk.oosMetrics?.returnPct ?? '—'}% | Params: ${JSON.stringify(desk.params || {})}
// Paste into TradingView: Pine Editor -> Add to chart -> set to paper trading
// ============================================================
//@version=5
strategy("Alta_${desk.id}_${desk.version || 'v1'}", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=10, commission_type=strategy.commission.percent, commission_value=0.04, pyramiding=0)

${indicators}
atrVal = ta.atr(14)

longCond = ${entryLong}
shortCond = ${entryShort}

if (longCond)
    strategy.entry("Long", strategy.long)
if (shortCond)
    strategy.entry("Short", strategy.short)

// ATR-based stop / target
longStop = strategy.position_avg_price - ${atrStop} * atrVal
longTarget = strategy.position_avg_price + ${atrStop} * atrVal * ${rr}
shortStop = strategy.position_avg_price + ${atrStop} * atrVal
shortTarget = strategy.position_avg_price - ${atrStop} * atrVal * ${rr}

if (strategy.position_size > 0)
    strategy.exit("LX", "Long", stop=longStop, limit=longTarget)
if (strategy.position_size < 0)
    strategy.exit("SX", "Short", stop=shortStop, limit=shortTarget)

plot(ta.ema(close, ${Math.round(p.fast || 12)}), "Fast", color=color.new(color.teal, 0))
plot(ta.ema(close, ${Math.round(p.slow || 48)}), "Slow", color=color.new(color.orange, 0))
`;
}

export function buildArtifact(desk, platform = 'freqtrade') {
  const key = PLATFORMS[platform] ? platform : 'freqtrade';
  const code =
    key === 'freqtrade' ? freqtrade(desk) :
    key === 'jesse' ? jesse(desk) :
    key === 'octobot' ? octobot(desk) :
    key === 'superalgos' ? superalgos(desk) :
    key === 'tradingview' ? pineScript(desk) :
    genericJson(desk);
  const ext = key === 'generic' || key === 'superalgos' ? 'json' : key === 'tradingview' ? 'pine' : 'py';
  const filename = `${desk.id}_${desk.version || 'v1.0'}_${key}.${ext}`.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return { code, filename, platform: key, language: ext === 'pine' ? 'pine' : (ext === 'json' ? 'json' : 'python') };
}

export function platformInfo(platform) {
  return PLATFORMS[platform] || PLATFORMS.freqtrade;
}

export function strategyBlurb(id) {
  return STRATEGIES[id]?.blurb || '';
}
