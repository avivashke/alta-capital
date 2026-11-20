# ============================================================
# Alta Capital — auto-generated strategy artifact
# Desk: תוך־יומי · 5 דקות · BTCUSDT · 5m
# Version: v1.0 · Strategy family: ema_trend
# Backtest: return -1.59% · PF 0.71 · DD 2.93% · trades 23
# OOS: 2.41% · Sharpe -8.39
# Params: {"fast":10,"slow":68,"atrStop":2.2,"rr":2.5,"trendFilter":false}
# Target platform: Freqtrade
# Generated: 2026-11-20T01:20:19.445Z
# Research artifact only — no warranty, no live order routing.
# ============================================================
# Drop this file in freqtrade/user_data/strategies/ and run:
#   freqtrade backtesting --strategy Altadesk_5m --config user_data/config.json
#   freqtrade trade --strategy Altadesk_5m --config user_data/config.json --dry-run

from freqtrade.strategy import IStrategy
from pandas import DataFrame
import talib.abstract as ta


class Altadesk_5m(IStrategy):
    INTERFACE_VERSION = 3

    timeframe = '5m'
    can_short = True
    startup_candle_count = 210

    stoploss = -0.026
    minimal_roi = {"0": 2.25, "240": 0.01, "720": 0}

    trailing_stop = False
    process_only_new_candles = True
    use_exit_signal = True
    exit_profit_only = False

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe['ema_fast'] = ta.EMA(dataframe, timeperiod=10)
        dataframe['ema_slow'] = ta.EMA(dataframe, timeperiod=68)
        dataframe['ema_trend'] = ta.EMA(dataframe, timeperiod=200)
        dataframe['atr'] = ta.ATR(dataframe, timeperiod=14)
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (
        & (dataframe['ema_fast'] > dataframe['ema_slow'])
                & (dataframe['volume'] > 0)
            ),
            'enter_long',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['ema_fast'] < dataframe['ema_slow'])
                & (dataframe['volume'] > 0)
            ),
            'enter_short',
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # Risk-managed exits: ATR stop + fixed R multiple handled by the engine.
        dataframe.loc[
            (
        & (dataframe['ema_fast'] > dataframe['ema_slow'])
            ),
            'exit_short',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['ema_fast'] < dataframe['ema_slow'])
            ),
            'exit_long',
        ] = 1
        return dataframe
